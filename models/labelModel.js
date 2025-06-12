import pool from '../config/db.js';

// Tạo một label mới
const createLabel = async ({ board_id, name, color, created_by }) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập trước khi tạo nhãn
        const permissionCheck = await client.query(
            `SELECT role FROM board_members 
            WHERE board_id = $1 AND user_id = $2`,
            [board_id, created_by]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền tạo nhãn cho bảng này');
        }

        const result = await client.query(
            `INSERT INTO labels (board_id, name, color, created_by) 
            VALUES ($1, $2, $3, $4) 
            RETURNING *`,
            [board_id, name, color || '#808080', created_by]
        );

        return result.rows[0];
    } finally {
        client.release();
    }
};

// Lấy danh sách labels của một board
const getLabelsByBoardId = async (board_id, userId) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM board_members bm
            WHERE bm.board_id = $1 AND bm.user_id = $2
            UNION
            SELECT 'member' as role FROM boards b
            JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
            WHERE b.id = $1 AND wm.user_id = $2
            UNION
            SELECT 'public' as role FROM boards
            WHERE id = $1 AND visibility = 1`,
            [board_id, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền xem nhãn của bảng này');
        }

        const labels = await client.query(
            `SELECT l.*, 
             u.username as created_by_username,
             (SELECT COUNT(*) FROM card_labels cl WHERE cl.label_id = l.id) as usage_count
             FROM labels l
             LEFT JOIN users u ON l.created_by = u.id
             WHERE l.board_id = $1
             ORDER BY l.name`,
            [board_id]
        );

        return labels.rows;
    } finally {
        client.release();
    }
};

// Cập nhật một label
const updateLabel = async (labelId, userId, { name, color }) => {
    const client = await pool.connect();
    try {
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM labels l
            JOIN boards b ON l.board_id = b.id
            JOIN board_members bm ON b.id = bm.board_id
            WHERE l.id = $1 AND bm.user_id = $2 AND bm.role IN ('owner', 'admin')`,
            [labelId, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền cập nhật nhãn này');
        }

        const updateFields = [];
        const values = [labelId];
        let valueIndex = 2;

        if (name !== undefined) {
            updateFields.push(`name = $${valueIndex++}`);
            values.push(name);
        }

        if (color !== undefined) {
            updateFields.push(`color = $${valueIndex++}`);
            values.push(color);
        }

        if (updateFields.length === 0) {
            throw new Error('Không có thông tin để cập nhật');
        }

        const result = await client.query(
            `UPDATE labels
            SET ${updateFields.join(', ')}
            WHERE id = $1
            RETURNING *`,
            values
        );

        return result.rows[0];
    } finally {
        client.release();
    }
};

// Xóa một label
const deleteLabel = async (labelId, userId) => {
    const client = await pool.connect();
    try {
        // Lấy board_id trước để trả về sau khi xóa
        const boardIdQuery = await client.query(
            `SELECT board_id FROM labels WHERE id = $1`,
            [labelId]
        );
        
        if (boardIdQuery.rows.length === 0) {
            throw new Error('Nhãn không tồn tại');
        }
        
        const boardId = boardIdQuery.rows[0].board_id;
        
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM board_members bm
            WHERE bm.board_id = $1 AND bm.user_id = $2 AND bm.role IN ('owner', 'admin')`,
            [boardId, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền xóa nhãn này');
        }

        // Xóa tất cả liên kết với card trước
        await client.query(
            `DELETE FROM card_labels WHERE label_id = $1`,
            [labelId]
        );

        // Xóa nhãn
        await client.query(
            `DELETE FROM labels WHERE id = $1`,
            [labelId]
        );

        return { board_id: boardId };
    } finally {
        client.release();
    }
};

// Thêm label vào card
const addLabelToCard = async (card_id, label_id, userId) => {
    const client = await pool.connect();
    try {
        // Lấy thông tin board từ card
        const boardQuery = await client.query(
            `SELECT b.id as board_id, l.name as label_name 
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             JOIN boards b ON col.board_id = b.id
             JOIN labels l ON l.id = $2
             WHERE c.id = $1`,
            [card_id, label_id]
        );
        
        if (boardQuery.rows.length === 0) {
            throw new Error('Card hoặc nhãn không tồn tại');
        }
        
        const boardId = boardQuery.rows[0].board_id;
        const labelName = boardQuery.rows[0].label_name;
        
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM board_members bm
            WHERE bm.board_id = $1 AND bm.user_id = $2`,
            [boardId, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền thêm nhãn vào card này');
        }

        // Kiểm tra nhãn này có thuộc board không
        const labelCheck = await client.query(
            `SELECT * FROM labels
            WHERE id = $1 AND board_id = $2`,
            [label_id, boardId]
        );

        if (labelCheck.rows.length === 0) {
            throw new Error('Nhãn này không thuộc bảng của card');
        }

        // Thêm liên kết giữa card và label
        await client.query(
            `INSERT INTO card_labels (card_id, label_id, added_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (card_id, label_id) DO NOTHING`,
            [card_id, label_id, userId]
        );

        return { 
            board_id: boardId, 
            card_id, 
            label_id, 
            label_name: labelName,
            label_color: labelCheck.rows[0].color
        };
    } finally {
        client.release();
    }
};

// Xóa label khỏi card
const removeLabelFromCard = async (card_id, label_id, userId) => {
    const client = await pool.connect();
    try {
        // Lấy thông tin board từ card
        const boardQuery = await client.query(
            `SELECT b.id as board_id, l.name as label_name 
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             JOIN boards b ON col.board_id = b.id
             JOIN labels l ON l.id = $2
             WHERE c.id = $1`,
            [card_id, label_id]
        );
        
        if (boardQuery.rows.length === 0) {
            throw new Error('Card hoặc nhãn không tồn tại');
        }
        
        const boardId = boardQuery.rows[0].board_id;
        const labelName = boardQuery.rows[0].label_name;
        
        // Kiểm tra quyền truy cập
        const permissionCheck = await client.query(
            `SELECT bm.role FROM board_members bm
            WHERE bm.board_id = $1 AND bm.user_id = $2`,
            [boardId, userId]
        );

        if (permissionCheck.rows.length === 0) {
            throw new Error('Không có quyền xóa nhãn khỏi card này');
        }

        // Xóa liên kết giữa card và label
        await client.query(
            `DELETE FROM card_labels
            WHERE card_id = $1 AND label_id = $2`,
            [card_id, label_id]
        );

        return { board_id: boardId };
    } finally {
        client.release();
    }
};

// Lấy labels của một card
const getCardLabels = async (card_id, userId) => {
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
            throw new Error('Không có quyền xem nhãn của card này');
        }

        const labels = await client.query(
            `SELECT l.* FROM labels l
            JOIN card_labels cl ON l.id = cl.label_id
            WHERE cl.card_id = $1
            ORDER BY l.name`,
            [card_id]
        );

        return labels.rows;
    } finally {
        client.release();
    }
};

export const LabelModel = {
    createLabel,
    getLabelsByBoardId,
    updateLabel,
    deleteLabel,
    addLabelToCard,
    removeLabelFromCard,
    getCardLabels
};