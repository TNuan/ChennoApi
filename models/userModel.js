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

export { createUser, findUserByEmail, verifyUser, findUserByToken, saveRefreshToken, findUserByRefreshToken, clearRefreshToken };