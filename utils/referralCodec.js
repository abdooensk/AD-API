// إزاحة الرقم لكي لا يبدو كود أول لاعب "1" بل رقم أكبر يبدو عشوائياً
const OFFSET = 14205; 
const PREFIX = 'ADR'; // بادئة الكود (يمكنك تغييرها لاسم لعبتك مثلا ADR)

/**
 * تحويل رقم اللاعب إلى كود دعوة أنيق
 * مثال: 1050 -> ADR37X
 */
function encodeReferralCode(userNo) {
    if (!userNo) return null;
    // نستخدم Base36 لتحويل الأرقام إلى حروف وأرقام (0-9, A-Z)
    const code = (userNo + OFFSET).toString(36).toUpperCase();
    return `${PREFIX}${code}`;
}

/**
 * تحويل كود الدعوة مرة أخرى لرقم اللاعب لتخزينه
 * مثال: ADR37X -> 1050
 */
function decodeReferralCode(code) {
    if (!code || !code.startsWith(PREFIX)) return null;
    
    // إزالة البادئة
    const cleanCode = code.replace(PREFIX, '');
    
    // التحويل العكسي من Base36 إلى رقم
    const num = parseInt(cleanCode, 36);
    
    // إزالة الإزاحة لنحصل على UserNo الحقيقي
    const userNo = num - OFFSET;
    
    return (userNo > 0) ? userNo : null;
}

module.exports = { encodeReferralCode, decodeReferralCode };