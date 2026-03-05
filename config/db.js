const sql = require('mssql');
require('dotenv').config();

// قراءة الإعدادات من ملف .env
const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER, 
    database: process.env.DB_NAME,
    options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    // نجعلها true فقط إذا لم نكن في بيئة الإنتاج الحقيقية
    trustServerCertificate: process.env.NODE_ENV !== 'production', 
    enableArithAbort: true
}
};

// إنشاء "مسبح اتصال" (Connection Pool) لضمان السرعة وعدم قطع الاتصال
const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('✅ Connected to SQL Server (AdrenalineWeb) Successfully!');
        return pool;
    })
    .catch(err => {
        console.error('❌ Database Connection Failed! Error: ', err);
    });

module.exports = {
    sql,
    poolPromise
};