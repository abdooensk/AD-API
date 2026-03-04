// controllers/serverController.js
const { poolPromise } = require('../config/db');

// 1. جلب حالة السيرفر (Status)
exports.getServerStatus = async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // جلب عدد المتصلين (إذا كان لديك جدول للجلسات) أو عدد اللاعبين الكلي
        const playersRes = await pool.request().query("SELECT COUNT(*) AS Cnt FROM GameDB.dbo.T_User");
        
        // جلب عدد المتصلين حالياً (من جدول الجلسات الذي أنشأناه سابقاً)
        const onlineRes = await pool.request().query("SELECT COUNT(*) AS Cnt FROM AdrenalineWeb.dbo.Web_LoginSessions WHERE IsActive = 1");

        res.json({
            status: 'success',
            serverStatus: 'Online',
            totalPlayers: playersRes.recordset[0].Cnt,
            onlinePlayers: onlineRes.recordset[0]?.Cnt || 0,
            serverTime: new Date()
        });
    } catch (err) {
        console.error(err);
        // حتى لو حدث خطأ في قاعدة البيانات، نعيد أن السيرفر يعمل
        res.json({ status: 'success', serverStatus: 'Online', error: 'DB_ERROR' });
    }
};

// 2. جلب سجل التحديثات (History)
exports.getServerHistory = async (req, res) => {
    try {
        // يمكنك جلبها من قاعدة البيانات أو وضع بيانات ثابتة هنا
        const history = [
            { date: '2024-02-06', title: 'Server Maintenance', description: 'Fixed login issues and added ticket system.' },
            { date: '2024-02-01', title: 'New Season', description: 'Season 5 started with new weapons.' }
        ];

        res.json({ status: 'success', history });
    } catch (err) {
        res.status(500).json({ message: 'Error fetching history' });
    }
};