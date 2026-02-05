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
router.get('/users/search', requireRole(5), toolsController.searchUsers);
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
// داخل قسم صلاحيات الأدمن (Require Role 10)
router.get('/event/config', requireRole(10), toolsController.getEventConfig);
router.post('/event/config', requireRole(10), toolsController.updateEventConfig);
// إدارة حظر الآي بي (IP Ban Management)
router.get('/tools/ban-ip/list', requireRole(10), toolsController.getBannedIPs);      // عرض القائمة
router.delete('/tools/ban-ip/:id', requireRole(10), toolsController.deleteBannedIP);  // فك الحظر
// 2. جوائز الحضور (Attendance)
router.get('/event/attendance', requireRole(10), toolsController.getAttendanceRewards);
router.post('/event/attendance', requireRole(10), toolsController.setAttendanceReward);
router.delete('/event/attendance/:dayCount', requireRole(10), toolsController.deleteAttendanceReward);
router.post('/tools/charge', requireRole(10), toolsController.chargePlayerBalance);
// تغيير كلمة مرور المستخدم
router.post('/tools/change-password', requireRole(10), toolsController.changeUserPassword);
router.get('/tools/announce/list', requireRole(10), toolsController.getAnnouncements);      // عرض القائمة
router.put('/tools/announce/:id', requireRole(10), toolsController.updateAnnouncement);     // تعديل
router.delete('/tools/announce/:id', requireRole(10), toolsController.deleteAnnouncement);  // حذف واحد
// تغيير البريد الإلكتروني للمستخدم
router.post('/tools/change-email', requireRole(10), toolsController.changeUserEmail);
router.post('/gm/unban', requireRole(5), toolsController.unbanPlayer);
router.get('/users/details/:userNo', requireRole(5), toolsController.getUserDetails);
router.get('/users/search', requireRole(5), toolsController.searchUsers);
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
router.delete('/shop/remove/:shopId', requireRole(10), adminShop.removeShopItem);
// الكوزمتك
router.post('/cosmetics/add', requireRole(10), adminCosmetic.addCosmetic);
router.put('/cosmetics/toggle', requireRole(10), adminCosmetic.toggleStatus);
router.delete('/cosmetics/delete/:cosmeticId', requireRole(10), adminCosmetic.deleteCosmetic);

// الحقيبة
router.post('/inventory/delete', requireRole(10), adminInventory.deleteItem);
router.post('/inventory/extend', requireRole(10), adminInventory.extendItem);
router.post('/inventory/give', requireRole(10), adminInventory.giveItem);
router.put('/shop/update', requireRole(10), adminShop.updateShopItem);
// الاقتصاد
if (adminController.getServerEconomy) {
    router.get('/economy', requireRole(10), adminController.getServerEconomy);
}

module.exports = router;