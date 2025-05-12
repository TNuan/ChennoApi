import express from 'express';
import { body, param, validationResult } from 'express-validator';
import authenticateToken from '../middleware/authMiddleware.js';
import { CommentController } from '../controllers/commentController.js';

const router = express.Router();

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Thêm bình luận mới
router.post('/',
    authenticateToken,
    [
        body('card_id').isInt().withMessage('Card ID phải là số'),
        body('content').notEmpty().withMessage('Nội dung bình luận không được trống'),
        body('parent_id').optional().isInt().withMessage('Parent ID phải là số')
    ],
    validate,
    CommentController.create
);

// Lấy danh sách bình luận của một card
router.get('/card/:card_id',
    authenticateToken,
    [
        param('card_id').isInt().withMessage('Card ID phải là số')
    ],
    validate,
    CommentController.getAll
);

// Cập nhật bình luận
router.put('/:id',
    authenticateToken,
    [
        param('id').isInt().withMessage('Comment ID phải là số'),
        body('content').notEmpty().withMessage('Nội dung bình luận không được trống')
    ],
    validate,
    CommentController.update
);

// Xóa bình luận
router.delete('/:id',
    authenticateToken,
    [
        param('id').isInt().withMessage('Comment ID phải là số'),
    ],
    validate,
    CommentController.remove
);

export default router;