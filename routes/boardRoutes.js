import express from 'express';
import { BoardController } from '../controllers/boardController.js';
import authenticateToken from '../middleware/authMiddleware.js';
import { body, validationResult } from 'express-validator';

const router = express.Router();

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

router.post(
    '/',
    authenticateToken,
    [
        body('workspace_id').isInt().withMessage('Workspace ID phải là số'),
        body('name').notEmpty().withMessage('Tên board là bắt buộc'),
    ],
    validate,
    BoardController.create
);

// Các routes hiện có
router.get('/:workspace_id', authenticateToken, BoardController.getAll);
router.get('/single/:id', authenticateToken, BoardController.getById);
router.put('/:id', authenticateToken, validate, BoardController.update);
router.delete('/:id', authenticateToken, BoardController.remove);
router.get('/user/boards', authenticateToken, BoardController.getBoardsByUser);
router.get('/user/recent-boards', authenticateToken, BoardController.getRecentlyViewedBoards);
router.get('/user/favorite-boards', authenticateToken, BoardController.getFavoriteBoards);
router.patch('/user/favorite-boards/:board_id', authenticateToken, BoardController.toggleFavoriteBoard);
router.get('/user/workspaces', authenticateToken, BoardController.getAllWorkspaces);

// Board Members APIs
router.post('/:board_id/members', authenticateToken, BoardController.addMember);
// Thêm 2 API mới
router.put('/:board_id/members/:user_id', authenticateToken, BoardController.updateMember);
router.delete('/:board_id/members/:user_id', authenticateToken, BoardController.removeMember);

export default router;