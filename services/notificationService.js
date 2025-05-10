import { NotificationModel } from '../models/notificationModel.js';
import { socketIO } from '../index.js';
import { sendNotification, sendUnreadCount } from './socketService.js';

/**
 * Tạo thông báo và gửi qua socket
 * @param {Object} notificationData - Dữ liệu thông báo
 * @returns {Object} - Thông báo đã tạo
 */
export const createAndSendNotification = async (notificationData) => {
    const notification = await NotificationModel.createNotification(notificationData);
    
    // Gửi thông báo qua socket
    sendNotification(socketIO, notificationData.receiver_id, notification);
    
    // Cập nhật số lượng thông báo chưa đọc
    const unreadCount = await NotificationModel.getUnreadCount(notificationData.receiver_id);
    sendUnreadCount(socketIO, notificationData.receiver_id, unreadCount);
    
    return notification;
};

/**
 * Tạo thông báo hàng loạt và gửi qua socket
 * @param {Object} bulkData - Dữ liệu thông báo hàng loạt
 * @returns {Array} - Mảng các thông báo đã tạo
 */
export const createAndSendBulkNotifications = async (bulkData) => {
    const notifications = await NotificationModel.createBulkNotifications(bulkData);
    
    // Gửi thông báo cho từng người nhận
    for (const notification of notifications) {
        sendNotification(socketIO, notification.receiver.id, notification);
        
        // Cập nhật số lượng thông báo chưa đọc
        const unreadCount = await NotificationModel.getUnreadCount(notification.receiver.id);
        sendUnreadCount(socketIO, notification.receiver.id, unreadCount);
    }
    
    return notifications;
};

/**
 * Tạo thông báo cho tất cả thành viên trong board
 * @param {String} boardId - ID của board
 * @param {String} senderId - ID của người gửi
 * @param {String} title - Tiêu đề thông báo
 * @param {String} content - Nội dung thông báo 
 * @param {String} type - Loại thông báo
 * @returns {Array} - Mảng các thông báo đã tạo
 */
export const notifyBoardMembers = async (boardId, senderId, title, content, type) => {
    // Lấy danh sách thành viên trong board (trừ người gửi)
    const members = await getBoardMembersExcept(boardId, senderId);
    
    if (members.length === 0) {
        return [];
    }
    
    return createAndSendBulkNotifications({
        sender_id: senderId,
        receiver_ids: members.map(m => m.user_id),
        title,
        content,
        type,
        entity_type: 'board',
        entity_id: boardId
    });
};

// Hàm helper để lấy danh sách thành viên trong board (trừ một người)
async function getBoardMembersExcept(boardId, excludeUserId) {
    const query = `
        SELECT user_id 
        FROM board_members 
        WHERE board_id = $1 AND user_id != $2
    `;
    const result = await pool.query(query, [boardId, excludeUserId]);
    return result.rows;
}

export const NotificationService = {
    createAndSendNotification,
    createAndSendBulkNotifications,
    notifyBoardMembers
};