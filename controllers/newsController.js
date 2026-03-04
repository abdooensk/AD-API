const { poolPromise, sql } = require('../config/db');

// 1. عرض جميع الأخبار (تم إضافة التواريخ في الاستعلام)
exports.getAllNews = async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // 👈 نحدد الأعمدة بدقة لضمان وصولها
        const result = await pool.request().query(`
            SELECT 
                NewsID, 
                Title, 
                Content, 
                Category, 
                ImageUrl, 
                CreatedDate, 
                LastUpdate 
            FROM AdrenalineWeb.dbo.Web_News 
            ORDER BY CreatedDate DESC
        `);

        res.json({ 
            status: 'success', 
            news: result.recordset 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل جلب الأخبار' });
    }
};

// 2. تفاصيل خبر واحد (اختياري، إذا كنت تستخدمه)
exports.getNewsDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', id)
            .query(`
                SELECT NewsID, Title, Content, Category, ImageUrl, CreatedDate, LastUpdate 
                FROM AdrenalineWeb.dbo.Web_News 
                WHERE NewsID = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'الخبر غير موجود' });
        }

        res.json({ status: 'success', news: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ message: 'فشل جلب التفاصيل' });
    }
};

// 3. إضافة خبر جديد (تم إضافة GETDATE() لضمان تسجيل الوقت)
exports.createNews = async (req, res) => {
    // نستخدم req.body لأن multer قام بمعالجتها، والصورة في req.file
    const { title, content, category } = req.body;
    
    // معالجة مسار الصورة
    const imageUrl = req.file ? `/uploads/news/${req.file.filename}` : null;

    if (!title || !content || !category) {
        return res.status(400).json({ message: 'العنوان والمحتوى والتصنيف مطلوبون' });
    }

    try {
        const pool = await poolPromise;
        
        // 👈 لاحظ إضافة CreatedDate و LastUpdate مع القيمة GETDATE()
        await pool.request()
            .input('title', title)
            .input('content', content)
            .input('cat', category)
            .input('img', imageUrl)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_News 
                (Title, Content, Category, ImageUrl, CreatedDate, LastUpdate)
                VALUES 
                (@title, @content, @cat, @img, GETDATE(), GETDATE())
            `);

        res.json({ status: 'success', message: 'تم نشر الخبر بنجاح' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل إضافة الخبر', error: err.message });
    }
};

// 4. حذف خبر
exports.deleteNews = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', id)
            .query("DELETE FROM AdrenalineWeb.dbo.Web_News WHERE NewsID = @id");

        res.json({ status: 'success', message: 'تم حذف الخبر' });
    } catch (err) {
        res.status(500).json({ message: 'فشل الحذف' });
    }
};

// 5. تعديل خبر (تم إضافة تحديث LastUpdate)
exports.updateNews = async (req, res) => {
    const { id } = req.params;
    const { title, content, category } = req.body;
    const image = req.file ? `/uploads/news/${req.file.filename}` : undefined;

    try {
        const pool = await poolPromise;
        
        let query = "UPDATE AdrenalineWeb.dbo.Web_News SET LastUpdate = GETDATE()"; // 👈 نحدث التاريخ دائماً
        
        if (title) query += ", Title = @title";
        if (content) query += ", Content = @content";
        if (category) query += ", Category = @category";
        if (image) query += ", ImageUrl = @image";
        
        query += " WHERE NewsID = @id";

        const reqDb = pool.request().input('id', id);
        
        if (title) reqDb.input('title', title);
        if (content) reqDb.input('content', content);
        if (category) reqDb.input('category', category);
        if (image) reqDb.input('image', image);

        await reqDb.query(query);

        res.json({ status: 'success', message: 'تم تحديث الخبر' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل التحديث' });
    }
};
exports.getNewsDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', id)
            .query(`
                SELECT NewsID, Title, Content, Category, Author, ImageUrl, CreatedDate, LastUpdate 
                FROM AdrenalineWeb.dbo.Web_News 
                WHERE NewsID = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'الخبر غير موجود' });
        }

        res.json({ status: 'success', news: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ message: 'فشل جلب تفاصيل الخبر', error: err.message });
    }
};