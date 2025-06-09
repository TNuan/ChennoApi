import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { UserController } from '../controllers/userController.js';
import authenticateToken from '../middleware/authMiddleware.js';
import { body, validationResult } from 'express-validator';

const router = express.Router();

// Cấu hình multer cho upload avatar
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'uploads/avatars';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `avatar-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const uploadAvatar = multer({
    storage: avatarStorage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file ảnh (JPEG, PNG, GIF)'), false);
        }
    }
});

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

router.post(
    '/register',
    [
        body('username').notEmpty().withMessage('Username là bắt buộc'),
        body('email').isEmail().withMessage('Email không hợp lệ'),
        body('password').isLength({ min: 6 }).withMessage('Mật khẩu phải có ít nhất 6 ký tự'),
    ],
    validate,
    UserController.register
);

router.post('/verify-email', UserController.verifyEmail);

router.post(
    '/login',
    [
        body('email').isEmail().withMessage('Email không hợp lệ'),
        body('password').notEmpty().withMessage('Mật khẩu là bắt buộc'),
    ],
    validate,
    UserController.login
);

router.post('/refresh-token', UserController.refreshToken);

router.post('/logout', UserController.logout);

router.get('/search', authenticateToken, UserController.searchUsers);

// Profile routes
router.get('/profile', authenticateToken, UserController.getProfile);

router.put('/profile', 
    authenticateToken,
    [
        body('username').optional().isLength({ min: 3, max: 50 }).withMessage('Tên người dùng phải từ 3-50 ký tự'),
        body('full_name').optional().isLength({ max: 100 }).withMessage('Họ tên không được quá 100 ký tự'),
        body('bio').optional().isLength({ max: 500 }).withMessage('Tiểu sử không được quá 500 ký tự'),
        body('phone').optional().custom((value) => {
            // Cho phép trường rỗng hoặc null
            if (!value || value.trim() === '') {
                return true;
            }
            // Kiểm tra định dạng số điện thoại Việt Nam
            const phoneRegex = /^(0|\+84)[3|5|7|8|9][0-9]{8}$/;
            if (!phoneRegex.test(value)) {
                throw new Error('Số điện thoại không hợp lệ');
            }
            return true;
        })
    ],
    validate,
    UserController.updateProfile
);

router.post('/profile/avatar', 
    authenticateToken, 
    uploadAvatar.single('avatar'), 
    UserController.uploadAvatar
);

export default router;