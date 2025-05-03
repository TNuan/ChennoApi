import express from 'express';
import { register, verifyEmail, login, refreshToken, logout } from '../controllers/authController.js';
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
    register
);

router.post('/verify-email', verifyEmail);

router.post(
    '/login',
    [
        body('email').isEmail().withMessage('Email không hợp lệ'),
        body('password').notEmpty().withMessage('Mật khẩu là bắt buộc'),
    ],
    validate,
    login
);

router.post('/refresh-token', refreshToken);

router.post('/logout', logout);

export default router;