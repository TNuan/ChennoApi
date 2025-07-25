import pool from '../config/db.js';

const createColumn = async ({ board_id, title, created_by }) => {
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

        // Lấy position lớn nhất trong board hiện tại
        const positionResult = await client.query(
            'SELECT COALESCE(MAX(position) + 1, 0) as new_position FROM columns WHERE board_id = $1',
            [board_id]
        );
        const newPosition = positionResult.rows[0].new_position;

        const result = await client.query(
            'INSERT INTO columns (board_id, title, position, created_by) VALUES ($1, $2, $3, $4) RETURNING id, board_id, title, position, created_by, created_at',
            [board_id, title, newPosition, created_by]
        );

        const newColumn = {...result.rows[0], cards: []};

        await client.query('COMMIT');
        return newColumn;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const getColumnsByBoardId = async (board_id, userId) => {
    const client = await pool.connect();
    try {
        // Lấy danh sách columns
        const columnsResult = await client.query(
            `
            SELECT c.id, c.board_id, c.title, c.position, c.created_by, c.created_at
            FROM columns c
            JOIN boards b ON c.board_id = b.id
            JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
            WHERE c.board_id = $1 AND wm.user_id = $2
            ORDER BY c.position, c.created_at
            `,
            [board_id, userId]
        );
        
        const columns = columnsResult.rows;
        
        // Nếu không có columns, trả về mảng rỗng
        if (columns.length === 0) {
            return [];
        }
        
        // Lấy tất cả cards cho các columns trong board này, bao gồm thông tin về attachments và comments
        const cardsResult = await client.query(
            `
            SELECT 
                c.id, c.column_id, c.title, c.cover_img, c.position,
                c.assigned_to, c.due_date::text as due_date, c.resolved_at::text as resolved_at, c.status, 
                u.username AS assigned_username,
                u.avatar AS assigned_avatar,
                COALESCE(att_counts.count, 0) AS attachment_count,
                COALESCE(com_counts.count, 0) AS comment_count
            FROM cards c
            JOIN columns col ON c.column_id = col.id
            LEFT JOIN users u ON c.assigned_to = u.id
            LEFT JOIN (
                SELECT card_id, COUNT(*) as count 
                FROM card_attachments 
                WHERE is_deleted = false 
                GROUP BY card_id
            ) att_counts ON c.id = att_counts.card_id
            LEFT JOIN (
                SELECT card_id, COUNT(*) as count 
                FROM card_comments 
                WHERE is_deleted = false 
                GROUP BY card_id
            ) com_counts ON c.id = com_counts.card_id
            WHERE col.board_id = $1 AND c.is_archived = FALSE
            ORDER BY c.position, c.created_at
            `,
            [board_id]
        );
        
        // Lấy thông tin labels cho tất cả cards trong board
        const labelsResult = await client.query(
            `
            SELECT cl.card_id, l.id, l.name, l.color
            FROM card_labels cl
            JOIN labels l ON cl.label_id = l.id
            JOIN cards c ON cl.card_id = c.id
            JOIN columns col ON c.column_id = col.id
            WHERE col.board_id = $1
            `,
            [board_id]
        );
        
        // Map labels vào từng card dựa theo card_id
        const labelsByCard = {};
        labelsResult.rows.forEach(label => {
            if (!labelsByCard[label.card_id]) {
                labelsByCard[label.card_id] = [];
            }
            // Chỉ lấy những thông tin cần thiết của label
            labelsByCard[label.card_id].push({
                id: label.id,
                name: label.name,
                color: label.color
            });
        });
        
        // Tạo map chứa các cards theo column_id
        const cardsByColumn = {};
        cardsResult.rows.forEach(card => {
            // Thêm labels vào card
            card.labels = labelsByCard[card.id] || [];

            // Đảm bảo attachment_count và comment_count là số
            card.attachment_count = parseInt(card.attachment_count) || 0;
            card.comment_count = parseInt(card.comment_count) || 0;
            
            if (!cardsByColumn[card.column_id]) {
                cardsByColumn[card.column_id] = [];
            }
            cardsByColumn[card.column_id].push(card);
        });
        
        // Gán mảng cards cho mỗi column
        columns.forEach(column => {
            column.cards = cardsByColumn[column.id] || [];
        });
        
        return columns;
    } catch (err) {
        throw err;
    } finally {
        client.release();
    }
};

const getColumnById = async (columnId, userId) => {
    const result = await pool.query(
        `
        SELECT c.id, c.board_id, c.title, c.position, c.created_by, c.created_at
        FROM columns c
        JOIN boards b ON c.board_id = b.id
        JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
        WHERE c.id = $1 AND wm.user_id = $2
        `,
        [columnId, userId]
    );
    return result.rows[0];
};

const updateColumn = async (columnId, userId, { title, position }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy thông tin column hiện tại và kiểm tra quyền
        const columnResult = await client.query(
            `
            SELECT c.id, c.board_id, c.position
            FROM columns c
            JOIN boards b ON c.board_id = b.id
            JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
            WHERE c.id = $1 AND wm.user_id = $2 AND wm.role IN ('owner', 'admin')
            `,
            [columnId, userId]
        );

        const column = columnResult.rows[0];
        if (!column) {
            return null; // Column không tồn tại hoặc không có quyền
        }

        const updateFields = [];
        const queryParams = [];
        let paramIndex = 1;

        if (title !== undefined) {
            updateFields.push(`title = $${paramIndex}`);
            queryParams.push(title);
            paramIndex++;
        }

        // Nếu có yêu cầu thay đổi position
        if (position !== undefined && position !== column.position) {
            const oldPosition = column.position;
            const newPosition = position;
            
            // Cập nhật position của column
            updateFields.push(`position = $${paramIndex}`);
            queryParams.push(newPosition);
            paramIndex++;

            // Cập nhật các column khác
            if (newPosition > oldPosition) {
                // Move right to left: Giảm position của các column nằm giữa oldPos+1 và newPos
                await client.query(
                    `UPDATE columns SET position = position - 1 
                     WHERE board_id = $1 AND position > $2 AND position <= $3`,
                    [column.board_id, oldPosition, newPosition]
                );
            } else if (newPosition < oldPosition) {
                // Move left to right: Tăng position của các column nằm giữa newPos và oldPos-1
                await client.query(
                    `UPDATE columns SET position = position + 1 
                     WHERE board_id = $1 AND position >= $2 AND position < $3`,
                    [column.board_id, newPosition, oldPosition]
                );
            }
        }

        if (updateFields.length === 0) {
            // Không có thay đổi, trả về column hiện tại
            const result = await client.query(
                `SELECT id, board_id, title, position, created_by, created_at 
                 FROM columns WHERE id = $1`,
                [columnId]
            );
            await client.query('COMMIT');
            return result.rows[0];
        }

        // Thêm columnId và thực hiện cập nhật
        queryParams.push(columnId);
        const result = await client.query(
            `UPDATE columns SET ${updateFields.join(', ')} 
             WHERE id = $${paramIndex} 
             RETURNING id, board_id, title, position, created_by, created_at`,
            queryParams
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

const deleteColumn = async (columnId, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy thông tin column trước khi xóa
        const columnResult = await client.query(
            `
            SELECT c.id, c.board_id, c.position
            FROM columns c
            JOIN boards b ON c.board_id = b.id
            JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
            WHERE c.id = $1 AND wm.user_id = $2 AND wm.role IN ('owner', 'admin')
            `,
            [columnId, userId]
        );

        const column = columnResult.rows[0];
        if (!column) {
            return null; // Column không tồn tại hoặc không có quyền
        }

        // Xóa column
        const result = await client.query(
            `DELETE FROM columns WHERE id = $1 RETURNING id`,
            [columnId]
        );
        
        // Cập nhật lại position của các column sau vị trí đã xóa
        await client.query(
            `UPDATE columns SET position = position - 1 
             WHERE board_id = $1 AND position > $2`,
            [column.board_id, column.position]
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

export const ColumnModel = {
    createColumn,
    getColumnsByBoardId,
    getColumnById,
    updateColumn,
    deleteColumn,
};