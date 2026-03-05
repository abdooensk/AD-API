const jwt = require('jsonwebtoken');
const { poolPromise } = require('../config/db'); // 👈 نحتاج الاتصال بالقاعدة
require('dotenv').config();

const auth = async (req, res, next) => {
    const token = req.header('x-auth-token');

    if (!token) {
        return res.status(401).json({ message: 'لا يوجد تصريح (No Token)' });
    }

    try {
        if (!process.env.JWT_SECRET) {
    throw new Error("FATAL ERROR: JWT_SECRET is not defined.");
}
const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // 🆕 التحقق من حالة الجلسة في قاعدة البيانات
        if (decoded.sessionId) {
            const pool = await poolPromise;
            const sessionCheck = await pool.request()
                .input('sid', decoded.sessionId)
                .query("SELECT IsActive FROM AdrenalineWeb.dbo.Web_LoginSessions WHERE SessionID = @sid");

            const session = sessionCheck.recordset[0];

            // إذا لم تكن الجلسة موجودة أو تم تسجيل الخروج منها (IsActive = 0)
            if (!session || !session.IsActive) {
                return res.status(401).json({ message: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً' });
            }

            // (اختياري) تحديث "آخر ظهور" للجلسة
            // await pool.request().input('sid', decoded.sessionId).query("UPDATE AdrenalineWeb.dbo.Web_LoginSessions SET LastActive = GETDATE() WHERE SessionID = @sid");
        }

        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'التوكن غير صالح' });
    }
};

module.exports = auth;