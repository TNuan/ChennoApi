import pool from '../config/db.js';

const createWorkspace = async ({ name, description, owner_id }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Tạo workspace
        const workspaceResult = await client.query(
            'INSERT INTO workspaces (name, description, owner_id) VALUES ($1, $2, $3) RETURNING id, name, description, owner_id, created_at',
            [name, description, owner_id]
        );
        const workspace = workspaceResult.rows[0];

        // Thêm owner vào workspace_members với vai trò owner
        await client.query(
            'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
            [workspace.id, owner_id, 'owner']
        );

        await client.query('COMMIT');
        return workspace;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const getWorkspacesByUserId = async (userId) => {
    const result = await pool.query(
        `
        SELECT w.id, w.name, w.description, w.owner_id, w.created_at, wm.role
        FROM workspaces w
        JOIN workspace_members wm ON w.id = wm.workspace_id
        WHERE wm.user_id = $1
        `,
        [userId]
    );
    return result.rows;
};

const getWorkspaceById = async (workspaceId, userId) => {
    const result = await pool.query(
        `
        SELECT w.id, w.name, w.description, w.owner_id, w.created_at
        FROM workspaces w
        JOIN workspace_members wm ON w.id = wm.workspace_id
        WHERE w.id = $1 AND wm.user_id = $2
        `,
        [workspaceId, userId]
    );
    return result.rows[0];
};

const updateWorkspace = async (workspaceId, userId, { name, description }) => {
    const result = await pool.query(
        `
        UPDATE workspaces w
        SET name = $1, description = $2
        FROM workspace_members wm
        WHERE w.id = $3 AND wm.workspace_id = w.id AND wm.user_id = $4 AND wm.role IN ('owner', 'admin')
        RETURNING w.id, w.name, w.description, w.owner_id, w.created_at
        `,
        [name, description, workspaceId, userId]
    );
    return result.rows[0];
};

const deleteWorkspace = async (workspaceId, userId) => {
    const result = await pool.query(
        `
        DELETE FROM workspaces w
        USING workspace_members wm
        WHERE w.id = $1 AND wm.workspace_id = w.id AND wm.user_id = $2 AND wm.role = 'owner'
        RETURNING w.id
        `,
        [workspaceId, userId]
    );
    return result.rows[0];
};

const addMember = async (workspaceId, userId, invitedUserId, role = 'member') => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Kiểm tra xem user có quyền mời (owner hoặc admin)
        const permissionResult = await client.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role IN (\'owner\', \'admin\')',
            [workspaceId, userId]
        );
        if (!permissionResult.rows[0]) {
            throw new Error('Bạn không có quyền mời thành viên');
        }

        // Kiểm tra xem invitedUserId tồn tại trong users
        const userExists = await client.query('SELECT id FROM users WHERE id = $1', [invitedUserId]);
        if (!userExists.rows[0]) {
            throw new Error('Người dùng không tồn tại');
        }

        // Thêm thành viên
        const result = await client.query(
            'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *',
            [workspaceId, invitedUserId, role]
        );

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const addMembers = async (workspaceId, userId, invitedUserIds, role = 'member') => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check inviter permission (owner or admin)
        const permissionResult = await client.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role IN (\'owner\', \'admin\')',
            [workspaceId, userId]
        );
        if (!permissionResult.rows[0]) {
            throw new Error('Bạn không có quyền mời thành viên');
        }

        // Check if workspace exists
        const workspaceResult = await client.query(
            'SELECT name FROM workspaces WHERE id = $1',
            [workspaceId]
        );
        if (!workspaceResult.rows[0]) {
            throw new Error('Workspace không tồn tại');
        }
        const workspaceName = workspaceResult.rows[0].name;

        // Check if all invited users exist
        const userIds = Array.isArray(invitedUserIds) ? invitedUserIds : [invitedUserIds];
        const usersResult = await client.query(
            'SELECT id, username FROM users WHERE id = ANY($1)',
            [userIds]
        );
        if (usersResult.rows.length !== userIds.length) {
            throw new Error('Một số người dùng không tồn tại');
        }

        // Insert multiple members
        const values = userIds.map((_, index) => 
            `($1, $${index + 2}, $${userIds.length + 2})`
        ).join(',');

        const params = [workspaceId, ...userIds, role];

        const result = await client.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role)
             VALUES ${values}
             ON CONFLICT (workspace_id, user_id) DO NOTHING
             RETURNING *`,
            params
        );

        // Get member details with user information
        const membersResult = await client.query(
            `SELECT wm.*, u.username, u.email 
             FROM workspace_members wm
             JOIN users u ON wm.user_id = u.id
             WHERE wm.id = ANY($1)`,
            [result.rows.map(r => r.id)]
        );

        await client.query('COMMIT');
        return {
            addedMembers: membersResult.rows,
            workspaceName
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const removeMember = async (workspaceId, userId, memberId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Kiểm tra quyền owner/admin
        const permissionResult = await client.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role IN (\'owner\', \'admin\')',
            [workspaceId, userId]
        );
        if (!permissionResult.rows[0]) {
            throw new Error('Bạn không có quyền xóa thành viên');
        }

        // Không cho phép owner xóa chính mình
        if (memberId == userId && permissionResult.rows[0].role === 'owner') {
            throw new Error('Owner không thể tự xóa mình');
        }

        const result = await client.query(
            'DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING *',
            [workspaceId, memberId]
        );

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const getMembers = async (workspaceId, userId) => {
    // Kiểm tra xem user có trong workspace không
    const accessResult = await pool.query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
    );
    if (!accessResult.rows[0]) {
        throw new Error('Bạn không có quyền xem thành viên');
    }

    const result = await pool.query(
        `
        SELECT wm.user_id, u.username, u.email, wm.role, wm.joined_at
        FROM workspace_members wm
        JOIN users u ON wm.user_id = u.id
        WHERE wm.workspace_id = $1
        `,
        [workspaceId]
    );
    return result.rows;
};

const updateMemberRole = async (workspaceId, userId, memberId, newRole) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Kiểm tra quyền owner/admin
        const permissionResult = await client.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role IN (\'owner\', \'admin\')',
            [workspaceId, userId]
        );
        if (!permissionResult.rows[0]) {
            throw new Error('Bạn không có quyền cập nhật vai trò');
        }

        // Không cho phép thay đổi vai trò của owner
        const memberResult = await client.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [workspaceId, memberId]
        );
        if (memberResult.rows[0]?.role === 'owner') {
            throw new Error('Không thể thay đổi vai trò của owner');
        }

        const result = await client.query(
            'UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3 RETURNING *',
            [newRole, workspaceId, memberId]
        );

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

export const WorkspaceModel =  {
    createWorkspace,
    getWorkspacesByUserId,
    getWorkspaceById,
    updateWorkspace,
    deleteWorkspace,
    addMember,
    addMembers,
    removeMember,
    getMembers,
    updateMemberRole,
};