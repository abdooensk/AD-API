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

        // 🛡️ أمان 1: فحص سعة الحقيبة قبل البدء (لتجنب ضياع السلاح أو تعليق اللعبة)
        const inventoryCheck = await pool.request()
            .input('uid', sql.Int, userNo)
            .query('SELECT COUNT(*) as cnt FROM GameDB.dbo.T_UserItem WHERE UserNo = @uid');
        
        // الرقم 240 هو الحد الأقصى الشائع، يمكنك تعديله حسب إعدادات اللعبة
        if (inventoryCheck.recordset[0].cnt >= 240) {
            return res.status(400).json({ message: 'الحقيبة ممتلئة! يرجى حذف بعض العناصر أولاً.' });
        }

        // أ. الخطوة الأولى: دمج معلومات المتجر واللعبة (نفس الاستعلام الأصلي)
        const itemQuery = await pool.request()
            .input('sid', sql.Int, shopId) // 🛡️ استخدام input
            .query(`
                SELECT 
                    W.PriceGP, W.Duration, W.ItemID, W.Count, W.ItemName,
                    I.ItemType, I.IsBaseItem, I.IsGrenade, I.NeedSlot, 
                    I.RestrictLevel, I.UseType, I.IsPcBangItem
                FROM AdrenalineWeb.dbo.Web_Shop W
                JOIN GameDB.dbo.T_ItemInfo I ON W.ItemID = I.ItemId
                WHERE W.ShopID = @sid AND W.IsActive = 1
            `);

        const shopItem = itemQuery.recordset[0];

        if (!shopItem) {
            return res.status(404).json({ message: 'العنصر غير موجود أو خطأ في تعريف T_ItemInfo' });
        }

        // ب. التحقق المبدئي من الرصيد (للعرض فقط - الأمان الحقيقي في الـ Transaction)
        const userCheck = await pool.request()
            .input('uid', sql.Int, userNo)
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

            // 🛡️ أمان 2: تعريف جميع المتغيرات كـ Parameters لمنع الحقن (SQL Injection)
            request.input('uid', sql.Int, userNo);
            request.input('price', sql.Int, shopItem.PriceGP);
            
            // متغيرات الإدخال (نضمن القيم الافتراضية هنا أيضاً)
            request.input('itemId', sql.Int, shopItem.ItemID);
            request.input('type', sql.Int, shopItem.ItemType || 0);
            request.input('base', sql.TinyInt, shopItem.IsBaseItem ? 1 : 0);
            request.input('count', sql.Int, shopItem.Count);
            request.input('days', sql.Int, shopItem.Duration);
            request.input('grenade', sql.TinyInt, shopItem.IsGrenade ? 1 : 0);
            request.input('slot', sql.Int, shopItem.NeedSlot || 0);
            request.input('pcbang', sql.TinyInt, shopItem.IsPcBangItem ? 1 : 0);
            request.input('level', sql.Int, shopItem.RestrictLevel || 0);
            request.input('usetype', sql.Int, shopItem.UseType || 0);

            // 1. خصم الرصيد (Atomic Update 🛡️)
            // أضفنا شرط AND CashMoney >= @price لمنع Race Condition
            const deductResult = await request.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - @price 
                WHERE UserNo = @uid AND CashMoney >= @price
            `);

            // إذا لم يتم تحديث أي صف، فهذا يعني أن الرصيد تغير فجأة (أقل من المطلوب)
            if (deductResult.rowsAffected[0] === 0) {
                throw new Error('فشلت العملية: الرصيد غير كافٍ (قد يكون تم استخدامه في جلسة أخرى)');
            }

            // 2. إضافة السلاح (باستخدام @parameters بدلاً من ${})
            const insertQuery = `
                INSERT INTO GameDB.dbo.T_UserItem 
                (
                    UserNo, ItemId, ItemType, IsBaseItem, Count, Status, 
                    StartDate, EndDate, IsGrenade, NeedSlot, IsPcBangItem, 
                    RestrictLevel, UseType, SealVal
                )
                VALUES 
                (
                    @uid, 
                    @itemId, 
                    @type, 
                    @base, 
                    @count, 
                    1, 
                    GETDATE(), 
                    DATEADD(DAY, @days, GETDATE()), 
                    @grenade, 
                    @slot, 
                    @pcbang, 
                    @level, 
                    @usetype, 
                    0
                )
            `;
            
            await request.query(insertQuery);

            await transaction.commit();

            res.json({
                status: 'success',
                message: `تم شراء ${shopItem.ItemName} بنجاح!`,
                newBalance: currentGP - shopItem.PriceGP
            });

        } catch (err) {
            await transaction.rollback();
            // نعيد رمي الخطأ ليتم اصطياده في الـ catch الخارجي
            throw err;
        }

    } catch (err) {
        console.error('Shop Purchase Error:', err);
        // نرسل رسالة الخطأ المحددة إذا كانت من الـ Atomic Check
        const msg = err.message.includes('الرصيد غير كافٍ') ? err.message : 'فشلت عملية الشراء';
        res.status(500).json({ message: msg, error: err.message });
    }
};