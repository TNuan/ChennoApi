import express from 'express';
import { CardController } from '../controllers/cardController.js';
import authenticateToken from '../middleware/authMiddleware.js';
import { body, param, query, validationResult } from 'express-validator';

const router = express.Router();

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// ĐẶT ROUTE CỤ THỂ TRƯỚC ROUTE DYNAMIC PARAMETERS
// Lấy tất cả cards của user cho calendar
router.get('/my-cards', authenticateToken, CardController.getUserCards);

// Lấy chi tiết đầy đủ của card bao gồm các nhãn, tệp đính kèm, bình luận và hoạt động
router.get('/details/:id', authenticateToken, CardController.getCardDetails);

// Lấy danh sách archived cards theo board ID
router.get(
    '/archived/board/:boardId',
    authenticateToken,
    [
        param('boardId').isInt({ min: 1 }).withMessage('Board ID phải là số nguyên dương'),
        query('search').optional().isLength({ max: 255 }).withMessage('Search term quá dài'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit phải từ 1-100'),
        query('offset').optional().isInt({ min: 0 }).withMessage('Offset phải >= 0')
    ],
    validate,
    CardController.getArchivedCardsByBoard
);

// Copy card
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

// Watch/Unwatch card
router.patch('/:id/watch', authenticateToken, CardController.watchCard);
router.patch('/:id/unwatch', authenticateToken, CardController.unwatchCard);

// Archive card
router.patch('/:id/archive', authenticateToken, CardController.archiveCard);

// Unarchive card
router.patch('/:id/unarchive', authenticateToken, CardController.unarchiveCard);

// Get single card
router.get('/single/:id', authenticateToken, CardController.getById);

// ROUTES VỚI DYNAMIC PARAMETERS ĐẶT CUỐI CÙNG
router.post(
    '/',
    authenticateToken,
    [
        body('column_id').isInt().withMessage('Column ID phải là số'),
        body('title').notEmpty().withMessage('Tiêu đề card là bắt buộc'),
        body('position').optional().isInt().withMessage('Position phải là số')
    ],
    validate,
    CardController.create
);

// Route này phải đặt cuối vì nó sẽ match bất kỳ string nào
router.get('/:column_id', authenticateToken, CardController.getAll);

router.put(
    '/:id',
    authenticateToken,
    [
        body('position').optional().isInt().withMessage('Position phải là số'),
        body('column_id').optional().isInt().withMessage('Column ID phải là số')
    ],
    validate,
    CardController.update
);

router.delete('/:id', authenticateToken, CardController.remove);

export default router;