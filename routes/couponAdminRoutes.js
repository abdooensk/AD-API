const express = require('express');
const router = express.Router();
const couponAdmin = require('../controllers/couponAdminController');
const { uploadCoupon } = require('../utils/uploadConfig'); // ✅ استيراد أداة الرفع
const requireRole = require('../middleware/roleMiddleware');
const auth = require('../middleware/authMiddleware');

router.use(auth);

// 🆕 إضافة قسيمة مميزة (صورة + بيانات)
// نستخدم uploadCoupon.single('image') لأننا نرفع صورة واحدة باسم حقل 'image'
router.post('/add-premium', requireRole(10), uploadCoupon.single('image'), couponAdmin.createPremiumCoupon);

// عرض القسائم
router.get('/list-premium', requireRole(10), couponAdmin.getPremiumCoupons);

// حذف قسيمة
router.delete('/delete-premium/:id', requireRole(10), couponAdmin.deletePremiumCoupon);

// إنشاء كود هدية (نصي)
router.post('/create-gift', requireRole(10), couponAdmin.createGiftCoupon);

router.put('/edit-premium/:id', requireRole(10), uploadCoupon.single('image'), couponAdmin.updatePremiumCoupon);

// حذف قسيمة (DELETE) - موجودة سابقاً لكن تأكد من الرابط
router.delete('/delete-premium/:id', requireRole(10), couponAdmin.deletePremiumCoupon);

module.exports = router;