const { poolPromise, sql } = require('../config/db');

// المدد المسموح بها فقط (قاعدة صارمة)
const ALLOWED_DURATIONS = [0, 1, 7, 15, 30];

// 🧠 تحليل نوع العنصر تلقائياً (بناءً على طلبك الدقيق)
const analyzeItem = (item) => {
    let label = 'غير معروف';
    let category = 'ETC'; // تصنيف افتراضي

    const type = item.ItemType;

    // 0 = الأسلحة (رئيسي، ثانوي، قنابل)
    if (type === 0) {
        category = 'WEAPON';
        if (item.IsGrenade) {
            label = 'الأسلحة - القنابل';
        } else if (item.NeedSlot === 1) {
            label = 'الأسلحة - ثانوي';
        } else {
            label = 'الأسلحة - رئيسي';
        }
    } 
    // 1 = الأسلحة - الإضافات
    else if (type === 1) {
        category = 'WEAPON'; // أو GEAR حسب رغبتك في الفلترة
        label = 'الأسلحة - الإظافات';
    }
    // 2 = العتاد - خوذة / الأدوات - تعزيزات
    else if (type === 2) {
        category = 'GEAR';
        // محاولة التمييز: عادة التعزيزات ليس لها RestrictLevel أو لها UseType مختلف
        // لكن للتبسيط سندمجهم في وصف واحد أو نعتبرها خوذة كافتراضي
        label = 'العتاد - خودة / تعزيزات';
    }
    // 3 = العتاد - درع جسد
    else if (type === 3) {
        category = 'GEAR';
        label = 'العتاد - درع جسد';
    }
    // 4 = العتاد - الكل
    else if (type === 4) {
        category = 'GEAR';
        label = 'العتاد - الكل';
    }
    // 6 = المعدات - الإكسسوارات
    else if (type === 6) {
        category = 'ACCESSORY';
        label = 'المعدات - الإكسسوارات';
    }
    // 11 = العتاد - الأبطال
    else if (type === 11) {
        category = 'CHARACTER';
        label = 'العتاد - الأبطال';
    }
    // 12 = المعدات - المؤشرات
    else if (type === 12) {
        category = 'ACCESSORY';
        label = 'المعدات - المؤشرات';
    }
    // 13 = الأسلحة - سلاح أبيض
    else if (type === 13) {
        category = 'WEAPON';
        label = 'الأسلحة - سلاح أبيض';
    }

    return { label, category };
};

// 1. البحث عن عنصر في ملفات اللعبة (T_ItemInfo)
exports.searchItems = async (req, res) => {
    const { query } = req.query;
    if (!query || query.length < 2) return res.status(400).json({ message: 'اكتب حرفين للبحث' });

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('s', `%${query}%`)
            .query(`
                SELECT TOP 20 ItemId, ItemName, ItemType, IsGrenade, NeedSlot, RestrictLevel
                FROM GameDB.dbo.T_ItemInfo 
                WHERE ItemName LIKE @s 
                ORDER BY ItemName
            `);

        const items = result.recordset.map(item => {
            const analysis = analyzeItem(item);
            return {
                ...item,
                TypeLabel: analysis.label,   // التصنيف الدقيق للعرض
                AutoCategory: analysis.category // التصنيف العام للفلترة
            };
        });

        res.json({ status: 'success', items });
    } catch (err) { res.status(500).json({ message: 'فشل البحث' }); }
};

