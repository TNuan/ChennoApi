import pool from '../config/db.js';

const createBoard = async ({ workspace_id, name, description, created_by }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Kiểm tra workspace_id có tồn tại không
        const workspaceResult = await client.query(
            'SELECT 1 FROM workspaces WHERE id = $1',
            [workspace_id]
        );
        if (!workspaceResult.rows[0]) {
            throw new Error('Workspace không tồn tại');
        }
        // Kiểm tra user có trong workspace
        const accessResult = await client.query(
            'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [workspace_id, created_by]
        );

        console.log('Access result:', accessResult.rows[0]);
        if (!accessResult.rows[0]) {
            throw new Error('Bạn không có quyền tạo board trong workspace này');
        }

        const result = await client.query(
            'INSERT INTO boards (workspace_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id, workspace_id, name, description, created_by, created_at',
            [workspace_id, name, description, created_by]
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

const getBoardsByWorkspaceId = async (workspace_id, userId) => {
    // Lấy danh sách boards trong workspace
    const result = await pool.query(
        `
        SELECT b.id, b.workspace_id, b.name, b.description, b.created_by, b.created_at
        FROM boards b
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE b.workspace_id = $1 AND wm.user_id = $2
        `,
        [workspace_id, userId]
    );
    return result.rows;
};

const getBoardById = async (boardId, userId) => {
    const result = await pool.query(
        `
        SELECT b.id, b.workspace_id, b.name, b.description, b.created_by, b.created_at
        FROM boards b
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE b.id = $1 AND wm.user_id = $2
        `,
        [boardId, userId]
    );
    return result.rows[0];
};

const updateBoard = async (boardId, userId, { name, description }) => {
    const result = await pool.query(
        `
        UPDATE boards b
        SET name = $1, description = $2
        FROM workspace_members wm
        WHERE b.id = $3 AND b.workspace_id = wm.workspace_id AND wm.user_id = $4 AND wm.role IN ('owner', 'admin')
        RETURNING b.id, b.workspace_id, b.name, b.description, b.created_by, b.created_at
        `,
        [name, description, boardId, userId]
    );
    return result.rows[0];
};

const deleteBoard = async (boardId, userId) => {
    const result = await pool.query(
        `
        DELETE FROM boards b
        USING workspace_members wm
        WHERE b.id = $1 AND b.workspace_id = wm.workspace_id AND wm.user_id = $2 AND wm.role IN ('owner', 'admin')
        RETURNING b.id
        `,
        [boardId, userId]
    );
    return result.rows[0];
};

export const BoardModel = {
    createBoard,
    getBoardsByWorkspaceId,
    getBoardById,
    updateBoard,
    deleteBoard,
};