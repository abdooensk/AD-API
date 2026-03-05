const { poolPromise, sql } = require('../config/db');
const crypto = require('crypto'); // 👈 ضروري لتشفير كلمات المرور

// دالة مساعدة لتشفير كلمة المرور (يجب أن تطابق المستخدمة في authController)
const hashPassword = (password) => {
    return crypto.createHash('sha512').update(password).digest('hex').toUpperCase();
};

// 1. جلب بيانات البروفايل
exports.getProfile = async (req, res) => {
    try {
        const pool = await poolPromise;
        const userNo = req.user.userNo; 

        const result = await pool.request()
            .input('id', userNo)
            .query(`
                SELECT 
                    U.Nickname,
                    U.Level,
                    U.Exp,
                    U.GameMoney AS Money,
                    U.CashMoney AS GP,
                    U.TotalWinCount,
                    U.TotalLoseCount,
                    U.TotalKillCount,
                    U.TotalDeathCount,
                    U.RegDate,
                    (SELECT TOP 1 C.ClanName FROM ClanDB.dbo.T_Clan C WHERE C.ClanNo = U.ClanNo) AS ClanName,
                    
                    -- جلب نقاط الولاء (LoyaltyPoints)
                    ISNULL((SELECT TOP 1 A.LoyaltyPoints FROM AuthDB.dbo.T_Account A WHERE A.UserNo = U.UserNo), 0) AS LoyaltyPoints
                FROM GameDB.dbo.T_User U
                WHERE U.UserNo = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'بيانات اللاعب غير موجودة' });
        }

        const playerData = result.recordset[0];

        const kdRatio = playerData.TotalDeathCount === 0 
            ? playerData.TotalKillCount 
            : (playerData.TotalKillCount / playerData.TotalDeathCount).toFixed(2);

        res.json({
            status: 'success',
            player: {
                ...playerData,
                kdRatio: kdRatio
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'خطأ في جلب البيانات' });
    }
};

// 2. تغيير كلمة المرور (مع التشفير 🔒)
exports.changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userNo = req.user.userNo;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ message: 'يجب إدخال كلمة المرور القديمة والجديدة' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'كلمة المرور الجديدة قصيرة جداً' });
    }

    try {
        const pool = await poolPromise;

        const checkPass = await pool.request()
            .input('uid', userNo)
            .query('SELECT Password FROM AuthDB.dbo.T_Account WHERE UserNo = @uid');

        const currentAccount = checkPass.recordset[0];

        if (!currentAccount) {
            return res.status(404).json({ message: 'الحساب غير موجود' });
        }

        // 1. التحقق من القديمة (مشفّرة)
        const oldHash = hashPassword(oldPassword);
        if (currentAccount.Password !== oldHash) {
            return res.status(400).json({ message: 'كلمة المرور القديمة غير صحيحة' });
        }

        // 2. تحديث الجديدة (مشفّرة)
        const newHash = hashPassword(newPassword);
        
        // استخدام Transaction لضمان تنفيذ العمليتين معاً
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        try {
            const request = new sql.Request(transaction);
            
            // أ. تغيير كلمة المرور
            await request
                .input('uid', userNo)
                .input('newPass', newHash)
                .query('UPDATE AuthDB.dbo.T_Account SET Password = @newPass WHERE UserNo = @uid');
                
            // ب. 👈 إنهاء جميع الجلسات النشطة لهذا الحساب (طرد الجميع بما فيهم المستخدم الحالي)
            await request
                .input('uid_session', userNo)
                .query('UPDATE AdrenalineWeb.dbo.Web_LoginSessions SET IsActive = 0 WHERE UserNo = @uid_session');
                
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
        res.json({ status: 'success', message: 'تم تغيير كلمة المرور بنجاح' });

    } catch (err) {
        console.error('Password Change Error:', err);
        res.status(500).json({ message: 'فشل تغيير كلمة المرور', error: err.message });
    }
};

// 3. عرض حالة الحظر
exports.getBanStatus = async (req, res) => {
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;
        
        const banInfo = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT TOP 1 Reason, BanDate, BannedBy 
                FROM AdrenalineWeb.dbo.Web_BanLog 
                WHERE UserNo = @uid AND IsActive = 1 
                ORDER BY BanID DESC
            `);

        const requestInfo = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT TOP 1 Status, FineAmount, RequestDate 
                FROM AdrenalineWeb.dbo.Web_UnbanRequests 
                WHERE UserNo = @uid 
                ORDER BY RequestID DESC
            `);

        res.json({
            status: 'success',
            isBanned: req.user.isBanned,
            banDetails: banInfo.recordset[0] || null,
            lastRequest: requestInfo.recordset[0] || null
        });

    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب المعلومات' });
    }
};

// 4. طلب فك الحظر
// 4. طلب فك الحظر (النسخة الآمنة - خصم CashMoney)
exports.requestUnban = async (req, res) => {
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;
        // 1. جلب قيمة الغرامة من الإعدادات
        const settingsRes = await pool.request()
            .query("SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'UnbanFine'");
        
        const fineAmount = settingsRes.recordset[0] ? parseInt(settingsRes.recordset[0].ConfigValue) : 5000;

        // 2. التحقق من وجود طلب معلق
        const checkPending = await pool.request()
            .input('uid', userNo)
            .query("SELECT RequestID FROM AdrenalineWeb.dbo.Web_UnbanRequests WHERE UserNo = @uid AND Status = 'Pending'");
        
        if (checkPending.recordset.length > 0) {
            return res.status(400).json({ message: 'لديك طلب قيد المراجعة بالفعل، يرجى الانتظار' });
        }

        // 3. التحقق من رصيد اللاعب (👈 التعديل هنا: نتحقق من CashMoney)
        const userCheck = await pool.request()
            .input('uid', userNo)
            .query("SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");

        if (userCheck.recordset.length === 0) {
            return res.status(404).json({ message: 'بيانات اللاعب غير موجودة' });
        }

        const currentMoney = userCheck.recordset[0].CashMoney; // 👈 التعديل هنا
        if (currentMoney < fineAmount) {
            return res.status(400).json({ message: `رصيدك غير كافٍ. تحتاج إلى ${fineAmount} كاش (GP) لتقديم الطلب.` });
        }

        // 4. استخدام Transaction لضمان خصم الرصيد وتسجيل الطلب معاً بدون أخطاء
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // أ. خصم الغرامة فوراً (👈 التعديل هنا: الخصم من CashMoney)
            await request
                .input('uid', userNo)
                .input('fine', fineAmount)
                .query("UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney - @fine WHERE UserNo = @uid");

            // ب. إدراج الطلب في قاعدة البيانات
            await request
                .input('uid_req', userNo)
                .input('fine_req', fineAmount)
                .query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_UnbanRequests (UserNo, FineAmount, Status, RequestDate)
                    VALUES (@uid_req, @fine_req, 'Pending', GETDATE())
                `);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم إرسال طلب فك الحظر وخصم كاش الغرامة بنجاح كعربون. سيقوم الأدمن بمراجعته.' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error('Unban Request Error:', err);
        res.status(500).json({ message: 'فشل إرسال الطلب', error: err.message });
    }
};

