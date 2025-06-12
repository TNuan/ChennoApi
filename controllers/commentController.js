import { CommentModel } from '../models/commentModel.js';
import { socketIO } from '../index.js';
import { emitBoardChange } from '../services/socketService.js';
import { NotificationService } from '../services/notificationService.js';
import pool from '../config/db.js';

const create = async (req, res) => {
    const { card_id, content, parent_id } = req.body;
    const userId = req.user.id;

    try {
        const newComment = await CommentModel.addComment({ card_id, user_id: userId, content, parent_id });

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
            emitBoardChange(socketIO, boardId, 'comment_added', {
                card_id: newComment.card_id,
                comment: newComment
            }, userId);
        }

        // Gửi notifications cho watchers
        await sendCommentWatcherNotifications(card_id, userId, content);

        res.status(201).json({ message: 'Tạo comment thành công', comment: newComment });
    } catch (error) {
        console.error('Comment creation error:', error);
        res.status(400).json({ error: error.message });
    }
};

// Helper function để gửi notifications cho watchers khi có comment mới - OPTIMIZED
const sendCommentWatcherNotifications = async (cardId, actorUserId, commentContent) => {
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

        // Lấy danh sách watchers (trừ người comment)
        const watchersQuery = await pool.query(
            `SELECT user_id FROM card_watchers
             WHERE card_id = $1 AND user_id != $2`,
            [cardId, actorUserId]
        );

        if (watchersQuery.rows.length === 0) return;

        const message = `${actorUsername} commented on card "${card.title}"`;
        const title = 'New Comment';

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
        console.error('Error sending comment watcher notifications:', error);
    }
};

const getAll = async (req, res) => {
    const { card_id } = req.params;
    const userId = req.user.id;
    
    try {
        const comments = await CommentModel.getCardComments(card_id, userId);
        res.json({ message: 'Lấy danh sách bình luận thành công', comments });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const update = async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.id;
    
    try {
        const comment = await CommentModel.updateComment(id, userId, { content });
        
        // Lấy thông tin board để emit thông báo
        const boardQuery = await pool.query(
            `SELECT b.id FROM cards c
             JOIN columns col ON c.column_id = col.id
             JOIN boards b ON col.board_id = b.id
             WHERE c.id = $1`,
            [comment.card_id]
        );
        
        const boardId = boardQuery.rows[0]?.id;
        
        if (boardId && socketIO) {
            emitBoardChange(socketIO, boardId, 'comment_updated', {
                card_id: comment.card_id,
                comment
            }, userId);
        }
        
        res.json({ message: 'Cập nhật bình luận thành công', comment });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    try {
        const result = await CommentModel.deleteComment(id, userId);
        
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
            emitBoardChange(socketIO, boardId, 'comment_deleted', {
                card_id: result.card_id,
                comment_id: id
            }, userId);
        }
        
        res.json({ message: 'Xóa bình luận thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

export const CommentController = {
    create,
    getAll,
    update,
    remove
};