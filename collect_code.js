const fs = require('fs');
const path = require('path');

// اسم الملف الناتج
const OUTPUT_FILE = 'project_summary.txt';

// المجلدات والملفات التي نريد تجاهلها (للحفاظ على الخصوصية وعدم تضخيم الملف)
const IGNORE_LIST = [
    'node_modules', 
    '.git', 
    '.env',          // هام جداً للأمان
    'package-lock.json',
    'project_summary.txt',
    'collect_code.js',
    '.vscode',
    'dist',
    'build',
    'logs'
];

// الامتدادات التي نريد قراءتها فقط (Backend Code)
const ALLOWED_EXTENSIONS = ['.js', '.ts', '.json', '.sql'];

function scanDirectory(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        // التحقق من قائمة التجاهل
        if (IGNORE_LIST.some(ignored => filePath.includes(ignored))) {
            return;
        }

        if (stat.isDirectory()) {
            scanDirectory(filePath, fileList);
        } else {
            // نأخذ فقط ملفات الكود
            if (ALLOWED_EXTENSIONS.includes(path.extname(file))) {
                fileList.push(filePath);
            }
        }
    });

    return fileList;
}

function generateSummary() {
    const allFiles = scanDirectory(__dirname);
    let output = `--- PROJECT STRUCTURE & CODE SUMMARY ---\n\n`;

    // 1. أولاً: كتابة شجرة الملفات
    output += `=== FILE TREE ===\n`;
    allFiles.forEach(file => {
        output += `${path.relative(__dirname, file)}\n`;
    });
    output += `\n=========================================\n\n`;

    // 2. ثانياً: كتابة محتوى كل ملف
    allFiles.forEach(file => {
        try {
            const content = fs.readFileSync(file, 'utf8');
            const relativePath = path.relative(__dirname, file);
            
            output += `\nvvvvvvvvvv FILE START: ${relativePath} vvvvvvvvvv\n`;
            output += content;
            output += `\n^^^^^^^^^^ FILE END: ${relativePath} ^^^^^^^^^^\n`;
        } catch (err) {
            output += `\nERROR READING FILE: ${file}\n`;
        }
    });

    fs.writeFileSync(OUTPUT_FILE, output);
    console.log(`✅ Done! All code saved to: ${OUTPUT_FILE}`);
}

generateSummary();