import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Account.css";
import axios from "axios";
import { disconnectSocket } from "../socket";

export default function Account() {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string | null>("");
  const [email, setEmail] = useState<string | null>("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const storedUsername = sessionStorage.getItem("username");
    const storedEmail = sessionStorage.getItem("email");
    console.log("Stored email:", storedEmail);
    setUsername(storedUsername);
    setEmail(storedEmail);
  }, []);

  const handlePasswordVerification = async () => {
    try {
      const response = await axios.post("http://localhost:5001/api/login", {
        email,
        password: currentPassword,
      });

      if (response.data) {
        // Generate reset token
        const resetResponse = await axios.post("http://localhost:5001/api/forgot-password", {
          email,
          source: 'account'
        });
        
        setShowPasswordModal(false);
        setCurrentPassword("");
        setError("");
        // Redirect with the token
        navigate(`/reset-password?token=${resetResponse.data.token}`);
      }
    } catch (err) {
      setError("Incorrect password. Please try again.");
    }
  };

  const handleLogout = () => {
    const userId = sessionStorage.getItem("id");
    if (userId) {
      disconnectSocket(userId);
    }
    sessionStorage.removeItem("username");
    sessionStorage.removeItem("email");
    sessionStorage.removeItem("id");
    navigate("/");
  };

  return (
    <div className="account-wrapper">
      <img src="/Start.png" alt="Background" className="account-background" />
  
      {/* LOGO + TITLU */}
      <div className="account-header">
        <img src="/mafia-logo.png" alt="Mafia Logo" className="account-logo" />
        <h1 className="account-title">Account Information</h1>
      </div>
  
      {/* PANEL */}
      <div className="account-panel">
        <p><strong>Username:</strong> {username || "Unknown"}</p>
        <p><strong>Email:</strong> {email || "Unknown"}</p>
  
        <div className="account-buttons">
          <button 
            className="account-btn"
            onClick={() => setShowPasswordModal(true)}
          >
            Change Password
          </button>
          <button
            className="account-btn"
            onClick={handleLogout}
          >
            Log Out
          </button>
        </div>
      </div>
  
      {/* BACK BUTTON */}
      <button className="account-back-button" onClick={() => navigate("/menu")}>
        ⟵ Back
      </button>

      {/* Password Verification Modal */}
      {showPasswordModal && (
        <div className="modal-overlay">
          <h2 className="modal-title">Verify Current Password</h2>
          <div className="modal-content">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter your current password"
              className="password-input"
            />
            {error && <p className="error-message">{error}</p>}
            <div className="modal-buttons">
              <button 
                className="modal-btn"
                onClick={handlePasswordVerification}
              >
                Verify
              </button>
              <button 
                className="modal-btn"
                onClick={() => {
                  setShowPasswordModal(false);
                  setCurrentPassword("");
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}