const multer = require('multer');
const path = require('path');
const fs = require('fs');

// التأكد من وجود المجلد
const uploadDir = 'public/uploads/tickets';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// إعداد مكان الحفظ والتسمية
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // تسمية الملف: ticket_timestamp_random.ext
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'ticket-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// فلتر لرفض الملفات غير الصور (اختياري)
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('يسمح برفع الصور فقط!'), false);
    }
};

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // الحد الأقصى 5 ميجا
    fileFilter: fileFilter
});

module.exports = upload;