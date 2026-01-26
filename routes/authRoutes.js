const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// 1. استيراد أدوات التحقق الأمنية
const validate = require('../middleware/validationMiddleware');
const { loginSchema, registerSchema } = require('../utils/validators');

// --- روابط التوثيق الأساسية (محمية بـ Joi) ---

// 1. تسجيل الدخول: نمرر البيانات عبر validate(loginSchema) أولاً
router.post('/login', validate(loginSchema), authController.login);

// 2. تسجيل جديد: نمرر البيانات عبر validate(registerSchema) أولاً
router.post('/register', validate(registerSchema), authController.register);

// --- روابط تفعيل الحساب ---

// 3. تفعيل الإيميل (رابط يأتي من البريد)
router.get('/verify-email', authController.verifyEmail);

// 4. إعادة إرسال كود التفعيل
router.post('/resend-verification', authController.resendVerification);

// 5. تصحيح الإيميل (في حال أخطأ اللاعب في كتابته)
router.post('/change-pending-email', authController.changePendingEmail);

// --- روابط استعادة كلمة المرور ---

// 6. طلب الاستعادة (يرسل الإيميل)
router.post('/forgot-password', authController.forgotPassword);

// 7. صفحة الويب لاستعادة كلمة المرور (GET)
router.get('/reset-password-page', authController.getResetPasswordPage);

// 8. تنفيذ تغيير الباسورد (POST)
router.post('/reset-password', authController.resetPassword);

module.exports = router;