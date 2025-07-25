import pool from '../config/db.js';

const createCard = async ({ column_id, title, description, position, created_by, assigned_to, due_date, start_date, status, priority_level, difficulty_level }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Kiểm tra user có phải là member của board chứa column này không
        const boardAccessResult = await client.query(
            `
            SELECT bm.role 
            FROM board_members bm
            JOIN columns c ON c.board_id = bm.board_id
            WHERE c.id = $1 AND bm.user_id = $2
            `,
            [column_id, created_by]
        );
        
        if (boardAccessResult.rows.length === 0) {
            throw new Error('Bạn phải là thành viên của board để tạo card');
        }

        // Kiểm tra assigned_to (nếu có) có phải là member của board không
        if (assigned_to) {
            const assigneeResult = await client.query(
                `
                SELECT 1
                FROM board_members bm
                JOIN columns c ON c.board_id = bm.board_id
                WHERE c.id = $1 AND bm.user_id = $2
                `,
                [column_id, assigned_to]
            );
            if (!assigneeResult.rows[0]) {
                throw new Error('Chỉ có thể gán card cho thành viên của board');
            }
        }

        // Tự động tính toán position mới nhất nếu không được cung cấp
        let cardPosition = position;
        if (cardPosition === undefined || cardPosition === null) {
            const positionResult = await client.query(
                `SELECT COALESCE(MAX(position) + 1, 0) as next_position 
                 FROM cards 
                 WHERE column_id = $1`,
                [column_id]
            );
            cardPosition = positionResult.rows[0].next_position;
        }

        // Xác định resolved_at dựa trên status ban đầu
        const initialStatus = status || 'todo';
        const resolved_at = initialStatus === 'done' ? new Date().toISOString() : null;

        const result = await client.query(
            `INSERT INTO cards 
             (column_id, title, description, position, created_by, assigned_to, due_date, start_date,
              status, priority_level, difficulty_level, resolved_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
             RETURNING *`,
            [
                column_id, 
                title, 
                description, 
                cardPosition, 
                created_by, 
                assigned_to || null, 
                start_date || null,
                due_date || null,
                initialStatus,
                priority_level || 0,
                difficulty_level || 0,
                resolved_at
            ]
        );

        // Ghi lại hoạt động tạo card
        await client.query(
            `INSERT INTO card_activities 
             (card_id, user_id, activity_type, activity_data) 
             VALUES ($1, $2, $3, $4)`,
            [
                result.rows[0].id,
                created_by,
                'created',
                JSON.stringify({ 
                    title, 
                    description, 
                    status: initialStatus,
                    start_date,
                    due_date,
                    resolved_at: resolved_at 
                })
            ]
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

const getCardsByColumnId = async (column_id, userId) => {
    // Kiểm tra quyền truy cập - chỉ member của board hoặc người xem board public
    const permissionCheck = await pool.query(
        `
        SELECT 1
        FROM board_members bm
        JOIN columns c ON c.board_id = bm.board_id
        WHERE c.id = $1 AND bm.user_id = $2
        UNION
        SELECT 1
        FROM boards b
        JOIN columns c ON c.board_id = b.id
        WHERE c.id = $1 AND b.visibility = 1
        `,
        [column_id, userId]
    );
    
    if (permissionCheck.rows.length === 0) {
        throw new Error('Bạn không có quyền xem các card trong column này');
    }
    
    // Cập nhật query - force DATE format cho start_date và due_date
    const result = await pool.query(
        `
        SELECT c.id, c.column_id, c.title, c.description, c.position, 
               c.created_by, c.assigned_to, 
               c.due_date::text as due_date,        -- Force string format
               c.start_date::text as start_date,    -- Force string format
               c.resolved_at::text as resolved_at, -- Force string format
               c.created_at, c.cover_img, c.updated_at, c.status,
               c.priority_level, c.difficulty_level, c.is_archived,
               u.username as created_by_name,
               au.username as assigned_to_name,
               (SELECT COUNT(*) FROM card_attachments WHERE card_id = c.id AND is_deleted = false) as attachment_count,
               (SELECT COUNT(*) FROM card_comments WHERE card_id = c.id AND is_deleted = false) as comment_count,
               (SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color)) 
                FROM card_labels cl 
                JOIN labels l ON cl.label_id = l.id 
                WHERE cl.card_id = c.id) as labels
        FROM cards c
        JOIN columns col ON c.column_id = col.id
        JOIN users u ON c.created_by = u.id
        LEFT JOIN users au ON c.assigned_to = au.id
        WHERE c.column_id = $1 AND c.is_archived = FALSE
        ORDER BY c.position, c.created_at
        `,
        [column_id]
    );
    
    return result.rows;
};

const getCardById = async (cardId, userId) => {
    // Kiểm tra quyền truy cập - chỉ member của board hoặc người xem board public
    const permissionCheck = await pool.query(
        `
        SELECT 1
        FROM board_members bm
        JOIN columns c ON c.board_id = bm.board_id
        JOIN cards card ON card.column_id = c.id
        WHERE card.id = $1 AND bm.user_id = $2
        UNION
        SELECT 1
        FROM boards b
        JOIN columns c ON c.board_id = b.id
        JOIN cards card ON card.column_id = c.id
        WHERE card.id = $1 AND b.visibility = 1
        `,
        [cardId, userId]
    );
    
    if (permissionCheck.rows.length === 0) {
        throw new Error('Bạn không có quyền xem card này');
    }
    
    // Cập nhật query
    const result = await pool.query(
        `
        SELECT c.id, c.column_id, c.title, c.description, c.position,
               c.created_by, c.assigned_to, 
               c.due_date::text as due_date,        -- Force string format
               c.start_date::text as start_date,    -- Force string format
               c.resolved_at::text as resolved_at, -- Force string format
               c.created_at, c.cover_img, c.updated_at, c.status,
               c.priority_level, c.difficulty_level,
               u.username as created_by_name, u.email as created_by_email,
               au.username as assigned_to_name, au.email as assigned_to_email,
               b.id as board_id, b.name as board_name,
               col.name as column_name,
               (SELECT json_agg(
                   json_build_object(
                       'id', ca.id,
                       'file_name', ca.file_name,
                       'file_path', ca.file_path,
                       'file_type', ca.file_type,
                       'file_size', ca.file_size,
                       'uploaded_by', ca.uploaded_by,
                       'created_at', ca.created_at
                   )
               ) FROM card_attachments ca WHERE ca.card_id = c.id AND ca.is_deleted = false) as attachments,
               (SELECT json_agg(
                   json_build_object(
                       'id', l.id,
                       'name', l.name,
                       'color', l.color
                   )
               ) FROM card_labels cl JOIN labels l ON cl.label_id = l.id WHERE cl.card_id = c.id) as labels,
               (SELECT json_agg(
                   json_build_object(
                       'id', cc.id,
                       'user_id', cc.user_id,
                       'username', u2.username,
                       'content', cc.content,
                       'created_at', cc.created_at,
                       'updated_at', cc.updated_at,
                       'is_edited', cc.is_edited,
                       'parent_id', cc.parent_id
                   ) ORDER BY cc.created_at
               ) FROM card_comments cc JOIN users u2 ON cc.user_id = u2.id 
                  WHERE cc.card_id = c.id AND cc.is_deleted = false) as comments,
               (SELECT json_agg(
                   json_build_object(
                       'id', ca.id,
                       'user_id', ca.user_id,
                       'username', u3.username,
                       'activity_type', ca.activity_type,
                       'activity_data', ca.activity_data,
                       'created_at', ca.created_at
                   ) ORDER BY ca.created_at DESC
               ) FROM card_activities ca JOIN users u3 ON ca.user_id = u3.id WHERE ca.card_id = c.id) as activities
        FROM cards c
        JOIN columns col ON c.column_id = col.id
        JOIN boards b ON col.board_id = b.id
        JOIN users u ON c.created_by = u.id
        LEFT JOIN users au ON c.assigned_to = au.id
        WHERE c.id = $1
        `,
        [cardId]
    );
    
    return result.rows[0];
};

const watchCard = async (cardId, userId) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập card
        const permissionCheck = await client.query(
            `SELECT c.id FROM cards c
             JOIN columns col ON c.column_id = col.id
             JOIN boards b ON col.board_id = b.id
             JOIN board_members bm ON b.id = bm.board_id
             WHERE c.id = $1 AND bm.user_id = $2`,
            [cardId, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Bạn không có quyền watch card này');
        }

        // Thêm watcher
        const result = await client.query(
            `INSERT INTO card_watchers (card_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (card_id, user_id) DO NOTHING
             RETURNING *`,
            [cardId, userId]
        );

        return result.rows[0];
    } finally {
        client.release();
    }
};

const unwatchCard = async (cardId, userId) => {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `DELETE FROM card_watchers
             WHERE card_id = $1 AND user_id = $2
             RETURNING *`,
            [cardId, userId]
        );

        return result.rows[0];
    } finally {
        client.release();
    }
};

