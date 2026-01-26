const { poolPromise, sql } = require('../config/db');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { decodeReferralCode } = require('../utils/referralCodec');
require('dotenv').config(); // 👈 مهم لقراءة الإيميل والباسورد من الملف السري

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_adrenaline_key_2026';

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
        const result = await pool.request()
            .input('uid', username)
            .query(`
                SELECT A.UserNo, A.UserId, A.Password, A.IsBanned, A.IsEmailVerified, A.Email, -- 👈 أضفنا Email هنا
                       U.GMGrade, U.Nickname 
                FROM AuthDB.dbo.T_Account A
                LEFT JOIN GameDB.dbo.T_User U ON A.UserNo = U.UserNo 
                WHERE A.UserId = @uid
            `);

        const user = result.recordset[0];

        if (!user) return res.status(404).json({ message: 'اسم المستخدم غير موجود' });
        if (user.Password !== password) return res.status(401).json({ message: 'كلمة المرور غير صحيحة' });
        
        // التحقق من تفعيل الإيميل (التعديل الجديد)
        if (user.IsEmailVerified === false) {
            return res.status(403).json({ 
                message: 'يجب تأكيد البريد الإلكتروني أولاً. راجع صندوق الوارد.',
                errorType: 'NOT_VERIFIED', // كود ليستخدمه الموقع لإظهار الأزرار
                currentEmail: user.Email   // نرسل الإيميل الحالي ليعرف اللاعب أين الخطأ
            });
        }

        const isBanned = user.IsBanned === 1 || user.IsBanned === true;
        const token = jwt.sign(
            { userNo: user.UserNo, userId: user.UserId, isAdmin: user.GMGrade >= 1, isBanned: isBanned },
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
                isBanned: isBanned
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'حدث خطأ في السيرفر', error: err.message });
    }
};

