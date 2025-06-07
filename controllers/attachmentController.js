import { AttachmentModel } from '../models/attachmentModel.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { socketIO } from '../index.js';
import { emitBoardChange } from '../services/socketService.js';
import pool from '../config/db.js';
import { NotificationService } from '../services/notificationService.js';

// Cấu hình lưu trữ file
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads', 'card-attachments');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    // Cho phép các loại file thông dụng
    const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain', 'application/json', 'application/xml'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Loại file không được hỗ trợ'), false);
    }
};

const uploadMiddleware = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
}).single('file');

const upload = async (req, res) => {
    try {
        const { card_id } = req.body;
        const uploaded_by = req.user.id;
        
        if (!req.file) {
            return res.status(400).json({ message: 'Không có tệp được tải lên' });
        }
        
        const { filename, originalname, mimetype, size, path } = req.file;
        
        const attachment = await AttachmentModel.addAttachment({
            card_id,
            file_name: originalname,
            file_path: path,
            file_type: mimetype,
            file_size: size,
            uploaded_by
        });
        
        // Lấy thông tin board để emit thông báo
        const boardQuery = await pool.query(
            `SELECT b.id FROM cards c
             JOIN columns col ON c.column_id = col.id
             JOIN boards b ON col.board_id = b.id
             WHERE c.id = $1`,
            [card_id]
        );
        
        const boardId = boardQuery.rows[0]?.id;

        if (boardId && socketIO) {
            emitBoardChange(socketIO, boardId, 'attachment_added', {
                attachment,
                card_id
            }, uploaded_by);
        }
        
        // Gửi notifications cho watchers
        await sendAttachmentWatcherNotifications(card_id, uploaded_by, originalname);

        res.status(201).json({ message: 'Tải tệp lên thành công', attachment });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getAll = async (req, res) => {
    const { card_id } = req.params;
    const userId = req.user.id;
    
    try {
        const attachments = await AttachmentModel.getCardAttachments(card_id, userId);
        res.json({ message: 'Lấy danh sách tệp đính kèm thành công', attachments });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// Cập nhật hàm remove trong attachmentController.js
const remove = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    try {
        const result = await AttachmentModel.deleteAttachment(id, userId);
        console.log('Attachment removal result:', result);
        
        // Lấy thông tin board để emit thông báo
        const boardQuery = await pool.query(
            `SELECT b.id FROM cards c
             JOIN columns col ON c.column_id = col.id
             JOIN boards b ON col.board_id = b.id
             WHERE c.id = $1`,
            [result.card_id]
        );
        
        const boardId = boardQuery.rows[0]?.id;
        
        if (boardId && socketIO) {
            emitBoardChange(socketIO, boardId, 'attachment_removed', {
                card_id: result.card_id,
                attachment_id: id
            }, userId);
        }
        
        res.json({ message: 'Xóa tệp đính kèm thành công' });
    } catch (error) {
        console.error('Error removing attachment:', error);
        res.status(400).json({ message: error.message });
    }
};

// Thêm vào AttachmentController
const download = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    try {
        // Lấy thông tin attachment và kiểm tra quyền
        const client = await pool.connect();
        
        const attachmentQuery = await client.query(
            `SELECT ca.*, c.id as card_id 
             FROM card_attachments ca
             JOIN cards c ON ca.card_id = c.id
             WHERE ca.id = $1 AND ca.is_deleted = false`,
            [id]
        );
        
        if (attachmentQuery.rows.length === 0) {
            client.release();
            return res.status(404).json({ message: 'Tệp đính kèm không tồn tại' });
        }
        
        const attachment = attachmentQuery.rows[0];
        
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN board_members bm ON b.id = bm.board_id
            WHERE c.id = $1 AND bm.user_id = $2`,
            [attachment.card_id, userId]
        );
        
        client.release();
        
        if (permissionCheck.rows.length === 0) {
            return res.status(403).json({ message: 'Không có quyền tải xuống tệp này' });
        }
        
        // Kiểm tra file có tồn tại
        if (!fs.existsSync(attachment.file_path)) {
            return res.status(404).json({ message: 'Tệp không tồn tại trên server' });
        }
        
        // Set headers và gửi file
        res.setHeader('Content-Disposition', `attachment; filename="${attachment.file_name}"`);
        res.setHeader('Content-Type', attachment.file_type || 'application/octet-stream');
        
        const fileStream = fs.createReadStream(attachment.file_path);
        fileStream.pipe(res);
        
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ message: 'Lỗi server khi tải xuống tệp' });
    }
};

// Helper function để gửi notifications cho watchers khi có attachment mới - OPTIMIZED
const sendAttachmentWatcherNotifications = async (cardId, actorUserId, fileName) => {
    try {
        // Lấy thông tin card và actor
        const cardQuery = await pool.query(
            `SELECT c.title, u.username as actor_username
             FROM cards c, users u
             WHERE c.id = $1 AND u.id = $2`,
            [cardId, actorUserId]
        );

        if (cardQuery.rows.length === 0) return;

        const card = cardQuery.rows[0];
        const actorUsername = card.actor_username;

        // Lấy danh sách watchers (trừ người upload)
        const watchersQuery = await pool.query(
            `SELECT user_id FROM card_watchers
             WHERE card_id = $1 AND user_id != $2`,
            [cardId, actorUserId]
        );

        if (watchersQuery.rows.length === 0) return;

        const message = `${actorUsername} added an attachment "${fileName}" to card "${card.title}"`;
        const title = 'New Attachment';

        // Sử dụng bulk notification thay vì vòng lặp
        await NotificationService.createAndSendBulkNotifications({
            sender_id: actorUserId,
            receiver_ids: watchersQuery.rows.map(watcher => watcher.user_id),
            title: title,
            content: message,
            type: 'card_watch',
            entity_type: 'card',
            entity_id: cardId
        });

    } catch (error) {
        console.error('Error sending attachment watcher notifications:', error);
    }
};

// Cập nhật export
export const AttachmentController = {
    upload,
    getAll,
    remove,
    download
};