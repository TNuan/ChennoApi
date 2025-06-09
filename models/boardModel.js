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
            INSERT INTO boards (workspace_id, name, description, created_by, cover_img)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, workspace_id, name, description, created_by, created_at, updated_at, cover_img
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
        SELECT b.id, b.workspace_id, b.name, b.description, b.created_at, b.cover_img, (bf.id IS NOT NULL) as is_favorite
        FROM boards b
        LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $2
        LEFT JOIN board_favorites bf ON b.id = bf.board_id AND bf.user_id = $2
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
    return result.rows[0];
};

const isAccessibleBoard = async (boardId, userId) => {
    const query = `
        SELECT b.* FROM boards b
        LEFT JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        LEFT JOIN board_members bm ON b.id = bm.board_id
        WHERE b.id = $1 AND wm.user_id = $2
        AND (b.visibility = 1 OR bm.user_id = $2)
    `;
    const result = await pool.query(query, [boardId, userId]);
    return result.rows.length > 0;
}

// Thêm tham số addedBy vào hàm để biết ai là người thêm
const addBoardMember = async (boardId, userId, role, addedBy) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Lấy workspace_id của board
        const boardQuery = `SELECT workspace_id FROM boards WHERE id = $1`;
        const boardResult = await client.query(boardQuery, [boardId]);
        
        if (boardResult.rows.length === 0) {
            throw new Error('Board không tồn tại');
        }
        
        const workspaceId = boardResult.rows[0].workspace_id;
        
        // Kiểm tra xem user đã là thành viên workspace chưa
        const workspaceMemberQuery = `
            SELECT 1 FROM workspace_members 
            WHERE workspace_id = $1 AND user_id = $2
        `;
        const workspaceMemberResult = await client.query(workspaceMemberQuery, [workspaceId, userId]);
        
        // Nếu chưa là thành viên workspace
        if (workspaceMemberResult.rows.length === 0) {
            // Kiểm tra quyền của người thêm trong workspace
            const requesterRoleQuery = `
                SELECT role FROM workspace_members 
                WHERE workspace_id = $1 AND user_id = $2
            `;
            const requesterRoleResult = await client.query(requesterRoleQuery, [workspaceId, addedBy]);
            
            if (requesterRoleResult.rows.length === 0) {
                throw new Error('Người thêm không phải là thành viên workspace');
            }
            
            const requesterRole = requesterRoleResult.rows[0].role;
            
            // Chỉ owner và admin mới có quyền thêm thành viên vào workspace
            if (!['owner', 'admin'].includes(requesterRole)) {
                throw new Error('Bạn không có quyền thêm thành viên vào workspace này');
            }
            
            // Thêm người dùng vào workspace với role 'member'
            const addWorkspaceMemberQuery = `
                INSERT INTO workspace_members (workspace_id, user_id, role)
                VALUES ($1, $2, 'member')
            `;
            await client.query(addWorkspaceMemberQuery, [workspaceId, userId]);
        }
        
        // Thêm user vào board
        const addBoardMemberQuery = `
            INSERT INTO board_members (board_id, user_id, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (board_id, user_id) DO UPDATE
            SET role = $3
            RETURNING *
        `;
        const result = await client.query(addBoardMemberQuery, [boardId, userId, role]);
        
        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const getBoardById = async (id, userId) => {
    // Kiểm tra quyền truy cập trước khi lấy board
    const isAccessible = await isAccessibleBoard(id, userId);
    if (!isAccessible) {
        throw new Error('Bạn không có quyền xem thành viên');
    }

    const query = `
        SELECT 
            b.*, 
            (bf.id IS NOT NULL) as is_favorite,
            (SELECT bm.role FROM board_members bm WHERE bm.board_id = b.id AND bm.user_id = $2) as user_role,
            
            COALESCE(
                json_agg(
                    json_build_object(
                        'user_id', bm.user_id,
                        'board_id', bm.board_id,
                        'role', bm.role,
                        'joined_at', bm.joined_at,
                        'username', u.username,
                        'email', u.email,
                        'avatar', u.avatar,
                        'full_name', u.full_name,
                        'is_current_user', (bm.user_id = $2)
                    )
                ) FILTER (WHERE bm.user_id IS NOT NULL),
                '[]'
            ) as members
        FROM boards b
        LEFT JOIN board_members bm ON b.id = bm.board_id
        LEFT JOIN users u ON bm.user_id = u.id
        LEFT JOIN board_favorites bf ON b.id = bf.board_id AND bf.user_id = $2
        WHERE b.id = $1
        GROUP BY b.id, bf.id
    `;
    
    const result = await pool.query(query, [id, userId]);
    return result.rows[0];
};

