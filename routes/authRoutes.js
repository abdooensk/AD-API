const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// ✅ تصحيح الاستيراد: يجب وضع { validate } بين أقواس إذا كان التصدير يتم كـ module.exports = { validate }
const { validate } = require('../middleware/validationMiddleware');
const { loginSchema, registerSchema } = require('../utils/validators');

// --- روابط التوثيق الأساسية (محمية بـ Joi) ---

// 1. تسجيل الدخول
router.post('/login', validate(loginSchema), authController.login);

// 2. تسجيل جديد
router.post('/register', validate(registerSchema), authController.register);

// --- روابط تفعيل الحساب ---

// 3. تفعيل الإيميل (رابط يأتي من البريد)
router.post('/verify-email', authController.verifyEmail);

// 4. إعادة إرسال كود التفعيل
router.post('/resend-verification', authController.resendVerification);

// 5. تصحيح الإيميل 
router.post('/change-pending-email', authController.changePendingEmail);

// --- روابط استعادة كلمة المرور ---

// 6. طلب الاستعادة (يرسل كود التفعيل للإيميل)
router.post('/forgot-password', authController.forgotPassword);
// 7. تنفيذ تغيير الباسورد (يستقبل اسم المستخدم، الكود، والباسورد الجديد)
router.post('/reset-password', authController.resetPassword);

module.exports = router;