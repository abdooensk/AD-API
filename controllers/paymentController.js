const { poolPromise, sql } = require('../config/db');

// --- إعدادات PayPal (كمثال) ---
// ستحتاج لتثبيت: npm install @paypal/checkout-server-sdk

exports.createPayPalOrder = async (req, res) => {
    const { amount } = req.body; // المبلغ بالدولار
    const userNo = req.user.userNo;

    try {
        // 1. حساب كم كاش يستحق (مثلاً 1$ = 100 CashMoney)
        const cashToGive = amount * 100;

        // 2. تسجيل العملية كـ PENDING في SQL
        const pool = await poolPromise;
        const result = await pool.request()
            .input('uid', userNo)
            .input('amt', amount)
            .input('cash', cashToGive)
            .query(`INSERT INTO AdrenalineWeb.dbo.Web_Donations (UserNo, Amount, CashAmount, Provider, Status) 
                    VALUES (@uid, @amt, @cash, 'PAYPAL', 'PENDING'); SELECT SCOPE_IDENTITY() AS ID;`);
        
        const internalId = result.recordset[0].ID;

        // 3. هنا تتواصل مع API باي بال لإنشاء الطلب وإرسال الرابط للاعب
        res.json({ status: 'success', internalId, message: "جاري تحويلك لباي بال..." });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في بدء عملية الدفع' });
    }
};

// --- إعدادات Binance Pay ---
exports.createBinanceOrder = async (req, res) => {
    // تشبه باي بال ولكن باستخدام Binance Pay SDK
    // بايننس تعتمد على الـ QR Code عادةً
};

// --- الدالة الأهم: منح الكاش بعد النجاح ---
exports.completePayment = async (internalId, transactionId) => {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
        const req = new sql.Request(transaction);
        
        // 1. جلب بيانات الطلب
        const order = await req.query(`SELECT * FROM AdrenalineWeb.dbo.Web_Donations WHERE DonationID = ${internalId}`);
        const data = order.recordset[0];

        if (data && data.Status === 'PENDING') {
            // 2. تحديث رصيد اللاعب في GameDB
            // استناداً لجدول T_User وعمود CashMoney
            await req.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney + ${data.CashAmount} WHERE UserNo = ${data.UserNo}`);

            // 3. تحديث حالة الطلب
            await req.query(`UPDATE AdrenalineWeb.dbo.Web_Donations 
                             SET Status = 'SUCCESS', TransactionID = '${transactionId}', CompletedAt = GETDATE() 
                             WHERE DonationID = ${internalId}`);

            await transaction.commit();
            return true;
        }
    } catch (err) {
        await transaction.rollback();
        return false;
    }
};