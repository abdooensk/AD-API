const { poolPromise, sql } = require('../config/db');

// 1. معلومات الصرافة (للعرض في الواجهة الأمامية)
exports.getExchangeInfo = async (req, res) => {
    const userNo = req.user.userNo;
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('uid', userNo).query(`
            SELECT 
                (SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'Exchange_Rate') AS Rate,
                (SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'Exchange_Tax_Percent') AS Tax,
                (SELECT GameMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid) AS MyRegularMoney,
                (SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid) AS MyGP,
                (SELECT LoyaltyPoints FROM AuthDB.dbo.T_Account WHERE UserNo = @uid) AS MyPoints
        `);
        // ... (نفس المنطق السابق)
        res.json({ status: 'success', data: result.recordset[0] });
    } catch (err) { res.status(500).json({ message: 'خطأ في جلب البيانات' }); }
};

// 2. دالة الصرافة (تحويل العملة العادية إلى كاش)
// 👈 قمنا بتغيير الاسم هنا ليتطابق مع routes/walletRoutes.js
exports.exchangeCurrency = async (req, res) => {
    const { amount } = req.body; // Joi تأكد مسبقاً أنه رقم موجب وصحيح
    const userNo = req.user.userNo;

    // بما أن Joi قام بالفحص، لا نحتاج لفحص amount هنا مرة أخرى
    
    try {
        const pool = await poolPromise;
        
        // جلب الإعدادات
        const settings = await pool.request().query("SELECT ConfigKey, ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey IN ('Exchange_Rate', 'Exchange_Tax_Percent')");
        const config = {};
        settings.recordset.forEach(r => config[r.ConfigKey] = parseInt(r.ConfigValue));
        
        const rate = config['Exchange_Rate'] || 10000;
        const taxPercent = config['Exchange_Tax_Percent'] || 10;
        
        const gpToReceive = Math.floor(amount / rate);
        if (gpToReceive < 1) return res.status(400).json({ message: `المبلغ قليل جداً` });
        
        const taxPoints = Math.ceil(gpToReceive * (taxPercent / 100));

        // التحقق من الرصيد
        const userCheck = await pool.request().input('uid', userNo).query("SELECT GameMoney, (SELECT LoyaltyPoints FROM AuthDB.dbo.T_Account WHERE UserNo = @uid) as LoyaltyPoints FROM GameDB.dbo.T_User WHERE UserNo = @uid");
        const user = userCheck.recordset[0];

        if (user.GameMoney < amount) return res.status(400).json({ message: 'الرصيد العادي غير كافٍ' });
        if (user.LoyaltyPoints < taxPoints) return res.status(400).json({ message: `نقاط ولاء غير كافية للضريبة (${taxPoints})` });

        // تنفيذ العملية
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const req = new sql.Request(transaction);
            // خصم المال وإضافة الكاش
            await req.query(`UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney - ${amount}, CashMoney = CashMoney + ${gpToReceive} WHERE UserNo = ${userNo}`);
            // خصم الضريبة
            await req.query(`UPDATE AuthDB.dbo.T_Account SET LoyaltyPoints = LoyaltyPoints - ${taxPoints} WHERE UserNo = ${userNo}`);
            // تسجيل
            await req.query(`INSERT INTO AdrenalineWeb.dbo.Web_ExchangeLog VALUES (${userNo}, ${amount}, ${gpToReceive}, ${taxPoints}, GETDATE())`);
            
            await transaction.commit();
            res.json({ status: 'success', message: `تم التحويل! حصلت على ${gpToReceive} Cash.` });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        res.status(500).json({ message: 'فشل عملية الصرافة' });
    }
};

// 3. دالة التحويل بين اللاعبين (التي كانت مفقودة وتسبب الخطأ) 🆕
exports.transferMoney = async (req, res) => {
    const { amount, targetUser } = req.body; // targetUser هو اسم اللاعب المستلم
    const senderId = req.user.userNo;

    if (amount <= 0) return res.status(400).json({ message: "مبلغ غير صحيح" });

    try {
        const pool = await poolPromise;

        // التحقق من أن اللاعب المستلم موجود وأنه ليس أنت
        const targetCheck = await pool.request()
            .input('tUser', targetUser)
            .query("SELECT UserNo FROM GameDB.dbo.T_User WHERE ID = @tUser");
            
        if (targetCheck.recordset.length === 0) return res.status(404).json({ message: "اللاعب المستلم غير موجود" });
        
        const receiverId = targetCheck.recordset[0].UserNo;
        if (receiverId === senderId) return res.status(400).json({ message: "لا يمكنك التحويل لنفسك" });

        // التحقق من رصيد المرسل
        const senderCheck = await pool.request().input('uid', senderId).query("SELECT CashMoney FROM GameDB.dbo.T_User WHERE UserNo = @uid");
        if (senderCheck.recordset[0].CashMoney < amount) {
            return res.status(400).json({ message: "رصيدك غير كافٍ" });
        }

        // بدء التحويل الآمن
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const trReq = new sql.Request(transaction);
            
            // خصم من المرسل
            await trReq.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney - ${amount} WHERE UserNo = ${senderId}`);
            
            // إضافة للمستلم
            await trReq.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney + ${amount} WHERE UserNo = ${receiverId}`);
            
            // تسجيل العملية (جدول جديد يفضل إنشاؤه Web_TransferLog)
            // await trReq.query(...) 

            await transaction.commit();
            res.json({ status: 'success', message: `تم تحويل ${amount} كاش إلى ${targetUser} بنجاح` });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        res.status(500).json({ message: "حدث خطأ أثناء التحويل" });
    }
};