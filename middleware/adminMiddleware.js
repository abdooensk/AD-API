const { poolPromise } = require('../config/db'); // 👈 نحتاج الاتصال بالقاعدة

module.exports = async (req, res, next) => {
    // 1. التأكد أن المستخدم مسجل دخول أصلاً (تم التحقق في authMiddleware)
    if (!req.user) {
        return res.status(401).json({ message: 'غير مصرح: يجب تسجيل الدخول أولاً' });
    }

    try {
        // 2. الفحص المزدوج (Double Check) من قاعدة البيانات مباشرة
        // لا نعتمد على req.user.isAdmin القادمة من التوكن لأنها قد تكون قديمة
        const pool = await poolPromise;
        
        const result = await pool.request()
            .input('uid', req.user.userNo)
            .query('SELECT GMGrade FROM GameDB.dbo.T_User WHERE UserNo = @uid');
            
        const user = result.recordset[0];

        // 3. التحقق الصارم
        // نفترض أن GMGrade 1 هو GM، و 2 هو Admin، و 3 هو Owner
        // يمكنك تعديل الشرط حسب نظام الرتب في لعبتك (مثلاً >= 1)
        if (!user || user.GMGrade < 1) { 
            return res.status(403).json({ 
                message: 'تم رفض الوصول: صلاحياتك كأدمن غير صالحة أو تم سحبها.',
                reason: 'REVOKED_ACCESS'
            });
        }

        // إذا نجح الفحص، نحدث بيانات المستخدم في الطلب ونسمح له بالمرور
        req.user.gmGrade = user.GMGrade; 
        
        next(); 

    } catch (err) {
        console.error('Admin Check Error:', err);
        // في حال حدوث خطأ في قاعدة البيانات، نمنع الدخول احتياطاً
        res.status(500).json({ message: 'حدث خطأ أثناء التحقق من الصلاحيات' });
    }
};