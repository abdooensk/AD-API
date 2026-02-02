const { poolPromise, sql } = require('../config/db');

// 1. عرض عناصر المتجر (كما هي)
exports.getShopItems = async (req, res) => {
    const { category } = req.query;

    try {
        const pool = await poolPromise;
        let query = `
            SELECT 
                S.ShopID, S.ItemID, S.PriceGP, S.Duration, S.Category, S.IsHot, S.IsNew,
                I.ItemName,
                CAST(I.ItemId AS VARCHAR) + '.png' AS ImageURL,
                I.ItemType
            FROM AdrenalineWeb.dbo.Web_Shop S
            INNER JOIN GameDB.dbo.T_ItemInfo I ON S.ItemID = I.ItemId
            WHERE S.IsActive = 1
        `;
        
        if (category && category !== 'ALL') {
            query += ` AND S.Category = @cat`;
        }
        
        query += " ORDER BY S.IsHot DESC, S.IsNew DESC, S.ShopID DESC";

        const request = pool.request();
        if (category && category !== 'ALL') request.input('cat', category);

        const result = await request.query(query);

        res.json({ status: 'success', items: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب المتجر' });
    }
};

// 2. شراء عنصر (باستخدام Stored Procedures)
exports.buyItem = async (req, res) => {
    const { shopId } = req.body;
    const userNo = req.user.userId; // تأكد من أن الميدل وير يمرر userId

    try {
        const pool = await poolPromise;

        // أ. فحص سعة الحقيبة (أمان إضافي قبل استدعاء الـ SP)
        const invCheck = await pool.request()
            .input('u', userNo)
            .query("SELECT COUNT(*) as cnt FROM GameDB.dbo.T_UserItem WHERE UserNo = @u AND Status != 2");
        
        if (invCheck.recordset[0].cnt >= 240) {
            return res.status(400).json({ message: 'الحقيبة ممتلئة! يرجى حذف بعض العناصر.' });
        }

        // ب. جلب بيانات العنصر من المتجر لمعرفة الـ ID والنوع
        const shopItem = await pool.request()
            .input('sid', shopId)
            .query(`
                SELECT S.Duration, I.ItemId, I.ItemName, I.ItemType
                FROM AdrenalineWeb.dbo.Web_Shop S
                INNER JOIN GameDB.dbo.T_ItemInfo I ON S.ItemID = I.ItemId
                WHERE S.ShopID = @sid AND S.IsActive = 1
            `);

        if (shopItem.recordset.length === 0) {
            return res.status(404).json({ message: 'العنصر غير متاح' });
        }
        
        const item = shopItem.recordset[0];

        // ج. تجهيز استدعاء الـ Stored Procedure
        const request = pool.request();
        
        // إعداد المتغيرات حسب كود SQL الذي أرسلته
        request.input('OwnerUserNo', userNo);
        request.input('BuyItemId', item.ItemId);
        request.input('BuyDay', item.Duration); // المدة (1, 7, 15, 30)
        request.input('UseGamePoint', 0);       // 0 = شراء بالكاش (Cash)
        request.input('IsNewAdd', 1);           // 1 = إضافة جديدة
        request.output('Result', sql.Int);      // لاستقبال نتيجة العملية

        // د. تحديد الـ SP المناسب حسب نوع العنصر
        let spName = 'GameDB.dbo.sp_BuyItem';
        if (item.ItemType === 11) { // 11 = أبطال (Heroes)
            spName = 'GameDB.dbo.sp_BuyItemHeroes';
        }

        // هـ. التنفيذ
        const result = await request.execute(spName);
        const returnCode = result.output.Result; // 0 = نجاح، 1 = رصيد غير كاف

        // و. معالجة النتيجة
        if (returnCode === 0) {
            // نجاح العملية
            
            // قراءة تكلفة الشراء من النتيجة لتسجيلها في السجلات (الـ SP يعيد جدولاً فيه ItemCash)
            // ملاحظة: الـ SP يحسب السعر بناءً على T_ItemInfo وليس Web_Shop
            const record = result.recordset && result.recordset.length > 0 ? result.recordset[0] : {};
            const cost = record.ItemCash || 0;

            // تسجيل العملية في Web_EconomyLog للمراقبة
            await pool.request()
                .input('u', userNo)
                .input('amt', cost)
                .input('desc', `Shop Buy: ${item.ItemName} (SP)`)
                .query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_EconomyLog 
                    (UserNo, ActionType, Amount, Currency, Description, LogDate)
                    VALUES (@u, 'SHOP_BUY', @amt, 'CASH', @desc, GETDATE())
                `);

            res.json({ status: 'success', message: `تم شراء ${item.ItemName} بنجاح` });
        } else if (returnCode === 1) {
            res.status(400).json({ message: 'رصيد الكاش غير كافٍ لإتمام العملية' });
        } else {
            res.status(500).json({ message: 'فشلت عملية الشراء لسبب غير معروف' });
        }

    } catch (err) {
        console.error('Buy Error:', err);
        res.status(500).json({ message: 'حدث خطأ في السيرفر أثناء الشراء' });
    }
};