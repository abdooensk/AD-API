const { poolPromise, sql } = require('../config/db');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto'); // مكتبة مدمجة في Node.js
const { v4: uuidv4 } = require('uuid');
const { decodeReferralCode } = require('../utils/referralCodec');
const path = require('path'); // لا تنس استدعاء مكتبة path في أعلى الملف
require('dotenv').config(); // 👈 مهم لقراءة الإيميل والباسورد من الملف السري
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_adrenaline_key_2026';

const maskEmail = (email) => {
    if (!email) return '';
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return email;
    
    if (localPart.length <= 2) {
        return `${localPart[0]}***@${domain}`;
    }
    return `${localPart.substring(0, 2)}***@${domain}`;
};

// دالة لتوليد كود تفعيل من 6 أرقام
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// دالة مساعدة لتوليد قالب الإيميل بشكل احترافي
const getEmailTemplate = (title, username, message, otp) => {
    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #111111; color: #ffffff; padding: 40px 20px; text-align: center; border-radius: 8px; max-width: 600px; margin: 20px auto; border: 1px solid #2a2a2a;">
        <h2 style="color: #e50000; text-transform: uppercase; letter-spacing: 2px; margin-top: 0;">🔥 Adrenaline Game 🔥</h2>
        <h3 style="color: #ffffff; margin-bottom: 20px;">${title}</h3>
        <hr style="border: 0; border-top: 1px solid #333; margin: 20px 0;">
        <h4 style="color: #e0e0e0; font-size: 18px;">مرحباً يا بطل، ${username}!</h4>
        <p style="font-size: 16px; color: #bbbbbb; line-height: 1.5;">${message}</p>
        
        <div style="margin: 30px auto; padding: 20px 40px; background-color: #1a1a1a; border-radius: 8px; border: 2px dashed #e50000; display: inline-block;">
            <h1 style="margin: 0; color: #ff3333; font-size: 42px; letter-spacing: 10px;">${otp}</h1>
        </div>
        
        <p style="font-size: 14px; color: #888888; margin-top: 20px;">⚠️ تحذير: لا تقم بمشاركة هذا الكود مع أي شخص. الإدارة لن تطلب منك هذا الكود أبداً.</p>
        <hr style="border: 0; border-top: 1px solid #333; margin: 30px 0 20px 0;">
        <p style="font-size: 12px; color: #555555;">© ${new Date().getFullYear()} Adrenaline Team. جميع الحقوق محفوظة.</p>
    </div>
    `;
};

const hashPassword = (password) => {
    // يجب أن تكون مطابقة تماماً لما فعلناه في SQL Server
    // HASHBYTES('SHA2_512', password)
    return crypto.createHash('sha512').update(password).digest('hex').toUpperCase();
    
    // ⚠️ إذا استخدمت الـ Salt (UserId + Password) في SQL، يجب أن تفعل مثله هنا:
    // return crypto.createHash('sha512').update(userId + password).digest('hex').toUpperCase();
};

// 📧 إعدادات إرسال الإيميل (يقرأ الآن من ملف .env)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // يقرأ من ملف .env
        pass: process.env.EMAIL_PASS  // يقرأ من ملف .env
    },
    tls: {
        rejectUnauthorized: false // يساعد في تجنب مشاكل الاتصال
    }
});

// 1. تسجيل الدخول (Login) - (تم تعديله ليدعم ميزة تغيير الإيميل)
exports.login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    try {
        const pool = await poolPromise;
        
        // 1. جلب بيانات المستخدم
        const result = await pool.request()
            .input('uid', username)
            .query(`
                SELECT A.UserNo, A.UserId, A.Password, A.IsBanned, A.IsEmailVerified, A.Email,
                       U.GMGrade, U.Nickname 
                FROM AuthDB.dbo.T_Account A
                LEFT JOIN GameDB.dbo.T_User U ON A.UserNo = U.UserNo 
                WHERE A.UserId = @uid
            `);

        const user = result.recordset[0];

        if (!user) return res.status(404).json({ message: 'اسم المستخدم غير موجود' });
        
        // 2. التحقق من كلمة المرور
        const inputHash = hashPassword(password);
        if (user.Password !== inputHash) {
            return res.status(401).json({ message: 'كلمة المرور غير صحيحة' });
        }
        
        // 3. التحقق من تفعيل الإيميل
        if (user.IsEmailVerified === false) {
            return res.status(403).json({ 
                message: 'يجب تأكيد البريد الإلكتروني أولاً. راجع صندوق الوارد.',
                errorType: 'NOT_VERIFIED',
                currentEmail: user.Email
            });
        }

        // ============================================================
        // 🆕 4. منطق الحضور المتواصل (Consecutive Attendance Logic)
        // ============================================================
        try {
            const todayDate = new Date().toISOString().split('T')[0];
            const yesterdayDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];

            // التحقق من سجل الحضور
            const attendanceCheck = await pool.request()
                .input('u_no', user.UserNo)
                .query("SELECT LastClaimDate FROM AdrenalineWeb.dbo.Web_DailyAttendance WHERE UserNo = @u_no");

            if (attendanceCheck.recordset.length > 0) {
                const lastClaimDate = attendanceCheck.recordset[0].LastClaimDate;
                let lastDateStr = '';
                
                if (lastClaimDate) {
                    lastDateStr = new Date(lastClaimDate).toISOString().split('T')[0];
                }

                // إذا فاته يوم (لم يدخل اليوم ولم يدخل أمس)، نصفر العداد
                if (lastDateStr !== todayDate && lastDateStr !== yesterdayDate) {
                    await pool.request().query(`
                        UPDATE AdrenalineWeb.dbo.Web_DailyAttendance 
                        SET ConsecutiveDays = 0, LoginRewardClaimed = 0 
                        WHERE UserNo = ${user.UserNo}
                    `);
                }
            } else {
                // مستخدم جديد: ننشئ له سجلاً مع وضع تاريخ "أمس" ليتمكن من استلام المكافأة فوراً
                await pool.request().query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_DailyAttendance (UserNo, ConsecutiveDays, LoginRewardClaimed, LastClaimDate) 
                    VALUES (${user.UserNo}, 0, 0, DATEADD(day, -1, GETDATE()))
                `);
            }
        } catch (attErr) {
            console.error("خطأ في نظام الحضور (غير مؤثر على الدخول):", attErr.message);
        }

        // ============================================================
        // 🆕 5. إدارة الجلسات (Session Management) - للأمان
        // ============================================================
        
        // أ. إنشاء معرف للجلسة
        const sessionId = uuidv4();
        
        // ب. الحصول على معلومات الجهاز و IP
        const userAgent = req.headers['user-agent'] || 'Unknown Device';
        // محاولة جلب IP الحقيقي في حال وجود بروكسي، أو العنوان المباشر
        const userIP = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

        // ج. حفظ الجلسة في قاعدة البيانات
        await pool.request()
            .input('sid', sessionId)
            .input('uid', user.UserNo)
            .input('ip', userIP)
            .input('device', userAgent)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_LoginSessions (SessionID, UserNo, IPAddress, DeviceName, IsActive)
                VALUES (@sid, @uid, @ip, @device, 1)
            `);

        // ============================================================
        // 6. إصدار التوكن (JWT)
        // ============================================================
        
        const isBanned = user.IsBanned === 1 || user.IsBanned === true;
        
        const token = jwt.sign(
            { 
                userNo: user.UserNo, 
                userId: user.UserId, 
                isAdmin: user.GMGrade >= 1, 
                role: user.GMGrade, 
                isBanned: isBanned,
                sessionId: sessionId // 👈 إضافة رقم الجلسة للتوكن
            },
            JWT_SECRET, { expiresIn: '24h' }
        );

        res.json({
            status: 'success',
            message: 'تم تسجيل الدخول بنجاح',
            token: token,
            user: {
                userNo: user.UserNo,
                username: user.UserId,
                nickname: user.Nickname || null,
                isGM: user.GMGrade >= 1,
                grade: user.GMGrade,
                isBanned: isBanned
            }
        });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ message: 'حدث خطأ في السيرفر', error: err.message });
    }
};

// 2. إنشاء حساب جديد (Register) - (كما هو تماماً في نسختك)
exports.register = async (req, res) => {
    // التأكد من استخدام username ليطابق الواجهة
    const { username, password, email, referralCode } = req.body;

    if (!username || !password || !email) {
        return res.status(400).json({ message: 'البيانات ناقصة' });
    }

    try {
        const pool = await poolPromise;

        // 1. التحقق من التكرار
        const check = await pool.request()
            .input('uid', username)
            .input('email', email)
            .query('SELECT UserId FROM AuthDB.dbo.T_Account WHERE UserId = @uid OR Email = @email');
        
        if (check.recordset.length > 0) {
            return res.status(400).json({ message: 'اسم المستخدم أو البريد مسجل مسبقاً' });
        }

        // 2. معالجة كود الدعوة (تم تعديلها لتكون آمنة من ثغرات SQL)
        let referrerUserNo = null; 
        
        if (referralCode) {
            const decodedId = decodeReferralCode(referralCode);
            if (decodedId) {
                const refCheck = await pool.request()
                    .input('refId', decodedId)
                    .query(`SELECT UserNo FROM AuthDB.dbo.T_Account WHERE UserNo = @refId`);
                
                if (refCheck.recordset.length > 0) {
                    referrerUserNo = decodedId;
                }
            }
        }

        // 3. الإدخال في قاعدة البيانات
        const verificationCode = generateOTP(); // 👈 إنشاء كود من 6 أرقام
        const hashedPassword = hashPassword(password);

        await pool.request()
            .input('uid', username)
            .input('pass', hashedPassword)
            .input('email', email)
            .input('token', verificationCode) // 👈 تم التصحيح هنا لاستخدام verificationCode
            .input('ref', referrerUserNo) 
            .query(`
                INSERT INTO AuthDB.dbo.T_Account 
                (UserId, Password, Email, IsEmailVerified, VerificationToken, ReferredBy, RegDate, IsBanned)
                VALUES 
                (@uid, @pass, @email, 0, @token, @ref, GETDATE(), 0)
            `);

        // 4. 👈👈 هنا نضع كود إرسال الإيميل (باستخدام القالب الاحترافي)
        await transporter.sendMail({
            from: `"Adrenaline Game" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'أهلاً بك في أدرينالين - كود تفعيل حسابك',
            html: getEmailTemplate(
                'تأكيد الحساب الجديد', 
                username, 
                'شكراً لانضمامك إلى ساحة المعركة! لتفعيل حسابك والبدء في اللعب، يرجى إدخال الكود التالي:', 
                verificationCode
            )
        });

        // 5. إرسال الرد للمستخدم
        res.json({ status: 'success', message: 'تم التسجيل بنجاح! يرجى التحقق من بريدك لإدخال كود التفعيل.' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل التسجيل', error: err.message });
    }
};

