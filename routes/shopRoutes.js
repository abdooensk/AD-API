const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shopController');
const auth = require('../middleware/authMiddleware');

// عرض المتجر (متاح للجميع أو للأعضاء فقط، هنا جعلته للأعضاء)
router.get('/list', auth, shopController.getShopItems);

// الشراء (يتطلب توكن)
router.post('/buy', auth, shopController.buyItem);

module.exports = router;