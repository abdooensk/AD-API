// middleware/validationMiddleware.js
const validate = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body, { abortEarly: false });
        
        if (error) {
            const errors = error.details.map(detail => detail.message);
            return res.status(400).json({ 
                status: 'error',
                message: 'بيانات غير صالحة',
                errors: errors 
            });
        }
        next();
    };
};

module.exports = validate; // تأكد من وجود هذا السطر!