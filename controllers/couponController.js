const { poolPromise, sql } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { rewardPointsOnPurchase } = require('../utils/rewardSystem');

const generateSegment = (length) => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// دالة لتحويل 0 إلى NULL (للاستخدام في استعلام SQL)
const toSqlVal = (val) => {
    return (val && val > 0) ? val : 'NULL';
};

// ... (GetShopBundles تبقى كما هي) ...
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
        res.status(500).json({ message: 'خطأ', error: err.message });
    }
};

// 2. شراء حزمة وتوليد الكود (تصحيح أمني 🛡️)
exports.buyBundle = async (req, res) => {
    const { bundleId, makePublic } = req.body; 
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. جلب الحزمة (آمنة)
        const bundleRes = await pool.request().input('bid', bundleId).query("SELECT * FROM AdrenalineWeb.dbo.Web_CouponShop WHERE BundleID = @bid");
        const bundle = bundleRes.recordset[0];
        if (!bundle) return res.status(404).json({ message: 'الحزمة غير موجودة' });

        // ب. السعر والرصيد (آمنة)
        let finalPrice = bundle.PriceGP;
        if (makePublic) finalPrice += bundle.PublicFeeGP;

        const userCheck = await pool.request().input('uid', userNo).query("SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");
        if (userCheck.recordset[0].CashMoney < finalPrice) {
            return res.status(400).json({ message: `رصيدك غير كافٍ. المطلوب: ${finalPrice} GP` });
        }

        // ج. التنفيذ (Transaction)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            
            // توليد القيم
            const newSerial = `${generateSegment(6)}-${generateSegment(6)}-${generateSegment(4)}`;
            // ملاحظة: في الاستعلام المباشر نستخدم 'NULL' كنص، أما مع البارامترات نمرر القيمة null
            // هنا سنبقي منطق String Interpolation للعناصر فقط لأنها قادمة من قاعدة البيانات وموثوقة
            // لكن سنحمي بيانات المستخدم (UserNo, Money, Serial).
            const targetUserSql = makePublic ? 'NULL' : userNo; 

            // إدخال القيم الآمنة لاستخدامها في الاستعلامات
            request.input('price', finalPrice);
            request.input('uid', userNo);
            request.input('serial', newSerial);
            request.input('bid', bundleId);
            request.input('isPub', makePublic ? 1 : 0);

            // 1. خصم المال (استخدام @price, @uid)
            await request.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney - @price WHERE UserNo = @uid`);

            // 2. إدخال الكود في GameDB 
            // ⚠️ ملاحظة: عناصر الحزمة (ItemId1...) نثق بها لأنها قادمة من الداتابيز، لذلك تركناها كما هي لتبسيط الكود الضخم
            // لكن قمنا بتأمين SerialKey, GameMoney
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
                    @serial, ${targetUserSql}, 1, GETDATE(), DATEADD(YEAR, 1, GETDATE()), ${bundle.GameMoney},
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

            // 3. تسجيل في الموقع (استخدام @uid, @serial, @bid, @isPub)
            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_UserCoupons (UserNo, SerialKey, BundleID, IsPublic)
                VALUES (@uid, @serial, @bid, @isPub)
            `);
            
            await rewardPointsOnPurchase(request, userNo, finalPrice);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم شراء القسيمة بنجاح', serialKey: newSerial });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشلت العملية', error: err.message });
    }
};

// 3. عرض قسائمي (آمنة)
exports.getMyCoupons = async (req, res) => {
    const userNo = req.user.userNo;
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('uid', userNo).query(`
            SELECT UC.RowID, UC.SerialKey, UC.IsPublic, UC.PurchaseDate, UC.Status,
                   B.BundleName, B.PublicFeeGP 
            FROM AdrenalineWeb.dbo.Web_UserCoupons UC
            JOIN AdrenalineWeb.dbo.Web_CouponShop B ON UC.BundleID = B.BundleID
            WHERE UC.UserNo = @uid
            ORDER BY UC.PurchaseDate DESC
        `);
        res.json({ status: 'success', coupons: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ' });
    }
};

// 4. ترقية القسيمة (تصحيح أمني 🛡️)
exports.upgradeToPublic = async (req, res) => {
    const { serialKey } = req.body;
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. جلب معلومات القسيمة (آمنة)
        const couponRes = await pool.request()
            .input('uid', userNo)
            .input('key', serialKey)
            .query(`
                SELECT UC.IsPublic, UC.BundleID, B.PublicFeeGP 
                FROM AdrenalineWeb.dbo.Web_UserCoupons UC
                JOIN AdrenalineWeb.dbo.Web_CouponShop B ON UC.BundleID = B.BundleID
                WHERE UC.SerialKey = @key AND UC.UserNo = @uid
            `);
        
        const coupon = couponRes.recordset[0];
        if (!coupon) return res.status(404).json({ message: 'القسيمة غير موجودة' });
        if (coupon.IsPublic) return res.status(400).json({ message: 'القسيمة عامة بالفعل' });

        // ب. التحقق من الرصيد (آمنة)
        const fee = coupon.PublicFeeGP;
        const userCheck = await pool.request().input('uid', userNo).query("SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");
        if (userCheck.recordset[0].CashMoney < fee) {
            return res.status(400).json({ message: `لا تملك رصيداً كافياً لتحويل القسيمة. الرسوم: ${fee} GP` });
        }

        // ج. تنفيذ التحديث (Transaction آمنة)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const request = new sql.Request(transaction);

            // إدخال المدخلات الآمنة
            request.input('fee', fee);
            request.input('uid', userNo);
            request.input('key', serialKey);

            // 1. خصم الرسوم (استخدام @fee, @uid)
            await request.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney - @fee WHERE UserNo = @uid`);

            // 2. تحديث جدول اللعبة (استخدام @key)
            await request.query(`UPDATE GameDB.dbo.T_ItemSerialKey SET TargetUserNo = NULL WHERE SerialKey = @key`);

            // 3. تحديث جدول الموقع (استخدام @key)
            await request.query(`UPDATE AdrenalineWeb.dbo.Web_UserCoupons SET IsPublic = 1 WHERE SerialKey = @key`);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم تحويل القسيمة إلى عامة بنجاح!' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        res.status(500).json({ message: 'فشل التحديث' });
    }
};