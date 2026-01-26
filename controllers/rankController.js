const { poolPromise } = require('../config/db');

// 1. ترتيب اللاعبين (Top Players) - يعتمد على GameDB
exports.getTopPlayers = async (req, res) => {
    try {
        const pool = await poolPromise;
        
        const result = await pool.request().query(`
            SELECT TOP 10
                U.Ranking,
                U.Nickname,
                U.Level,
                U.Exp,
                U.TotalKillCount,
                U.TotalDeathCount,
                -- جلب اسم الكلان إن وجد
                (SELECT C.ClanName FROM ClanDB.dbo.T_Clan C WHERE C.ClanNo = U.ClanNo) AS ClanName
            FROM GameDB.dbo.T_User U
            WHERE U.IsAccountBlock = 0 
              AND U.GMGrade = 0
            ORDER BY U.Exp DESC
        `);

        res.json({ status: 'success', list: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب تصنيف اللاعبين', error: err.message });
    }
};

// 2. ترتيب الهدافين (Top Killers) - يعتمد على GameDB
exports.getTopKillers = async (req, res) => {
    try {
        const pool = await poolPromise;
        
        const result = await pool.request().query(`
            SELECT TOP 10
                U.Nickname,
                U.Level,
                U.TotalKillCount,
                U.TotalDeathCount,
                -- حساب الـ KD Ratio
                CASE 
                    WHEN U.TotalDeathCount = 0 THEN U.TotalKillCount 
                    ELSE ROUND(CAST(U.TotalKillCount AS FLOAT) / U.TotalDeathCount, 2)
                END AS KDRatio,
                (SELECT C.ClanName FROM ClanDB.dbo.T_Clan C WHERE C.ClanNo = U.ClanNo) AS ClanName
            FROM GameDB.dbo.T_User U
            WHERE U.IsAccountBlock = 0 
              AND U.GMGrade = 0
            ORDER BY U.TotalKillCount DESC
        `);

        res.json({ status: 'success', list: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الهدافين', error: err.message });
    }
};

// 3. ترتيب الكلانات (Top Clans) - تم التعديل بناءً على ClanDB الجديد 🛠️
exports.getTopClans = async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // التعديلات:
        // 1. استخدمنا C.CCBPoint بدلاً من C.Point
        // 2. جلبنا اسم القائد من جدول Clan_MemberInfo
        // 3. استبعدنا الكلانات المحذوفة (Status != 2)
        const result = await pool.request().query(`
            SELECT TOP 10
                C.ClanName,
                C.VolumeLevel AS ClanLevel, -- مستوى الكلان
                C.CCBPoint AS ClanPoints,   -- النقاط (تم التصحيح)
                C.CCBWinCount,
                C.CCBLoseCount,
                -- حساب عدد الأعضاء
                (SELECT COUNT(*) FROM ClanDB.dbo.T_ClanMember CM WHERE CM.ClanNo = C.ClanNo) AS MemberCount,
                -- جلب اسم القائد
                (SELECT M.Nickname FROM ClanDB.dbo.Clan_MemberInfo M WHERE M.UserNo = C.MasterUserNo) AS MasterName
            FROM ClanDB.dbo.T_Clan C
            WHERE C.Status != 2 -- لا نعرض الكلانات المحذوفة
            ORDER BY C.CCBPoint DESC
        `);

        res.json({ status: 'success', list: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الكلانات', error: err.message });
    }
};