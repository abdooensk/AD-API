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
    const { rewardType } = req.body; // 'LOGIN' أو 'PLAYTIME'
    

    try {
        const pool = await poolPromise;
        const today = new Date().toISOString().split('T')[0];

        // 1. التحقق من سجل المكافآت المستلمة في AdrenalineWeb
        const attendanceResult = await pool.request()
            .input('uid', userNo)
            .query(`SELECT LastClaimDate, LoginRewardClaimed, PlayRewardClaimed 
                    FROM AdrenalineWeb.dbo.Web_DailyAttendance WHERE UserNo = @uid`);
        
        const attendance = attendanceResult.recordset[0];
        const isNewDay = !attendance || new Date(attendance.LastClaimDate).toISOString().split('T')[0] !== today;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            let message = "";
            request.input('uid', userNo); // 👈 إضافة الـ input

            if (rewardType === 'LOGIN') {
                // منطق مكافأة تسجيل الدخول
                if (!isNewDay && attendance && attendance.LoginRewardClaimed) {
                    return res.status(400).json({ message: 'لقد استلمت نقطة الدخول اليوم بالفعل' });
                }

                await request.query(`
                    UPDATE AuthDB.dbo.T_Account SET LoyaltyPoints = LoyaltyPoints + 1 WHERE UserNo = ${userNo};
                    IF EXISTS (SELECT 1 FROM AdrenalineWeb.dbo.Web_DailyAttendance WHERE UserNo = ${userNo})
                        UPDATE AdrenalineWeb.dbo.Web_DailyAttendance SET LoginRewardClaimed = 1, LastClaimDate = GETDATE() WHERE UserNo = ${userNo}
                    ELSE
                        INSERT INTO AdrenalineWeb.dbo.Web_DailyAttendance (UserNo, LoginRewardClaimed, LastClaimDate) VALUES (${userNo}, 1, GETDATE());
                `);
                message = "تم استلام نقطة تسجيل الدخول!";

            } else if (rewardType === 'PLAYTIME') {
                // منطق مكافأة ساعة اللعب (باستخدام T_LogDailyUser من LogDB)
                if (!isNewDay && attendance && attendance.PlayRewardClaimed) {
                    return res.status(400).json({ message: 'لقد استلمت نقطة وقت اللعب اليوم بالفعل' });
                }

                // جلب وقت اللعب الفعلي من LogDB لليوم الحالي
                const playTimeCheck = await pool.request()
                    .input('uid', userNo)
                    .query(`
                        SELECT ISNULL(PlayTime, 0) as DailyMinutes 
                        FROM LogDB.dbo.T_LogDailyUser 
                        WHERE UserNo = @uid AND CONVERT(date, LogDate) = CONVERT(date, GETDATE())
                    `);

                const dailyMinutes = playTimeCheck.recordset[0] ? playTimeCheck.recordset[0].DailyMinutes : 0;

                if (dailyMinutes < 60) {
                    return res.status(400).json({ message: `يجب أن تلعب لمدة 60 دقيقة. وقتك الحالي اليوم: ${dailyMinutes} دقيقة.` });
                }

                await request.query(`
        UPDATE AuthDB.dbo.T_Account SET LoyaltyPoints = LoyaltyPoints + 1 WHERE UserNo = @uid; -- استخدم @uid
        IF EXISTS (SELECT 1 FROM AdrenalineWeb.dbo.Web_DailyAttendance WHERE UserNo = @uid)
            UPDATE AdrenalineWeb.dbo.Web_DailyAttendance SET LoginRewardClaimed = 1, LastClaimDate = GETDATE() WHERE UserNo = @uid
        ELSE
            INSERT INTO AdrenalineWeb.dbo.Web_DailyAttendance (UserNo, LoginRewardClaimed, LastClaimDate) VALUES (@uid, 1, GETDATE());
    `);
                message = "تهانينا! أكملت ساعة لعب وحصلت على نقطة ولاء.";
            }

            // تسجيل العملية
            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_LoyaltyLog (UserNo, PointsSpent, RewardType, RewardAmount, Date)
                VALUES (${userNo}, 0, 'DAILY_${rewardType}', 1, GETDATE())
            `);

            await transaction.commit();
            res.json({ status: 'success', message });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل استلام المكافأة', error: err.message });
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