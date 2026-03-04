const { poolPromise, sql } = require('../config/db');

// 1. تدوير العجلة (Spin) - مع الحماية الكاملة 🛡️
exports.spinWheel = async (req, res) => {
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;

        // 1. التحقق: هل استخدم المحاولة المجانية اليوم؟
        const userCheck = await pool.request().input('uid', userNo).query(`
            SELECT LastFreeSpinDate FROM AuthDB.dbo.T_Account WHERE UserNo = @uid
        `);
        
        const lastFreeSpin = userCheck.recordset[0]?.LastFreeSpinDate;
        const todayStr = new Date().toISOString().split('T')[0];
        const lastSpinStr = lastFreeSpin ? new Date(lastFreeSpin).toISOString().split('T')[0] : '';
        
        const isFreeSpin = (lastSpinStr !== todayStr); // إذا لم يلعب مجاناً اليوم، فهي مجانية

        // 2. جلب سعر التدوير (للمحاولات غير المجانية)
        const settingsRes = await pool.request().query(`
            SELECT ConfigKey, ConfigValue FROM AdrenalineWeb.dbo.Web_Settings 
            WHERE ConfigKey IN ('Wheel_SpinPrice', 'Wheel_Currency')
        `);
        const price = parseInt(settingsRes.recordset.find(s => s.ConfigKey === 'Wheel_SpinPrice')?.ConfigValue || '0');
        
        // 3. بدأ الترانزاكشن
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqTx = new sql.Request(transaction);
            reqTx.input('uid', userNo);

            if (isFreeSpin) {
                // ✅ محاولة مجانية: نحدث تاريخ آخر استخدام مجاني لليوم
                // هذا يضمن أن المحاولة القادمة في نفس اليوم ستكون مدفوعة
                await reqTx.query(`UPDATE AuthDB.dbo.T_Account SET LastFreeSpinDate = GETDATE() WHERE UserNo = @uid`);
            } else {
                // 💰 محاولة مدفوعة: يجب الخصم
                if (price > 0) {
                    const col = 'CashMoney'; // أو حسب الإعدادات
                    const deduct = await reqTx.query(`
                        UPDATE GameDB.dbo.T_User 
                        SET ${col} = ${col} - ${price} 
                        WHERE UserNo = @uid AND ${col} >= ${price}
                    `);
                    if (deduct.rowsAffected[0] === 0) throw new Error('رصيدك غير كافٍ (انتهت المحاولة المجانية)');
                }
            }

            // ... (باقي كود اختيار الجائزة ومنحها كما هو في الكود السابق) ...
            
            // جلب العناصر واختيار عشوائي
            const itemsRes = await reqTx.query("SELECT * FROM AdrenalineWeb.dbo.Web_WheelItems WHERE IsActive = 1");
            // ... (نفس منطق الاختيار العشوائي) ...
             let totalWeight = itemsRes.recordset.reduce((sum, item) => sum + item.Probability, 0);
            let random = Math.random() * totalWeight;
            let selectedItem = itemsRes.recordset.find(item => (random -= item.Probability) < 0) || itemsRes.recordset[0];


             // د. منح الجائزة
            reqTx.input('itemId', selectedItem.ItemId);
            reqTx.input('count', selectedItem.Count);
            reqTx.input('rewardAmt', selectedItem.RewardAmount || 0);

            if (selectedItem.RewardType === 'ITEM') {
                 await reqTx.query(`
        INSERT INTO GameDB.dbo.T_UserItem 
        (UserNo, ItemId, Count, Status, StartDate, EndDate, IsBaseItem, ItemType)
        VALUES (@uid, @itemId, @count, 1, GETDATE(), DATEADD(DAY, 7, GETDATE()), 0, 1)
    `);
            } else if (selectedItem.RewardType === 'GP') { 
                await reqTx.query(`UPDATE GameDB.dbo.T_User SET CashMoney = CashMoney + @rewardAmt WHERE UserNo = @uid`);
            } else if (selectedItem.RewardType === 'REGULAR') { 
                await reqTx.query(`UPDATE GameDB.dbo.T_User SET GameMoney = GameMoney + @rewardAmt WHERE UserNo = @uid`);
            }

            // تسجيل اللوج
            await reqTx.input('wItemName', selectedItem.ItemName).input('wItemId', selectedItem.WheelItemID).query(`
                INSERT INTO AdrenalineWeb.dbo.Web_WheelLog (UserNo, WheelItemID, RewardName, Cost)
                VALUES (@uid, @wItemId, @wItemName, ${isFreeSpin ? 0 : price})
            `);
            
            await transaction.commit();
            
            res.json({ 
                status: 'success', 
                message: `مبروك! حصلت على ${selectedItem.ItemName}`, 
                reward: selectedItem,
                isFreeSpin: isFreeSpin // نعلم الفرونت إند هل كانت مجانية
            });

        } catch (err) {
            await transaction.rollback();
            return res.status(400).json({ message: err.message });
        }
    } catch (err) {
        res.status(500).json({ message: 'خطأ في السيرفر' });
    }
};

// 2. جلب معلومات العجلة (تم دمج الاسمين لضمان عمل الراوت القديم والجديد)
exports.getWheelItems = async (req, res) => {
    const userNo = req.user.userNo;
    try {
        const pool = await poolPromise;
        
        // 1. جلب العناصر
        const itemsRes = await pool.request().query("SELECT ItemName, RewardType, RewardAmount FROM AdrenalineWeb.dbo.Web_WheelItems WHERE IsActive = 1");
        
        // 2. التحقق من حالة اللاعب (هل لعب مجاناً اليوم؟)
        // 👈 تم التعديل هنا للقراءة من LastFreeSpinDate
        const userRes = await pool.request().input('uid', userNo).query("SELECT LastFreeSpinDate FROM AuthDB.dbo.T_Account WHERE UserNo = @uid");
        
        // 👈 وهنا نستخدم الاسم الصحيح
        const lastSpin = userRes.recordset[0]?.LastFreeSpinDate;
        
        let canSpin = true; // نفترض أنه يستطيع اللعب (مجاناً)
        if (lastSpin) {
            const lastDate = new Date(lastSpin).toISOString().split('T')[0];
            const today = new Date().toISOString().split('T')[0];
            // إذا كان تاريخ آخر لعب مجاني هو اليوم، نرسل false ليظهر السعر بدلاً من "مجاني"
            if (lastDate === today) canSpin = false;
        }

        res.json({ 
            status: 'success', 
            items: itemsRes.recordset,
            canSpin: canSpin, // true = مجاني متاح، false = مدفوع
            lastSpin: lastSpin
        });

    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب بيانات العجلة' });
    }
};

// دالة إضافية لدعم أي راوت قديم يسميها getWheelInfo
exports.getWheelInfo = exports.getWheelItems;