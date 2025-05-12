import pool from '../config/db.js';

// Thêm bình luận vào card
const addComment = async ({ card_id, user_id, content, parent_id = null }) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN board_members bm ON b.id = bm.board_id
            WHERE c.id = $1 AND bm.user_id = $2
            UNION
            SELECT 'member' as role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
            WHERE c.id = $1 AND wm.user_id = $2`,
            [card_id, user_id]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền bình luận trong card này');
        }

        // Kiểm tra parent_id nếu có
        if (parent_id) {
            const parentCheck = await client.query(
                `SELECT * FROM card_comments WHERE id = $1 AND card_id = $2`,
                [parent_id, card_id]
            );
            
            if (parentCheck.rows.length === 0) {
                throw new Error('Bình luận gốc không tồn tại hoặc không thuộc card này');
            }
        }

        const result = await client.query(
            `INSERT INTO card_comments (card_id, user_id, content, parent_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [card_id, user_id, content, parent_id]
        );

        // Lấy thông tin người dùng
        const userInfo = await client.query(
            `SELECT id, username, email FROM users WHERE id = $1`,
            [user_id]
        );

        const comment = {
            ...result.rows[0],
            user: userInfo.rows[0]
        };

        // Ghi lại hoạt động
        await client.query(
            `INSERT INTO card_activities (card_id, user_id, activity_type, activity_data)
            VALUES ($1, $2, 'added_comment', $3)`,
            [card_id, user_id, JSON.stringify({ 
                comment_id: comment.id,
                content: content.length > 50 ? content.substring(0, 50) + '...' : content
            })]
        );

        return comment;
    } finally {
        client.release();
    }
};

// Lấy danh sách bình luận của một card
const getCardComments = async (card_id, userId) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN board_members bm ON b.id = bm.board_id
            WHERE c.id = $1 AND bm.user_id = $2
            UNION
            SELECT 'member' as role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
            WHERE c.id = $1 AND wm.user_id = $2
            UNION
            SELECT 'public' as role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            WHERE c.id = $1 AND b.visibility = 1`,
            [card_id, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền xem bình luận của card này');
        }

        const comments = await client.query(
            `SELECT cc.*, u.username, u.email
            FROM card_comments cc
            JOIN users u ON cc.user_id = u.id
            WHERE cc.card_id = $1 AND cc.is_deleted = false
            ORDER BY cc.created_at ASC`,
            [card_id]
        );

        return comments.rows.map(comment => ({
            ...comment,
            user: {
                id: comment.user_id,
                username: comment.username,
                email: comment.email
            }
        }));
    } finally {
        client.release();
    }
};

// Cập nhật bình luận
const updateComment = async (comment_id, userId, { content }) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền
        const commentCheck = await client.query(
            `SELECT * FROM card_comments WHERE id = $1 AND user_id = $2`,
            [comment_id, userId]
        );
        
        if (commentCheck.rows.length === 0) {
            throw new Error('Không có quyền cập nhật bình luận này');
        }
        
        const card_id = commentCheck.rows[0].card_id;

        const result = await client.query(
            `UPDATE card_comments
            SET content = $1, updated_at = CURRENT_TIMESTAMP, is_edited = true
            WHERE id = $2
            RETURNING *`,
            [content, comment_id]
        );

        // Lấy thông tin người dùng
        const userInfo = await client.query(
            `SELECT id, username, email FROM users WHERE id = $1`,
            [userId]
        );

        const comment = {
            ...result.rows[0],
            user: userInfo.rows[0]
        };

        // Ghi lại hoạt động
        await client.query(
            `INSERT INTO card_activities (card_id, user_id, activity_type, activity_data)
            VALUES ($1, $2, 'edited_comment', $3)`,
            [card_id, userId, JSON.stringify({ 
                comment_id,
                content: content.length > 50 ? content.substring(0, 50) + '...' : content
            })]
        );

        return comment;
    } finally {
        client.release();
    }
};

// Xóa bình luận (soft delete)
const deleteComment = async (comment_id, userId) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền - người dùng chỉ có thể xóa bình luận của chính mình hoặc admin/owner của board
        const commentCheck = await client.query(
            `SELECT cc.*, c.id as card_id FROM card_comments cc
            JOIN cards c ON cc.card_id = c.id
            WHERE cc.id = $1`,
            [comment_id]
        );
        
        if (commentCheck.rows.length === 0) {
            throw new Error('Bình luận không tồn tại');
        }
        
        const comment = commentCheck.rows[0];
        const card_id = comment.card_id;
        
        // Kiểm tra xem người dùng có phải là người viết bình luận
        if (comment.user_id !== userId) {
            // Nếu không, kiểm tra xem người dùng có phải là admin/owner của board
            const adminCheck = await client.query(
                `SELECT bm.role FROM cards c
                JOIN columns col ON c.column_id = col.id
                JOIN boards b ON col.board_id = b.id
                JOIN board_members bm ON b.id = bm.board_id
                WHERE c.id = $1 AND bm.user_id = $2 AND bm.role IN ('owner', 'admin')`,
                [card_id, userId]
            );
            
            if (adminCheck.rows.length === 0) {
                throw new Error('Không có quyền xóa bình luận này');
            }
        }

        // Thực hiện soft delete
        await client.query(
            `UPDATE card_comments SET is_deleted = true
            WHERE id = $1`,
            [comment_id]
        );

        // Ghi lại hoạt động
        await client.query(
            `INSERT INTO card_activities (card_id, user_id, activity_type, activity_data)
            VALUES ($1, $2, 'deleted_comment', $3)`,
            [card_id, userId, JSON.stringify({ comment_id })]
        );

        return { card_id };
    } finally {
        client.release();
    }
};

export const CommentModel = {
    addComment,
    getCardComments,
    updateComment,
    deleteComment
};