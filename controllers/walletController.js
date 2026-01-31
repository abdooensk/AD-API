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
    const { amount } = req.body;
    const userNo = req.user.userNo;

    // تحقق سريع من صحة الرقم
    if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({ message: 'المبلغ غير صحيح' });
    }

    try {
        const pool = await poolPromise;
        
        // جلب الإعدادات (قراءة فقط، لا تحتاج input)
        const settings = await pool.request().query("SELECT ConfigKey, ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey IN ('Exchange_Rate', 'Exchange_Tax_Percent')");
        const config = {};
        settings.recordset.forEach(r => config[r.ConfigKey] = parseInt(r.ConfigValue));
        
        const rate = config['Exchange_Rate'] || 10000;
        const taxPercent = config['Exchange_Tax_Percent'] || 10;
        
        const gpToReceive = Math.floor(amount / rate);
        if (gpToReceive < 1) return res.status(400).json({ message: `المبلغ قليل جداً` });
        
        const taxPoints = Math.ceil(gpToReceive * (taxPercent / 100));

        // التحقق من الرصيد
        const userCheck = await pool.request()
            .input('uid', userNo) // 👈 استخدام input
            .query("SELECT GameMoney, (SELECT LoyaltyPoints FROM AuthDB.dbo.T_Account WHERE UserNo = @uid) as LoyaltyPoints FROM GameDB.dbo.T_User WHERE UserNo = @uid");
        
        const user = userCheck.recordset[0];
        if (user.GameMoney < amount) return res.status(400).json({ message: 'الرصيد العادي غير كافٍ' });
        if (user.LoyaltyPoints < taxPoints) return res.status(400).json({ message: `نقاط ولاء غير كافية للضريبة` });

        // تنفيذ العملية
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const req = new sql.Request(transaction);
            
            // تعريف المتغيرات مرة واحدة للطلب
            req.input('amt', sql.Int, amount);
            req.input('gp', sql.Int, gpToReceive);
            req.input('tax', sql.Int, taxPoints);
            req.input('uid', sql.Int, userNo);

            // خصم المال وإضافة الكاش (باستخدام @parameters)
            await req.query(`
                UPDATE GameDB.dbo.T_User 
                SET GameMoney = GameMoney - @amt, 
                    CashMoney = CashMoney + @gp 
                WHERE UserNo = @uid
            `);

            // خصم الضريبة
            await req.query(`UPDATE AuthDB.dbo.T_Account SET LoyaltyPoints = LoyaltyPoints - @tax WHERE UserNo = @uid`);

            // تسجيل
            await req.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_ExchangeLog (UserNo, Amount, GPReceived, TaxPaid, Date)
                VALUES (@uid, @amt, @gp, @tax, GETDATE())
            `);
            
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
    const { amount, targetUser } = req.body;
    const senderId = req.user.userNo;

    // التحقق من صحة الرقم (أرقام صحيحة موجبة فقط)
    if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({ message: "مبلغ التحويل غير صحيح" });
    }

    try {
        const pool = await poolPromise;

        // 1. جلب كل البيانات المطلوبة في استعلام واحد سريع (Batch Query)
        // - بيانات المستلم (للتأكد من وجوده)
        // - بيانات المرسل (للرصيد والرتبة GMGrade)
        // - إعدادات الضريبة من الموقع
        const dataReq = await pool.request()
            .input('tUser', sql.VarChar, targetUser) // حماية الاسم
            .input('uid', sql.Int, senderId)
            .query(`
                -- أ. البحث عن المستلم
                SELECT UserNo, GMGrade FROM GameDB.dbo.T_User WHERE ID = @tUser;

                -- ب. بيانات المرسل (الرصيد والرتبة)
                SELECT CashMoney, GMGrade FROM GameDB.dbo.T_User WHERE UserNo = @uid;

                -- ج. نسبة الضريبة
                SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'Transfer_Tax_Percent';
            `);

        const receiverRecord = dataReq.recordsets[0][0]; // نتيجة الاستعلام الأول
        const senderRecord = dataReq.recordsets[1][0];   // نتيجة الاستعلام الثاني
        const taxSetting = dataReq.recordsets[2][0];     // نتيجة الاستعلام الثالث

        // التحقق من البيانات
        if (!receiverRecord) return res.status(404).json({ message: "اللاعب المستلم غير موجود" });
        if (receiverRecord.UserNo === senderId) return res.status(400).json({ message: "لا يمكنك التحويل لنفسك" });
        if (!senderRecord) return res.status(404).json({ message: "حسابك غير موجود!" });

        const currentBalance = senderRecord.CashMoney;
        
        // التحقق من الرصيد مبدئياً
        if (currentBalance < amount) {
            return res.status(400).json({ message: "رصيدك غير كافٍ لإتمام العملية" });
        }

        // 2. حساب الضريبة
        let taxPercent = 0;
        let taxAmount = 0;

        // تطبيق الضريبة فقط إذا كان المرسل لاعباً عادياً (GMGrade = 0)
        // الوكلاء (1) والأدمن (2+) معفيون من الضريبة
        if (senderRecord.GMGrade === 0) {
            taxPercent = taxSetting ? parseInt(taxSetting.ConfigValue) : 0;
            if (taxPercent > 0) {
                taxAmount = Math.floor(amount * (taxPercent / 100));
            }
        }

        const amountToReceive = amount - taxAmount; // المبلغ الصافي الذي سيصل للمستلم

        // 3. تنفيذ التحويل (Transaction)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const trReq = new sql.Request(transaction);
            
            // تعريف المدخلات الآمنة
            trReq.input('amt', sql.Int, amount);         // المبلغ الكامل الذي سيخصم من المرسل
            trReq.input('netAmt', sql.Int, amountToReceive); // المبلغ الصافي للمستلم
            trReq.input('sender', sql.Int, senderId);
            trReq.input('receiver', sql.Int, receiverRecord.UserNo);
            trReq.input('tax', sql.Int, taxAmount);

            // أ. خصم المبلغ بالكامل من المرسل (مع شرط الأمان الذري)
            const deduct = await trReq.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney - @amt 
                WHERE UserNo = @sender AND CashMoney >= @amt
            `);

            if (deduct.rowsAffected[0] === 0) {
                throw new Error("رصيد غير كافٍ أو حدث خطأ أثناء الخصم");
            }

            // ب. إضافة المبلغ (ناقص الضريبة) للمستلم
            await trReq.query(`
                UPDATE GameDB.dbo.T_User 
                SET CashMoney = CashMoney + @netAmt 
                WHERE UserNo = @receiver
            `);

            // ج. (اختياري) تسجيل العملية في سجل التحويلات
            // يفضل إنشاء جدول Web_TransferLog لتتبع الضرائب المحروقة
            /*
            await trReq.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_TransferLog (SenderID, ReceiverID, Amount, Tax, Date)
                VALUES (@sender, @receiver, @amt, @tax, GETDATE())
            `);
            */

            await transaction.commit();

            // رسالة النجاح توضح التفاصيل
            if (taxAmount > 0) {
                res.json({ 
                    status: 'success', 
                    message: `تم التحويل بنجاح! تم خصم ضريبة ${taxPercent}% (${taxAmount} GP). وصل للمستلم: ${amountToReceive} GP.` 
                });
            } else {
                res.json({ 
                    status: 'success', 
                    message: `تم تحويل ${amount} GP بنجاح (معفى من الضريبة).` 
                });
            }

        } catch (err) {
            await transaction.rollback();
            res.status(400).json({ message: err.message === "رصيد غير كافٍ أو حدث خطأ أثناء الخصم" ? "رصيدك غير كافٍ" : "حدث خطأ أثناء التحويل" });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "خطأ في السيرفر" });
    }
};