// 3. تفعيل الإيميل (كما هو في نسختك)
// تحديث: دالة تفعيل الإيميل + مكافأة الداعي
exports.verifyEmail = async (req, res) => {
    const { username, code } = req.body;

    if (!username || !code) return res.status(400).json({ message: 'اسم المستخدم وكود التفعيل مطلوبان' });

    try {
        const pool = await poolPromise;

        // البحث عن المستخدم باستخدام الاسم والكود معاً
        const checkResult = await pool.request()
            .input('uid', username)
            .input('code', code)
            .query(`
                SELECT UserNo, UserId, IsEmailVerified, ReferredBy 
                FROM AuthDB.dbo.T_Account 
                WHERE UserId = @uid AND VerificationToken = @code
            `);

        const user = checkResult.recordset[0];

        if (!user) return res.status(400).json({ message: 'كود التفعيل غير صحيح أو اسم المستخدم خاطئ' });
        if (user.IsEmailVerified) return res.status(400).json({ message: 'الحساب مفعل مسبقاً' });

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // تفعيل الحساب وتفريغ الكود
            await request.input('uNo', user.UserNo).query(`
                UPDATE AuthDB.dbo.T_Account 
                SET IsEmailVerified = 1, VerificationToken = NULL 
                WHERE UserNo = @uNo
            `);

            // ب. نظام المكافأة (إذا كان هناك داعي)
           if (user.ReferredBy && user.ReferredBy > 0) {
                
                // جلب الإعدادات + عدد الدعوات الحالية للداعي
                const inviteCheck = await request
                    .input('refBy', sql.Int, user.ReferredBy) // استخدام input
                    .query(`
                    SELECT 
                        (SELECT COUNT(*) FROM AuthDB.dbo.T_Account WHERE ReferredBy = @refBy AND IsEmailVerified = 1) AS CurrentInvites,
                        (SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'ReferralMaxCount') AS MaxLimit,
                        (SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'ReferralRewardPoints') AS PointsVal
                `);

                const currentInvites = inviteCheck.recordset[0].CurrentInvites;
                const maxLimit = parseInt(inviteCheck.recordset[0].MaxLimit) || 50;
                const rewardPoints = parseInt(inviteCheck.recordset[0].PointsVal) || 10;

                // التحقق: هل وصل للحد الأقصى؟
                if (currentInvites < maxLimit) {
                    // إضافة النقاط للداعي
                    await request
                        .input('points', sql.Int, rewardPoints)
                        .query(`
                        UPDATE AuthDB.dbo.T_Account 
                        SET LoyaltyPoints = LoyaltyPoints + @points 
                        WHERE UserNo = @refBy
                    `);

                    // تسجيل العملية
                    await request.query(`
                        INSERT INTO AdrenalineWeb.dbo.Web_LoyaltyLog (UserNo, PointsSpent, RewardType, RewardAmount, Date)
                        VALUES (@refBy, 0, 'REFERRAL_REWARD', @points, GETDATE())
                    `);
                }
            }
await transaction.commit();
            
            // 👈 إرجاع JSON بدلاً من HTML
            res.json({ status: 'success', message: 'تم تفعيل حسابك بنجاح! يمكنك الآن تسجيل الدخول.' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'حدث خطأ أثناء التفعيل' });
    }
};

