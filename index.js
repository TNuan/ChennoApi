import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import userRoutes from './routes/userRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';
import boardRoutes from './routes/boardRoutes.js';
import columnRoutes from './routes/columnRoutes.js';
import cardRoutes from './routes/cardRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import labelRoutes from './routes/labelRoutes.js';
import attachmentRoutes from './routes/attachmentRoutes.js';
import commentRoutes from './routes/commentRoutes.js';
import cookieParser from 'cookie-parser';
import { sendOnlineUsers } from './services/socketService.js';
import pool from './config/db.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const port = 3000;

// Thiết lập CORS
const corsOptions = {
    origin: 'http://localhost:3001', // URL của React app
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Thiết lập Socket.IO
const io = new Server(httpServer, {
    cors: corsOptions,
    transports: ['websocket', 'polling']
});

// Middleware xác thực Socket.IO
io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
        return next(new Error('Authentication token missing'));
    }
    
    try {
        // Xác thực token
        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        
        // Lấy thông tin user đầy đủ từ database
        const client = await pool.connect();
        const userResult = await client.query(
            'SELECT id, username, email, avatar, full_name FROM users WHERE id = $1',
            [decoded.id]
        );
        client.release();
        
        if (userResult.rows.length === 0) {
            return next(new Error('User not found'));
        }
        
        socket.user = userResult.rows[0];
        next();
    } catch (error) {
        console.error('Socket authentication error:', error);
        return next(new Error('Authentication error'));
    }
});

// Lưu trữ kết nối socket theo userId và boardId
const userSockets = new Map(); // userId -> socketId
const boardRooms = new Map(); // boardId -> Set of userIds

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}, userId: ${socket.user.id}`);
    
    // Lưu socket theo userId
    userSockets.set(socket.user.id, socket.id);
    
    // Thêm xử lý cho thông báo
    // Khi user kết nối, tự động join vào room riêng của họ để nhận thông báo
    socket.join(`user:${socket.user.id}`);
    
    // Xử lý tham gia board
    socket.on('join_board', ({ boardId }) => {
        console.log(`User ${socket.user.id} joined board ${boardId}`);
        
        // Thêm user vào phòng của board
        socket.join(`board:${boardId}`);
        
        // Lưu thông tin user đang ở board nào
        if (!boardRooms.has(boardId)) {
            boardRooms.set(boardId, new Set());
        }
        boardRooms.get(boardId).add(socket.user.id);
        
        // Thông báo cho các thành viên khác
        socket.to(`board:${boardId}`).emit('user_joined', {
            userId: socket.user.id,
            username: socket.user.username
        });
        
        // Gửi danh sách người dùng đang online trong board này
        emitOnlineUsers(boardId);
    });
    
    // Xử lý rời board
    socket.on('leave_board', ({ boardId }) => {
        console.log(`User ${socket.user.id} left board ${boardId}`);
        
        // Xóa user khỏi phòng của board
        socket.leave(`board:${boardId}`);
        
        // Cập nhật thông tin
        if (boardRooms.has(boardId)) {
            boardRooms.get(boardId).delete(socket.user.id);
            if (boardRooms.get(boardId).size === 0) {
                boardRooms.delete(boardId);
            }
        }
        
        // Thông báo cho các thành viên khác
        socket.to(`board:${boardId}`).emit('user_left', {
            userId: socket.user.id
        });
        
        // Gửi lại danh sách người dùng đang online sau khi có người rời đi
        emitOnlineUsers(boardId);
    });
    
    // Thêm sự kiện yêu cầu danh sách người dùng đang online
    socket.on('get_online_users', ({ boardId }) => {
        console.log("Tôi đang ở đây");
        console.log(`User ${socket.user.id} requested online users in board ${boardId}`);
        emitOnlineUsers(boardId);
    });
    
    // Xử lý thay đổi trong board
    socket.on('board_change', ({ boardId, changeType, payload }) => {
        console.log(`Change in board ${boardId}: ${changeType}`);
        
        // Truyền thay đổi đến tất cả người dùng trong board (trừ người gửi)
        socket.to(`board:${boardId}`).emit('board_updated', {
            boardId,
            changeType,
            payload,
            userId: socket.user.id
        });
    });
    
    // Xử lý ngắt kết nối
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // Xóa socket khỏi danh sách
        userSockets.delete(socket.user.id);
        
        // Tìm và thông báo cho các board mà user đang tham gia
        boardRooms.forEach((users, boardId) => {
            if (users.has(socket.user.id)) {
                users.delete(socket.user.id);
                
                // Thông báo cho các thành viên khác
                io.to(`board:${boardId}`).emit('user_left', {
                    userId: socket.user.id
                });
                
                // Gửi lại danh sách người dùng đang online sau khi có người ngắt kết nối
                emitOnlineUsers(boardId);
                
                // Xóa board nếu không còn ai
                if (users.size === 0) {
                    boardRooms.delete(boardId);
                }
            }
        });
    });
});

// Hàm helper để gửi danh sách người dùng đang online trong một board
function emitOnlineUsers(boardId) {
    sendOnlineUsers(io, boardId);
}

// Hàm helper để gửi thông báo đến một user
function emitNotification(userId, notification) {
    io.to(`user:${userId}`).emit('new_notification', notification);
}

// Export socket.io để có thể sử dụng ở các phần khác của ứng dụng
export const socketIO = io;
export { emitOnlineUsers, emitNotification };  // Export để có thể sử dụng ở các services khác

// Các route của API
app.use('/api/users', userRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/columns', columnRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/comments', commentRoutes);

// Thêm middleware để phục vụ các tệp tĩnh
app.use('/uploads', express.static('uploads'));

// Khởi động server
httpServer.listen(port, () => {
  console.log(`Server chạy tại http://localhost:${port}`);
});