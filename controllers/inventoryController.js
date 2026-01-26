const { poolPromise, sql } = require('../config/db');

// 1. عرض المخزن (العناصر غير الأساسية فقط)
exports.getMyInventory = async (req, res) => {
    try {
        const pool = await poolPromise;
        const userNo = req.user.userNo;

        const result = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT 
                    UI.SerialNo,
                    UI.ItemId,
                    UI.Count,
                    UI.SealVal,
                    UI.Durability,
                    UI.Status, -- 1 = In Inventory, 2 = Equipped
                    UI.EndDate,
                    I.ItemName,
                    I.ItemType,
                    I.ImageURL,
                    
                    -- حساب الأيام المتبقية للعرض
                    CASE 
                        WHEN UI.EndDate > GETDATE() THEN DATEDIFF(DAY, GETDATE(), UI.EndDate)
                        ELSE 0 
                    END AS DaysLeft,

                    -- تحديد ما إذا كان منتهي الصلاحية
                    CASE 
                        WHEN UI.EndDate < GETDATE() THEN 1 
                        ELSE 0 
                    END AS IsExpired

                FROM GameDB.dbo.T_UserItem UI
                LEFT JOIN GameDB.dbo.T_ItemInfo I ON UI.ItemId = I.ItemId
                WHERE UI.UserNo = @uid 
                  AND UI.Status != 0      -- ليس محذوفاً
                  AND UI.IsBaseItem = 0   -- 👈 شرط أساسي: إخفاء العناصر الأساسية
                ORDER BY UI.EndDate DESC
            `);

        res.json({
            status: 'success',
            inventory: result.recordset
        });

    } catch (err) {
        console.error('Inventory Error:', err);
        res.status(500).json({ message: 'خطأ في جلب بيانات المخزن', error: err.message });
    }
};

// 2. ختم السلاح (مع الدفع + إلغاء التجهيز الإجباري)
exports.sealItem = async (req, res) => {
    const { serialNo } = req.body;
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. جلب تكلفة الختم من إعدادات الموقع
        // ملاحظة: تأكد من وجود مفتاح 'SealCost' في جدول Web_Settings، أو سيستخدم 1000 كقيمة افتراضية
        const settingsResult = await pool.request()
            .query(`SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'SealCost'`);
        
        const sealCost = settingsResult.recordset.length > 0 
            ? parseInt(settingsResult.recordset[0].ConfigValue) 
            : 1000; 

        // ب. التحقق من السلاح ورصيد اللاعب
        const checkResult = await pool.request()
            .input('serial', serialNo)
            .input('uid', userNo)
            .query(`
                SELECT 
                    UI.SealVal, 
                    UI.IsBaseItem, 
                    UI.Status,
                    U.CashMoney AS CurrentGP 
                FROM GameDB.dbo.T_UserItem UI
                JOIN GameDB.dbo.T_User U ON UI.UserNo = U.UserNo
                WHERE UI.SerialNo = @serial AND UI.UserNo = @uid
            `);

        const item = checkResult.recordset[0];

        // التحققات المنطقية
        if (!item) return res.status(404).json({ message: 'العنصر غير موجود أو لا تملكه' });
        if (item.IsBaseItem) return res.status(400).json({ message: 'لا يمكن ختم العناصر الأساسية' });
        if (item.SealVal !== 0) return res.status(400).json({ message: 'هذا السلاح مختوم بالفعل' });
        
        // التحقق من الرصيد
        if (item.CurrentGP < sealCost) {
            return res.status(400).json({ message: `رصيدك غير كافٍ. تكلفة الختم: ${sealCost} GP` });
        }

        // ج. تنفيذ العملية (Transaction) - لضمان سلامة البيانات
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // 1. خصم تكلفة الختم من اللاعب
            await request.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - ${sealCost} 
                WHERE UserNo = ${userNo}
            `);

            // 2. ختم السلاح + إعادته للمخزن (Status = 1) + تصفير خانة السلاح (WeaponSlotNo = 0)
            // هذا يضمن أنه لو كان مجهزاً، سيتحول لحالة "غير مجهز" في خصائص العنصر نفسه
            await request.query(`
                UPDATE GameDB.dbo.T_UserItem 
                SET SealVal = 1, 
                    Status = 1, 
                    WeaponSlotNo = 0 
                WHERE SerialNo = ${serialNo}
            `);

            // 3. 👈 الخطوة الحاسمة: حذفه من جدول التجهيزات (T_CharacterEquip)
            // هذا الجدول هو الذي يخبر السيرفر "ماذا يرتدي اللاعب الآن؟"
            // إذا لم نحذف الصف من هنا، سيظل السلاح يظهر في يد اللاعب داخل اللعبة
            await request.query(`
                DELETE FROM GameDB.dbo.T_CharacterEquip 
                WHERE ItemSerialNo = ${serialNo} AND UserNo = ${userNo}
            `);

            // اعتماد التغييرات
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