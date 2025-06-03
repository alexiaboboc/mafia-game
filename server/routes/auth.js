import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import User from '../models/User.js';

const router = express.Router();

// Forgot Password endpoint
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, source } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    console.log('Processing forgot password request for email:', email);
    console.log('Request source:', source);

    const user = await User.findOne({ email });

    if (!user) {
      // For security reasons, we don't want to reveal if an email exists or not
      console.log('No user found with email:', email);
      return res.json({ message: 'If an account exists with this email, you will receive password reset instructions.' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // Token valid for 1 hour

    // Save token to user
    user.resetToken = resetToken;
    user.resetTokenExpiry = resetTokenExpiry;
    await user.save();

    console.log('Reset token generated for user:', user.username);

    // Check if this is a request from the account page
    if (source === 'account') {
      console.log('Request is from account page, returning token only');
      return res.json({ token: resetToken });
    }

    // If not from account page, proceed with email sending (forgot password flow)
    console.log('Proceeding with email sending for forgot password flow');
    try {
      // Create email transporter
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });

      // Email content
      const resetUrl = `http://localhost:3000/reset-password?token=${resetToken}`;
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Password Reset Request - Mafia Game',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #b60056;">Password Reset Request</h1>
            <p>Hello ${user.username},</p>
            <p>You requested a password reset for your Mafia Game account. Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #b60056; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this, please ignore this email.</p>
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <p style="color: #666; font-size: 12px;">This is an automated message, please do not reply to this email.</p>
          </div>
        `
      };

      // Send email
      await transporter.sendMail(mailOptions);
      console.log('Reset email sent to:', email);
      res.json({ message: 'If an account exists with this email, you will receive password reset instructions.' });
    } catch (emailError) {
      console.error('Error sending reset email:', emailError);
      // Even if email fails, we still return success to not reveal if the email exists
      res.json({ message: 'If an account exists with this email, you will receive password reset instructions.' });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Error processing password reset request.' });
  }
});

// Reset Password endpoint
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    // Find user with valid reset token
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user's password and clear reset token
    user.password = hashedPassword;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ message: 'Password has been reset successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Error resetting password.' });
  }
});

export default router; 