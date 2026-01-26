const { poolPromise, sql } = require('../config/db');

// تدوير العجلة (Spin) - مرة واحدة يومياً
exports.spinWheel = async (req, res) => {
    const userNo = req.user.userNo;
    
    try {
        const pool = await poolPromise;

        // 1. التحقق من وقت آخر تدويرة (Daily Check)
        const userDateCheck = await pool.request()
            .input('uid', userNo)
            .query("SELECT LastSpinDate FROM AuthDB.dbo.T_Account WHERE UserNo = @uid");

        const lastSpin = userDateCheck.recordset[0].LastSpinDate;
        if (lastSpin) {
            const lastDate = new Date(lastSpin).toISOString().split('T')[0];
            const today = new Date().toISOString().split('T')[0];

            if (lastDate === today) {
                return res.status(400).json({ 
                    message: 'لقد قمت بتدوير العجلة اليوم بالفعل. يمكنك المحاولة مجدداً غداً!' 
                });
            }
        }

        // 2. جلب العناصر والاحتمالات
        const itemsRes = await pool.request().query("SELECT * FROM AdrenalineWeb.dbo.Web_WheelItems WHERE IsActive = 1");
        const items = itemsRes.recordset;

        if (items.length === 0) return res.status(500).json({ message: 'العجلة فارغة حالياً' });

        // 3. خوارزمية الاختيار العشوائي (Weighted Random)
        let totalWeight = items.reduce((sum, item) => sum + item.Probability, 0);
        let random = Math.random() * totalWeight;
        let selectedItem = items.find(item => (random -= item.Probability) < 0) || items[0];

        // 4. تنفيذ العملية (Transaction)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // أ. تحديث تاريخ التدوير (لمنع التلاعب)
            await request.query(`UPDATE AuthDB.dbo.T_Account SET LastSpinDate = GETDATE() WHERE UserNo = ${userNo}`);

            // ب. منح الجائزة بناءً على نوعها
            if (selectedItem.RewardType === 'ITEM') {
                await request.query(`
                    INSERT INTO GameDB.dbo.T_UserItem 
                    (UserNo, ItemId, Count, Status, RegDate, EndDate, IsBaseItem)
                    VALUES (${userNo}, ${selectedItem.ItemId}, ${selectedItem.Count}, 1, GETDATE(), DATEADD(DAY, 7, GETDATE()), 0)
                `);
            } else if (selectedItem.RewardType === 'GP') { // الكاش (CashMoney)
                await request.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney + ${selectedItem.RewardAmount} WHERE UserNo = ${userNo}`);
            } else if (selectedItem.RewardType === 'REGULAR') { // الرصيد العادي (GameMoney)
                await request.query(`UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney + ${selectedItem.RewardAmount} WHERE UserNo = ${userNo}`);
            }

            // ج. تسجيل العملية في اللوج
            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_WheelLog (UserNo, WheelItemID, RewardName)
                VALUES (${userNo}, ${selectedItem.WheelItemID}, N'${selectedItem.ItemName}')
            `);

            await transaction.commit();

            res.json({ 
                status: 'success', 
                message: `مبروك! حصلت على ${selectedItem.ItemName}`, 
                reward: selectedItem 
            });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشلت عملية تدوير العجلة' });
    }
};

// جلب العناصر (للعرض)
exports.getWheelItems = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query("SELECT ItemName, RewardType, RewardAmount FROM AdrenalineWeb.dbo.Web_WheelItems WHERE IsActive = 1");
        res.json({ status: 'success', items: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب بيانات العجلة' });
    }
};