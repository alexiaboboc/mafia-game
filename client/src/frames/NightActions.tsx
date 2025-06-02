import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "../styles/NightActions.css";

// Create socket instance outside component to prevent multiple connections
const socket = io("http://localhost:5001", {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
  withCredentials: true,
  forceNew: false,
  multiplex: false,
  path: '/socket.io/',
  autoConnect: true,
  upgrade: true
});

// Add socket connection status logging
socket.on('connect', () => {
  console.log('Socket connected with ID:', socket.id);
  // Re-join lobby if we have a code
  const code = sessionStorage.getItem("lobbyCode");
  if (code) {
    console.log('Re-joining lobby on connect:', code);
    socket.emit('join-lobby', { 
      code, 
      username: sessionStorage.getItem("username"),
      id: sessionStorage.getItem("id")
    });
  }
});

socket.on('disconnect', () => {
  console.log('Socket disconnected');
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error);
});

socket.on('reconnect', (attemptNumber) => {
  console.log('Socket reconnected after', attemptNumber, 'attempts');
  // Re-join lobby if we have a code
  const code = sessionStorage.getItem("lobbyCode");
  if (code) {
    console.log('Re-joining lobby on reconnect:', code);
    socket.emit('join-lobby', { 
      code, 
      username: sessionStorage.getItem("username"),
      id: sessionStorage.getItem("id")
    });
  }
});

// Define the exact order of roles for night actions
const roleOrder = [
  "queen",
  "killer",
  "mutilator",
  "doctor",
  "serial-killer",
  "sacrifice",
  "policeman",
  "sheriff",
  "lookout",
  "mayor",
  "citizen"
];

const roleDescriptions: Record<string, string> = {
  queen: "The queen is choosing someone to nullify tonight...",
  killer: "The killer is selecting their target...",
  mutilator: "The mutilator is deciding who to silence...",
  doctor: "The doctor is choosing who to heal...",
  "serial-killer": "The serial killer is picking their victim...",
  sacrifice: "The sacrifice is marking someone for revenge...",
  policeman: "The policeman is taking aim...",
  sheriff: "The sheriff is investigating someone...",
  lookout: "The lookout is watching someone...",
  mayor: "The mayor is sleeping soundly...",
  citizen: "The citizen is sleeping soundly..."
};

const actionRoles = [
  "queen", "killer", "mutilator", "doctor", "serial-killer",
  "sacrifice", "policeman", "sheriff", "lookout"
];

const actionMap: Record<string, string> = {
  queen: "block",
  killer: "kill",
  mutilator: "mute",
  policeman: "shoot",
  doctor: "heal",
  sheriff: "investigate",
  lookout: "watch",
  "serial-killer": "sk-kill",
  sacrifice: "revenge"
};

interface Player {
  id: string;
  username: string;
  role: string;
  alive: boolean;
  muted?: boolean;
}

interface NightResult {
  deaths: string[];
  muted: string[];
  wills: string[];
  error?: string;
}

