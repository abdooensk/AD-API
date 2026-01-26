const { sql } = require('../config/db');

/**
 * دالة لحساب ومنح نقاط الولاء عند الشراء
 * @param {object} request - كائن الطلب الخاص بالـ Transaction الحالية
 * @param {number} userNo - رقم اللاعب
 * @param {number} amountSpentGP - المبلغ الذي صرفه اللاعب
 */
async function rewardPointsOnPurchase(request, userNo, amountSpentGP) {
    try {
        // 1. جلب النسبة من الإعدادات (مثلاً 0.05 تعني 5%)
        // نستخدم request الممرر إلينا لنكون داخل نفس الـ Transaction
        const settingRes = await request.query(`SELECT ConfigValue FROM AdrenalineWeb.dbo.Web_Settings WHERE ConfigKey = 'PurchasePointsRatio'`);
        const ratio = settingRes.recordset[0] ? parseFloat(settingRes.recordset[0].ConfigValue) : 0;

        // إذا كانت النسبة 0 أو غير موجودة، نوقف الدالة
        if (ratio <= 0) return; 

        // 2. حساب النقاط (تقريب للأدنى)
        const pointsEarned = Math.floor(amountSpentGP * ratio);

        if (pointsEarned > 0) {
            // 3. إضافة النقاط لرصيد اللاعب
            await request.query(`UPDATE AuthDB.dbo.T_Account SET LoyaltyPoints = LoyaltyPoints + ${pointsEarned} WHERE UserNo = ${userNo}`);
            
            // 4. تسجيل العملية في اللوج ليعرف اللاعب من أين جاءت النقاط
            await request.query(`
                INSERT INTO AdrenalineWeb.dbo.Web_LoyaltyLog (UserNo, PointsSpent, RewardType, RewardAmount, Date)
                VALUES (${userNo}, 0, 'PURCHASE_REWARD', ${pointsEarned}, GETDATE())
            `);
            
            console.log(`[Reward System] User ${userNo} earned ${pointsEarned} points.`);
        }
    } catch (err) {
        console.error('Reward System Error:', err);
        // ملاحظة: لا نرمي الخطأ (throw) هنا لكي لا نوقف عملية الشراء الأصلية
        // إذا فشل منح النقاط، اللاعب يحصل على غرضه عادي، والنقاط فقط هي التي تفشل
    }
}

module.exports = { rewardPointsOnPurchase };