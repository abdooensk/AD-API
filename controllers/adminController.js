const { poolPromise, sql } = require('../config/db');
const crypto = require('crypto'); // 👈 إضافة مكتبة التشفير
const { logAdminAction } = require('../utils/adminLogger'); // 👈 استدعاء الأداة الجديدة

const hashPassword = (password) => {
    return crypto.createHash('sha512').update(password).digest('hex').toUpperCase();
};

// 1. حظر لاعب (Ban Player)
exports.banPlayer = async (req, res) => {
    const { targetUserNo, reason } = req.body;
    const adminName = req.user.userId;

    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // تجهيز المتغيرات بأمان مرة واحدة
            request.input('uid', targetUserNo);
            request.input('reason', reason);
            request.input('admin', adminName);

            // أ. تفعيل الحظر في جدول الحسابات الأصلي
            await request.query(`UPDATE AuthDB.dbo.T_Account SET IsBanned = 1 WHERE UserNo = @uid`);

            // ب. تسجيل التفاصيل في موقعنا
            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_BanLog (UserNo, Reason, BannedBy, IsActive)
                VALUES (@uid, @reason, @admin, 1)
            `);

            // ج. طرد اللاعب المحظور من أي جلسة نشطة فوراً!
            await request.query(`UPDATE AdrenalineWeb.dbo.Web_LoginSessions SET IsActive = 0 WHERE UserNo = @uid`);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم حظر اللاعب وطرده من النظام بنجاح' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        } 
    } catch (err) {
        res.status(500).json({ message: 'فشل الحظر', error: err.message });
    }
};
// 2. عرض طلبات فك الحظر (Unban Requests)
exports.getUnbanRequests = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                R.RequestID, R.UserNo, R.FineAmount, R.PaymentType, R.RequestDate,
                U.UserId AS Username,
                (SELECT TOP 1 Nickname FROM GameDB.dbo.T_User WHERE UserNo = R.UserNo) AS Nickname,
                (SELECT TOP 1 Reason FROM AdrenalineWeb.dbo.Web_BanLog WHERE UserNo = R.UserNo AND IsActive = 1 ORDER BY BanID DESC) AS BanReason
            FROM AdrenalineWeb.dbo.Web_UnbanRequests R
            JOIN AuthDB.dbo.T_Account U ON R.UserNo = U.UserNo
            WHERE R.Status = 'Pending'
            ORDER BY R.RequestDate ASC
        `);

        res.json({ status: 'success', requests: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الطلبات', error: err.message });
    }
};

