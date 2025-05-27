import pool from '../config/db.js';
import fs from 'fs';

// Thêm tệp đính kèm vào card
const addAttachment = async ({ card_id, file_name, file_path, file_type, file_size, uploaded_by }) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN board_members bm ON b.id = bm.board_id
            WHERE c.id = $1 AND bm.user_id = $2`,
            [card_id, uploaded_by]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền thêm tệp đính kèm vào card này');
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
            VALUES ($1, $2, 'added_attachment', $3)`,
            [card_id, uploaded_by, JSON.stringify({ 
                attachment_id: result.rows[0].id,
                file_name 
            })]
        );

        return result.rows[0];
    } finally {
        client.release();
    }
};

// Lấy danh sách tệp đính kèm của một card
const getCardAttachments = async (card_id, userId) => {
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
            throw new Error('Không có quyền xem tệp đính kèm của card này');
        }

        const attachments = await client.query(
            `SELECT ca.*, u.username as uploaded_by_username
            FROM card_attachments ca
            LEFT JOIN users u ON ca.uploaded_by = u.id
            WHERE ca.card_id = $1 AND ca.is_deleted = false
            ORDER BY ca.created_at DESC`,
            [card_id]
        );

        return attachments.rows;
    } finally {
        client.release();
    }
};

// Xóa tệp đính kèm (soft delete)
const deleteAttachment = async (attachment_id, userId) => {
    const client = await pool.connect();
    try {
        // Lấy thông tin card_id và file_path trước
        const attachmentQuery = await client.query(
            `SELECT card_id, file_name, file_path FROM card_attachments WHERE id = $1`,
            [attachment_id]
        );
        
        if (attachmentQuery.rows.length === 0) {
            throw new Error('Tệp đính kèm không tồn tại');
        }
        
        const { card_id, file_name, file_path } = attachmentQuery.rows[0];
        
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN board_members bm ON b.id = bm.board_id
            WHERE c.id = $1 AND bm.user_id = $2`,
            [card_id, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền xóa tệp đính kèm này');
        }

        // Thực hiện soft delete trong database
        await client.query(
            `UPDATE card_attachments SET is_deleted = true
            WHERE id = $1`,
            [attachment_id]
        );

        // Ghi lại hoạt động
        await client.query(
            `INSERT INTO card_activities (card_id, user_id, activity_type, activity_data)
            VALUES ($1, $2, 'deleted_attachment', $3)`,
            [card_id, userId, JSON.stringify({ 
                attachment_id, 
                file_name 
            })]
        );
        
        // Xóa file vật lý nếu tồn tại
        if (file_path && fs.existsSync(file_path)) {
            fs.unlink(file_path, (err) => {
                if (err) {
                    console.error(`Error deleting file ${file_path}:`, err);
                } else {
                    console.log(`File ${file_path} deleted successfully`);
                }
            });
        }

        return { card_id };
    } finally {
        client.release();
    }
};

export const AttachmentModel = {
    addAttachment,
    getCardAttachments,
    deleteAttachment
};