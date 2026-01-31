const { poolPromise, sql } = require('../config/db');

// نظام الكاش لثلاثة أنواع من التصنيف
let ranksCache = {
    players: { data: null, lastUpdated: 0 },
    killers: { data: null, lastUpdated: 0 },
    clans:   { data: null, lastUpdated: 0 }
};

// مدة التحديث (24 ساعة)
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// دالة مساعدة للتحقق من صلاحية الكاش
const isCacheValid = (type) => {
    const now = Date.now();
    return ranksCache[type].data && (now - ranksCache[type].lastUpdated < CACHE_DURATION);
};

// 1. ترتيب اللاعبين (Top Players) - تحديث يومي 🛡️
exports.getTopPlayers = async (req, res) => {
    try {
        if (isCacheValid('players')) {
            return res.json({ status: 'success', source: 'cache', list: ranksCache.players.data });
        }

        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT TOP 10
                U.Ranking,
                U.Nickname,
                U.Level,
                U.Exp,
                U.TotalKillCount,
                U.TotalDeathCount,
                (SELECT C.ClanName FROM ClanDB.dbo.T_Clan C WHERE C.ClanNo = U.ClanNo) AS ClanName
            FROM GameDB.dbo.T_User U
            WHERE U.IsAccountBlock = 0 
              AND U.GMGrade = 0
            ORDER BY U.Exp DESC
        `);

        ranksCache.players.data = result.recordset;
        ranksCache.players.lastUpdated = Date.now();

        res.json({ status: 'success', source: 'database', list: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب تصنيف اللاعبين', error: err.message });
    }
};

// 2. ترتيب الهدافين (Top Killers) - تحديث يومي 🛡️
exports.getTopKillers = async (req, res) => {
    try {
        if (isCacheValid('killers')) {
            return res.json({ status: 'success', source: 'cache', list: ranksCache.killers.data });
        }

        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT TOP 10
                U.Nickname,
                U.Level,
                U.TotalKillCount,
                U.TotalDeathCount,
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

        ranksCache.killers.data = result.recordset;
        ranksCache.killers.lastUpdated = Date.now();

        res.json({ status: 'success', source: 'database', list: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الهدافين', error: err.message });
    }
};

// 3. ترتيب الكلانات (Top Clans) - تحديث يومي 🛡️
exports.getTopClans = async (req, res) => {
    try {
        if (isCacheValid('clans')) {
            return res.json({ status: 'success', source: 'cache', list: ranksCache.clans.data });
        }

        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT TOP 10
                C.ClanName,
                C.VolumeLevel AS ClanLevel,
                C.CCBPoint AS ClanPoints,
                C.CCBWinCount,
                C.CCBLoseCount,
                (SELECT COUNT(*) FROM ClanDB.dbo.T_ClanMember CM WHERE CM.ClanNo = C.ClanNo) AS MemberCount,
                (SELECT M.Nickname FROM ClanDB.dbo.Clan_MemberInfo M WHERE M.UserNo = C.MasterUserNo) AS MasterName
            FROM ClanDB.dbo.T_Clan C
            WHERE C.Status != 2
            ORDER BY C.CCBPoint DESC
        `);

        ranksCache.clans.data = result.recordset;
        ranksCache.clans.lastUpdated = Date.now();

        res.json({ status: 'success', source: 'database', list: result.recordset });
    } catch (err) {
        res.status(500).json({ message: 'خطأ في جلب الكلانات', error: err.message });
    }
};

// دالة لمسح الكاش يدوياً (اختياري للأدمن)
exports.clearRanksCache = (req, res) => {
    ranksCache = {
        players: { data: null, lastUpdated: 0 },
        killers: { data: null, lastUpdated: 0 },
        clans:   { data: null, lastUpdated: 0 }
    };
    res.json({ message: 'تم تصفير كاش التصنيفات بنجاح' });
};