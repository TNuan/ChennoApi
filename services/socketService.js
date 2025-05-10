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
    io.to(`board:${boardId}`).emit('board_updated', {
        changeType,
        payload,
        senderId: excludeUserId
    });
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
    room.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.user) {
            users.push({
                id: socket.user.id,
                username: socket.user.username
            });
        }
    });
    
    return users;
};

/**
 * Gửi danh sách người dùng đang online trong một board
 * @param {object} io - Instance Socket.IO
 * @param {string} boardId - ID của board
 */
export const sendOnlineUsers = (io, boardId) => {
    // Sử dụng hàm đã được export từ index.js
    // Sử dụng dynamic import vì có thể có circular dependency
    import('../index.js').then(module => {
        module.emitOnlineUsers(boardId);
    });
};