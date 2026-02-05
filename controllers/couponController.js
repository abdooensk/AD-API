const { poolPromise, sql } = require('../config/db');

// --- دوال مساعدة ---

// 1. توليد كود رقمي بالشكل المطلوب (123456-123456-1234)
const generateNumericSerial = () => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const gen = (len) => {
        let res = '';
        for (let i = 0; i < len; i++) {
            res += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return res;
    };
    // النتيجة: 6 رموز - 6 رموز - 4 رموز (أحرف وأرقام)
    return `${gen(6)}-${gen(6)}-${gen(4)}`;
};

// 2. تحويل القيم لـ NULL إذا كانت 0
const toSqlVal = (val) => (val && val > 0) ? val : 'NULL';

// 3. حل مشكلة UserID (الاسم) وتحويله لـ UserNo (الرقم) لضمان عدم حدوث خطأ Conversion
async function resolveUserNo(req, pool) {
    if (req.user.userNo && !isNaN(req.user.userNo)) {
        return req.user.userNo;
    }
    const userIdentifier = req.user.userId;
    if (userIdentifier) {
        const check = await pool.request()
            .input('loginId', userIdentifier)
            .query("SELECT UserNo FROM AuthDB.dbo.T_Account WHERE UserId = @loginId");
        
        if (check.recordset.length > 0) {
            return check.recordset[0].UserNo;
        }
    }
    throw new Error('UserNo not found for this account');
}

