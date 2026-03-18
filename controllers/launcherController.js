const { poolPromise, sql } = require('../config/db');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

// 1. إصدار كلمة السر المؤقتة (Challenge) للانشر
exports.handshake = async (req, res) => {
    try {
        // نص عشوائي
        const randomString = crypto.randomBytes(16).toString('hex');
        
        // نوقع النص بتوكن ينتهي بعد 60 ثانية فقط!
        const challengeToken = jwt.sign({ challenge: randomString }, JWT_SECRET, { expiresIn: '60s' });
        
        res.json({ status: 'success', challenge: challengeToken });
    } catch (err) {
        res.status(500).json({ message: 'Server error during handshake' });
    }
};

// 2. التحقق من الهاش الديناميكي وإصدار توكن الدخول للعبة
exports.generateTokenSecure = async (req, res) => {
    const { challenge, files } = req.body;
    
    if (!challenge || !files || !Array.isArray(files)) {
        return res.status(400).json({ message: 'Invalid payload (Hack Attempt)' });
    }

    try {
        // 1. التحقق من أن التحدي أصلي ولم تنتهِ صلاحيته (أقل من 60 ثانية)
        try {
            jwt.verify(challenge, JWT_SECRET);
        } catch (e) {
            return res.status(403).json({ message: 'Challenge expired or invalid. Please click start again.' });
        }

        const challengeUsedByLauncher = challenge; // هذا ما استخدمه اللانشر للدمج

        const pool = await poolPromise;
        
        // 2. جلب الهاشات الأصلية الرسمية للملفات الحساسة من قاعدة البيانات
        // التعديل الصحيح بناءً على قاعدة بياناتك
        const dbFiles = await pool.request()
          .query("SELECT FileName, FileHash FROM AdrenalineWeb.dbo.Web_GameFiles WHERE IsCritical = 1");

        const expectedHashes = {};
        dbFiles.recordset.forEach(f => {
            expectedHashes[f.FileName.toLowerCase()] = f.FileHash.toLowerCase();
        });

        // 3. فحص كل ملف تم إرساله
        for (let i = 0; i < files.length; i++) {
            const clientFile = files[i].FileName.toLowerCase();
            const clientDynamicHash = files[i].DynamicHash.toLowerCase();

            const expectedOriginalHash = expectedHashes[clientFile];
            
            if (!expectedOriginalHash) continue; // ملف غير مهم

            // ⚠️ السر الأمني: السيرفر يقوم بحساب نفس المعادلة (الهاش الأصلي + التحدي)
            const stringToHash = expectedOriginalHash + challengeUsedByLauncher;
            const expectedDynamicHash = crypto.createHash('sha256').update(stringToHash).digest('hex').toLowerCase();

            // المقارنة!
            if (clientDynamicHash !== expectedDynamicHash) {
                console.log(`[Anti-Cheat] Dynamic Hash mismatch for file: ${clientFile}`);
                return res.status(403).json({ message: 'تم اكتشاف تعديل في ملفات اللعبة! يرجى إصلاح الملفات.' });
            }
        }

        // 4. الموافقة وإصدار توكن جلسة اللعب (لأن اللانشر اجتاز الاختبار بنجاح)
        const serverIp = process.env.GAME_SERVER_IP || "127.0.0.1";
        const serverPort = process.env.GAME_SERVER_PORT || "8080";
        const playToken = crypto.randomBytes(16).toString('hex');

        // (اختياري) يمكنك هنا حفظ الـ playToken في جدول الجلسات إذا أردت تتبعه

        res.json({
            status: 'success',
            token: playToken,
            server_ip: serverIp,
            server_port: serverPort
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error during secure authentication' });
    }
};

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
// controllers/launcherController.js

// ================= تحديث النبضة (لتتوافق مع الحماية) =================
exports.heartbeat = async (req, res) => {
    // لم نعد نستقبل الهاش هنا
    const { token, memory_checksum } = req.body; 
    
    if (!token) return res.status(400).json({ success: false, message: 'No token provided' });

    try {
        const pool = await poolPromise;
        const currentTime = new Date().toISOString();

        // 1. فحص سلامة الذاكرة (Memory)
        if (memory_checksum !== "INTERNAL_AC_ACTIVE") {
            console.log(`[حماية الذاكرة] تلاعب مكتشف للتوكن: ${token}`);
            return res.json({ success: false, action: 'kill' }); 
        }

        // 2. تحديث النبضة مباشرة لكي لا يطرد اللاعب
        const result = await pool.request()
            .input('t', token)
            .input('currentTime', currentTime)
            .query(`
                UPDATE AdrenalineWeb.dbo.Web_LaunchTokens 
                SET LastHeartbeat = @currentTime 
                WHERE TokenString = @t AND IsValid = 1
            `);

        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Heartbeat received' });
        } else {
            // يتم طرده فقط إذا التوكن غير موجود أو انتهت صلاحيته
            res.status(401).json({ success: false, action: 'kill' });
        }
    } catch (err) {
        console.error('Heartbeat Error:', err.message);
        res.status(500).json({ success: false });
    }
};

// ================= 🔴 الدالة الجديدة: معاقبة الغشاشين =================
exports.banPlayer = async (req, res) => {
    const { token, violation } = req.body;
    if (!token) return res.status(400).json({ success: false });

    try {
        const pool = await poolPromise;
        
        console.log(`[نظام الحماية] تم اكتشاف غش! السبب: ${violation} - التوكن: ${token}`);

        // 1. جلب رقم حساب اللاعب
        const sessionInfo = await pool.request()
            .input('t', token)
            .query('SELECT AccountID FROM AdrenalineWeb.dbo.Web_LaunchTokens WHERE TokenString = @t AND IsValid = 1');

        // 2. إبطال التوكن
        await pool.request()
            .input('t', token)
            .query('UPDATE AdrenalineWeb.dbo.Web_LaunchTokens SET IsValid = 0 WHERE TokenString = @t');

        // 3. طرد اللاعب وحظر حسابه
        if (sessionInfo.recordset.length > 0 && sessionInfo.recordset[0].AccountID) {
            const accId = sessionInfo.recordset[0].AccountID;
            
            // طرد من اللعبة
            await pool.request()
                .input('acc', accId)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM GameDB.dbo.DisconnectList WHERE UserNo = @acc)
                    BEGIN
                        INSERT INTO GameDB.dbo.DisconnectList (UserNo, DateAdded) VALUES (@acc, GETDATE())
                    END
                `);
                
            // 🔴 حظر الحساب نهائياً (Ban) - يمكنك تفعيل هذا السطر إذا أردت الحظر الدائم
            // await pool.request().input('acc', accId).query('UPDATE GameDB.dbo.Users SET IsBanned = 1 WHERE UserNo = @acc');
        }

        // إرسال أمر إعدام اللعبة لملف الـ DLL
        res.json({ success: true, action: 'kill' });
    } catch (err) {
        console.error('Ban Error:', err.message);
        res.status(500).json({ success: false });
    }
};