// 3. الموافقة على طلب فك الحظر (Approve & Deduct Money)
exports.approveUnban = async (req, res) => {
    const { requestId } = req.body;
    
    try {
        const pool = await poolPromise;
        
        // أ. جلب تفاصيل الطلب
        const reqResult = await pool.request()
            .input('rid', requestId)
            .query('SELECT * FROM AdrenalineWeb.dbo.Web_UnbanRequests WHERE RequestID = @rid');
            
        const banRequest = reqResult.recordset[0];
        if (!banRequest || banRequest.Status !== 'Pending') {
            return res.status(404).json({ message: 'الطلب غير موجود أو تمت معالجته مسبقاً' });
        }

        // ب. التحقق من رصيد اللاعب (هل يملك قيمة الغرامة؟)
        // ملاحظة: نفترض الدفع بـ GP (GameMoney)
        const userCheck = await pool.request()
            .input('uid', banRequest.UserNo)
            .query('SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid');
            
        const currentMoney = userCheck.recordset[0].CashMoney;

        if (currentMoney < banRequest.FineAmount) {
            return res.status(400).json({ message: 'اللاعب لا يملك كاش (GP) كافياً لدفع الغرامة' });
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // تجهيز المتغيرات الآمنة
            request.input('fine', banRequest.FineAmount);
            request.input('uid', banRequest.UserNo);
            request.input('rid', requestId);

            // 1. خصم الغرامة (من CashMoney)
            await request.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - @fine 
                WHERE UserNo = @uid
            `);

            // 2. فك الحظر في AuthDB
            await request.query(`UPDATE AuthDB.dbo.T_Account SET IsBanned = 0 WHERE UserNo = @uid`);

            // 3. تحديث حالة الطلب
            await request.query(`UPDATE AdrenalineWeb.dbo.Web_UnbanRequests SET Status = 'Approved' WHERE RequestID = @rid`);

            // 4. إغلاق سجل الحظر
            await request.query(`UPDATE AdrenalineWeb.dbo.Web_BanLog SET IsActive = 0 WHERE UserNo = @uid`);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم فك الحظر وخصم الغرامة بنجاح' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        res.status(500).json({ message: 'فشل العملية', error: err.message });
    }
    // ... (الكود السابق: banPlayer, unban, etc...)

// 🆕 تغيير بيانات اللاعب بالقوة (للأدمن فقط)
exports.forceChangeCredentials = async (req, res) => {
    const { targetUsername, newPassword, newEmail } = req.body;
    const adminName = req.user.userId; // اسم الأدمن الذي قام بالعملية (للتسجيل)

    if (!targetUsername) {
        return res.status(400).json({ message: 'يجب تحديد اسم المستخدم (Target Username)' });
    }

    if (!newPassword && !newEmail) {
        return res.status(400).json({ message: 'يجب إرسال كلمة مرور جديدة أو إيميل جديد لتغييره' });
    }

    try {
        const pool = await poolPromise;

        // 1. التحقق من وجود اللاعب وجلب رقمه
        const userCheck = await pool.request()
            .input('uid', targetUsername)
            .query("SELECT UserNo FROM AuthDB.dbo.T_Account WHERE UserId = @uid");

        if (userCheck.recordset.length === 0) {
            return res.status(404).json({ message: 'هذا اللاعب غير موجود' });
        }

        const targetUserNo = userCheck.recordset[0].UserNo;
        let changesLog = []; // لتسجيل ماذا تغير بالضبط

        // 2. تغيير الإيميل (إذا تم إرساله)
        if (newEmail) {
            // التأكد أن الإيميل غير مستخدم
            const emailCheck = await pool.request()
                .input('email', newEmail)
                .input('uid', targetUserNo)
                .query("SELECT UserNo FROM AuthDB.dbo.T_Account WHERE Email = @email AND UserNo != @uid");

            if (emailCheck.recordset.length > 0) {
                return res.status(400).json({ message: 'البريد الإلكتروني الجديد مستخدم بالفعل في حساب آخر' });
            }

            await pool.request()
                .input('email', newEmail)
                .input('uid', targetUserNo)
                .query("UPDATE AuthDB.dbo.T_Account SET Email = @email, IsEmailVerified = 1, VerificationToken = NULL WHERE UserNo = @uid");
            
            changesLog.push(`Email changed to ${newEmail}`);
        }

        // 3. تغيير الباسورد (إذا تم إرساله) - 🔥 هنا الإصلاح
        if (newPassword) {
            // ✅ نقوم بتشفير الباسورد بنفس الطريقة المستخدمة في التسجيل
            const hashedPassword = hashPassword(newPassword);

            await pool.request()
                .input('pass', hashedPassword) // 👈 نرسل المشفر
                .input('uid', targetUserNo)
                .query("UPDATE AuthDB.dbo.T_Account SET Password = @pass, PasswordResetToken = NULL WHERE UserNo = @uid");

            changesLog.push('Password changed');
        }

        // 4. تسجيل العملية في سجلات الأدمن (خطوة إضافية مفضلة)
        // إذا كان لديك جدول Web_AdminLog، يفضل تسجيل هذه العملية الحساسة
        /*
        await logAdminAction(adminName, 'FORCE_CHANGE', `Changed credentials for ${targetUsername}: ${changesLog.join(', ')}`);
        */

        res.json({ 
            status: 'success', 
            message: `تم تحديث بيانات اللاعب [${targetUsername}] بنجاح.`,
            details: {
                emailUpdated: newEmail ? true : false,
                passwordUpdated: newPassword ? true : false
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'حدث خطأ أثناء التحديث', error: err.message });
    }
};
exports.getAllTickets = async (req, res) => {
    const { status } = req.query; // ?status=OPEN
    try {
        const pool = await poolPromise;
        let query = `
            SELECT T.*, U.UserID, U.Nickname 
            FROM AdrenalineWeb.dbo.Web_Tickets T
            JOIN GameDB.dbo.T_User U ON T.UserNo = U.UserNo
        `;
        
        if (status) query += ` WHERE T.Status = @status`;
        query += ` ORDER BY T.LastUpdate DESC`; // الأحدث أولاً

        const request = pool.request();
        if (status) request.input('status', status);

        const result = await request.query(query);
        res.json({ status: 'success', tickets: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب التذاكر' });
    }
};

// 2. رد الأدمن على تذكرة
exports.adminReplyTicket = async (req, res) => {
    const { id } = req.params;
    const { message, newStatus } = req.body; // newStatus: 'ADMIN_REPLY' or 'CLOSED'
    const adminName = req.user.userId;

    try {
        const pool = await poolPromise;
        
        await pool.request()
            .input('tid', id)
            .input('msg', message)
            .input('status', newStatus || 'ADMIN_REPLY')
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_TicketReplies (TicketID, IsAdminReply, Message)
                VALUES (@tid, 1, @msg); -- 1 تعني أدمن

                UPDATE AdrenalineWeb.dbo.Web_Tickets 
                SET Status = @status, LastUpdate = GETDATE() 
                WHERE TicketID = @tid;
            `);

        res.json({ status: 'success', message: 'تم الرد بنجاح' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الرد' });
    }
};
// عرض حالة سيرفر اللعبة (الاقتصاد)
exports.getServerEconomy = async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // حساب إجمالي الأموال في السيرفر
        const result = await pool.request().query(`
            SELECT 
                SUM(CAST(GameMoney AS BIGINT)) AS TotalGold,
                SUM(CAST(CashMoney AS BIGINT)) AS TotalCash,
                COUNT(*) AS TotalPlayers,
                (SELECT COUNT(*) FROM AuthDB.dbo.T_Account WHERE IsBanned = 1) AS BannedCount
            FROM GameDB.dbo.T_User
        `);

        res.json({ 
            status: 'success', 
            stats: result.recordset[0],
            timestamp: new Date()
        });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الإحصائيات' });
    }
};
};
exports.getAllTickets = async (req, res) => {
    const { status } = req.query; // ?status=OPEN

    try {
        const pool = await poolPromise;
        let query = `
            SELECT T.TicketID, T.UserNo, T.Category, T.Title, T.Status, T.Priority, T.CreatedDate, T.LastUpdate,
                   U.UserId AS Username, U.Nickname 
            FROM AdrenalineWeb.dbo.Web_Tickets T
            JOIN GameDB.dbo.T_User U ON T.UserNo = U.UserNo
        `;
        
        // فلترة حسب الحالة
        if (status && status !== 'ALL') {
            query += ` WHERE T.Status = @status`;
        }
        
        query += ` ORDER BY T.LastUpdate DESC`; // الأحدث أولاً

        const request = pool.request();
        if (status && status !== 'ALL') request.input('status', status);

        const result = await request.query(query);
        res.json({ status: 'success', tickets: result.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'خطأ في جلب التذاكر' });
    }
};