// 5. عرض الجلسات النشطة 🆕
exports.getActiveSessions = async (req, res) => {
    const userNo = req.user.userNo;
    const currentSessionId = req.user.sessionId; // القادمة من التوكن الحالي

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT SessionID, IPAddress, DeviceName, LoginDate, LastActive, IsActive 
                FROM AdrenalineWeb.dbo.Web_LoginSessions 
                WHERE UserNo = @uid AND IsActive = 1
                ORDER BY LoginDate DESC
            `);

        // وضع علامة على الجلسة الحالية
        const sessions = result.recordset.map(s => ({
            ...s,
            isCurrent: s.SessionID === currentSessionId
        }));

        res.json({ status: 'success', sessions });

    } catch (err) {
        res.status(500).json({ message: 'فشل جلب الجلسات' });
    }
};

// 6. تسجيل الخروج من الجلسات (Revoke) 🆕
exports.revokeSession = async (req, res) => {
    const userNo = req.user.userNo;
    const { sessionId, revokeAll } = req.body; 

    try {
        const pool = await poolPromise;
        const reqDb = pool.request().input('uid', userNo);

        if (revokeAll) {
            // طرد الجميع ما عدا الجلسة الحالية 
            reqDb.input('currentSid', req.user.sessionId);
            await reqDb.query("UPDATE AdrenalineWeb.dbo.Web_LoginSessions SET IsActive = 0 WHERE UserNo = @uid AND SessionID != @currentSid");
            res.json({ status: 'success', message: 'تم تسجيل الخروج من جميع الأجهزة الأخرى بنجاح' });
        } else {
            if (!sessionId) return res.status(400).json({ message: 'رقم الجلسة مطلوب' });
            
            // طرد جهاز محدد
            reqDb.input('sid', sessionId);
            const result = await reqDb.query("UPDATE AdrenalineWeb.dbo.Web_LoginSessions SET IsActive = 0 WHERE UserNo = @uid AND SessionID = @sid");
            
            if (result.rowsAffected[0] === 0) {
                 return res.status(404).json({ message: 'الجلسة غير موجودة أو منتهية' });
            }

            res.json({ status: 'success', message: 'تم إنهاء الجلسة بنجاح' });
        }

    } catch (err) {
        res.status(500).json({ message: 'فشل العملية' });
    }
};