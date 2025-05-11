// Thêm vào đầu file
import pool from '../config/db.js';

// Socket service giúp gửi thông báo qua socket từ các controller

/**
 * Gửi thông báo thay đổi board đến tất cả người dùng đang xem board
 * @param {object} io - Instance Socket.IO
 * @param {string} boardId - ID của board
 * @param {string} changeType - Loại thay đổi (add_column, update_column, delete_column, add_card, etc)
 * @param {object} payload - Dữ liệu thay đổi
 * @param {string} excludeUserId - ID của người dùng sẽ không nhận thông báo (thường là người thực hiện thay đổi)
 */
export const emitBoardChange = (io, boardId, changeType, payload, excludeUserId) => {
    const excludeSocketId = getUserSocketId(io, excludeUserId);
    
    // Chỉ gửi đến các socket khác, không gửi đến người thay đổi
    if (excludeSocketId) {
        // Sử dụng socket.to() thay vì io.to() để loại trừ người gửi
        io.in(`board:${boardId}`).except(excludeSocketId).emit('board_updated', {
            changeType,
            payload,
            senderId: excludeUserId,
            senderSocketId: excludeSocketId
        });
    } else {
        // Nếu không tìm thấy socket ID, gửi cho tất cả (nhưng trường hợp này hiếm khi xảy ra)
        io.to(`board:${boardId}`).emit('board_updated', {
            changeType,
            payload,
            senderId: excludeUserId
        });
    }
};

/**
 * Gửi thông báo riêng đến một người dùng
 * @param {object} io - Instance Socket.IO
 * @param {string} userId - ID của người dùng nhận thông báo
 * @param {string} eventName - Tên sự kiện
 * @param {object} data - Dữ liệu gửi kèm
 */
export const notifyUser = (io, userId, eventName, data) => {
    const userSocketId = getUserSocketId(io, userId);
    if (userSocketId) {
        io.to(userSocketId).emit(eventName, data);
    }
};

/**
 * Lấy socketId của người dùng theo userId
 * @param {object} io - Instance Socket.IO
 * @param {string} userId - ID của người dùng
 * @returns {string|null} - Socket ID hoặc null nếu không tìm thấy
 */
export const getUserSocketId = (io, userId) => {
    let foundSocketId = null;
    
    io.sockets.sockets.forEach((socket) => {
        if (socket.user && socket.user.id === userId) {
            foundSocketId = socket.id;
        }
    });
    
    return foundSocketId;
};

/**
 * Kiểm tra xem người dùng có đang online không
 * @param {object} io - Instance Socket.IO
 * @param {string} userId - ID của người dùng
 * @returns {boolean} - true nếu online, false nếu offline
 */
export const isUserOnline = (io, userId) => {
    return getUserSocketId(io, userId) !== null;
};

/**
 * Lấy danh sách người dùng đang xem một board
 * @param {object} io - Instance Socket.IO
 * @param {string} boardId - ID của board
 * @returns {Array} - Mảng các đối tượng user đang xem board
 */
export const getUsersInBoard = (io, boardId) => {
    const room = io.sockets.adapter.rooms.get(`board:${boardId}`);
    if (!room) return [];
    
    const users = [];
    const seenUserIds = new Set(); // To prevent duplicates
    
    room.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.user && !seenUserIds.has(socket.user.id)) {
            seenUserIds.add(socket.user.id);
            // Include more complete user information
            users.push({
                id: socket.user.id,
                name: socket.user.name || socket.user.username,
                email: socket.user.email,
                avatar: socket.user.avatar
            });
        }
    });
    
    console.log(`Users in board ${boardId}:`, users);
    return users;
};

/**
 * Gửi danh sách người dùng đang online trong một board
 * @param {object} io - Instance Socket.IO
 * @param {string} boardId - ID của board
 */
export const sendOnlineUsers = (io, boardId) => {
    const onlineUsers = getUsersInBoard(io, boardId);
    console.log('Online users in boardưedsd:', onlineUsers);
    io.to(`board:${boardId}`).emit('online_users', {
        boardId,
        users: onlineUsers
    });
};

/**
 * Gửi thông báo mới đến người dùng
 * @param {object} io - Instance Socket.IO
 * @param {string} userId - ID của người dùng nhận thông báo
 * @param {object} notification - Đối tượng thông báo
 */
export const sendNotification = (io, userId, notification) => {
    // Sử dụng hàm đã được export từ index.js
    import('../index.js').then(module => {
        module.emitNotification(userId, notification);
    });
};

/**
 * Gửi cập nhật số lượng thông báo chưa đọc
 * @param {object} io - Instance Socket.IO
 * @param {string} userId - ID của người dùng
 * @param {number} count - Số lượng thông báo chưa đọc
 */
export const sendUnreadCount = (io, userId, count) => {
    notifyUser(io, userId, 'unread_count', { count });
};

/**
 * Gửi thông báo thay đổi workspace đến tất cả thành viên
 * @param {object} io - Instance Socket.IO
 * @param {string} workspaceId - ID của workspace
 * @param {string} changeType - Loại thay đổi (add_member, remove_member, update_member, etc)
 * @param {object} payload - Dữ liệu thay đổi
 * @param {string} excludeUserId - ID của người dùng sẽ không nhận thông báo (thường là người thực hiện thay đổi)
 */
export const emitWorkspaceChange = async (io, workspaceId, changeType, payload, excludeUserId) => {
    try {
        // Lấy danh sách thành viên workspace
        const memberQuery = `
            SELECT user_id 
            FROM workspace_members 
            WHERE workspace_id = $1
        `;
        const client = await pool.connect();
        const memberResult = await client.query(memberQuery, [workspaceId]);
        client.release();
        
        const members = memberResult.rows;
        
        // Gửi thông báo đến từng thành viên (trừ người gửi)
        members.forEach(member => {
            if (member.user_id !== excludeUserId) {
                notifyUser(io, member.user_id, 'workspace_updated', {
                    changeType,
                    payload,
                    workspaceId
                });
            }
        });
    } catch (error) {
        console.error('Error emitting workspace change:', error);
    }
};