// routes/launcherRoutes.js
const express = require('express');
const router = express.Router();
const launcherController = require('../controllers/launcherController');

// المسار السابق لجلب المعلومات
router.get('/info', launcherController.getLauncherInfo);

// 🔴 المسار الجديد لتوليد التوكن
router.get('/handshake', launcherController.handshake);

// المسار الثاني للتحقق وإصدار توكن الجلسة المشفر
router.post('/generate-token-secure', launcherController.generateTokenSecure);
router.post('/close-session', launcherController.closeSession); // 🔴 المسار الجديد
router.get('/files', launcherController.getGameFiles); // 🔴 مسار فحص الملفات
router.post('/heartbeat', launcherController.heartbeat); // 👈 إضافة مسار النبضة
router.post('/ban', launcherController.banPlayer);
module.exports = router;