const updateBoard = async (boardId, userId, { workspace_id, name, description, cover_img, visibility }) => {
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
                description = COALESCE($3, b.description),
                cover_img = COALESCE($4, b.cover_img),
                visibility = COALESCE($5, b.visibility)
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
            [workspace_id, name, description, cover_img, visibility, boardId, userId]
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
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const boardCheck = await client.query(`SELECT 1 FROM boards WHERE id = $1`, [boardId]);
        if (!boardCheck.rows[0]) {
            throw new Error('Board không tồn tại');
        }

        const favoriteCheck = await client.query(`SELECT id FROM board_favorites WHERE board_id = $1 AND user_id = $2`, [boardId, userId]);

        let result;
        if (favoriteCheck.rows[0]) {
            result = await client.query(
                `DELETE FROM board_favorites WHERE board_id = $1 AND user_id = $2 RETURNING false as is_favorite`, [boardId, userId]
            );
        } else {
            result = await client.query(
                `INSERT INTO board_favorites (board_id, user_id) VALUES ($1, $2) RETURNING true as is_favorite`, [boardId, userId]
            );
        }

        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
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
                        'is_favorite', (bf.id IS NOT NULL),
                        'viewed_at', bv.viewed_at,
                        'role', bm.role
                    ) ORDER BY b.created_at DESC
                ) FILTER (WHERE b.id IS NOT NULL AND (b.visibility = 1 OR bm.user_id = $1)),
                '[]'
            ) as boards
        FROM workspaces w
        JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.user_id = $1
        LEFT JOIN boards b ON b.workspace_id = w.id
        LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $1
        LEFT JOIN board_views bv ON b.id = bv.board_id AND bv.user_id = $1
        LEFT JOIN board_favorites bf ON b.id = bf.board_id AND bf.user_id = $1
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
        SELECT 
            b.*,
            true as is_favorite,
            bf.created_at as favorited_at,
            CASE 
                WHEN bm.user_id IS NOT NULL THEN true 
                ELSE false 
            END as is_member
        FROM boards b
        JOIN board_favorites bf ON b.id = bf.board_id
        LEFT JOIN board_members bm ON b.id = bm.board_id AND bm.user_id = $1
        WHERE bf.user_id = $1
        ORDER BY bf.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
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

