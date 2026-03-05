const { poolPromise, sql } = require('../config/db');
const { rewardPointsOnPurchase } = require('../utils/rewardSystem'); // 👈 1. استدعاء ملف المكافآت
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

// ==========================================
// 2. شراء عنصر (محاكاة دقيقة لـ sp_BuyItem مع سعر الموقع)
// ==========================================
exports.buyItem = async (req, res) => {
    const { shopId } = req.body;
    const userNo = req.user.userNo || req.user.userId; 

    if (!shopId) return res.status(400).json({ message: 'رقم العنصر مطلوب' });

    try {
        const pool = await poolPromise;

        // 1. فحص سعة الحقيبة
        const invCheck = await pool.request()
            .input('u', userNo)
            .query("SELECT COUNT(*) as cnt FROM GameDB.dbo.T_UserItem WHERE UserNo = @u AND Status != 2");
        
        if (invCheck.recordset[0].cnt >= 240) {
            return res.status(400).json({ message: 'الحقيبة ممتلئة! يرجى حذف بعض العناصر.' });
        }

        // 2. بدء المعاملة المالية
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // سنستخدم هذا الـ Request لكل العمليات داخل الـ Transaction
            const reqTx = transaction.request(); 

            // أ. جلب بيانات السعر
            reqTx.input('sid', shopId);
            const shopItemQuery = await reqTx.query(`
                SELECT 
                    S.ShopID, S.ItemID, S.PriceGP, S.Duration, 
                    I.ItemName, I.ItemType, I.IsBaseItem, I.IsGrenade, 
                    I.NeedSlot, I.RestrictLevel, I.UseType
                FROM AdrenalineWeb.dbo.Web_Shop S
                INNER JOIN GameDB.dbo.T_ItemInfo I ON S.ItemID = I.ItemId
                WHERE S.ShopID = @sid AND S.IsActive = 1
            `);

            if (shopItemQuery.recordset.length === 0) throw new Error('العنصر غير موجود أو تم حذفه');
            const item = shopItemQuery.recordset[0];

            // ب. فحص رصيد اللاعب
            reqTx.input('uid', userNo); // نعيد إدخال المتغيرات للـ Request المشترك
            const userWallet = await reqTx.query("SELECT GameMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");

            if (userWallet.recordset.length === 0) throw new Error('حساب اللاعب غير موجود');

            const currentMoney = userWallet.recordset[0].GameMoney;

            if (currentMoney < item.PriceGP) {
                throw new Error(`رصيدك غير كافٍ. تحتاج ${item.PriceGP} GP`);
            }

            // ج. خصم المبلغ
            reqTx.input('price', item.PriceGP);
            const deductResult = await reqTx.query("UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney - @price WHERE UserNo = @uid AND GameMoney >= @price");
            
            // إذا كانت نتيجة الخصم 0 (أي أن الرصيد لم يكن كافياً لحظة التنفيذ الفعلي)، نلغي العملية
            if (deductResult.rowsAffected[0] === 0) {
                throw new Error('رصيدك غير كافٍ لإتمام هذه العملية (تم منع محاولة تلاعب).');
            }
            // د. إضافة العنصر
            const endDateQuery = item.Duration > 0 ? `DATEADD(DAY, ${item.Duration}, GETDATE())` : `'2099-01-01'`; 
            const sealVal = 0; 
            
            // تجهيز المتغيرات للإدخال
            reqTx.input('iid', item.ItemID);
            reqTx.input('itype', item.ItemType || 0);
            reqTx.input('isbase', item.IsBaseItem || 0);
            reqTx.input('isgrenade', item.IsGrenade || 0);
            reqTx.input('slot', item.NeedSlot || 0);
            reqTx.input('level', item.RestrictLevel || 0);
            reqTx.input('usetype', item.UseType || 0);
            reqTx.input('seal', sealVal);

            await reqTx.query(`
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

            // هـ. تسجيل العملية (Economy Log)
            try {
                // نستخدم نفس reqTx لأنه يحمل parameters بالفعل (uid, price) لكن نحتاج إضافة item name
                reqTx.input('item', item.ItemName);
                await reqTx.query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_EconomyLog 
                    (UserNo, ActionType, Amount, Currency, Description, LogDate)
                    VALUES (@uid, 'SHOP_BUY', @price, 'GP', @item, GETDATE())
                `);
            } catch (e) { /* تجاهل أخطاء السجل */ }

            // =========================================================
            // 👈 و. منح نقاط الولاء (الجديد)
            // نمرر نفس reqTx لضمان أن العملية تتم داخل نفس الـ Transaction
            // =========================================================
            await rewardPointsOnPurchase(reqTx, userNo, item.PriceGP);

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