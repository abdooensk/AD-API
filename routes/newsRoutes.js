const express = require('express');
const router = express.Router();
const newsController = require('../controllers/newsController');
const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware');
// 👇 استيراد أداة الرفع الجديدة
const { uploadNews } = require('../utils/uploadConfig'); 

// 1. عرض الأخبار (متاح للجميع)
router.get('/', newsController.getAllNews);

// 2. إضافة خبر (يحتاج توكن + أدمن + 👈 رفع صورة)
// لاحظ إضافة uploadNews.single('image') هنا
router.post('/add', auth, admin, uploadNews.single('image'), newsController.createNews);

router.get('/:id', newsController.getNewsDetails);
// 3. تعديل خبر (اختياري)
// router.put('/update/:id', auth, admin, uploadNews.single('image'), newsController.updateNews);
router.put('/update/:id', auth, admin, uploadNews.single('image'), newsController.updateNews);
// 4. حذف خبر
router.delete('/delete/:id', auth, admin, newsController.deleteNews);

module.exports = router;