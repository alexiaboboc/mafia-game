import React, { useEffect, useState } from "react";
import "../styles/GameStart.css";
import { useNavigate } from "react-router-dom";

const roleDescriptions: Record<string, string> = {
  queen: "She can nullify the power of anyone she visits. If she visits the serial killer, she dies with a bloody will and no last words.",
  policeman: "Only starting from the second night can they shoot someone they believe is a suspect. If they shoot someone innocent, they die the following night from a broken heart.",
  killer: "Kills anyone except the serial killer. Loyal to the mafia.",
  doctor: "Heals anyone, including themselves—but only once for self-heal.",
  citizen: "Has no powers. Just a vote. Useless, but hopeful.",
  lookout: "Can see who visited someone during the night—if they can move.",
  mayor: "Once revealed, their vote counts as three.",
  mutilator: "Can silence someone verbally or weaken their vote. If the killer dies, the mutilator becomes the new killer.",
  sheriff: "Investigates players. Sees 👍 for mafia (and serial killer), 👎 for innocent, 🤷‍♀️ if blocked by queen.",
  sacrifice: "Must convince the town to vote them out. Once lynched, becomes a ghost that kills one person that night.",
  "serial-killer": "Kills everyone—including mafia. Only eliminated if voted out during the day."
};

interface Player {
  id: string;
  username: string;
  role: string;
}

export default function GameStart() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"night" | "roles" | "reveal">("night");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [playerRole, setPlayerRole] = useState<string | null>(null);

  useEffect(() => {
    const code = sessionStorage.getItem("lobbyCode");
    const playerId = sessionStorage.getItem("id");
  
    if (!code || !playerId) return;
  
    let timeout1: NodeJS.Timeout;
    let timeout2: NodeJS.Timeout;
  
    fetch(`http://localhost:5001/api/game/${code}`)
      .then(res => res.json())
      .then((data: { players: Player[] }) => {
        if (!data.players) return;
  
        setSelectedRoles(data.players.map((p: Player) => p.role));
  
        const player = data.players.find(p => p.id.toString() === playerId);
        setPlayerRole(player?.role || null);
  
        // 👉 setează fazele DUPĂ ce am datele
        timeout1 = setTimeout(() => setPhase("roles"), 3000);
        timeout2 = setTimeout(() => setPhase("reveal"), 6000);
      })
      .catch(err => {
        console.error("❌ Error fetching game data:", err);
      });
  
    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
    };
  }, []);

  return (
    <div className="game-start-wrapper">
      <div className="game-start-container">
        {phase === "night" && (
          <h1 className="game-start-title fade-in-section">The night is falling over the town...</h1>
        )}

        {phase === "roles" && (
          <>
            <h2 className="game-start-title">Roles in this game</h2>
            <div className="game-start-roles-row fade-in-role">
              {selectedRoles.map(role => (
                <div className="game-start-role-card" key={role}>
                  <img src={`/cards/${role}.png`} alt={role} />
                </div>
              ))}
            </div>
          </>
        )}

        {phase === "reveal" && playerRole && (
          <>
            <h2 className="game-start-title">Your role is...</h2>
            <div className="game-start-your-card fade-in-role">
              <img src={`/cards/${playerRole}.png`} alt={playerRole.replace("-", " ")} />
            </div>
            <p className="game-start-role-description fade-in-section">
              {roleDescriptions[playerRole]}
            </p>
            <button
              className="game-start-button fade-in-section"
              onClick={() =>
                navigate("/night-actions", {
                  state: { role: playerRole }
                })
              }
            >
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}