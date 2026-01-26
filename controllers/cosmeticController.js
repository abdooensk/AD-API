const { poolPromise, sql } = require('../config/db');

// 1. عرض المتجر (كما هو)
exports.getShop = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query("SELECT * FROM AdrenalineWeb.dbo.Web_CosmeticShop WHERE IsActive = 1");
        res.json({ status: 'success', items: result.recordset });
    } catch (err) { res.status(500).json({ message: 'خطأ' }); }
};

// 2. الشراء (نفس الكود السابق، لا يحتاج تغيير)
exports.buyCosmetic = async (req, res) => {
    const { cosmeticId } = req.body;
    const userNo = req.user.userNo;
    try {
        const pool = await poolPromise;
        const itemRes = await pool.request().input('id', cosmeticId).query("SELECT * FROM AdrenalineWeb.dbo.Web_CosmeticShop WHERE CosmeticID = @id");
        const item = itemRes.recordset[0];
        if (!item) return res.status(404).json({ message: 'العنصر غير موجود' });

        const userRes = await pool.request().input('uid', userNo).query("SELECT GameMoney, CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");
        const user = userRes.recordset[0];

        let currencyCol = '', cost = 0;
        if (item.PriceGP > 0) { currencyCol = 'CashMoney'; cost = item.PriceGP; if (user.CashMoney < cost) return res.status(400).json({ message: 'رصيد GP غير كافٍ' }); }
        else { currencyCol = 'GameMoney'; cost = item.PriceRegular; if (user.GameMoney < cost) return res.status(400).json({ message: 'رصيد عادي غير كافٍ' }); }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const reqIdx = new sql.Request(transaction);
            await reqIdx.query(`UPDATE GameDB.dbo.T_User SET ${currencyCol} = ${currencyCol} - ${cost} WHERE UserNo = ${userNo}`);
            const expireDate = item.DurationDays > 0 ? `DATEADD(DAY, ${item.DurationDays}, GETDATE())` : 'NULL';
            await reqIdx.query(`INSERT INTO AdrenalineWeb.dbo.Web_UserCosmetics (UserNo, CosmeticID, ExpireDate) VALUES (${userNo}, ${cosmeticId}, ${expireDate})`);
            await transaction.commit();
            res.json({ status: 'success', message: `تم شراء ${item.Name} بنجاح!` });
        } catch (err) { await transaction.rollback(); throw err; }
    } catch (err) { res.status(500).json({ message: 'فشل الشراء' }); }
};

