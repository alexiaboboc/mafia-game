import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import "../styles/Menu.css";

export default function Menu() {
  const [username, setUsername] = useState<string | null>("");
  const navigate = useNavigate();

  useEffect(() => {
    const storedUsername = sessionStorage.getItem("username");
    if (storedUsername) {
      setUsername(storedUsername);
    }
  }, []);

  const handleNewGame = async () => {
    const user = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    const response = await fetch("http://localhost:5001/api/lobby/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, id }),
    });

    const data = await response.json();
    if (response.ok) {
      sessionStorage.setItem("lobbyCode", data.code); // 🔐 salvăm codul pentru Lobby.tsx
      navigate("/lobby");
    } else {
      alert(data.error || "Could not create lobby");
    }
  };

  return (
    <div className="menu-wrapper">
      <img src="/Start.png" alt="Background" className="menu-background" />
      <div className="top-right-buttons">
        <button className="top-button" onClick={() => navigate("/friends")}>
          Friends
        </button>
        <button className="top-button" onClick={() => navigate("/account")}>
          Account
        </button>
      </div>

      <div className="menu-content">
        <img src="/mafia-logo.png" alt="Mafia Logo" className="mafia-logo" />

        <h1 className="welcome-text">Welcome back, {username || "Guest"}!</h1>

        <div className="menu-buttons">
          <button className="menu-button" onClick={() => navigate("/enter-code")}>
            Join Game
          </button>
          <button className="menu-button" onClick={handleNewGame}>
            New Game
          </button>
          <button className="menu-button" onClick={() => navigate("/options")}>
            Options
          </button>
          <button className="menu-button" onClick={() => navigate("/guide")}>
            Guide
          </button>
          <button
            className="menu-button"
            onClick={() => {
              sessionStorage.clear();
              navigate("/", { replace: true });
            }}
          >
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}