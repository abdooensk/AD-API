// routes/serverRoutes.js
const express = require('express');
const router = express.Router();
const serverController = require('../controllers/serverController');

// GET /api/server/status
router.get('/status', serverController.getServerStatus);

// GET /api/server/history
router.get('/history', serverController.getServerHistory);

module.exports = router;