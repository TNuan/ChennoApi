import express from 'express';
import { ColumnController } from '../controllers/columnController.js';
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
        body('board_id').isInt().withMessage('Board ID phải là số'),
        body('title').notEmpty().withMessage('Tên column là bắt buộc'),
        body('position').optional().isInt().withMessage('Position phải là số'),
    ],
    validate,
    ColumnController.create
);

router.get('/:board_id', authenticateToken, ColumnController.getAll);

router.get('/single/:id', authenticateToken, ColumnController.getById);

router.put(
    '/:id',
    authenticateToken,
    [
        body('title').notEmpty().withMessage('Tên column là bắt buộc'),
        body('position').optional().isInt().withMessage('Position phải là số'),
    ],
    validate,
    ColumnController.update
);

router.delete('/:id', authenticateToken, ColumnController.remove);

export default router;