const isUserWatchingCard = async (cardId, userId) => {
    const result = await pool.query(
        `SELECT 1 FROM card_watchers
         WHERE card_id = $1 AND user_id = $2`,
        [cardId, userId]
    );

    return result.rows.length > 0;
};

const getCardWatchers = async (cardId) => {
    const result = await pool.query(
        `SELECT cw.*, u.username, u.email
         FROM card_watchers cw
         JOIN users u ON cw.user_id = u.id
         WHERE cw.card_id = $1`,
        [cardId]
    );

    return result.rows;
};

// Cập nhật getCardDetails để include watcher status
const getCardDetails = async (cardId, userId) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập - chỉ member của board hoặc người xem board public
        const permissionCheck = await client.query(
            `SELECT bm.role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            JOIN board_members bm ON b.id = bm.board_id
            WHERE c.id = $1 AND bm.user_id = $2
            UNION
            SELECT 'public' as role FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            WHERE c.id = $1 AND b.visibility = 1`,
            [cardId, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Bạn không có quyền xem chi tiết của card này');
        }

        // Lấy thông tin card và dữ liệu liên quan...
        const cardResult = await client.query(
            `SELECT c.*, 
             c.due_date::text as due_date,        -- Force string format
             c.start_date::text as start_date,    -- Force string format
             c.resolved_at::text as resolved_at, -- Force string format
             col.title as column_name,
             col.board_id,
             b.name as board_name,
             creator.username as created_by_username,
             assignee.username as assigned_to_username,
             assignee.email as assigned_to_email
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             JOIN boards b ON col.board_id = b.id
             LEFT JOIN users creator ON c.created_by = creator.id
             LEFT JOIN users assignee ON c.assigned_to = assignee.id
             WHERE c.id = $1`,
            [cardId]
        );

        if (cardResult.rows.length === 0) {
            throw new Error('Card không tồn tại');
        }

        const card = cardResult.rows[0];

        // Lấy các dữ liệu khác...
        const labelsResult = await client.query(
            `SELECT l.* FROM labels l
            JOIN card_labels cl ON l.id = cl.label_id
            WHERE cl.card_id = $1
            ORDER BY l.name`,
            [cardId]
        );

        // Lấy các tệp đính kèm
        const attachmentsResult = await client.query(
            `SELECT ca.*, u.username as uploaded_by_username
            FROM card_attachments ca
            LEFT JOIN users u ON ca.uploaded_by = u.id
            WHERE ca.card_id = $1 AND ca.is_deleted = false
            ORDER BY ca.created_at DESC`,
            [cardId]
        );

        // Lấy các bình luận
        const commentsResult = await client.query(
            `SELECT cc.*, u.username, u.email
            FROM card_comments cc
            JOIN users u ON cc.user_id = u.id
            WHERE cc.card_id = $1 AND cc.is_deleted = false
            ORDER BY cc.created_at ASC`,
            [cardId]
        );

        // Lấy các hoạt động
        const activitiesResult = await client.query(
            `SELECT ca.*, u.username, u.email
            FROM card_activities ca
            JOIN users u ON ca.user_id = u.id
            WHERE ca.card_id = $1
            ORDER BY ca.created_at DESC
            LIMIT 20`, // Giới hạn 20 hoạt động gần nhất
            [cardId]
        );

        // Check if current user is watching this card
        const watchingResult = await client.query(
            `SELECT 1 FROM card_watchers
             WHERE card_id = $1 AND user_id = $2`,
            [cardId, userId]
        );

        const cardDetails = {
            ...card,
            labels: labelsResult.rows,
            attachments: attachmentsResult.rows,
            comments: commentsResult.rows.map(comment => ({
                ...comment,
                user: {
                    id: comment.user_id,
                    username: comment.username,
                    email: comment.email
                }
            })),
            activities: activitiesResult.rows.map(activity => ({
                ...activity,
                user: {
                    id: activity.user_id,
                    username: activity.username,
                    email: activity.email
                }
            })),
            is_watching: watchingResult.rows.length > 0 // Thêm thông tin watching
        };

        return cardDetails;
    } finally {
        client.release();
    }
};

