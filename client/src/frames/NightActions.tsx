import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../styles/NightActions.css";

const roleOrder = [
  "queen", "killer", "mutilator", "policeman", "doctor",
  "sheriff", "mayor", "lookout", "serial-killer", "sacrifice", "citizen"
];

const roleDescriptions: Record<string, string> = {
  queen: "The queen nullifies another player's power tonight. If she visits the serial killer, she dies without a will.",
  killer: "The killer strikes a target... but tries to avoid the serial killer.",
  mutilator: "The mutilator silences a victim or weakens their vote. If the killer dies, they take over as the killer.",
  policeman: "Starting from night two, the policeman can shoot someone. If they shoot innocent, they die next night from a broken heart.",
  doctor: "The doctor can save someone, including themselves, but only once.",
  sheriff: "The sheriff investigates and sees: 👍 for mafia, 👎 for town, 🤷‍♀️ if affected by the queen. Serial killer shows 👍.",
  mayor: "The mayor triples their vote once revealed during the day.",
  lookout: "The lookout sees who visits someone — if able to move.",
  "serial-killer": "The serial killer kills everyone, including mafia. Can only be voted out during the day.",
  sacrifice: "The sacrifice, If voted out, returns as a ghost that kills one target during the same night.",
  citizen: "The citizen sleeps soundly. And that's about it."
};

const actionRoles = [
  "queen", "killer", "mutilator", "policeman", "doctor",
  "sheriff", "lookout", "serial-killer", "sacrifice"
];

const mockPlayers = ["alex55", "tibi16", "cooker", "jokeru", "mia"];

export default function NightActions() {
  const navigate = useNavigate();
  const location = useLocation();
  const playerRole = location.state?.role || null;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState("narration");
  const [nightEnded, setNightEnded] = useState(false);
  const [victims, setVictims] = useState(["cooker"]);
  const rolesInGame = ["queen", "policeman", "killer", "doctor", "citizen"];
  const orderedRolesInGame = roleOrder.filter(role => rolesInGame.includes(role));

  useEffect(() => {
    if (!playerRole || currentIndex >= orderedRolesInGame.length || nightEnded) return;

    const currentRole = orderedRolesInGame[currentIndex];
    const isPlayerTurn = currentRole === playerRole;
    const isActionRole = actionRoles.includes(currentRole);

    if (isPlayerTurn && isActionRole) {
      setPhase("action");
    } else {
      const timer = setTimeout(() => setCurrentIndex(prev => prev + 1), 2500);
      return () => clearTimeout(timer);
    }
  }, [currentIndex, playerRole]);

  const handleTargetSelect = () => {
    setPhase("narration");
    setCurrentIndex(prev => prev + 1);
  };

  useEffect(() => {
    if (currentIndex === orderedRolesInGame.length) {
      setNightEnded(true);
      const redirect = setTimeout(() => navigate("/chat"), 3000);
      return () => clearTimeout(redirect);
    }
  }, [currentIndex]);

  if (!playerRole) return null;

  const currentRole = orderedRolesInGame[currentIndex];
  const isPlayerTurn = currentRole === playerRole && actionRoles.includes(playerRole);

  return (
    <div className="night-actions-wrapper">
      <div className="night-actions-container">
        {!nightEnded ? (
          phase === "narration" ? (
            <h2 className="night-text fade-in-section">{roleDescriptions[currentRole]}</h2>
          ) : isPlayerTurn ? (
            <div className="player-turn-ui fade-in-section">
              <h2 className="your-turn">Your turn</h2>
              <div className="card-grid">
                <img
                  className="your-role-img"
                  src={`/cards/${playerRole}.png`}
                  alt={playerRole.replace("-", " ")}
                />
                <div className="target-grid">
                  {mockPlayers.map((p, i) => (
                    <div className="target-box" key={i} onClick={handleTargetSelect}>{p}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : null
        ) : (
          <div className="night-end-screen fade-in-section">
            <h2>everyone woke up</h2>
            <p>☠️ {victims.join(", ")} died during the night.</p>
            <p>they are left with a will.</p>
          </div>
        )}
      </div>
    </div>
  );
}