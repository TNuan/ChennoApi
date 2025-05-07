import express from 'express';
import { NotificationController } from '../controllers/notificationController.js';
import authenticateToken from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', authenticateToken, NotificationController.getNotifications);
router.post('/', authenticateToken, NotificationController.createNotification);
router.patch('/:id/read', authenticateToken, NotificationController.markAsRead);
router.patch('/read-all', authenticateToken, NotificationController.markAllAsRead);
router.post('/bulk', authenticateToken, NotificationController.createBulkNotifications);

export default router;