const updateCard = async (cardId, userId, { 
    title, description, position, column_id, assigned_to, due_date, start_date,
    cover_img, status, priority_level, difficulty_level 
}) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy thông tin card và kiểm tra quyền
        const cardQuery = await client.query(
            `
            SELECT c.*, col.board_id
            FROM cards c
            JOIN columns col ON c.column_id = col.id
            WHERE c.id = $1
            `,
            [cardId]
        );
        
        if (cardQuery.rows.length === 0) {
            throw new Error('Card không tồn tại');
        }
        
        const card = cardQuery.rows[0];
        const boardId = card.board_id;
        const oldColumnId = card.column_id;
        const oldPosition = card.position;
        const oldStatus = card.status;
        
        // Kiểm tra người dùng có phải là member của board không
        const memberCheck = await client.query(
            `SELECT role FROM board_members
             WHERE board_id = $1 AND user_id = $2`,
            [boardId, userId]
        );
        
        if (memberCheck.rows.length === 0) {
            throw new Error('Bạn không phải là thành viên của board');
        }
        
        // Kiểm tra quyền chỉnh sửa dựa trên vai trò
        const isAdmin = memberCheck.rows[0].role === 'admin' || memberCheck.rows[0].role === 'owner';
        const isCreator = card.created_by === userId;
        
        if (!isAdmin && !isCreator) {
            throw new Error('Bạn không có quyền cập nhật card này');
        }

        // Kiểm tra assigned_to nếu có thay đổi
        if (assigned_to !== undefined && assigned_to !== card.assigned_to) {
            if (assigned_to !== null) {
                const assigneeCheck = await client.query(
                    `SELECT 1 FROM board_members
                     WHERE board_id = $1 AND user_id = $2`,
                    [boardId, assigned_to]
                );
                
                if (assigneeCheck.rows.length === 0) {
                    throw new Error('Chỉ có thể gán card cho thành viên của board');
                }
            }
        }

        // Kiểm tra column_id mới (nếu thay đổi)
        if (column_id && column_id !== card.column_id) {
            const columnCheck = await client.query(
                `SELECT board_id FROM columns
                 WHERE id = $1`,
                [column_id]
            );
            
            if (columnCheck.rows.length === 0) {
                throw new Error('Column không tồn tại');
            }
        }

        // Xác định resolved_at dựa trên status
        let resolved_at = null;
        if (status === 'done' && oldStatus !== 'done') {
            // Status thay đổi thành 'done' từ status khác
            resolved_at = new Date().toISOString();
        } else if (status && status !== 'done' && oldStatus === 'done') {
            // Status thay đổi từ 'done' sang status khác
            resolved_at = null;
        } else if (oldStatus === 'done') {
            // status hiện tại là 'done'
            resolved_at = card.resolved_at;
        }

        // Xác định các thay đổi để ghi log
        const changes = {};
        if (title && title !== card.title) changes.title = { from: card.title, to: title };
        if (description && description !== card.description) changes.description = { from: card.description, to: description };
        if (status && status !== card.status) {
            changes.status = { from: card.status, to: status };
            // Thêm thông tin về resolved_at change
            if (status === 'done' && oldStatus !== 'done') {
                changes.resolved_at = { from: card.resolved_at, to: resolved_at };
            } else if (status !== 'done' && oldStatus === 'done') {
                changes.resolved_at = { from: card.resolved_at, to: null };
            }
        }
        if (priority_level !== undefined && priority_level !== card.priority_level) 
            changes.priority_level = { from: card.priority_level, to: priority_level };
        if (difficulty_level !== undefined && difficulty_level !== card.difficulty_level) 
            changes.difficulty_level = { from: card.difficulty_level, to: difficulty_level };
        if (column_id && column_id !== card.column_id) changes.column_id = { from: card.column_id, to: column_id };
        if (position !== undefined && position !== card.position) changes.position = { from: card.position, to: position };
        if (assigned_to !== undefined && assigned_to !== card.assigned_to) changes.assigned_to = { from: card.assigned_to, to: assigned_to };
        if (start_date && start_date !== card.start_date) changes.start_date = { from: card.start_date, to: start_date };
        if (due_date && due_date !== card.due_date) changes.due_date = { from: card.due_date, to: due_date };
        if (resolved_at && resolved_at !== card.resolved_at) changes.resolved_at = { from: card.resolved_at, to: resolved_at };
        
        // Xử lý cập nhật position khi có sự thay đổi về position hoặc column
        if ((position !== undefined && position !== card.position) || (column_id && column_id !== card.column_id)) {
            const newColumnId = column_id || card.column_id;
            const newPosition = position !== undefined ? position : card.position;
            
            // TRƯỜNG HỢP 1: Di chuyển trong cùng một column
            if (newColumnId === oldColumnId) {
                if (newPosition < oldPosition) {
                    // Di chuyển lên trên: Tăng position của các card từ newPosition đến oldPosition-1
                    await client.query(
                        `UPDATE cards 
                         SET position = position + 1
                         WHERE column_id = $1 
                         AND id != $2
                         AND position >= $3 
                         AND position < $4`,
                        [oldColumnId, cardId, newPosition, oldPosition]
                    );
                } else if (newPosition > oldPosition) {
                    // Di chuyển xuống dưới: Giảm position của các card từ oldPosition+1 đến newPosition
                    await client.query(
                        `UPDATE cards 
                         SET position = position - 1
                         WHERE column_id = $1 
                         AND id != $2
                         AND position > $3 
                         AND position <= $4`,
                        [oldColumnId, cardId, oldPosition, newPosition]
                    );
                }
            } 
            // TRƯỜNG HỢP 2: Di chuyển từ column này sang column khác
            else {
                // Giảm position của các card có position lớn hơn card cũ trong column cũ
                await client.query(
                    `UPDATE cards 
                     SET position = position - 1
                     WHERE column_id = $1
                     AND position > $2`,
                    [oldColumnId, oldPosition]
                );
                
                // Tăng position của các card có position lớn hơn hoặc bằng vị trí mới trong column mới
                await client.query(
                    `UPDATE cards 
                     SET position = position + 1
                     WHERE column_id = $1
                     AND position >= $2`,
                    [newColumnId, newPosition]
                );
            }
        }

        // Cập nhật card với resolved_at được tính toán và normalized dates
        await client.query(
            `
            UPDATE cards
            SET title = COALESCE($1, title), 
                description = COALESCE($2, description), 
                position = COALESCE($3, position), 
                column_id = COALESCE($4, column_id), 
                assigned_to = $5, 
                due_date = $6,
                start_date = $7,
                cover_img = $8,
                status = COALESCE($9, status),
                priority_level = COALESCE($10, priority_level),
                difficulty_level = COALESCE($11, difficulty_level),
                resolved_at = $12,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $13`,
            [
                title, 
                description, 
                position, 
                column_id, 
                assigned_to, // Có thể là null để xóa người được giao
                due_date, // Có thể là null để xóa ngày hết hạn
                start_date, // Có thể là null để xóa ngày bắt đầu
                cover_img,
                status,
                priority_level,
                difficulty_level,
                resolved_at,
                cardId
            ]
        );

        // Ghi lại hoạt động nếu có thay đổi (uncomment nếu cần)
        // if (Object.keys(changes).length > 0) {
        //     await client.query(
        //         `INSERT INTO card_activities 
        //          (card_id, user_id, activity_type, activity_data) 
        //          VALUES ($1, $2, $3, $4)`,
        //         [
        //             cardId,
        //             userId,
        //             'updated',
        //             JSON.stringify({ changes })
        //         ]
        //     );
        // }

        // Cập nhật query cuối để lấy card với đầy đủ thông tin
        const result = await client.query(
            `
            SELECT c.id, c.column_id, c.title, c.description, c.position,
                c.created_by, c.assigned_to, 
                c.due_date::text as due_date,        -- Force string format
                c.start_date::text as start_date,    -- Force string format
                c.resolved_at::text as resolved_at, -- Force string format
                c.created_at, c.cover_img, c.updated_at, c.status,
                c.priority_level, c.difficulty_level,
                u.username as created_by_name, u.email as created_by_email,
                au.username as assigned_to_name, au.email as assigned_to_email,
                col.title as column_name,
                col.board_id,
                b.name as board_name,
                (SELECT json_agg(
                    json_build_object(
                        'id', ca.id,
                        'file_name', ca.file_name,
                        'file_path', ca.file_path,
                        'file_type', ca.file_type,
                        'file_size', ca.file_size,
                        'uploaded_by', ca.uploaded_by,
                        'uploaded_by_username', u_att.username,
                        'created_at', ca.created_at
                    )
                ) FROM card_attachments ca 
                LEFT JOIN users u_att ON ca.uploaded_by = u_att.id
                WHERE ca.card_id = c.id AND ca.is_deleted = false) as attachments,
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', l.id,
                            'name', l.name,
                            'color', l.color
                        )
                    )
                    FROM card_labels cl
                    JOIN labels l ON cl.label_id = l.id
                    WHERE cl.card_id = c.id
                ) as labels,
                (SELECT json_agg(
                    json_build_object(
                        'id', cc.id,
                        'user_id', cc.user_id,
                        'username', u_com.username,
                        'email', u_com.email,
                        'content', cc.content,
                        'created_at', cc.created_at,
                        'updated_at', cc.updated_at,
                        'is_edited', cc.is_edited,
                        'parent_id', cc.parent_id
                    ) ORDER BY cc.created_at
                ) FROM card_comments cc 
                JOIN users u_com ON cc.user_id = u_com.id 
                WHERE cc.card_id = c.id AND cc.is_deleted = false) as comments,
                (SELECT json_agg(
                    json_build_object(
                        'id', ca.id,
                        'user_id', ca.user_id,
                        'username', u_act.username,
                        'email', u_act.email,
                        'activity_type', ca.activity_type,
                        'activity_data', ca.activity_data,
                        'created_at', ca.created_at
                    ) ORDER BY ca.created_at DESC
                ) FROM card_activities ca 
                JOIN users u_act ON ca.user_id = u_act.id 
                WHERE ca.card_id = c.id) as activities,
                (
                    SELECT CASE 
                        WHEN COUNT(*) > 0 THEN true 
                        ELSE false 
                    END
                    FROM card_watchers cw
                    WHERE cw.card_id = c.id AND cw.user_id = $2
                ) as is_watching
            FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            LEFT JOIN users u ON c.created_by = u.id
            LEFT JOIN users au ON c.assigned_to = au.id
            WHERE c.id = $1
            `,
            [cardId, userId]
        );

        await client.query('COMMIT');
        
        const cardDetails = result.rows[0];
        
        // Format lại data giống getCardDetails
        if (cardDetails) {
            // Format comments với user object
            if (cardDetails.comments) {
                cardDetails.comments = cardDetails.comments.map(comment => ({
                    ...comment,
                    user: {
                        id: comment.user_id,
                        username: comment.username,
                        email: comment.email
                    }
                }));
            }

            // Format activities với user object
            if (cardDetails.activities) {
                cardDetails.activities = cardDetails.activities.map(activity => ({
                    ...activity,
                    user: {
                        id: activity.user_id,
                        username: activity.username,
                        email: activity.email
                    }
                }));
            }

            // Đảm bảo arrays không null
            cardDetails.attachments = cardDetails.attachments || [];
            cardDetails.labels = cardDetails.labels || [];
            cardDetails.comments = cardDetails.comments || [];
            cardDetails.activities = cardDetails.activities || [];
        }
        
        return cardDetails;
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating card:', err);
        throw err;
    } finally {
        client.release();
    }
};

