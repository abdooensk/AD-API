// utils/validators.js
const Joi = require('joi');

// 1. قواعد تسجيل الدخول (في الـ Controller أنت تستخدم username، لذا هذا صحيح)
const loginSchema = Joi.object({
    username: Joi.string().required().messages({'any.required': 'اسم المستخدم مطلوب'}),
    password: Joi.string().required()
});

// 2. قواعد التسجيل (⚠️ تصحيح: غيرنا username إلى userid ليطابق authController)
// 2. قواعد التسجيل
const registerSchema = Joi.object({
    username: Joi.string() // 👈 تم التغيير من userid إلى username
        .min(3).max(20)
        .pattern(/^[a-zA-Z0-9_.-]+$/) 
        .required()
        .messages({
            'string.min': 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل',
            'string.max': 'اسم المستخدم يجب ألا يتجاوز 20 حرفاً',
            'string.pattern.base': 'اسم المستخدم يجب أن يحتوي على أحرف وأرقام أو (_ . -) فقط',
            'any.required': 'اسم المستخدم مطلوب'
        }),
    password: Joi.string().min(6).required(),
    email: Joi.string().email().required(),
    referralCode: Joi.string().optional().allow('').allow(null)
}).unknown(true);

// 3. قواعد التحويل المالي (للمحفظة)
const transactionSchema = Joi.object({
    amount: Joi.number().integer().positive().min(1).max(100000).required(), // رفعنا الحد قليلاً
    targetUser: Joi.string().alphanum().min(3).max(30).optional() // اختياري لأن عملية "تحويل العملة" لا تحتاج مستلم
});

module.exports = { loginSchema, registerSchema, transactionSchema };