const updateBoardMember = async (boardId, userId, newRole, requesterId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Kiểm tra xem người thực hiện yêu cầu có quyền không
        const requesterRoleQuery = `
            SELECT role FROM board_members 
            WHERE board_id = $1 AND user_id = $2
        `;
        const requesterRoleResult = await client.query(requesterRoleQuery, [boardId, requesterId]);
        
        if (requesterRoleResult.rows.length === 0) {
            throw new Error('Bạn không phải là thành viên của board này');
        }
        
        const requesterRole = requesterRoleResult.rows[0].role;
        if (requesterRole !== 'owner' && requesterRole !== 'admin') {
            throw new Error('Bạn không có quyền cập nhật vai trò thành viên');
        }
        
        // Kiểm tra người bị cập nhật vai trò có phải là owner không
        const targetRoleQuery = `
            SELECT role FROM board_members 
            WHERE board_id = $1 AND user_id = $2
        `;
        const targetRoleResult = await client.query(targetRoleQuery, [boardId, userId]);
        
        if (targetRoleResult.rows.length === 0) {
            throw new Error('Thành viên không tồn tại trong board');
        }
        
        const targetRole = targetRoleResult.rows[0].role;
        
        // Chỉ owner mới có thể thay đổi role của một người khác thành owner
        if (newRole === 'owner' && requesterRole !== 'owner') {
            throw new Error('Chỉ owner mới có thể chỉ định owner mới');
        }
        
        // Chỉ owner mới có thể thay đổi role của owner khác
        if (targetRole === 'owner' && requesterRole !== 'owner') {
            throw new Error('Chỉ owner mới có thể thay đổi vai trò của owner khác');
        }
        
        // Cập nhật vai trò thành viên
        const updateQuery = `
            UPDATE board_members 
            SET role = $3 
            WHERE board_id = $1 AND user_id = $2 
            RETURNING *
        `;
        const result = await client.query(updateQuery, [boardId, userId, newRole]);
        
        // Nếu thay đổi owner, chuyển người request từ owner thành admin
        if (newRole === 'owner' && requesterRole === 'owner' && requesterId !== userId) {
            await client.query(
                `UPDATE board_members SET role = 'admin' WHERE board_id = $1 AND user_id = $2`,
                [boardId, requesterId]
            );
        }
        
        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const removeBoardMember = async (boardId, userId, requesterId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Kiểm tra xem người thực hiện yêu cầu có quyền không
        const requesterRoleQuery = `
            SELECT role FROM board_members 
            WHERE board_id = $1 AND user_id = $2
        `;
        const requesterRoleResult = await client.query(requesterRoleQuery, [boardId, requesterId]);
        
        if (requesterRoleResult.rows.length === 0) {
            throw new Error('Bạn không phải là thành viên của board này');
        }
        
        const requesterRole = requesterRoleResult.rows[0].role;
        
        // Nếu tự rời board, cho phép mọi role
        if (requesterId === userId) {
            // Owner không thể tự rời nếu là owner duy nhất
            if (requesterRole === 'owner') {
                const ownerCountQuery = `
                    SELECT COUNT(*) as owner_count 
                    FROM board_members 
                    WHERE board_id = $1 AND role = 'owner'
                `;
                const ownerCountResult = await client.query(ownerCountQuery, [boardId]);
                
                if (ownerCountResult.rows[0].owner_count <= 1) {
                    throw new Error('Bạn là owner duy nhất của board. Vui lòng chỉ định owner mới trước khi rời board.');
                }
            }
        } else {
            // Nếu xóa người khác, phải là admin hoặc owner
            if (requesterRole !== 'owner' && requesterRole !== 'admin') {
                throw new Error('Bạn không có quyền xóa thành viên');
            }
            
            // Kiểm tra role của người bị xóa
            const targetRoleQuery = `
                SELECT role FROM board_members 
                WHERE board_id = $1 AND user_id = $2
            `;
            const targetRoleResult = await client.query(targetRoleQuery, [boardId, userId]);
            
            if (targetRoleResult.rows.length === 0) {
                throw new Error('Thành viên không tồn tại trong board');
            }
            
            const targetRole = targetRoleResult.rows[0].role;
            
            // Admin không thể xóa owner và admin khác
            if (requesterRole === 'admin' && (targetRole === 'owner' || targetRole === 'admin')) {
                throw new Error('Admin không thể xóa owner hoặc admin khác');
            }
        }
        
        // Xóa thành viên
        const deleteQuery = `
            DELETE FROM board_members 
            WHERE board_id = $1 AND user_id = $2 
            RETURNING *
        `;
        const result = await client.query(deleteQuery, [boardId, userId]);
        
        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
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
    updateBoardView,
    updateBoardMember,    // Thêm method mới
    removeBoardMember     // Thêm method mới
};