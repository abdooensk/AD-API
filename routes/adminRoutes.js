const express = require('express');
const router = express.Router();
// 1. استيراد المتحكمات (تأكد من وجود الملفين في مجلد controllers)
const adminController = require('../controllers/adminController'); 
const adminCosmetic = require('../controllers/adminCosmeticController'); // 👈 هذا كان مفقوداً
const adminInventory = require('../controllers/adminInventoryController'); // استدعاء الملف الجديد
const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware');
const adminShop = require('../controllers/adminShopController'); // 👈 الملف الجديد
// جميع الروابط تتطلب: توكن + صلاحية أدمن
// نستخدم router.use لتطبيق الحماية على كل الروابط أدناه بدلاً من تكرارها
router.use(auth, admin);

// روابط إدارة اللاعبين (موجودة في adminController)
router.post('/ban', adminController.banPlayer);
router.get('/unban-requests', adminController.getUnbanRequests);
router.post('/approve-unban', adminController.approveUnban);

// روابط إدارة المتجر (موجودة في adminCosmeticController)
router.post('/cosmetics/add', adminCosmetic.addCosmetic); // 👈 الآن سيتم التعرف عليه
router.put('/cosmetics/toggle', adminCosmetic.toggleStatus);
router.delete('/cosmetics/delete/:cosmeticId', adminCosmetic.deleteCosmetic);

router.get('/inventory/:userNo', adminInventory.getPlayerInventory); // عرض حقيبة لاعب
router.post('/inventory/delete', adminInventory.deleteItem);         // حذف عنصر
router.post('/inventory/extend', adminInventory.extendItem);         // تمديد مدة
router.post('/inventory/give', adminInventory.giveItem);             // إعطاء عنصر
if (adminController.getServerEconomy) {
    router.get('/economy', adminController.getServerEconomy);
} else {
    console.warn("Warning: getServerEconomy is not defined in adminController");
}
// --- 🛍️ إدارة المتجر الذكية (جديد) ---
router.get('/shop/search', adminShop.searchItems);      // بحث بالاسم
router.get('/shop/list', adminShop.getShopList);        // عرض المتجر الحالي
router.post('/shop/add', adminShop.addItemToShop);      // إضافة للمتجر
router.delete('/shop/remove/:shopId', adminShop.removeFromShop); // حذف
module.exports = router;