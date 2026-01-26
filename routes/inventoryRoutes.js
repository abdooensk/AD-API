const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const auth = require('../middleware/authMiddleware');

router.get('/my-items', auth, inventoryController.getMyInventory);
router.post('/seal', auth, inventoryController.sealItem);
// تم حذف unseal حسب طلبك

module.exports = router;