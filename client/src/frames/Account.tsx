import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Account.css";


export default function Account() {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string | null>("");
  const [email, setEmail] = useState<string | null>("");

  useEffect(() => {
    const storedUsername = localStorage.getItem("username");
    const storedEmail = localStorage.getItem("email");
    console.log("Stored email:", storedEmail);
    setUsername(storedUsername);
    setEmail(storedEmail);
    
  }, []);

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
          <button className="account-btn">Change Password</button>
          <button
            className="account-btn"
            onClick={() => {
              localStorage.removeItem("username");
              localStorage.removeItem("email");
              navigate("/"); // sau pagina ta de login
            }}
          >
            Log Out
          </button>
        </div>
      </div>
  
      {/* BACK BUTTON */}
      <button className="account-back-button" onClick={() => navigate("/menu")}>
        ⟵ Back
      </button>
    </div>
  );
}