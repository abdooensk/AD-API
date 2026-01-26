const express = require('express');
const router = express.Router();
const newsController = require('../controllers/newsController');
const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware'); // استيراد حماية الأدمن

// 1. عرض الأخبار (متاح للجميع - لا يحتاج توكن)
router.get('/list', newsController.getAllNews);

// 2. إضافة خبر (يحتاج توكن + صلاحية أدمن)
// الترتيب مهم: تحقق من التوكن أولاً (auth)، ثم تحقق من الصلاحية (admin)
router.post('/add', auth, admin, newsController.createNews);

// 3. حذف خبر (يحتاج توكن + صلاحية أدمن)
router.delete('/delete/:id', auth, admin, newsController.deleteNews);

module.exports = router;