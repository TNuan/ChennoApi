import { ColumnModel } from '../models/columnModel.js';
import { socketIO } from '../index.js';
import { emitBoardChange } from '../services/socketService.js';

const create = async (req, res) => {
    const { board_id, title } = req.body;
    const created_by = req.user.id;

    try {
        const column = await ColumnModel.createColumn({ board_id, title, created_by });

        // Thông báo cho tất cả người dùng trong board về column mới
        emitBoardChange(socketIO, board_id, 'add_column', column, created_by);

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

        // Thông báo thay đổi cho tất cả người dùng trong board
        // emitBoardChange(socketIO, column.board_id, 'update_column', column, userId);
        if (position !== undefined) { // Nếu có thay đổi vị trí
            const columns = await ColumnModel.getColumnsByBoardId(column.board_id, userId);
            emitBoardChange(socketIO, column.board_id, 'column_order', columns, userId);
        } else { // Nếu chỉ cập nhật title
            emitBoardChange(socketIO, column.board_id, 'column_update', column, userId);
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

        // Thông báo xóa column cho tất cả người dùng trong board
        emitBoardChange(socketIO, column.board_id, 'delete_column', { id }, userId);

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