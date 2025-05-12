import express from 'express';
import { CardController } from '../controllers/cardController.js';
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
        body('column_id').isInt().withMessage('Column ID phải là số'),
        body('title').notEmpty().withMessage('Tiêu đề card là bắt buộc'),
        body('position').optional().isInt().withMessage('Position phải là số'),
        body('assigned_to').optional().isInt().withMessage('Người được giao phải là ID hợp lệ'),
        body('due_date').optional().isISO8601().withMessage('Ngày hết hạn phải đúng định dạng ISO8601'),
    ],
    validate,
    CardController.create
);

router.get('/:column_id', authenticateToken, CardController.getAll);

router.get('/single/:id', authenticateToken, CardController.getById);

// Lấy chi tiết đầy đủ của card bao gồm các nhãn, tệp đính kèm, bình luận và hoạt động
router.get('/details/:id', authenticateToken, CardController.getCardDetails);

router.put(
    '/:id',
    authenticateToken,
    [
        body('title').notEmpty().withMessage('Tiêu đề card là bắt buộc'),
        body('position').optional().isInt().withMessage('Position phải là số'),
        body('column_id').optional().isInt().withMessage('Column ID phải là số'),
        body('assigned_to').optional().isInt().withMessage('Người được giao phải là ID hợp lệ'),
        body('due_date').optional().isISO8601().withMessage('Ngày hết hạn phải đúng định dạng ISO8601'),
    ],
    validate,
    CardController.update
);

router.delete('/:id', authenticateToken, CardController.remove);

export default router;