// =========================================================
// 1. عرض المتجر (جلب كل العناصر مع أسمائها)
// =========================================================
exports.getShopBundles = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                C.CouponID AS BundleID, C.Title AS BundleName, C.Description, 
                C.PriceGP, C.PublicFeeGP, C.ImageURL,
                
                -- جلب معرفات العناصر وأسمائها وعدد أيامها (9 عناصر)
                C.ItemId1, C.ItemDays1, I1.ItemName AS ItemName1,
                C.ItemId2, C.ItemDays2, I2.ItemName AS ItemName2,
                C.ItemId3, C.ItemDays3, I3.ItemName AS ItemName3,
                C.ItemId4, C.ItemDays4, I4.ItemName AS ItemName4,
                C.ItemId5, C.ItemDays5, I5.ItemName AS ItemName5,
                C.ItemId6, C.ItemDays6, I6.ItemName AS ItemName6,
                C.ItemId7, C.ItemDays7, I7.ItemName AS ItemName7,
                C.ItemId8, C.ItemDays8, I8.ItemName AS ItemName8,
                C.ItemId9, C.ItemDays9, I9.ItemName AS ItemName9

            FROM AdrenalineWeb.dbo.Web_PremiumCoupons C
            LEFT JOIN GameDB.dbo.T_ItemInfo I1 ON C.ItemId1 = I1.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I2 ON C.ItemId2 = I2.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I3 ON C.ItemId3 = I3.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I4 ON C.ItemId4 = I4.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I5 ON C.ItemId5 = I5.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I6 ON C.ItemId6 = I6.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I7 ON C.ItemId7 = I7.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I8 ON C.ItemId8 = I8.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I9 ON C.ItemId9 = I9.ItemId
            
            WHERE C.IsActive = 1
            ORDER BY C.CouponID DESC
        `);
        res.json({ status: 'success', bundles: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'خطأ في جلب القسائم', error: err.message });
    }
};

// =========================================================
// 2. شراء القسيمة وتوليد الكود الرقمي
// =========================================================
exports.buyBundle = async (req, res) => {
    const { bundleId, makePublic } = req.body;
    
    try {
        const pool = await poolPromise;
        const userNo = await resolveUserNo(req, pool);

        const bundleRes = await pool.request()
            .input('bid', bundleId)
            .query("SELECT * FROM AdrenalineWeb.dbo.Web_PremiumCoupons WHERE CouponID = @bid AND IsActive = 1");
        
        const bundle = bundleRes.recordset[0];
        if (!bundle) return res.status(404).json({ message: 'القسيمة غير موجودة' });

        let finalPrice = bundle.PriceGP;
        if (makePublic) finalPrice += (bundle.PublicFeeGP || 0);

        const userCheck = await pool.request()
            .input('uid', userNo)
            .query("SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");
            
        if (!userCheck.recordset[0] || userCheck.recordset[0].CashMoney < finalPrice) {
            return res.status(400).json({ message: 'رصيدك غير كافٍ' });
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            const newSerial = generateNumericSerial(); // توليد الكود الرقمي 123456-123456-1234
            const targetUserSql = makePublic ? 'NULL' : userNo; 

            request.input('price', finalPrice);
            request.input('uid', userNo);
            request.input('serial', newSerial);
            request.input('bid', bundleId);
            request.input('isPub', makePublic ? 1 : 0);

            await request.query("UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney - @price WHERE UserNo = @uid");

            await request.query(`
                INSERT INTO GameDB.dbo.T_ItemSerialKey 
                (
                    SerialKey, TargetUserNo, OneTimeKey, RegDate, ExpireDate, SupplyGameMoney,
                    SupplyItemId1, SupplyItemDays1, SupplyItemId2, SupplyItemDays2, SupplyItemId3, SupplyItemDays3,
                    SupplyItemId4, SupplyItemDays4, SupplyItemId5, SupplyItemDays5, SupplyItemId6, SupplyItemDays6,
                    SupplyItemId7, SupplyItemDays7, SupplyItemId8, SupplyItemDays8, SupplyItemId9, SupplyItemDays9,
                    Description
                )
                VALUES 
                (
                    @serial, ${targetUserSql}, 1, GETDATE(), DATEADD(YEAR, 1, GETDATE()), 0,
                    ${toSqlVal(bundle.ItemId1)}, ${toSqlVal(bundle.ItemDays1)}, 
                    ${toSqlVal(bundle.ItemId2)}, ${toSqlVal(bundle.ItemDays2)}, 
                    ${toSqlVal(bundle.ItemId3)}, ${toSqlVal(bundle.ItemDays3)},
                    ${toSqlVal(bundle.ItemId4)}, ${toSqlVal(bundle.ItemDays4)}, 
                    ${toSqlVal(bundle.ItemId5)}, ${toSqlVal(bundle.ItemDays5)}, 
                    ${toSqlVal(bundle.ItemId6)}, ${toSqlVal(bundle.ItemDays6)},
                    ${toSqlVal(bundle.ItemId7)}, ${toSqlVal(bundle.ItemDays7)}, 
                    ${toSqlVal(bundle.ItemId8)}, ${toSqlVal(bundle.ItemDays8)}, 
                    ${toSqlVal(bundle.ItemId9)}, ${toSqlVal(bundle.ItemDays9)},
                    'Web Purchase'
                )
            `);

            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_UserCoupons (UserNo, SerialKey, BundleID, IsPublic)
                VALUES (@uid, @serial, @bid, @isPub)
            `);

            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_EconomyLog (UserNo, ActionType, Amount, Currency, Description, LogDate)
                VALUES (@uid, 'COUPON_BUY', @price, 'CASH', 'Bought Coupon Bundle', GETDATE())
            `);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم شراء القسيمة بنجاح', serialKey: newSerial });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        res.status(500).json({ status: 'error', message: 'فشلت عملية الشراء', error: err.message });
    }
};

// =========================================================
// 3. عرض كوبوناتي (جلب أرقام وأسماء كل العناصر)
// =========================================================
exports.getMyCoupons = async (req, res) => {
    try {
        const pool = await poolPromise;
        const userNo = await resolveUserNo(req, pool);

        const result = await pool.request().input('uid', userNo).query(`
            SELECT 
                UC.SerialKey, UC.IsPublic, UC.PurchaseDate, 
                B.Title AS BundleName, B.ImageURL,
                
                -- العناصر والأسماء
                B.ItemId1, I1.ItemName AS ItemName1,
                B.ItemId2, I2.ItemName AS ItemName2,
                B.ItemId3, I3.ItemName AS ItemName3,

                ISNULL(K.ExpireDate, DATEADD(YEAR, 1, UC.PurchaseDate)) AS ExpireDate,
                CASE WHEN Used.SerialKey IS NOT NULL THEN 1 ELSE 0 END AS IsUsed,
                Used.UsedDate

            FROM AdrenalineWeb.dbo.Web_UserCoupons UC
            JOIN AdrenalineWeb.dbo.Web_PremiumCoupons B ON UC.BundleID = B.CouponID
            LEFT JOIN GameDB.dbo.T_ItemInfo I1 ON B.ItemId1 = I1.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I2 ON B.ItemId2 = I2.ItemId
            LEFT JOIN GameDB.dbo.T_ItemInfo I3 ON B.ItemId3 = I3.ItemId
            LEFT JOIN GameDB.dbo.T_ItemSerialKey K ON UC.SerialKey = K.SerialKey
            LEFT JOIN GameDB.dbo.T_ItemSerialKey_Used Used ON UC.SerialKey = Used.SerialKey
            
            WHERE UC.UserNo = @uid
            ORDER BY UC.PurchaseDate DESC
        `);
        
        res.json({ status: 'success', coupons: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'خطأ في جلب الكوبونات', error: err.message });
    }
};

// =========================================================
// 4. ترقية الكوبون لعام
// =========================================================
exports.upgradeToPublic = async (req, res) => {
    const { serialKey } = req.body;
    try {
        const pool = await poolPromise;
        const userNo = await resolveUserNo(req, pool);

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
        if (!coupon) return res.status(404).json({ message: 'الكوبون غير موجود' });
        if (coupon.IsPublic) return res.status(400).json({ message: 'الكوبون عام بالفعل' });
        
        const fee = coupon.PublicFeeGP || 0;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const req = new sql.Request(transaction);
            req.input('uid', userNo);
            req.input('fee', fee);
            req.input('key', serialKey);

            if (fee > 0) {
                const deduct = await req.query("UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney - @fee WHERE UserNo = @uid AND CashMoney >= @fee");
                if (deduct.rowsAffected[0] === 0) throw new Error('رصيد غير كافٍ');
            }

            await req.query("UPDATE GameDB.dbo.T_ItemSerialKey SET TargetUserNo = NULL WHERE SerialKey = @key");
            await req.query("UPDATE AdrenalineWeb.dbo.Web_UserCoupons SET IsPublic = 1 WHERE SerialKey = @key");

            await transaction.commit();
            res.json({ status: 'success', message: 'تمت الترقية بنجاح' });

        } catch (err) {
            await transaction.rollback();
            res.status(400).json({ message: err.message });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'فشل التحديث' });
    }
};

// =========================================================
// 5. سجل العمليات
// =========================================================
exports.getCouponHistory = async (req, res) => {
    try {
        const pool = await poolPromise;
        const userNo = await resolveUserNo(req, pool);
        
        const result = await pool.request().input('uid', userNo).query(`
            SELECT LogID, ActionType AS Action, Amount, LogDate AS Date, Description AS Details
            FROM AdrenalineWeb.dbo.Web_EconomyLog
            WHERE UserNo = @uid AND ActionType LIKE 'COUPON_%'
            ORDER BY LogDate DESC
        `);
        res.json({ status: 'success', history: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'فشل جلب السجل' });
    }
};