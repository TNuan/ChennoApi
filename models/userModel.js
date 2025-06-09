import pool from '../config/db.js';
import bcrypt from 'bcrypt';

const createUser = async ({ username, email, password, verification_token }) => {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const result = await pool.query(
        'INSERT INTO users (username, email, password, verification_token, is_verified) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, is_verified, created_at',
        [username, email, hashedPassword, verification_token, false]
    );
    return result.rows[0];
};

const findUserByEmail = async (email) => {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
};

const searchUser = async (key) => {
    const query = `
        SELECT 
            id,
            username,
            email,
            created_at
        FROM users 
        WHERE username ILIKE $1 OR email ILIKE $1
        AND is_verified = true
        ORDER BY username
        LIMIT 10
    `;
    const result = await pool.query(query, [`${key}%`]);
    return result.rows;
};

const verifyUser = async (token) => {
    const result = await pool.query(
        'UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE verification_token = $1 AND is_verified = FALSE RETURNING id, username, email, is_verified',
        [token]
    );
    return result.rows[0];
};

const findUserByToken = async (token) => {
    const result = await pool.query('SELECT * FROM users WHERE verification_token = $1', [token]);
    return result.rows[0];
};

const saveRefreshToken = async (userId, refreshToken) => {
    const result = await pool.query(
        'UPDATE users SET refresh_token = $1 WHERE id = $2 RETURNING username, email',
        [refreshToken, userId]
    );
    return result.rows[0];
};

const findUserByRefreshToken = async (refreshToken) => {
    const result = await pool.query('SELECT * FROM users WHERE refresh_token = $1', [refreshToken]);
    return result.rows[0];
};

const clearRefreshToken = async (userId) => {
    await pool.query('UPDATE users SET refresh_token = NULL WHERE id = $1', [userId]);
};

const getUserProfile = async (userId) => {
    const result = await pool.query(
        'SELECT id, username, email, avatar, full_name, bio, phone, created_at FROM users WHERE id = $1',
        [userId]
    );
    return result.rows[0];
};

const updateUserProfile = async (userId, userData) => {
    const { username, full_name, bio, phone, avatar } = userData;
    const result = await pool.query(
        `UPDATE users SET 
            username = COALESCE($2, username),
            full_name = COALESCE($3, full_name),
            bio = COALESCE($4, bio),
            phone = COALESCE($5, phone),
            avatar = COALESCE($6, avatar),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 
        RETURNING id, username, email, avatar, full_name, bio, phone, created_at`,
        [userId, username, full_name, bio, phone, avatar]
    );
    return result.rows[0];
};

const checkUsernameExists = async (username, excludeUserId) => {
    const result = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, excludeUserId]
    );
    return result.rows.length > 0;
};

export const UserModel = { 
    createUser, 
    findUserByEmail, 
    searchUser, 
    verifyUser, 
    findUserByToken, 
    saveRefreshToken, 
    findUserByRefreshToken, 
    clearRefreshToken,
    getUserProfile,
    updateUserProfile,
    checkUsernameExists
};