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
// 2. استلام المكافأة اليومية (Daily Check-in) - نسخة محسنة
exports.claimDailyReward = async (req, res) => {
    const userNo = req.user.userNo;
    const { rewardType } = req.body; 

    if (rewardType !== 'LOGIN') return res.status(400).json({ message: 'فقط مكافأة الدخول مدعومة حالياً' });

    try {
        const pool = await poolPromise;
        
        // 1. جلب آخر تاريخ استلام
        const attRes = await pool.request().input('uid', userNo).query(`
            SELECT ConsecutiveDays, LastClaimDate 
            FROM AdrenalineWeb.dbo.Web_DailyAttendance WHERE UserNo = @uid
        `);
        
        const att = attRes.recordset[0];
        
        let newDays = 1; // القيمة الافتراضية لليوم الأول
        let isStreakBroken = false;

        if (att) {
            const lastDate = new Date(att.LastClaimDate);
            const today = new Date();
            
            // تصفير الوقت للمقارنة بالأيام فقط
            lastDate.setHours(0,0,0,0);
            today.setHours(0,0,0,0);

            const diffTime = Math.abs(today - lastDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 0) {
                return res.status(400).json({ message: 'لقد استلمت مكافأة اليوم بالفعل، عد غداً!' });
            } else if (diffDays === 1) {
                // حضر أمس، واليوم حضر -> استمرار السلسلة
                newDays = att.ConsecutiveDays + 1;
            } else {
                // غاب أكثر من يوم -> كسر السلسلة والعودة لليوم 1
                newDays = 1;
                isStreakBroken = true;
            }
        }

        // بدء المعاملة (Transaction)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqTx = new sql.Request(transaction);
            let message = `تم تسجيل حضورك لليوم ${newDays} على التوالي!`;
            
            if (isStreakBroken && att) {
                message = `لقد انقطعت عن الحضور! عاد العداد إلى اليوم 1.`;
            }

            // 2. معالجة المكافآت (كل 7 أيام نقطة ولاء)
            let loyaltyPointsToAdd = 0;
            if (newDays % 7 === 0) {
                loyaltyPointsToAdd = 1;
                message += " 💎 مبروك! أكملت أسبوعاً وحصلت على نقطة ولاء.";
            }

            // 3. تحديث أو إدراج في جدول الحضور (Upsert Logic)
            if (att) {
                await reqTx.query(`
                    UPDATE AdrenalineWeb.dbo.Web_DailyAttendance 
                    SET ConsecutiveDays = ${newDays}, 
                        LastClaimDate = GETDATE() 
                    WHERE UserNo = ${userNo}
                `);
            } else {
                // مستخدم جديد يسجل لأول مرة
                await reqTx.query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_DailyAttendance (UserNo, ConsecutiveDays, LastClaimDate)
                    VALUES (${userNo}, 1, GETDATE())
                `);
                message = "مرحباً بك! تم تسجيل حضورك لليوم الأول.";
            }

            // 4. منح نقطة الولاء (إذا استحقها)
            if (loyaltyPointsToAdd > 0) {
                await reqTx.query(`UPDATE AuthDB.dbo.T_Account SET LoyaltyPoints = LoyaltyPoints + ${loyaltyPointsToAdd} WHERE UserNo = ${userNo}`);
                
                // تسجيل اللوج
                await reqTx.query(`
                    INSERT INTO AdrenalineWeb.dbo.Web_LoyaltyLog (UserNo, PointsSpent, RewardType, RewardAmount, Date) 
                    VALUES (${userNo}, 0, 'WEEKLY_STREAK', ${loyaltyPointsToAdd}, GETDATE())
                `);
            }

            // 5. يمكنك هنا إضافة كود لمنح عنصر (Item) داخل اللعبة بناءً على newDays
            // مثال: استدعاء دالة تمنح سلاحاً لمدة يوم إذا كان اليوم = 3 (اختياري)

            await transaction.commit();
            res.json({ 
                status: 'success', 
                message, 
                days: newDays,
                streakBroken: isStreakBroken
            });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'فشل العملية', error: err.message });
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
        // 👈 التعديل هنا: I.RestrictLevel AS Level
        const result = await pool.request().query(`
            SELECT A.DayCount, A.ItemCount, I.ItemName, I.RestrictLevel AS Level, A.ItemDays
            FROM GameDB.dbo.T_Event_Attendance A
            LEFT JOIN GameDB.dbo.T_ItemInfo I ON A.ItemId = I.ItemId
            ORDER BY A.DayCount ASC
        `);
        res.json({ status: 'success', rewards: result.recordset });
    } catch (err) {
        console.error("Attendance List Error:", err);
        res.status(500).json({ message: 'فشل جلب القائمة' });
    }
};