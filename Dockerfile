# استخدام نسخة خفيفة من Node.js
FROM node:20-slim
# إنشاء مجلد التطبيق
WORKDIR /usr/src/app

# نسخ ملفات تعريف الحزم أولاً
COPY package*.json ./

# تثبيت الحزم (هذه الخطوة ستتم داخل بيئة لينكس وهي الحل لمشكلتك)
RUN npm install --omit=dev

# نسخ باقي ملفات المشروع
COPY . .

# فتح المنفذ
EXPOSE 8080

# أمر تشغيل التطبيق
CMD [ "node", "server.js" ]