const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const hpp = require('hpp');
// const xss = require('xss-clean'); // ❌ هذه المكتبة هي سبب المشكلة، تم حذفها
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

const app = express();

// 1. إعدادات CORS (مفتوحة للتطوير)
app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json({ limit: '10kb' }));

// ❌ تم إزالة app.use(xss()) لأنه يسبب الانهيار
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
app.use('/api/coupon', couponRoutes);
app.use('/api/admin/coupon', couponAdminRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/wheel', luckyWheelRoutes);
app.use('/api/cosmetic', cosmeticRoutes);
app.use('/api/paypal', paypalRoutes);

// 3. فحص السيرفر
app.get('/', (req, res) => {
    res.json({ message: 'Server is running perfectly without XSS-Clean!' });
});

// 4. تشغيل السيرفر
const PORT = process.env.PORT || 2000;
app.listen(PORT, () => {
    console.log(`\n===================================================`);
    console.log(`✅ SERVER STARTED ON PORT: ${PORT}`);
    console.log(`🚫 Removed incompatible library: xss-clean`);
    console.log(`===================================================\n`);
});