import pool from '../config/db.js';

const createNotification = async ({ sender_id, receiver_id, title, content, type, entity_type = null, entity_id = null }) => {
    const query = `
        INSERT INTO notifications (sender_id, receiver_id, title, content, type, entity_type, entity_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
    `;
    const result = await pool.query(query, [sender_id, receiver_id, title, content, type, entity_type, entity_id]);
    return result.rows[0];
};

const createBulkNotifications = async ({ sender_id, receiver_ids, title, content, type, entity_type = null, entity_id = null }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Tạo mảng các giá trị để insert
        const values = receiver_ids.map(receiver_id => 
            `(${sender_id}, ${receiver_id}, $1, $2, $3, $4, $5)`
        ).join(',');

        const query = `
            INSERT INTO notifications 
                (sender_id, receiver_id, title, content, type, entity_type, entity_id)
            VALUES ${values}
            RETURNING *
        `;

        const result = await client.query(query, [title, content, type, entity_type, entity_id]);

        // Lấy thông tin user cho mỗi notification
        const notificationsWithUsers = await client.query(`
            SELECT 
                n.*,
                json_build_object(
                    'id', s.id,
                    'username', s.username,
                    'email', s.email,
                    'avatar', s.avatar,
                    'full_name', s.full_name
                ) as sender,
                json_build_object(
                    'id', r.id,
                    'username', r.username,
                    'email', r.email
                ) as receiver
            FROM notifications n
            JOIN users s ON n.sender_id = s.id
            JOIN users r ON n.receiver_id = r.id
            WHERE n.id = ANY($1)
        `, [result.rows.map(n => n.id)]);

        await client.query('COMMIT');
        return notificationsWithUsers.rows;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const getUserNotifications = async (userId, { limit = 20, offset = 0, unreadOnly = false }) => {
    const query = `
        SELECT 
            n.*,
            json_build_object(
                'id', s.id,
                'username', s.username,
                'email', s.email,
                'avatar', s.avatar,
                'full_name', s.full_name
            ) as sender,
            json_build_object(
                'id', r.id,
                'username', r.username,
                'email', r.email
            ) as receiver
        FROM notifications n
        JOIN users s ON n.sender_id = s.id
        JOIN users r ON n.receiver_id = r.id
        WHERE n.receiver_id = $1
        ${unreadOnly ? 'AND n.is_read = FALSE' : ''}
        ORDER BY n.created_at DESC
        LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [userId, limit, offset]);
    return result.rows;
};

const markAsRead = async (notificationId, userId) => {
    const query = `
        UPDATE notifications
        SET is_read = TRUE
        WHERE id = $1 AND receiver_id = $2
        RETURNING *
    `;
    const result = await pool.query(query, [notificationId, userId]);
    return result.rows[0];
};

const markAllAsRead = async (userId) => {
    const query = `
        UPDATE notifications
        SET is_read = TRUE
        WHERE receiver_id = $1 AND is_read = FALSE
        RETURNING *
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
};

const getUnreadCount = async (userId) => {
    const query = `
        SELECT COUNT(*) as count
        FROM notifications
        WHERE receiver_id = $1 AND is_read = FALSE
    `;
    const result = await pool.query(query, [userId]);
    return parseInt(result.rows[0].count);
};

export const NotificationModel = {
    createNotification,
    createBulkNotifications,
    getUserNotifications,
    markAsRead,
    markAllAsRead,
    getUnreadCount
};