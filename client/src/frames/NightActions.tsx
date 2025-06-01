import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "../styles/NightActions.css";

const socket = io("http://localhost:5001", {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
  withCredentials: true
});

// Add socket connection status logging
socket.on('connect', () => {
  console.log('Socket connected with ID:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Socket disconnected');
});

socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error);
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
}

export default function NightActions() {
  const navigate = useNavigate();
  const location = useLocation();
  const playerRole = location.state?.role || null;
  const playerId = sessionStorage.getItem("id");
  const lobbyCode = sessionStorage.getItem("lobbyCode");

  const [players, setPlayers] = useState<Player[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState("narration");
  const [nightEnded, setNightEnded] = useState(false);
  const [nightResult, setNightResult] = useState<NightResult>({ deaths: [], muted: [], wills: [] });
  const [rolesInGame, setRolesInGame] = useState<string[]>([]);
  const [gameRound, setGameRound] = useState(1);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const [waitingForAction, setWaitingForAction] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasActed, setHasActed] = useState(false);
  const [activeRole, setActiveRole] = useState<string | null>(null);

  // Filter roleOrder to only include roles that are present in the game
  const orderedRolesInGame = roleOrder.filter(role => rolesInGame.includes(role));

  // Initialize game state and socket listeners
  useEffect(() => {
    const code = sessionStorage.getItem("lobbyCode");
    if (!code || isInitialized) return;

    console.log('Initializing game state...');

    // Join the lobby room
    socket.emit('join-lobby', { 
      code, 
      username: sessionStorage.getItem("username"),
      id: sessionStorage.getItem("id")
    });

    // Fetch initial game state
    fetch(`http://localhost:5001/api/game/${code}`)
      .then(res => res.json())
      .then(data => {
        if (!data.players) return;
        console.log('Game data received:', data);
        setPlayers(data.players);
        const roles = data.players.map((p: Player) => p.role);
        console.log('Setting roles in game:', roles);
        setRolesInGame(roles);
        setGameRound(data.round || 1);
        setIsInitialized(true);

        // Start with the first role that is present in the game
        const firstRole = roleOrder.find(role => roles.includes(role));
        if (firstRole) {
          console.log('Starting with first role:', firstRole);
          setActiveRole(firstRole);
          setPhase("narration");
          setWaitingForAction(true);
          setHasActed(false);
          setCurrentAction(null);
        }
      })
      .catch(err => {
        console.error("Failed to fetch game data:", err);
      });

    socket.on('night-action-started', ({ role }) => {
      console.log('Night action started event received:', role);
      console.log('Current state before update:', {
        activeRole,
        currentIndex,
        hasActed,
        waitingForAction,
        phase,
        playerRole
      });
      
      const roleIndex = orderedRolesInGame.indexOf(role);
      console.log('Role index:', roleIndex, 'Ordered roles:', orderedRolesInGame);
      
      if (roleIndex !== -1) {
        // Reset all states for the new role
        setCurrentIndex(roleIndex);
        setActiveRole(role);
        setPhase("narration");
        setWaitingForAction(true);
        setHasActed(false);
        setCurrentAction(null);
        
        console.log('State updated for new role:', {
          role,
          roleIndex,
          playerRole,
          isPlayerTurn: role === playerRole,
          isActionRole: actionRoles.includes(role)
        });
      }
    });

    socket.on('night-action-completed', ({ role, target }) => {
      console.log('Night action completed event received:', { role, target });
      console.log('Current state before update:', {
        activeRole,
        currentIndex,
        hasActed,
        waitingForAction,
        phase,
        playerRole
      });
      
      // Update action state
      setCurrentAction(target);
      setWaitingForAction(false);
      setHasActed(true);
      setPhase("narration");
      
      console.log('State updated after action completion:', {
        role,
        target,
        activeRole,
        playerRole,
        phase
      });
    });

    socket.on('night-ended', (data) => {
      console.log('Night ended event received:', data);
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
    });

    return () => {
      socket.off('night-action-started');
      socket.off('night-action-completed');
      socket.off('night-ended');
      socket.off('join-lobby');
    };
  }, [orderedRolesInGame, currentIndex, isInitialized, activeRole]);

  // Handle role turns
  useEffect(() => {
    if (!playerRole || !activeRole || nightEnded || !isInitialized) {
      console.log('Role turn check skipped:', {
        playerRole,
        activeRole,
        nightEnded,
        isInitialized
      });
      return;
    }

    const isPlayerTurn = activeRole === playerRole;
    const isActionRole = actionRoles.includes(activeRole);

    console.log('Role turn check:', {
      activeRole,
      playerRole,
      isPlayerTurn,
      isActionRole,
      hasActed,
      waitingForAction,
      currentAction,
      phase
    });

    if (isPlayerTurn && isActionRole && !hasActed) {
      console.log('Setting phase to action for player:', playerRole);
      setPhase("action");
    } else {
      console.log('Setting phase to narration for non-active player');
      setPhase("narration");
    }
  }, [activeRole, playerRole, nightEnded, isInitialized, hasActed, currentAction, waitingForAction]);

  const handleTargetSelect = (targetUsername: string) => {
    if (hasActed) return; // Prevent multiple actions
    
    console.log('Target selected:', targetUsername);
    setPhase("narration");
    setCurrentAction(targetUsername);
    setHasActed(true);
    
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
      // Emit the completion event
      socket.emit('night-action-completed', { 
        code: lobbyCode, 
        role: playerRole, 
        target: targetUsername 
      });
    })
    .catch(err => {
      console.error("❌ Failed to send action:", err);
      // Reset state on error
      setHasActed(false);
      setCurrentAction(null);
      setPhase("action");
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

  if (!playerRole) return null;

  const isPlayerTurn = activeRole === playerRole && actionRoles.includes(playerRole);
  const alivePlayers = players.filter(p => p.alive);

  console.log('Render state:', {
    activeRole,
    playerRole,
    isPlayerTurn,
    phase,
    nightEnded,
    hasActed,
    waitingForAction
  });

  return (
    <div className="night-actions-wrapper">
      <div className="night-actions-container">
        {!nightEnded ? (
          activeRole === playerRole && actionRoles.includes(playerRole) && !hasActed ? (
            <div className="player-turn-ui fade-in-section">
              <h2 className="your-turn">Your turn</h2>
              <div className="card-grid">
                <img
                  className="your-role-img"
                  src={`/cards/${playerRole}.png`}
                  alt={playerRole.replace("-", " ")}
                />
                <div className="target-grid">
                  {alivePlayers
                    .filter(p => p.username !== sessionStorage.getItem("username"))
                    .map((p, i) => (
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
              {currentAction ? getActionMessage(activeRole || "", currentAction) : 
               activeRole ? roleDescriptions[activeRole] : "Night passes quietly..."}
            </h2>
          )
        ) : (
          <div className="night-end-screen fade-in-section">
            <h2>everyone woke up</h2>
            <p>{getNightResultMessage()}</p>
          </div>
        )}
      </div>
    </div>
  );
}
