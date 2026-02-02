const { poolPromise, sql } = require('../config/db');

// ==========================================
// 1. نظام "الجاسوس" وكشف التعدد (Multi-Account)
// ==========================================
exports.getMultiAccounts = async (req, res) => {
    const { nickname } = req.query; // نبحث باسم اللاعب

    if (!nickname) return res.status(400).json({ message: 'أدخل اسم اللاعب' });

    try {
        const pool = await poolPromise;

        // أ. نجلب رقم الـ IP الخاص باللاعب المستهدف
        const targetUser = await pool.request()
            .input('nick', nickname)
            .query(`
                SELECT UserNo, UserID, LastLoginIp, LastLoginDate 
                FROM GameDB.dbo.T_User 
                WHERE Nickname = @nick
            `);

        if (targetUser.recordset.length === 0) {
            return res.status(404).json({ message: 'اللاعب غير موجود' });
        }

        const targetIP = targetUser.recordset[0].LastLoginIp;

        if (!targetIP || targetIP === '') {
            return res.status(400).json({ message: 'هذا اللاعب لم يسجل دخول بعد، لا يوجد IP مسجل.' });
        }

        // ب. نجلب كل الحسابات التي تشترك في نفس الـ IP
        // نربط T_User مع T_Account لجلب حالة الحظر أيضاً
        const relatedAccounts = await pool.request()
            .input('ip', targetIP)
            .query(`
                SELECT 
                    U.UserNo, 
                    U.Nickname, 
                    U.Level, 
                    U.RegDate,
                    U.LastLoginDate,
                    A.IsBanned,
                    U.GameMoney,
                    U.CashMoney
                FROM GameDB.dbo.T_User U
                INNER JOIN AuthDB.dbo.T_Account A ON U.UserId = A.UserId
                WHERE U.LastLoginIp = @ip
                ORDER BY U.LastLoginDate DESC
            `);

        res.json({
            status: 'success',
            targetIP: targetIP,
            count: relatedAccounts.recordset.length,
            accounts: relatedAccounts.recordset
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'حدث خطأ في البحث' });
    }
};

