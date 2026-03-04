const express = require('express');
const router = express.Router();
const launcherController = require('../controllers/launcherController');

// المسار سيكون: GET /api/launcher/info
router.get('/info', launcherController.getLauncherInfo);

module.exports = router;