const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const auth = require('../middleware/authMiddleware');

// 1. عرض متجر الحزم (متاح للمسجلين)
router.get('/shop', auth, couponController.getShopBundles);

// 2. شراء حزمة (توليد كود)
router.post('/buy', auth, couponController.buyBundle);

// 3. عرض قسائمي
router.get('/my-coupons', auth, couponController.getMyCoupons);

// 4. ترقية القسيمة لعامة
router.post('/upgrade', auth, couponController.upgradeToPublic);

module.exports = router;