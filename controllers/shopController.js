const { poolPromise, sql } = require('../config/db');

// ==========================================
// 1. عرض عناصر المتجر
// ==========================================
exports.getShopItems = async (req, res) => {
    const { category } = req.query;

    try {
        const pool = await poolPromise;
        let query = `
            SELECT 
                S.ShopID, S.ItemID, S.PriceGP, S.Duration, S.Category, S.IsHot, S.IsNew,
                I.ItemName,
                CAST(I.ItemId AS VARCHAR) + '.png' AS ImageURL,
                I.ItemType -- نحتاجه للعرض
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

// ==========================================
// 2. شراء عنصر (محاكاة دقيقة لـ sp_BuyItem مع سعر الموقع)
// ==========================================
exports.buyItem = async (req, res) => {
    const { shopId } = req.body;
    const userNo = req.user.userNo || req.user.userId; 

    if (!shopId) return res.status(400).json({ message: 'رقم العنصر مطلوب' });

    try {
        const pool = await poolPromise;

        // ---------------------------------------------------------
        // 1. فحص سعة الحقيبة (إجراء حماية إضافي)
        // ---------------------------------------------------------
        const invCheck = await pool.request()
            .input('u', userNo)
            .query("SELECT COUNT(*) as cnt FROM GameDB.dbo.T_UserItem WHERE UserNo = @u AND Status != 2");
        
        if (invCheck.recordset[0].cnt >= 240) {
            return res.status(400).json({ message: 'الحقيبة ممتلئة! يرجى حذف بعض العناصر.' });
        }

        // ---------------------------------------------------------
        // 2. بدء المعاملة المالية (Transaction)
        // ---------------------------------------------------------
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // أ. جلب بيانات السعر من Web_Shop (شرطك الأساسي)
            // وجلب بيانات "T_ItemInfo" لمحاكاة الـ SP (ItemType, UseType, etc)
            const shopItemQuery = await transaction.request()
                .input('sid', shopId)
                .query(`
                    SELECT 
                        -- بيانات المتجر (السعر والمدة)
                        S.ShopID, S.ItemID, S.PriceGP, S.Duration, 
                        
                        -- بيانات اللعبة (للمحاكاة الدقيقة للـ SP)
                        I.ItemName, 
                        I.ItemType, 
                        I.IsBaseItem, 
                        I.IsGrenade, 
                        I.NeedSlot, 
                        I.RestrictLevel, 
                        I.UseType
                    FROM AdrenalineWeb.dbo.Web_Shop S
                    INNER JOIN GameDB.dbo.T_ItemInfo I ON S.ItemID = I.ItemId
                    WHERE S.ShopID = @sid AND S.IsActive = 1
                `);

            if (shopItemQuery.recordset.length === 0) throw new Error('العنصر غير موجود أو تم حذفه');
            const item = shopItemQuery.recordset[0];

            // ب. فحص رصيد اللاعب
            // (بما أننا نستخدم PriceGP، فالعملة هي GameMoney أي الذهب)
            const userWallet = await transaction.request()
                .input('uid', userNo)
                .query("SELECT GameMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");

            if (userWallet.recordset.length === 0) throw new Error('حساب اللاعب غير موجود');

            const currentMoney = userWallet.recordset[0].GameMoney;

            if (currentMoney < item.PriceGP) {
                throw new Error(`رصيدك غير كافٍ. تحتاج ${item.PriceGP} GP`);
            }

            // ج. خصم المبلغ (تحديث الرصيد)
            await transaction.request()
                .input('price', item.PriceGP)
                .input('uid', userNo)
                .query("UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney - @price WHERE UserNo = @uid");

            // د. إضافة العنصر (Insert يحاكي sp_BuyItem تماماً)
            
            // 1. حساب تاريخ الانتهاء
            const endDateQuery = item.Duration > 0 
                ? `DATEADD(DAY, ${item.Duration}, GETDATE())` 
                : `'2099-01-01'`; 

            // 2. منطق الختم (SealVal)
            // حسب الـ SP: إذا كان الشراء بالذهب (UseGamePoint=1) فإن SealVal = 0
            // بما أننا نبيع بـ GP، فالقيمة 0. لو كنا نبيع بـ Cash، تكون 1.
            const sealVal = 0; 

            // 3. القيم الافتراضية (ISNULL كما في الـ SP)
            const itemType = item.ItemType || 0;
            const isBaseItem = item.IsBaseItem || 0;
            const isGrenade = item.IsGrenade || 0;
            const needSlot = item.NeedSlot || 0;
            const restrictLevel = item.RestrictLevel || 0;
            const useType = item.UseType || 0;

            await transaction.request()
                .input('uid', userNo)
                .input('iid', item.ItemID)
                .input('itype', itemType)
                .input('isbase', isBaseItem)
                .input('isgrenade', isGrenade)
                .input('slot', needSlot)
                .input('level', restrictLevel)
                .input('usetype', useType)
                .input('seal', sealVal)
                .query(`
                    INSERT INTO GameDB.dbo.T_UserItem 
                    (
                        UserNo, ItemId, ItemType, IsBaseItem, Count, Status, 
                        StartDate, EndDate, 
                        IsGrenade, NeedSlot, IsPcBangItem, RestrictLevel, UseType, SealVal
                    )
                    VALUES 
                    (
                        @uid, @iid, @itype, @isbase, 1, 1, 
                        GETDATE(), ${endDateQuery}, 
                        @isgrenade, @slot, 0, @level, @usetype, @seal
                    )
                `);

            // هـ. تسجيل العملية (Web_EconomyLog)
            try {
                await transaction.request()
                    .input('uid', userNo)
                    .input('price', item.PriceGP)
                    .input('item', item.ItemName)
                    .query(`
                        INSERT INTO AdrenalineWeb.dbo.Web_EconomyLog 
                        (UserNo, ActionType, Amount, Currency, Description, LogDate)
                        VALUES (@uid, 'SHOP_BUY', @price, 'GP', @item, GETDATE())
                    `);
            } catch (e) { /* تجاهل أخطاء السجل */ }

            // إتمام العملية
            await transaction.commit();
            res.json({ status: 'success', message: `تم شراء ${item.ItemName} بنجاح!` });

        } catch (err) {
            await transaction.rollback();
            const msg = err.message.includes('رصيد') || err.message.includes('ممتلئة') 
                ? err.message 
                : 'فشل عملية الشراء';
            res.status(400).json({ message: msg });
        }

    } catch (err) {
        console.error('Buy Error:', err);
        res.status(500).json({ message: 'حدث خطأ في السيرفر' });
    }
};