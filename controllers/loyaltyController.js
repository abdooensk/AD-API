const { poolPromise, sql } = require('../config/db');
const { encodeReferralCode } = require('../utils/referralCodec'); // 👈 أضف هذا السطر ضروري جداً
// 1. عرض إحصائياتي + رابط الدعوة + حالة المكافأة اليومية
exports.getMyLoyaltyStats = async (req, res) => {
    const userNo = req.user.userNo;
    // يمكنك وضع هذا الرابط في ملف .env لاحقاً
    const SITE_URL = process.env.SITE_URL || 'http://localhost:3000'; 

    try {
        const pool = await poolPromise;
        
        // جلب النقاط وعدد الدعوات
        const result = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT 
                    A.LoyaltyPoints,
                    (SELECT COUNT(*) FROM AuthDB.dbo.T_Account WHERE ReferredBy = A.UserNo AND IsEmailVerified = 1) AS InvitedCount
                FROM AuthDB.dbo.T_Account A
                WHERE A.UserNo = @uid
            `);

        const data = result.recordset[0];

        // جلب الإعدادات وسجل الحضور اليومي
        const settings = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT ConfigKey, ConfigValue FROM AdrenalineWeb.dbo.Web_Settings 
                WHERE ConfigKey IN ('Loyalty_ExchangeRate_Cash', 'Loyalty_ExchangeRate_GP', 'ReferralMaxCount', 'DailyLoginPoints');

                SELECT LastClaimDate FROM AdrenalineWeb.dbo.Web_DailyAttendance WHERE UserNo = @uid;
            `);
        
        const rates = {};
        settings.recordsets[0].forEach(s => rates[s.ConfigKey] = s.ConfigValue);

        // التحقق هل استلم المكافأة اليوم؟
        let canClaimDaily = true;
        const dailyRecord = settings.recordsets[1][0];
        
        if (dailyRecord) {
            const lastDate = new Date(dailyRecord.LastClaimDate).toISOString().split('T')[0]; // YYYY-MM-DD
            const today = new Date().toISOString().split('T')[0];
            if (lastDate === today) canClaimDaily = false;
        }

        res.json({
            status: 'success',
            points: data.LoyaltyPoints,
            invitedCount: data.InvitedCount,
            maxInvites: parseInt(rates['ReferralMaxCount']) || 50,
            dailyRewardPoints: parseInt(rates['DailyLoginPoints']) || 5,
            
            // 👈 رابط الدعوة الجاهز
            referralCode: encodeReferralCode(userNo), 
            referralLink: `${SITE_URL}/register?ref=${encodeReferralCode(userNo)}`,

            canClaimDaily: canClaimDaily, // true = الزر مفعل، false = الزر معطل
            
            exchangeRates: {
                cash: parseInt(rates['Loyalty_ExchangeRate_Cash']) || 1,
                gp: parseInt(rates['Loyalty_ExchangeRate_GP']) || 1000
            }
        });

    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب البيانات', error: err.message });
    }
};

