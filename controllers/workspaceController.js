import { WorkspaceModel } from '../models/workspaceModel.js';
import { NotificationService } from '../services/notificationService.js';
import { socketIO } from '../index.js';
import { emitWorkspaceChange } from '../services/socketService.js';

const create = async (req, res) => {
    const { name, description } = req.body;
    const owner_id = req.user.id;

    try {
        const workspace = await WorkspaceModel.createWorkspace({ name, description, owner_id });
        res.status(201).json({ message: 'Tạo workspace thành công', workspace });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const getAll = async (req, res) => {
    const userId = req.user.id;

    try {
        const workspaces = await WorkspaceModel.getWorkspacesByUserId(userId);
        res.json({ message: 'Lấy danh sách workspaces thành công', workspaces });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const getById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const workspace = await WorkspaceModel.getWorkspaceById(id, userId);
        if (!workspace) {
            return res.status(404).json({ message: 'Workspace không tồn tại hoặc bạn không có quyền truy cập' });
        }
        res.json({ message: 'Lấy workspace thành công', workspace });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const update = async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    const userId = req.user.id;

    try {
        const workspace = await WorkspaceModel.updateWorkspace(id, userId, { name, description });
        if (!workspace) {
            return res.status(403).json({ message: 'Workspace không tồn tại hoặc bạn không có quyền cập nhật' });
        }
        res.json({ message: 'Cập nhật workspace thành công', workspace });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const remove = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const workspace = await WorkspaceModel.deleteWorkspace(id, userId);
        if (!workspace) {
            return res.status(403).json({ message: 'Workspace không tồn tại hoặc bạn không có quyền xóa' });
        }
        res.json({ message: 'Xóa workspace thành công' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const inviteMember = async (req, res) => {
    const { id } = req.params; // workspaceId
    const { userId, role } = req.body; // userId của người được mời
    const inviterId = req.user.id;

    try {
        // Lấy thông tin workspace trước khi thêm thành viên
        const workspace = await WorkspaceModel.getWorkspaceById(id, inviterId);
        if (!workspace) {
            return res.status(404).json({ 
                status: false,
                message: 'Workspace không tồn tại hoặc bạn không có quyền truy cập' 
            });
        }

        const member = await WorkspaceModel.addMember(id, inviterId, userId, role);
        if (!member) {
            return res.status(400).json({ 
                status: false,
                message: 'Thành viên đã tồn tại trong workspace' 
            });
        }

        // Tạo thông báo và gửi real-time qua socket
        await NotificationService.createAndSendNotification({
            sender_id: inviterId,
            receiver_id: userId,
            title: 'Lời mời tham gia workspace',
            content: `Bạn đã được thêm vào workspace "${workspace.name}" với vai trò ${role}`,
            type: 'workspace_invitation',
            entity_type: 'workspace',
            entity_id: id
        });

        // Thông báo thay đổi qua socket cho tất cả thành viên workspace
        emitWorkspaceChange(socketIO, id, 'add_member', {
            workspace_id: id,
            member
        }, inviterId);

        res.json({ 
            status: true,
            message: 'Mời thành viên thành công', 
            member 
        });
    } catch (err) {
        res.status(400).json({ 
            status: false,
            message: err.message 
        });
    }
};

const inviteMembers = async (req, res) => {
    const { id } = req.params; // workspaceId
    const { userIds, role } = req.body; // single userId or array of userIds
    const inviterId = req.user.id;

    try {
        if (!userIds || (Array.isArray(userIds) && userIds.length === 0)) {
            return res.status(400).json({ 
                status: false,
                message: 'Vui lòng chọn ít nhất một thành viên' 
            });
        }

        // Lấy thông tin workspace
        const workspace = await WorkspaceModel.getWorkspaceById(id, inviterId);
        if (!workspace) {
            return res.status(404).json({ 
                status: false,
                message: 'Workspace không tồn tại hoặc bạn không có quyền truy cập' 
            });
        }

        const result = await WorkspaceModel.addMembers(id, inviterId, userIds, role);
        
        // Tạo thông báo cho từng thành viên được mời và gửi real-time
        await NotificationService.createAndSendBulkNotifications({
            sender_id: inviterId,
            receiver_ids: Array.isArray(userIds) ? userIds : [userIds],
            title: 'Lời mời tham gia workspace',
            content: `Bạn đã được thêm vào workspace "${workspace.name}" với vai trò ${role}`,
            type: 'workspace_invitation',
            entity_type: 'workspace',
            entity_id: id
        });

        // Thông báo thay đổi cho tất cả thành viên workspace
        emitWorkspaceChange(socketIO, id, 'add_members', {
            workspace_id: id,
            members: result.addedMembers
        }, inviterId);

        res.json({ 
            status: true,
            message: 'Mời thành viên thành công', 
            members: result.addedMembers 
        });
    } catch (err) {
        res.status(400).json({ 
            status: false,
            message: err.message 
        });
    }
};

const removeMember = async (req, res) => {
    const { id, userId } = req.params; // id: workspaceId, userId: người bị xóa
    const removerId = req.user.id;

    try {
        // Lấy thông tin workspace và member trước khi xóa
        const workspace = await WorkspaceModel.getWorkspaceById(id, removerId);
        if (!workspace) {
            return res.status(404).json({ 
                status: false,
                message: 'Workspace không tồn tại hoặc bạn không có quyền truy cập' 
            });
        }

        const member = await WorkspaceModel.removeMember(id, removerId, userId);
        if (!member) {
            return res.status(404).json({ 
                status: false,
                message: 'Thành viên không tồn tại trong workspace' 
            });
        }

        // Gửi thông báo cho người bị xóa
        await NotificationService.createAndSendNotification({
            sender_id: removerId,
            receiver_id: userId,
            title: 'Bạn đã bị xóa khỏi workspace',
            content: `Bạn đã bị xóa khỏi workspace "${workspace.name}"`,
            type: 'workspace_removal',
            entity_type: 'workspace',
            entity_id: id
        });

        // Thông báo thay đổi cho tất cả thành viên workspace còn lại
        emitWorkspaceChange(socketIO, id, 'remove_member', {
            workspace_id: id,
            user_id: userId
        }, removerId);

        res.json({ 
            status: true,
            message: 'Xóa thành viên thành công' 
        });
    } catch (err) {
        res.status(400).json({ 
            status: false,
            message: err.message 
        });
    }
};

const getMembersList = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const members = await WorkspaceModel.getMembers(id, userId);
        res.json({ message: 'Lấy danh sách thành viên thành công', members });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const updateMember = async (req, res) => {
    const { id, userId } = req.params;
    const { role } = req.body;
    const updaterId = req.user.id;

    try {
        if (!['admin', 'member'].includes(role)) {
            return res.status(400).json({ 
                status: false,
                message: 'Vai trò không hợp lệ' 
            });
        }

        // Lấy thông tin workspace trước khi cập nhật
        const workspace = await WorkspaceModel.getWorkspaceById(id, updaterId);
        if (!workspace) {
            return res.status(404).json({ 
                status: false,
                message: 'Workspace không tồn tại hoặc bạn không có quyền truy cập' 
            });
        }

        const member = await WorkspaceModel.updateMemberRole(id, updaterId, userId, role);
        if (!member) {
            return res.status(404).json({ 
                status: false,
                message: 'Thành viên không tồn tại trong workspace' 
            });
        }

        // Gửi thông báo cho người được cập nhật vai trò
        await NotificationService.createAndSendNotification({
            sender_id: updaterId,
            receiver_id: userId,
            title: 'Vai trò của bạn đã được cập nhật',
            content: `Vai trò của bạn trong workspace "${workspace.name}" đã được thay đổi thành ${role}`,
            type: 'role_update',
            entity_type: 'workspace',
            entity_id: id
        });

        // Thông báo thay đổi cho tất cả thành viên workspace
        emitWorkspaceChange(socketIO, id, 'update_member', {
            workspace_id: id,
            user_id: userId,
            role
        }, updaterId);

        res.json({ 
            status: true,
            message: 'Cập nhật vai trò thành công', 
            member 
        });
    } catch (err) {
        res.status(400).json({ 
            status: false,
            message: err.message 
        });
    }
};

export const WorkspaceController = { 
    create,
    getAll,
    getById,
    update,
    remove,
    inviteMember,
    inviteMembers,
    removeMember,
    getMembersList,
    updateMember
};