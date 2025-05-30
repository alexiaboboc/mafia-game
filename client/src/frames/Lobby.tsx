import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "../styles/Lobby.css";

const socket = io("http://localhost:5001");

export default function Lobby() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState<string[]>([]);

  useEffect(() => {
    const codeFromStorage = sessionStorage.getItem("lobbyCode");
    const username = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    if (!codeFromStorage || !username || !id) return;

    setCode(codeFromStorage);

    // 1. Fetch jucători existenți
    fetch(`http://localhost:5001/api/lobby/${codeFromStorage}`)
      .then(res => res.json())
      .then(data => setPlayers(data.players || []))
      .catch(err => console.error("Failed to load players", err));

    // 2. Trimite eveniment de join cu id inclus
    socket.emit("join-lobby", { code: codeFromStorage, username, id });

    // 3. Ascultă adăugarea jucătorilor noi
    socket.off("user-joined").on("user-joined", ({ username }) => {
      setPlayers(prev => prev.includes(username) ? prev : [...prev, username]);
    });

    // 4. Ascultă plecările din lobby
    socket.off("user-left").on("user-left", ({ username }) => {
      fetch(`http://localhost:5001/api/lobby/${codeFromStorage}`)
        .then(res => res.json())
        .then(data => {
          console.log("Actualizare după user-left:", data.players);
          setPlayers(data.players || []);
        })
        .catch(err => console.error("Failed to reload players after leave", err));
    });

    // 5. Deconectare forțată (închiderea tabului)
    const handleUnload = () => {
      socket.emit("leave-lobby", { code: codeFromStorage, username, id });
    };

    window.addEventListener("beforeunload", handleUnload);

    // 6. Cleanup la demontarea componentului (ex: back)
    return () => {
      socket.emit("leave-lobby", { code: codeFromStorage, username, id });
      window.removeEventListener("beforeunload", handleUnload);
      socket.disconnect();
    };
  }, []);

  // 7. Butonul "Back" => emite leave și redirecționează
  const handleBack = () => {
    const username = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    if (code && username && id) {
      socket.emit("leave-lobby", { code, username, id });

      setTimeout(() => {
        navigate("/menu");
      }, 300); // mic delay pentru emit
    } else {
      navigate("/menu");
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
          <div className="player-count">{players.length}/10</div>
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

        <div className="lobby-warning">Need of minimum 5 players.</div>
        <button className="start-button" onClick={() => navigate("/gamestart")}>
          Start Game
        </button>
      </div>
    </div>
  );
}