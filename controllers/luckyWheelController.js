const { poolPromise, sql } = require('../config/db');

// 1. تدوير العجلة (Spin) - مع الحماية الكاملة 🛡️
exports.spinWheel = async (req, res) => {
    const userNo = req.user.userNo;
    
    try {
        const pool = await poolPromise;

        // أ. فحص سعة الحقيبة (حماية من ضياع الجوائز)
        const invCheck = await pool.request().input('uid', userNo).query("SELECT COUNT(*) as cnt FROM GameDB.dbo.T_UserItem WHERE UserNo = @uid");
        if (invCheck.recordset[0].cnt >= 240) {
            return res.status(400).json({ message: 'الحقيبة ممتلئة! أفرغ بعض الخانات أولاً.' });
        }

        // ب. التحقق الذري (Atomic Check) لمنع ثغرة التكرار Race Condition 🛡️
        // نحدث التاريخ فقط إذا كان قديماً. إذا نجح التحديث نكمل، إذا فشل نرفض.
        const checkAndUpdate = await pool.request()
            .input('uid', userNo)
            .query(`
                UPDATE AuthDB.dbo.T_Account 
                SET LastSpinDate = GETDATE() 
                WHERE UserNo = @uid 
                  AND (LastSpinDate IS NULL OR CAST(LastSpinDate AS DATE) < CAST(GETDATE() AS DATE))
            `);

        // إذا لم يتم تحديث أي صف، فهذا يعني أن اللاعب لعب اليوم بالفعل
        if (checkAndUpdate.rowsAffected[0] === 0) {
            return res.status(400).json({ 
                message: 'لقد قمت بتدوير العجلة اليوم بالفعل. يمكنك المحاولة مجدداً غداً!' 
            });
        }

        // ج. جلب العناصر من قاعدة البيانات
        const itemsRes = await pool.request().query("SELECT * FROM AdrenalineWeb.dbo.Web_WheelItems WHERE IsActive = 1");
        const items = itemsRes.recordset;

        if (items.length === 0) {
            // في حال خطأ كارثي (العجلة فارغة)، نعيد المحاولة للاعب
            await pool.request().query(`UPDATE AuthDB.dbo.T_Account SET LastSpinDate = DATEADD(day, -1, GETDATE()) WHERE UserNo = ${userNo}`);
            return res.status(500).json({ message: 'العجلة فارغة حالياً' });
        }

        // د. خوارزمية الاختيار العشوائي (Weighted Random)
        let totalWeight = items.reduce((sum, item) => sum + item.Probability, 0);
        let random = Math.random() * totalWeight;
        let selectedItem = items.find(item => (random -= item.Probability) < 0) || items[0];

        // هـ. تسليم الجائزة (Transaction)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);

            // منح الجائزة بناءً على نوعها
            // نفترض أن T_UserItem يحتاج ItemType، سنضيف قيمة افتراضية أو نجلبها إذا كانت ناقصة
            request.input('uid', userNo);
request.input('itemId', selectedItem.ItemId);
request.input('count', selectedItem.Count);
request.input('wItemId', selectedItem.WheelItemID);
request.input('wItemName', selectedItem.ItemName); // لحماية الاسم من الأحرف الغريبة
request.input('rewardAmt', selectedItem.RewardAmount || 0);

if (selectedItem.RewardType === 'ITEM') {
    // استخدمنا @ بدل ${}
    await request.query(`
        INSERT INTO GameDB.dbo.T_UserItem 
        (UserNo, ItemId, Count, Status, StartDate, EndDate, IsBaseItem, ItemType)
        VALUES (@uid, @itemId, @count, 1, GETDATE(), DATEADD(DAY, 7, GETDATE()), 0, 1)
    `);
} else if (selectedItem.RewardType === 'GP') { 
    // لاحظ: @rewardAmt و @uid
    await request.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney + @rewardAmt WHERE UserNo = @uid`);
} else if (selectedItem.RewardType === 'REGULAR') { 
    await request.query(`UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney + @rewardAmt WHERE UserNo = @uid`);
}

// تسجيل العملية بشكل آمن
await request.query(`
    INSERT INTO AdrenalineWeb.dbo.Web_WheelLog (UserNo, WheelItemID, RewardName)
    VALUES (@uid, @wItemId, @wItemName)
`);

            // تسجيل العملية في اللوج
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
            // في حال فشل التسليم، نعيد الحق للاعب في المحاولة
            await pool.request().query(`UPDATE AuthDB.dbo.T_Account SET LastSpinDate = DATEADD(day, -1, GETDATE()) WHERE UserNo = ${userNo}`);
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشلت عملية تدوير العجلة' });
    }
};

// 2. جلب معلومات العجلة (تم دمج الاسمين لضمان عمل الراوت القديم والجديد)
exports.getWheelItems = async (req, res) => {
    const userNo = req.user.userNo;
    try {
        const pool = await poolPromise;
        
        // 1. جلب العناصر
        const itemsRes = await pool.request().query("SELECT ItemName, RewardType, RewardAmount FROM AdrenalineWeb.dbo.Web_WheelItems WHERE IsActive = 1");
        
        // 2. التحقق من حالة اللاعب (هل لعب اليوم؟)
        const userRes = await pool.request().input('uid', userNo).query("SELECT LastSpinDate FROM AuthDB.dbo.T_Account WHERE UserNo = @uid");
        const lastSpin = userRes.recordset[0]?.LastSpinDate;
        
        let canSpin = true;
        if (lastSpin) {
            const lastDate = new Date(lastSpin).toISOString().split('T')[0];
            const today = new Date().toISOString().split('T')[0];
            if (lastDate === today) canSpin = false;
        }

        res.json({ 
            status: 'success', 
            items: itemsRes.recordset,
            canSpin: canSpin,
            lastSpin: lastSpin
        });

    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب بيانات العجلة' });
    }
};

// دالة إضافية لدعم أي راوت قديم يسميها getWheelInfo
exports.getWheelInfo = exports.getWheelItems;