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

        // 🛡️ أمان 1: التحقق من سعة الحقيبة
        // (لمنع تعليق الحساب أو ضياع العنصر إذا كانت الحقيبة ممتلئة)
        const inventoryCheck = await pool.request()
            .input('uid', sql.Int, userNo)
            .query('SELECT COUNT(*) as cnt FROM GameDB.dbo.T_UserItem WHERE UserNo = @uid');
        
        if (inventoryCheck.recordset[0].cnt >= 240) {
            return res.status(400).json({ message: 'الحقيبة ممتلئة! يرجى حذف بعض العناصر أولاً.' });
        }

        // 🔍 2. جلب البيانات (دمج السعر من الموقع مع خصائص اللعبة الأصلية)
        const itemQuery = await pool.request()
            .input('sid', sql.Int, shopId)
            .query(`
                SELECT 
                    S.PriceGP, S.Duration, 
                    I.ItemId, I.ItemName, I.ItemType, I.UseType, I.IsBaseItem, 
                    I.IsGrenade, I.NeedSlot, I.RestrictLevel, I.IsPcBangItem
                FROM AdrenalineWeb.dbo.Web_Shop S
                JOIN GameDB.dbo.T_ItemInfo I ON S.ItemID = I.ItemId
                WHERE S.ShopID = @sid AND S.IsActive = 1
            `);

        const itemData = itemQuery.recordset[0];

        if (!itemData) {
            return res.status(404).json({ message: 'العنصر غير متاح حالياً' });
        }

        // 🛡️ أمان 2: استخدام الترانزاكشن (الكل أو لا شيء)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            request.input('uid', sql.Int, userNo);
            request.input('price', sql.Int, itemData.PriceGP);

            // 🔥 أمان 3: الخصم الذري (Atomic Deduction)
            // هذا هو أهم سطر للأمان! نضع شرط الرصيد داخل جملة التحديث نفسها
            const deductResult = await request.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - @price 
                WHERE UserNo = @uid AND CashMoney >= @price
            `);

            // إذا لم يتأثر أي صف، فهذا يعني أن الرصيد لم يكن كافياً لحظة التنفيذ
            if (deductResult.rowsAffected[0] === 0) {
                throw new Error('رصيدك غير كافٍ لإتمام العملية');
            }

            // إعداد متغيرات الإضافة (من T_ItemInfo الموثوقة)
            request.input('days', sql.Int, itemData.Duration);
            request.input('itemId', sql.Int, itemData.ItemId);
            request.input('type', sql.Int, itemData.ItemType);
            request.input('usetype', sql.Int, itemData.UseType);
            request.input('base', sql.Bit, itemData.IsBaseItem);
            request.input('grenade', sql.Bit, itemData.IsGrenade);
            request.input('slot', sql.Int, itemData.NeedSlot);
            request.input('level', sql.Int, itemData.RestrictLevel);
            request.input('pcbang', sql.Bit, itemData.IsPcBangItem);
            
            // ثوابت النظام
            request.input('seal', sql.Int, 1);     // 1 = مختوم (لأن الدفع كاش)
            request.input('durability', sql.Int, 1000); 

            // 3. إضافة السلاح (مطابق تماماً لجدول GameDB)
            await request.query(`
                INSERT INTO GameDB.dbo.T_UserItem 
                (
                    UserNo, ItemId, ItemType, UseType, IsBaseItem, IsGrenade, NeedSlot, 
                    Status, StartDate, EndDate, IsPcBangItem, RestrictLevel, 
                    SealVal, Durability, Count, CharacterNo, WeaponSlotNo, TargetSerialNo
                )
                VALUES 
                (
                    @uid, @itemId, @type, @usetype, @base, @grenade, @slot, 
                    1, GETDATE(), DATEADD(DAY, @days, GETDATE()), @pcbang, @level, 
                    @seal, @durability, 1, 0, 0, 0
                )
            `);

            await transaction.commit();

            res.json({
                status: 'success',
                message: `تم شراء ${itemData.ItemName} بنجاح!`,
            });

        } catch (err) {
            await transaction.rollback();
            // إعادة رسالة خطأ واضحة للمستخدم
            const msg = err.message === 'رصيدك غير كافٍ لإتمام العملية' ? err.message : 'فشلت عملية الشراء';
            if (msg !== err.message) console.error('Buy Error:', err); // نسجل الخطأ التقني في الكونسول فقط
            res.status(400).json({ message: msg });
        }

    } catch (err) {
        console.error('Controller Error:', err);
        res.status(500).json({ message: 'خطأ في السيرفر' });
    }
};