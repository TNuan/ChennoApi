import pool from '../config/db.js';

const createBoard = async ({ workspace_id, name, description, created_by, cover_img }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');        
        const workspaceResult = await client.query(
            'SELECT 1 FROM workspaces WHERE id = $1',
            [workspace_id]
        );
        if (!workspaceResult.rows[0]) {
            throw new Error('Workspace không tồn tại');
        }

        const accessResult = await client.query(
            'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [workspace_id, created_by]
        );

        if (!accessResult.rows[0]) {
            throw new Error('Bạn không có quyền tạo board trong workspace này');
        }

        const boardQuery = `
            INSERT INTO boards (
                workspace_id, 
                name, 
                description, 
                created_by,
                cover_img,
                is_favorite
            )
            VALUES ($1, $2, $3, $4, $5, FALSE)
            RETURNING 
                id,
                workspace_id,
                name,
                description,
                created_by,
                created_at,
                updated_at,
                cover_img,
                is_favorite
        `;
        const boardResult = await client.query(boardQuery, [
            workspace_id, 
            name, 
            description, 
            created_by,
            cover_img,
            // is_favorite mặc định là false
        ]);
        const board = boardResult.rows[0];

        const memberQuery = `
            INSERT INTO board_members (board_id, user_id, role)
            VALUES ($1, $2, 'owner')
            RETURNING *
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
        SELECT b.id, b.workspace_id, b.name, b.description, b.created_at, b.cover_img, bm.is_favorite
        FROM boards b
        JOIN board_members bm ON b.id = bm.board_id
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE b.workspace_id = $1 AND wm.user_id = $2 AND (b.visibility = 1 OR bm.user_id = $2)
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

const updateBoard = async (boardId, userId, { workspace_id, name, description, cover_img }) => {
    // Start a transaction since we're checking workspace membership
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if user has access to target workspace if workspace_id is provided
        if (workspace_id) {
            const workspaceAccessCheck = await client.query(
                `SELECT 1 FROM workspace_members 
                 WHERE workspace_id = $1 AND user_id = $2`,
                [workspace_id, userId]
            );
            if (!workspaceAccessCheck.rows[0]) {
                throw new Error('Bạn không có quyền chuyển board đến workspace này');
            }
        }

        // Update board with all possible fields
        const result = await client.query(
            `
            UPDATE boards b
            SET 
                workspace_id = COALESCE($1, b.workspace_id),
                name = COALESCE($2, b.name),
                description = $3,
                cover_img = $4,
            FROM board_members bm
            WHERE b.id = $6 
            AND bm.board_id = b.id 
            AND bm.user_id = $7 
            AND bm.role IN ('owner', 'admin')
            RETURNING 
                b.id, 
                b.workspace_id, 
                b.name, 
                b.description, 
                b.cover_img,
                b.created_by, 
                b.created_at,
                b.updated_at
            `,
            [workspace_id, name, description, cover_img, boardId, userId]
        );

        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const toggleFavoriteBoard = async (boardId, userId) => {
    const query = `
        UPDATE board_members
        SET is_favorite = NOT is_favorite
        WHERE board_id = $1 AND user_id = $2
        RETURNING is_favorite
    `;
    const result = await pool.query(query, [boardId, userId]);
    console.log('ádf',result.rows[0]);
    return result.rows[0];
}

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

const getAllBoardsByUserId = async (userId) => {
    const query = `
        SELECT w.id, w.name, w.description, w.owner_id, w.created_at, wm.role,
            COALESCE(
                json_agg(
                    jsonb_build_object(
                        'id', b.id,
                        'name', b.name,
                        'description', b.description,
                        'created_by', b.created_by,
                        'created_at', b.created_at,
                        'updated_at', b.updated_at,
                        'cover_img', b.cover_img,
                        'is_favorite', bm.is_favorite,
                        'viewed_at', bv.viewed_at
                    ) ORDER BY b.created_at DESC
                ) FILTER (WHERE b.id IS NOT NULL AND (b.visibility = 1 OR bm.user_id = $1)),
                '[]'
            ) as boards
        FROM workspaces w
        JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.user_id = $1
        LEFT JOIN boards b ON b.workspace_id = w.id
        LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $1
        LEFT JOIN board_views bv ON b.id = bv.board_id AND bv.user_id = $1
        WHERE wm.user_id = $1
        GROUP BY 
            w.id, 
            w.name, 
            w.description, 
            w.owner_id, 
            w.created_at,
            wm.role,
            wm.joined_at
        ORDER BY wm.joined_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
};

const getRecentlyViewedBoards = async (userId, limit) => {
    const query = `
        SELECT b.*, bv.viewed_at FROM boards b
        JOIN board_views bv ON b.id = bv.board_id
        WHERE bv.user_id = $1
        ORDER BY bv.viewed_at DESC
        LIMIT $2
    `;
    const result = await pool.query(query, [userId, limit]);
    return result.rows;
};

const getFavoriteBoards = async (userId) => {
    const query = `
        SELECT b.*, bm.is_favorite FROM boards b
        JOIN board_members bm ON b.id = bm.board_id
        WHERE bm.user_id = $1 AND bm.is_favorite = TRUE
        ORDER BY b.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
}

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
    getAllBoardsByUserId,
    getRecentlyViewedBoards,
    getFavoriteBoards,
    toggleFavoriteBoard,
    getAllWorkspacesByUserId,
    isBoardMember,
    addBoardMember,
    updateBoardView
};