import { BoardModel } from '../models/boardModel.js';

const create = async (req, res) => {
    const { workspace_id, name, description } = req.body;
    const created_by = req.user.id;

    try {
        const board = await BoardModel.createBoard({ workspace_id, name, description, created_by });
        res.status(201).json({ message: 'Tạo board thành công', board });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getAll = async (req, res) => {
    const { workspace_id } = req.params;
    const userId = req.user.id;

    try {
        const boards = await BoardModel.getBoardsByWorkspaceId(workspace_id, userId);
        res.json({ message: 'Lấy danh sách boards thành công', boards });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const board = await BoardModel.getBoardById(id, userId);
        if (!board) {
            return res.status(404).json({ message: 'Board không tồn tại hoặc bạn không có quyền truy cập' });
        }
        res.json({ message: 'Lấy board thành công', board });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const update = async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    const userId = req.user.id;

    try {
        const board = await BoardModel.updateBoard(id, userId, { name, description });
        if (!board) {
            return res.status(403).json({ message: 'Board không tồn tại hoặc bạn không có quyền cập nhật' });
        }
        res.json({ message: 'Cập nhật board thành công', board });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const remove = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const board = await BoardModel.deleteBoard(id, userId);
        if (!board) {
            return res.status(403).json({ message: 'Board không tồn tại hoặc bạn không có quyền xóa' });
        }
        res.json({ message: 'Xóa board thành công' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

export const BoardController = { create, getAll, getById, update, remove };