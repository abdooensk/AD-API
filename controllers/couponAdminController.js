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
        
        // تجهيز السيريال
        let serialKey = customCode;
        if (!serialKey) {
            serialKey = `${generateSegment(6)}-${generateSegment(6)}-${generateSegment(4)}`;
        }
        serialKey = serialKey.toUpperCase();

        // تجهيز العناصر (تحويل القيم الفارغة إلى null)
        const dbItems = [];
        for (let i = 0; i < 9; i++) {
            if (items && items[i] && items[i].id > 0) {
                dbItems[i] = { id: parseInt(items[i].id), days: parseInt(items[i].days) };
            } else {
                dbItems[i] = { id: null, days: null };
            }
        }

        const money = gameMoney ? parseInt(gameMoney) : 0;
        const daysToExpire = expireDays ? parseInt(expireDays) : 365;

        // استخدام Parameters بدلاً من السترينج المباشر
        const request = pool.request();
        
        request.input('serial', serialKey);
        request.input('days', daysToExpire);
        request.input('money', money);
        
        // إدخال العناصر كـ Inputs
        for(let i=0; i<9; i++) {
            request.input(`i${i+1}`, dbItems[i].id);
            request.input(`d${i+1}`, dbItems[i].days);
        }

        await request.query(`
            INSERT INTO GameDB.dbo.T_ItemSerialKey 
            (
                SerialKey, TargetUserNo, OneTimeKey, RegDate, ExpireDate, SupplyGameMoney,
                SupplyItemId1, SupplyItemDays1, SupplyItemId2, SupplyItemDays2, SupplyItemId3, SupplyItemDays3,
                SupplyItemId4, SupplyItemDays4, SupplyItemId5, SupplyItemDays5, SupplyItemId6, SupplyItemDays6,
                SupplyItemId7, SupplyItemDays7, SupplyItemId8, SupplyItemDays8, SupplyItemId9, SupplyItemDays9
            )
            VALUES 
            (
                @serial, NULL, 0, GETDATE(), DATEADD(DAY, @days, GETDATE()), @money,
                @i1, @d1, @i2, @d2, @i3, @d3,
                @i4, @d4, @i5, @d5, @i6, @d6,
                @i7, @d7, @i8, @d8, @i9, @d9
            )
        `);

        res.json({ status: 'success', message: `تم إنشاء كود الهدية: ${serialKey}`, code: serialKey });

    } catch (err) {
        // التحقق من خطأ تكرار المفتاح الأساسي (Violation of PRIMARY KEY constraint)
        if(err.number === 2627) {
             return res.status(400).json({ message: 'الكود موجود مسبقاً، حاول مرة أخرى' });
        }
        console.error(err);
        res.status(500).json({ message: 'فشل إنشاء الهدية', error: err.message });
    }
};
exports.updatePremiumCoupon = async (req, res) => {
    const { id } = req.params;
    // نستقبل البيانات التي نريد تعديلها
    const { title, price, publicFee, description, items } = req.body;
    const file = req.file; // الصورة الجديدة إن وجدت

    try {
        const pool = await poolPromise;
        
        // 1. أولاً: نجلب القسيمة القديمة للتأكد من وجودها ولمعرفة مسار الصورة القديمة
        const oldCouponRes = await pool.request()
            .input('id', id)
            .query("SELECT * FROM AdrenalineWeb.dbo.Web_PremiumCoupons WHERE CouponID = @id");
            
        const oldCoupon = oldCouponRes.recordset[0];
        if (!oldCoupon) {
            // إذا رفع صورة لكن القسيمة غير موجودة، نحذف الصورة المرفوعة لتنظيف السيرفر
            if (file) fs.unlinkSync(file.path);
            return res.status(404).json({ message: 'القسيمة غير موجودة' });
        }

        // 2. معالجة الصورة
        let finalImage = oldCoupon.ImageURL; // افتراضياً نبقي الصورة القديمة
        if (file) {
            finalImage = `/uploads/coupons/${file.filename}`;
            
            // (اختياري) حذف الصورة القديمة من السيرفر لتوفير المساحة
            // const oldPath = path.join(__dirname, '../public', oldCoupon.ImageURL);
            // if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        // 3. معالجة العناصر (Items) إذا تم إرسالها
        let i1=oldCoupon.ItemId1, d1=oldCoupon.ItemDays1, 
            i2=oldCoupon.ItemId2, d2=oldCoupon.ItemDays2, 
            i3=oldCoupon.ItemId3, d3=oldCoupon.ItemDays3, 
            i4=oldCoupon.ItemId4, d4=oldCoupon.ItemDays4, 
            i5=oldCoupon.ItemId5, d5=oldCoupon.ItemDays5, 
            i6=oldCoupon.ItemId6, d6=oldCoupon.ItemDays6, 
            i7=oldCoupon.ItemId7, d7=oldCoupon.ItemDays7, 
            i8=oldCoupon.ItemId8, d8=oldCoupon.ItemDays8, 
            i9=oldCoupon.ItemId9, d9=oldCoupon.ItemDays9;

        if (items) {
            let parsedItems = [];
            try {
                parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
                const slots = Array(9).fill({ id: 0, days: 0 });
                parsedItems.slice(0, 9).forEach((item, index) => {
                    slots[index] = { id: parseInt(item.id) || 0, days: parseInt(item.days) || 0 };
                });
                // تحديث المتغيرات
                [i1, d1] = [slots[0].id, slots[0].days];
                [i2, d2] = [slots[1].id, slots[1].days];
                [i3, d3] = [slots[2].id, slots[2].days];
                [i4, d4] = [slots[3].id, slots[3].days];
                [i5, d5] = [slots[4].id, slots[4].days];
                [i6, d6] = [slots[5].id, slots[5].days];
                [i7, d7] = [slots[6].id, slots[6].days];
                [i8, d8] = [slots[7].id, slots[7].days];
                [i9, d9] = [slots[8].id, slots[8].days];

            } catch (e) {
                console.error("Error parsing items:", e);
                // لا نوقف العملية، بل نبقي العناصر القديمة أو نعيد خطأ حسب رغبتك
            }
        }

        // 4. تنفيذ التحديث
        await pool.request()
            .input('id', id)
            .input('title', title || oldCoupon.Title)
            .input('price', price || oldCoupon.PriceGP)
            .input('fee', publicFee !== undefined ? publicFee : oldCoupon.PublicFeeGP)
            .input('desc', description !== undefined ? description : oldCoupon.Description)
            .input('img', finalImage)
            
            // مدخلات العناصر التسعة
            .input('i1', i1).input('d1', d1).input('i2', i2).input('d2', d2)
            .input('i3', i3).input('d3', d3).input('i4', i4).input('d4', d4)
            .input('i5', i5).input('d5', d5).input('i6', i6).input('d6', d6)
            .input('i7', i7).input('d7', d7).input('i8', i8).input('d8', d8)
            .input('i9', i9).input('d9', d9)

            .query(`
                UPDATE AdrenalineWeb.dbo.Web_PremiumCoupons
                SET 
                    Title = @title,
                    PriceGP = @price,
                    PublicFeeGP = @fee,
                    Description = @desc,
                    ImageURL = @img,
                    ItemId1=@i1, ItemDays1=@d1, ItemId2=@i2, ItemDays2=@d2, ItemId3=@i3, ItemDays3=@d3,
                    ItemId4=@i4, ItemDays4=@d4, ItemId5=@i5, ItemDays5=@d5, ItemId6=@i6, ItemDays6=@d6,
                    ItemId7=@i7, ItemDays7=@d7, ItemId8=@i8, ItemDays8=@d8, ItemId9=@i9, ItemDays9=@d9
                WHERE CouponID = @id
            `);

        res.json({ status: 'success', message: 'تم تحديث القسيمة بنجاح', imageUrl: finalImage });

    } catch (err) {
        console.error(err);
        if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path); // تنظيف عند الخطأ
        res.status(500).json({ message: 'فشل التحديث', error: err.message });
    }
};

// =========================================================
// 6. حذف قسيمة (تحسين الدالة الموجودة)
// =========================================================
exports.deletePremiumCoupon = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        // نستخدم Soft Delete (IsActive = 0) للحفاظ على سجلات المبيعات القديمة
        // إذا حذفتها نهائياً (DELETE FROM)، ستختفي من سجل مشتريات اللاعبين وهذا خطأ
        await pool.request()
            .input('id', id)
            .query("UPDATE AdrenalineWeb.dbo.Web_PremiumCoupons SET IsActive = 0 WHERE CouponID = @id");
            
        res.json({ status: 'success', message: 'تم تعطيل القسيمة بنجاح' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف', error: err.message });
    }
};