export default function NightActions() {
  const navigate = useNavigate();
  const location = useLocation();
  const playerRole = location.state?.role || null;
  const playerId = sessionStorage.getItem("id");
  const lobbyCode = sessionStorage.getItem("lobbyCode");
  const username = sessionStorage.getItem("username");

  const [players, setPlayers] = useState<Player[]>([]);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [actionCompleted, setActionCompleted] = useState<string | null>(null);
  const [nightEnded, setNightEnded] = useState(false);
  const [nightResult, setNightResult] = useState<NightResult>({ deaths: [], muted: [], wills: [] });
  const [hasActed, setHasActed] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize game state
  useEffect(() => {
    if (!lobbyCode || isInitialized) return;

    console.log('Initializing game state...');

    // First, make sure we're in the lobby room
    socket.emit('join-lobby', { 
      code: lobbyCode, 
      username: sessionStorage.getItem("username"),
      id: sessionStorage.getItem("id")
    });

    // Fetch initial game state
    fetch(`http://localhost:5001/api/game/${lobbyCode}`)
      .then(res => res.json())
      .then(data => {
        if (!data.players) return;
        console.log('Game data received:', data);
        setPlayers(data.players);
        setIsInitialized(true);
        
        // Request current night state from server
        console.log('Requesting night state from server...');
        socket.emit('join-night-actions', { code: lobbyCode });
      })
      .catch(err => {
        console.error("Failed to fetch game data:", err);
      });
  }, [lobbyCode, isInitialized]);

  // Socket event listeners
  useEffect(() => {
    if (!lobbyCode) return;

    const handleGameStarted = ({ code }: { code: string }) => {
      console.log('Game started event received for code:', code);
      // Reset states when game starts
      setActiveRole(null);
      setActionCompleted(null);
      setHasActed(false);
      setNightEnded(false);
    };

    const handleNightActionStarted = ({ role }: { role: string }) => {
      console.log('Night action started for role:', role);
      setActiveRole(role);
      setActionCompleted(null);
      setHasActed(false);
    };

    const handleNightActionCompleted = ({ role, target }: { role: string, target: string }) => {
      console.log('Night action completed:', { role, target });
      setActionCompleted(target);
    };

    const handleNightEnded = (data: NightResult) => {
      console.log('Night ended:', data);
      if (data.error) {
        console.error('Night ended with error:', data.error);
      } else {
        setNightResult({
          deaths: data.deaths || [],
          muted: data.muted || [],
          wills: data.wills || []
        });
      }
      setNightEnded(true);
      setTimeout(() => navigate("/chat"), 5000);
    };

    // Register socket event listeners
    socket.on('game-started', handleGameStarted);
    socket.on('night-action-started', handleNightActionStarted);
    socket.on('night-action-completed', handleNightActionCompleted);
    socket.on('night-ended', handleNightEnded);

    // Cleanup function
    return () => {
      socket.off('game-started', handleGameStarted);
      socket.off('night-action-started', handleNightActionStarted);
      socket.off('night-action-completed', handleNightActionCompleted);
      socket.off('night-ended', handleNightEnded);
    };
  }, [lobbyCode, navigate]);

  const handleTargetSelect = (targetUsername: string) => {
    if (hasActed) return;
    
    console.log('Target selected:', targetUsername);
    setHasActed(true);
    
    const action = actionMap[playerRole] || "noop";

    fetch("http://localhost:5001/api/game/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: lobbyCode,
        actorId: playerId,
        targetUsername,
        action
      })
    })
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      return res.json();
    })
    .then(() => {
      console.log('Action sent to server, emitting completion');
      socket.emit('night-action-completed', { 
        code: lobbyCode, 
        role: playerRole, 
        target: targetUsername 
      });
    })
    .catch(err => {
      console.error("❌ Failed to send action:", err);
      setHasActed(false);
    });
  };

  const getActionMessage = (role: string, target: string) => {
    const messages: Record<string, string> = {
      queen: `The queen has chosen to nullify ${target}'s power tonight.`,
      killer: `The killer has marked ${target} for elimination.`,
      mutilator: `The mutilator has decided to silence ${target}.`,
      policeman: `The policeman has taken aim at ${target}.`,
      doctor: `The doctor has chosen to heal ${target}.`,
      sheriff: `The sheriff is investigating ${target}'s allegiance.`,
      lookout: `The lookout is watching ${target}'s house.`,
      "serial-killer": `The serial killer has chosen ${target} as their victim.`,
      sacrifice: `The sacrifice has marked ${target} for revenge.`
    };
    return messages[role] || "Night passes quietly...";
  };

  const getNightResultMessage = () => {
    const { deaths, muted, wills } = nightResult;
    
    if (deaths.length === 0) {
      return "No one died tonight. Silence falls over the town.";
    }

    const deathMessages = deaths.map(death => {
      const hasWill = wills.includes(death);
      return `${death}${hasWill ? " (left a will)" : " (no will)"}`;
    });

    const mutedAlive = muted.filter(m => !deaths.includes(m));
    const mutedMessages = mutedAlive.length > 0 
      ? `\nThe following players were silenced: ${mutedAlive.join(", ")}.`
      : "";

    return `☠️ ${deathMessages.join(", ")} died during the night.${mutedMessages}`;
  };

  // Determine what to show
  const isMyTurn = activeRole === playerRole && actionRoles.includes(playerRole) && !hasActed;
  const alivePlayers = players.filter(p => p.alive && p.username !== username);

  console.log('Render state:', {
    activeRole,
    playerRole,
    isMyTurn,
    hasActed,
    actionCompleted,
    nightEnded,
    playersCount: players.length,
    alivePlayersCount: alivePlayers.length
  });

  if (!playerRole || !isInitialized) {
    console.log('Not ready to render - missing playerRole or not initialized');
    return null;
  }

  return (
    <div className="night-actions-wrapper">
      <div className="night-actions-container">
        {nightEnded ? (
          <div className="night-end-screen fade-in-section">
            <h2>everyone woke up</h2>
            <p>{getNightResultMessage()}</p>
          </div>
        ) : isMyTurn ? (
          <div className="player-turn-ui fade-in-section">
            <h2 className="your-turn">Your turn</h2>
            <div className="card-grid">
              <img
                className="your-role-img"
                src={`/cards/${playerRole}.png`}
                alt={playerRole.replace("-", " ")}
              />
              <div className="target-grid">
                {alivePlayers.map((p, i) => (
                  <div 
                    className="target-box" 
                    key={i} 
                    onClick={() => handleTargetSelect(p.username)}
                  >
                    {p.username}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <h2 className="night-text fade-in-section">
            {actionCompleted && activeRole ? 
              getActionMessage(activeRole, actionCompleted) : 
              activeRole ? 
                roleDescriptions[activeRole] : 
                "Night passes quietly..."
            }
          </h2>
        )}
      </div>
    </div>
  );
}