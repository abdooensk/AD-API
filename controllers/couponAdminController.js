const { poolPromise, sql } = require('../config/db');
const fs = require('fs'); // 👈 إضافة مهمة لحذف الصور عند الخطأ

// دالة مساعدة لتوليد حروف عشوائية
const generateSegment = (length) => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// =========================================================
// 🆕 1. إنشاء قسيمة مميزة (صورة + سعر + 9 عناصر)
// =========================================================
exports.createPremiumCoupon = async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ message: 'يجب رفع صورة للقسيمة!' });
    
    const imageUrl = `/uploads/coupons/${file.filename}`;

    // 👇 نستقبل الآن publicFee من البيانات
    const { title, price, publicFee, description, items } = req.body;

    if (!title || !price) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ message: 'العنوان والسعر مطلوبان' });
    }

    let parsedItems = [];
    try {
        parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    } catch (e) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ message: 'تنسيق العناصر غير صحيح' });
    }

    const slots = Array(9).fill({ id: 0, days: 0 });
    if (Array.isArray(parsedItems)) {
        parsedItems.slice(0, 9).forEach((item, index) => {
            slots[index] = { id: parseInt(item.id) || 0, days: parseInt(item.days) || 0 };
        });
    }

    // تحديد قيمة الرسوم (إذا لم ترسل نعتبرها 0)
    const fee = publicFee ? parseInt(publicFee) : 0;

    try {
        const pool = await poolPromise;
        
        await pool.request()
            .input('title', title)
            .input('price', price)
            .input('fee', fee) // 👈 إدخال الرسوم
            .input('img', imageUrl)
            .input('desc', description || '')
            
            // العناصر الـ 9
            .input('i1', slots[0].id).input('d1', slots[0].days)
            .input('i2', slots[1].id).input('d2', slots[1].days)
            .input('i3', slots[2].id).input('d3', slots[2].days)
            .input('i4', slots[3].id).input('d4', slots[3].days)
            .input('i5', slots[4].id).input('d5', slots[4].days)
            .input('i6', slots[5].id).input('d6', slots[5].days)
            .input('i7', slots[6].id).input('d7', slots[6].days)
            .input('i8', slots[7].id).input('d8', slots[7].days)
            .input('i9', slots[8].id).input('d9', slots[8].days)

            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_PremiumCoupons
                (
                    Title, PriceGP, PublicFeeGP, ImageURL, Description, -- 👈 أضفنا PublicFeeGP هنا
                    ItemId1, ItemDays1, ItemId2, ItemDays2, ItemId3, ItemDays3,
                    ItemId4, ItemDays4, ItemId5, ItemDays5, ItemId6, ItemDays6,
                    ItemId7, ItemDays7, ItemId8, ItemDays8, ItemId9, ItemDays9, IsActive
                )
                VALUES
                (
                    @title, @price, @fee, @img, @desc, -- 👈 وأضفنا المتغير @fee هنا
                    @i1, @d1, @i2, @d2, @i3, @d3,
                    @i4, @d4, @i5, @d5, @i6, @d6,
                    @i7, @d7, @i8, @d8, @i9, @d9, 1
                )
            `);

        res.json({ status: 'success', message: 'تم إنشاء القسيمة المميزة بنجاح', imageUrl });

    } catch (err) {
        console.error(err);
        if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        res.status(500).json({ message: 'فشل إنشاء القسيمة', error: err.message });
    }
};

// =========================================================
// 2. عرض القسائم المميزة (للأدمن)
// =========================================================
exports.getPremiumCoupons = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query("SELECT * FROM AdrenalineWeb.dbo.Web_PremiumCoupons ORDER BY CouponID DESC");
        res.json({ status: 'success', coupons: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'فشل جلب البيانات' });
    }
};

// =========================================================
// 3. حذف قسيمة مميزة
// =========================================================
exports.deletePremiumCoupon = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('id', id).query("UPDATE AdrenalineWeb.dbo.Web_PremiumCoupons SET IsActive = 0 WHERE CouponID = @id");
        res.json({ status: 'success', message: 'تم حذف القسيمة' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف' });
    }
};

// =========================================================
// 4. إنشاء "قسيمة هدية" (الكود القديم - Promo Code)
// =========================================================
exports.createGiftCoupon = async (req, res) => {
    const { customCode, expireDays, items, gameMoney } = req.body; 

    try {
        const pool = await poolPromise;
        
        let serialKey = customCode;
        if (!serialKey) {
            serialKey = `${generateSegment(6)}-${generateSegment(6)}-${generateSegment(4)}`;
        }
        serialKey = serialKey.toUpperCase();

        const dbItems = [];
        for (let i = 0; i < 9; i++) {
            if (items && items[i] && items[i].id > 0) {
                dbItems[i] = { id: items[i].id, days: items[i].days };
            } else {
                dbItems[i] = { id: 'NULL', days: 'NULL' };
            }
        }

        const money = gameMoney || 0;

        await pool.request().query(`
            INSERT INTO GameDB.dbo.T_ItemSerialKey 
            (
                SerialKey, TargetUserNo, OneTimeKey, RegDate, ExpireDate, SupplyGameMoney,
                SupplyItemId1, SupplyItemDays1, SupplyItemId2, SupplyItemDays2, SupplyItemId3, SupplyItemDays3,
                SupplyItemId4, SupplyItemDays4, SupplyItemId5, SupplyItemDays5, SupplyItemId6, SupplyItemDays6,
                SupplyItemId7, SupplyItemDays7, SupplyItemId8, SupplyItemDays8, SupplyItemId9, SupplyItemDays9
            )
            VALUES 
            (
                '${serialKey}', NULL, 0, GETDATE(), DATEADD(DAY, ${expireDays || 365}, GETDATE()), ${money},
                ${dbItems[0].id}, ${dbItems[0].days}, ${dbItems[1].id}, ${dbItems[1].days}, ${dbItems[2].id}, ${dbItems[2].days},
                ${dbItems[3].id}, ${dbItems[3].days}, ${dbItems[4].id}, ${dbItems[4].days}, ${dbItems[5].id}, ${dbItems[5].days},
                ${dbItems[6].id}, ${dbItems[6].days}, ${dbItems[7].id}, ${dbItems[7].days}, ${dbItems[8].id}, ${dbItems[8].days}
            )
        `);

        res.json({ status: 'success', message: `تم إنشاء كود الهدية: ${serialKey}`, code: serialKey });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل إنشاء الهدية', error: err.message });
    }
};