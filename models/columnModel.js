import pool from '../config/db.js';

const createColumn = async ({ board_id, name, position, created_by }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Kiểm tra user có trong workspace chứa board
        const accessResult = await client.query(
            `
            SELECT 1
            FROM workspace_members wm
            JOIN boards b ON b.workspace_id = wm.workspace_id
            WHERE b.id = $1 AND wm.user_id = $2
            `,
            [board_id, created_by]
        );
        if (!accessResult.rows[0]) {
            throw new Error('Bạn không có quyền tạo column trong board này');
        }

        const result = await client.query(
            'INSERT INTO columns (board_id, name, position, created_by) VALUES ($1, $2, $3, $4) RETURNING id, board_id, name, position, created_by, created_at',
            [board_id, name, position || 0, created_by]
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

const getColumnsByBoardId = async (board_id, userId) => {
    const result = await pool.query(
        `
        SELECT c.id, c.board_id, c.name, c.position, c.created_by, c.created_at
        FROM columns c
        JOIN boards b ON c.board_id = b.id
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE c.board_id = $1 AND wm.user_id = $2
        ORDER BY c.position, c.created_at
        `,
        [board_id, userId]
    );
    return result.rows;
};

const getColumnById = async (columnId, userId) => {
    const result = await pool.query(
        `
        SELECT c.id, c.board_id, c.name, c.position, c.created_by, c.created_at
        FROM columns c
        JOIN boards b ON c.board_id = b.id
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE c.id = $1 AND wm.user_id = $2
        `,
        [columnId, userId]
    );
    return result.rows[0];
};

const updateColumn = async (columnId, userId, { name, position }) => {
    const result = await pool.query(
        `
        UPDATE columns c
        SET name = $1, position = COALESCE($2, c.position)
        FROM boards b
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE c.id = $3 AND c.board_id = b.id AND wm.user_id = $4 AND wm.role IN ('owner', 'admin')
        RETURNING c.id, c.board_id, c.name, c.position, c.created_by, c.created_at
        `,
        [name, position, columnId, userId]
    );
    return result.rows[0];
};

const deleteColumn = async (columnId, userId) => {
    const result = await pool.query(
        `
        DELETE FROM columns c
        USING boards b
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE c.id = $1 AND c.board_id = b.id AND wm.user_id = $2 AND wm.role IN ('owner', 'admin')
        RETURNING c.id
        `,
        [columnId, userId]
    );
    return result.rows[0];
};

export const ColumnModel = {
    createColumn,
    getColumnsByBoardId,
    getColumnById,
    updateColumn,
    deleteColumn,
};