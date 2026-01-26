const express = require('express');
const router = express.Router();
// 1. استيراد المتحكمات (تأكد من وجود الملفين في مجلد controllers)
const adminController = require('../controllers/adminController'); 
const adminCosmetic = require('../controllers/adminCosmeticController'); // 👈 هذا كان مفقوداً

const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware');

// جميع الروابط تتطلب: توكن + صلاحية أدمن
// نستخدم router.use لتطبيق الحماية على كل الروابط أدناه بدلاً من تكرارها
router.use(auth, admin);

// روابط إدارة اللاعبين (موجودة في adminController)
router.post('/ban', adminController.banPlayer);
router.get('/unban-requests', adminController.getUnbanRequests);
router.post('/approve-unban', adminController.approveUnban);

// روابط إدارة المتجر (موجودة في adminCosmeticController)
router.post('/cosmetics/add', adminCosmetic.addCosmetic); // 👈 الآن سيتم التعرف عليه
router.put('/cosmetics/toggle', adminCosmetic.toggleStatus);
router.delete('/cosmetics/delete/:cosmeticId', adminCosmetic.deleteCosmetic);

module.exports = router;