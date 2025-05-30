import React from "react";
import "../styles/Guide.css";
import { useNavigate } from "react-router-dom";

export default function Guide() {
  const navigate = useNavigate();


  return (
    <div className="guide-wrapper">
      <img src="/Start.png" alt="Background" className="guide-background" />
      <button className="guide-back" onClick={() => navigate("/menu")}>⟵ Back</button>

      <div className="guide-content">
        <h1 className="guide-title">🎮 Game Guide</h1>
        <div className="guide-grid">
          <div className="guide-row">
            <h2>👑 Queen (Q)</h2>
            <p>Nullifies one player's power. Visiting Serial Killer causes a bloody will and death without testament.</p>
          </div>
          <div className="guide-row">
            <h2>🏛️ Mayor (9)</h2>
            <p>Vote counts as triple once revealed.</p>
          </div>

          <div className="guide-row">
            <h2>🔪 Killer (K)</h2>
            <p>Eliminates any player except the Serial Killer.</p>
          </div>
          <div className="guide-row">
            <h2>👁️ Lookout (2)</h2>
            <p>Sees who visits the selected player during the night, if mobile.</p>
          </div>

          <div className="guide-row">
            <h2>🪓 Mutilator (7)</h2>
            <p>Mutes speech or vote. Becomes Killer if original one dies or is killed by the Serial Killer.</p>
          </div>
          <div className="guide-row">
            <h2>🃏 Serial Killer (Joker)</h2>
            <p>Kills everyone. Can only be voted out during the day.</p>
          </div>

          <div className="guide-row">
            <h2>👮 Policeman (10)</h2>
            <p>Shoots starting from night 2. If killing an innocent, dies next night.</p>
          </div>
          <div className="guide-row">
            <h2>💀 Sacrifice (J)</h2>
            <p>Tries to get voted out. Comes back as ghost that kills during the night.</p>
          </div>

          <div className="guide-row">
            <h2>🩺 Doctor (A)</h2>
            <p>Heals others, may self-heal once per game.</p>
          </div>
          <div className="guide-row">
            <h2>🧍 Citizen (4)</h2>
            <p>No powers. Votes and talks.</p>
          </div>

          <div className="guide-row">
            <h2>🕵️ Sheriff (3)</h2>
            <p>Investigates players.<br />
              👍 = Mafia or Serial Killer<br />
              👎 = Innocent<br />
              🤷‍♀️ = If visited by Queen
            </p>
          </div>
          <div className="guide-row">
            <h2>⏱️ Game Flow</h2>
            <ul>
              <li>5 min discussion</li>
              <li>1 min accusation + 30s defense</li>
              <li>Vote: yes / no</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}