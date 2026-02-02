const { poolPromise } = require('../config/db');

const requireRole = (minGrade) => {
    return async (req, res, next) => {
        try {
            const userNo = req.user.userId;

            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', userNo)
                .query("SELECT GMGrade, Nickname FROM GameDB.dbo.T_User WHERE UserNo = @id");

            if (result.recordset.length === 0) {
                return res.status(403).json({ message: 'حساب غير موجود' });
            }

            const userGrade = result.recordset[0].GMGrade;

            if (userGrade >= minGrade) {
                req.user.grade = userGrade;
                req.user.nickname = result.recordset[0].Nickname;
                next();
            } else {
                return res.status(403).json({ message: `صلاحيات غير كافية. مطلوب مستوى ${minGrade}` });
            }

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: 'خطأ في التحقق من الصلاحيات' });
        }
    };
};

module.exports = requireRole;