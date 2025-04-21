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

        // Tạo board
        const boardQuery = `
            INSERT INTO boards (workspace_id, name, description, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const boardResult = await client.query(boardQuery, [workspace_id, name, description, created_by]);
        const board = boardResult.rows[0];

        // Thêm creator như owner của board
        const memberQuery = `
            INSERT INTO board_members (board_id, user_id, role)
            VALUES ($1, $2, 'owner')
        `;
        await client.query(memberQuery, [board.id, created_by]);

        await client.query('COMMIT');
        return board;
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

const isBoardMember = async (boardId, userId) => {
    const query = `
        SELECT bm.* FROM board_members bm
        WHERE bm.board_id = $1 AND bm.user_id = $2
    `;
    const result = await pool.query(query, [boardId, userId]);
    return result.rows.length > 0;
};

const addBoardMember = async (boardId, userId, role) => {
    const query = `
        INSERT INTO board_members (board_id, user_id, role)
        VALUES ($1, $2, $3)
        RETURNING *
    `;
    const result = await pool.query(query, [boardId, userId, role]);
    return result.rows[0];
};

const getBoardById = async (id, userId) => {
    // Kiểm tra quyền truy cập trước khi lấy board
    const isMember = await isBoardMember(id, userId);
    if (!isMember) {
        return null;
    }

    const query = `
        SELECT b.*, 
               json_agg(DISTINCT bm.*) as members
        FROM boards b
        LEFT JOIN board_members bm ON b.id = bm.board_id
        WHERE b.id = $1
        GROUP BY b.id
    `;
    const result = await pool.query(query, [id]);
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

const getBoardsByUserId = async (userId) => {
    const query = `
        SELECT w.* , json_agg(DISTINCT b.*) as boards FROM workspaces w
        JOIN workspace_members wm ON w.id = wm.workspace_id
        JOIN boards b ON b.workspace_id = w.id
        LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $1
        WHERE wm.user_id = $1
        GROUP BY w.id
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
};

const getRecentlyViewedBoards = async (userId, limit) => {
    const query = `
        SELECT b.* FROM boards b
        JOIN board_views bv ON b.id = bv.board_id
        WHERE bv.user_id = $1
        ORDER BY bv.viewed_at DESC
        LIMIT $2
    `;
    const result = await pool.query(query, [userId, limit]);
    return result.rows;
};

const getAllWorkspacesByUserId = async (userId) => {
    const query = `
        SELECT w.* FROM workspaces w
        JOIN workspace_members wm ON w.id = wm.workspace_id
        WHERE wm.user_id = $1
        ORDER BY w.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
};

const updateBoardView = async (boardId, userId) => {
    const query = `
        INSERT INTO board_views (board_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (board_id, user_id) 
        DO UPDATE SET viewed_at = CURRENT_TIMESTAMP
        RETURNING *
    `;
    const result = await pool.query(query, [boardId, userId]);
    return result.rows[0];
};

export const BoardModel = {
    createBoard,
    getBoardsByWorkspaceId,
    getBoardById,
    updateBoard,
    deleteBoard,
    getBoardsByUserId,
    getRecentlyViewedBoards,
    getAllWorkspacesByUserId,
    isBoardMember,
    addBoardMember,
    updateBoardView
};