import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Menu.css";
import axios from "axios";
import { disconnectSocket } from "../socket";

export default function Menu() {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string | null>("");

  useEffect(() => {
    const storedUsername = sessionStorage.getItem("username");
    setUsername(storedUsername);
  }, []);

  const handleNewGame = async () => {
    try {
      const username = sessionStorage.getItem("username");
      const id = sessionStorage.getItem("id");
      const response = await axios.post("http://localhost:5001/api/lobby/new", {
        username,
        id,
      });
      console.log("New game response:", response.data);
      sessionStorage.setItem("lobbyCode", response.data.code);
      navigate("/lobby");
    } catch (error) {
      console.error("Failed to create new game:", error);
      alert("Failed to create new game");
    }
  };

  const handleQuit = () => {
    const userId = sessionStorage.getItem("id");
    if (userId) {
      disconnectSocket(userId);
    }
    sessionStorage.clear();
    navigate("/", { replace: true });
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
          <button className="menu-button" onClick={() => navigate("/guide")}>
            Guide
          </button>
          <button className="menu-button" onClick={handleQuit}>
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}