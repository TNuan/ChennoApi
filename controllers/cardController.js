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
        // Nếu có column_id mới, có thể là đang di chuyển card sang column khác
        let isMovingCard = false;
        let oldColumnId = null;
        let oldBoardId = null;
        let newBoardId = null;
        
        if (column_id) {
            // Kiểm tra xem column_id có thay đổi không và lấy board_id cũ
            const cardQuery = await pool.query(
                `SELECT c.column_id, b.id as board_id 
                 FROM cards c
                 JOIN columns col ON c.column_id = col.id
                 JOIN boards b ON col.board_id = b.id
                 WHERE c.id = $1`,
                [id]
            );
            
            if (cardQuery.rows.length > 0) {
                oldColumnId = cardQuery.rows[0].column_id;
                oldBoardId = cardQuery.rows[0].board_id;
                isMovingCard = (oldColumnId != column_id);
                
                // Nếu đang di chuyển card, lấy board_id mới
                if (isMovingCard) {
                    const newColumnQuery = await pool.query(
                        `SELECT board_id FROM columns WHERE id = $1`,
                        [column_id]
                    );
                    
                    if (newColumnQuery.rows.length > 0) {
                        newBoardId = newColumnQuery.rows[0].board_id;
                    }
                }
            }
        }

        const card = await CardModel.updateCard(id, userId, { 
            title, description, position, column_id, assigned_to, due_date,
            cover_img, status, priority_level, difficulty_level, resolved_at
        });
        
        if (!card) {
            return res.status(403).json({ message: 'Card không tồn tại hoặc bạn không có quyền cập nhật' });
        }
        
        // Lấy thông tin board_id mới sau khi cập nhật
        const currentBoardQuery = await pool.query(
            `SELECT b.id FROM boards b
             JOIN columns c ON b.id = c.board_id
             JOIN cards card ON c.id = card.column_id
             WHERE card.id = $1`,
            [id]
        );
        
        const currentBoardId = currentBoardQuery.rows[0]?.id;
        
        if (socketIO) {
            // Trường hợp di chuyển card giữa các board khác nhau
            if (isMovingCard && oldBoardId && newBoardId && oldBoardId !== newBoardId) {
                console.log(`Di chuyển card ${id} từ board ${oldBoardId} sang board ${newBoardId}`);

                // Emit sự kiện xóa card ở board cũ
                emitBoardChange(socketIO, oldBoardId, 'card_remove', { 
                    card_id: id, 
                    column_id: oldColumnId 
                }, userId);
                
                // Emit sự kiện thêm card mới ở board mới
                emitBoardChange(socketIO, newBoardId, 'card_created', card, userId);
            } 
            // Trường hợp di chuyển trong cùng một board hoặc cập nhật card thông thường
            else if (currentBoardId) {
                if (isMovingCard) {
                    // Emit sự kiện card_moved nếu card đã được di chuyển giữa các columns
                    emitBoardChange(socketIO, currentBoardId, 'card_moved', { 
                        card, 
                        from_column_id: oldColumnId,
                        to_column_id: column_id
                    }, userId);
                } else {
                    // Emit sự kiện card_updated thông thường
                    emitBoardChange(socketIO, currentBoardId, 'card_updated', card, userId);
                }
            }
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

const copyCard = async (req, res) => {
    const { id } = req.params; // Card ID cần copy
    const { target_column_id, copy_labels = false, copy_attachments = false } = req.body;
    const userId = req.user.id;

    try {
        if (!target_column_id) {
            return res.status(400).json({ error: 'Target column ID là bắt buộc' });
        }

        const options = {
            copyLabels: Boolean(copy_labels),
            copyAttachments: Boolean(copy_attachments)
        };

        const newCard = await CardModel.copyCard(id, target_column_id, userId, options);

        // Lấy thông tin board_id để emit thông báo
        const boardQuery = await pool.query(
            `SELECT b.id FROM boards b
             JOIN columns c ON b.id = c.board_id
             WHERE c.id = $1`,
            [target_column_id]
        );

        const boardId = boardQuery.rows[0]?.id;

        if (boardId && socketIO) {
            emitBoardChange(socketIO, boardId, 'card_created', newCard, userId);
        }

        res.status(201).json({ 
            message: 'Copy card thành công', 
            card: newCard 
        });

    } catch (error) {
        console.error('Card copy error:', error);
        res.status(400).json({ error: error.message });
    }
};

const archiveCard = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const archivedCard = await CardModel.archiveCard(id, userId);
        
        // Emit socket event cho real-time update
        if (archivedCard.board_id && socketIO) {
            emitBoardChange(socketIO, archivedCard.board_id, 'card_archived', {
                card_id: parseInt(id),
                column_id: archivedCard.column_id
            }, userId);
        }
        
        res.json({ 
            message: 'Archive card thành công',
            card: archivedCard
        });
    } catch (error) {
        console.error('Card archive error:', error);
        res.status(400).json({ error: error.message });
    }
};

const unarchiveCard = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const unarchivedCard = await CardModel.unarchiveCard(id, userId);
        
        // Emit socket event cho real-time update
        if (unarchivedCard.board_id && socketIO) {
            emitBoardChange(socketIO, unarchivedCard.board_id, 'card_unarchived', unarchivedCard, userId);
        }
        
        res.json({ 
            message: 'Unarchive card thành công',
            card: unarchivedCard
        });
    } catch (error) {
        console.error('Card unarchive error:', error);
        res.status(400).json({ error: error.message });
    }
};

export const CardController = {
    create,
    getAll,
    getById,
    getCardDetails,
    update,
    remove,
    copyCard,
    archiveCard,     // Thêm function mới
    unarchiveCard,   // Thêm function mới
};