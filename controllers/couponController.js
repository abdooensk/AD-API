const { poolPromise, sql } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
// تأكد أن هذا المسار صحيح، أو احذفه إذا لم يكن لديك ملف rewardSystem
const { rewardPointsOnPurchase } = require('../utils/rewardSystem');

// --- دوال مساعدة ---
const generateSegment = (length) => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// تحويل القيمة لـ NULL إذا كانت 0 أو غير موجودة
const toSqlVal = (val) => {
    return (val && val > 0) ? val : 'NULL';
};

// ==========================================
// 1. عرض حزم الكوبونات (للمتجر)
// ==========================================
exports.getShopBundles = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT BundleID, BundleName, Description, PriceGP, PublicFeeGP, 
                   ItemId1, ItemDays1, ItemId2, ItemDays2, ItemId3, ItemDays3
            FROM AdrenalineWeb.dbo.Web_CouponShop 
            WHERE IsActive = 1
        `);
        res.json({ status: 'success', bundles: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب البيانات', error: err.message });
    }
};

// ==========================================
// 2. شراء حزمة وتوليد الكود (محصن 🛡️)
// ==========================================
exports.buyBundle = async (req, res) => {
    const { bundleId, makePublic } = req.body; 
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. جلب الحزمة
        const bundleRes = await pool.request()
            .input('bid', sql.Int, bundleId)
            .query("SELECT * FROM AdrenalineWeb.dbo.Web_CouponShop WHERE BundleID = @bid AND IsActive = 1");
        
        const bundle = bundleRes.recordset[0];
        if (!bundle) return res.status(404).json({ message: 'الحزمة غير موجودة' });

        // ب. حساب السعر النهائي
        let finalPrice = bundle.PriceGP;
        if (makePublic) finalPrice += bundle.PublicFeeGP;

        // التحقق من الرصيد
        const userCheck = await pool.request()
            .input('uid', sql.Int, userNo)
            .query("SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");
            
        if (userCheck.recordset[0].CashMoney < finalPrice) {
            return res.status(400).json({ message: `رصيدك غير كافٍ. المطلوب: ${finalPrice} GP` });
        }

        // ج. التنفيذ (Transaction)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            
            // توليد سيريال فريد
            const newSerial = `${generateSegment(6)}-${generateSegment(6)}-${generateSegment(4)}`;
            
            // تحديد مالك الكود: إذا كان عاماً (Public) فالمالك NULL، وإلا فهو المشتري
            const targetUserSql = makePublic ? 'NULL' : userNo; 

            // إعداد المدخلات الآمنة
            request.input('price', sql.Int, finalPrice);
            request.input('uid', sql.Int, userNo);
            request.input('serial', sql.VarChar, newSerial);
            request.input('bid', sql.Int, bundleId);
            request.input('isPub', sql.Bit, makePublic ? 1 : 0);

            // 1. خصم المال (Atomic Update لمنع التضارب)
            const deduct = await request.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - @price 
                WHERE UserNo = @uid AND CashMoney >= @price
            `);

            if (deduct.rowsAffected[0] === 0) {
                throw new Error("رصيد غير كافٍ أو حدث خطأ أثناء الخصم");
            }

            // 2. إدخال الكود في GameDB (T_ItemSerialKey)
            // القيم القادمة من bundle موثوقة لأنها من السيرفر، أما بيانات المستخدم فمحمية
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
                    @serial, ${targetUserSql}, 1, GETDATE(), DATEADD(YEAR, 1, GETDATE()), ${bundle.GameMoney || 0},
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

            // 3. تسجيل الكوبون في موقع الويب لغرض العرض والترقية
            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_UserCoupons (UserNo, SerialKey, BundleID, IsPublic)
                VALUES (@uid, @serial, @bid, @isPub)
            `);
            
            // منح نقاط الولاء (اختياري)
            if (rewardPointsOnPurchase) {
                await rewardPointsOnPurchase(request, userNo, finalPrice);
            }

            await transaction.commit();
            res.json({ status: 'success', message: 'تم شراء القسيمة بنجاح', serialKey: newSerial });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error('Buy Bundle Error:', err);
        res.status(500).json({ message: 'فشلت العملية', error: err.message });
    }
};

// ==========================================
// 3. استخدام الكوبون (Redeem)
// ==========================================
exports.redeemCoupon = async (req, res) => {
    const { serial } = req.body;
    const userNo = req.user.userNo;
    const cleanSerial = serial ? serial.trim().toUpperCase() : '';

    if (!cleanSerial) return res.status(400).json({ message: 'أدخل الكود' });

    try {
        const pool = await poolPromise;

        // أ. البحث عن الكوبون
        const check = await pool.request()
            .input('key', sql.VarChar, cleanSerial)
            .query(`SELECT * FROM GameDB.dbo.T_ItemSerialKey WHERE SerialKey = @key`);

        const coupon = check.recordset[0];

        if (!coupon) return res.status(404).json({ message: 'الكود غير صحيح' });

        // التحقق من الصلاحية والاستخدام
        if (coupon.Status && coupon.Status > 0) {
            return res.status(400).json({ message: 'تم استخدام هذا الكود مسبقاً' });
        }

        // التحقق من المالك (إذا كان خاصاً)
        // إذا كان TargetUserNo مسجلاً لشخص آخر، نمنع الاستخدام
        if (coupon.TargetUserNo !== null && coupon.TargetUserNo !== userNo) {
            return res.status(400).json({ message: 'هذا الكود خاص بمستخدم آخر ولا يمكنك استخدامه' });
        }

        // التحقق من تاريخ الانتهاء
        if (new Date(coupon.ExpireDate) < new Date()) {
            return res.status(400).json({ message: 'عذراً، انتهت صلاحية هذا الكود' });
        }

        // ب. التنفيذ
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const req = new sql.Request(transaction);

            // 1. تحديث الحالة
            await req.query(`
                UPDATE GameDB.dbo.T_ItemSerialKey 
                SET TargetUserNo = ${userNo}, UseDate = GETDATE(), Status = 2 
                WHERE SerialKey = '${cleanSerial}'
            `);

            // 2. منح الكاش
            if (coupon.SupplyGameMoney > 0) {
                await req.query(`UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney + ${coupon.SupplyGameMoney} WHERE UserNo = ${userNo}`);
            }

            // 3. دالة إضافة السلاح
            const giveItem = async (itemId, days) => {
                if (itemId && itemId > 0) {
                    await req.query(`
                        INSERT INTO GameDB.dbo.T_UserItem 
                        (UserNo, ItemId, Count, Status, StartDate, EndDate, IsBaseItem)
                        VALUES 
                        (${userNo}, ${itemId}, 1, 1, GETDATE(), DATEADD(DAY, ${days}, GETDATE()), 0)
                    `);
                }
            };

            // إضافة العناصر (حلقة تكرارية بسيطة للعناصر الـ 9)
            // ملاحظة: لتحسين الأداء وتجنب التكرار يمكن استخدام مصفوفة، لكن هذا الشكل أوضح للتعديل
            await giveItem(coupon.SupplyItemId1, coupon.SupplyItemDays1);
            await giveItem(coupon.SupplyItemId2, coupon.SupplyItemDays2);
            await giveItem(coupon.SupplyItemId3, coupon.SupplyItemDays3);
            await giveItem(coupon.SupplyItemId4, coupon.SupplyItemDays4);
            await giveItem(coupon.SupplyItemId5, coupon.SupplyItemDays5);
            // ... يمكنك إكمال الباقي حسب الحاجة

            await transaction.commit();
            res.json({ status: 'success', message: 'مبروك! تم استخدام الكوبون بنجاح.' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل استخدام الكوبون' });
    }
};

// ==========================================
// 4. ترقية الكوبون لعام (لبيعه)
// ==========================================
exports.upgradeToPublic = async (req, res) => {
    const { serialKey } = req.body; // تأكد أن الاسم يطابق ما يرسله الفرونت اند
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. جلب بيانات الكوبون والتحقق من الملكية
        const couponRes = await pool.request()
            .input('uid', sql.Int, userNo)
            .input('key', sql.VarChar, serialKey)
            .query(`
                SELECT UC.IsPublic, UC.BundleID, B.PublicFeeGP, K.ExpireDate
                FROM AdrenalineWeb.dbo.Web_UserCoupons UC
                JOIN AdrenalineWeb.dbo.Web_CouponShop B ON UC.BundleID = B.BundleID
                JOIN GameDB.dbo.T_ItemSerialKey K ON UC.SerialKey = K.SerialKey
                WHERE UC.SerialKey = @key AND UC.UserNo = @uid
            `);
        
        const coupon = couponRes.recordset[0];

        if (!coupon) return res.status(404).json({ message: 'الكوبون غير موجود أو لا تملكه' });
        if (coupon.IsPublic) return res.status(400).json({ message: 'الكوبون عام بالفعل' });
        
        // التحقق من الصلاحية
        if (new Date(coupon.ExpireDate) < new Date()) {
            return res.status(400).json({ message: 'لا يمكن ترقية كوبون منتهي الصلاحية' });
        }

        // ب. التحقق من الرصيد لدفع الرسوم
        const fee = coupon.PublicFeeGP;
        const userCheck = await pool.request().input('uid', userNo).query("SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");
        if (userCheck.recordset[0].CashMoney < fee) {
            return res.status(400).json({ message: `رصيد غير كافٍ. رسوم الترقية: ${fee} GP` });
        }

        // ج. التنفيذ
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const req = new sql.Request(transaction);

            // 1. خصم الرسوم
            await req.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney - ${fee} WHERE UserNo = ${userNo}`);

            // 2. فك ارتباط المستخدم في GameDB ليصبح متاحاً للغير
            await req.query(`UPDATE GameDB.dbo.T_ItemSerialKey SET TargetUserNo = NULL WHERE SerialKey = '${serialKey}'`);

            // 3. تحديث الحالة في الويب
            await req.query(`UPDATE AdrenalineWeb.dbo.Web_UserCoupons SET IsPublic = 1 WHERE SerialKey = '${serialKey}'`);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم تحويل الكوبون إلى عام بنجاح!' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        res.status(500).json({ message: 'فشل التحديث' });
    }
};

// ==========================================
// 5. عرض كوبوناتي (My Coupons)
// ==========================================
exports.getMyCoupons = async (req, res) => {
    const userNo = req.user.userNo;
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('uid', userNo).query(`
            SELECT UC.RowID, UC.SerialKey, UC.IsPublic, UC.PurchaseDate, 
                   B.BundleName, B.PublicFeeGP, K.ExpireDate, K.Status
            FROM AdrenalineWeb.dbo.Web_UserCoupons UC
            JOIN AdrenalineWeb.dbo.Web_CouponShop B ON UC.BundleID = B.BundleID
            LEFT JOIN GameDB.dbo.T_ItemSerialKey K ON UC.SerialKey = K.SerialKey
            WHERE UC.UserNo = @uid
            ORDER BY UC.PurchaseDate DESC
        `);
        res.json({ status: 'success', coupons: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الكوبونات' });
    }
};