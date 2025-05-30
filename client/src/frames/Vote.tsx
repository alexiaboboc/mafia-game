import React, { useState } from "react";
import "../styles/Vote.css";

const mockPlayers = ["alex55", "tibi16", "cooker", "jokeru", "mia"];

export default function VotingFrame() {
  const [selected, setSelected] = useState<string | null>(null);

  const handleVote = (player: string) => {
    setSelected(player);
  };

  return (
    <div className="voting-wrapper">
      <div className="voting-container">
        <h1 className="voting-title">🗳️ Voting Phase</h1>
        <p className="voting-instruction">Choose someone you suspect. Majority decides the fate.</p>

        <div className="voting-grid">
          {mockPlayers.map((player, i) => (
            <div
              key={i}
              className={`vote-box ${selected === player ? "selected" : ""}`}
              onClick={() => handleVote(player)}
            >
              {player}
            </div>
          ))}
        </div>

        {selected && (
          <div className="voting-result">
            <p>You voted for: <strong>{selected}</strong></p>
          </div>
        )}
      </div>
    </div>
  );
}