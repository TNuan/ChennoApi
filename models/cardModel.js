import pool from '../config/db.js';

const createCard = async ({ column_id, title, description, position, created_by, assigned_to, due_date }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Kiểm tra user có trong workspace chứa column
        const accessResult = await client.query(
            `
            SELECT 1 
            FROM workspace_members wm
            JOIN boards b ON b.workspace_id = wm.workspace_id
            JOIN columns c ON c.board_id = b.id
            WHERE c.id = $1 AND wm.user_id = $2
            `,
            [column_id, created_by]
        );
        if (!accessResult.rows[0]) {
            throw new Error('Bạn không có quyền tạo card trong column này');
        }

        // Kiểm tra assigned_to (nếu có) thuộc workspace
        if (assigned_to) {
            const assigneeResult = await client.query(
                `
                SELECT 1
                FROM workspace_members wm
                JOIN boards b ON b.workspace_id = wm.workspace_id
                JOIN columns c ON c.board_id = b.id
                WHERE c.id = $1 AND wm.user_id = $2
                `,
                [column_id, assigned_to]
            );
            console.log('Assignee result:', assigneeResult.rows[0]);
            if (!assigneeResult.rows[0]) {
                throw new Error('Người được giao không thuộc workspace');
            }
        }

        const result = await client.query(
            'INSERT INTO cards (column_id, title, description, position, created_by, assigned_to, due_date) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [column_id, title, description, position || 0, created_by, assigned_to || null, due_date || null]
        );

        console.log('Card created:', result.rows[0]);

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const getCardsByColumnId = async (column_id, userId) => {
    const result = await pool.query(
        `
        SELECT c.id, c.column_id, c.title, c.description, c.position, c.created_by, c.assigned_to, c.due_date, c.created_at
        FROM cards c
        JOIN columns col ON c.column_id = col.id
        JOIN boards b ON col.board_id = b.id
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE c.column_id = $1 AND wm.user_id = $2
        ORDER BY c.position, c.created_at
        `,
        [column_id, userId]
    );
    return result.rows;
};

const getCardById = async (cardId, userId) => {
    const result = await pool.query(
        `
        SELECT c.id, c.column_id, c.title, c.description, c.position, c.created_by, c.assigned_to, c.due_date, c.created_at
        FROM cards c
        JOIN columns col ON c.column_id = col.id
        JOIN boards b ON col.board_id = b.id
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE c.id = $1 AND wm.user_id = $2
        `,
        [cardId, userId]
    );
    return result.rows[0];
};

const updateCard = async (cardId, userId, { title, description, position, column_id, assigned_to, due_date }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Kiểm tra quyền: owner/admin hoặc người tạo card
        const permissionResult = await client.query(
            `
            SELECT c.created_by, wm.role
            FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
            WHERE c.id = $1 AND wm.user_id = $2
            `,
            [cardId, userId]
        );
        if (!permissionResult.rows[0]) {
            throw new Error('Bạn không có quyền cập nhật card này');
        }
        const { created_by, role } = permissionResult.rows[0];
        if (created_by !== userId && !['owner', 'admin'].includes(role)) {
            throw new Error('Bạn không có quyền cập nhật card này');
        }

        // Kiểm tra column_id mới (nếu thay đổi)
        if (column_id) {
            const columnResult = await client.query(
                `
                SELECT 1
                FROM columns c
                JOIN boards b ON c.board_id = b.id
                JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
                WHERE c.id = $1 AND wm.user_id = $2
                `,
                [column_id, userId]
            );
            if (!columnResult.rows[0]) {
                throw new Error('Column không hợp lệ hoặc bạn không có quyền truy cập');
            }
        }

        // Kiểm tra assigned_to (nếu thay đổi)
        if (assigned_to) {
            const assigneeResult = await client.query(
                `
                SELECT 1
                FROM workspace_members wm
                JOIN boards b ON b.workspace_id = wm.workspace_id
                JOIN columns col ON col.board_id = b.id
                WHERE col.id = $1 AND wm.user_id = $2
                `,
                [column_id || (await client.query('SELECT column_id FROM cards WHERE id = $1', [cardId])).rows[0].column_id, assigned_to]
            );
            if (!assigneeResult.rows[0]) {
                throw new Error('Người được giao không thuộc workspace');
            }
        }

        const result = await client.query(
            `
            UPDATE cards
            SET title = $1, description = $2, position = COALESCE($3, position), column_id = COALESCE($4, column_id), assigned_to = $5, due_date = $6
            WHERE id = $7
            RETURNING *
            `,
            [title, description, position, column_id, assigned_to || null, due_date || null, cardId]
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

const deleteCard = async (cardId, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Kiểm tra quyền: owner/admin hoặc người tạo card
        const permissionResult = await client.query(
            `
            SELECT c.created_by, wm.role
            FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
            WHERE c.id = $1 AND wm.user_id = $2
            `,
            [cardId, userId]
        );
        if (!permissionResult.rows[0]) {
            throw new Error('Bạn không có quyền xóa card này');
        }
        const { created_by, role } = permissionResult.rows[0];
        if (created_by !== userId && !['owner', 'admin'].includes(role)) {
            throw new Error('Bạn không có quyền xóa card này');
        }

        const result = await client.query('DELETE FROM cards WHERE id = $1 RETURNING id', [cardId]);

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

export const CardModel = {
    createCard,
    getCardsByColumnId,
    getCardById,
    updateCard,
    deleteCard,
};