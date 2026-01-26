const express = require('express');
const router = express.Router();
const couponAdminController = require('../controllers/couponAdminController');
const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware');

// جميع الروابط تتطلب أن تكون أدمن
router.post('/create-bundle', auth, admin, couponAdminController.createBundle);
router.post('/create-gift', auth, admin, couponAdminController.createGiftCoupon);

module.exports = router;