const { poolPromise, sql } = require('../config/db');

// 1. إضافة حزمة جديدة (مع 3 أسلحة اختيارية)
exports.createPack = async (req, res) => {
    const { 
        name, price, baseCash, bonusCash, 
        itemId1, itemDays1, 
        itemId2, itemDays2, 
        itemId3, itemDays3 
    } = req.body;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('name', sql.NVarChar, name)
            .input('price', sql.Decimal(10, 2), price)
            .input('base', sql.Int, baseCash)
            .input('bonus', sql.Int, bonusCash || 0)
            
            // الهدايا الثلاث (نضع 0 كقيمة افتراضية إذا لم يتم إرسالها)
            .input('id1', sql.Int, itemId1 || 0).input('d1', sql.Int, itemDays1 || 0)
            .input('id2', sql.Int, itemId2 || 0).input('d2', sql.Int, itemDays2 || 0)
            .input('id3', sql.Int, itemId3 || 0).input('d3', sql.Int, itemDays3 || 0)

            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_PaymentPacks 
                (
                    PackName, PriceUSD, BaseCash, BonusCash, 
                    BonusItemID1, BonusItemDays1, 
                    BonusItemID2, BonusItemDays2, 
                    BonusItemID3, BonusItemDays3, 
                    IsActive
                )
                VALUES 
                (
                    @name, @price, @base, @bonus, 
                    @id1, @d1, 
                    @id2, @d2, 
                    @id3, @d3, 
                    1
                )
            `);

        res.json({ status: 'success', message: 'تم إنشاء الحزمة والعروض بنجاح' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الإنشاء', error: err.message });
    }
};

// 2. تعديل حزمة (تحديث الأسعار أو الهدايا)
exports.updatePack = async (req, res) => {
    // يمكنك إرسال فقط البيانات التي تريد تعديلها
    const { 
        packId, price, bonusCash, isActive,
        itemId1, itemDays1, itemId2, itemDays2, itemId3, itemDays3 
    } = req.body;

    try {
        const pool = await poolPromise;
        
        // بناء جملة التحديث ديناميكياً بناءً على ما تم إرساله (للتسهيل سنحدث الكل هنا)
        await pool.request()
            .input('id', sql.Int, packId)
            .input('price', sql.Decimal(10, 2), price)
            .input('bonus', sql.Int, bonusCash)
            .input('active', sql.Bit, isActive)
            .input('id1', sql.Int, itemId1).input('d1', sql.Int, itemDays1)
            .input('id2', sql.Int, itemId2).input('d2', sql.Int, itemDays2)
            .input('id3', sql.Int, itemId3).input('d3', sql.Int, itemDays3)
            .query(`
                UPDATE AdrenalineWeb.dbo.Web_PaymentPacks 
                SET PriceUSD = @price, BonusCash = @bonus, IsActive = @active,
                    BonusItemID1 = @id1, BonusItemDays1 = @d1,
                    BonusItemID2 = @id2, BonusItemDays2 = @d2,
                    BonusItemID3 = @id3, BonusItemDays3 = @d3
                WHERE PackID = @id
            `);

        res.json({ status: 'success', message: 'تم تحديث الحزمة' });
    } catch (err) {
        res.status(500).json({ message: 'فشل التحديث', error: err.message });
    }
};

// 3. عرض كل الحزم
exports.getAllPacks = async (req, res) => {
    try {
        const pool = await poolPromise;
        // إذا كان أدمن يرى الكل، وإذا لاعب يرى فقط المفعل
        const query = (req.user && req.user.isAdmin)
            ? "SELECT * FROM AdrenalineWeb.dbo.Web_PaymentPacks"
            : "SELECT * FROM AdrenalineWeb.dbo.Web_PaymentPacks WHERE IsActive = 1";
            
        const result = await pool.request().query(query);
        res.json({ status: 'success', packs: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الحزم' });
    }
};

// 4. حذف حزمة
exports.deletePack = async (req, res) => {
    const { packId } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('id', packId).query("DELETE FROM AdrenalineWeb.dbo.Web_PaymentPacks WHERE PackID = @id");
        res.json({ status: 'success', message: 'تم حذف الحزمة' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف' });
    }
};