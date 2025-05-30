import React from "react";
import "../styles/Lobby.css";
import { useNavigate } from "react-router-dom";

export default function Lobby() {
  const navigate = useNavigate();
  
  const code = "783671"; // codul jocului (simulat)
  const players = ["alex55", "16tib", "cooker"];

  return (
    <div className="lobby-wrapper">
      <div className="lobby-container">
        <div className="lobby-header">
          <button className="lobby-back" onClick={() => navigate("/menu")}>⟵ Back</button>
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
          {Array.from({ length: 5 }).map((_, i) => (
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
