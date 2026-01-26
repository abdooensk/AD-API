const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middleware/authMiddleware');

// الروابط الأساسية
router.get('/profile', auth, userController.getProfile);
router.post('/change-password', auth, userController.changePassword);

// روابط الحظر (تأكد أنك نسخت الكود أعلاه لكي تعمل هذه الدوال)
router.get('/ban-info', auth, userController.getBanStatus);
router.post('/request-unban', auth, userController.requestUnban);

module.exports = router;