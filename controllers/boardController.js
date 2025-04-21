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
            return res.status(403).json({ 
                message: 'Bạn không có quyền truy cập board này' 
            });
        }

        // Cập nhật board_views
        await BoardModel.updateBoardView(id, userId);
        
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

const getBoardsByUser = async (req, res) => {
    const userId = req.user.id;

    try {
        const listBoards = await BoardModel.getBoardsByUserId(userId);
        res.json({ message: 'Lấy danh sách boards thành công', listBoards });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getRecentlyViewedBoards = async (req, res) => {
    const userId = req.user.id;
    const limit = req.query.limit || 10; // Default limit 10 boards

    try {
        const boards = await BoardModel.getRecentlyViewedBoards(userId, limit);
        res.json({ message: 'Lấy danh sách boards gần đây thành công', boards });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getAllWorkspaces = async (req, res) => {
    const userId = req.user.id;

    try {
        const workspaces = await BoardModel.getAllWorkspacesByUserId(userId);
        res.json({ message: 'Lấy danh sách workspaces thành công', workspaces });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const addMember = async (req, res) => {
    const { board_id } = req.params;
    const { user_id, role } = req.body;
    const requestUserId = req.user.id;

    try {
        // Kiểm tra người thêm có phải owner/admin của board không
        const isMember = await BoardModel.isBoardMember(board_id, requestUserId);
        if (!isMember) {
            return res.status(403).json({ 
                message: 'Bạn không có quyền thêm thành viên vào board này' 
            });
        }

        const member = await BoardModel.addBoardMember(board_id, user_id, role);
        res.json({ 
            message: 'Thêm thành viên vào board thành công', 
            member 
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

export const BoardController = { 
    create, 
    getAll, 
    getById, 
    update, 
    remove,
    getBoardsByUser,
    getRecentlyViewedBoards,
    getAllWorkspaces,
    addMember
};