// 2. استلام المكافأة اليومية (Daily Check-in)
exports.claimDailyReward = async (req, res) => {
    const userNo = req.user.userNo;
    const { rewardType } = req.body; 

    if (rewardType !== 'LOGIN') return res.status(400).json({ message: 'فقط مكافأة الدخول مدعومة حالياً' });

    try {
        const pool = await poolPromise;
        
        // جلب البيانات الحالية
        const attRes = await pool.request().input('uid', userNo).query(`
            SELECT ConsecutiveDays, LoginRewardClaimed, LastClaimDate 
            FROM AdrenalineWeb.dbo.Web_DailyAttendance WHERE UserNo = @uid
        `);
        
        const att = attRes.recordset[0];
        if (att && att.LoginRewardClaimed) {
            return res.status(400).json({ message: 'لقد استلمت مكافأة اليوم بالفعل' });
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqTx = new sql.Request(transaction);
            
            // 1. زيادة الأيام المتتالية +1
            let newDays = (att.ConsecutiveDays || 0) + 1;
            let message = `تم تسجيل حضورك لليوم ${newDays} على التوالي!`;
            let loyaltyPointsToAdd = 0;

            // 2. التحقق من اكتمال أسبوع (كل 7 أيام)
            if (newDays % 7 === 0) {
                loyaltyPointsToAdd = 1;
                message += " 💎 مبروك! حصلت على نقطة ولاء إضافية لإكمالك أسبوعاً.";
            }

            // 3. تحديث جدول الحضور
            await reqTx.query(`
                UPDATE AdrenalineWeb.dbo.Web_DailyAttendance 
                SET ConsecutiveDays = ${newDays}, 
                    LoginRewardClaimed = 1, 
                    LastClaimDate = GETDATE() 
                WHERE UserNo = ${userNo}
            `);

            // 4. منح نقطة الولاء (إذا أكمل أسبوعاً)
            if (loyaltyPointsToAdd > 0) {
                await reqTx.query(`UPDATE AuthDB.dbo.T_Account SET LoyaltyPoints = LoyaltyPoints + ${loyaltyPointsToAdd} WHERE UserNo = ${userNo}`);
                // تسجيل اللوج
                await reqTx.query(`INSERT INTO AdrenalineWeb.dbo.Web_LoyaltyLog (UserNo, PointsSpent, RewardType, RewardAmount, Date) VALUES (${userNo}, 0, 'WEEKLY_STREAK', 1, GETDATE())`);
            }

            // 5. منح محاولة عجلة الحظ المجانية (تصفير تاريخ آخر استخدام مجاني ليصبح متاحاً)
            // ملاحظة: المحاولة المجانية تعتمد على مقارنة التاريخ، لذا لا نحتاج لتخزين "رصيد محاولات".
            // فقط نتأكد أن LastFreeSpinDate في T_Account ليس اليوم.
            // (سيتم التعامل مع هذا في luckyWheelController)

            await transaction.commit();
            res.json({ status: 'success', message, days: newDays });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        res.status(500).json({ message: 'فشل العملية' });
    }
};

// 3. تحويل النقاط (كما هي سابقاً)
exports.exchangePoints = async (req, res) => {
    const { pointsToSpend, type } = req.body; 
    const userNo = req.user.userNo;

    if (!pointsToSpend || pointsToSpend <= 0) return res.status(400).json({ message: 'العدد غير صحيح' });

    try {
        const pool = await poolPromise;
        const check = await pool.request().input('uid', userNo).query(`
            SELECT A.LoyaltyPoints, S.ConfigValue AS Rate
            FROM AuthDB.dbo.T_Account A, AdrenalineWeb.dbo.Web_Settings S
            WHERE A.UserNo = @uid AND S.ConfigKey = 'Loyalty_ExchangeRate_${type}'
        `);

        if (!check.recordset[0]) return res.status(400).json({ message: 'خطأ في البيانات' });
        
        const { LoyaltyPoints, Rate } = check.recordset[0];
        if (LoyaltyPoints < pointsToSpend) return res.status(400).json({ message: 'نقاطك غير كافية' });

        const rewardAmount = pointsToSpend * parseInt(Rate);
        
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const request = new sql.Request(transaction);
            request.input('uid', userNo);
            request.input('points', pointsToSpend);
            request.input('amount', rewardAmount);
            request.input('type', type);
            await request.query(`UPDATE AuthDB.dbo.T_Account SET LoyaltyPoints = LoyaltyPoints - @points WHERE UserNo = @uid`);

            const col = type === 'CASH' ? 'CashMoney' : 'GameMoney';
// ملاحظة: أسماء الأعمدة لا يمكن وضعها كـ parameter، لذا نترك ${col} كما هي لأننا نتحكم بها برمجياً (ليس من مدخلات المستخدم)، لكن القيم يجب أن تكون parameters
            await request.query(`UPDATE GameDB.dbo.T_User SET ${col} = ${col} + @amount WHERE UserNo = @uid`);

            await request.query(`INSERT INTO AdrenalineWeb.dbo.Web_LoyaltyLog (UserNo, PointsSpent, RewardType, RewardAmount, Date) VALUES (@uid, @points, @type, @amount, GETDATE())`);
            await transaction.commit();
            res.json({ status: 'success', message: 'تم التحويل بنجاح', newBalance: LoyaltyPoints - pointsToSpend });
        } catch (e) {
            await transaction.rollback();
            throw e;
        }
    } catch (err) {
        res.status(500).json({ message: 'خطأ في السيرفر' });
    }
};
// 4. عرض قائمة جوائز الحضور (ليعرف اللاعب ماذا ينتظره)
exports.getAttendanceList = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT A.DayCount, A.ItemCount, I.ItemName, I.Level, A.ItemDays
            FROM GameDB.dbo.T_Event_Attendance A
            LEFT JOIN GameDB.dbo.T_ItemInfo I ON A.ItemId = I.ItemId
            ORDER BY A.DayCount ASC
        `);
        res.json({ status: 'success', rewards: result.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل جلب القائمة' });
    }
};