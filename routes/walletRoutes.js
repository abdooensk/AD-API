// routes/walletRoutes.js
const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const auth = require('../middleware/authMiddleware');

// ✅ 1. استيراد الدالة بشكل صحيح (Destructuring) لتتوافق مع الميدلوير الجديد
const { validate } = require('../middleware/validationMiddleware');

// ✅ 2. استيراد المخطط
const { transactionSchema } = require('../utils/validators');

// --- الروابط ---

// تحويل الأموال (محمي بالتوكن + فحص البيانات)
router.post('/transfer', auth, validate(transactionSchema), walletController.transferMoney);

// تحويل العملة
router.post('/exchange', auth, validate(transactionSchema), walletController.exchangeCurrency);

module.exports = router;