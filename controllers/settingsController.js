const { poolPromise } = require('../config/db');

// 1. جلب الإعدادات العامة (متاح للجميع - للزوار والموقع)
exports.getPublicSettings = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT ConfigKey, ConfigValue FROM AdrenalineWeb.dbo.Web_Settings');

        // تحويل المصفوفة إلى كائن JSON بسيط
        // النتيجة ستكون مثل: { "ServerStatus": "Online", "DownloadLink": "..." }
        const settings = {};
        result.recordset.forEach(row => {
            settings[row.ConfigKey] = row.ConfigValue;
        });

        res.json({ status: 'success', settings: settings });

    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الإعدادات', error: err.message });
    }
};

// 2. تحديث إعداد معين (للأدمن فقط)
exports.updateSetting = async (req, res) => {
    const { key, value } = req.body;

    if (!key || value === undefined) {
        return res.status(400).json({ message: 'يجب إرسال اسم الإعداد وقيمته الجديدة' });
    }

    try {
        const pool = await poolPromise;
        
        // التحقق هل الإعداد موجود أصلاً؟
        const check = await pool.request()
            .input('k', key)
            .query('SELECT ConfigKey FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = @k');

        if (check.recordset.length === 0) {
            return res.status(404).json({ message: 'هذا الإعداد غير موجود في النظام' });
        }

        // التحديث
        await pool.request()
            .input('val', value)
            .input('k', key)
            .query('UPDATE AdrenalineWeb.dbo.Web_Settings SET ConfigValue = @val WHERE ConfigKey = @k');

        res.json({ status: 'success', message: `تم تحديث ${key} بنجاح` });

    } catch (err) {
        res.status(500).json({ message: 'فشل تحديث الإعدادات', error: err.message });
    }
};