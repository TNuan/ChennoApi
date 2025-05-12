import { BoardModel } from '../models/boardModel.js';
import { socketIO } from '../index.js';
import { emitBoardChange, notifyUser } from '../services/socketService.js';
import { ColumnModel } from '../models/columnModel.js';
import { NotificationService } from '../services/notificationService.js';

const create = async (req, res) => {
    const { workspace_id, name, description, cover_img } = req.body;
    const created_by = req.user.id;

    try {
        // Check required fields
        if (!workspace_id || !name) {
            return res.status(400).json({ message: 'Workspace ID và tên board là bắt buộc' });
        }
        const board = await BoardModel.createBoard({ 
            workspace_id, 
            name, 
            description: description || null, 
            created_by,
            cover_img: cover_img || null
        });

        // Thông báo cho các thành viên workspace về board mới
        emitBoardChange(socketIO, workspace_id, 'add_board', board, created_by);

        res.status(201).json({ status: true, message: 'Tạo board thành công', board });
    } catch (err) {
        res.status(400).json({ status: false, message: err.message });
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
        board.columns = await ColumnModel.getColumnsByBoardId(id, userId) || [];
        board.user_getting = userId; 
        // Cập nhật board_views
        await BoardModel.updateBoardView(id, userId);
        
        // Không cần thiết gọi emitOnlineUsers ở đây vì frontend sẽ gọi
        // join_board khi vào board, và hàm đó đã xử lý việc gửi danh sách
        
        res.json({ message: 'Lấy board thành công', board });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const update = async (req, res) => {
    const { id } = req.params;
    const { workspace_id, name, description, cover_img, visibility } = req.body;
    const userId = req.user.id;

    try {
        const board = await BoardModel.updateBoard(id, userId, { workspace_id, name, description, cover_img, visibility });

        if (!board) {
            return res.status(403).json({ 
                message: 'Board không tồn tại hoặc bạn không có quyền cập nhật' 
            });
        }

        // Thông báo cập nhật board cho tất cả thành viên
        emitBoardChange(socketIO, id, 'update_board', board, userId);

        res.json({ 
            message: 'Cập nhật board thành công', 
            board 
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const toggleFavoriteBoard = async (req, res) => {
    const { board_id } = req.params;
    const userId = req.user.id;

    try {
        const board = await BoardModel.toggleFavoriteBoard(board_id, userId);
        if (!board) {
            return res.status(403).json({ message: 'Board không tồn tại hoặc bạn không có quyền cập nhật' });
        }
        res.json({ 
            message: 'Cập nhật trạng thái yêu thích board thành công', 
            is_favorite: board.is_favorite 
        });
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

        // Thông báo xóa board cho tất cả thành viên
        emitBoardChange(socketIO, id, 'delete_board', { id }, userId);

        res.json({ message: 'Xóa board thành công' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getBoardsByUser = async (req, res) => {
    const userId = req.user.id;

    try {
        const listBoards = await BoardModel.getAllBoardsByUserId(userId);
        res.json({ message: 'Lấy danh sách boards thành công', listBoards });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getRecentlyViewedBoards = async (req, res) => {
    console.log('req.user', req.user.id);
    const userId = req.user.id;
    const limit = req.query.limit || 10; // Default limit 10 boards

    try {
        const boards = await BoardModel.getRecentlyViewedBoards(userId, limit);
        res.json({ message: 'Lấy danh sách boards gần đây thành công', boards });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getFavoriteBoards = async (req, res) => {
    const userId = req.user.id;

    try {
        const boards = await BoardModel.getFavoriteBoards(userId);
        res.json({ message: 'Lấy danh sách boards yêu thích thành công', boards });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
}

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
        if (!isMember.role || (isMember.role !== 'admin' && isMember.role !== 'owner')) {
            return res.status(403).json({ 
                message: 'Bạn không có quyền thêm thành viên vào board này' 
            });
        }

        // Thêm thành viên vào board (và tự động thêm vào workspace nếu cần)
        // Truyền thêm requestUserId để kiểm tra quyền thêm vào workspace
        const member = await BoardModel.addBoardMember(board_id, user_id, role, requestUserId);
        
        // Lấy thông tin board để thông báo
        const board = await BoardModel.getBoardById(board_id, requestUserId);
        
        // Tạo thông báo và gửi qua socket
        await NotificationService.createAndSendNotification({
            sender_id: requestUserId,
            receiver_id: user_id,
            title: 'Lời mời tham gia board mới',
            content: `Bạn đã được thêm vào board "${board.name}" với vai trò ${role}`,
            type: 'board_invitation',
            entity_type: 'board',
            entity_id: board_id
        });
        
        // Thông báo cho tất cả thành viên hiện tại về thành viên mới
        emitBoardChange(socketIO, board_id, 'add_member', {
            board_id,
            user_id,
            role,
            added_by: requestUserId,
            // Thêm thông tin về board và workspace để frontend cập nhật đúng
            board_name: board.name,
            workspace_id: board.workspace_id
        }, requestUserId);
        
        res.json({ 
            message: 'Thêm thành viên vào board thành công', 
            member,
            workspace_id: board.workspace_id  // Trả về workspace_id để client biết user đã được thêm vào workspace nào
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const updateMember = async (req, res) => {
    const { board_id, user_id } = req.params;
    const { role } = req.body;
    const requestUserId = req.user.id;

    try {
        // Validate role
        const validRoles = ['owner', 'admin', 'member', 'observer'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ 
                message: 'Vai trò không hợp lệ. Vai trò phải là một trong: owner, admin, member, observer' 
            });
        }

        // Cập nhật vai trò
        const member = await BoardModel.updateBoardMember(board_id, user_id, role, requestUserId);
        
        // Thông báo thay đổi vai trò cho tất cả thành viên
        emitBoardChange(socketIO, board_id, 'update_member', {
            board_id,
            user_id,
            role,
            updated_by: requestUserId
        }, requestUserId);
        
        // Thông báo riêng cho người bị thay đổi vai trò
        await NotificationService.createAndSendNotification({
            sender_id: requestUserId,
            receiver_id: user_id,
            title: 'Vai trò của bạn đã được thay đổi',
            content: `Vai trò của bạn trong board đã được thay đổi thành ${role}`,
            type: 'role_changed',
            entity_type: 'board',
            entity_id: board_id
        });
        
        res.json({ 
            message: 'Cập nhật vai trò thành viên thành công', 
            member 
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const removeMember = async (req, res) => {
    const { board_id, user_id } = req.params;
    const requestUserId = req.user.id;

    try {
        // Xóa thành viên
        const member = await BoardModel.removeBoardMember(board_id, user_id, requestUserId);
        
        // Thông báo xóa thành viên cho tất cả thành viên
        emitBoardChange(socketIO, board_id, 'remove_member', {
            board_id,
            user_id,
            removed_by: requestUserId
        }, requestUserId);
        
        // Nếu không phải tự rời board, gửi thông báo cho người bị xóa
        if (requestUserId !== user_id) {
            await NotificationService.createAndSendNotification({
                sender_id: requestUserId,
                receiver_id: user_id,
                title: 'Bạn đã bị xóa khỏi board',
                content: `Bạn đã bị xóa khỏi board`,
                type: 'member_removed',
                entity_type: 'board',
                entity_id: board_id
            });
        }
        
        res.json({ 
            message: requestUserId === user_id ? 'Rời board thành công' : 'Xóa thành viên thành công',
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
    toggleFavoriteBoard,
    getFavoriteBoards,
    getAllWorkspaces,
    addMember,
    updateMember,    // Thêm controller method mới
    removeMember     // Thêm controller method mới
};