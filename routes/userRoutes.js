const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authController = require('../controllers/authController'); // لاستيراد تغيير الإيميل
const auth = require('../middleware/authMiddleware');
// الروابط الأساسية
router.get('/profile', auth, userController.getProfile);
router.post('/change-password', auth, userController.changePassword);

// روابط الحظر (تأكد أنك نسخت الكود أعلاه لكي تعمل هذه الدوال)
router.get('/ban-info', auth, userController.getBanStatus);
router.post('/request-unban', auth, userController.requestUnban);
router.post('/change-email', auth, authController.changeEmail); // تغيير الإيميل
router.get('/sessions', auth, userController.getActiveSessions); // عرض الجلسات
router.post('/sessions/revoke', auth, userController.revokeSession); // طرد جهاز
module.exports = router;