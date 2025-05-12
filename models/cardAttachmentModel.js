import pool from '../config/db.js';

const addAttachment = async ({ card_id, file_name, file_path, file_type, file_size, uploaded_by }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Kiểm tra quyền truy cập card
        const accessCheck = await client.query(
            `SELECT 1
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             JOIN boards b ON col.board_id = b.id
             JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
             WHERE c.id = $1 AND wm.user_id = $2`,
            [card_id, uploaded_by]
        );
        
        if (!accessCheck.rows[0]) {
            throw new Error('Bạn không có quyền thêm tệp đính kèm cho card này');
        }
        
        const result = await client.query(
            `INSERT INTO card_attachments (card_id, file_name, file_path, file_type, file_size, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [card_id, file_name, file_path, file_type, file_size, uploaded_by]
        );
        
        // Ghi lại hoạt động
        await client.query(
            `INSERT INTO card_activities (card_id, user_id, activity_type, activity_data)
             VALUES ($1, $2, 'attachment_added', $3)`,
            [card_id, uploaded_by, JSON.stringify({ attachment_id: result.rows[0].id, file_name })]
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

const getAttachmentsByCardId = async (card_id, userId) => {
    const result = await pool.query(
        `SELECT ca.*, u.username as uploader_name
         FROM card_attachments ca
         JOIN users u ON ca.uploaded_by = u.id
         JOIN cards c ON ca.card_id = c.id
         JOIN columns col ON c.column_id = col.id
         JOIN boards b ON col.board_id = b.id
         JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
         WHERE ca.card_id = $1 AND wm.user_id = $2 AND ca.is_deleted = false
         ORDER BY ca.created_at DESC`,
        [card_id, userId]
    );
    
    return result.rows;
};

const deleteAttachment = async (attachment_id, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Lấy thông tin về attachment
        const attachmentInfo = await client.query(
            `SELECT ca.*, c.id as card_id
             FROM card_attachments ca
             JOIN cards c ON ca.card_id = c.id
             JOIN columns col ON c.column_id = col.id
             JOIN boards b ON col.board_id = b.id
             JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
             WHERE ca.id = $1 AND wm.user_id = $2`,
            [attachment_id, userId]
        );
        
        if (!attachmentInfo.rows[0]) {
            throw new Error('Tệp đính kèm không tồn tại hoặc bạn không có quyền xóa');
        }
        
        const { card_id, file_name, uploaded_by } = attachmentInfo.rows[0];
        
        // Kiểm tra quyền: chỉ người upload hoặc admin/owner có thể xóa
        const permissionCheck = await client.query(
            `SELECT wm.role
             FROM workspace_members wm
             JOIN boards b ON wm.workspace_id = b.workspace_id
             JOIN columns col ON b.id = col.board_id
             JOIN cards c ON col.id = c.column_id
             JOIN card_attachments ca ON c.id = ca.card_id
             WHERE ca.id = $1 AND wm.user_id = $2`,
            [attachment_id, userId]
        );
        
        const { role } = permissionCheck.rows[0];
        
        if (uploaded_by !== userId && !['owner', 'admin'].includes(role)) {
            throw new Error('Bạn không có quyền xóa tệp đính kèm này');
        }
        
        // Soft delete - chỉ đánh dấu là đã xóa
        await client.query(
            `UPDATE card_attachments
             SET is_deleted = true
             WHERE id = $1
             RETURNING *`,
            [attachment_id]
        );
        
        // Ghi lại hoạt động
        await client.query(
            `INSERT INTO card_activities (card_id, user_id, activity_type, activity_data)
             VALUES ($1, $2, 'attachment_removed', $3)`,
            [card_id, userId, JSON.stringify({ attachment_id, file_name })]
        );
        
        await client.query('COMMIT');
        return { id: attachment_id, card_id };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

export const CardAttachmentModel = {
    addAttachment,
    getAttachmentsByCardId,
    deleteAttachment
};