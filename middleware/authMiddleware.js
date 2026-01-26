const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_adrenaline_key_2026';

module.exports = (req, res, next) => {
    // 1. البحث عن التوكن في "ترويسة" الطلب (Header)
    const token = req.header('x-auth-token');

    // 2. إذا لم يرسل التوكن، نرفض الطلب
    if (!token) {
        return res.status(401).json({ message: 'لا يوجد إذن دخول، التوكن مفقود' });
    }

    try {
        // 3. فك تشفير التوكن للتأكد من صحته
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // 4. حفظ بيانات المستخدم في الطلب لنستخدمها لاحقاً
        req.user = decoded;
        
        next(); // اسمح له بالمرور للكود التالي
    } catch (err) {
        res.status(401).json({ message: 'التوكن غير صالح أو منتهي الصلاحية' });
    }
};