const { poolPromise, sql } = require('../config/db');

// 1. جلب إعدادات العجلة والعناصر
exports.getWheelConfig = async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // جلب السعر والعملة
        const settings = await pool.request().query(`
            SELECT ConfigKey, ConfigValue 
            FROM AdrenalineWeb.dbo.Web_Settings 
            WHERE ConfigKey IN ('Wheel_SpinPrice', 'Wheel_Currency')
        `);

        // جلب العناصر
        const items = await pool.request().query(`
            SELECT * FROM AdrenalineWeb.dbo.Web_WheelItems ORDER BY Probability DESC
        `);

        res.json({ 
            status: 'success', 
            settings: settings.recordset, 
            items: items.recordset 
        });
    } catch (err) {
        res.status(500).json({ message: 'فشل جلب البيانات', error: err.message });
    }
};

// 2. تحديث سعر التدوير
exports.updateWheelSettings = async (req, res) => {
    const { price, currency } = req.body; // currency: 'CASH' or 'GP'
    
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('price', price)
            .input('curr', currency)
            .query(`
                UPDATE AdrenalineWeb.dbo.Web_Settings SET ConfigValue = @price WHERE ConfigKey = 'Wheel_SpinPrice';
                UPDATE AdrenalineWeb.dbo.Web_Settings SET ConfigValue = @curr WHERE ConfigKey = 'Wheel_Currency';
            `);
        res.json({ status: 'success', message: 'تم تحديث إعدادات العجلة' });
    } catch (err) {
        res.status(500).json({ message: 'فشل التحديث' });
    }
};

// 3. إضافة أو تعديل عنصر في العجلة
exports.upsertWheelItem = async (req, res) => {
    const { id, itemName, itemId, count, type, amount, prob, isActive } = req.body;
    // type: 'ITEM', 'GP', 'REGULAR'
    
    try {
        const pool = await poolPromise;
        const request = pool.request()
            .input('name', itemName)
            .input('iid', itemId || 0)
            .input('cnt', count || 1)
            .input('type', type)
            .input('amt', amount || 0)
            .input('prob', prob || 10) // الاحتمالية
            .input('active', isActive ? 1 : 0);

        if (id) {
            // تحديث
            await request.input('id', id).query(`
                UPDATE AdrenalineWeb.dbo.Web_WheelItems
                SET ItemName=@name, ItemId=@iid, Count=@cnt, RewardType=@type, 
                    RewardAmount=@amt, Probability=@prob, IsActive=@active
                WHERE WheelItemID = @id
            `);
            res.json({ status: 'success', message: 'تم تعديل العنصر' });
        } else {
            // إضافة جديد
            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_WheelItems
                (ItemName, ItemId, Count, RewardType, RewardAmount, Probability, IsActive)
                VALUES (@name, @iid, @cnt, @type, @amt, @prob, @active)
            `);
            res.json({ status: 'success', message: 'تم إضافة العنصر' });
        }
    } catch (err) {
        res.status(500).json({ message: 'فشل حفظ العنصر' });
    }
};

// 4. حذف عنصر
exports.deleteWheelItem = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('id', id).query("DELETE FROM AdrenalineWeb.dbo.Web_WheelItems WHERE WheelItemID = @id");
        res.json({ status: 'success', message: 'تم حذف العنصر' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف' });
    }
};