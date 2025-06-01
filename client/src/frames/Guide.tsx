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
            <h4>Team: Town</h4>
            <p>Nullifies one player's power. Visiting Serial Killer causes a bloody will (death without testament).</p>
          </div>
          <div className="guide-row">
            <h2>🏛️ Mayor (9)</h2>
            <h4>Team: Town</h4>
            <p>Vote counts as triple once revealed. After that, he can no longer use his privilege.</p>
          </div>
          <div className="guide-row">
            <h2>🔪 Killer (K)</h2>
            <h4>Team: Mafia</h4>
            <p>Eliminates any player, except the Serial Killer.</p>
          </div>
          <div className="guide-row">
            <h2>👁️ Lookout (2)</h2>
            <h4>Team: Town</h4>
            <p>Sees who visits the selected player during the night, if mobile.</p>
          </div>
          <div className="guide-row">
            <h2>🪓 Mutilator (7)</h2>
            <h4>Team: Mafia</h4>
            <p>Mutes speech or vote. Becomes Killer if the original is eliminated or is killed by the Serial Killer.</p>
          </div>
          <div className="guide-row">
            <h2>🃏 Serial Killer (Joker)</h2>
            <h4>Team: Independent</h4>
            <p>Kills everyone. Can only be voted out during the day.</p>
          </div>

          <div className="guide-row">
            <h2>👮 Policeman (10)</h2>
            <h4>Team: Town</h4>
            <p>Can shoot someone starting from night 2. If killing an innocent, dies next night from a broken heart.</p>
          </div>
          <div className="guide-row">
            <h2>💀 Sacrifice (J)</h2>
            <h4>Team: Independent</h4>
            <p>Tries to get voted out. Comes back as ghost that kills during the night.</p>
          </div>

          <div className="guide-row">
            <h2>🩺 Doctor (A)</h2>
            <h4>Team: Town</h4>
            <p>Heals others. He may self-heal once per game.</p>
          </div>
          <div className="guide-row">
            <h2>🧍 Citizen (4)</h2>
            <h4>Team: Town</h4>
            <p>No powers. Talks and votes.</p>
          </div>

          <div className="guide-row">
            <h2>🕵️ Sheriff (3)</h2>
            <h4>Team: Town</h4>
            <p>Investigates players and receives:<br />
              👍 = Mafia or Serial Killer<br />
              👎 = Innocent<br />
              🤷‍♀️ = If visited by Queen
            </p>
          </div>
          <div className="guide-row">
            <h2>⏱️ Game Flow</h2>
            <ul>
              <li>30s hearing of testaments</li>
              <li>5 min of discussions</li>
              <li>1 min of accusations + 30s defense</li>
              <li>Vote someone or no one</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}