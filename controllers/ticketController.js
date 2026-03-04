const { poolPromise, sql } = require('../config/db');

// 1. إنشاء تذكرة جديدة
exports.createTicket = async (req, res) => {
    const { category, title, message, priority } = req.body;
    const userNo = req.user.userNo;
    
    // إذا رفع صورة، نأخذ مسارها، وإلا نرسل NULL
    const attachmentUrl = req.file ? `/uploads/tickets/${req.file.filename}` : null;

    if (!category || !title || !message) {
        return res.status(400).json({ message: 'البيانات ناقصة' });
    }

    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // أ. إنشاء التذكرة (مع الأولوية)
            const ticketResult = await request
                .input('uid', userNo)
                .input('cat', category)
                .input('title', title)
                .input('prio', priority || 'NORMAL') // LOW, NORMAL, HIGH
                .query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_Tickets (UserNo, Category, Title, Status, Priority)
                    OUTPUT INSERTED.TicketID
                    VALUES (@uid, @cat, @title, 'OPEN', @prio)
                `);

            const ticketId = ticketResult.recordset[0].TicketID;

            // ب. إضافة الرسالة الأولى (مع الصورة إن وجدت)
            await request
                .input('tid', ticketId)
                .input('msg', message)
                .input('attach', attachmentUrl) // 👈 الصورة هنا
                .query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_TicketReplies (TicketID, UserNo, IsAdminReply, Message, AttachmentURL)
                    VALUES (@tid, @uid, 0, @msg, @attach)
                `);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم فتح التذكرة', ticketId });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل الإنشاء' });
    }
};

// 2. عرض تذاكري
exports.getMyTickets = async (req, res) => {
    const userNo = req.user.userNo;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT TicketID, Category, Title, Status, CreatedDate, LastUpdate 
                FROM AdrenalineWeb.dbo.Web_Tickets 
                WHERE UserNo = @uid 
                ORDER BY LastUpdate DESC
            `);
        res.json({ status: 'success', tickets: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب التذاكر' });
    }
};

// 3. عرض تفاصيل تذكرة وردودها
// 3. عرض تفاصيل تذكرة وردودها (نسخة مصححة)
// 3. عرض تفاصيل تذكرة وردودها (نسخة مصححة الترميز)
exports.getTicketDetails = async (req, res) => {
    const { id } = req.params;
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;
        
        // 1. جلب التذكرة
        const ticketCheck = await pool.request()
            .input('tid', id)
            .input('uid', userNo)
            .query("SELECT * FROM AdrenalineWeb.dbo.Web_Tickets WHERE TicketID = @tid AND UserNo = @uid");

        if (ticketCheck.recordset.length === 0) {
            return res.status(404).json({ message: 'التذكرة غير موجودة' });
        }

        // 2. جلب الردود (إصلاح علامات الاستفهام بإضافة N)
        const replies = await pool.request()
            .input('tid', id)
            .query(`
                SELECT 
                    R.ReplyID, 
                    R.TicketID, 
                    R.UserNo, 
                    R.Message, 
                    R.AttachmentURL, 
                    R.ReplyDate, 
                    R.IsAdminReply,
                    CASE 
                        WHEN R.IsAdminReply = 1 THEN N'الدعم الفني'  -- 👈 لاحظ حرف N هنا
                        ELSE ISNULL(U.Nickname, N'اللاعب')          -- 👈 وهنا أيضاً
                    END AS SenderName,
                    U.UserId AS Username
                FROM AdrenalineWeb.dbo.Web_TicketReplies R
                LEFT JOIN GameDB.dbo.T_User U ON R.UserNo = U.UserNo
                WHERE R.TicketID = @tid
                ORDER BY R.ReplyDate ASC
            `);

        res.json({ 
            status: 'success', 
            ticket: ticketCheck.recordset[0], 
            replies: replies.recordset 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'خطأ في جلب التفاصيل' });
    }
};

// 4. الرد على تذكرة (من اللاعب)
exports.replyToTicket = async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;
    const userNo = req.user.userNo;
    const attachmentUrl = req.file ? `/uploads/tickets/${req.file.filename}` : null;

    if (!message && !attachmentUrl) return res.status(400).json({ message: 'يجب كتابة رسالة أو إرفاق صورة' });

    try {
        const pool = await poolPromise;

        // التحقق من الملكية والحالة
        const check = await pool.request()
            .input('tid', id)
            .input('uid', userNo)
            .query("SELECT Status FROM AdrenalineWeb.dbo.Web_Tickets WHERE TicketID = @tid AND UserNo = @uid");

        if (check.recordset.length === 0) return res.status(404).json({ message: 'التذكرة غير موجودة' });
        if (check.recordset[0].Status === 'CLOSED') return res.status(400).json({ message: 'التذكرة مغلقة' });

        // إضافة الرد
        await pool.request()
            .input('tid', id)
            .input('uid', userNo)
            .input('msg', message || '') // يمكن إرسال صورة فقط بدون نص
            .input('attach', attachmentUrl)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_TicketReplies (TicketID, UserNo, IsAdminReply, Message, AttachmentURL)
                VALUES (@tid, @uid, 0, @msg, @attach);

                UPDATE AdrenalineWeb.dbo.Web_Tickets 
                SET Status = 'USER_REPLY', LastUpdate = GETDATE() 
                WHERE TicketID = @tid;
            `);

        res.json({ status: 'success', message: 'تم الرد' });

    } catch (err) {
        res.status(500).json({ message: 'فشل الرد' });
    }
};