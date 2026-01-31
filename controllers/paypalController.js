const axios = require('axios');
const { poolPromise, sql } = require('../config/db');

// إعدادات البيئة
const PAYPAL_API = process.env.PAYPAL_MODE === 'live' 
    ? 'https://api-m.paypal.com' 
    : 'https://api-m.sandbox.paypal.com';

const getPayPalAccessToken = async () => {
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    try {
        const response = await axios({
            url: `${PAYPAL_API}/v1/oauth2/token`,
            method: 'post',
            data: 'grant_type=client_credentials',
            headers: { Authorization: `Basic ${auth}` }
        });
        return response.data.access_token;
    } catch (err) {
        throw new Error('فشل الاتصال بـ PayPal API');
    }
};

// 1. إنشاء الطلب (Create Order) - يعتمد على PackID
exports.createOrder = async (req, res) => {
    const { packId } = req.body; 
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. جلب تفاصيل الحزمة
        const packRes = await pool.request()
            .input('pid', sql.Int, packId)
            .query("SELECT * FROM AdrenalineWeb.dbo.Web_PaymentPacks WHERE PackID = @pid AND IsActive = 1");

        const pack = packRes.recordset[0];
        if (!pack) return res.status(404).json({ message: 'الحزمة غير موجودة أو غير مفعلة' });

        const totalCash = pack.BaseCash + (pack.BonusCash || 0);

        // ب. تسجيل الطلب
        const dbResult = await pool.request()
            .input('uid', sql.Int, userNo)
            .input('amt', sql.Decimal(10, 2), pack.PriceUSD)
            .input('cash', sql.Int, totalCash)
            .input('pid', sql.Int, pack.PackID)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_Donations 
                (UserNo, Amount, CashAmount, Provider, Status, PackID, CreatedAt) 
                VALUES 
                (@uid, @amt, @cash, 'PAYPAL', 'PENDING', @pid, GETDATE());
                SELECT SCOPE_IDENTITY() AS ID;
            `);
        
        const internalOrderId = dbResult.recordset[0].ID;
        const accessToken = await getPayPalAccessToken();

        // ج. إرسال الطلب لـ PayPal (السعر من الداتابيز حصراً)
        const response = await axios({
            url: `${PAYPAL_API}/v2/checkout/orders`,
            method: 'post',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            data: {
                intent: 'CAPTURE',
                purchase_units: [{
                    reference_id: internalOrderId.toString(),
                    description: pack.PackName,
                    amount: { currency_code: 'USD', value: pack.PriceUSD.toString() }
                }]
            }
        });

        res.json({ status: 'success', paypalOrderId: response.data.id, internalId: internalOrderId });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل إنشاء الطلب' });
    }
};

// 2. تأكيد الدفع وتسليم الجوائز والكاش (Capture)
exports.captureOrder = async (req, res) => {
    const { paypalOrderId, internalId } = req.body;
    const userNo = req.user.userNo;

    try {
        const accessToken = await getPayPalAccessToken();
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
                const reqTr = new sql.Request(transaction);

                // أ. جلب بيانات الطلب والحزمة
                const orderCheck = await reqTr.query(`
                    SELECT 
                        D.CashAmount, D.Status, 
                        P.BonusItemID1, P.BonusItemDays1,
                        P.BonusItemID2, P.BonusItemDays2,
                        P.BonusItemID3, P.BonusItemDays3
                    FROM AdrenalineWeb.dbo.Web_Donations D
                    LEFT JOIN AdrenalineWeb.dbo.Web_PaymentPacks P ON D.PackID = P.PackID
                    WHERE D.DonationID = ${internalId}
                `);
                
                const orderData = orderCheck.recordset[0];
                if (!orderData || orderData.Status !== 'PENDING') throw new Error("الطلب غير صالح");

                // ب. تسليم الكاش
                await reqTr.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney + ${orderData.CashAmount} WHERE UserNo = ${userNo}`);

                // ج. تسليم الأسلحة الهدية (1، 2، 3) إذا وجدت 🔥
                const itemsToGive = [
                    { id: orderData.BonusItemID1, days: orderData.BonusItemDays1 },
                    { id: orderData.BonusItemID2, days: orderData.BonusItemDays2 },
                    { id: orderData.BonusItemID3, days: orderData.BonusItemDays3 }
                ];

                for (const item of itemsToGive) {
                    if (item.id && item.id > 0) {
                        await reqTr.query(`
                            INSERT INTO GameDB.dbo.T_UserItem 
                            (UserNo, ItemId, Count, Status, StartDate, EndDate, IsBaseItem)
                            VALUES 
                            (${userNo}, ${item.id}, 1, 1, GETDATE(), DATEADD(DAY, ${item.days}, GETDATE()), 0)
                        `);
                    }
                }

                // د. إغلاق الطلب
                await reqTr.query(`UPDATE AdrenalineWeb.dbo.Web_Donations SET Status = 'SUCCESS', TransactionID = '${paypalOrderId}', CompletedAt = GETDATE() WHERE DonationID = ${internalId}`);

                await transaction.commit();
                res.json({ status: 'success', message: 'تم الشحن بنجاح! تم إضافة الرصيد والهدايا لحسابك.' });

            } catch (err) {
                await transaction.rollback();
                throw err;
            }
        } else {
            res.status(400).json({ message: 'لم يكتمل الدفع' });
        }
    } catch (err) {
        console.error('Capture Error:', err.message);
        res.status(500).json({ message: 'فشل التأكيد' });
    }
};