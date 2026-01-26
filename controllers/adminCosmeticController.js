const { poolPromise, sql } = require('../config/db');

// 1. إضافة عنصر جديد (لون أو لقب)
exports.addCosmetic = async (req, res) => {
    const { name, type, value, priceRegular, priceGP, durationDays } = req.body;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('name', name)
            .input('type', type) // 'COLOR' أو 'TITLE'
            .input('value', value) // كود اللون (مثل FF0000) أو اللقب (مثل [GM])
            .input('priceReg', priceRegular || 0)
            .input('priceGP', priceGP || 0)
            .input('days', durationDays || 30)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_CosmeticShop 
                (Name, Type, Value, PriceRegular, PriceGP, DurationDays, IsActive)
                VALUES (@name, @type, @value, @priceReg, @priceGP, @days, 1)
            `);

        res.json({ status: 'success', message: 'تم إضافة العنصر بنجاح للمتجر' });
    } catch (err) {
        res.status(500).json({ message: 'فشل إضافة العنصر', error: err.message });
    }
};

// 2. تعديل حالة العنصر (تفعيل/تعطيل)
exports.toggleStatus = async (req, res) => {
    const { cosmeticId, isActive } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', cosmeticId)
            .input('active', isActive ? 1 : 0)
            .query("UPDATE AdrenalineWeb.dbo.Web_CosmeticShop SET IsActive = @active WHERE CosmeticID = @id");
        
        res.json({ status: 'success', message: 'تم تحديث حالة العنصر' });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في التحديث' });
    }
};

// 3. حذف عنصر نهائياً
exports.deleteCosmetic = async (req, res) => {
    const { cosmeticId } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', cosmeticId)
            .query("DELETE FROM AdrenalineWeb.dbo.Web_CosmeticShop WHERE CosmeticID = @id");
        
        res.json({ status: 'success', message: 'تم حذف العنصر نهائياً' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف' });
    }
};