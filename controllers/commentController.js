import { CommentModel } from '../models/commentModel.js';
import { socketIO } from '../index.js';
import { emitBoardChange } from '../services/socketService.js';
import pool from '../config/db.js';

const create = async (req, res) => {
    const { card_id, content, parent_id } = req.body;
    const user_id = req.user.id;
    
    try {
        const comment = await CommentModel.addComment({ card_id, user_id, content, parent_id });
        
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
                card_id,
                comment
            }, user_id);
        }
        
        res.status(201).json({ message: 'Thêm bình luận thành công', comment });
    } catch (error) {
        res.status(400).json({ message: error.message });
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