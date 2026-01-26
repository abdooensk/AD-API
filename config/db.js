const sql = require('mssql');
require('dotenv').config();

// قراءة الإعدادات من ملف .env
const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER, 
    database: process.env.DB_NAME,
    options: {
        encrypt: false, // اجعله true إذا كنت تستخدم Azure Cloud
        trustServerCertificate: true, // ضروري جداً للاتصال المحلي (Localhost)
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
        process.exit(1); // إيقاف السيرفر في حال فشل الاتصال
    });

module.exports = {
    sql,
    poolPromise
};