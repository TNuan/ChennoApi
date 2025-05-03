import nodemailer from 'nodemailer';
import { env } from '../config/environment.js'

const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASS,
    },
});

const sendVerificationEmail = async (email, token) => {
    console.log('Sending verification email to:', email);
    console.log('Verification token:', token);
    const verificationUrl = `http://localhost:3001/verify-email?token=${token}`;
    const mailOptions = {
        from: env.EMAIL_USER,
        to: email,
        subject: 'Xác thực tài khoản của bạn',
        html: `
            <h2>Xác thực email</h2>
            <p>Vui lòng click vào link sau để xác thực tài khoản:</p>
            <a href="${verificationUrl}">${verificationUrl}</a>
            <p>Link này sẽ hết hạn sau 1 giờ.</p>
        `,
    };

    await transporter.sendMail(mailOptions);
};

export { sendVerificationEmail };