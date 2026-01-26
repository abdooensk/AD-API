const express = require('express');
const router = express.Router();
const rankController = require('../controllers/rankController');

// هذه الروابط عامة (لا تحتاج توكن auth) لأن أي شخص زائر يمكنه رؤية الترتيب
router.get('/players', rankController.getTopPlayers);
router.get('/killers', rankController.getTopKillers);
router.get('/clans', rankController.getTopClans);

module.exports = router;