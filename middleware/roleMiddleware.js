const { poolPromise } = require('../config/db');

const requireRole = (minGrade) => {
    return async (req, res, next) => {
        try {
            // 👇 الخطأ كان هنا: req.user.userId هو "اسم المستخدم" (String)
            // بينما نحن نحتاج "رقم المستخدم" (Integer) للبحث في UserNo
            const userNo = req.user.userNo; 

            if (!userNo) {
                return res.status(401).json({ message: 'بيانات التوكن غير مكتملة' });
            }

            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', userNo) // الآن نرسل الرقم الصحيح
                .query("SELECT GMGrade, Nickname FROM GameDB.dbo.T_User WHERE UserNo = @id");

            if (result.recordset.length === 0) {
                return res.status(403).json({ message: 'حساب غير موجود' });
            }

            const userGrade = result.recordset[0].GMGrade;

            if (userGrade >= minGrade) {
                // نضيف الرتبة والاسم للطلب للاستخدام لاحقاً
                req.user.grade = userGrade;
                req.user.nickname = result.recordset[0].Nickname;
                next();
            } else {
                return res.status(403).json({ message: `صلاحيات غير كافية. مطلوب مستوى ${minGrade}` });
            }

        } catch (err) {
            console.error('Role Middleware Error:', err); // طباعة الخطأ في الكونسول لمعرفته
            res.status(500).json({ message: 'خطأ في التحقق من الصلاحيات' });
        }
    };
};

module.exports = requireRole;