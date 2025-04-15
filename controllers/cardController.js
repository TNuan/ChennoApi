import { CardModel } from '../models/cardModel.js';

const create = async (req, res) => {
    const { column_id, title, description, position, assigned_to, due_date } = req.body;
    const created_by = req.user.id;

    try {
        const card = await CardModel.createCard({ column_id, title, description, position, created_by, assigned_to, due_date });
        res.status(201).json({ message: 'Tạo card thành công', card });
    } catch (err) {
        res.status(400).json({ message: err.message });
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

const update = async (req, res) => {
    const { id } = req.params;
    const { title, description, position, column_id, assigned_to, due_date } = req.body;
    const userId = req.user.id;

    try {
        const card = await CardModel.updateCard(id, userId, { title, description, position, column_id, assigned_to, due_date });
        if (!card) {
            return res.status(403).json({ message: 'Card không tồn tại hoặc bạn không có quyền cập nhật' });
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
        const card = await CardModel.deleteCard(id, userId);
        if (!card) {
            return res.status(403).json({ message: 'Card không tồn tại hoặc bạn không có quyền xóa' });
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
    update,
    remove,
};