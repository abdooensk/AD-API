module.exports = (req, res, next) => {
    // 1. هذا الميدلوير يعمل بعد authMiddleware، لذا نفترض وجود req.user
    // 2. نتحقق هل المستخدم أدمن؟ (isAdmin التي وضعناها في التوكن عند تسجيل الدخول)
    
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ message: 'غير مصرح لك (هذه الميزة للمشرفين فقط)' });
    }

    next(); // اسمح له بالمرور
};