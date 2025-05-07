import { NotificationModel } from '../models/notificationModel.js';
import { HttpStatusCode } from '../utils/constants.js';

const getNotifications = async (req, res) => {
    console.log('getNotifications called with userId:', req.user.id);
    const userId = req.user.id;
    const { limit, offset, unread } = req.query;

    try {
        const notifications = await NotificationModel.getUserNotifications(userId, {
            limit: parseInt(limit) || 20,
            offset: parseInt(offset) || 0,
            unreadOnly: unread === 'true'
        });

        const unreadCount = await NotificationModel.getUnreadCount(userId);

        res.json({
            status: true,
            message: 'Lấy danh sách thông báo thành công',
            unreadCount,
            notifications
        });
    } catch (err) {
        res.status(400).json({
            status: false,
            message: err.message
        });
    }
};

const markAsRead = async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    try {
        const notification = await NotificationModel.markAsRead(id, userId);
        if (!notification) {
            return res.status(404).json({
                status: false,
                message: 'Không tìm thấy thông báo'
            });
        }

        res.status(HttpStatusCode.OK).json({
            status: true,
            message: 'Đánh dấu đã đọc thành công',
            notification
        });
    } catch (err) {
        res.status(400).json({
            status: false,
            message: err.message
        });
    }
};

const markAllAsRead = async (req, res) => {
    const userId = req.user.id;

    try {
        await NotificationModel.markAllAsRead(userId);
        res.json({
            status: true,
            message: 'Đánh dấu tất cả đã đọc thành công'
        });
    } catch (err) {
        res.status(400).json({
            status: false,
            message: err.message
        });
    }
};

const createNotification = async (req, res) => {
    const sender_id = req.user.id;
    const { receiver_id, title, content, type, entity_type, entity_id } = req.body;

    try {
        if (!receiver_id || !title || !content || !type) {
            return res.status(400).json({
                status: false,
                message: 'Thiếu thông tin bắt buộc'
            });
        }

        const notification = await NotificationModel.createNotification({
            sender_id,
            receiver_id,
            title,
            content,
            type,
            entity_type,
            entity_id
        });

        res.status(201).json({
            status: true,
            message: 'Tạo thông báo thành công',
            notification
        });
    } catch (err) {
        res.status(400).json({
            status: false,
            message: err.message
        });
    }
};

const createBulkNotifications = async (req, res) => {
    const sender_id = req.user.id;
    const { receiver_ids, title, content, type, entity_type, entity_id } = req.body;

    try {
        // Validate input
        if (!receiver_ids || !Array.isArray(receiver_ids) || receiver_ids.length === 0) {
            return res.status(400).json({
                status: false,
                message: 'Danh sách người nhận không hợp lệ'
            });
        }

        if (!title || !content || !type) {
            return res.status(400).json({
                status: false,
                message: 'Thiếu thông tin bắt buộc'
            });
        }

        const notifications = await NotificationModel.createBulkNotifications({
            sender_id,
            receiver_ids,
            title,
            content,
            type,
            entity_type,
            entity_id
        });

        res.status(201).json({
            status: true,
            message: 'Tạo thông báo thành công',
            notifications
        });
    } catch (err) {
        res.status(400).json({
            status: false,
            message: err.message
        });
    }
};

export const NotificationController = {
    createNotification,
    getNotifications,
    markAsRead,
    markAllAsRead,
    createBulkNotifications
};