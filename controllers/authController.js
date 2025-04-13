import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createUser, findUserByEmail, verifyUser, findUserByToken, saveRefreshToken, findUserByRefreshToken, clearRefreshToken } from '../models/userModel.js';
import { sendVerificationEmail } from '../utils/email.js';
import { env } from '../config/environment.js'

const register = async (req, res) => {
    const { username, email, password } = req.body;

    try {
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ message: 'Email đã được sử dụng' });
        }

        const verification_token = jwt.sign({ email }, env.JWT_SECRET, { expiresIn: '1h' });
        const user = await createUser({ username, email, password, verification_token });

        await sendVerificationEmail(email, verification_token);

        res.status(201).json({ message: 'Đăng ký thành công. Vui lòng kiểm tra email để xác thực.', user });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const verifyEmail = async (req, res) => {
    const { token } = req.query;

    try {
        const user = await findUserByToken(token);
        if (!user) {
            return res.status(400).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
        }

        const verifiedUser = await verifyUser(token);
        if (!verifiedUser) {
            return res.status(400).json({ message: 'Tài khoản đã được xác thực hoặc token không hợp lệ' });
        }

        res.json({ message: 'Xác thực email thành công', user: verifiedUser });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await findUserByEmail(email);
        if (!user) {
            return res.status(400).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        if (!user.is_verified) {
            return res.status(403).json({ message: 'Tài khoản chưa được xác thực. Vui lòng kiểm tra email.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        const accessToken = jwt.sign(
            { id: user.id, username: user.username },
            env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        const refreshToken = jwt.sign(
            { id: user.id, username: user.username },
            env.JWT_SECRET,
            { expiresIn: '7d' } // Refresh token hết hạn sau 7 ngày
        );

        await saveRefreshToken(user.id, refreshToken);

        res.json({
            message: 'Đăng nhập thành công',
            accessToken,
            refreshToken,
        });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const refreshToken = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(401).json({ message: 'Thiếu refresh token' });
    }

    try {
        const user = await findUserByRefreshToken(refreshToken);
        if (!user) {
            return res.status(403).json({ message: 'Refresh token không hợp lệ' });
        }

        jwt.verify(refreshToken, env.JWT_SECRET, (err, decoded) => {
            if (err) {
                return res.status(403).json({ message: 'Refresh token không hợp lệ hoặc đã hết hạn' });
            }

            const accessToken = jwt.sign(
                { id: user.id, username: user.username },
                env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            res.json({ message: 'Làm mới token thành công', accessToken });
        });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const logout = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(401).json({ message: 'Thiếu refresh token' });
    }

    try {
        const user = await findUserByRefreshToken(refreshToken);
        if (!user) {
            return res.status(403).json({ message: 'Refresh token không hợp lệ' });
        }

        await clearRefreshToken(user.id);
        res.json({ message: 'Đăng xuất thành công' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

export { register, verifyEmail, login, refreshToken, logout };