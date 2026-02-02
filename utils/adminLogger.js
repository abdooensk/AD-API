const { poolPromise, sql } = require('../config/db');

exports.logAdminAction = async (adminId, actionType, targetUserNo, details, ip) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('admin', adminId)
            .input('action', actionType)
            .input('target', targetUserNo || null)
            .input('details', details || '')
            .input('ip', ip || 'Unknown')
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_AdminLogs (AdminID, ActionType, TargetUserNo, Details, IPAddress)
                VALUES (@admin, @action, @target, @details, @ip)
            `);
    } catch (err) {
        console.error('Failed to log admin action:', err);
        // لا نوقف السيرفر إذا فشل اللوج، فقط نطبع الخطأ
    }
};