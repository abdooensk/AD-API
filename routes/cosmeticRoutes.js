const express = require('express');
const router = express.Router();
const cosmeticController = require('../controllers/cosmeticController');
const auth = require('../middleware/authMiddleware');

// 1. عرض المتجر (يجب أن يطابق الاسم في الكنترولر)
router.get('/shop', cosmeticController.getShop); 

// 2. عرض أغراضي
router.get('/my-items', auth, cosmeticController.getMyCosmetics);

// 3. الشراء
router.post('/buy', auth, cosmeticController.buyCosmetic);

// 4. التجهيز
router.post('/equip', auth, cosmeticController.equipCosmetic);

module.exports = router;