const express = require('express');
const router = express.Router();
const luckyWheelController = require('../controllers/luckyWheelController');
const auth = require('../middleware/authMiddleware');

// 1. عرض عناصر العجلة (متاح للجميع ليروا الجوائز)
router.get('/items', luckyWheelController.getWheelItems);

// 2. تدوير العجلة (يتطلب تسجيل دخول)
router.post('/spin', auth, luckyWheelController.spinWheel);

module.exports = router;