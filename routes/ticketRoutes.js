const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const authMiddleware = require('../middleware/authMiddleware');

// 👇 التعديل هنا: استيراد uploadTicket فقط
const { uploadTicket } = require('../utils/uploadConfig'); 

router.use(authMiddleware);

// 👇 التعديل هنا: استخدام uploadTicket بدلاً من upload
// 'image' هو اسم الحقل المتوقع من الفرونت إند
router.post('/create', uploadTicket.single('image'), ticketController.createTicket);
router.post('/:id/reply', uploadTicket.single('image'), ticketController.replyToTicket);

router.get('/my-tickets', ticketController.getMyTickets);
router.get('/:id', ticketController.getTicketDetails);

module.exports = router;