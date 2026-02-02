const express = require('express');
const router = express.Router();

// 1. استيراد المتحكمات
const adminController = require('../controllers/adminController'); 
const adminCosmetic = require('../controllers/adminCosmeticController');
const adminInventory = require('../controllers/adminInventoryController');
const adminShop = require('../controllers/adminShopController');
const toolsController = require('../controllers/adminToolsController'); // ✅
const agentController = require('../controllers/agentController');
const investigatorController = require('../controllers/investigatorController');

// 2. استيراد الحماية
const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware'); // تأكد أن لديك هذا الملف أو احذف السطر إذا لم تستخدمه
const requireRole = require('../middleware/roleMiddleware');

// 3. تطبيق الحماية الشاملة (Auth فقط)
// ملاحظة: router.use(auth) تكفي للتحقق من التوكن للجميع
router.use(auth);

// ==========================================
// 🕵️‍♂️ صلاحيات المحقق (Investigator) - Grade 3+
// ==========================================
router.post('/investigator/spectator', requireRole(1), investigatorController.toggleSpectator);
router.post('/investigator/report', requireRole(3), investigatorController.submitReport);
router.get('/investigator/spy', requireRole(3), toolsController.getMultiAccounts); 

// ==========================================
// 💼 صلاحيات الوكيل (Agent) - Grade 2+
// ==========================================
router.post('/agent/transfer', requireRole(2), agentController.transferGP);
router.get('/agent/logs', requireRole(2), agentController.getMySalesLog);

// ==========================================
// 👮‍♂️ صلاحيات المشرف (GM) - Grade 5+
// ==========================================
router.post('/gm/kick', requireRole(5), toolsController.kickPlayer);
router.post('/gm/send-memo', requireRole(5), toolsController.sendMemo);
router.post('/ban', requireRole(5), adminController.banPlayer);
router.get('/unban-requests', requireRole(5), adminController.getUnbanRequests);
router.post('/approve-unban', requireRole(5), adminController.approveUnban);
router.get('/inventory/:userNo', requireRole(5), adminInventory.getPlayerInventory);

// ==========================================
// 👑 صلاحيات المدير العام (Admin) - Grade 10
// ==========================================
// إدارة السيرفر والأدوات الحساسة
router.post('/admin/set-gm', requireRole(10), toolsController.changeGMLevel);
router.post('/tools/rename', requireRole(10), toolsController.changePlayerName);
router.post('/tools/ban-ip', requireRole(10), toolsController.banIP);
router.post('/tools/announce', requireRole(10), toolsController.addAnnouncement);
router.delete('/tools/announce', requireRole(10), toolsController.clearAnnouncements);
router.get('/tools/server-config', requireRole(10), toolsController.getServerConfig);
router.post('/tools/server-event', requireRole(10), toolsController.updateServerEvents);
router.get('/tools/economy-logs', requireRole(10), toolsController.getEconomyLogs);
router.post('/tools/update-stats', requireRole(10), toolsController.updatePlayerStats);

// المتجر
router.get('/shop/search', requireRole(10), adminShop.searchItems);
router.get('/shop/list', requireRole(10), adminShop.getShopList);
router.post('/shop/add', requireRole(10), adminShop.addItemToShop);
router.delete('/shop/remove/:shopId', requireRole(10), adminShop.removeFromShop);

// الكوزمتك
router.post('/cosmetics/add', requireRole(10), adminCosmetic.addCosmetic);
router.put('/cosmetics/toggle', requireRole(10), adminCosmetic.toggleStatus);
router.delete('/cosmetics/delete/:cosmeticId', requireRole(10), adminCosmetic.deleteCosmetic);

// الحقيبة
router.post('/inventory/delete', requireRole(10), adminInventory.deleteItem);
router.post('/inventory/extend', requireRole(10), adminInventory.extendItem);
router.post('/inventory/give', requireRole(10), adminInventory.giveItem);

// الاقتصاد
if (adminController.getServerEconomy) {
    router.get('/economy', requireRole(10), adminController.getServerEconomy);
}

module.exports = router;