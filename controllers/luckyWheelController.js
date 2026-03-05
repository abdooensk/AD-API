const { poolPromise, sql } = require('../config/db');

// 1. تدوير العجلة (Spin) - مع الحماية الكاملة 🛡️
// 1. تدوير العجلة (Spin) - مع الحماية الكاملة من ثغرات الـ Race Condition 🛡️
exports.spinWheel = async (req, res) => {
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqTx = new sql.Request(transaction);
            reqTx.input('uid', userNo);

            let isFreeSpin = false;
            const todayStr = new Date().toISOString().split('T')[0];

            // 1. محاولة استغلال المحاولة المجانية (في خطوة واحدة آمنة جداً)
            const freeSpinUpdate = await reqTx.query(`
                UPDATE AuthDB.dbo.T_Account 
                SET LastFreeSpinDate = GETDATE() 
                WHERE UserNo = @uid 
                  AND (LastFreeSpinDate IS NULL OR CAST(LastFreeSpinDate AS DATE) < CAST(GETDATE() AS DATE))
            `);

            if (freeSpinUpdate.rowsAffected[0] > 0) {
                isFreeSpin = true; // تم تحديث التاريخ بنجاح، إذن المحاولة مجانية
            } else {
                // 2. إذا لم تكن مجانية، نقوم بالخصم المالي
                const settingsRes = await reqTx.query(`
                    SELECT ConfigKey, ConfigValue FROM AdrenalineWeb.dbo.Web_Settings 
                    WHERE ConfigKey IN ('Wheel_SpinPrice', 'Wheel_Currency')
                `);
                const price = parseInt(settingsRes.recordset.find(s => s.ConfigKey === 'Wheel_SpinPrice')?.ConfigValue || '0');

                if (price > 0) {
                    reqTx.input('price', price);
                    const col = 'CashMoney'; // يفضل استخدام CashMoney للصندوق
                    
                    // 👈 الخصم الآمن ضد ثغرة التزامن (الرصيد السالب)
                    const deduct = await reqTx.query(`
                        UPDATE GameDB.dbo.T_User 
                        SET ${col} = ${col} - @price 
                        WHERE UserNo = @uid AND ${col} >= @price
                    `);
                    
                    if (deduct.rowsAffected[0] === 0) throw new Error('رصيدك غير كافٍ (انتهت المحاولة المجانية اليوم)');
                }
            }

            // 3. جلب العناصر واختيار الجائزة
            const itemsRes = await reqTx.query("SELECT * FROM AdrenalineWeb.dbo.Web_WheelItems WHERE IsActive = 1");
            
            // 👈 حماية السيرفر من الانهيار إذا كان الصندوق فارغاً
            if (itemsRes.recordset.length === 0) {
                throw new Error('صندوق الحظ لا يحتوي على جوائز حالياً، يرجى إبلاغ الإدارة.');
            }

            let totalWeight = itemsRes.recordset.reduce((sum, item) => sum + item.Probability, 0);
            let random = Math.random() * totalWeight;
            let selectedItem = itemsRes.recordset.find(item => (random -= item.Probability) < 0) || itemsRes.recordset[0];

            // 4. منح الجائزة
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

            // 5. تسجيل اللوج
            const logCost = isFreeSpin ? 0 : (reqTx.parameters.price ? reqTx.parameters.price.value : 0);
            reqTx.input('wItemName', selectedItem.ItemName);
            reqTx.input('wItemId', selectedItem.WheelItemID);
            reqTx.input('cost', logCost);
            
            await reqTx.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_WheelLog (UserNo, WheelItemID, RewardName, Cost)
                VALUES (@uid, @wItemId, @wItemName, @cost)
            `);
            
            await transaction.commit();
            
            res.json({ 
                status: 'success', 
                message: `مبروك! حصلت على ${selectedItem.ItemName}`, 
                reward: selectedItem,
                isFreeSpin: isFreeSpin 
            });

        } catch (err) {
            await transaction.rollback();
            return res.status(400).json({ message: err.message });
        }
    } catch (err) {
        console.error('Wheel Error:', err);
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