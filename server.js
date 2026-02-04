const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const hpp = require('hpp');
const path = require('path'); // 👈 أضف هذا السطر
require('dotenv').config();

const { poolPromise } = require('./config/db');

// استيراد الروابط
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

// 👇 تم التصحيح: استدعاء الملف في سطر منفصل
const startCronJobs = require('./utils/cronJobs'); 

const app = express(); // 👈 هذا السطر يجب أن يكون نشطاً وليس تعليقاً

// 1. إعدادات CORS
app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(hpp());
app.use(morgan('dev'));

// 2. تفعيل الروابط
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/rank', rankRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/admin/coupons', couponAdminRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/wheel', luckyWheelRoutes);
app.use('/api/cosmetic', cosmeticRoutes);
app.use('/api/paypal', paypalRoutes);
app.use('/api/tickets', require('./routes/ticketRoutes'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));
// 3. فحص السيرفر

app.get('/', (req, res) => {
    res.json({ message: 'Server is running perfectly!' });
});

// تشغيل الـ Cron Jobs
startCronJobs(); 

// 4. تشغيل السيرفر
const PORT = process.env.PORT || 2000;
app.listen(PORT, () => {
    console.log(`\n===================================================`);
    console.log(`✅ SERVER STARTED ON PORT: ${PORT}`);
    console.log(`⏰ Cron Jobs Active`);
    console.log(`===================================================\n`);
});