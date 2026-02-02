const { poolPromise } = require('../config/db');

// رفع تقرير سري عن لاعب مشبوه
exports.submitReport = async (req, res) => {
    const { suspectNickname, reason, evidenceLink } = req.body; // evidenceLink: رابط فيديو/صورة
    const investigatorId = req.user.userId;

    try {
        const pool = await poolPromise;

        // نحتاج لجدول جديد للتقارير (سننشئه في الأسفل)
        await pool.request()
            .input('inv', investigatorId)
            .input('suspect', suspectNickname)
            .input('reason', reason)
            .input('proof', evidenceLink)
            .query(`
                INSERT INTO AdrenalineWeb.dbo.Web_InvestigatorReports 
                (InvestigatorID, SuspectNickname, Reason, Evidence, Status, ReportDate)
                VALUES (@inv, @suspect, @reason, @proof, 'PENDING', GETDATE())
            `);

        res.json({ status: 'success', message: 'تم رفع التقرير للأدمن بنجاح' });

    } catch (err) {
        res.status(500).json({ message: 'فشل رفع التقرير' });
    }
};

// تفعيل وضع المراقب (Spectator Mode) للمحقق
// هذه الدالة تغير حالة اللاعب في قاعدة البيانات ليتمكن من دخول الغرف الممتلئة كمراقب
exports.toggleSpectatorMode = async (req, res) => {
    const investigatorId = req.user.userId;
    // ملاحظة: هذا يعتمد على وجود عمود مثل IsObserver أو GMMode في السيرفر
    // سنفترض وجود GMGrade الذي يسمح بذلك تلقائياً، أو نمنحه صلاحية مؤقتة
    
    // في أغلب سيرفرات ادرينالين، GMGrade >= 3 يدخل كمراقب تلقائياً
    // لذا هذه الدالة قد تكون مجرد "تأكيد" أو "تسجيل دخول كمحقق"
    
    res.json({ message: 'صلاحيات المراقب مفعلة بحكم رتبتك (Investigator)' });
};
exports.toggleSpectator = async (req, res) => {
    const { mode } = req.body; // 'ON' أو 'OFF'
    const userNo = req.user.userId;

    try {
        const pool = await poolPromise;

        // 1. جلب الرتبة الحالية والرتبة المحفوظة
        const userCheck = await pool.request()
            .input('u', userNo)
            .query("SELECT GMGrade, SavedGrade FROM GameDB.dbo.T_User WHERE UserNo = @u");

        if (userCheck.recordset.length === 0) return res.status(404).json({ message: 'اللاعب غير موجود' });

        const currentGrade = userCheck.recordset[0].GMGrade;
        const savedGrade = userCheck.recordset[0].SavedGrade;

        // === تفعيل وضع المراقبة (ON) ===
        if (mode === 'ON') {
            // إذا كان اللاعب مراقباً بالفعل (Grade 1)
            if (currentGrade === 1) {
                return res.status(400).json({ message: 'أنت في وضع المراقبة بالفعل' });
            }
            
            // التحقق من الصلاحية: يجب أن تكون رتبته أعلى من 1 (وكيل، محقق، مشرف، أدمن)
            // ملاحظة: الوكيل (2) عادة لا يراقب، لكن الشرط هنا مرن (أكبر من 2 للمحققين وفوق)
            if (currentGrade < 3) {
                return res.status(403).json({ message: 'رتبتك الحالية لا تسمح بدخول وضع المراقبة' });
            }

            // الحفظ والتغيير: احفظ الرتبة الحالية في SavedGrade -> اجعل GMGrade = 1
            await pool.request()
                .input('u', userNo)
                .input('backup', currentGrade)
                .query("UPDATE GameDB.dbo.T_User SET GMGrade = 1, SavedGrade = @backup WHERE UserNo = @u");

            return res.json({ 
                status: 'success', 
                message: 'تم تفعيل وضع المراقبة. تم حفظ رتبتك وتغيير صلاحيتك إلى 1.',
                gradeInfo: { original: currentGrade, current: 1 }
            });
        }

        // === إلغاء وضع المراقبة (OFF) ===
        else if (mode === 'OFF') {
            // يجب أن يكون اللاعب حالياً في وضع المراقبة (1)
            if (currentGrade !== 1) {
                return res.status(400).json({ message: 'أنت لست في وضع المراقبة لتقوم بإلغائه' });
            }

            // محاولة استرجاع الرتبة
            let restoreGrade = savedGrade;

            // شبكة أمان: إذا لم نجد رتبة محفوظة (خطأ ما)، نعيده لرتبة "محقق" (3) كحد أدنى آمن
            if (!restoreGrade || restoreGrade < 2) {
                restoreGrade = 3; 
                console.warn(`User ${userNo} lost their saved grade. Defaulting to 3.`);
            }

            // الاسترجاع: أعد GMGrade للقيمة المحفوظة -> صفر SavedGrade
            await pool.request()
                .input('u', userNo)
                .input('original', restoreGrade)
                .query("UPDATE GameDB.dbo.T_User SET GMGrade = @original, SavedGrade = 0 WHERE UserNo = @u");

            return res.json({ 
                status: 'success', 
                message: 'تم الخروج من وضع المراقبة.',
                gradeInfo: { restored: restoreGrade }
            });
        }

        else {
            return res.status(400).json({ message: 'يجب اختيار الوضع: ON أو OFF' });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'حدث خطأ أثناء تغيير الوضع' });
    }
};