// 2. إضافة عنصر للمتجر (مع التحقق من المدة)
// 2. إضافة عنصر للمتجر (مصحح: يضيف اسم العنصر لتجنب خطأ NULL)
exports.addItemToShop = async (req, res) => {
    const { itemId, price, duration, isHot, isNew } = req.body;

    // التحقق من المدة الصارمة
    if (!ALLOWED_DURATIONS.includes(parseInt(duration))) {
        return res.status(400).json({ message: 'المدة غير مسموحة! اختر فقط: 0 (دائم)، 1، 7، 15، أو 30 يوم.' });
    }

    try {
        const pool = await poolPromise;
        
        // 1. جلب المعلومات (أضفنا ItemName هنا) 👇
        const itemCheck = await pool.request()
            .input('id', itemId)
            .query("SELECT ItemName, ItemType, IsGrenade, NeedSlot, RestrictLevel FROM GameDB.dbo.T_ItemInfo WHERE ItemId = @id");
        
        if (itemCheck.recordset.length === 0) return res.status(404).json({ message: 'العنصر غير موجود في ملفات اللعبة' });
        
        const itemInfo = itemCheck.recordset[0];
        const analysis = analyzeItem(itemInfo);

        // 2. الإدخال مع اسم العنصر
        await pool.request()
            .input('id', itemId)
            .input('name', itemInfo.ItemName) // 👈 إرسال الاسم
            .input('price', price)
            .input('days', duration)
            .input('cat', analysis.category)
            .input('hot', isHot ? 1 : 0)
            .input('new', isNew ? 1 : 0)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_Shop 
                (ItemID, ItemName, PriceGP, Duration, Category, IsHot, IsNew, IsActive)
                VALUES (@id, @name, @price, @days, @cat, @hot, @new, 1)
            `);

        res.json({ status: 'success', message: 'تمت الإضافة بنجاح' });

    } catch (err) { 
        console.error("Shop Add Error:", err);
        res.status(500).json({ message: 'فشل الإضافة', error: err.message }); 
    }
};

// 3. تعديل عنصر (السعر/المدة/الحالة)
exports.updateShopItem = async (req, res) => {
    const { shopId, price, duration, isHot, isNew } = req.body;

    if (duration !== undefined && !ALLOWED_DURATIONS.includes(parseInt(duration))) {
        return res.status(400).json({ message: 'المدة غير مسموحة!' });
    }
    
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('sid', shopId)
            .input('price', price)
            .input('days', duration)
            .input('hot', isHot ? 1 : 0)
            .input('new', isNew ? 1 : 0)
            .query(`
                UPDATE AdrenalineWeb.dbo.Web_Shop 
                SET PriceGP = @price, Duration = @days, IsHot = @hot, IsNew = @new
                WHERE ShopID = @sid
            `);
            
        res.json({ status: 'success', message: 'تم التعديل' });
    } catch (err) { res.status(500).json({ message: 'فشل التعديل' }); }
};

// 4. حذف (إخفاء)
// 4. حذف عنصر من المتجر نهائياً (Hard Delete)
exports.removeShopItem = async (req, res) => { // لاحظ تغيير الاسم ليتطابق مع الروابط
    const { shopId } = req.params;
    const adminId = req.user.userId; // نحتاج هذا للتسجيل

    try {
        const pool = await poolPromise;

        // 1. نجلب اسم العنصر أولاً (لأجل السجل - Log)
        const check = await pool.request()
            .input('sid', shopId)
            .query("SELECT ItemName, ItemID FROM AdrenalineWeb.dbo.Web_Shop WHERE ShopID = @sid");

        if (check.recordset.length === 0) {
            return res.status(404).json({ message: 'العنصر غير موجود' });
        }

        const { ItemName, ItemID } = check.recordset[0];

        // 2. الحذف النهائي من الجدول
        await pool.request()
            .input('sid', shopId)
            .query("DELETE FROM AdrenalineWeb.dbo.Web_Shop WHERE ShopID = @sid");

        // 3. تسجيل العملية (اختياري لكن مفضل)
        try {
            await pool.request()
                .input('admin', adminId)
                .input('action', 'SHOP_REMOVE')
                .input('details', `Deleted ${ItemName} (ID: ${ItemID})`)
                .query("INSERT INTO AdrenalineWeb.dbo.Web_AdminLog (AdminID, Action, Details) VALUES (@admin, @action, @details)");
        } catch (e) { console.log('Log Error ignored'); }

        res.json({ status: 'success', message: 'تم حذف العنصر نهائياً' });

    } catch (err) { 
        console.error(err);
        res.status(500).json({ message: 'فشل الحذف' }); 
    }
};

// 5. عرض قائمة المتجر للأدمن (مع JOIN لجلب الأسماء)
exports.getShopList = async (req, res) => {
    try {
        const pool = await poolPromise;
        // نجلب الاسم ونوع العنصر من جدول اللعبة الأصلي
        const result = await pool.request().query(`
            SELECT 
                S.ShopID, S.ItemID, S.PriceGP, S.Duration, S.Category, S.IsHot, S.IsNew,
                I.ItemName, I.ItemType, I.IsGrenade, I.NeedSlot,
                CAST(I.ItemId AS VARCHAR) + '.png' AS ImageURL
            FROM AdrenalineWeb.dbo.Web_Shop S
            INNER JOIN GameDB.dbo.T_ItemInfo I ON S.ItemID = I.ItemId
            WHERE S.IsActive = 1
            ORDER BY S.ShopID DESC
        `);

        // إضافة التسمية العربية عند العرض
        const items = result.recordset.map(item => {
            const analysis = analyzeItem(item);
            return {
                ...item,
                TypeLabel: analysis.label // هذا ما سيظهر في جدول الأدمن
            };
        });

        res.json({ status: 'success', items });
    } catch (err) { res.status(500).json({ message: 'فشل العرض' }); }
};