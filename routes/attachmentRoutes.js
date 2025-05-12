import express from 'express';
import multer from 'multer';
import path from 'path';
import { body, param, validationResult } from 'express-validator';
import authenticateToken from '../middleware/authMiddleware.js';
import { AttachmentController } from '../controllers/attachmentController.js';

const router = express.Router();

// Cấu hình lưu trữ upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Upload tệp đính kèm
router.post('/',
    authenticateToken,
    upload.single('file'),
    [
        body('card_id').isInt().withMessage('Card ID phải là số'),
    ],
    validate,
    AttachmentController.upload
);

// Lấy danh sách tệp đính kèm của một card
router.get('/card/:card_id',
    authenticateToken,
    [
        param('card_id').isInt().withMessage('Card ID phải là số')
    ],
    validate,
    AttachmentController.getAll
);

// Xóa tệp đính kèm
router.delete('/:id',
    authenticateToken,
    [
        param('id').isInt().withMessage('Attachment ID phải là số'),
    ],
    validate,
    AttachmentController.remove
);

export default router;