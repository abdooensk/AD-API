const { poolPromise, sql } = require('../config/db');

// 1. عرض المخزن (آمن، يستخدم input أصلاً)
// 1. عرض المخزن (تم التحديث لجلب العناصر غير المنتهية فقط)
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
                    
                    -- بما أننا نجلب العناصر الصالحة فقط، يمكننا تبسيط حساب الأيام
                    DATEDIFF(DAY, GETDATE(), UI.EndDate) AS DaysLeft,
                    0 AS IsExpired -- ستكون دائماً 0 لأنها غير منتهية
                    
                FROM GameDB.dbo.T_UserItem UI
                LEFT JOIN GameDB.dbo.T_ItemInfo I ON UI.ItemId = I.ItemId
                
                -- 👈 إضافة شرط UI.EndDate > GETDATE() هنا
                WHERE UI.UserNo = @uid 
                  AND UI.Status != 0 
                  AND UI.IsBaseItem = 0 
                  AND UI.EndDate > GETDATE() 
                  
                ORDER BY UI.EndDate DESC
            `);

        res.json({ status: 'success', inventory: result.recordset });

    } catch (err) {
        console.error('Inventory Error:', err);
        res.status(500).json({ message: 'خطأ في جلب بيانات المخزن', error: err.message });
    }
};

// 2. ختم السلاح (تم تأمين العمليات المالية والحذف 🛡️)
// 2. ختم السلاح (يعتمد على الأيام المتبقية من صلاحية السلاح 🛡️)
exports.sealItem = async (req, res) => {
    const { serialNo } = req.body; // نكتفي برقم السلاح فقط، السيرفر سيحسب الباقي
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. جلب تكلفة الختم لليوم الواحد من الإعدادات
        const settingsResult = await pool.request()
            .query(`SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'SealCost'`);
        
        const baseSealCost = settingsResult.recordset.length > 0 
            ? parseInt(settingsResult.recordset[0].ConfigValue) 
            : 1000; 

        // ب. التحقق من السلاح وجلب الأيام المتبقية (استخدام DATEDIFF لحساب الأيام)
        const checkResult = await pool.request()
            .input('serial', serialNo)
            .input('uid', userNo)
            .query(`
                SELECT UI.SealVal, UI.IsBaseItem, UI.Status, UI.EndDate, U.CashMoney AS CurrentGP,
                       DATEDIFF(DAY, GETDATE(), UI.EndDate) AS DaysLeft
                FROM GameDB.dbo.T_UserItem UI
                JOIN GameDB.dbo.T_User U ON UI.UserNo = U.UserNo
                WHERE UI.SerialNo = @serial AND UI.UserNo = @uid
            `);

        const item = checkResult.recordset[0];

        if (!item) return res.status(404).json({ message: 'العنصر غير موجود أو لا تملكه' });
        if (item.IsBaseItem) return res.status(400).json({ message: 'لا يمكن ختم العناصر الأساسية' });
        if (item.SealVal !== 0) return res.status(400).json({ message: 'هذا السلاح مختوم بالفعل' });
        
        // التأكد من أن السلاح لم تنتهِ صلاحيته بعد
        if (item.DaysLeft <= 0) {
            return res.status(400).json({ message: 'انتهت صلاحية هذا السلاح ولا يمكن ختمه' });
        }
        
        // 👈 حساب التكلفة بناءً على الأيام المتبقية
        const sealDays = item.DaysLeft;
        const totalCost = baseSealCost * sealDays;

        // التحقق من الرصيد
        if (item.CurrentGP < totalCost) {
            return res.status(400).json({ message: `رصيدك غير كافٍ. الأيام المتبقية (${sealDays}) وتكلفة الختم هي: ${totalCost} GP` });
        }

        // ج. تنفيذ العملية (Transaction) لضمان الأمان
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // إدخال المتغيرات
            request.input('cost', totalCost);
            request.input('uid', userNo);
            request.input('serial', serialNo);
            request.input('days', sealDays); // 👈 نمرر الأيام المتبقية للختم

            // 1. خصم التكلفة الإجمالية (مع الحماية من ثغرة التزامن)
            const deductRes = await request.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - @cost 
                WHERE UserNo = @uid AND CashMoney >= @cost
            `);

            if (deductRes.rowsAffected[0] === 0) {
                throw new Error('رصيدك غير كافٍ لإتمام عملية الختم.');
            }

            // 2. ختم السلاح بعدد الأيام المتبقية
            await request.query(`
                UPDATE GameDB.dbo.T_UserItem 
                SET SealVal = @days, Status = 1, WeaponSlotNo = 0 
                WHERE SerialNo = @serial
            `);

            // 3. حذفه من جدول التجهيزات (لأنه أصبح مختوماً)
            await request.query(`
                DELETE FROM GameDB.dbo.T_CharacterEquip 
                WHERE ItemSerialNo = @serial AND UserNo = @uid
            `);

            await transaction.commit();

            res.json({ 
                status: 'success', 
                message: `تم ختم السلاح بنجاح للمدة المتبقية (${sealDays} أيام). تم خصم ${totalCost} GP.`,
                newBalance: item.CurrentGP - totalCost,
                sealedDays: sealDays // إرسال الأيام للواجهة إذا أردت عرضها
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