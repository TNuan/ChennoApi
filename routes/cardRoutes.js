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
        // body('title').optional().withMessage('Tiêu đề card là bắt buộc'),
        body('position').optional().isInt().withMessage('Position phải là số'),
        body('column_id').optional().isInt().withMessage('Column ID phải là số'),
    ],
    validate,
    CardController.update
);

router.delete('/:id', authenticateToken, CardController.remove);

// Thêm route copy card
router.post(
    '/copy/:id',
    authenticateToken,
    [
        body('target_column_id').isInt().withMessage('Target column ID phải là số'),
        body('copy_labels').optional().isBoolean().withMessage('Copy labels phải là boolean'),
        body('copy_attachments').optional().isBoolean().withMessage('Copy attachments phải là boolean'),
    ],
    validate,
    CardController.copyCard
);

// Archive card
router.patch('/:id/archive', authenticateToken, CardController.archiveCard);

// Unarchive card
router.patch('/:id/unarchive', authenticateToken, CardController.unarchiveCard);

// Watch/Unwatch card
router.patch('/:id/watch', authenticateToken, CardController.watchCard);
router.patch('/:id/unwatch', authenticateToken, CardController.unwatchCard);

export default router;