// 5. عرض تفاصيل تذكرة معينة (مع الردود)
exports.getTicketDetailsAdmin = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        
        // أ. جلب التذكرة الأساسية
        const ticketRes = await pool.request().input('tid', id).query(`
            SELECT T.*, U.UserId, U.Nickname 
            FROM AdrenalineWeb.dbo.Web_Tickets T
            JOIN GameDB.dbo.T_User U ON T.UserNo = U.UserNo
            WHERE T.TicketID = @tid
        `);

        if (ticketRes.recordset.length === 0) return res.status(404).json({ message: 'التذكرة غير موجودة' });

        // ب. جلب الردود
        const repliesRes = await pool.request().input('tid', id).query(`
            SELECT R.*, 
                   CASE WHEN R.IsAdminReply = 1 THEN 'GM' ELSE U.Nickname END AS SenderName
            FROM AdrenalineWeb.dbo.Web_TicketReplies R
            LEFT JOIN GameDB.dbo.T_User U ON R.UserNo = U.UserNo
            WHERE R.TicketID = @tid
            ORDER BY R.ReplyDate ASC
        `);

        res.json({ 
            status: 'success', 
            ticket: ticketRes.recordset[0], 
            replies: repliesRes.recordset 
        });

    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب التفاصيل' });
    }
};

// 6. رد الأدمن على تذكرة
exports.adminReplyTicket = async (req, res) => {
    const { id } = req.params;
    const { message, closeTicket } = req.body; // closeTicket: "true" or "false"
    
    // صورة المرفق (إذا وجدت)
    const attachmentUrl = req.file ? `/uploads/tickets/${req.file.filename}` : null;

    if (!message && !attachmentUrl) return res.status(400).json({ message: 'يجب كتابة رد أو إرفاق صورة' });

    try {
        const pool = await poolPromise;
        const newStatus = (closeTicket === 'true' || closeTicket === true) ? 'CLOSED' : 'ADMIN_REPLY';

        await pool.request()
            .input('tid', id)
            .input('msg', message || '')
            .input('attach', attachmentUrl)
            .input('status', newStatus)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_TicketReplies (TicketID, UserNo, IsAdminReply, Message, AttachmentURL)
                VALUES (@tid, 0, 1, @msg, @attach); -- UserNo 0 for System/Admin

                UPDATE AdrenalineWeb.dbo.Web_Tickets 
                SET Status = @status, LastUpdate = GETDATE() 
                WHERE TicketID = @tid;
            `);

        res.json({ status: 'success', message: 'تم الرد بنجاح' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل الرد' });
    }
};

// 7. إغلاق التذكرة يدوياً
exports.closeTicket = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('tid', id).query("UPDATE AdrenalineWeb.dbo.Web_Tickets SET Status = 'CLOSED', LastUpdate = GETDATE() WHERE TicketID = @tid");
        res.json({ status: 'success', message: 'تم إغلاق التذكرة' });
    } catch (err) {
        res.status(500).json({ message: 'فشل العملية' });
    }
};