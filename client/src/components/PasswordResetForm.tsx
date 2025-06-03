import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import '../styles/PasswordResetForm.css';

export default function PasswordResetForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      await axios.post('http://localhost:5001/api/reset-password', {
        token,
        password
      });
      setSuccess(true);
      setTimeout(() => {
        navigate('/');
      }, 2000);
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        setError(error.response.data.error);
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  };

  if (!token) {
    return (
      <div className="password-reset-wrapper">
        <div className="password-reset-container">
          <div className="password-reset-header">
            <h1 className="password-reset-title">Reset Password</h1>
            <p className="password-reset-message">Invalid or expired reset link.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="password-reset-wrapper">
      <div className="password-reset-container">
        <div className="password-reset-header">
          <h1 className="password-reset-title">Reset Password</h1>
          <p className="password-reset-message">
            Reset your password 🔐<br />
            Please enter your new password below.
          </p>
        </div>
        <div className="password-reset-panel">
          <form onSubmit={handleSubmit} className="password-reset-form">
            <label htmlFor="password">New Password:</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <label htmlFor="confirmPassword">Confirm New Password:</label>
            <input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />

            {error && <div className="error-message">{error}</div>}
            {success && (
              <div className="success-message">
                Password reset successful! Redirecting to login...
              </div>
            )}

            <button type="submit" className="password-reset-submit">
              Reset Password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
} 