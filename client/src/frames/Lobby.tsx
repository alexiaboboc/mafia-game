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

  const refreshLobby = async (lobbyCode: string) => {
    try {
      const response = await fetch(`http://localhost:5001/api/lobby/${lobbyCode}`);
      const data = await response.json();
      setPlayers(data.players || []);
      setIsHost(data.players?.[0] === sessionStorage.getItem("username"));
    } catch (err) {
      console.error("Failed to refresh lobby:", err);
    }
  };

  useEffect(() => {
    const codeFromStorage = sessionStorage.getItem("lobbyCode");
    const username = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    if (!codeFromStorage || !username || !id) return;

    setCode(codeFromStorage);

    // Initial lobby load
    refreshLobby(codeFromStorage);

    // Join lobby
    socket.emit("join-lobby", { code: codeFromStorage, username, id });
    console.log(`Joined lobby ${codeFromStorage} as ${username}`);

    // Set up periodic refresh
    const refreshInterval = setInterval(() => {
      refreshLobby(codeFromStorage);
    }, 2000); // Refresh every 2 seconds

    // Listen for new players
    socket.off("user-joined").on("user-joined", ({ username }) => {
      console.log(`New player joined: ${username}`);
      refreshLobby(codeFromStorage);
    });

    // Listen for players leaving
    socket.off("user-left").on("user-left", ({ username }) => {
      console.log(`Player left: ${username}`);
      refreshLobby(codeFromStorage);
    });

    // Listen for game start
    socket.off("game-started").on("game-started", () => {
      console.log("Game started event received, navigating to gamestart");
      navigate("/gamestart");
    });

    // Check game status periodically
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

    // Force disconnect (tab close)
    const handleUnload = () => {
      const username = sessionStorage.getItem("username");
      const id = sessionStorage.getItem("id");

      if (codeFromStorage && username && id) {
        // Use sendBeacon for more reliable cleanup when closing tab
        const data = new Blob([JSON.stringify({ code: codeFromStorage, id })], {
          type: 'application/json'
        });
        navigator.sendBeacon("http://localhost:5001/api/lobby/leave", data);
        
        // Also try to emit socket event
        socket.emit("leave-lobby", { code: codeFromStorage, username, id });
      }
    };

    window.addEventListener("beforeunload", handleUnload);

    // Cleanup on component unmount
    return () => {
      clearInterval(statusInterval);
      clearInterval(refreshInterval);
      socket.emit("leave-lobby", { code: codeFromStorage, username, id });
      window.removeEventListener("beforeunload", handleUnload);
      socket.disconnect();
    };
  }, []);

  const handleBack = async () => {
    const username = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    if (code && username && id) {
      try {
        // Call the leave API endpoint
        await fetch("http://localhost:5001/api/lobby/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, id })
        });
        
        // Emit socket event
        socket.emit("leave-lobby", { code, username, id });
        
        // Clear lobby code from storage
        sessionStorage.removeItem("lobbyCode");
        
        // Navigate back
        navigate("/menu");
      } catch (err) {
        console.error("Failed to leave lobby:", err);
        navigate("/menu");
      }
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