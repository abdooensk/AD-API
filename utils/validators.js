// utils/validators.js
const Joi = require('joi');

// قواعد تسجيل الدخول
const loginSchema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    password: Joi.string().min(4).required()
});

// قواعد التسجيل (مثال)
const registerSchema = Joi.object({
    username: Joi.string().alphanum().min(3).max(20).required(),
    password: Joi.string().min(6).required(),
    email: Joi.string().email().required()
});

// قواعد التحويل المالي (المهمة لملف walletRoutes)
const transactionSchema = Joi.object({
    amount: Joi.number().integer().positive().min(1).max(10000).required(),
    targetUser: Joi.string().alphanum().min(3).max(30).optional()
});

// تأكد من تصدير transactionSchema هنا
module.exports = { loginSchema, registerSchema, transactionSchema };