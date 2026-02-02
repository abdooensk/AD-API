const { poolPromise, sql } = require('../config/db');

// تحويل GP من الوكيل إلى اللاعب (بيع نقاط)
exports.transferGP = async (req, res) => {
    const { targetNickname, amount } = req.body;
    const agentUserNo = req.user.userId;

    if (amount <= 0) return res.status(400).json({ message: 'المبلغ غير صالح' });

    try {
        const pool = await poolPromise;
        
        // 1. التأكد من وجود اللاعب المستلم
        const targetCheck = await pool.request()
            .input('nick', targetNickname)
            .query("SELECT UserNo FROM GameDB.dbo.T_User WHERE Nickname = @nick");

        if (targetCheck.recordset.length === 0) {
            return res.status(404).json({ message: 'اللاعب المستلم غير موجود' });
        }
        const targetUserNo = targetCheck.recordset[0].UserNo;

        // 2. خصم من الوكيل وإضافة للمستلم (عملية ذرية Transaction)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // خصم من الوكيل (يجب أن يملك المبلغ)
            const deduct = await transaction.request()
                .input('agent', agentUserNo)
                .input('amt', amount)
                .query("UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney - @amt WHERE UserNo = @agent AND GameMoney >= @amt");

            if (deduct.rowsAffected[0] === 0) {
                throw new Error('رصيدك غير كافٍ لإتمام العملية');
            }

            // إضافة للمستلم
            await transaction.request()
                .input('target', targetUserNo)
                .input('amt', amount)
                .query("UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney + @amt WHERE UserNo = @target");

            // تسجيل العملية في سجلات الاقتصاد (مهم جداً للوكلاء)
            await transaction.request()
                .input('agent', agentUserNo)
                .input('target', targetUserNo) // سنحتاج إضافة عمود TargetUserNo لجدول Web_EconomyLog أو دمجه في الوصف
                .input('amt', amount)
                .input('desc', `Agent Sale to ${targetNickname}`)
                .query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_EconomyLog 
                    (UserNo, ActionType, Amount, Currency, Description, LogDate) 
                    VALUES (@agent, 'AGENT_SELL', @amt, 'GP', @desc, GETDATE())
                `);

            await transaction.commit();
            res.json({ status: 'success', message: `تم تحويل ${amount} GP بنجاح إلى ${targetNickname}` });

        } catch (err) {
            await transaction.rollback();
            res.status(400).json({ message: err.message });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل العملية' });
    }
};

// عرض سجل مبيعات الوكيل
exports.getMySalesLog = async (req, res) => {
    const agentUserNo = req.user.userId;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', agentUserNo)
            .query("SELECT * FROM AdrenalineWeb.dbo.Web_EconomyLog WHERE UserNo = @id AND ActionType = 'AGENT_SELL' ORDER BY LogDate DESC");
        
        res.json({ status: 'success', logs: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'فشل جلب السجلات' });
    }
};