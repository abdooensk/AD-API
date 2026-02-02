const { poolPromise, sql } = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// --- دوال مساعدة ---
const generateSegment = (length) => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// تحويل القيمة لـ NULL إذا كانت 0 (لتوافق SQL)
const toSqlVal = (val) => (val && val > 0) ? val : 'NULL';

// =========================================================
// 1. عرض القسائم المميزة في المتجر
// =========================================================
exports.getShopBundles = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                CouponID AS BundleID, -- نعيد تسميتها BundleID لتوافق الفرونت إند القديم إذا وجد
                Title AS BundleName, 
                Description, 
                PriceGP, 
                PublicFeeGP, 
                ImageURL, -- 👈 الصورة الجديدة
                ItemId1, ItemDays1, ItemId2, ItemDays2, ItemId3, ItemDays3
                -- يمكنك جلب باقي العناصر إذا أردت عرضها بالتفصيل
            FROM AdrenalineWeb.dbo.Web_PremiumCoupons 
            WHERE IsActive = 1
            ORDER BY CouponID DESC
        `);
        res.json({ status: 'success', bundles: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب القسائم', error: err.message });
    }
};

// =========================================================
// 2. شراء القسيمة وتوليد الكود
// =========================================================
exports.buyBundle = async (req, res) => {
    const { bundleId, makePublic } = req.body; // bundleId هنا هو CouponID
    const userNo = req.user.userId; // تأكد من استخدام userId أو userNo حسب الميدل وير

    try {
        const pool = await poolPromise;

        // أ. جلب بيانات القسيمة من الجدول الجديد
        const bundleRes = await pool.request()
            .input('bid', bundleId)
            .query("SELECT * FROM AdrenalineWeb.dbo.Web_PremiumCoupons WHERE CouponID = @bid AND IsActive = 1");
        
        const bundle = bundleRes.recordset[0];
        if (!bundle) return res.status(404).json({ message: 'القسيمة غير موجودة' });

        // ب. حساب السعر النهائي (سعر القسيمة + رسوم النشر إذا اختار ذلك)
        let finalPrice = bundle.PriceGP;
        if (makePublic) finalPrice += (bundle.PublicFeeGP || 0);

        // ج. التحقق من رصيد اللاعب
        const userCheck = await pool.request()
            .input('uid', userNo)
            .query("SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");
            
        if (userCheck.recordset[0].CashMoney < finalPrice) {
            return res.status(400).json({ message: `رصيدك غير كافٍ. المطلوب: ${finalPrice} Cash` });
        }

        // د. بدء المعاملة المالية
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            
            // توليد سيريال فريد (XXXXXX-XXXXXX-XXXX)
            const newSerial = `${generateSegment(6)}-${generateSegment(6)}-${generateSegment(4)}`;
            
            // تحديد مالك الكود: إذا كان عاماً (Public) فالمالك NULL، وإلا فهو المشتري
            const targetUserSql = makePublic ? 'NULL' : userNo; 

            // إعداد القيم
            request.input('price', finalPrice);
            request.input('uid', userNo);
            request.input('serial', newSerial);
            request.input('bid', bundleId);
            request.input('isPub', makePublic ? 1 : 0);

            // 1. خصم المال
            const deduct = await request.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - @price 
                WHERE UserNo = @uid AND CashMoney >= @price
            `);

            if (deduct.rowsAffected[0] === 0) {
                throw new Error("رصيد غير كافٍ أو خطأ في الخصم");
            }

            // 2. إدخال الكود في جدول اللعبة (T_ItemSerialKey)
            // نستخدم القيم من جدول Web_PremiumCoupons
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
                    @serial, ${targetUserSql}, 1, GETDATE(), DATEADD(YEAR, 1, GETDATE()), 0, -- 0 لأن القسائم عادة عناصر فقط
                    ${toSqlVal(bundle.ItemId1)}, ${toSqlVal(bundle.ItemDays1)}, 
                    ${toSqlVal(bundle.ItemId2)}, ${toSqlVal(bundle.ItemDays2)}, 
                    ${toSqlVal(bundle.ItemId3)}, ${toSqlVal(bundle.ItemDays3)},
                    ${toSqlVal(bundle.ItemId4)}, ${toSqlVal(bundle.ItemDays4)}, 
                    ${toSqlVal(bundle.ItemId5)}, ${toSqlVal(bundle.ItemDays5)}, 
                    ${toSqlVal(bundle.ItemId6)}, ${toSqlVal(bundle.ItemDays6)},
                    ${toSqlVal(bundle.ItemId7)}, ${toSqlVal(bundle.ItemDays7)}, 
                    ${toSqlVal(bundle.ItemId8)}, ${toSqlVal(bundle.ItemDays8)}, 
                    ${toSqlVal(bundle.ItemId9)}, ${toSqlVal(bundle.ItemDays9)}
                )
            `);

            // 3. تسجيل القسيمة في الويب (للمحفظة الشخصية)
            // ملاحظة: تأكد من وجود جدول Web_UserCoupons في قاعدة AdrenalineWeb
            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_UserCoupons (UserNo, SerialKey, BundleID, IsPublic)
                VALUES (@uid, @serial, @bid, @isPub)
            `);

            // 4. تسجيل العملية في سجلات الاقتصاد (مهم جداً)
            request.input('desc', `Bought Premium Coupon: ${bundle.Title} (${newSerial})`);
            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_EconomyLog 
                (UserNo, ActionType, Amount, Currency, Description, LogDate)
                VALUES (@uid, 'COUPON_BUY', @price, 'CASH', @desc, GETDATE())
            `);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم شراء القسيمة بنجاح', serialKey: newSerial });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error('Buy Bundle Error:', err);
        res.status(500).json({ message: 'فشلت عملية الشراء', error: err.message });
    }
};

// =========================================================
// 3. استخدام الكوبون (Redeem) - (بقي كما هو تقريباً لأنه يعتمد على جدول اللعبة)
// =========================================================
exports.redeemCoupon = async (req, res) => {
    const { serial } = req.body;
    const userNo = req.user.userId;
    const cleanSerial = serial ? serial.trim().toUpperCase() : '';

    if (!cleanSerial) return res.status(400).json({ message: 'أدخل الكود' });

    try {
        const pool = await poolPromise;

        // التحقق من الكود
        const check = await pool.request()
            .input('key', cleanSerial)
            .query("SELECT * FROM GameDB.dbo.T_ItemSerialKey WHERE SerialKey = @key");

        const coupon = check.recordset[0];

        if (!coupon) return res.status(404).json({ message: 'الكود غير صحيح' });
        if (coupon.Status && coupon.Status > 0) return res.status(400).json({ message: 'تم استخدام الكود مسبقاً' });
        if (coupon.TargetUserNo !== null && coupon.TargetUserNo !== userNo) return res.status(403).json({ message: 'هذا الكود ليس ملكك' });
        if (new Date(coupon.ExpireDate) < new Date()) return res.status(400).json({ message: 'انتهت صلاحية الكود' });

        // التحقق من سعة الحقيبة (اختياري لكن مفضل)
        // ...

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const req = new sql.Request(transaction);
            req.input('uid', userNo);
            req.input('serial', cleanSerial);

            // 1. تحديث الحالة
            await req.query("UPDATE GameDB.dbo.T_ItemSerialKey SET TargetUserNo = @uid, UseDate = GETDATE(), Status = 2 WHERE SerialKey = @serial");

            // 2. دالة إضافة العناصر
            const giveItem = async (itemId, days) => {
                if (itemId && itemId > 0) {
                    // نحسب تاريخ النهاية
                    const endDateSql = days > 0 ? `DATEADD(DAY, ${days}, GETDATE())` : `'2099-01-01'`; // دائم
                    
                    // نحتاج لمعرفة نوع العنصر من T_ItemInfo ليكون الإدخال دقيقاً
                    // للتبسيط سنفترض إدخالاً أساسياً، لكن الأفضل عمل JOIN
                    // هنا سنستخدم أبسط إدخال يقبله السيرفر:
                    await req.query(`
                        INSERT INTO GameDB.dbo.T_UserItem 
                        (UserNo, ItemId, Count, Status, StartDate, EndDate, IsBaseItem, ItemType, IsGrenade, NeedSlot, RestrictLevel)
                        SELECT @uid, ItemId, 1, 1, GETDATE(), ${endDateSql}, IsBaseItem, ItemType, IsGrenade, NeedSlot, RestrictLevel
                        FROM GameDB.dbo.T_ItemInfo WHERE ItemId = ${itemId}
                    `);
                }
            };

            // إضافة العناصر الـ 9
            for (let i = 1; i <= 9; i++) {
                const id = coupon[`SupplyItemId${i}`];
                const days = coupon[`SupplyItemDays${i}`];
                await giveItem(id, days);
            }

            // إضافة المال إن وجد
            if (coupon.SupplyGameMoney > 0) {
                req.input('money', coupon.SupplyGameMoney);
                await req.query("UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney + @money WHERE UserNo = @uid");
            }

            await transaction.commit();
            res.json({ status: 'success', message: 'تم استخدام القسيمة والحصول على الهدايا!' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'حدث خطأ أثناء الاستخدام' });
    }
};

// =========================================================
// 4. ترقية الكوبون لعام (للمتاجرة به)
// =========================================================
exports.upgradeToPublic = async (req, res) => {
    const { serialKey } = req.body;
    const userNo = req.user.userId;

    try {
        const pool = await poolPromise;

        // أ. جلب الكوبون مع رسوم الترقية من الجدول الجديد
        const couponRes = await pool.request()
            .input('uid', userNo)
            .input('key', serialKey)
            .query(`
                SELECT UC.IsPublic, B.PublicFeeGP
                FROM AdrenalineWeb.dbo.Web_UserCoupons UC
                JOIN AdrenalineWeb.dbo.Web_PremiumCoupons B ON UC.BundleID = B.CouponID
                WHERE UC.SerialKey = @key AND UC.UserNo = @uid
            `);
        
        const coupon = couponRes.recordset[0];

        if (!coupon) return res.status(404).json({ message: 'الكوبون غير موجود أو لا تملكه' });
        if (coupon.IsPublic) return res.status(400).json({ message: 'الكوبون عام بالفعل' });
        
        const fee = coupon.PublicFeeGP || 0;

        // ب. خصم الرسوم والترقية
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const req = new sql.Request(transaction);
            req.input('uid', userNo);
            req.input('fee', fee);
            req.input('key', serialKey);

            // 1. خصم
            if (fee > 0) {
                const deduct = await req.query("UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney - @fee WHERE UserNo = @uid AND CashMoney >= @fee");
                if (deduct.rowsAffected[0] === 0) throw new Error('رصيد غير كافٍ');
            }

            // 2. فك الارتباط
            await req.query("UPDATE GameDB.dbo.T_ItemSerialKey SET TargetUserNo = NULL WHERE SerialKey = @key");
            
            // 3. تحديث الويب
            await req.query("UPDATE AdrenalineWeb.dbo.Web_UserCoupons SET IsPublic = 1 WHERE SerialKey = @key");

            await transaction.commit();
            res.json({ status: 'success', message: 'تم تحويل الكوبون إلى عام بنجاح' });

        } catch (err) {
            await transaction.rollback();
            res.status(400).json({ message: err.message });
        }

    } catch (err) {
        res.status(500).json({ message: 'فشل التحديث' });
    }
};

// =========================================================
// 5. عرض كوبوناتي
// =========================================================
exports.getMyCoupons = async (req, res) => {
    const userNo = req.user.userId;
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('uid', userNo).query(`
            SELECT 
                UC.SerialKey, UC.IsPublic, UC.PurchaseDate, 
                B.Title AS BundleName, B.PublicFeeGP, B.ImageURL,
                K.ExpireDate, K.Status
            FROM AdrenalineWeb.dbo.Web_UserCoupons UC
            JOIN AdrenalineWeb.dbo.Web_PremiumCoupons B ON UC.BundleID = B.CouponID
            LEFT JOIN GameDB.dbo.T_ItemSerialKey K ON UC.SerialKey = K.SerialKey
            WHERE UC.UserNo = @uid
            ORDER BY UC.PurchaseDate DESC
        `);
        res.json({ status: 'success', coupons: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الكوبونات' });
    }
};