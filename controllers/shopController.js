const { poolPromise, sql } = require('../config/db');

// 1. عرض عناصر المتجر (لم يتغير)
exports.getShopItems = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query(`
                SELECT ShopID, ItemName, PriceGP, Duration, Count, Category, ImageURL 
                FROM AdrenalineWeb.dbo.Web_Shop 
                WHERE IsActive = 1
            `);

        res.json({ status: 'success', items: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب المتجر', error: err.message });
    }
};

// 2. شراء عنصر (الكود الجديد بناءً على sp_BuyItem)
exports.buyItem = async (req, res) => {
    const { shopId } = req.body;
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. الخطوة الأولى: دمج معلومات المتجر (للسعر) مع معلومات اللعبة (للمواصفات التقنية)
        // هذا الاستعلام "الذكي" يجلب كل ما نحتاجه في ضربة واحدة
        const itemQuery = await pool.request()
            .input('sid', shopId)
            .query(`
                SELECT 
                    -- بيانات من المتجر (السعر والمدة)
                    W.PriceGP, 
                    W.Duration, 
                    W.ItemID, 
                    W.Count, 
                    W.ItemName,
                    
                    -- بيانات تقنية حساسة من ملفات اللعبة (T_ItemInfo)
                    I.ItemType,
                    I.IsBaseItem,
                    I.IsGrenade,
                    I.NeedSlot,
                    I.RestrictLevel,
                    I.UseType,
                    I.IsPcBangItem
                FROM AdrenalineWeb.dbo.Web_Shop W
                JOIN GameDB.dbo.T_ItemInfo I ON W.ItemID = I.ItemId
                WHERE W.ShopID = @sid AND W.IsActive = 1
            `);

        const shopItem = itemQuery.recordset[0];

        // التحقق من وجود العنصر
        if (!shopItem) {
            return res.status(404).json({ message: 'العنصر غير موجود أو خطأ في تعريف T_ItemInfo' });
        }

        // ب. التحقق من رصيد اللاعب
        const userCheck = await pool.request()
            .input('uid', userNo)
            .query('SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid');
            
        const currentGP = userCheck.recordset[0].CashMoney;

        if (currentGP < shopItem.PriceGP) {
            return res.status(400).json({ 
                message: `رصيدك غير كافٍ. تحتاج ${shopItem.PriceGP} GP وأنت تملك ${currentGP} GP` 
            });
        }

        // ج. تنفيذ العملية (Transaction)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // 1. خصم الرصيد
            await request.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - ${shopItem.PriceGP} 
                WHERE UserNo = ${userNo}
            `);

            // 2. إضافة السلاح بدقة عالية (مطابقة لـ sp_BuyItem)
            // نستخدم ISNULL لضمان عدم حدوث خطأ إذا كانت بعض القيم فارغة في الداتابيز
            const insertQuery = `
                INSERT INTO GameDB.dbo.T_UserItem 
                (
                    UserNo, ItemId, ItemType, IsBaseItem, Count, Status, 
                    StartDate, EndDate, IsGrenade, NeedSlot, IsPcBangItem, 
                    RestrictLevel, UseType, SealVal
                )
                VALUES 
                (
                    ${userNo}, 
                    ${shopItem.ItemID}, 
                    ${shopItem.ItemType || 0},      -- ItemType من اللعبة
                    ${shopItem.IsBaseItem ? 1 : 0}, -- هل هو أساسي؟
                    ${shopItem.Count}, 
                    1,                              -- Status: 1 (موجود في الحقيبة غير مجهز)
                    GETDATE(), 
                    DATEADD(DAY, ${shopItem.Duration}, GETDATE()), -- تاريخ الانتهاء
                    ${shopItem.IsGrenade ? 1 : 0},  -- هل هو قنبلة؟
                    ${shopItem.NeedSlot || 0},      -- هل يحتاج خانة؟
                    ${shopItem.IsPcBangItem ? 1 : 0}, 
                    ${shopItem.RestrictLevel || 0}, -- اللفل المطلوب
                    ${shopItem.UseType || 0},       -- نوع الاستخدام
                    0                               -- SealVal: 0 (جاهز للاستخدام فوراً)
                )
            `;
            
            await request.query(insertQuery);

            await transaction.commit(); // اعتماد العملية

            res.json({
                status: 'success',
                message: `تم شراء ${shopItem.ItemName} بنجاح!`,
                newBalance: currentGP - shopItem.PriceGP
            });

        } catch (err) {
            await transaction.rollback(); // إلغاء كل شيء في حال الخطأ
            throw err;
        }

    } catch (err) {
        console.error('Shop Purchase Error:', err);
        res.status(500).json({ message: 'فشلت عملية الشراء', error: err.message });
    }
};