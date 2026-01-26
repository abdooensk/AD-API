const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyaltyController');
const auth = require('../middleware/authMiddleware');

router.get('/my-stats', auth, loyaltyController.getMyLoyaltyStats);
router.post('/exchange', auth, loyaltyController.exchangePoints);
router.post('/daily-claim', auth, loyaltyController.claimDailyReward); // 👈 الرابط الجديد

module.exports = router;