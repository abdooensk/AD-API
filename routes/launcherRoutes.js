// routes/launcherRoutes.js
const express = require('express');
const router = express.Router();
const launcherController = require('../controllers/launcherController');

// المسار السابق لجلب المعلومات
router.get('/info', launcherController.getLauncherInfo);

// 🔴 المسار الجديد لتوليد التوكن
router.post('/generate-token', launcherController.generateLaunchToken);
router.post('/close-session', launcherController.closeSession); // 🔴 المسار الجديد
router.get('/files', launcherController.getGameFiles); // 🔴 مسار فحص الملفات
module.exports = router;