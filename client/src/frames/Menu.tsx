import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import "../styles/Menu.css";


export default function Menu() {
  const [username, setUsername] = useState<string | null>("");
  const navigate = useNavigate();
  useEffect(() => {
    const storedUsername = localStorage.getItem("username");
    if (storedUsername) {
      setUsername(storedUsername);
    }
  }, []);

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
          <button className="menu-button" onClick={() => navigate("/lobby")}>
            New Game
          </button>
          <button className="menu-button" onClick={() => navigate("/options")}>
            Options
          </button>
          <button className="menu-button" onClick={() => navigate("/guide")}>Guide</button>
          <button className="menu-button" onClick={() => {
            localStorage.clear();
            navigate("/", { replace: true }); 
          }}>
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}
