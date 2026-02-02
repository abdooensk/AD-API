const { poolPromise, sql } = require('../config/db');

// دالة مساعدة لترجمة نوع العنصر (المترجم الذكي 🧠)
const getItemTypeLabel = (item) => {
    const type = item.ItemType;
    
    // 0: أسلحة (رئيسي، ثانوي، قنابل)
    if (type === 0) {
        if (item.IsGrenade) return 'قنبلة 💣';
        if (item.NeedSlot === 0) return 'سلاح رئيسي 🔫'; // افتراض بناءً على الشائع
        if (item.NeedSlot === 1) return 'سلاح ثانوي 🔫';
        return 'سلاح';
    }

    if (type === 1) return 'إضافات سلاح 🔧';
    if (type === 2) return 'خوذة / تعزيزات ⛑️';
    if (type === 3) return 'درع جسد 🛡️';
    if (type === 4) return 'عتاد عام 🎒';
    if (type === 6) return 'إكسسوارات 💍';
    if (type === 11) return 'أبطال 🦸';
    if (type === 12) return 'مؤشرات 🎯';
    if (type === 13) return 'سلاح أبيض 🔪';

    return 'غير معروف ❓';
};

// 1. البحث عن عنصر بالاسم (مع التصنيف الجديد)
exports.searchItems = async (req, res) => {
    const { query } = req.query;

    if (!query || query.length < 2) {
        return res.status(400).json({ message: 'اكتب حرفين على الأقل للبحث' });
    }

    try {
        const pool = await poolPromise;
        
        // جلبنا أعمدة إضافية (NeedSlot, IsGrenade) لنتمكن من التصنيف
        const result = await pool.request()
            .input('search', `%${query}%`)
            .query(`
                SELECT TOP 20 
                    ItemId, 
                    ItemName, 
                    ItemType, 
                    IsBaseItem,
                    IsGrenade,
                    NeedSlot,
                    CAST(ItemId AS VARCHAR) + '.png' AS ImageName
                FROM GameDB.dbo.T_ItemInfo 
                WHERE ItemName LIKE @search
                ORDER BY ItemName ASC
            `);

        // معالجة النتائج لإضافة الاسم العربي للننوع
        const itemsWithLabels = result.recordset.map(item => ({
            ...item,
            TypeLabel: getItemTypeLabel(item) // 👈 هنا السحر
        }));

        res.json({ status: 'success', items: itemsWithLabels });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل البحث' });
    }
};

// 2. إضافة العنصر المختار للمتجر
exports.addItemToShop = async (req, res) => {
    const { itemId, price, duration, category, isHot, isNew } = req.body;

    if (!itemId || !price || !duration) {
        return res.status(400).json({ message: 'البيانات ناقصة (السعر، المدة، العنصر)' });
    }

    try {
        const pool = await poolPromise;

        // التحقق من وجود العنصر
        const checkItem = await pool.request().input('id', itemId).query("SELECT ItemName FROM GameDB.dbo.T_ItemInfo WHERE ItemId = @id");
        if (checkItem.recordset.length === 0) return res.status(404).json({ message: 'العنصر غير موجود!' });

        const itemName = checkItem.recordset[0].ItemName;
        const imageUrl = `${itemId}.png`;

        await pool.request()
            .input('id', itemId)
            .input('name', itemName)
            .input('price', price)
            .input('days', duration)
            .input('cat', category || 'WEAPON') // يمكن تحسين هذا ليعتمد على TypeLabel مستقبلاً
            .input('img', imageUrl)
            .input('hot', isHot || 0)
            .input('new', isNew || 0)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_Shop 
                (ItemID, ItemName, PriceGP, Duration, Category, ImageURL, IsHot, IsNew, IsActive)
                VALUES (@id, @name, @price, @days, @cat, @img, @hot, @new, 1)
            `);

        res.json({ status: 'success', message: `تم إضافة ${itemName} للمتجر` });

    } catch (err) {
        res.status(500).json({ message: 'فشل الإضافة' });
    }
};

// 3. عرض المتجر الحالي
exports.getShopList = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT ShopID, ItemID, ItemName, PriceGP, Duration, Category, ImageURL, IsHot, IsNew 
            FROM AdrenalineWeb.dbo.Web_Shop 
            WHERE IsActive = 1
            ORDER BY ShopID DESC
        `);
        res.json({ status: 'success', items: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب المتجر' });
    }
};

// 4. حذف من المتجر
exports.removeFromShop = async (req, res) => {
    const { shopId } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('sid', shopId).query("UPDATE AdrenalineWeb.dbo.Web_Shop SET IsActive = 0 WHERE ShopID = @sid");
        res.json({ status: 'success', message: 'تم الحذف' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف' });
    }
};