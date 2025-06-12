import { LabelModel } from '../models/labelModel.js';
import { socketIO } from '../index.js';
import { emitBoardChange } from '../services/socketService.js';
import pool from '../config/db.js';

const create = async (req, res) => {
    const { board_id, name, color } = req.body;
    const created_by = req.user.id;
    
    try {
        const label = await LabelModel.createLabel({ board_id, name, color, created_by });
        
        if (socketIO) {
            emitBoardChange(socketIO, board_id, 'label_created', label, created_by);
        }
        
        res.status(201).json({ message: 'Tạo nhãn thành công', label });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getAll = async (req, res) => {
    const { board_id } = req.params;
    const userId = req.user.id;
    
    try {
        const labels = await LabelModel.getLabelsByBoardId(board_id, userId);
        res.json({ message: 'Lấy danh sách nhãn thành công', labels });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const update = async (req, res) => {
    const { id } = req.params;
    const { name, color } = req.body;
    const userId = req.user.id;
    
    try {
        const label = await LabelModel.updateLabel(id, userId, { name, color });
        
        // Lấy thông tin board để emit thông báo
        const boardQuery = await pool.query(
            `SELECT board_id FROM labels WHERE id = $1`,
            [id]
        );
        
        const boardId = boardQuery.rows[0]?.board_id;
        
        if (boardId && socketIO) {
            emitBoardChange(socketIO, boardId, 'label_updated', label, userId);
        }
        
        res.json({ message: 'Cập nhật nhãn thành công', label });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    try {
        const result = await LabelModel.deleteLabel(id, userId);
        
        if (socketIO) {
            emitBoardChange(socketIO, result.board_id, 'label_deleted', { id }, userId);
        }
        
        res.json({ message: 'Xóa nhãn thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const addToCard = async (req, res) => {
    const { card_id, label_id } = req.body;
    const userId = req.user.id;
    
    try {
        const result = await LabelModel.addLabelToCard(card_id, label_id, userId);
        
        if (socketIO) {
            emitBoardChange(socketIO, result.board_id, 'label_added_to_card', {
                card_id,
                label: {id: result.label_id, name: result.label_name, color: result.label_color},
            }, userId);
        }
        
        res.json({ message: 'Thêm nhãn vào card thành công', result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const removeFromCard = async (req, res) => {
    const { card_id, label_id } = req.params;
    const userId = req.user.id;
    
    try {
        const result = await LabelModel.removeLabelFromCard(card_id, label_id, userId);
        
        if (socketIO) {
            emitBoardChange(socketIO, result.board_id, 'label_removed_from_card', {
                card_id,
                label_id
            }, userId);
        }
        
        res.json({ message: 'Xóa nhãn khỏi card thành công' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getCardLabels = async (req, res) => {
    const { card_id } = req.params;
    const userId = req.user.id;
    
    try {
        const labels = await LabelModel.getCardLabels(card_id, userId);
        res.json({ message: 'Lấy danh sách nhãn của card thành công', labels });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

export const LabelController = {
    create,
    getAll,
    update,
    remove,
    addToCard,
    removeFromCard,
    getCardLabels
};