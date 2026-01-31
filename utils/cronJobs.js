const cron = require('node-cron');
const { poolPromise, sql } = require('../config/db'); // 👈 نقطتين (..) للرجوع للخلف// دالة التنظيف (Cleaning Function)
const cleanupExpiredCosmetics = async () => {
    console.log(`[${new Date().toISOString()}] 🧹 بدء عملية تنظيف الزينة المنتهية...`);
    
    try {
        const pool = await poolPromise;
        
        // 1. البحث عن العناصر المنتهية والتي ما زالت مجهزة (IsEquipped = 1)
        // نستخدم GETDATE() لمقارنة الوقت الحالي
        const expiredItems = await pool.request().query(`
            SELECT UC.RowID, UC.UserNo, UC.CosmeticID, U.OriginalNickName, U.Nickname
            FROM AdrenalineWeb.dbo.Web_UserCosmetics UC
            JOIN GameDB.dbo.T_User U ON UC.UserNo = U.UserNo
            WHERE UC.IsEquipped = 1 
              AND UC.ExpireDate < GETDATE()
        `);

        if (expiredItems.recordset.length === 0) {
            console.log('✅ لا توجد عناصر منتهية حالياً.');
            return;
        }

        console.log(`⚠️ تم العثور على ${expiredItems.recordset.length} عنصر منتهي. جاري الإزالة...`);

        // 2. معالجة كل عنصر
        for (const item of expiredItems.recordset) {
            const userNo = item.UserNo;
            const rowId = item.RowID;
            
            // استعادة الاسم الأصلي
            // إذا كان OriginalNickName فارغاً (خطأ بيانات قديم)، نستخدم Nickname الحالي كحل مؤقت
            // لكن الأصح هو الاعتماد على OriginalNickName المحفوظ عند التجهيز
            let nameToRestore = item.OriginalNickName;
            
            if (!nameToRestore) {
                // محاولة تنظيف الاسم يدوياً إذا فقدنا الاسم الأصلي
                // مثلاً إزالة الأكواد مثل [#cFF0000] أو [Admin]
                nameToRestore = item.Nickname.replace(/\[#c[0-9A-Fa-f]{6}\]/g, '').replace(/\[.*?\]/g, ''); 
            }

            const transaction = new sql.Transaction(pool);
            await transaction.begin();

            try {
                const req = new sql.Request(transaction);

                // أ. إلغاء التجهيز في الويب
                await req.query(`UPDATE AdrenalineWeb.dbo.Web_UserCosmetics SET IsEquipped = 0 WHERE RowID = ${rowId}`);

                // ب. استعادة الاسم في اللعبة
                await req.query(`UPDATE GameDB.dbo.T_User SET Nickname = N'${nameToRestore}' WHERE UserNo = ${userNo}`);

                await transaction.commit();
                console.log(`✔ تم استعادة اسم اللاعب: ${userNo}`);

            } catch (err) {
                await transaction.rollback();
                console.error(`❌ فشل تنظيف العنصر ${rowId} للاعب ${userNo}:`, err.message);
            }
        }

    } catch (err) {
        console.error('🔥 خطأ في Cron Job:', err.message);
    }
};

// تشغيل المهمة:
// النجوم تعني: (ثانية دقيقة ساعة يوم شهر يوم_أسبوع)
// '0 * * * *' تعني عند الدقيقة 0 من كل ساعة (مرة كل ساعة)
const startCronJobs = () => {
    cron.schedule('0 * * * *', cleanupExpiredCosmetics);
    console.log('⏰ تم تفعيل نظام التنظيف الآلي (Cron Jobs).');
};

module.exports = startCronJobs;