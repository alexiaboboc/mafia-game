import React, { useState } from "react";
import "../styles/EnterCode.css";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

const socket = io("http://localhost:5001");

export default function EnterCode() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    setCode(val);
  };

  const handleJoin = async () => {
    const username = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    const response = await fetch("http://localhost:5001/api/lobby/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, username, id }),
    });

    const data = await response.json();
    if (response.ok) {
      sessionStorage.setItem("lobbyCode", code); // 🔐 salva codul pentru Lobby.tsx
      socket.emit("join-lobby", { code, username });
      navigate("/lobby");
    } else {
      alert(data.error || "Failed to join lobby");
    }
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
              placeholder="ABCDEF"
              className="code-input"
            />
          </div>
          <button className="enter-code-button" onClick={handleJoin}>JOIN</button>
        </div>
        <button className="back-button-entercode" onClick={() => navigate("/menu")}>⟵ Back</button>
      </div>
    </div>
  );
}