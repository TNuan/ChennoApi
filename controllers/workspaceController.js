import { WorkspaceModel } from '../models/workspaceModel.js';
import { NotificationModel } from '../models/notificationModel.js';

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
        const member = await WorkspaceModel.addMember(id, inviterId, userId, role);
        if (!member) {
            return res.status(400).json({ message: 'Thành viên đã tồn tại trong workspace' });
        }
        res.json({ message: 'Mời thành viên thành công', member });
    } catch (err) {
        res.status(400).json({ message: err.message });
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

        const result = await WorkspaceModel.addMembers(id, inviterId, userIds, role);
        
        // Create notifications for invited members
        const notifications = await NotificationModel.createBulkNotifications({
            sender_id: inviterId,
            receiver_ids: Array.isArray(userIds) ? userIds : [userIds],
            title: 'Lời mời tham gia workspace',
            content: `Bạn đã được thêm vào workspace "${result.workspaceName}"`,
            type: 'workspace_invitation',
            entity_type: 'workspace',
            entity_id: id
        });

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
        const member = await WorkspaceModel.removeMember(id, removerId, userId);
        if (!member) {
            return res.status(404).json({ message: 'Thành viên không tồn tại trong workspace' });
        }
        res.json({ message: 'Xóa thành viên thành công' });
    } catch (err) {
        res.status(400).json({ message: err.message });
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
            return res.status(400).json({ message: 'Vai trò không hợp lệ' });
        }
        const member = await WorkspaceModel.updateMemberRole(id, updaterId, userId, role);
        if (!member) {
            return res.status(404).json({ message: 'Thành viên không tồn tại trong workspace' });
        }
        res.json({ message: 'Cập nhật vai trò thành công', member });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

export const WorkspaceController =  { 
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