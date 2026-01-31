const { poolPromise, sql } = require('../config/db');

// 1. جلب بيانات البروفايل
exports.getProfile = async (req, res) => {
    try {
        const pool = await poolPromise;
        const userNo = req.user.userNo; 

        const result = await pool.request()
            .input('id', userNo)
            .query(`
                SELECT 
                    U.Nickname,
                    U.Level,
                    U.Exp,
                    U.GameMoney AS Money,
                    U.CashMoney AS GP,
                    U.TotalWinCount,
                    U.TotalLoseCount,
                    U.TotalKillCount,
                    U.TotalDeathCount,
                    U.RegDate,
                    (SELECT TOP 1 C.ClanName FROM ClanDB.dbo.T_Clan C WHERE C.ClanNo = U.ClanNo) AS ClanName,
                    
                    -- 👇 جلب نقاط الولاء (LoyaltyPoints) من جدول الحسابات
                    -- استخدام ISNULL لضمان إرجاع 0 إذا كانت القيمة NULL
                    ISNULL((SELECT TOP 1 A.LoyaltyPoints FROM AuthDB.dbo.T_Account A WHERE A.UserNo = U.UserNo), 0) AS LoyaltyPoints                FROM GameDB.dbo.T_User U
                WHERE U.UserNo = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'بيانات اللاعب غير موجودة' });
        }

        const playerData = result.recordset[0];

        const kdRatio = playerData.TotalDeathCount === 0 
            ? playerData.TotalKillCount 
            : (playerData.TotalKillCount / playerData.TotalDeathCount).toFixed(2);

        res.json({
            status: 'success',
            player: {
                ...playerData,
                kdRatio: kdRatio
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'خطأ في جلب البيانات' });
    }
};

// 2. تغيير كلمة المرور
exports.changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userNo = req.user.userNo;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ message: 'يجب إدخال كلمة المرور القديمة والجديدة' });
    }

    if (newPassword.length < 4) {
        return res.status(400).json({ message: 'كلمة المرور الجديدة قصيرة جداً' });
    }

    try {
        const pool = await poolPromise;

        const checkPass = await pool.request()
            .input('uid', userNo)
            .query('SELECT Password FROM AuthDB.dbo.T_Account WHERE UserNo = @uid');

        const currentAccount = checkPass.recordset[0];

        if (!currentAccount) {
            return res.status(404).json({ message: 'الحساب غير موجود' });
        }

        if (currentAccount.Password !== oldPassword) {
            return res.status(400).json({ message: 'كلمة المرور القديمة غير صحيحة' });
        }

        await pool.request()
            .input('uid', userNo)
            .input('newPass', newPassword)
            .query('UPDATE AuthDB.dbo.T_Account SET Password = @newPass WHERE UserNo = @uid');

        res.json({ status: 'success', message: 'تم تغيير كلمة المرور بنجاح' });

    } catch (err) {
        console.error('Password Change Error:', err);
        res.status(500).json({ message: 'فشل تغيير كلمة المرور', error: err.message });
    }
};

// 3. عرض حالة الحظر (جديد)
exports.getBanStatus = async (req, res) => {
    const userNo = req.user.userNo;

    try {
        const pool = await poolPromise;
        
        const banInfo = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT TOP 1 Reason, BanDate, BannedBy 
                FROM AdrenalineWeb.dbo.Web_BanLog 
                WHERE UserNo = @uid AND IsActive = 1 
                ORDER BY BanID DESC
            `);

        const requestInfo = await pool.request()
            .input('uid', userNo)
            .query(`
                SELECT TOP 1 Status, FineAmount, RequestDate 
                FROM AdrenalineWeb.dbo.Web_UnbanRequests 
                WHERE UserNo = @uid 
                ORDER BY RequestID DESC
            `);

        res.json({
            status: 'success',
            isBanned: req.user.isBanned,
            banDetails: banInfo.recordset[0] || null,
            lastRequest: requestInfo.recordset[0] || null
        });

    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب المعلومات' });
    }
};

// 4. طلب فك الحظر (جديد)
exports.requestUnban = async (req, res) => {
    const userNo = req.user.userNo;
    const settingsRes = await pool.request()
    .query("SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'UnbanFine'");

    try {
        const pool = await poolPromise;

        const checkPending = await pool.request()
            .input('uid', userNo)
            .query("SELECT * FROM AdrenalineWeb.dbo.Web_UnbanRequests WHERE UserNo = @uid AND Status = 'Pending'");

        if (checkPending.recordset.length > 0) {
            return res.status(400).json({ message: 'لديك طلب قيد المراجعة بالفعل، يرجى الانتظار' });
        }

        await pool.request()
            .input('uid', userNo)
            .input('fine', fineAmount)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_UnbanRequests (UserNo, FineAmount, Status)
                VALUES (@uid, @fine, 'Pending')
            `);

        res.json({ status: 'success', message: 'تم إرسال طلب فك الحظر. سيقوم الأدمن بمراجعته وخصم الغرامة.' });

    } catch (err) {
        res.status(500).json({ message: 'فشل إرسال الطلب', error: err.message });
    }
};