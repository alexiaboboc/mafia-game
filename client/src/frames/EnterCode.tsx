import React, { useState } from "react";
import "../styles/EnterCode.css";
import { useNavigate } from "react-router-dom";

export default function EnterCode() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    setCode(val);
  };

  return (
    <div className="enter-code-wrapper">
      <div className="top-right-buttons">
        <button className="entercode-top-button" onClick={() => navigate("/friends")}>Friends</button>
        <button className="entercode-top-button" onClick={() => navigate("/account")}>Account</button>
      </div>
      <div className="enter-code-container">
      <img src="/mafia-logo.png" alt="Mafia Logo" className="mafia-logo" />
        <div className="enter-code-title">Enter the game code</div>

        <div className="enter-code-panel">
          <div className="code-input-wrapper">
            <input
              type="text"
              value={code}
              onChange={handleChange}
              placeholder="XXXXXX"
              className="code-input"
            />
          </div>
          <button className="enter-code-button" >JOIN</button>
      </div>
      <button className="back-button-entercode" onClick={() => navigate("/menu")}>
            ⟵ Back
          </button>
        </div>
    </div>
  );
}
