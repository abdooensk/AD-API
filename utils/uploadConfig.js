const multer = require('multer');
const path = require('path');
const fs = require('fs');

// دالة مساعدة لإنشاء المجلدات إذا لم تكن موجودة
const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

// --- 1. إعدادات التذاكر (Tickets) ---
const ticketDir = 'public/uploads/tickets';
ensureDir(ticketDir);

const ticketStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ticketDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'ticket-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// --- 2. إعدادات القسائم (Coupons) ---
const couponDir = 'public/uploads/coupons';
ensureDir(couponDir);

const couponStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, couponDir);
    },
    filename: (req, file, cb) => {
        // تسمية مميزة لصور القسائم
        const uniqueSuffix = Date.now();
        cb(null, 'coupon-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// --- فلتر عام للصور ---
const imageFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('يسمح برفع الصور فقط!'), false);
    }
};

// --- التصدير ---
// 1. أداة رفع التذاكر (استخدمها في ticketRoutes)
exports.uploadTicket = multer({ 
    storage: ticketStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 ميجا للتذاكر
    fileFilter: imageFilter
});

// 2. أداة رفع القسائم (استخدمها في couponAdminRoutes)
exports.uploadCoupon = multer({ 
    storage: couponStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 ميجا للقسائم (لأنها ستظهر في المتجر)
    fileFilter: imageFilter
});