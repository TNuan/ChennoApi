import express from 'express';
import { body, param, validationResult } from 'express-validator';
import authenticateToken from '../middleware/authMiddleware.js';
import { LabelController } from '../controllers/labelController.js';

const router = express.Router();

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Tạo nhãn mới
router.post('/',
    authenticateToken,
    [
        body('board_id').isInt().withMessage('Board ID phải là số'),
        body('name').notEmpty().withMessage('Tên nhãn là bắt buộc'),
        body('color').optional().isString().withMessage('Màu phải là chuỗi')
    ],
    validate,
    LabelController.create
);

// Lấy danh sách nhãn của một board
router.get('/board/:board_id',
    authenticateToken,
    [
        param('board_id').isInt().withMessage('Board ID phải là số')
    ],
    validate,
    LabelController.getAll
);

// Cập nhật nhãn
router.put('/:id',
    authenticateToken,
    [
        param('id').isInt().withMessage('Label ID phải là số'),
        body('name').optional().notEmpty().withMessage('Tên nhãn không được trống'),
        body('color').optional().isString().withMessage('Màu phải là chuỗi')
    ],
    validate,
    LabelController.update
);

// Xóa nhãn
router.delete('/:id',
    authenticateToken,
    [
        param('id').isInt().withMessage('Label ID phải là số'),
    ],
    validate,
    LabelController.remove
);

// Thêm nhãn vào card
router.post('/card',
    authenticateToken,
    [
        body('card_id').isInt().withMessage('Card ID phải là số'),
        body('label_id').isInt().withMessage('Label ID phải là số')
    ],
    validate,
    LabelController.addToCard
);

// Xóa nhãn khỏi card
router.delete('/card/:card_id/:label_id',
    authenticateToken,
    [
        param('card_id').isInt().withMessage('Card ID phải là số'),
        param('label_id').isInt().withMessage('Label ID phải là số')
    ],
    validate,
    LabelController.removeFromCard
);

// Lấy danh sách nhãn của một card
router.get('/card/:card_id',
    authenticateToken,
    [
        param('card_id').isInt().withMessage('Card ID phải là số')
    ],
    validate,
    LabelController.getCardLabels
);

export default router;