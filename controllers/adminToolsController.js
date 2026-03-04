const { poolPromise, sql } = require('../config/db');
const crypto = require('crypto'); // ✅ صحيح: لأننا نستخدم crypto.createHash في الأسفل// ==========================================
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
// ==========================================
// 7. حظر الآي بي (IP Ban) - العقوبة القصوى
// ==========================================
exports.banIP = async (req, res) => {
    const { ipAddress } = req.body; 
    const adminId = req.user.userId;

    if (!ipAddress) return res.status(400).json({ message: 'يجب تحديد عنوان IP' });

    // دالة مساعدة لتحويل IP (x.x.x.x) إلى رقم صحيح (BigInt/Int)
    // هذا ضروري لأن جدول T_IpFilterInfo يخزن IPs كأرقام
    const ipToLong = (ip) => {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    };

    try {
        const pool = await poolPromise;
        const ipNum = ipToLong(ipAddress); // تحويل العنوان إلى رقم

        // 1. التحقق: هل هذا الـ IP محظور بالفعل؟
        const checkBan = await pool.request()
            .input('ipVal', ipNum)
            .query("SELECT Id FROM GameDB.dbo.T_IpFilterInfo WHERE StartIp = @ipVal AND EndIp = @ipVal");

        if (checkBan.recordset.length > 0) {
            return res.status(400).json({ message: 'هذا العنوان محظور بالفعل!' });
        }

        // 2. تنفيذ الحظر
        // Type = 1 (عادة يعني Ban/Block في ملفات GunZ)
        // نضع StartIp و EndIp نفس القيمة لحظره هو فقط
        await pool.request()
            .input('ipVal', ipNum)
            .query(`
                INSERT INTO GameDB.dbo.T_IpFilterInfo (Type, StartIp, EndIp, Count)
                VALUES (1, @ipVal, @ipVal, 1) 
            `); 

        // 3. تسجيل العملية
        await logAdminAction(adminId, 'IP_BAN', `Banned IP: ${ipAddress} (Val: ${ipNum})`);

        res.json({ status: 'success', message: `تم حظر العنوان ${ipAddress} بنجاح` });

    } catch (err) {
        console.error("IP Ban Error:", err);
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
// ==========================================
// 11. البحث العام عن اللاعبين (للوحة الأدمن)
// ==========================================
exports.searchUsers = async (req, res) => {
    const { query } = req.query; 
    
    if (!query || query.length < 2) {
        return res.status(400).json({ message: 'أدخل حرفين على الأقل للبحث' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('q', `%${query}%`) 
            .query(`
                SELECT TOP 20 
                    U.UserNo, 
                    U.UserId,     -- اسم الدخول (Username)
                    U.Nickname,   -- اسم اللاعب داخل اللعبة
                    U.Level, 
                    U.GMGrade,
                    A.IsBanned,
                    A.Email       -- البريد الإلكتروني
                FROM GameDB.dbo.T_User U
                INNER JOIN AuthDB.dbo.T_Account A ON U.UserNo = A.UserNo
                WHERE 
                   U.Nickname LIKE @q  -- البحث بالاسم
                   OR U.UserId LIKE @q -- أو باليوزر
                   OR A.Email LIKE @q  -- أو بالإيميل 👈 (الإضافة الجديدة)
                ORDER BY U.Level DESC
            `);

        res.json({ status: 'success', users: result.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل البحث' });
    }
};
exports.getUserDetails = async (req, res) => {
    const { userNo } = req.params;

    if (!userNo) return res.status(400).json({ message: 'رقم اللاعب مطلوب' });

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('u', userNo)
            .query(`
                SELECT 
                    U.UserNo, 
                    U.UserId,         -- اسم الدخول
                    U.Nickname,       -- اسم الشخصية
                    U.Level, 
                    U.Exp,
                    U.GameMoney,      -- الذهب
                    U.CashMoney,      -- الكاش
                    U.GMGrade,        -- الرتبة
                    U.RegDate,        -- تاريخ التسجيل
                    U.LastLoginDate,  -- آخر دخول
                    U.LastLoginIp,    -- IP آخر دخول
                    A.Email,          -- الإيميل (من جدول الحسابات)
                    A.IsBanned,       -- حالة الحظر
                    A.IsEmailVerified -- حالة تفعيل الإيميل
                FROM GameDB.dbo.T_User U
                INNER JOIN AuthDB.dbo.T_Account A ON U.UserId = A.UserId
                WHERE U.UserNo = @u
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'اللاعب غير موجود' });
        }

        res.json({ status: 'success', user: result.recordset[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل جلب التفاصيل' });
    }
};
exports.unbanPlayer = async (req, res) => {
    const { targetUserNo, reason } = req.body;
    const adminId = req.user.userId;

    if (!targetUserNo) {
        return res.status(400).json({ message: 'رقم اللاعب (UserNo) مطلوب' });
    }

    try {
        const pool = await poolPromise;
        
        // 1. تنفيذ فك الحظر في قاعدة البيانات
        // يتم تحديث حالة IsBanned إلى 0 (غير محظور)
        const result = await pool.request()
            .input('uid', targetUserNo)
            .query("UPDATE AuthDB.dbo.T_Account SET IsBanned = 0 WHERE UserNo = @uid");

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ message: 'اللاعب غير موجود أو لم يتم التحديث' });
        }

        // 2. إغلاق أي سجلات حظر نشطة في Web_BanLog (اختياري لكن مفضل للتنظيم)
        // هذا يجعل السجل يظهر أن الحظر "انتهى"
        await pool.request()
            .input('uid', targetUserNo)
            .query("UPDATE AdrenalineWeb.dbo.Web_BanLog SET IsActive = 0 WHERE UserNo = @uid AND IsActive = 1");

        // 3. تسجيل العملية في سجلات الأدمن
        await logAdminAction(adminId, 'UNBAN_MANUAL', `Unbanned User ${targetUserNo}. Reason: ${reason || 'No reason'}`);

        res.json({ status: 'success', message: 'تم رفع الحظر عن اللاعب بنجاح' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل عملية فك الحظر' });
    }
};
// ==========================================
// 14. تغيير كلمة مرور المستخدم (Admin Force Change)
// ==========================================
// ==========================================
// 8. إدارة قائمة الآي بي المحظور (List & Unban IPs)
// ==========================================

// أ. جلب قائمة المحظورين
exports.getBannedIPs = async (req, res) => {
    try {
        const pool = await poolPromise;
        // نجلب كل القائمة من جدول الفلتر
        const result = await pool.request().query("SELECT Id, StartIp, EndIp, Type, Count FROM GameDB.dbo.T_IpFilterInfo");

        // دالة مساعدة لتحويل الرقم (Long) إلى نص (IPv4)
        // لأن قاعدة البيانات تخزنه كرقم لا يمكن قراءته بسهولة
        const longToIp = (long) => {
            return [
                (long >>> 24) & 0xFF,
                (long >>> 16) & 0xFF,
                (long >>> 8) & 0xFF,
                long & 0xFF
            ].join('.');
        };

        // تنسيق البيانات قبل إرسالها للواجهة
        const bans = result.recordset.map(ban => ({
            id: ban.Id,
            ip: longToIp(ban.StartIp), // نعرض StartIp لأنه في الغالب هو نفسه EndIp عند حظر فردي
            rawStart: ban.StartIp,
            rawEnd: ban.EndIp,
            type: ban.Type
        }));

        res.json({ status: 'success', bans });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل جلب قائمة الحظر' });
    }
};

// ب. فك حظر آي بي (حذفه من القائمة)
exports.deleteBannedIP = async (req, res) => {
    const { id } = req.params; // نستخدم الـ ID الخاص بالسطر في الجدول

    if (!id) return res.status(400).json({ message: 'يجب تحديد رقم الحظر (ID)' });

    try {
        const pool = await poolPromise;
        
        await pool.request()
            .input('id', id)
            .query("DELETE FROM GameDB.dbo.T_IpFilterInfo WHERE Id = @id");

        res.json({ status: 'success', message: 'تم رفع الحظر عن العنوان بنجاح' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل عملية فك الحظر' });
    }
};
exports.changeUserPassword = async (req, res) => {
    const { targetUserNo, newPassword } = req.body;
    const adminId = req.user.userId;

    if (!targetUserNo || !newPassword) {
        return res.status(400).json({ message: 'البيانات ناقصة (UserNo, Password)' });
    }

    try {
        const pool = await poolPromise;

        // 1. تشفير كلمة المرور (SHA2_512 + UpperCase)
        // ليطابق: HASHBYTES('SHA2_512', password) في SQL
        const hashedPassword = crypto.createHash('sha512')
                                     .update(newPassword)
                                     .digest('hex')
                                     .toUpperCase();

        // 2. نحتاج معرفة UserID لربط الجدولين
        const userCheck = await pool.request()
            .input('uid', targetUserNo)
            .query("SELECT UserID, Nickname FROM GameDB.dbo.T_User WHERE UserNo = @uid");

        if (userCheck.recordset.length === 0) {
            return res.status(404).json({ message: 'اللاعب غير موجود' });
        }

        const { UserID, Nickname } = userCheck.recordset[0];

        // 3. تحديث كلمة المرور في جدول الحسابات
        // ملاحظة: تأكد أن عمود Password في القاعدة يستوعب 128 حرفاً (حجم SHA512)
        await pool.request()
            .input('pass', hashedPassword)
            .input('userid', UserID)
            .query("UPDATE AuthDB.dbo.T_Account SET Password = @pass WHERE UserID = @userid");

        // 4. تسجيل العملية
        await logAdminAction(adminId, 'CHANGE_PASS', `Changed password for ${Nickname} (${UserID})`);

        res.json({ status: 'success', message: 'تم تغيير كلمة المرور بنجاح' });

    } catch (err) {
        console.error("Password Change Error:", err);
        res.status(500).json({ message: 'فشل تغيير كلمة المرور' });
    }
};

// ==========================================
// 15. تغيير البريد الإلكتروني للمستخدم (مع التحقق من التكرار)
// ==========================================
exports.changeUserEmail = async (req, res) => {
    const { targetUserNo, newEmail } = req.body;
    const adminId = req.user.userId;

    if (!targetUserNo || !newEmail) {
        return res.status(400).json({ message: 'البيانات ناقصة' });
    }

    // التحقق من صحة صيغة الإيميل (Regex)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
        return res.status(400).json({ message: 'صيغة البريد الإلكتروني غير صحيحة' });
    }

    try {
        const pool = await poolPromise;

        // 1. التحقق: هل الإيميل مستخدم في جدول الحسابات (AuthDB)؟
        // ⚠️ هذا هو التعديل الهام: نفحص جدول T_Account
        const emailCheck = await pool.request()
            .input('email', newEmail)
            .query("SELECT TOP 1 UserID FROM AuthDB.dbo.T_Account WHERE Email = @email");

        if (emailCheck.recordset.length > 0) {
            return res.status(400).json({ message: 'خطأ: هذا البريد الإلكتروني مستخدم بالفعل لحساب آخر!' });
        }

        // 2. نحتاج لجلب UserID الخاص باللاعب (لأن T_Account يعتمد عليه)
        const userCheck = await pool.request()
            .input('uid', targetUserNo)
            .query("SELECT UserID FROM GameDB.dbo.T_User WHERE UserNo = @uid");

        if (userCheck.recordset.length === 0) {
            return res.status(404).json({ message: 'اللاعب غير موجود' });
        }

        const userId = userCheck.recordset[0].UserID;

        // 3. التحديث الآمن
        await pool.request()
            .input('email', newEmail)
            .input('userid', userId)
            .query("UPDATE AuthDB.dbo.T_Account SET Email = @email WHERE UserID = @userid");

        // 4. تسجيل العملية
        await logAdminAction(adminId, 'CHANGE_EMAIL', `Changed Email for UserNo ${targetUserNo} to ${newEmail}`);

        res.json({ status: 'success', message: 'تم تحديث البريد الإلكتروني بنجاح' });

    } catch (err) {
        console.error("Email Change Error:", err);
        res.status(500).json({ message: 'فشل تغيير البريد الإلكتروني' });
    }
};

// ==========================================
// 16. شحن رصيد اللاعب (GP أو رصيد عادي)
// متوافق مع جدول T_User في GameDB
// ==========================================
exports.chargePlayerBalance = async (req, res) => {
    const { targetUserNo, amount, type } = req.body; 
    const adminId = req.user.userId;

    // التحقق من المدخلات
    if (!targetUserNo || !amount || !type) {
        return res.status(400).json({ message: 'البيانات ناقصة (Target, Amount, Type)' });
    }

    try {
        const pool = await poolPromise;
        let column = '';
        let currencyLabel = '';

        // تحديد العمود بناءً على هيكلية T_User في ملف game.sql
        if (type.toUpperCase() === 'GP') {
            // GP يذهب إلى عمود CashMoney (int)
            column = 'CashMoney'; 
            currencyLabel = 'GP (Cash)';
        } else if (type.toUpperCase() === 'MONEY') {
            // MONEY يذهب إلى عمود GameMoney (bigint)
            column = 'GameMoney'; 
            currencyLabel = 'GameMoney';
        } else {
            return res.status(400).json({ message: 'نوع العملة غير صحيح. استخدم GP أو MONEY' });
        }

        // تنفيذ التحديث
        await pool.request()
            .input('val', parseInt(amount))
            .input('uid', targetUserNo)
            // الاستعلام يستخدم العمود الصحيح ديناميكياً
            .query(`UPDATE GameDB.dbo.T_User SET ${column} = ${column} + @val WHERE UserNo = @uid`);

        // تسجيل العملية في سجل الأدمن
        await logAdminAction(
            adminId, 
            'CHARGE_BALANCE', 
            `Sent ${amount} ${currencyLabel} to User ${targetUserNo}`
        );

        // تسجيل في سجل الاقتصاد للمحاسبة (Web_EconomyLog)
        try {
            await pool.request()
                .input('uid', targetUserNo)
                .input('amt', amount)
                .input('curr', type.toUpperCase())
                .input('desc', `Admin Gift by ID:${adminId}`)
                .query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_EconomyLog 
                    (UserNo, ActionType, Amount, Currency, Description, LogDate) 
                    VALUES (@uid, 'ADMIN_CHARGE', @amt, @curr, @desc, GETDATE())
                `);
        } catch (e) { /* تجاهل خطأ اللوج إذا الجدول غير موجود */ }

        res.json({ status: 'success', message: `تم شحن ${amount} ${currencyLabel} بنجاح` });

    } catch (err) {
        console.error("Charge Error:", err);
        res.status(500).json({ message: 'فشل عملية الشحن' });
    }
};
// ==========================================
// 6-A. عرض الإشعارات الحالية (Get Active Announcements)
// ==========================================
exports.getAnnouncements = async (req, res) => {
    try {
        const pool = await poolPromise;
        // نجلب الإشعارات التي لم ينتهِ وقتها بعد
        const result = await pool.request().query(`
            SELECT SeqNo, Notice, StartDate, EndDate, Interval 
            FROM GameDB.dbo.NoticeInfo 
            WHERE EndDate > GETDATE()
            ORDER BY StartDate DESC
        `);

        res.json({ status: 'success', notices: result.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل جلب الإشعارات' });
    }
};

// ==========================================
// 6-B. تعديل إشعار محدد (Update Specific Announcement)
// ==========================================
exports.updateAnnouncement = async (req, res) => {
    const { id } = req.params; // SeqNo
    const { message, minutes } = req.body;

    if (!id || !message) {
        return res.status(400).json({ message: 'البيانات ناقصة (ID, Message)' });
    }

    try {
        const pool = await poolPromise;
        
        // إذا تم إرسال دقائق جديدة، نعيد حساب وقت النهاية
        let updateQuery = "UPDATE GameDB.dbo.NoticeInfo SET Notice = @msg";
        
        if (minutes) {
            updateQuery += ", EndDate = DATEADD(MINUTE, @mins, GETDATE())";
        }
        
        updateQuery += " WHERE SeqNo = @id";

        const request = pool.request()
            .input('id', id)
            .input('msg', message);
            
        if (minutes) request.input('mins', minutes);

        await request.query(updateQuery);

        res.json({ status: 'success', message: 'تم تعديل الإشعار بنجاح' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل تعديل الإشعار' });
    }
};

// ==========================================
// 6-C. حذف إشعار محدد (Delete Specific Announcement)
// ==========================================
exports.deleteAnnouncement = async (req, res) => {
    const { id } = req.params;

    if (!id) return res.status(400).json({ message: 'رقم الإشعار مطلوب' });

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', id)
            .query("DELETE FROM GameDB.dbo.NoticeInfo WHERE SeqNo = @id");

        res.json({ status: 'success', message: 'تم حذف الإشعار' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف' });
    }
};
// ==========================================
// 17. إدارة أحداث السيرفر (Server Events & Rates)
// ==========================================

// أ. جلب إعدادات الإيفنت الحالية
exports.getEventConfig = async (req, res) => {
    try {
        const pool = await poolPromise;
        // نجلب السطر الأول فقط لأن إعدادات السيرفر تكون في سطر واحد
        const result = await pool.request().query(`
            SELECT TOP 1 
                EventExp, 
                EventMoney, 
                ClanWarPoint, 
                DisguiseEvent
            FROM GameDB.dbo.T_ServerConfig
        `);
        
        if (result.recordset.length === 0) {
            // إنشاء إعدادات افتراضية إذا كان الجدول فارغاً
            await pool.request().query("INSERT INTO GameDB.dbo.T_ServerConfig (EventExp, EventMoney, ClanWarPoint, DisguiseEvent, PcBang1PlayExp, PcBang2PlayExp, PcBang1PlayGameMoney, PcBang2PlayGameMoney) VALUES (100, 100, 0, 0, 100, 100, 100, 100)");
            return res.json({ status: 'success', config: { EventExp: 100, EventMoney: 100, ClanWarPoint: 0, DisguiseEvent: 0 } });
        }

        res.json({ status: 'success', config: result.recordset[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل جلب إعدادات الإيفنت' });
    }
};

// ب. تحديث إعدادات الإيفنت (XP, Money, Clan Points)
exports.updateEventConfig = async (req, res) => {
    const { eventExp, eventMoney, clanPoint, disguise } = req.body;
    const adminId = req.user.userId;

    try {
        const pool = await poolPromise;
        
        // استخدام UPDATE بدون WHERE لأنه يوجد سطر واحد فقط
        await pool.request()
            .input('exp', eventExp || 100)
            .input('money', eventMoney || 100)
            .input('clan', clanPoint || 0)
            .input('disguise', disguise || 0)
            .query(`
                UPDATE GameDB.dbo.T_ServerConfig 
                SET EventExp = @exp, 
                    EventMoney = @money, 
                    ClanWarPoint = @clan,
                    DisguiseEvent = @disguise
            `);

        // تسجيل العملية
        await logAdminAction(adminId, 'UPDATE_EVENT', `Rates: XP ${eventExp}%, Money ${eventMoney}%`);

        res.json({ status: 'success', message: 'تم تحديث إعدادات الإيفنت بنجاح' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل تحديث الإيفنت' });
    }
};

// ==========================================
// 18. إدارة جوائز الحضور (Attendance Event)
// ==========================================

// أ. جلب قائمة الجوائز
exports.getAttendanceRewards = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT A.DayCount, A.ItemId, A.ItemDays, A.ItemCount, I.ItemName
            FROM GameDB.dbo.T_Event_Attendance A
            LEFT JOIN GameDB.dbo.T_ItemInfo I ON A.ItemId = I.ItemId
            ORDER BY A.DayCount ASC
        `);
        res.json({ status: 'success', rewards: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'فشل جلب جوائز الحضور' });
    }
};

// ب. إضافة أو تعديل جائزة ليوم معين
exports.setAttendanceReward = async (req, res) => {
    const { dayCount, itemId, days, count } = req.body; // اليوم، رقم الأداة، المدة، العدد

    if (!dayCount || !itemId) return res.status(400).json({ message: 'بيانات ناقصة' });

    try {
        const pool = await poolPromise;
        
        // التحقق أولاً: هل يوجد جائزة لهذا اليوم؟
        const check = await pool.request()
            .input('day', dayCount)
            .query("SELECT DayCount FROM GameDB.dbo.T_Event_Attendance WHERE DayCount = @day");

        if (check.recordset.length > 0) {
            // تحديث (Update)
            await pool.request()
                .input('day', dayCount)
                .input('id', itemId)
                .input('days', days || 0)
                .input('count', count || 1)
                .query(`
                    UPDATE GameDB.dbo.T_Event_Attendance 
                    SET ItemId = @id, ItemDays = @days, ItemCount = @count
                    WHERE DayCount = @day
                `);
        } else {
            // إضافة جديد (Insert)
            await pool.request()
                .input('day', dayCount)
                .input('id', itemId)
                .input('days', days || 0)
                .input('count', count || 1)
                .query(`
                    INSERT INTO GameDB.dbo.T_Event_Attendance (DayCount, ItemId, ItemDays, ItemCount, Name)
                    VALUES (@day, @id, @days, @count, 'Reward')
                `);
        }

        res.json({ status: 'success', message: `تم حفظ جائزة اليوم ${dayCount}` });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل حفظ الجائزة' });
    }
};

// ج. حذف جائزة يوم
exports.deleteAttendanceReward = async (req, res) => {
    const { dayCount } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('day', dayCount).query("DELETE FROM GameDB.dbo.T_Event_Attendance WHERE DayCount = @day");
        res.json({ status: 'success', message: 'تم حذف الجائزة' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف' });
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
// تغيير حالة السيرفر
exports.setServerStatus = async (req, res) => {
    const { status, message } = req.body; // 1 or 0
    try {
        const pool = await poolPromise;
        // تحديث الحالة
        await pool.request().input('val', status).query("UPDATE AdrenalineWeb.dbo.Web_Settings SET ConfigValue = @val WHERE ConfigKey = 'ServerStatus'");
        
        // تحديث رسالة الصيانة (اختياري)
        if (message) {
            await pool.request().input('msg', message).query("UPDATE AdrenalineWeb.dbo.Web_Settings SET ConfigValue = @msg WHERE ConfigKey = 'MaintenanceMessage'");
        }
        
        res.json({ status: 'success', message: `تم تغيير حالة السيرفر إلى ${status == 1 ? 'Online' : 'Maintenance'}` });
    } catch (err) { res.status(500).json({ message: 'Error' }); }
};