const deleteCard = async (cardId, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy thông tin card và kiểm tra quyền
        const cardQuery = await client.query(
            `
            SELECT c.*, col.board_id
            FROM cards c
            JOIN columns col ON c.column_id = col.id
            WHERE c.id = $1
            `,
            [cardId]
        );
        
        if (cardQuery.rows.length === 0) {
            throw new Error('Card không tồn tại');
        }
        
        const card = cardQuery.rows[0];
        const boardId = card.board_id;
        
        // Kiểm tra người dùng có phải là member của board không
        const memberCheck = await client.query(
            `SELECT role FROM board_members
             WHERE board_id = $1 AND user_id = $2`,
            [boardId, userId]
        );
        
        if (memberCheck.rows.length === 0) {
            throw new Error('Bạn không phải là thành viên của board');
        }
        
        // Kiểm tra quyền xóa dựa trên vai trò
        const isAdmin = memberCheck.rows[0].role === 'admin' || memberCheck.rows[0].role === 'owner';
        const isCreator = card.created_by === userId;
        
        if (!isAdmin && !isCreator) {
            throw new Error('Bạn không có quyền xóa card này');
        }

        // Xóa tất cả dữ liệu liên quan
        await client.query('DELETE FROM card_activities WHERE card_id = $1', [cardId]);
        await client.query('DELETE FROM card_comments WHERE card_id = $1', [cardId]);
        await client.query('DELETE FROM card_labels WHERE card_id = $1', [cardId]);
        await client.query('DELETE FROM card_attachments WHERE card_id = $1', [cardId]);
        
        const result = await client.query('DELETE FROM cards WHERE id = $1 RETURNING id, column_id', [cardId]);

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const copyCard = async (cardId, targetColumnId, userId, options = {}) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy thông tin card gốc
        const originalCardQuery = await client.query(
            `SELECT c.*, col.board_id as source_board_id
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             WHERE c.id = $1`,
            [cardId]
        );

        if (originalCardQuery.rows.length === 0) {
            throw new Error('Card không tồn tại');
        }

        const originalCard = originalCardQuery.rows[0];

        // Kiểm tra quyền truy cập card gốc
        const sourcePermissionCheck = await client.query(
            `SELECT bm.role FROM board_members bm
             WHERE bm.board_id = $1 AND bm.user_id = $2`,
            [originalCard.source_board_id, userId]
        );

        if (sourcePermissionCheck.rows.length === 0) {
            throw new Error('Bạn không có quyền copy card này');
        }

        // Lấy thông tin target column và kiểm tra quyền
        const targetColumnQuery = await client.query(
            `SELECT board_id FROM columns WHERE id = $1`,
            [targetColumnId]
        );

        if (targetColumnQuery.rows.length === 0) {
            throw new Error('Column đích không tồn tại');
        }

        const targetBoardId = targetColumnQuery.rows[0].board_id;

        // Kiểm tra quyền truy cập board đích
        const targetPermissionCheck = await client.query(
            `SELECT bm.role FROM board_members bm
             WHERE bm.board_id = $1 AND bm.user_id = $2`,
            [targetBoardId, userId]
        );

        if (targetPermissionCheck.rows.length === 0) {
            throw new Error('Bạn không có quyền tạo card trong board này');
        }

        // Tính position mới
        const positionResult = await client.query(
            `SELECT COALESCE(MAX(position) + 1, 0) as next_position 
             FROM cards 
             WHERE column_id = $1`,
            [targetColumnId]
        );
        const newPosition = positionResult.rows[0].next_position;

        // Tạo card mới (không copy comment và assignee)
        const newCardResult = await client.query(
            `INSERT INTO cards 
             (column_id, title, description, position, created_by, due_date, 
              cover_img, status, priority_level, difficulty_level) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
             RETURNING *`,
            [
                targetColumnId,
                `${originalCard.title} (Copy)`,
                originalCard.description,
                newPosition,
                userId, // Người copy trở thành creator
                originalCard.due_date,
                originalCard.cover_img,
                originalCard.status,
                originalCard.priority_level,
                originalCard.difficulty_level
            ]
        );

        const newCard = newCardResult.rows[0];

        // Copy labels nếu được yêu cầu
        if (options.copyLabels) {
            // Lấy labels của card gốc
            const originalLabelsQuery = await client.query(
                `SELECT l.* FROM labels l
                 JOIN card_labels cl ON l.id = cl.label_id
                 WHERE cl.card_id = $1`,
                [cardId]
            );

            for (const originalLabel of originalLabelsQuery.rows) {
                let labelId = originalLabel.id;

                // Nếu copy sang board khác, cần tạo label mới
                if (originalCard.source_board_id !== targetBoardId) {
                    // Kiểm tra xem label cùng tên và màu đã tồn tại chưa
                    const existingLabelQuery = await client.query(
                        `SELECT id FROM labels 
                         WHERE board_id = $1 AND name = $2 AND color = $3`,
                        [targetBoardId, originalLabel.name, originalLabel.color]
                    );

                    if (existingLabelQuery.rows.length > 0) {
                        labelId = existingLabelQuery.rows[0].id;
                    } else {
                        // Tạo label mới
                        const newLabelResult = await client.query(
                            `INSERT INTO labels (board_id, name, color, created_by)
                             VALUES ($1, $2, $3, $4)
                             RETURNING id`,
                            [targetBoardId, originalLabel.name, originalLabel.color, userId]
                        );
                        labelId = newLabelResult.rows[0].id;
                    }
                }

                // Gán label cho card mới
                await client.query(
                    `INSERT INTO card_labels (card_id, label_id, added_by)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (card_id, label_id) DO NOTHING`,
                    [newCard.id, labelId, userId]
                );
            }
        }

        // Copy attachments nếu được yêu cầu
        if (options.copyAttachments) {
            const originalAttachmentsQuery = await client.query(
                `SELECT * FROM card_attachments 
                 WHERE card_id = $1 AND is_deleted = false`,
                [cardId]
            );

            for (const originalAttachment of originalAttachmentsQuery.rows) {
                // Tạo attachment mới (tạo bản ghi mới, không copy file vật lý)
                await client.query(
                    `INSERT INTO card_attachments 
                     (card_id, file_name, file_path, file_type, file_size, uploaded_by)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        newCard.id,
                        originalAttachment.file_name,
                        originalAttachment.file_path, // Giữ nguyên đường dẫn file
                        originalAttachment.file_type,
                        originalAttachment.file_size,
                        userId // Người copy trở thành uploader
                    ]
                );
            }
        }

        // Ghi lại hoạt động
        await client.query(
            `INSERT INTO card_activities 
             (card_id, user_id, activity_type, activity_data) 
             VALUES ($1, $2, $3, $4)`,
            [
                newCard.id,
                userId,
                'copied',
                JSON.stringify({ 
                    original_card_id: cardId,
                    options: options
                })
            ]
        );

        await client.query('COMMIT');

        // Lấy lại card với đầy đủ thông tin
        const finalCardQuery = await client.query(
            `SELECT c.*, 
             c.due_date::text as due_date,        -- Force string format
             c.start_date::text as start_date,    -- Force string format
             u.username as created_by_username,
             col.board_id,
             COALESCE(att_counts.count, 0) AS attachment_count,
             COALESCE(com_counts.count, 0) AS comment_count,
             (
                 SELECT json_agg(
                     json_build_object(
                         'id', l.id,
                         'name', l.name,
                         'color', l.color
                     )
                 )
                 FROM card_labels cl
                 JOIN labels l ON cl.label_id = l.id
                 WHERE cl.card_id = c.id
             ) as labels
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             LEFT JOIN users u ON c.created_by = u.id
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
             WHERE c.id = $1`,
            [newCard.id]
        );

        return finalCardQuery.rows[0];

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const archiveCard = async (cardId, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy thông tin card và kiểm tra quyền
        const cardQuery = await client.query(
            `SELECT c.*, col.board_id
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             WHERE c.id = $1`,
            [cardId]
        );
        
        if (cardQuery.rows.length === 0) {
            throw new Error('Card không tồn tại');
        }
        
        const card = cardQuery.rows[0];
        const boardId = card.board_id;
        
        // Kiểm tra card đã được archive chưa
        if (card.is_archived) {
            throw new Error('Card đã được archive');
        }
        
        // Kiểm tra người dùng có phải là member của board không
        const memberCheck = await client.query(
            `SELECT role FROM board_members
             WHERE board_id = $1 AND user_id = $2`,
            [boardId, userId]
        );
        
        if (memberCheck.rows.length === 0) {
            throw new Error('Bạn không phải là thành viên của board');
        }
        
        // Kiểm tra quyền archive dựa trên vai trò
        const isAdmin = memberCheck.rows[0].role === 'admin' || memberCheck.rows[0].role === 'owner';
        const isCreator = card.created_by === userId;
        
        if (!isAdmin && !isCreator) {
            throw new Error('Bạn không có quyền archive card này');
        }

        // Archive card
        const result = await client.query(
            `UPDATE cards 
             SET is_archived = TRUE, 
                 archived_at = CURRENT_TIMESTAMP,
                 archived_by = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 
             RETURNING *`,
            [cardId, userId]
        );

        // Ghi lại hoạt động archive
        await client.query(
            `INSERT INTO card_activities 
             (card_id, user_id, activity_type, activity_data) 
             VALUES ($1, $2, $3, $4)`,
            [
                cardId,
                userId,
                'archived',
                JSON.stringify({ 
                    archived_at: new Date().toISOString()
                })
            ]
        );

        await client.query('COMMIT');
        
        return {
            ...result.rows[0],
            board_id: boardId
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const unarchiveCard = async (cardId, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lấy thông tin card và kiểm tra quyền
        const cardQuery = await client.query(
            `SELECT c.*, col.board_id
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             WHERE c.id = $1`,
            [cardId]
        );
        
        if (cardQuery.rows.length === 0) {
            throw new Error('Card không tồn tại');
        }
        
        const card = cardQuery.rows[0];
        const boardId = card.board_id;
        
        // Kiểm tra card có được archive không
        if (!card.is_archived) {
            throw new Error('Card chưa được archive');
        }
        
        // Kiểm tra người dùng có phải là member của board không
        const memberCheck = await client.query(
            `SELECT role FROM board_members
             WHERE board_id = $1 AND user_id = $2`,
            [boardId, userId]
        );
        
        if (memberCheck.rows.length === 0) {
            throw new Error('Bạn không phải là thành viên của board');
        }
        
        // Kiểm tra quyền unarchive dựa trên vai trò
        const isAdmin = memberCheck.rows[0].role === 'admin' || memberCheck.rows[0].role === 'owner';
        const isCreator = card.created_by === userId;
        
        if (!isAdmin && !isCreator) {
            throw new Error('Bạn không có quyền unarchive card này');
        }

        // Unarchive card
        const result = await client.query(
            `UPDATE cards 
             SET is_archived = FALSE, 
                 archived_at = NULL,
                 archived_by = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 
             RETURNING *`,
            [cardId]
        );

        // Ghi lại hoạt động unarchive
        await client.query(
            `INSERT INTO card_activities 
             (card_id, user_id, activity_type, activity_data) 
             VALUES ($1, $2, $3, $4)`,
            [
                cardId,
                userId,
                'unarchived',
                JSON.stringify({ 
                    unarchived_at: new Date().toISOString()
                })
            ]
        );

        await client.query('COMMIT');
        
        // Lấy lại card với đầy đủ thông tin
        const finalCardQuery = await client.query(
            `SELECT c.*, 
             c.due_date::text as due_date,        -- Force string format
             c.start_date::text as start_date,    -- Force string format
             u.username as created_by_username,
             col.board_id,
             COALESCE(att_counts.count, 0) AS attachment_count,
             COALESCE(com_counts.count, 0) AS comment_count,
             (
                 SELECT json_agg(
                     json_build_object(
                         'id', l.id,
                         'name', l.name,
                         'color', l.color
                     )
                 )
                 FROM card_labels cl
                 JOIN labels l ON cl.label_id = l.id
                 WHERE cl.card_id = c.id
             ) as labels
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             LEFT JOIN users u ON c.created_by = u.id
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
             WHERE c.id = $1`,
            [cardId]
        );

        return finalCardQuery.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const getUserCards = async (userId) => {
    try {
        const result = await pool.query(
            `
            SELECT 
                c.id, c.title, c.description, 
                c.due_date::text as due_date,        -- Force string format
                c.start_date::text as start_date,    -- Force string format
                c.resolved_at::text as resolved_at, -- Force string format
                c.created_at, c.status, c.priority_level, c.difficulty_level, c.cover_img,
                col.title as column_name,
                b.id as board_id, b.name as board_name,
                u.username as assigned_to_name,
                creator.username as created_by_name,
                (SELECT json_agg(
                    json_build_object(
                        'id', l.id,
                        'name', l.name,
                        'color', l.color
                    )
                ) FROM card_labels cl 
                JOIN labels l ON cl.label_id = l.id 
                WHERE cl.card_id = c.id) as labels
            FROM cards c
            JOIN columns col ON c.column_id = col.id
            JOIN boards b ON col.board_id = b.id
            LEFT JOIN users u ON c.assigned_to = u.id
            LEFT JOIN users creator ON c.created_by = creator.id
            WHERE c.assigned_to = $1
                AND c.is_archived = FALSE
            ORDER BY 
                CASE 
                    WHEN c.due_date IS NOT NULL THEN c.due_date 
                    ELSE c.created_at 
                END ASC
            `,
            [userId]
        );
        
        return result.rows;
    } catch (error) {
        throw new Error('Lỗi khi lấy cards của user: ' + error.message);
    }
};

const getArchivedCardsByBoard = async (boardId, userId, options = {}) => {
    const { search = '', limit = 50, offset = 0 } = options;
    
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập board
        const permissionCheck = await client.query(
            `SELECT bm.role FROM board_members bm
             WHERE bm.board_id = $1 AND bm.user_id = $2
             UNION
             SELECT 'public' as role FROM boards b
             WHERE b.id = $1 AND b.visibility = 1`,
            [boardId, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Bạn không có quyền xem board này');
        }

        // Build query with search
        let whereClause = 'WHERE col.board_id = $1 AND c.is_archived = true';
        let queryParams = [boardId];
        
        if (search && search.trim()) {
            whereClause += ' AND (c.title ILIKE $2 OR c.description ILIKE $2)';
            queryParams.push(`%${search.trim()}%`);
        }

        // Add limit and offset
        const limitOffset = ` ORDER BY c.archived_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(limit, offset);

        // Lấy danh sách cards đã được archive
        const result = await client.query(
            `SELECT 
                c.id, c.title, c.description, c.created_at, c.archived_at,
                c.due_date::text as due_date,        -- Force string format
                c.cover_img, c.status, c.priority_level, c.difficulty_level,
                c.position, c.updated_at, c.resolved_at,
                col.id as column_id,
                col.title as column_name,
                creator.id as created_by,
                creator.username as created_by_username,
                creator.email as created_by_email,
                archiver.id as archived_by,
                archiver.username as archived_by_username,
                archiver.email as archived_by_email,
                assignee.id as assigned_to,
                assignee.username as assigned_to_username,
                assignee.email as assigned_to_email,
                (SELECT COUNT(*) FROM card_attachments ca 
                 WHERE ca.card_id = c.id AND ca.is_deleted = false) as attachment_count,
                (SELECT COUNT(*) FROM card_comments cc 
                 WHERE cc.card_id = c.id AND cc.is_deleted = false) as comment_count,
                (SELECT json_agg(
                    json_build_object(
                        'id', l.id,
                        'name', l.name,
                        'color', l.color
                    )
                ) FROM card_labels cl 
                JOIN labels l ON cl.label_id = l.id 
                WHERE cl.card_id = c.id) as labels
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             LEFT JOIN users creator ON c.created_by = creator.id
             LEFT JOIN users archiver ON c.archived_by = archiver.id
             LEFT JOIN users assignee ON c.assigned_to = assignee.id
             ${whereClause}
             ${limitOffset}`,
            queryParams
        );

        // Get total count for pagination
        let countQuery = `SELECT COUNT(*) as total FROM cards c
                         JOIN columns col ON c.column_id = col.id
                         ${whereClause.replace(limitOffset, '')}`;
        
        const countResult = await client.query(countQuery, queryParams.slice(0, -2)); // Remove limit and offset params
        const total = parseInt(countResult.rows[0].total);

        return {
            cards: result.rows,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                has_more: (parseInt(offset) + parseInt(limit)) < total
            }
        };

    } finally {
        client.release();
    }
};

const getWorkspaceCardsAnalytics = async (workspaceId, userId, days = 30) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập workspace
        const accessCheck = await client.query(
            'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
            [workspaceId, userId]
        );
        
        if (accessCheck.rows.length === 0) {
            throw new Error('Không có quyền truy cập workspace này');
        }

        // Query analytics data
        const analyticsQuery = `
            WITH workspace_cards AS (
                SELECT 
                    c.*,
                    u_assigned.id as assigned_user_id,
                    u_assigned.username as assigned_username,
                    u_assigned.full_name as assigned_full_name,
                    u_assigned.avatar as assigned_avatar

                FROM cards c
                JOIN columns col ON c.column_id = col.id
                JOIN boards b ON col.board_id = b.id
                LEFT JOIN users u_assigned ON c.assigned_to = u_assigned.id
                WHERE b.workspace_id = $1 
                    AND c.is_archived = false
                    AND c.created_at >= CURRENT_DATE - INTERVAL '${days} days'
            ),
            user_performance AS (
                SELECT 
                    COALESCE(wc.assigned_user_id, null) as user_id,
                    COALESCE(wc.assigned_username, '') as username,
                    COALESCE(wc.assigned_full_name, '') as full_name,
                    COALESCE(wc.assigned_avatar, '') as avatar,
                    
                    -- Tổng số cards
                    COUNT(wc.id) as total_cards,
                    
                    -- Cards hoàn thành
                    COUNT(wc.id) FILTER (WHERE wc.status = 'done') as completed_cards,
                    
                    -- Cards đang làm
                    COUNT(wc.id) FILTER (WHERE wc.status = 'in_progress') as in_progress_cards,
                    
                    -- Cards chưa bắt đầu
                    COUNT(wc.id) FILTER (WHERE wc.status = 'todo') as todo_cards,
                    
                    -- Cards quá hạn (chưa hoàn thành nhưng đã quá due_date)
                    COUNT(wc.id) FILTER (
                        WHERE wc.due_date < CURRENT_DATE 
                        AND wc.status != 'done'
                        AND wc.due_date IS NOT NULL
                    ) as overdue_cards,
                    
                    -- Cards hoàn thành đúng hạn
                    COUNT(wc.id) FILTER (
                        WHERE wc.status = 'done' 
                        AND wc.resolved_at IS NOT NULL 
                        AND wc.due_date IS NOT NULL
                        AND DATE(wc.resolved_at) <= wc.due_date
                    ) as on_time_completed,
                    
                    -- Cards hoàn thành trễ hạn
                    COUNT(wc.id) FILTER (
                        WHERE wc.status = 'done' 
                        AND wc.resolved_at IS NOT NULL 
                        AND wc.due_date IS NOT NULL
                        AND DATE(wc.resolved_at) > wc.due_date
                    ) as late_completed,
                    
                    -- Thời gian hoàn thành trung bình (tính bằng ngày)
                    AVG(
                        CASE 
                            WHEN wc.status = 'done' AND wc.resolved_at IS NOT NULL 
                            THEN EXTRACT(EPOCH FROM (wc.resolved_at - wc.created_at))/86400 
                            ELSE NULL 
                        END
                    ) as avg_completion_days,
                    
                    -- Cards theo priority
                    COUNT(wc.id) FILTER (WHERE wc.priority_level = 3) as high_priority_cards,
                    COUNT(wc.id) FILTER (WHERE wc.priority_level = 2) as medium_priority_cards,
                    COUNT(wc.id) FILTER (WHERE wc.priority_level = 1) as low_priority_cards
                    
                FROM workspace_cards wc
                WHERE (wc.assigned_user_id IS NOT NULL)
                GROUP BY 
                    COALESCE(wc.assigned_user_id, null),
                    COALESCE(wc.assigned_username, ''),
                    COALESCE(wc.assigned_full_name, ''),
                    COALESCE(wc.assigned_avatar, '')
            ),
            workspace_summary AS (
                SELECT 
                    COUNT(wc.id) as total_workspace_cards,
                    COUNT(wc.id) FILTER (WHERE wc.status = 'done') as total_completed_cards,
                    COUNT(wc.id) FILTER (WHERE wc.status = 'in_progress') as total_in_progress_cards,
                    COUNT(wc.id) FILTER (WHERE wc.status = 'todo') as total_todo_cards,
                    COUNT(wc.id) FILTER (
                        WHERE wc.due_date < CURRENT_DATE 
                        AND wc.status != 'done'
                        AND wc.due_date IS NOT NULL
                    ) as total_overdue_cards,
                    COUNT(DISTINCT wc.assigned_user_id) as active_users
                FROM workspace_cards wc
            )
            SELECT 
                json_build_object(
                    'user_performance', json_agg(
                        json_build_object(
                            'user_id', up.user_id,
                            'username', up.username,
                            'full_name', up.full_name,
                            'avatar', up.avatar,
                            'total_cards', up.total_cards,
                            'completed_cards', up.completed_cards,
                            'in_progress_cards', up.in_progress_cards,
                            'todo_cards', up.todo_cards,
                            'overdue_cards', up.overdue_cards,
                            'on_time_completed', up.on_time_completed,
                            'late_completed', up.late_completed,
                            'avg_completion_days', ROUND(up.avg_completion_days::numeric, 2),
                            'high_priority_cards', up.high_priority_cards,
                            'medium_priority_cards', up.medium_priority_cards,
                            'low_priority_cards', up.low_priority_cards
                        ) ORDER BY up.total_cards DESC
                    ),
                    'workspace_summary', (SELECT row_to_json(ws) FROM workspace_summary ws)
                ) as analytics_data
            FROM user_performance up
        `;

        const result = await client.query(analyticsQuery, [workspaceId]);
        
        if (result.rows.length === 0) {
            return {
                user_performance: [],
                workspace_summary: {
                    total_workspace_cards: 0,
                    total_completed_cards: 0,
                    total_in_progress_cards: 0,
                    total_todo_cards: 0,
                    total_overdue_cards: 0,
                    active_users: 0
                }
            };
        }

        return result.rows[0].analytics_data;

    } finally {
        client.release();
    }
};

export const CardModel = {
    createCard,
    getCardsByColumnId,
    getCardById,
    getCardDetails,
    updateCard,
    deleteCard,
    copyCard,
    archiveCard,
    unarchiveCard,
    getArchivedCardsByBoard,
    watchCard,
    unwatchCard,
    isUserWatchingCard,
    getCardWatchers,
    getUserCards,
    getWorkspaceCardsAnalytics, // Thêm function mới
};