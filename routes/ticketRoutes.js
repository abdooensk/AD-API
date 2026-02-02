const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../utils/uploadConfig'); // 👈 استدعاء إعدادات الرفع

router.use(authMiddleware);

// لاحظ إضافة upload.single('image')
// 'image' هو اسم الحقل الذي يجب أن يستخدمه الفرونت اند (FormData)
router.post('/create', upload.single('image'), ticketController.createTicket);
router.post('/:id/reply', upload.single('image'), ticketController.replyToTicket);

router.get('/my-tickets', ticketController.getMyTickets);
router.get('/:id', ticketController.getTicketDetails);

module.exports = router;