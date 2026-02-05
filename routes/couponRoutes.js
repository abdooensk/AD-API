const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const auth = require('../middleware/authMiddleware');

// 1. عرض متجر القسائم (تم تعديل الاسم ليطابق الفرونت إند)
router.get('/premium/list', auth, couponController.getShopBundles);

// 2. شراء قسيمة
router.post('/premium/buy', auth, couponController.buyBundle);

// 3. عرض قسائمي
router.get('/my-coupons', auth, couponController.getMyCoupons);

// 4. استخدام القسيمة لنفسي

// 5. تحويل القسيمة لعامة (Make Public)
router.post('/make-public', auth, couponController.upgradeToPublic);

// 6. استلام قسيمة عامة (من صديق)
// router.post('/redeem-public', auth, couponController.redeemPublicCoupon); // (تحتاج لإضافة الدالة في الكونترولر إذا أردتها)

// 7. سجل العمليات (كان مفقوداً ويسبب 404)
router.get('/history', auth, couponController.getCouponHistory);

module.exports = router;