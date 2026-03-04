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
    // قبول فقط الملفات التي تبدأ بـ image/
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        // نمرر خطأ مخصص ليتم التقاطه في الراوت
        cb(new Error('يسمح برفع الصور فقط (jpg, png, jpeg)!'), false);
    }
};

// --- التصدير ---

// 1. أداة رفع التذاكر (تم رفع الحد إلى 10 ميجا لحل المشكلة)
exports.uploadTicket = multer({ 
    storage: ticketStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 👈 10 ميجابايت
    fileFilter: imageFilter
});

// 2. أداة رفع القسائم
exports.uploadCoupon = multer({ 
    storage: couponStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 ميجابايت (كافية لأيقونات المتجر)
    fileFilter: imageFilter
});
// ... (بعد إعدادات التذاكر والكوبونات)

// --- 3. إعدادات الأخبار (News) ---
const newsDir = 'public/uploads/news';
ensureDir(newsDir);

const newsStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, newsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now();
        cb(null, 'news-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// ... (في نهاية الملف عند التصدير exports)

// 3. أداة رفع الأخبار
exports.uploadNews = multer({ 
    storage: newsStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 ميجابايت كحد أقصى
    fileFilter: imageFilter
});