const { poolPromise } = require('../config/db');

exports.getLauncherInfo = async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // جلب الإعدادات الخاصة باللانشر فقط من قاعدة البيانات
        const result = await pool.request().query(`
            SELECT ConfigKey, ConfigValue 
            FROM AdrenalineWeb.dbo.Web_Settings 
            WHERE ConfigKey IN ('server_status', 'server_ip', 'server_port', 'latest_version', 'update_url', 'maintenance_message')
        `);

        // تحويل المصفوفة إلى كائن JSON الذي ينتظره اللانشر (VB.NET)
        const info = {};
        result.recordset.forEach(row => {
            info[row.ConfigKey] = row.ConfigValue;
        });

        // بناء الاستجابة مع وضع قيم افتراضية في حال لم تكن موجودة في الداتابيز بعد
        const response = {
            server_status: info['server_status'] || 'online',
            server_ip: info['server_ip'] || '26.52.35.64',
            server_port: info['server_port'] || '20200',
            latest_version: info['latest_version'] || '1',
            update_url: info['update_url'] || 'http://yourdomain.com/update.zip',
            maintenance_message: info['maintenance_message'] || 'السيرفر في حالة صيانة. نعود قريباً!'
        };

        // إرسال البيانات للانشر
        res.json(response);

    } catch (err) {
        console.error('خطأ في جلب بيانات اللانشر:', err.message);
        res.status(500).json({ message: 'حدث خطأ داخلي في الخادم' });
    }
};