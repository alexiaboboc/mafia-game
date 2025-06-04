import React, { useState } from "react";
import "../styles/LoginRegisterPanel.css";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { connectSocket } from "../socket";

interface Props {
  show?: boolean;
}

export default function LoginRegisterPanel({ show = false }: Props) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNotification, setShowNotification] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (isRegister) {
        const response = await axios.post("http://localhost:5001/api/register", {
          username,
          email,
          password,
        });
        console.log("Register success:", response.data);
        alert("Account created successfully! :D");
        setIsRegister(false);
      } else {
        const response = await axios.post("http://localhost:5001/api/login", {
          email,
          password,
        });
        console.log("User info from backend:", response.data.user);

        console.log("Login success:", response.data);
        console.log("Storing:", response.data.user);
        sessionStorage.setItem("username", response.data.user.username);
        sessionStorage.setItem("email", response.data.user.email);
        sessionStorage.setItem("id", response.data.user.id);

        // Connect socket after successful login
        connectSocket(response.data.user.id);
        
        navigate("/menu");
      }
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        alert(`❌ ${error.response.data.error}`);
      } else {
        alert("❌ Something went wrong.");
      }
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      alert("Please enter your email address first");
      return;
    }

    try {
      const response = await axios.post("http://localhost:5001/api/forgot-password", { email });
      console.log("Forgot password response:", response.data);
      alert("If an account exists with this email, you will receive password reset instructions.");
    } catch (error: any) {
      console.error("Forgot password error:", error);
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        alert(`❌ ${error.response.data.error}`);
      } else {
        alert("❌ Something went wrong while processing your request.");
      }
    }
  };

  return (
    <div className={`auth-wrapper ${show ? "fade-in" : ""}`}>
      <div className="auth-container">
        <div className="auth-header">
          {isRegister ? (
            <p className="auth-message">
              Welcome to the family! 💎 We hope you'll enjoy your time. <br />Please fill in the details below to register and join the game.
            </p>
          ) : (
            <p className="auth-message">
              Hi, dear guest! 🥀 We're thrilled to have you. <br />
              Please enter your login details below to access the game.
            </p>
          )}
        </div>
        <div
          className={`auth-panel ${isRegister ? "expanded register-mode" : "signin-mode"}`}
        >

          <div className={`auth-toggle ${isRegister ? "register-active" : "signin-active"}`}>
            <div className={`auth-slider ${isRegister ? "right" : ""}`} />
            <button
              className={`auth-btn ${!isRegister ? "active" : ""} login-btn`}
              onClick={() => setIsRegister(false)}
            >
              Sign In
            </button>
            <button
              className={`auth-btn ${isRegister ? "active" : ""} register-btn`}
              onClick={() => setIsRegister(true)}
            >
              Register
            </button>
          </div>


          <form onSubmit={handleSubmit} className="auth-form">
            {isRegister && (
              <>
                <label htmlFor="username">Choose a username:</label>
                <input
                  id="username"
                  type="text"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </>
            )}

            <label htmlFor="email">Enter your email:</label>
            <input
              id="email"
              type="email"
              placeholder="username@engine.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <label htmlFor="password">Enter your password:</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {!isRegister && (
              <div className="forgot-password">
                <button 
                  type="button" 
                  onClick={handleForgotPassword}
                  className="forgot-password-link"
                >
                  Forgot your password?
                </button>
              </div>
            )}

            {isRegister && (
              <>
                <label htmlFor="confirmPassword">Confirm your password:</label>
                <input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </>
            )}

            {showNotification && (
              <div className="notification">
                An email has been sent to {email} with password reset instructions.
              </div>
            )}

            <button
              type="submit"
              className={`submit-btn ${isRegister ? "register" : ""}`}
            >
              {isRegister ? "Register" : "Sign In"}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
