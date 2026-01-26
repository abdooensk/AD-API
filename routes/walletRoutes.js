// routes/walletRoutes.js
const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const auth = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const { transactionSchema } = require('../utils/validators');

// === أضف هذا الجزء للفحص ===
console.log("--- DEBUG CHECK ---");
console.log("1. Auth Middleware:", typeof auth); // يجب أن يكون 'function'
console.log("2. Validate Middleware:", typeof validate); // يجب أن يكون 'function'
console.log("3. Schema:", typeof transactionSchema); // يجب أن يكون 'object'
console.log("4. transferMoney:", typeof walletController.transferMoney); // 👈 أشك أن هذا سيكون 'undefined'
console.log("5. exchangeCurrency:", typeof walletController.exchangeCurrency); // 👈 أو هذا
console.log("-------------------");
// ==========================

router.post('/transfer', auth, validate(transactionSchema), walletController.transferMoney);
router.post('/exchange', auth, validate(transactionSchema), walletController.exchangeCurrency);

module.exports = router;