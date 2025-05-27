import { CardModel } from '../models/cardModel.js';
import { socketIO } from '../index.js'; // Để dùng socket.io
import { emitBoardChange } from '../services/socketService.js';
import pool from '../config/db.js';

const create = async (req, res) => {
  try {
    const userId = req.user.id;
    const { column_id, title, description, assigned_to, due_date, status, priority_level, difficulty_level } = req.body;
    
    if (!column_id || !title) {
      return res.status(400).json({ error: 'Column ID và tiêu đề là bắt buộc' });
    }
    
    // Không cần truyền position vào model, model sẽ tự tính
    const newCard = await CardModel.createCard({
      column_id,
      title,
      description,
      created_by: userId,
      assigned_to,
      due_date,
      status,
      priority_level,
      difficulty_level
      // Không truyền position
    });
    
    res.status(201).json({ card: newCard });

    // Lấy thông tin board_id để emit thông báo
    const boardQuery = await pool.query(
        `SELECT b.id FROM boards b
            JOIN columns c ON b.id = c.board_id
            WHERE c.id = $1`,
        [column_id]
    );
    
    const boardId = boardQuery.rows[0]?.id;
    
    if (boardId && socketIO) {
        emitBoardChange(socketIO, boardId, 'card_created', newCard, userId);
    }
    
    
  } catch (error) {
    console.error('Card creation error:', error);
    res.status(400).json({ error: error.message });
  }
};

const getAll = async (req, res) => {
    const { column_id } = req.params;
    const userId = req.user.id;

    try {
        const cards = await CardModel.getCardsByColumnId(column_id, userId);
        res.json({ message: 'Lấy danh sách cards thành công', cards });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const card = await CardModel.getCardById(id, userId);
        if (!card) {
            return res.status(404).json({ message: 'Card không tồn tại hoặc bạn không có quyền truy cập' });
        }
        res.json({ message: 'Lấy card thành công', card });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getCardDetails = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const cardDetails = await CardModel.getCardDetails(id, userId);
        res.json({ message: 'Lấy chi tiết card thành công', card: cardDetails });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const update = async (req, res) => {
    const { id } = req.params;
    const { 
        title, description, position, column_id, assigned_to, due_date,
        cover_img, status, priority_level, difficulty_level, resolved_at
    } = req.body;
    const userId = req.user.id;

    try {
        console.log('Updating card with ID:', id);
        console.log('Request body:', cover_img);
        const card = await CardModel.updateCard(id, userId, { 
            title, description, position, column_id, assigned_to, due_date,
            cover_img, status, priority_level, difficulty_level, resolved_at
        });
        
        if (!card) {
            return res.status(403).json({ message: 'Card không tồn tại hoặc bạn không có quyền cập nhật' });
        }
        
        // Lấy thông tin board_id để emit thông báo
        const boardQuery = await pool.query(
            `SELECT b.id FROM boards b
             JOIN columns c ON b.id = c.board_id
             JOIN cards card ON c.id = card.column_id
             WHERE card.id = $1`,
            [id]
        );
        
        const boardId = boardQuery.rows[0]?.id;
        
        if (boardId && socketIO) {
            emitBoardChange(socketIO, boardId, 'card_update', card, userId);
        }
        
        res.json({ message: 'Cập nhật card thành công', card });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const remove = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        // Lấy thông tin board_id để emit thông báo sau khi xóa
        const boardQuery = await pool.query(
            `SELECT b.id, card.column_id FROM boards b
             JOIN columns c ON b.id = c.board_id
             JOIN cards card ON c.id = card.column_id
             WHERE card.id = $1`,
            [id]
        );
        
        const boardInfo = boardQuery.rows[0];
        
        const card = await CardModel.deleteCard(id, userId);
        if (!card) {
            return res.status(403).json({ message: 'Card không tồn tại hoặc bạn không có quyền xóa' });
        }
        
        if (boardInfo && socketIO) {
            emitBoardChange(socketIO, boardInfo.id, 'card_remove', { 
                id, 
                column_id: boardInfo.column_id 
            }, userId);
        }
        
        res.json({ message: 'Xóa card thành công' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

export const CardController = {
    create,
    getAll,
    getById,
    getCardDetails,
    update,
    remove,
};