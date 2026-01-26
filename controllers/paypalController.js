const axios = require('axios');
const { poolPromise, sql } = require('../config/db');

const PAYPAL_API = process.env.PAYPAL_MODE === 'live' 
    ? 'https://api-m.paypal.com' 
    : 'https://api-m.sandbox.paypal.com';

// وظيفة للحصول على Token الدخول من PayPal
const getPayPalAccessToken = async () => {
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const response = await axios({
        url: `${PAYPAL_API}/v1/oauth2/token`,
        method: 'post',
        data: 'grant_type=client_credentials',
        headers: { Authorization: `Basic ${auth}` }
    });
    return response.data.access_token;
};

// 1. إنشاء طلب الدفع
exports.createOrder = async (req, res) => {
    const { amount } = req.body; // المبلغ بالدولار من الفرونت اند
    const userNo = req.user.userNo;

    try {
        const accessToken = await getPayPalAccessToken();
        const cashToGive = amount * 100; // مثال: 1 دولار = 100 كاش

        // تسجيل الطلب كـ PENDING في قاعدة بياناتك
        const pool = await poolPromise;
        const dbResult = await pool.request()
            .input('uid', userNo)
            .input('amt', amount)
            .input('cash', cashToGive)
            .query(`INSERT INTO AdrenalineWeb.dbo.Web_Donations (UserNo, Amount, CashAmount, Provider, Status) 
                    VALUES (@uid, @amt, @cash, 'PAYPAL', 'PENDING'); SELECT SCOPE_IDENTITY() AS ID;`);
        
        const internalOrderId = dbResult.recordset[0].ID;

        // إنشاء الطلب في PayPal
        const response = await axios({
            url: `${PAYPAL_API}/v2/checkout/orders`,
            method: 'post',
            headers: { 
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            data: {
                intent: 'CAPTURE',
                purchase_units: [{
                    reference_id: internalOrderId.toString(),
                    amount: { currency_code: 'USD', value: amount.toString() }
                }]
            }
        });

        res.json({ status: 'success', paypalOrderId: response.data.id, internalId: internalOrderId });
    } catch (err) {
        console.error(err.response ? err.response.data : err);
        res.status(500).json({ message: 'فشل إنشاء طلب PayPal' });
    }
};

// 2. تأكيد الدفع ومنح الكاش
exports.captureOrder = async (req, res) => {
    const { paypalOrderId, internalId } = req.body;
    const userNo = req.user.userNo;

    try {
        const accessToken = await getPayPalAccessToken();
        
        // تنفيذ عملية الدفع (Capture)
        const response = await axios({
            url: `${PAYPAL_API}/v2/checkout/orders/${paypalOrderId}/capture`,
            method: 'post',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });

        if (response.data.status === 'COMPLETED') {
            const pool = await poolPromise;
            const transaction = new sql.Transaction(pool);
            await transaction.begin();

            try {
                const request = new sql.Request(transaction);
                
                // جلب بيانات الطلب الداخلي
                const orderData = await request.query(`SELECT CashAmount FROM AdrenalineWeb.dbo.Web_Donations WHERE DonationID = ${internalId} AND Status = 'PENDING'`);
                
                if (orderData.recordset.length > 0) {
                    const cash = orderData.recordset[0].CashAmount;

                    // تحديث رصيد اللاعب في GameDB
                    await request.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney + ${cash} WHERE UserNo = ${userNo}`);

                    // تحديث حالة الفاتورة
                    await request.query(`UPDATE AdrenalineWeb.dbo.Web_Donations 
                                         SET Status = 'SUCCESS', TransactionID = '${paypalOrderId}', CompletedAt = GETDATE() 
                                         WHERE DonationID = ${internalId}`);

                    await transaction.commit();
                    return res.json({ status: 'success', message: `تم الشحن بنجاح! حصلت على ${cash} كاش.` });
                } else {
                    throw new Error("الطلب غير موجود أو تمت معالجته مسبقاً");
                }
            } catch (err) {
                await transaction.rollback();
                throw err;
            }
        }
    } catch (err) {
res.status(500).json({ 
        message: 'فشل تأكيد عملية الدفع', 
        error: err.response ? err.response.data : err.message // 👈 سيظهر لك السبب الحقيقي هنا
    });    }
};