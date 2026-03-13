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

// 2. دالة تنظيف الجلسات الميتة (للحفاظ على سرعة السيرفر)
const cleanupDeadSessions = async () => {
    console.log(`[${new Date().toISOString()}] 🧹 بدء عملية تنظيف الجلسات الميتة...`);
    
    try {
        const pool = await poolPromise;
        
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

// ======================================================================
// 🔴 3. دالة الحماية المزدوجة (إغلاق الجلسات المعلقة + طرد الهاكرز)
// ======================================================================
const checkHeartbeatsAndKick = async () => {
    try {
        const pool = await poolPromise;
        const deadline = new Date(Date.now() - 60000); 

        // 🔴 إزالة شرط AccountID لكي نجلب كل الجلسات التي توقفت نبضاتها
        const deadTokens = await pool.request()
            .input('deadline', sql.DateTime, deadline)
            .query(`
                SELECT TokenString, AccountID 
                FROM AdrenalineWeb.dbo.Web_LaunchTokens 
                WHERE LastHeartbeat < @deadline
                  AND IsValid = 1 
            `);

        if (deadTokens.recordset.length > 0) {
            console.log(`🛡️ [Anti-Cheat/Session] تم اكتشاف ${deadTokens.recordset.length} جلسات ميتة. جاري التنظيف...`);
            
            for (const session of deadTokens.recordset) {
                // 1. إغلاق الجلسة فوراً ومنع الحاسوب من الدخول (مهما كانت حالة الحساب)
                await pool.request()
                    .input('t', sql.NVarChar, session.TokenString)
                    .query('UPDATE AdrenalineWeb.dbo.Web_LaunchTokens SET IsValid = 0 WHERE TokenString = @t');

                // 2. إذا كان اللاعب داخل اللعبة فعلاً (يمتلك AccountID)، نقوم بطرده
                if (session.AccountID) {
                    await pool.request()
                        .input('acc', sql.Int, session.AccountID)
                        .query(`
                            IF NOT EXISTS (SELECT 1 FROM GameDB.dbo.DisconnectList WHERE UserNo = @acc)
                            BEGIN
                                INSERT INTO GameDB.dbo.DisconnectList (UserNo, DateAdded) VALUES (@acc, GETDATE())
                            END
                        `);
                    console.log(`🚨 تم طرد اللاعب رقم: ${session.AccountID} لتعطيله الحماية.`);
                } else {
                    console.log(`🧹 تم إغلاق جلسة حاسوب معلقة بنجاح (بدون تسجيل دخول).`);
                }
            }
        }
    } catch (err) {
        console.error('🔥 خطأ في نظام الحماية (Watchdog):', err.message);
    }
};

// 4. تشغيل المهام المجدولة (Cron Jobs)
const startCronJobs = () => {
    // تنظيف الزينة: عند الدقيقة 0 من كل ساعة (مرة كل ساعة)
    cron.schedule('0 * * * *', cleanupExpiredCosmetics);
    
    // تنظيف الجلسات: كل يوم عند منتصف الليل (00:00)
    cron.schedule('0 0 * * *', cleanupDeadSessions);
    
    // 🔴 تشغيل فحص الحماية كل 30 ثانية (لاكتشاف الهاكرز فوراً)
    cron.schedule('*/30 * * * * *', checkHeartbeatsAndKick);
    
    console.log('⏰ تم تفعيل نظام التنظيف الآلي (Cron Jobs) ونظام الحماية (Watchdog) بنجاح.');
};

module.exports = startCronJobs;