// 3. التجهيز (Equip) - التعديل الجوهري هنا 🔥
exports.equipCosmetic = async (req, res) => {
    const { rowId } = req.body;
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // أ. جلب بيانات العنصر المراد تجهيزه
        const check = await pool.request()
            .input('rid', rowId)
            .input('uid', userNo)
            .query(`
                SELECT UC.*, S.Type, S.Value 
                FROM AdrenalineWeb.dbo.Web_UserCosmetics UC
                JOIN AdrenalineWeb.dbo.Web_CosmeticShop S ON UC.CosmeticID = S.CosmeticID
                WHERE UC.RowID = @rid AND UC.UserNo = @uid
                AND (UC.ExpireDate IS NULL OR UC.ExpireDate > GETDATE())
            `);
        
        const newItem = check.recordset[0];
        if (!newItem) return res.status(404).json({ message: 'العنصر غير موجود أو منتهي' });

        // ب. جلب الاسم الأصلي والحالي
        const userCheck = await pool.request().input('uid', userNo).query("SELECT Nickname, OriginalNickName FROM GameDB.dbo.T_User WHERE UserNo = @uid");
        const userData = userCheck.recordset[0];
        
        // حفظ الاسم الأصلي لأول مرة إن لم يكن محفوظاً
        let originalName = userData.OriginalNickName;
        if (!originalName) {
            originalName = userData.Nickname;
            // إزالة أي أكواد ألوان أو ألقاب قديمة من الاسم الحالي (تنظيف مبدئي)
            // هذه خطوة احترازية في حال كان الاسم ملوثاً مسبقاً
            if (originalName.includes(']')) {
                const parts = originalName.split(']');
                originalName = parts[parts.length - 1]; // نأخذ آخر جزء
            }
            await pool.request().input('uid', userNo).input('orig', originalName).query("UPDATE GameDB.dbo.T_User SET OriginalNickName = @orig WHERE UserNo = @uid");
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqIdx = new sql.Request(transaction);

            // 1. إلغاء تجهيز أي "مؤثر اسم" آخر (سواء لون أو لقب)
            // ملاحظة: إذا كنت تسمح بلقب + لون معاً، يجب تعديل هذا الشرط. 
            // حالياً الكود يفترض أنك تختار إما لوناً أو لقباً لأن كلاهما يعدل الـ Nickname
            await reqIdx.query(`
                UPDATE UC SET IsEquipped = 0 
                FROM AdrenalineWeb.dbo.Web_UserCosmetics UC 
                JOIN AdrenalineWeb.dbo.Web_CosmeticShop S ON UC.CosmeticID = S.CosmeticID
                WHERE UC.UserNo = ${userNo} AND (S.Type = 'COLOR' OR S.Type = 'TITLE')
            `);

            // 2. تجهيز العنصر الجديد في الويب
            await reqIdx.query(`UPDATE AdrenalineWeb.dbo.Web_UserCosmetics SET IsEquipped = 1 WHERE RowID = ${rowId}`);

            // 3. بناء الاسم الجديد
            let newNickname = originalName;

            if (newItem.Type === 'COLOR') {
                // الصيغة: [#cCODE]Name
                // نفترض أن newItem.Value تحتوي على كود اللون فقط مثل FF0000
                newNickname = `[#c${newItem.Value}]${originalName}`;
            
            } else if (newItem.Type === 'TITLE') {
                // الصيغة: [Title]Name
                // نفترض أن newItem.Value تحتوي على اللقب كاملاً مثل [GM]
                newNickname = `${newItem.Value}${originalName}`;
            }

            // التحقق من الطول (قواعد البيانات غالباً 30 حرف)
            if (newNickname.length > 30) {
                // قص الاسم الأصلي ليتناسب مع الطول (اختياري)
                // newNickname = newNickname.substring(0, 30);
                throw new Error(`الاسم مع التنسيق طويل جداً (${newNickname.length} حرف). الحد الأقصى 30.`);
            }

            // 4. الحفظ في اللعبة
            await reqIdx.query(`UPDATE GameDB.dbo.T_User SET Nickname = N'${newNickname}' WHERE UserNo = ${userNo}`);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم تفعيل التنسيق بنجاح!' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) { res.status(500).json({ message: 'فشل التفعيل', error: err.message }); }
};

// 4. إزالة التجهيز (Unequip) - العودة للاسم الأصلي
exports.unequipCosmetic = async (req, res) => {
    const { rowId } = req.body;
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;
        const check = await pool.request().input('rid', rowId).input('uid', userNo).query(`SELECT * FROM AdrenalineWeb.dbo.Web_UserCosmetics WHERE RowID = @rid AND UserNo = @uid`);
        if (check.recordset.length === 0) return res.status(404).json({ message: 'العنصر غير موجود' });

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqIdx = new sql.Request(transaction);

            // 1. تحديث الويب
            await reqIdx.query(`UPDATE AdrenalineWeb.dbo.Web_UserCosmetics SET IsEquipped = 0 WHERE RowID = ${rowId}`);

            // 2. استعادة الاسم الأصلي
            // نأخذ OriginalNickName ونضعه في Nickname
            await reqIdx.query(`
                UPDATE GameDB.dbo.T_User 
                SET Nickname = ISNULL(OriginalNickName, Nickname) 
                WHERE UserNo = ${userNo}
            `);

            await transaction.commit();
            res.json({ status: 'success', message: 'تم إزالة التنسيق واستعادة الاسم الأصلي' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) { res.status(500).json({ message: 'خطأ' }); }
};

// 5. عرض أغراضي
exports.getMyCosmetics = async (req, res) => {
    const userNo = req.user.userNo;
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('uid', userNo).query(`
            SELECT UC.RowID, UC.ExpireDate, UC.IsEquipped, S.Name, S.Type, S.Value 
            FROM AdrenalineWeb.dbo.Web_UserCosmetics UC
            JOIN AdrenalineWeb.dbo.Web_CosmeticShop S ON UC.CosmeticID = S.CosmeticID
            WHERE UC.UserNo = @uid AND (UC.ExpireDate IS NULL OR UC.ExpireDate > GETDATE())
        `);
        res.json({ status: 'success', items: result.recordset });
    } catch (err) { res.status(500).json({ message: 'خطأ' }); }
};