// 🆕 4. دالة جديدة: إعادة إرسال رابط التفعيل (Resend Verification)
exports.resendVerification = async (req, res) => {
    const { username, password } = req.body; 

    try {
        const pool = await poolPromise;
        const userCheck = await pool.request()
            .input('uid', username)
            .query("SELECT UserNo, Email, Password, IsEmailVerified FROM AuthDB.dbo.T_Account WHERE UserId = @uid");

        const user = userCheck.recordset[0];
        if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        // 🔒 تصحيح: يجب تشفير كلمة المرور قبل مقارنتها
        const inputHash = hashPassword(password);
        if (user.Password !== inputHash) return res.status(401).json({ message: 'كلمة المرور خطأ' });
        
        if (user.IsEmailVerified) return res.status(400).json({ message: 'الحساب مفعل بالفعل!' });

        // توليد كود رقمي جديد
        const newCode = generateOTP(); 
        
        await pool.request()
            .input('code', newCode)
            .input('uid', user.UserNo)
            .query("UPDATE AuthDB.dbo.T_Account SET VerificationToken = @code WHERE UserNo = @uid");
        
        await transporter.sendMail({
            from: `"Adrenaline Game" <${process.env.EMAIL_USER}>`,
            to: user.Email,
            subject: 'أدرينالين - كود التفعيل (طلب جديد)',
            html: getEmailTemplate(
                'إعادة إرسال كود التفعيل', 
                username, 
                'بناءً على طلبك، قمنا بإنشاء كود تفعيل جديد لحسابك. يرجى استخدامه لتأكيد الحساب:', 
                newCode
            )
        });

        res.json({ status: 'success', message: `تم إرسال الكود مجدداً إلى ${user.Email}` });

    } catch (err) {
        res.status(500).json({ message: 'فشل الإرسال' });
    }
};

