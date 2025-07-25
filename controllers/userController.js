import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserModel }  from '../models/userModel.js';
import { sendVerificationEmail } from '../utils/email.js';
import { env } from '../config/environment.js'
import { HttpStatusCode } from '../utils/constants.js';

const register = async (req, res) => {
    const { username, email, password } = req.body;

    try {
        const existingUser = await UserModel.findUserByEmail(email);
        if (existingUser) {
            return res.status(HttpStatusCode.OK).json({status: false, msg: 'Email đã được sử dụng' });
        }

        const verification_token = jwt.sign({ email }, env.JWT_SECRET, { expiresIn: '1h' });
        const user = await UserModel.createUser({ username, email, password, verification_token });

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
        const user = await UserModel.findUserByToken(token);
        if (!user) {
            return res.status(HttpStatusCode.OK).json({status: false, message: 'Token không hợp lệ hoặc đã hết hạn' });
        }

        const verifiedUser = await UserModel.verifyUser(token);
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
        const user = await UserModel.findUserByEmail(email);
        if (!user) {
            return res.status(200).json({status: false, message: 'Email hoặc mật khẩu không đúng' });
        }

        if (!user.is_verified) {
            return res.status(200).json({status: false, message: 'Tài khoản chưa được xác thực. Vui lòng kiểm tra email.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(200).json({status: false, message: 'Email hoặc mật khẩu không đúng' });
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

        await UserModel.saveRefreshToken(user.id, refreshToken);

        // Trả về thêm thông tin user
        const userInfo = {
            // id: user.id,
            username: user.username,
            email: user.email,
            full_name: user.full_name || '',
            bio: user.bio || '',
            phone: user.phone || '',
            avatar: user.avatar || '',
            created_at: user.created_at
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
    console.log('Refresh token:', refreshToken); // Kiểm tra giá trị refreshToken

    if (!refreshToken) {
        return res.status(403).json({ message: 'Thiếu refresh token' });
    }

    try {
        const user = await UserModel.findUserByRefreshToken(refreshToken);
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
        const user = await UserModel.findUserByRefreshToken(refreshToken);
        if (!user) {
            return res.status(403).json({ message: 'Refresh token không hợp lệ' });
        }

        // Xóa refresh token trong database
        await UserModel.clearRefreshToken(user.id);
        res.clearCookie('refreshToken', { httpOnly: true, secure: false, sameSite: 'Strict' }); // Xóa cookie refresh token
        res.json({status: true, message: 'Đăng xuất thành công' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server', error: err.message });
    }
};

const searchUsers = async (req, res) => {
    const { key } = req.query;

    try {
        if (!key || key.length < 1) {
            return res.status(400).json({
                status: false,
                message: 'Vui lòng nhập ký tự để tìm kiếm'
            });
        }

        const users = await UserModel.searchUser(key);
        res.json({
            status: true,
            message: 'Tìm kiếm thành công',
            users
        });
    } catch (err) {
        res.status(400).json({
            status: false,
            message: err.message
        });
    }
};

const getProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const profile = await UserModel.getUserProfile(userId);
        
        if (!profile) {
            return res.status(404).json({
                status: false,
                message: 'Không tìm thấy thông tin người dùng'
            });
        }

        res.json({
            status: true,
            message: 'Lấy thông tin hồ sơ thành công',
            profile
        });
    } catch (err) {
        res.status(500).json({
            status: false,
            message: 'Lỗi server',
            error: err.message
        });
    }
};

const updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { username, full_name, bio, phone } = req.body;

        // Kiểm tra username đã tồn tại chưa (trừ user hiện tại)
        if (username) {
            const usernameExists = await UserModel.checkUsernameExists(username, userId);
            if (usernameExists) {
                return res.status(400).json({
                    status: false,
                    message: 'Tên người dùng đã được sử dụng'
                });
            }
        }

        const updatedProfile = await UserModel.updateUserProfile(userId, {
            username,
            full_name,
            bio,
            phone
        });

        res.json({
            status: true,
            message: 'Cập nhật hồ sơ thành công',
            profile: updatedProfile
        });
    } catch (err) {
        res.status(500).json({
            status: false,
            message: 'Lỗi server',
            error: err.message
        });
    }
};

const uploadAvatar = async (req, res) => {
    try {
        const userId = req.user.id;
        
        if (!req.file) {
            return res.status(400).json({
                status: false,
                message: 'Vui lòng chọn file avatar'
            });
        }

        const avatarPath = `/uploads/avatars/${req.file.filename}`;
        
        const updatedProfile = await UserModel.updateUserProfile(userId, {
            avatar: avatarPath
        });

        res.json({
            status: true,
            message: 'Cập nhật avatar thành công',
            profile: updatedProfile
        });
    } catch (err) {
        res.status(500).json({
            status: false,
            message: 'Lỗi server',
            error: err.message
        });
    }
};

export const UserController = { 
    register, 
    verifyEmail, 
    login, 
    refreshToken, 
    logout, 
    searchUsers,
    getProfile,
    updateProfile,
    uploadAvatar
};