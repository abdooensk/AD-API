const cron = require('node-cron');
const { poolPromise, sql } = require('../config/db');

// 1. دالة تنظيف الزينة المنتهية (تم إصلاح ثغرة الحقن فيها 🔒)
const cleanupExpiredCosmetics = async () => {
    console.log(`[${new Date().toISOString()}] 🧹 بدء عملية تنظيف الزينة المنتهية...`);
    
    try {
        const pool = await poolPromise;
        
        const expiredItems = await pool.request().query(`
            SELECT UC.RowID, UC.UserNo, UC.CosmeticID, U.OriginalNickName, U.Nickname
            FROM AdrenalineWeb.dbo.Web_UserCosmetics UC
            JOIN GameDB.dbo.T_User U ON UC.UserNo = U.UserNo
            WHERE UC.IsEquipped = 1 
              AND UC.ExpireDate < GETDATE()
        `);

        if (expiredItems.recordset.length === 0) {
            return; // إزالة رسالة "لا توجد عناصر" لمنع الإزعاج في الكونسول كل ساعة
        }

        console.log(`⚠️ تم العثور على ${expiredItems.recordset.length} عنصر منتهي. جاري الإزالة...`);

        for (const item of expiredItems.recordset) {
            let nameToRestore = item.OriginalNickName;
            
            if (!nameToRestore) {
                nameToRestore = item.Nickname.replace(/\[#c[0-9A-Fa-f]{6}\]/g, '').replace(/\[.*?\]/g, ''); 
            }

            const transaction = new sql.Transaction(pool);
            await transaction.begin();

            try {
                const req = new sql.Request(transaction);

                // 🔒 التعديل هنا: استخدام .input() لمنع أخطاء الأسماء التي تحتوي على رموز
                await req
                    .input('rowId', item.RowID)
                    .query("UPDATE AdrenalineWeb.dbo.Web_UserCosmetics SET IsEquipped = 0 WHERE RowID = @rowId");

                await req
                    .input('nickname', nameToRestore)
                    .input('userNo', item.UserNo)
                    .query("UPDATE GameDB.dbo.T_User SET Nickname = @nickname WHERE UserNo = @userNo");

                await transaction.commit();
                console.log(`✔ تم استعادة اسم اللاعب: ${item.UserNo}`);

            } catch (err) {
                await transaction.rollback();
                console.error(`❌ فشل تنظيف العنصر للاعب ${item.UserNo}:`, err.message);
            }
        }

    } catch (err) {
        console.error('🔥 خطأ في تنظيف الزينة:', err.message);
    }
};

// 🆕 2. دالة تنظيف الجلسات الميتة (للحفاظ على سرعة السيرفر)
const cleanupDeadSessions = async () => {
    console.log(`[${new Date().toISOString()}] 🧹 بدء عملية تنظيف الجلسات الميتة...`);
    
    try {
        const pool = await poolPromise;
        
        // نحذف الجلسات التي مر عليها أكثر من 7 أيام (التوكن أصلاً ينتهي بعد يوم)
        // ونحذف الجلسات المسجلة كـ "خروج" (IsActive = 0) ومر عليها أكثر من يوم
        const result = await pool.request().query(`
            DELETE FROM AdrenalineWeb.dbo.Web_LoginSessions 
            WHERE LoginDate < DATEADD(DAY, -7, GETDATE())
               OR (IsActive = 0 AND LoginDate < DATEADD(DAY, -1, GETDATE()))
        `);

        if (result.rowsAffected[0] > 0) {
            console.log(`✅ تم حذف ${result.rowsAffected[0]} جلسة ميتة بنجاح وتخفيف الضغط.`);
        }
    } catch (err) {
        console.error('🔥 خطأ في تنظيف الجلسات:', err.message);
    }
};

// 3. تشغيل المهام المجدولة (Cron Jobs)
const startCronJobs = () => {
    // تنظيف الزينة: عند الدقيقة 0 من كل ساعة (مرة كل ساعة)
    cron.schedule('0 * * * *', cleanupExpiredCosmetics);
    
    // 🆕 تنظيف الجلسات: كل يوم عند منتصف الليل (00:00)
    cron.schedule('0 0 * * *', cleanupDeadSessions);
    
    console.log('⏰ تم تفعيل نظام التنظيف الآلي (Cron Jobs) بنجاح.');
};

module.exports = startCronJobs;