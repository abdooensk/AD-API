const { poolPromise } = require('../config/db');

// 1. عرض كل الأخبار (متاح للجميع)
exports.getAllNews = async (req, res) => {
    try {
        const pool = await poolPromise;
        // نجلب الأخبار مرتبة من الأحدث للأقدم
        const result = await pool.request().query(`
            SELECT NewsID, Title, Content, Category, Author, CreateDate 
            FROM AdrenalineWeb.dbo.Web_News 
            ORDER BY CreateDate DESC
        `);

        res.json({ status: 'success', news: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الأخبار', error: err.message });
    }
};

// 2. إضافة خبر جديد (للأدمن فقط)
exports.createNews = async (req, res) => {
    const { title, content, category } = req.body;
    // نستخدم اسم المستخدم من التوكن كاسم للكاتب
    const author = req.user.userId || 'Admin'; 

    if (!title || !content) {
        return res.status(400).json({ message: 'العنوان والمحتوى مطلوبان' });
    }

    try {
        const pool = await poolPromise;
        
        await pool.request()
            .input('title', title)
            .input('content', content)
            .input('cat', category || 'General')
            .input('auth', author)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_News (Title, Content, Category, Author)
                VALUES (@title, @content, @cat, @auth)
            `);

        res.json({ status: 'success', message: 'تم نشر الخبر بنجاح' });
    } catch (err) {
        res.status(500).json({ message: 'فشل نشر الخبر', error: err.message });
    }
};

// 3. حذف خبر (للأدمن فقط)
exports.deleteNews = async (req, res) => {
    const { id } = req.params; // نأخذ الرقم من الرابط مباشرة

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', id)
            .query('DELETE FROM AdrenalineWeb.dbo.Web_News WHERE NewsID = @id');

        res.json({ status: 'success', message: 'تم حذف الخبر' });
    } catch (err) {
        res.status(500).json({ message: 'فشل حذف الخبر', error: err.message });
    }
};