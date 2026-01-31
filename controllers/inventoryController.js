const { poolPromise, sql } = require('../config/db');

// 1. عرض المخزن (آمن، يستخدم input أصلاً)
exports.getMyInventory = async (req, res) => {
    try {
        const pool = await poolPromise;
        const userNo = req.user.userNo;

        const result = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT 
                    UI.SerialNo, UI.ItemId, UI.Count, UI.SealVal, UI.Durability, UI.Status, UI.EndDate,
                    I.ItemName, I.ItemType, 
                    CASE WHEN UI.EndDate > GETDATE() THEN DATEDIFF(DAY, GETDATE(), UI.EndDate) ELSE 0 END AS DaysLeft,
                    CASE WHEN UI.EndDate < GETDATE() THEN 1 ELSE 0 END AS IsExpired
                FROM GameDB.dbo.T_UserItem UI
                LEFT JOIN GameDB.dbo.T_ItemInfo I ON UI.ItemId = I.ItemId
                WHERE UI.UserNo = @uid AND UI.Status != 0 AND UI.IsBaseItem = 0
                ORDER BY UI.EndDate DESC
            `);

        res.json({ status: 'success', inventory: result.recordset });

    } catch (err) {
        console.error('Inventory Error:', err);
        res.status(500).json({ message: 'خطأ في جلب بيانات المخزن', error: err.message });
    }
};

// 2. ختم السلاح (تم تأمين العمليات المالية والحذف 🛡️)
exports.sealItem = async (req, res) => {
    const { serialNo } = req.body;
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. جلب تكلفة الختم
        const settingsResult = await pool.request()
            .query(`SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'SealCost'`);
        
        const sealCost = settingsResult.recordset.length > 0 
            ? parseInt(settingsResult.recordset[0].ConfigValue) 
            : 1000; 

        // ب. التحقق من السلاح ورصيد اللاعب (استخدام input لحماية الاستعلام)
        const checkResult = await pool.request()
            .input('serial', serialNo)
            .input('uid', userNo)
            .query(`
                SELECT UI.SealVal, UI.IsBaseItem, UI.Status, U.CashMoney AS CurrentGP 
                FROM GameDB.dbo.T_UserItem UI
                JOIN GameDB.dbo.T_User U ON UI.UserNo = U.UserNo
                WHERE UI.SerialNo = @serial AND UI.UserNo = @uid
            `);

        const item = checkResult.recordset[0];

        if (!item) return res.status(404).json({ message: 'العنصر غير موجود أو لا تملكه' });
        if (item.IsBaseItem) return res.status(400).json({ message: 'لا يمكن ختم العناصر الأساسية' });
        if (item.SealVal !== 0) return res.status(400).json({ message: 'هذا السلاح مختوم بالفعل' });
        
        if (item.CurrentGP < sealCost) {
            return res.status(400).json({ message: `رصيدك غير كافٍ. تكلفة الختم: ${sealCost} GP` });
        }

        // ج. تنفيذ العملية (Transaction)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // ✅ إضافة المدخلات الآمنة هنا لتستخدمها جميع الاستعلامات داخل الـ Transaction
            request.input('cost', sealCost);
            request.input('uid', userNo);
            request.input('serial', serialNo);

            // 1. خصم تكلفة الختم (استبدال ${} بـ @)
            await request.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - @cost 
                WHERE UserNo = @uid
            `);

            // 2. ختم السلاح وتحديث حالته
            await request.query(`
                UPDATE GameDB.dbo.T_UserItem 
                SET SealVal = 1, Status = 1, WeaponSlotNo = 0 
                WHERE SerialNo = @serial
            `);

            // 3. حذفه من جدول التجهيزات
            await request.query(`
                DELETE FROM GameDB.dbo.T_CharacterEquip 
                WHERE ItemSerialNo = @serial AND UserNo = @uid
            `);

            await transaction.commit();

            res.json({ 
                status: 'success', 
                message: `تم ختم السلاح وإلغاء تجهيزه بنجاح. تم خصم ${sealCost} GP.`,
                newBalance: item.CurrentGP - sealCost
            });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error('Sealing Error:', err);
        res.status(500).json({ message: 'فشلت عملية الختم', error: err.message });
    }
};