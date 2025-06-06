import jwt from 'jsonwebtoken';
import { env } from '../config/environment.js';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Lấy token từ "Bearer <token>"

    if (!token) {
        return res.status(401).json({ message: 'Không có token' });
    }

    jwt.verify(token, env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) {
            return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
        }
        req.user = user; // Lưu thông tin user vào req
        next();
    });
};

export default authenticateToken;