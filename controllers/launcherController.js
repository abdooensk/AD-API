// controllers/launcherController.js
const { poolPromise } = require('../config/db');
const crypto = require('crypto'); // 🔴 إضافة مكتبة التشفير
exports.getLauncherInfo = async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // تم إضافة 'game_website' إلى قائمة المفاتيح المطلوبة من قاعدة البيانات
        const result = await pool.request().query(`
            SELECT ConfigKey, ConfigValue 
            FROM AdrenalineWeb.dbo.Web_Settings 
            WHERE ConfigKey IN ('server_status', 'server_ip', 'server_port', 'latest_version', 'update_url', 'maintenance_message', 'game_website')
        `);

        // تحويل المصفوفة إلى كائن JSON
        const info = {};
        result.recordset.forEach(row => {
            info[row.ConfigKey] = row.ConfigValue;
        });

        // بناء الاستجابة مع المتغير الجديد
        const response = {
            server_status: info['server_status'] || 'online',
            server_ip: info['server_ip'] || '26.52.35.64',
            server_port: info['server_port'] || '20200',
            latest_version: info['latest_version'] || '1',
            update_url: info['update_url'] || 'http://yourdomain.com/update.zip',
            maintenance_message: info['maintenance_message'] || 'السيرفر في حالة صيانة. نعود قريباً!',
            game_website: info['game_website'] || 'https://www.your-adrenaline-game-site.com' // القيمة الافتراضية
        };

        // إرسال البيانات للانشر
        res.json(response);

    } catch (err) {
        console.error('خطأ في جلب بيانات اللانشر:', err.message);
        res.status(500).json({ message: 'حدث خطأ داخلي في الخادم' });
    }
};


exports.generateLaunchToken = async (req, res) => {
    try {
        const pool = await poolPromise;
        const token = crypto.randomBytes(32).toString('hex'); 
        
        // التقاط الـ IP الخاص باللاعب من الطلب (Request)
        let userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (userIp.substr(0, 7) === "::ffff:") { userIp = userIp.substr(7); } // تنظيف الـ IPv6

        // إنشاء جلسة باسم هذا الـ IP وترك AccountID فارغاً
        await pool.request()
            .input('token', token)
            .input('ip', userIp)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_LaunchTokens (TokenString, IpAddress, CreatedAt, LastHeartbeat, IsValid) 
                VALUES (@token, @ip, GETDATE(), GETDATE(), 1)
            `);

        res.json({ success: true, token: token });
    } catch (err) {
        console.error('خطأ:', err.message);
        res.status(500).json({ success: false });
    }
};
// controllers/launcherController.js

// 🔴 الدالة الجديدة: إغلاق الجلسة فوراً عند خروج اللانشر
exports.closeSession = async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'No token provided' });

    try {
        const pool = await poolPromise;

        // 1. جلب رقم حساب اللاعب المربوط بهذا التوكن (قبل أن نلغيه)
        const sessionInfo = await pool.request()
            .input('t', token)
            .query('SELECT AccountID FROM AdrenalineWeb.dbo.Web_LaunchTokens WHERE TokenString = @t AND IsValid = 1');

        // 2. إبطال التوكن فوراً
        await pool.request()
            .input('t', token)
            .query('UPDATE AdrenalineWeb.dbo.Web_LaunchTokens SET IsValid = 0 WHERE TokenString = @t');

        // 3. طرد اللاعب من اللعبة فوراً (إذا كان قد سجل دخوله بالفعل)
        if (sessionInfo.recordset.length > 0 && sessionInfo.recordset[0].AccountID) {
            const accId = sessionInfo.recordset[0].AccountID;
            await pool.request()
                .input('acc', accId)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM GameDB.dbo.DisconnectList WHERE UserNo = @acc)
                    BEGIN
                        INSERT INTO GameDB.dbo.DisconnectList (UserNo, DateAdded) VALUES (@acc, GETDATE())
                    END
                `);
        }

        res.json({ success: true, message: 'Session closed and player kicked.' });
    } catch (err) {
        console.error('Error closing session:', err.message);
        res.status(500).json({ success: false });
    }
};
exports.getGameFiles = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT FileName, FileHash, IsCritical FROM AdrenalineWeb.dbo.Web_GameFiles');
        
        res.json({ success: true, files: result.recordset });
    } catch (err) {
        console.error('Error fetching game files:', err.message);
        res.status(500).json({ success: false, message: 'فشل جلب بيانات الحماية' });
    }
};
// تحديث النبضة (Heartbeat) القادمة من اللعبة/الجسر
// تحديث النبضة (Heartbeat) القادمة من اللعبة/الجسر
exports.heartbeat = async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'No token provided' });

    try {
        const pool = await poolPromise;
        
        // 🔴 استخدام توقيت السيرفر بدلاً من توقيت قاعدة البيانات
        const currentTime = new Date().toISOString();

        const result = await pool.request()
            .input('t', token)
            .input('currentTime', currentTime) // تمرير التوقيت كمتغير
            .query(`
                UPDATE AdrenalineWeb.dbo.Web_LaunchTokens 
                SET LastHeartbeat = @currentTime 
                WHERE TokenString = @t AND IsValid = 1
            `);

        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Heartbeat received' });
        } else {
            res.status(401).json({ success: false, message: 'Invalid or expired token' });
        }
    } catch (err) {
        console.error('Heartbeat Error:', err.message);
        res.status(500).json({ success: false });
    }
};