// ==========================================
// 2. تعديل إحصائيات اللاعب (Stats Editor)
// ==========================================
exports.updatePlayerStats = async (req, res) => {
    const { targetUserNo, level, exp, gameMoney, cashMoney, isBanned } = req.body;
    const adminId = req.user.userId;

    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. تحديث بيانات GameDB (المستوى، الخبرة، الأموال)
            if (level || exp || gameMoney || cashMoney) {
                let query = "UPDATE GameDB.dbo.T_User SET ";
                let updates = [];
                
                // بناء الاستعلام ديناميكياً حسب القيم المرسلة
                if (level !== undefined) updates.push(`Level = ${parseInt(level)}`);
                if (exp !== undefined) updates.push(`Exp = ${parseInt(exp)}`);
                if (gameMoney !== undefined) updates.push(`GameMoney = ${parseInt(gameMoney)}`);
                if (cashMoney !== undefined) updates.push(`CashMoney = ${parseInt(cashMoney)}`);

                query += updates.join(", ") + " WHERE UserNo = @uid";

                await transaction.request()
                    .input('uid', targetUserNo)
                    .query(query);
            }

            // 2. تحديث حالة الحظر في AuthDB (Ban/Unban)
            if (isBanned !== undefined) {
                // نحتاج لمعرفة UserId أولاً لربط الجدولين
                const userMapping = await transaction.request()
                    .input('uid', targetUserNo)
                    .query("SELECT UserID FROM GameDB.dbo.T_User WHERE UserNo = @uid");
                
                if (userMapping.recordset.length > 0) {
                    const userId = userMapping.recordset[0].UserID;
                    await transaction.request()
                        .input('banned', isBanned ? 1 : 0)
                        .input('uid_str', userId)
                        .query("UPDATE AuthDB.dbo.T_Account SET IsBanned = @banned WHERE UserId = @uid_str");
                }
            }

            // 3. تسجيل العملية في سجلات الأدمن (للأمان)
            await transaction.request()
                .input('admin', adminId)
                .input('action', 'UPDATE_STATS')
                .input('target', targetUserNo.toString())
                .input('details', JSON.stringify(req.body))
                .input('ip', req.ip)
                .query("INSERT INTO AdrenalineWeb.dbo.Web_AdminLog (AdminID, Action, TargetUser, Details, IPAddress) VALUES (@admin, @action, @target, @details, @ip)");

            await transaction.commit();
            res.json({ status: 'success', message: 'تم تحديث بيانات اللاعب بنجاح' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل تحديث البيانات' });
    }
};

// ==========================================
// 3. التحكم في إعدادات السيرفر والإيفنتات
// ==========================================
exports.getServerConfig = async (req, res) => {
    try {
        const pool = await poolPromise;
        // قراءة الإعدادات من الجدول الموجود لديك T_ServerConfig
        const result = await pool.request().query(`
            SELECT TOP 1 
                EventExp, 
                EventMoney, 
                PcBang1PlayExp, 
                PcBang1PlayGameMoney,
                ClanWarPoint
            FROM GameDB.dbo.T_ServerConfig
        `);
        res.json({ status: 'success', config: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ message: 'فشل جلب الإعدادات' });
    }
};

exports.updateServerEvents = async (req, res) => {
    // يمكنك إرسال نسبة الزيادة، مثلاً: 200 تعني Double XP
    const { eventExp, eventMoney } = req.body;
    const adminId = req.user.userId;

    try {
        const pool = await poolPromise;
        
        await pool.request()
            .input('exp', eventExp)
            .input('money', eventMoney)
            .query("UPDATE GameDB.dbo.T_ServerConfig SET EventExp = @exp, EventMoney = @money");

        // تسجيل العملية
        await pool.request()
            .input('admin', adminId)
            .input('action', 'SERVER_EVENT')
            .input('details', `Exp: ${eventExp}%, Money: ${eventMoney}%`)
            .query("INSERT INTO AdrenalineWeb.dbo.Web_AdminLog (AdminID, Action, Details) VALUES (@admin, @action, @details)");

        res.json({ status: 'success', message: 'تم تحديث إعدادات الإيفنت بنجاح' });
    } catch (err) {
        res.status(500).json({ message: 'فشل التحديث' });
    }
};

// ==========================================
// 4. تقرير الأموال (Audit Logs)
// ==========================================
exports.getEconomyLogs = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT TOP 100 
                L.LogID, 
                U.Nickname, 
                L.ActionType, 
                L.Amount, 
                L.Currency, 
                L.LogDate, 
                L.Description 
            FROM AdrenalineWeb.dbo.Web_EconomyLog L
            LEFT JOIN GameDB.dbo.T_User U ON L.UserNo = U.UserNo
            ORDER BY L.LogDate DESC
        `);
        res.json({ status: 'success', logs: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'فشل جلب السجلات' });
    }
};
// ... (الأكواد السابقة: getMultiAccounts, updatePlayerStats, etc.)

// ==========================================
// 5. طرد لاعب أونلاين (Kick Player)
// ==========================================
exports.kickPlayer = async (req, res) => {
    const { userNo } = req.body;
    const adminId = req.user.userId;

    if (!userNo) return res.status(400).json({ message: 'يجب تحديد رقم اللاعب' });

    try {
        const pool = await poolPromise;
        
        // التحقق أولاً هل اللاعب موجود؟
        const check = await pool.request().input('u', userNo).query("SELECT Nickname FROM GameDB.dbo.T_User WHERE UserNo = @u");
        if (check.recordset.length === 0) return res.status(404).json({ message: 'اللاعب غير موجود' });

        const nickname = check.recordset[0].Nickname;

        // تنفيذ الطرد (إضافة لقائمة الفصل)
        await pool.request()
            .input('u', userNo)
            .query("INSERT INTO GameDB.dbo.DisconnectList (UserNo, DateAdded) VALUES (@u, GETDATE())");

        // تسجيل العملية
        await logAdminAction(adminId, 'KICK_PLAYER', `Kicked user: ${nickname} (${userNo})`);

        res.json({ status: 'success', message: `تم إرسال أمر الطرد للاعب ${nickname}. سيخرج خلال ثوانٍ.` });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل عملية الطرد' });
    }
};

// ==========================================
// 6. إدارة إشعارات السيرفر (Announcements)
// ==========================================
exports.addAnnouncement = async (req, res) => {
    const { message, minutes } = req.body; // الرسالة + مدة العرض بالدقيقة
    
    try {
        const pool = await poolPromise;
        
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + (minutes * 60000));

        await pool.request()
            .input('msg', message)
            .input('start', startTime)
            .input('end', endTime)
            .query(`
                INSERT INTO GameDB.dbo.NoticeInfo 
                (Notice, StartDate, EndDate, StartTime, EndTime, TodayOfWeek, Interval) 
                VALUES 
                (@msg, @start, @end, '00:00:00', '23:59:59', '1111111', 60)
            `);
            // Interval 60 = تظهر كل 60 ثانية
            // TodayOfWeek 1111111 = تظهر كل أيام الأسبوع

        res.json({ status: 'success', message: 'تم نشر الإشعار في اللعبة' });

    } catch (err) {
        res.status(500).json({ message: 'فشل نشر الإشعار' });
    }
};

// دالة لحذف كل الإشعارات الحالية (تنظيف)
exports.clearAnnouncements = async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().query("DELETE FROM GameDB.dbo.NoticeInfo");
        res.json({ status: 'success', message: 'تم حذف جميع الإشعارات' });
    } catch (err) {
        res.status(500).json({ message: 'فشل التنظيف' });
    }
};

// ==========================================
// 7. حظر الآي بي (IP Ban) - العقوبة القصوى
// ==========================================
exports.banIP = async (req, res) => {
    const { ipAddress, days } = req.body; // الآي بي + عدد الأيام
    const adminId = req.user.userId;

    if (!ipAddress) return res.status(400).json({ message: 'يجب تحديد عنوان IP' });

    try {
        const pool = await poolPromise;

        // تحويل الـ IP من نص (String) إلى رقم (BigInt) إذا كان الجدول يتطلب ذلك
        // ملاحظة: جدول T_IpFilterInfo في ملفاتك يستخدم BigInt للـ StartIp و EndIp
        // لكن للتبسيط، سأفترض أنك ستستخدم دالة SQL لتحويل الـ IP أو تدخله كنص إذا عدلت الجدول.
        // الكود أدناه يتعامل مع السيناريو الأسهل (إدخال مباشر إذا كان الجدول يدعم varchar أو التحويل).
        
        /* تنبيه: جداول اللعبة الأصلية تخزن الـ IP كـ أرقام (INET_ATON).
           إذا كانت لديك دالة SQL للتحويل استخدمها، وإلا سنستخدم معادلة بسيطة في JS.
        */
        
        // دالة مساعدة لتحويل IP إلى رقم (IPv4)
        const ipToLong = (ip) => {
            return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
        };

        const ipNum = ipToLong(ipAddress);

        await pool.request()
            .input('ipVal', ipNum)
            .query(`
                INSERT INTO GameDB.dbo.T_IpFilterInfo (Type, StartIp, EndIp, Count)
                VALUES (1, @ipVal, @ipVal, 1) 
            `); 
            // Type 1 = Block/Ban, Count = ? (قد يكون عداد المحاولات أو غيره، عادة 1 يكفي)

        await logAdminAction(adminId, 'IP_BAN', `Banned IP: ${ipAddress}`);

        res.json({ status: 'success', message: `تم حظر العنوان ${ipAddress} بنجاح` });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل حظر الـ IP' });
    }
};
exports.sendMemo = async (req, res) => {
    const { targetUserNo, message } = req.body;
    
    if (!targetUserNo || !message) return res.status(400).json({ message: 'البيانات ناقصة' });

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('u', targetUserNo)
            .input('m', message)
            .query("INSERT INTO GameDB.dbo.T_Memo (TargetUserNo, SenderName, Content, IsRead, RegDate, ExpireDate, Kind, GiftNo, SendUserNo) VALUES (@u, 'GM', @m, 0, GETDATE(), DATEADD(DAY, 7, GETDATE()), 0, 0, 0)");
        
        res.json({ status: 'success', message: 'تم إرسال الرسالة' });
    } catch (err) { 
        console.error(err); 
        res.status(500).json({ message: 'فشل الإرسال' }); 
    }
};

// ==========================================
// 9. تغيير رتبة اللاعب (Change GM Level)
// ==========================================
exports.changeGMLevel = async (req, res) => {
    const { targetUserNo, level } = req.body;
    const adminId = req.user.userId;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('u', targetUserNo)
            .input('l', level)
            .query("UPDATE GameDB.dbo.T_User SET GMGrade = @l WHERE UserNo = @u");

        await logAdminAction(adminId, 'CHANGE_GM', `Changed User ${targetUserNo} to Level ${level}`);
        res.json({ status: 'success', message: 'تم تعديل الرتبة' });
    } catch (err) { 
        res.status(500).json({ message: 'فشل التعديل' }); 
    }
};

// ==========================================
// 10. تغيير اسم اللاعب (Rename Player)
// ==========================================
exports.changePlayerName = async (req, res) => {
    const { targetUserNo, newName } = req.body;
    const adminId = req.user.userId;

    if (!newName) return res.status(400).json({ message: 'الاسم الجديد مطلوب' });

    try {
        const pool = await poolPromise;
        
        // التحقق من التكرار
        const check = await pool.request().input('n', newName).query("SELECT UserNo FROM GameDB.dbo.T_User WHERE Nickname = @n");
        if (check.recordset.length > 0) return res.status(400).json({ message: 'الاسم مستخدم بالفعل' });

        await pool.request()
            .input('u', targetUserNo)
            .input('n', newName)
            .query("UPDATE GameDB.dbo.T_User SET Nickname = @n WHERE UserNo = @u");

        await logAdminAction(adminId, 'RENAME', `Renamed User ${targetUserNo} to ${newName}`);
        res.json({ status: 'success', message: 'تم تغيير الاسم' });
    } catch (err) { 
        res.status(500).json({ message: 'فشل تغيير الاسم' }); 
    }
};
// دالة مساعدة للتسجيل (تأكد أنها موجودة أو مستوردة)
async function logAdminAction(adminId, action, details) {
    const pool = await poolPromise;
    await pool.request()
        .input('admin', adminId)
        .input('action', action)
        .input('details', details)
        .query("INSERT INTO AdrenalineWeb.dbo.Web_AdminLog (AdminID, Action, Details) VALUES (@admin, @action, @details)");
}