// 🆕 5. دالة جديدة: تصحيح الإيميل وإعادة الإرسال (Change Email & Resend)
exports.changePendingEmail = async (req, res) => {
    const { username, password, newEmail } = req.body;

    if (!newEmail) return res.status(400).json({ message: 'يجب إدخال البريد الجديد' });

    try {
        const pool = await poolPromise;

        const userCheck = await pool.request()
            .input('uid', username)
            .query("SELECT UserNo, Password, IsEmailVerified FROM AuthDB.dbo.T_Account WHERE UserId = @uid");

        const user = userCheck.recordset[0];
        if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
        
        // 🔒 تصحيح: تشفير كلمة المرور قبل المقارنة
        const inputHash = hashPassword(password);
        if (user.Password !== inputHash) return res.status(401).json({ message: 'كلمة المرور خطأ' });
        
        if (user.IsEmailVerified) return res.status(400).json({ message: 'لا يمكن تغيير البريد، الحساب مفعل بالفعل.' });

        // التأكد أن البريد الجديد غير مستخدم
        const emailCheck = await pool.request()
            .input('email', newEmail)
            .query("SELECT UserNo FROM AuthDB.dbo.T_Account WHERE Email = @email");
        
        if (emailCheck.recordset.length > 0) return res.status(400).json({ message: 'هذا البريد مستخدم بحساب آخر' });

        // توليد كود جديد
        const newCode = generateOTP(); 
        
        await pool.request()
            .input('email', newEmail)
            .input('code', newCode)
            .input('uid', user.UserNo)
            .query("UPDATE AuthDB.dbo.T_Account SET Email = @email, VerificationToken = @code WHERE UserNo = @uid");

        await transporter.sendMail({
            from: `"Adrenaline Game" <${process.env.EMAIL_USER}>`,
            to: newEmail,
            subject: 'أدرينالين - تفعيل الحساب (البريد الجديد)',
            html: getEmailTemplate(
                'تحديث البريد الإلكتروني', 
                username, 
                'تم ربط هذا البريد الإلكتروني بحسابك بنجاح. لإكمال عملية التفعيل، استخدم الكود التالي:', 
                newCode
            )
        });

        res.json({ status: 'success', message: `تم تحديث البريد إلى ${newEmail} وإرسال الكود.` });

    } catch (err) {
        res.status(500).json({ message: 'فشل التحديث' });
    }
};

