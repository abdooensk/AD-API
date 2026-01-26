const express = require('express');
const router = express.Router();
const paypalController = require('../controllers/paypalController');
const auth = require('../middleware/authMiddleware');

router.post('/create-order', auth, paypalController.createOrder);
router.post('/capture-order', auth, paypalController.captureOrder);

module.exports = router;