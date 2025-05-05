import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createUser, findUserByEmail, verifyUser, findUserByToken, saveRefreshToken, findUserByRefreshToken, clearRefreshToken } from '../models/userModel.js';
import { sendVerificationEmail } from '../utils/email.js';
import { env } from '../config/environment.js'
import { HttpStatusCode } from '../utils/constants.js';

const register = async (req, res) => {
    const { username, email, password } = req.body;

    try {
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            return res.status(HttpStatusCode.OK).json({status: false, msg: 'Email đã được sử dụng' });
        }

        const verification_token = jwt.sign({ email }, env.JWT_SECRET, { expiresIn: '1h' });
        const user = await createUser({ username, email, password, verification_token });

        await sendVerificationEmail(email, verification_token);

        res.status(HttpStatusCode.OK).json({status: true, msg: 'Đăng ký thành công. Vui lòng kiểm tra email để xác thực.', user });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(HttpStatusCode.INTERNAL_SERVER).json({ msg: 'Lỗi server', error: err.message });
    }
};

const verifyEmail = async (req, res) => {
    const { token } = req.body;

    try {
        const user = await findUserByToken(token);
        if (!user) {
            return res.status(HttpStatusCode.OK).json({status: false, message: 'Token không hợp lệ hoặc đã hết hạn' });
        }

        const verifiedUser = await verifyUser(token);
        if (!verifiedUser) {
            return res.status(HttpStatusCode.OK).json({status: false, message: 'Tài khoản đã được xác thực hoặc token không hợp lệ' });
        }

        res.json({status: true, message: 'Xác thực email thành công', user: verifiedUser });
    } catch (err) {
        res.status(HttpStatusCode.INTERNAL_SERVER).json({ message: 'Lỗi server', error: err.message });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await findUserByEmail(email);
        if (!user) {
            return res.status(400).json({status: false, message: 'Email hoặc mật khẩu không đúng' });
        }

        if (!user.is_verified) {
            return res.status(403).json({status: false, message: 'Tài khoản chưa được xác thực. Vui lòng kiểm tra email.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({status: false, message: 'Email hoặc mật khẩu không đúng' });
        }

        const accessToken = jwt.sign(
            { id: user.id, username: user.username },
            env.ACCESS_TOKEN_SECRET,
            { expiresIn: env.ACCESS_TOKEN_EXPIRES }
        );

        const refreshToken = jwt.sign(
            { id: user.id, username: user.username },
            env.REFRESH_TOKEN_SECRET,
            { expiresIn: env.REFRESH_TOKEN_EXPIRES }
        );

        await saveRefreshToken(user.id, refreshToken);

        // Trả về thêm thông tin user
        const userInfo = {
            // id: user.id,
            username: user.username,
            email: user.email
        };

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'Strict', // Ngăn chặn CSRF
        });

        res.json({
            status: true,
            message: 'Đăng nhập thành công',
            accessToken,
            user: userInfo
        });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const refreshToken = async (req, res) => {
    const { refreshToken } = req.cookies; // Lấy refresh token từ cookie

    if (!refreshToken) {
        return res.status(403).json({ message: 'Thiếu refresh token' });
    }

    try {
        const user = await findUserByRefreshToken(refreshToken);
        if (!user) {
            return res.status(403).json({ message: 'Refresh token không hợp lệ' });
        }

        jwt.verify(refreshToken, env.REFRESH_TOKEN_SECRET, (err, decoded) => {
            if (err) {
                return res.status(403).json({ message: 'Refresh token không hợp lệ hoặc đã hết hạn' });
            }

            const accessToken = jwt.sign(
                { id: user.id, username: user.username },
                env.ACCESS_TOKEN_SECRET,
                { expiresIn: env.ACCESS_TOKEN_EXPIRES }
            );
            
            res.json({ message: 'Làm mới token thành công', accessToken });
        });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const logout = async (req, res) => {
    const refreshToken = req.cookies.refreshToken; // Lấy refresh token từ cookie

    if (!refreshToken) {
        return res.status(403).json({ message: 'Thiếu refresh token' });
    }

    try {
        const user = await findUserByRefreshToken(refreshToken);
        if (!user) {
            return res.status(403).json({ message: 'Refresh token không hợp lệ' });
        }

        // Xóa refresh token trong database
        await clearRefreshToken(user.id);
        res.clearCookie('refreshToken', { httpOnly: true, secure: false, sameSite: 'Strict' }); // Xóa cookie refresh token
        res.json({status: true, message: 'Đăng xuất thành công' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

export { register, verifyEmail, login, refreshToken, logout };