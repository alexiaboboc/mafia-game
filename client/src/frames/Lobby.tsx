import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "../styles/Lobby.css";

const socket = io("http://localhost:5001", {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
  withCredentials: true
});

export default function Lobby() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState<string[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    const codeFromStorage = sessionStorage.getItem("lobbyCode");
    const username = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    if (!codeFromStorage || !username || !id) return;

    setCode(codeFromStorage);

    // 1. Fetch existing players and check if current user is host
    fetch(`http://localhost:5001/api/lobby/${codeFromStorage}`)
      .then(res => res.json())
      .then(data => {
        setPlayers(data.players || []);
        // First player in the list is the host
        setIsHost(data.players?.[0] === username);
      })
      .catch(err => console.error("Failed to load players", err));

    // 2. Send join event with id included
    socket.emit("join-lobby", { code: codeFromStorage, username, id });
    console.log(`Joined lobby ${codeFromStorage} as ${username}`);

    // 3. Listen for new players
    socket.off("user-joined").on("user-joined", ({ username }) => {
      console.log(`New player joined: ${username}`);
      setPlayers(prev => prev.includes(username) ? prev : [...prev, username]);
    });

    // 4. Listen for players leaving
    socket.off("user-left").on("user-left", ({ username }) => {
      console.log(`Player left: ${username}`);
      fetch(`http://localhost:5001/api/lobby/${codeFromStorage}`)
        .then(res => res.json())
        .then(data => {
          setPlayers(data.players || []);
          // Update host status if needed
          setIsHost(data.players?.[0] === sessionStorage.getItem("username"));
        })
        .catch(err => console.error("Failed to reload players after leave", err));
    });

    // 5. Listen for game start
    socket.off("game-started").on("game-started", () => {
      console.log("Game started event received, navigating to gamestart");
      navigate("/gamestart");
    });

    // 6. Check game status periodically
    const statusInterval = setInterval(() => {
      fetch(`http://localhost:5001/api/lobby/${codeFromStorage}/status`)
        .then(res => res.json())
        .then(data => {
          if (data.gameStarted) {
            console.log("Game started detected via status check");
            clearInterval(statusInterval);
            navigate("/gamestart");
          }
        })
        .catch(err => console.error("Failed to check game status:", err));
    }, 1000);

    // 7. Force disconnect (tab close)
    const handleUnload = () => {
      socket.emit("leave-lobby", { code: codeFromStorage, username, id });
    };

    window.addEventListener("beforeunload", handleUnload);

    // 8. Cleanup on component unmount
    return () => {
      clearInterval(statusInterval);
      socket.emit("leave-lobby", { code: codeFromStorage, username, id });
      window.removeEventListener("beforeunload", handleUnload);
      socket.disconnect();
    };
  }, []);

  const handleBack = () => {
    const username = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    if (code && username && id) {
      socket.emit("leave-lobby", { code, username, id });
      setTimeout(() => navigate("/menu"), 300);
    } else {
      navigate("/menu");
    }
  };

  const handleStartGame = async () => {
    if (players.length < 5) {
      setShowWarning(true);
      setTimeout(() => setShowWarning(false), 3000);
      return;
    }

    try {
      console.log("Attempting to start game...");
      const response = await fetch("http://localhost:5001/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });

      if (response.ok) {
        console.log("Game start request successful, emitting game-started event");
        socket.emit("game-started", { code });
        navigate("/gamestart");
      } else {
        const data = await response.json();
        alert(data.error || "Failed to start game");
      }
    } catch (err) {
      console.error("Failed to start game:", err);
      alert("Failed to start game");
    }
  };

  return (
    <div className="lobby-wrapper">
      <div className="lobby-container">
        <div className="lobby-header">
          <button className="lobby-back" onClick={handleBack}>⟵ Back</button>
          <div className="game-code">
            <span>Game code:</span>
            <div className="code-box">{code}</div>
          </div>
        </div>

        <div className="lobby-info">
          <div className="lobby-title">Lobby</div>
          <div className="player-count">{players.length}/11</div>
        </div>

        <div className="players-table">
          <div className="table-header">
            <div className="col-id">id.</div>
            <div className="col-name">username</div>
          </div>
          {Array.from({ length: Math.max(players.length, 5) }).map((_, i) => (
            <div className="table-row" key={i}>
              <div className="col-id">{i + 1}</div>
              <div className="col-name">{players[i] || "-"}</div>
            </div>
          ))}
        </div>

        {showWarning && (
          <div className="lobby-warning">Need at least 5 players to start the game</div>
        )}

        {isHost && (
          <button className="start-button" onClick={handleStartGame}>
            Start Game
          </button>
        )}
      </div>
    </div>
  );
}