const { poolPromise, sql } = require('../config/db');
const { logAdminAction } = require('../utils/adminLogger'); // لتسجيل الحركات

// 1. عرض حقيبة لاعب معين (كشف الهاك)
exports.getPlayerInventory = async (req, res) => {
    const { userNo } = req.params;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT 
                    UI.SerialNo, 
                    UI.ItemId, 
                    I.ItemName, 
                    UI.Count, 
                    UI.StartDate, 
                    UI.EndDate, 
                    UI.Status,      -- 1=Equipped, 0=Deleted/Stored
                    UI.SealVal,     -- هل هو مختوم؟
                    UI.IsBaseItem,
                    CASE WHEN UI.EndDate < GETDATE() THEN 1 ELSE 0 END AS IsExpired
                FROM GameDB.dbo.T_UserItem UI
                LEFT JOIN GameDB.dbo.T_ItemInfo I ON UI.ItemId = I.ItemId
                WHERE UI.UserNo = @uid
                ORDER BY UI.EndDate DESC
            `);

        res.json({ status: 'success', inventory: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'فشل جلب الحقيبة' });
    }
};

// 2. حذف عنصر من لاعب (Delete Item)
exports.deleteItem = async (req, res) => {
    const { serialNo, reason } = req.body;
    const adminName = req.user.userId;
    const adminIP = req.ip;

    if (!serialNo || !reason) return res.status(400).json({ message: 'السبب مطلوب' });

    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // أ. جلب بيانات العنصر قبل الحذف (للتوثيق)
            const itemCheck = await request
                .input('serial', serialNo)
                .query(`
                    SELECT UI.UserNo, UI.ItemId, I.ItemName 
                    FROM GameDB.dbo.T_UserItem UI
                    LEFT JOIN GameDB.dbo.T_ItemInfo I ON UI.ItemId = I.ItemId
                    WHERE SerialNo = @serial
                `);

            if (itemCheck.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ message: 'العنصر غير موجود' });
            }

            const item = itemCheck.recordset[0];

            // ب. الحذف الفعلي
            await request.query(`DELETE FROM GameDB.dbo.T_UserItem WHERE SerialNo = @serial`);

            // ج. تسجيل العملية
            await logAdminAction(adminName, 'DELETE_ITEM', item.UserNo, `Deleted ${item.ItemName} (Serial: ${serialNo}). Reason: ${reason}`, adminIP);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم حذف العنصر بنجاح' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف' });
    }
};

// 3. تمديد/تعديل مدة سلاح (Edit Duration)
exports.extendItem = async (req, res) => {
    const { serialNo, extraDays, reason } = req.body; // extraDays يمكن أن يكون سالباً لإنقاص المدة
    const adminName = req.user.userId;

    try {
        const pool = await poolPromise;
        
        // جلب التاريخ الحالي للعنصر
        const itemRes = await pool.request().input('serial', serialNo).query("SELECT EndDate, UserNo, ItemId FROM GameDB.dbo.T_UserItem WHERE SerialNo = @serial");
        if (itemRes.recordset.length === 0) return res.status(404).json({ message: 'العنصر غير موجود' });
        
        const currentEndDate = new Date(itemRes.recordset[0].EndDate);
        
        // إضافة الأيام
        const newDate = new Date(currentEndDate);
        newDate.setDate(newDate.getDate() + parseInt(extraDays));

        await pool.request()
            .input('serial', serialNo)
            .input('newDate', newDate)
            .query("UPDATE GameDB.dbo.T_UserItem SET EndDate = @newDate WHERE SerialNo = @serial");

        // لوج
        await logAdminAction(adminName, 'EDIT_ITEM', itemRes.recordset[0].UserNo, `Changed duration by ${extraDays} days. Reason: ${reason}`, req.ip);

        res.json({ status: 'success', message: 'تم تعديل التاريخ', newEndDate: newDate });

    } catch (err) {
        res.status(500).json({ message: 'فشل التعديل' });
    }
};

// 4. إرسال هدية/تعويض (Give Item)
exports.giveItem = async (req, res) => {
    const { userNo, itemId, days, reason } = req.body;
    const adminName = req.user.userId;

    try {
        const pool = await poolPromise;

        // التحقق من صحة السلاح وجلب خصائصه (مهم جداً لتجنب الأسلحة المعطوبة)
        const itemInfo = await pool.request()
            .input('id', itemId)
            .query("SELECT * FROM GameDB.dbo.T_ItemInfo WHERE ItemId = @id");
        
        if (itemInfo.recordset.length === 0) return res.status(404).json({ message: 'رقم السلاح (ID) غير صحيح' });
        
        const info = itemInfo.recordset[0];

        // الإضافة المباشرة (تشبه الشراء لكن بدون خصم مال)
        await pool.request()
            .input('uid', userNo)
            .input('itemId', itemId)
            .input('days', days)
            .input('type', info.ItemType)
            .input('usetype', info.UseType)
            .input('slot', info.NeedSlot)
            .query(`
                INSERT INTO GameDB.dbo.T_UserItem 
                (
                    UserNo, ItemId, ItemType, UseType, IsBaseItem, IsGrenade, NeedSlot, 
                    Status, StartDate, EndDate, IsPcBangItem, RestrictLevel, 
                    SealVal, Durability, Count, CharacterNo, WeaponSlotNo, TargetSerialNo
                )
                VALUES 
                (
                    @uid, @itemId, @type, @usetype, 0, 0, @slot, 
                    1, GETDATE(), DATEADD(DAY, @days, GETDATE()), 0, 0, 
                    0, 1000, 1, 0, 0, 0
                )
            `);

        // لوج
        await logAdminAction(adminName, 'GIVE_ITEM', userNo, `Gave ItemID ${itemId} for ${days} days. Reason: ${reason}`, req.ip);

        res.json({ status: 'success', message: 'تم إرسال العنصر للاعب' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل الإرسال' });
    }
};