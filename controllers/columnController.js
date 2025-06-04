import { ColumnModel } from '../models/columnModel.js';
import { socketIO } from '../index.js';
import { emitBoardChange } from '../services/socketService.js';

const create = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, board_id } = req.body;
    
    if (!title || !board_id) {
      return res.status(400).json({ error: 'Title và board_id là bắt buộc' });
    }
    
    const newColumn = await ColumnModel.createColumn({
      title,
      board_id,
      created_by: userId
    });
    
    // Đảm bảo column trả về có thuộc tính cards
    const columnWithCards = {
      ...newColumn,
      cards: [] // Luôn khởi tạo cards array rỗng
    };
    
    res.status(201).json({ 
      message: 'Tạo column thành công', 
      column: columnWithCards 
    });

    // Emit socket event với column đã có cards array
    if (board_id && socketIO) {
      emitBoardChange(socketIO, board_id, 'column_add', columnWithCards, userId);
    }
    
  } catch (error) {
    console.error('Column creation error:', error);
    res.status(400).json({ error: error.message });
  }
};

const getAll = async (req, res) => {
    const { board_id } = req.params;
    const userId = req.user.id;

    try {
        const columns = await ColumnModel.getColumnsByBoardId(board_id, userId);
        res.json({ message: 'Lấy danh sách columns thành công', columns });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const getById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const column = await ColumnModel.getColumnById(id, userId);
        if (!column) {
            return res.status(404).json({ message: 'Column không tồn tại hoặc bạn không có quyền truy cập' });
        }
        res.json({ message: 'Lấy column thành công', column });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const update = async (req, res) => {
    const { id } = req.params;
    const { title, position } = req.body;
    const userId = req.user.id;

    try {
        const column = await ColumnModel.updateColumn(id, userId, { title, position });
        if (!column) {
            return res.status(403).json({ message: 'Column không tồn tại hoặc bạn không có quyền cập nhật' });
        }

        // Thông báo thay đổi cho tất cả người dùng trong board
        // emitBoardChange(socketIO, column.board_id, 'update_column', column, userId);
        if (position !== undefined) { // Nếu có thay đổi vị trí
            const columns = await ColumnModel.getColumnsByBoardId(column.board_id, userId);
            emitBoardChange(socketIO, column.board_id, 'column_order', columns, userId);
        } else { // Nếu chỉ cập nhật title
            emitBoardChange(socketIO, column.board_id, 'column_update', column, userId);
        }

        res.json({ message: 'Cập nhật column thành công', column });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const remove = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const column = await ColumnModel.deleteColumn(id, userId);
        if (!column) {
            return res.status(403).json({ message: 'Column không tồn tại hoặc bạn không có quyền xóa' });
        }

        // Thông báo xóa column cho tất cả người dùng trong board
        emitBoardChange(socketIO, column.board_id, 'delete_column', { id }, userId);

        res.json({ message: 'Xóa column thành công' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

export const ColumnController = {
    create,
    getAll,
    getById,
    update,
    remove,
};