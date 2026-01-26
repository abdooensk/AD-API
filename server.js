const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const hpp = require('hpp');        // 👈 جديد: حماية تلوث البارامترات
const xss = require('xss-clean');  // 👈 جديد: حماية من السكربتات الخبيثة
require('dotenv').config();

const { poolPromise } = require('./config/db');

// --- 1. استيراد الروابط ---
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const shopRoutes = require('./routes/shopRoutes');
const rankRoutes = require('./routes/rankRoutes');
const newsRoutes = require('./routes/newsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const couponRoutes = require('./routes/couponRoutes');
const couponAdminRoutes = require('./routes/couponAdminRoutes');
const loyaltyRoutes = require('./routes/loyaltyRoutes');
const walletRoutes = require('./routes/walletRoutes');
const luckyWheelRoutes = require('./routes/luckyWheelRoutes');
const cosmeticRoutes = require('./routes/cosmeticRoutes');
const paypalRoutes = require('./routes/paypalRoutes');

const app = express();

// --- 2. إعدادات الأمان المتقدمة (Security Middleware) ---

// أ. حماية الرؤوس (HTTP Headers)
app.use(helmet());

// ب. تقييد الوصول (Strict CORS) - السماح فقط للمصادر الموثوقة
const corsOptions = {
    origin: process.env.FRONTEND_URL || '*', // يفضل استبدال * برابط موقعك الحقيقي لاحقاً
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
};
app.use(cors(corsOptions));

// ج. تحديد حجم البيانات (Body Limit) لمنع الانهيار
app.use(express.json({ limit: '10kb' })); // نرفض أي طلب أكبر من 10 كيلوبايت

// د. تنظيف البيانات (Data Sanitization)
app.use(xss()); // يحول <script> إلى نص عادي
app.use(hpp()); // يمنع هجمات ?sort=asc&sort=desc

// هـ. تسجيل الطلبات
app.use(morgan('dev'));

// --- 3. إعداد محددات الطلبات (Rate Limiters) ---
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100,
    message: { message: 'لقد أرسلت طلبات كثيرة جداً، تم حظر IP مؤقتاً.' }
});

const financialLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    max: 5,
    message: { message: 'عملية حساسة! يرجى التمهل بين الطلبات.' }
});

// --- 4. تطبيق المحددات ---
app.use('/api/', generalLimiter); 
app.use('/api/wallet/', financialLimiter); 
app.use('/api/wheel/spin', financialLimiter);
app.use('/api/paypal', financialLimiter); // حماية الشحن أيضاً

// --- 5. تعريف الروابط (Routes) ---
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/rank', rankRoutes);
app.use('/api/news', newsRoutes);

// روابط الأدمن
app.use('/api/admin/coupon', couponAdminRoutes); 
app.use('/api/admin', adminRoutes);

app.use('/api/settings', settingsRoutes);
app.use('/api/coupon', couponRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/wheel', luckyWheelRoutes);
app.use('/api/cosmetic', cosmeticRoutes);
app.use('/api/paypal', paypalRoutes);

// --- 6. رابط الفحص ---
app.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        // نستخدم TOP 1 لتقليل الحمل في الفحص
        const result = await pool.request().query('SELECT TOP 1 * FROM Web_News');
        res.json({
            status: 'success',
            message: '🚀 API is Secure & Online!',
            server_time: new Date(),
            news_sample: result.recordset
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 7. تشغيل السيرفر ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🛡️  Secure Server running on http://localhost:${PORT}`);
});