// 6. طلب استعادة كلمة المرور (كما هو في نسختك)
// ... (بقية الكود في الأعلى كما هو: login, register, verifyEmail, etc...)

// -------------------------------------------------------------------------
// منطقة استعادة كلمة المرور (بدون ملفات HTML خارجية)
// -------------------------------------------------------------------------

exports.forgotPassword = async (req, res) => {
    const { username, email } = req.body;

    if (!username && !email) {
        return res.status(400).json({ message: 'الرجاء إدخال اسم المستخدم أو البريد الإلكتروني' });
    }

    try {
        const pool = await poolPromise;
        let request = pool.request();
        let queryStr = "";

        if (username) {
            request.input('uid', username);
            queryStr = "SELECT UserNo, UserId, Email FROM AuthDB.dbo.T_Account WHERE UserId = @uid";
        } else {
            request.input('email', email);
            queryStr = "SELECT UserNo, UserId, Email FROM AuthDB.dbo.T_Account WHERE Email = @email";
        }

        const userCheck = await request.query(queryStr);

        if (userCheck.recordset.length === 0) {
            return res.status(404).json({ message: 'الحساب غير موجود' });
        }

        const user = userCheck.recordset[0];
        const targetEmail = user.Email;
        const targetUsername = user.UserId;

        const resetCode = generateOTP(); 

        await pool.request()
            .input('code', resetCode)
            .input('uNo', user.UserNo)
            .query(`UPDATE AuthDB.dbo.T_Account SET PasswordResetToken = @code, ResetTokenExpiry = DATEADD(HOUR, 1, GETDATE()) WHERE UserNo = @uNo`);

        await transporter.sendMail({
            from: `"Adrenaline Support" <${process.env.EMAIL_USER}>`,
            to: targetEmail,
            subject: 'أدرينالين - طلب استعادة كلمة المرور',
            html: getEmailTemplate(
                'استعادة كلمة المرور', 
                targetUsername, 
                'لقد تلقينا طلباً لتغيير كلمة المرور الخاصة بحسابك. هذا الكود صالح لمدة ساعة واحدة فقط:', 
                resetCode
            )
        });

        const hiddenEmail = maskEmail(targetEmail);

        res.json({ 
            status: 'success', 
            message: 'تم إرسال كود الاستعادة بنجاح.',
            maskedEmail: hiddenEmail
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل إرسال الطلب' });
    }
};


// 8. تنفيذ تغيير كلمة المرور (المرنة والمصححة)
exports.resetPassword = async (req, res) => {
    const { username, email, code, newPassword } = req.body;
    const identifier = username || email;

    if (!identifier || !code || !newPassword) {
        return res.status(400).json({ message: 'البيانات ناقصة (يجب إرسال اسم المستخدم أو الإيميل مع الكود)' });
    }

    try {
        const pool = await poolPromise;
        const cleanCode = code.toString().trim();

        const result = await pool.request()
            .input('identifier', identifier)
            .input('code', cleanCode)
            .query(`
                SELECT UserNo FROM AuthDB.dbo.T_Account 
                WHERE (UserId = @identifier OR Email = @identifier) 
                AND PasswordResetToken = @code 
                AND ResetTokenExpiry > GETDATE()
            `);

        if (result.recordset.length === 0) {
            console.log(`❌ فشل الاستعادة | المعرف: ${identifier} | الكود المُدخل: "${cleanCode}"`);
            return res.status(400).json({ message: 'الكود خاطئ أو منتهي الصلاحية' });
        }

        const hashedPassword = hashPassword(newPassword);

        await pool.request()
            .input('pass', hashedPassword)
            .input('uNo', result.recordset[0].UserNo)
            .query(`
                UPDATE AuthDB.dbo.T_Account 
                SET Password = @pass, PasswordResetToken = NULL, ResetTokenExpiry = NULL 
                WHERE UserNo = @uNo
            `);

        res.json({ status: 'success', message: 'تم تغيير كلمة المرور بنجاح' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل تغيير كلمة المرور' });
    }
};

// -------------------------------------------------------------------------
// دالة تغيير الإيميل 
// -------------------------------------------------------------------------
exports.changeEmail = async (req, res) => {
    const { password, newEmail } = req.body;
    const userNo = req.user.userNo; 

    if (!password || !newEmail) return res.status(400).json({ message: 'يجب إدخال كلمة المرور والبريد الجديد' });

    try {
        const pool = await poolPromise;

        const userCheck = await pool.request()
            .input('uid', userNo)
            .query("SELECT Password FROM AuthDB.dbo.T_Account WHERE UserNo = @uid");
        
        const currentPass = userCheck.recordset[0]?.Password;
        const inputHash = hashPassword(password); 

        if (currentPass !== inputHash) {
            return res.status(401).json({ message: 'كلمة المرور غير صحيحة' });
        }

        const emailCheck = await pool.request().input('email', newEmail).query("SELECT UserNo FROM AuthDB.dbo.T_Account WHERE Email = @email");
        if (emailCheck.recordset.length > 0) return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });

        const newCode = generateOTP(); 
        
        await pool.request()
            .input('uid', userNo)
            .input('email', newEmail)
            .input('code', newCode)
            .query(`
                UPDATE AuthDB.dbo.T_Account 
                SET Email = @email, IsEmailVerified = 0, VerificationToken = @code 
                WHERE UserNo = @uid
            `);

        await transporter.sendMail({
            from: `"Adrenaline Security" <${process.env.EMAIL_USER}>`,
            to: newEmail,
            subject: 'أدرينالين - تأكيد تغيير البريد الإلكتروني',
            html: getEmailTemplate(
                'تأكيد البريد الإلكتروني الجديد', 
                req.user.userId || 'أيها اللاعب', 
                'لقد قمت بتغيير بريدك الإلكتروني بنجاح. لتفعيل حسابك مرة أخرى وتأمين التغيير، أدخل الكود التالي:', 
                newCode
            )
        });

        res.json({ status: 'success', message: 'تم تغيير البريد. يرجى تفعيل البريد الجديد بالكود المرسل لصندوق الوارد.' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'حدث خطأ أثناء تغيير البريد' });
    }
};