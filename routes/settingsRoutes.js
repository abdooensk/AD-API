const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware');

// 1. جلب الإعدادات (مفتوح للجميع - لا يحتاج توكن)
// لأن الزائر يحتاج معرفة رابط التحميل قبل تسجيل الدخول
router.get('/public', settingsController.getPublicSettings);

// 2. تحديث الإعدادات (للأدمن فقط)
router.post('/update', auth, admin, settingsController.updateSetting);

module.exports = router;