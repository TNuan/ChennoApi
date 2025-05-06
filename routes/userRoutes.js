import express from 'express';
import { UserController } from '../controllers/userController.js';
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
export default router;