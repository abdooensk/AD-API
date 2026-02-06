const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyaltyController');
const auth = require('../middleware/authMiddleware');

router.get('/stats', auth, loyaltyController.getMyLoyaltyStats);

router.post('/exchange', auth, loyaltyController.exchangePoints);

// ✅ تم التعديل ليطابق التوثيق /claim
router.post('/claim', auth, loyaltyController.claimDailyReward);

// ✅ إضافة رابط القائمة الذي طلبته سابقاً (تأكد من وجود الدالة في الكنترولر)
router.get('/attendance/list', auth, loyaltyController.getAttendanceList);
module.exports = router;