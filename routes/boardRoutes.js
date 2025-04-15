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

router.get('/:workspace_id', authenticateToken, BoardController.getAll);

router.get('/single/:id', authenticateToken, BoardController.getById);

router.put(
    '/:id',
    authenticateToken,
    [body('name').notEmpty().withMessage('Tên board là bắt buộc')],
    validate,
    BoardController.update
);

router.delete('/:id', authenticateToken, BoardController.remove);

export default router;