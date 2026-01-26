const { poolPromise, sql } = require('../config/db');

// دالة مساعدة لتوليد حروف عشوائية
const generateSegment = (length) => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// دالة مساعدة لتنسيق القيمة لـ SQL (إما رقم أو كلمة NULL)
const fmtVal = (val) => val ? val : 'NULL';

// 1. إنشاء حزمة قسائم للبيع (Bundle)
exports.createBundle = async (req, res) => {
    const { name, desc, priceGP, publicFee, items } = req.body;

    try {
        const pool = await poolPromise;
        const request = pool.request()
            .input('name', name)
            .input('desc', desc)
            .input('price', priceGP)
            .input('fee', publicFee || 2000);

        // تجهيز القيم: إذا لم يوجد العنصر نستخدم 0 للمتجر (لان Web_CouponShop يفضل 0)
        // لكن إذا أردت NULL في المتجر أيضاً، غير 0 إلى 'NULL'
        // ملاحظة: عادة جداول الويب تقبل 0 كقيمة افتراضية، لكن سنتركها 0 هنا لعدم تعقيد العرض
        const safeItems = [];
        for (let i = 0; i < 9; i++) {
            safeItems[i] = items && items[i] ? items[i] : { id: 0, days: 0 };
        }

        await request.query(`
            INSERT INTO AdrenalineWeb.dbo.Web_CouponShop 
            (
                BundleName, Description, PriceGP, PublicFeeGP, 
                ItemId1, ItemDays1, ItemId2, ItemDays2, ItemId3, ItemDays3, 
                ItemId4, ItemDays4, ItemId5, ItemDays5, ItemId6, ItemDays6, 
                ItemId7, ItemDays7, ItemId8, ItemDays8, ItemId9, ItemDays9
            )
            VALUES 
            (
                @name, @desc, @price, @fee,
                ${safeItems[0].id}, ${safeItems[0].days}, ${safeItems[1].id}, ${safeItems[1].days}, ${safeItems[2].id}, ${safeItems[2].days},
                ${safeItems[3].id}, ${safeItems[3].days}, ${safeItems[4].id}, ${safeItems[4].days}, ${safeItems[5].id}, ${safeItems[5].days},
                ${safeItems[6].id}, ${safeItems[6].days}, ${safeItems[7].id}, ${safeItems[7].days}, ${safeItems[8].id}, ${safeItems[8].days}
            )
        `);

        res.json({ status: 'success', message: 'تم إنشاء الحزمة في المتجر بنجاح' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل إنشاء الحزمة', error: err.message });
    }
};

// 2. إنشاء "قسيمة هدية" (Promo Code) - هنا التعديل المهم لـ NULL
exports.createGiftCoupon = async (req, res) => {
    const { customCode, expireDays, maxUses, items, gameMoney } = req.body; 

    try {
        const pool = await poolPromise;
        
        // توليد الكود
        let serialKey = customCode;
        if (!serialKey) {
            serialKey = `${generateSegment(6)}-${generateSegment(6)}-${generateSegment(4)}`;
        }
        serialKey = serialKey.toUpperCase();

        // تجهيز مصفوفة العناصر بقيم NULL إذا كانت فارغة
        const dbItems = [];
        for (let i = 0; i < 9; i++) {
            if (items && items[i] && items[i].id > 0) {
                dbItems[i] = { id: items[i].id, days: items[i].days };
            } else {
                dbItems[i] = { id: 'NULL', days: 'NULL' }; // 👈 نستخدم النص 'NULL'
            }
        }

        const money = gameMoney || 0;

        // الإدخال في GameDB باستخدام القيم التي قد تكون NULL
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