import { ColumnModel } from '../models/columnModel.js';

const create = async (req, res) => {
    const { board_id, title } = req.body;
    console.log('board_id', board_id);
    console.log('title', title);
    const created_by = req.user.id;

    try {
        const column = await ColumnModel.createColumn({ board_id, title, created_by });
        res.status(201).json({ message: 'Tạo column thành công', column });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getAll = async (req, res) => {
    const { board_id } = req.params;
    const userId = req.user.id;

    try {
        const columns = await ColumnModel.getColumnsByBoardId(board_id, userId);
        res.json({ message: 'Lấy danh sách columns thành công', columns });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const column = await ColumnModel.getColumnById(id, userId);
        if (!column) {
            return res.status(404).json({ message: 'Column không tồn tại hoặc bạn không có quyền truy cập' });
        }
        res.json({ message: 'Lấy column thành công', column });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const update = async (req, res) => {
    const { id } = req.params;
    const { title, position } = req.body;
    const userId = req.user.id;

    try {
        const column = await ColumnModel.updateColumn(id, userId, { title, position });
        if (!column) {
            return res.status(403).json({ message: 'Column không tồn tại hoặc bạn không có quyền cập nhật' });
        }
        res.json({ message: 'Cập nhật column thành công', column });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const remove = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const column = await ColumnModel.deleteColumn(id, userId);
        if (!column) {
            return res.status(403).json({ message: 'Column không tồn tại hoặc bạn không có quyền xóa' });
        }
        res.json({ message: 'Xóa column thành công' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

export const ColumnController = {
    create,
    getAll,
    getById,
    update,
    remove,
};