// 2. إنشاء حساب جديد (Register) - (كما هو تماماً في نسختك)
exports.register = async (req, res) => {
    // 👇 التعديل هنا: استخدام userid و referralCode ليطابق Postman
    const { userid, password, email, referralCode } = req.body;

    console.log('بيانات التسجيل:', req.body); // للتأكد في الكونسول

    // التحقق من المتغيرات بالأسماء الجديدة
    if (!userid || !password || !email) {
        return res.status(400).json({ message: 'البيانات ناقصة: تأكد من إرسال userid, password, email' });
    }

    try {
        const pool = await poolPromise;

        // 1. التحقق من التكرار
        const check = await pool.request()
            .input('uid', userid)
            .input('email', email)
            .query('SELECT UserId FROM AuthDB.dbo.T_Account WHERE UserId = @uid OR Email = @email');
        
        if (check.recordset.length > 0) {
            return res.status(400).json({ message: 'اسم المستخدم أو البريد مسجل مسبقاً' });
        }

        // 2. معالجة كود الدعوة (تحويل الكود النصي إلى رقم)
        let referrerUserNo = null;
        if (referralCode) {
            const decodedId = decodeReferralCode(referralCode);
            if (decodedId) {
                // التأكد من أن الداعي موجود فعلاً
                const refCheck = await pool.request().query(`SELECT UserNo FROM AuthDB.dbo.T_Account WHERE UserNo = ${decodedId}`);
                if (refCheck.recordset.length > 0) {
                    referrerUserNo = decodedId;
                }
            }
        }

        // 3. الإدخال في قاعدة البيانات
        const verificationToken = require('crypto').randomBytes(32).toString('hex');

        await pool.request()
            .input('uid', userid)
            .input('pass', password) 
            .input('email', email)
            .input('token', verificationToken)
            .input('ref', referrerUserNo) // 👈 إدخال رقم الداعي
            .query(`
                INSERT INTO AuthDB.dbo.T_Account 
                (UserId, Password, Email, IsEmailVerified, VerificationToken, ReferredBy, RegDate, IsBanned)
                VALUES 
                (@uid, @pass, @email, 0, @token, @ref, GETDATE(), 0)
            `);

        res.json({ status: 'success', message: 'تم التسجيل بنجاح!' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل التسجيل', error: err.message });
    }
};

// 3. تفعيل الإيميل (كما هو في نسختك)
// تحديث: دالة تفعيل الإيميل + مكافأة الداعي
exports.verifyEmail = async (req, res) => {
    const { token } = req.query;

    if (!token) return res.status(400).json({ message: 'رمز التفعيل مفقود' });

    try {
        const pool = await poolPromise;

        // 1. جلب بيانات اللاعب والداعي
        const checkResult = await pool.request()
            .input('token', token)
            .query(`
                SELECT UserNo, UserId, IsEmailVerified, ReferredBy 
                FROM AuthDB.dbo.T_Account 
                WHERE VerificationToken = @token
            `);

        const user = checkResult.recordset[0];

        if (!user) return res.status(400).json({ message: 'رابط التفعيل غير صالح' });
        if (user.IsEmailVerified) return res.status(400).json({ message: 'الحساب مفعل مسبقاً' });

        // 2. بدء التفعيل
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // أ. تفعيل الحساب
            await request.query(`
                UPDATE AuthDB.dbo.T_Account 
                SET IsEmailVerified = 1, VerificationToken = NULL 
                WHERE UserNo = ${user.UserNo}
            `);

            // ب. نظام المكافأة (إذا كان هناك داعي)
            if (user.ReferredBy && user.ReferredBy > 0) {
                
                // جلب الإعدادات + عدد الدعوات الحالية للداعي
                const inviteCheck = await request.query(`
                    SELECT 
                        (SELECT COUNT(*) FROM AuthDB.dbo.T_Account WHERE ReferredBy = ${user.ReferredBy} AND IsEmailVerified = 1) AS CurrentInvites,
                        (SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'ReferralMaxCount') AS MaxLimit,
                        (SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'ReferralRewardPoints') AS PointsVal
                `);

                const currentInvites = inviteCheck.recordset[0].CurrentInvites;
                const maxLimit = parseInt(inviteCheck.recordset[0].MaxLimit) || 50;
                const rewardPoints = parseInt(inviteCheck.recordset[0].PointsVal) || 10;

                // التحقق: هل وصل للحد الأقصى؟
                if (currentInvites < maxLimit) {
                    // إضافة النقاط للداعي
                    await request.query(`
                        UPDATE AuthDB.dbo.T_Account 
                        SET LoyaltyPoints = LoyaltyPoints + ${rewardPoints} 
                        WHERE UserNo = ${user.ReferredBy}
                    `);

                    // تسجيل العملية
                    await request.query(`
                        INSERT INTO AdrenalineWeb.dbo.Web_LoyaltyLog (UserNo, PointsSpent, RewardType, RewardAmount, Date)
                        VALUES (${user.ReferredBy}, 0, 'REFERRAL_REWARD', ${rewardPoints}, GETDATE())
                    `);
                }
            }

            await transaction.commit();
            
            res.send(`
                <h1 style="color:green; text-align:center;">تم تفعيل حسابك بنجاح!</h1>
                <p style="text-align:center;">يمكنك الآن الدخول للعبة.</p>
            `);

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('<h1>حدث خطأ أثناء التفعيل</h1>');
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
        if (user.Password !== password) return res.status(401).json({ message: 'كلمة المرور خطأ' });
        if (user.IsEmailVerified) return res.status(400).json({ message: 'الحساب مفعل بالفعل!' });

        const newToken = uuidv4();
        await pool.request()
            .input('token', newToken)
            .input('uid', user.UserNo)
            .query("UPDATE AuthDB.dbo.T_Account SET VerificationToken = @token WHERE UserNo = @uid");

        const verifyLink = `http://localhost:3000/api/auth/verify-email?token=${newToken}`;
        
        await transporter.sendMail({
            from: `"Adrenaline Game" <${process.env.EMAIL_USER}>`,
            to: user.Email,
            subject: 'إعادة إرسال رابط التفعيل',
            html: `<h3>مرحباً ${username}</h3><p>طلب جديد لتفعيل الحساب:</p><a href="${verifyLink}">تفعيل الحساب الآن</a>`
        });

        res.json({ status: 'success', message: `تم إرسال الرابط مجدداً إلى ${user.Email}` });

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
        if (user.Password !== password) return res.status(401).json({ message: 'كلمة المرور خطأ' });
        if (user.IsEmailVerified) return res.status(400).json({ message: 'لا يمكن تغيير البريد، الحساب مفعل بالفعل.' });

        // التأكد أن البريد الجديد غير مستخدم
        const emailCheck = await pool.request()
            .input('email', newEmail)
            .query("SELECT UserNo FROM AuthDB.dbo.T_Account WHERE Email = @email");
        
        if (emailCheck.recordset.length > 0) return res.status(400).json({ message: 'هذا البريد مستخدم بحساب آخر' });

        const newToken = uuidv4();
        await pool.request()
            .input('email', newEmail)
            .input('token', newToken)
            .input('uid', user.UserNo)
            .query("UPDATE AuthDB.dbo.T_Account SET Email = @email, VerificationToken = @token WHERE UserNo = @uid");

        const verifyLink = `http://localhost:3000/api/auth/verify-email?token=${newToken}`;
        
        await transporter.sendMail({
            from: `"Adrenaline Game" <${process.env.EMAIL_USER}>`,
            to: newEmail,
            subject: 'تفعيل الحساب (بريد جديد)',
            html: `<h3>تم تحديث بريدك بنجاح!</h3><p>اضغط هنا لتفعيل الحساب:</p><a href="${verifyLink}">تفعيل الحساب</a>`
        });

        res.json({ status: 'success', message: `تم تحديث البريد إلى ${newEmail} وإرسال الرابط.` });

    } catch (err) {
        res.status(500).json({ message: 'فشل التحديث' });
    }
};

// 6. طلب استعادة كلمة المرور (كما هو في نسختك)
// ... (بقية الكود في الأعلى كما هو: login, register, verifyEmail, etc...)

// -------------------------------------------------------------------------
// منطقة استعادة كلمة المرور (بدون ملفات HTML خارجية)
// -------------------------------------------------------------------------

// 6. طلب استعادة كلمة المرور (Forgot Password)
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'الرجاء إدخال البريد الإلكتروني' });

    try {
        const pool = await poolPromise;
        // التحقق من وجود الإيميل
        const userCheck = await pool.request().input('email', email).query("SELECT UserNo, UserId FROM AuthDB.dbo.T_Account WHERE Email = @email");

        if (userCheck.recordset.length === 0) return res.status(404).json({ message: 'البريد الإلكتروني غير مسجل' });

        const resetToken = uuidv4();
        const username = userCheck.recordset[0].UserId;

        // حفظ التوكن
        await pool.request()
            .input('token', resetToken)
            .input('email', email)
            .query(`UPDATE AuthDB.dbo.T_Account SET PasswordResetToken = @token, ResetTokenExpiry = DATEADD(HOUR, 1, GETDATE()) WHERE Email = @email`);

        // 👇 التغيير هنا: الرابط يشير لصفحة تولدها السيرفر مباشرة
        const resetLink = `http://localhost:3000/api/auth/reset-password-page?token=${resetToken}`;

        // إرسال الإيميل
        await transporter.sendMail({
            from: `"Adrenaline Support" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'استعادة كلمة المرور',
            html: `
                <div style="font-family: Arial; text-align: center;">
                    <h3>تغيير كلمة المرور</h3>
                    <p>مرحباً ${username}، لاستعادة كلمة المرور اضغط هنا:</p>
                    <a href="${resetLink}" style="background-color: #333; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">تغيير كلمة المرور</a>
                </div>
            `
        });

        res.json({ status: 'success', message: 'تم إرسال رابط الاستعادة للإيميل.' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل إرسال الطلب' });
    }
};

// 🆕 7. عرض صفحة تغيير الباسورد (GET Request)
// هذه الدالة ترسم صفحة HTML مباشرة في المتصفح بدون ملف خارجي
exports.getResetPasswordPage = (req, res) => {
    const { token } = req.query;

    if (!token) return res.send('<h1>رابط غير صالح</h1>');

    // نرسل كود HTML بسيط يحتوي على فورم وإسكربت
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>تغيير كلمة المرور</title>
            <style>
                body { font-family: Arial; background: #222; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .box { background: #333; padding: 30px; border-radius: 10px; text-align: center; width: 300px; box-shadow: 0 0 15px rgba(0,0,0,0.5); }
                input { width: 90%; padding: 10px; margin: 10px 0; border-radius: 5px; border: none; }
                button { width: 100%; padding: 10px; background: #e74c3c; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
                button:hover { background: #c0392b; }
            </style>
        </head>
        <body>
            <div class="box">
                <h2>كلمة المرور الجديدة 🔐</h2>
                <input type="password" id="newPass" placeholder="أكتب كلمة المرور الجديدة">
                <button onclick="savePassword()">حفظ التغييرات</button>
                <p id="msg"></p>
            </div>

            <script>
                async function savePassword() {
                    const pass = document.getElementById('newPass').value;
                    const token = "${token}"; // السيرفر يضع التوكن هنا تلقائياً
                    
                    if(!pass) return alert('أكتب كلمة المرور!');

                    const res = await fetch('/api/auth/reset-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: token, newPassword: pass })
                    });

                    const data = await res.json();
                    const msg = document.getElementById('msg');
                    
                    if(data.status === 'success') {
                        msg.style.color = 'lightgreen';
                        msg.innerText = 'تم التغيير بنجاح! يمكنك إغلاق الصفحة.';
                        document.getElementById('newPass').value = '';
                    } else {
                        msg.style.color = 'red';
                        msg.innerText = data.message;
                    }
                }
            </script>
        </body>
        </html>
    `);
};

// 8. تنفيذ التغيير (POST Request) - (نفس الدالة السابقة)
exports.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;
    // ... (نفس الكود السابق تماماً) ...
    if (!token || !newPassword) return res.status(400).json({ message: 'البيانات ناقصة' });

    try {
        const pool = await poolPromise;
        const result = await pool.request().input('token', token).query("SELECT UserNo FROM AuthDB.dbo.T_Account WHERE PasswordResetToken = @token AND ResetTokenExpiry > GETDATE()");

        if (result.recordset.length === 0) return res.status(400).json({ message: 'الرابط منتهي أو غير صالح' });

        await pool.request().input('pass', newPassword).input('uid', result.recordset[0].UserNo).query("UPDATE AuthDB.dbo.T_Account SET Password = @pass, PasswordResetToken = NULL, ResetTokenExpiry = NULL WHERE UserNo = @uid");

        res.json({ status: 'success', message: 'تم تغيير كلمة المرور بنجاح' });
    } catch (err) {
        res.status(500).json({ message: 'خطأ سيرفر' });
    }
};

// 7. تنفيذ تغيير كلمة المرور (كما هو في نسختك)
exports.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ message: 'البيانات ناقصة' });

    try {
        const pool = await poolPromise;
        const result = await pool.request().input('token', token).query("SELECT UserNo FROM AuthDB.dbo.T_Account WHERE PasswordResetToken = @token AND ResetTokenExpiry > GETDATE()");

        if (result.recordset.length === 0) return res.status(400).json({ message: 'الرابط منتهي أو غير صالح' });

        await pool.request().input('pass', newPassword).input('uid', result.recordset[0].UserNo).query("UPDATE AuthDB.dbo.T_Account SET Password = @pass, PasswordResetToken = NULL, ResetTokenExpiry = NULL WHERE UserNo = @uid");

        res.json({ status: 'success', message: 'تم تغيير كلمة المرور بنجاح' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل تغيير كلمة المرور' });
    }
};