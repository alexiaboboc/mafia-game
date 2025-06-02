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
  "mutilator",
  "killer", 
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
  queen: "The queen is choosing someone to nullify their power tonight...",
  mutilator: "The mutilator is deciding who to silence and how...",
  killer: "The killer is selecting their target to eliminate...",
  doctor: "The doctor is choosing who to heal and save from death...",
  "serial-killer": "The serial killer is picking their victim for tonight...",
  sacrifice: "The sacrifice is resting, waiting for the town's judgment...",
  policeman: "The policeman is taking aim at a suspect...",
  sheriff: "The sheriff is investigating someone's allegiance...",
  lookout: "The lookout is watching someone's house to see visitors...",
  mayor: "The mayor is sleeping soundly, preserving their strength...",
  citizen: "The citizen is sleeping soundly, hoping for dawn..."
};

const yourTurnMessages: Record<string, string> = {
  queen: "Choose someone to nullify their power tonight",
  mutilator: "Choose someone to silence (chat or vote)",
  killer: "Choose your target to eliminate (cannot kill Serial Killer)",
  doctor: "Choose someone to heal and save from death",
  "serial-killer": "Choose your victim (can kill anyone including mafia)",
  sacrifice: "You must wait - convince the town to vote you out tomorrow",
  policeman: "Choose someone to shoot (only from round 2+)",
  sheriff: "Choose someone to investigate their allegiance",
  lookout: "Choose someone to watch and see their visitors",
  mayor: "You have no night action - rest and preserve your vote power",
  citizen: "You have no night action - sleep and hope for dawn"
};

const getYourTurnMessage = (role: string, round: number) => {
  if (role === "policeman" && round < 2) {
    return "You cannot shoot until round 2. Rest and wait.";
  }
  return yourTurnMessages[role] || "Choose your action";
};

const actionRoles = [
  "queen", "killer", "mutilator", "doctor", "serial-killer",
  "policeman", "sheriff", "lookout"
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
  healedSelf?: boolean; // Track if doctor has used self-heal
}

interface NightResult {
  deaths: string[];
  muted: Array<{
    username: string;
    type: 'chat' | 'vote';
    muterName: string;
  }> | string[]; // Support both old and new format
  wills: {
    withWills: string[];
    withoutWills: string[];
  } | string[]; // Support both old and new format
  investigations?: Record<string, string>;
  lookoutResults?: Record<string, string[]>;
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
  const [nightResult, setNightResult] = useState<NightResult>({ 
    deaths: [], 
    muted: [], 
    wills: { withWills: [], withoutWills: [] } 
  });
  const [hasActed, setHasActed] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [muteType, setMuteType] = useState<"chat" | "vote" | null>(null);
  const [gameRound, setGameRound] = useState(1);
  const [rolesInGame, setRolesInGame] = useState<string[]>([]);

  // Initialize game state
  useEffect(() => {
    if (!lobbyCode || isInitialized) return;

    console.log('Initializing game state...');

    // Prevent browser back navigation
    const preventBack = (e: PopStateEvent) => {
      console.log('Browser back detected, preventing navigation');
      window.history.pushState(null, '', window.location.href);
      // Force resync with server state
      window.location.reload();
    };

    // Push initial state and add listener
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', preventBack);

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
        setGameRound(data.round || 1);
        
        // Extract roles that are actually in this game
        const gameRoles = data.players.map((p: Player) => p.role);
        setRolesInGame(gameRoles);
        console.log('Roles in this game:', gameRoles);
        
        setIsInitialized(true);
        
        // Request current night state from server
        console.log('Requesting night state from server...');
        socket.emit('join-night-actions', { code: lobbyCode });
      })
      .catch(err => {
        console.error("Failed to fetch game data:", err);
      });

    // Cleanup function
    return () => {
      window.removeEventListener('popstate', preventBack);
    };
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
      // Force resync to prevent inconsistent states
      setTimeout(() => {
        socket.emit('join-night-actions', { code: lobbyCode });
      }, 1000);
    };

    const handleNightActionStarted = ({ role }: { role: string }) => {
      console.log('Night action started for role:', role);
      
      // Validate that this role is actually in the game
      if (!rolesInGame.includes(role)) {
        console.warn('Received event for role not in game:', role, 'Game roles:', rolesInGame);
        // Force reload to resync
        window.location.reload();
        return;
      }
      
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
          wills: data.wills || { withWills: [], withoutWills: [] },
          investigations: data.investigations,
          lookoutResults: data.lookoutResults
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
  }, [lobbyCode, navigate, rolesInGame]);

  const handleTargetSelect = (targetUsername: string) => {
    if (hasActed) return;
    
    // Additional safety check for policeman in round 1
    if (playerRole === "policeman" && gameRound < 2 && targetUsername !== "no-action") {
      console.warn('Policeman attempted action in round 1, blocking');
      return;
    }
    
    // Validate that the current role is actually in the game
    if (!rolesInGame.includes(playerRole)) {
      console.warn('Player role not in current game, forcing reload');
      window.location.reload();
      return;
    }
    
    console.log('Target selected:', targetUsername);
    
    // Handle no-action roles
    if (targetUsername === "no-action") {
      setHasActed(true);
      console.log('No action role, emitting completion');
      socket.emit('night-action-completed', { 
        code: lobbyCode, 
        role: playerRole, 
        target: "no-action" 
      });
      return;
    }
    
    // Handle doctor self-heal
    if (targetUsername === "self-heal" && playerRole === "doctor") {
      setHasActed(true);
      console.log('Doctor self-healing');
      
      fetch("http://localhost:5001/api/game/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: lobbyCode,
          actorId: playerId,
          targetUsername: sessionStorage.getItem("username"), // Target self
          action: "heal-self"
        })
      })
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then(() => {
        console.log('Self-heal sent to server, emitting completion');
        socket.emit('night-action-completed', { 
          code: lobbyCode, 
          role: playerRole, 
          target: "self-heal" 
        });
      })
      .catch(err => {
        console.error("❌ Failed to send self-heal:", err);
        setHasActed(false);
      });
      return;
    }
    
    // Handle mutilator - need to choose mute type first
    if (playerRole === "mutilator") {
      setSelectedTarget(targetUsername);
      // Don't set hasActed yet, wait for mute type selection
      return;
    }
    
    // Handle all other action roles
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

  const handleMutilatorAction = (type: "chat" | "vote") => {
    if (!selectedTarget || hasActed) return;
    
    // Validate that the current role is actually in the game
    if (!rolesInGame.includes(playerRole)) {
      console.warn('Player role not in current game, forcing reload');
      window.location.reload();
      return;
    }
    
    // Validate that this is actually the mutilator
    if (playerRole !== "mutilator") {
      console.warn('Non-mutilator trying to use mutilator action, blocking');
      return;
    }
    
    setHasActed(true);
    setMuteType(type);
    
    const action = type === "chat" ? "muteChat" : "muteVote";

    fetch("http://localhost:5001/api/game/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: lobbyCode,
        actorId: playerId,
        targetUsername: selectedTarget,
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
      console.log('Mutilator action sent to server, emitting completion');
      socket.emit('night-action-completed', { 
        code: lobbyCode, 
        role: playerRole, 
        target: selectedTarget 
      });
    })
    .catch(err => {
      console.error("❌ Failed to send mutilator action:", err);
      setHasActed(false);
      setSelectedTarget(null);
      setMuteType(null);
    });
  };

  const getActionMessage = (role: string, target: string) => {
    if (target === "no-action") {
      return `${role === "sacrifice" ? "The sacrifice" : role === "mayor" ? "The mayor" : "The citizen"} rests quietly through the night.`;
    }
    
    const messages: Record<string, string> = {
      queen: "The queen has made their choice and nullified someone's power.",
      mutilator: "The mutilator has made their choice and decided how to silence someone.",
      killer: "The killer has made their choice and marked their target.",
      doctor: "The doctor has made their choice and prepared to heal someone.",
      "serial-killer": "The serial killer has made their choice and selected their victim.",
      policeman: "The policeman has made their choice and taken aim.",
      sheriff: "The sheriff has made their choice and begun their investigation.",
      lookout: "The lookout has made their choice and begun watching.",
      sacrifice: "The sacrifice rests, waiting for dawn and judgment.",
      mayor: "The mayor sleeps soundly, preserving their strength.",
      citizen: "The citizen sleeps peacefully, hoping for a better tomorrow."
    };
    return messages[role] || "Night passes quietly...";
  };

  const getNightResultMessage = () => {
    const { deaths, muted, wills, investigations, lookoutResults } = nightResult;
    
    let message = "";
    
    if (deaths.length === 0) {
      message = "No one died tonight. Silence falls over the town.";
    } else {
      // Handle both old and new will format
      const willsWithTestament = Array.isArray(wills) ? wills : (wills?.withWills || []);
      const willsWithoutTestament = Array.isArray(wills) ? [] : (wills?.withoutWills || []);
      
      const deathMessages = deaths.map(death => {
        if (willsWithTestament.includes(death)) {
          return `${death} (can write testament)`;
        } else if (willsWithoutTestament.includes(death)) {
          return `${death} (no testament)`;
        } else {
          // Fallback for old format
          return `${death} (can write testament)`;
        }
      });
      message = `☠️ ${deathMessages.join(", ")} died during the night.`;
    }

    if (muted.length > 0) {
      // Handle both old and new muted format
      if (Array.isArray(muted) && muted.length > 0 && typeof muted[0] === 'object') {
        // New format with detailed mute info
        const muteMessages = (muted as Array<{username: string, type: string, muterName: string}>)
          .map(m => `${m.username} (${m.type} silenced)`);
        message += `\n🔇 The following players were silenced: ${muteMessages.join(", ")}.`;
      } else {
        // Old format - just usernames
        message += `\n🔇 The following players were silenced: ${(muted as string[]).join(", ")}.`;
      }
    }

    // Add investigation results for sheriff
    if (investigations && Object.keys(investigations).length > 0) {
      message += `\n🔍 Investigation results:`;
      Object.entries(investigations).forEach(([sheriff, result]) => {
        message += `\n${sheriff}: ${result}`;
      });
    }

    // Add lookout results
    if (lookoutResults && Object.keys(lookoutResults).length > 0) {
      message += `\n👁️ Lookout reports:`;
      Object.entries(lookoutResults).forEach(([lookout, visitors]) => {
        const visitorList = Array.isArray(visitors) && visitors.length > 0 ? visitors.join(", ") : "No visitors";
        message += `\n${lookout} saw: ${visitorList}`;
      });
    }

    return message;
  };

  // Determine what to show
  const isMyTurn = activeRole === playerRole && actionRoles.includes(playerRole) && !hasActed;
  const alivePlayers = players.filter(p => p.alive && p.username !== username);
  
  // Special case: Policeman cannot act in round 1
  const canActuallyAct = playerRole !== "policeman" || gameRound >= 2;
  
  // Additional validation to prevent inconsistent states
  const shouldShowAction = isMyTurn && canActuallyAct && rolesInGame.includes(playerRole);
  
  // Policeman specific validation - force no action in round 1
  const isPolicemanRound1 = playerRole === "policeman" && gameRound < 2;

  console.log('Render state:', {
    activeRole,
    playerRole,
    isMyTurn,
    hasActed,
    actionCompleted,
    nightEnded,
    playersCount: players.length,
    alivePlayersCount: alivePlayers.length,
    gameRound,
    canActuallyAct,
    shouldShowAction,
    isPolicemanRound1,
    rolesInGame
  });

  if (!playerRole || !isInitialized) {
    console.log('Not ready to render - missing playerRole or not initialized');
    return null;
  }

  return (
    <div className="night-actions-wrapper">
      <div className={`night-actions-container ${
        isMyTurn && playerRole === "mutilator" ? "mutilator-active" : ""
      }`}>
        {nightEnded ? (
          <div className="night-end-screen fade-in-section">
            <h2>Morning time!</h2>
            <p>{getNightResultMessage()}</p>
          </div>
        ) : isMyTurn ? (
          <div className="player-turn-ui fade-in-section">
            <h2 className="your-turn">Your turn</h2>
            <p className="turn-instruction">{getYourTurnMessage(playerRole, gameRound)}</p>
            <div className="card-grid">
              <img
                className="your-role-img"
                src={`/cards/${playerRole}.png`}
                alt={playerRole.replace("-", " ")}
              />
              {shouldShowAction && !isPolicemanRound1 ? (
                playerRole === "mutilator" && selectedTarget ? (
                  <div className="mutilator-choice">
                    <p>You selected: <strong>{selectedTarget}</strong></p>
                    <p>Choose how to silence them:</p>
                    <div className="mute-buttons">
                      <button 
                        className="mute-button chat"
                        onClick={() => handleMutilatorAction("chat")}
                      >
                        Mute Chat
                        <small>They cannot speak tomorrow</small>
                      </button>
                      <button 
                        className="mute-button vote"
                        onClick={() => handleMutilatorAction("vote")}
                      >
                        Mute Vote
                        <small>Their vote won't count tomorrow</small>
                      </button>
                    </div>
                    <button 
                      className="back-button"
                      onClick={() => setSelectedTarget(null)}
                    >
                      Choose Different Target
                    </button>
                  </div>
                ) : (
                  <div className="target-grid">
                    {playerRole === "doctor" ? (
                      // Special handling for doctor with self-heal option
                      <>
                        {alivePlayers.map((p, i) => (
                          <div 
                            className="target-box" 
                            key={i} 
                            onClick={() => handleTargetSelect(p.username)}
                          >
                            {p.username}
                          </div>
                        ))}
                        {/* Show self-heal option if doctor hasn't used it yet */}
                        {players.find(p => p.id === playerId)?.healedSelf !== true && (
                          <div 
                            className="target-box self-heal" 
                            onClick={() => handleTargetSelect("self-heal")}
                          >
                            Self-Heal (One Time Only)
                          </div>
                        )}
                      </>
                    ) : (
                      // Regular target selection for other roles
                      alivePlayers.map((p, i) => (
                        <div 
                          className="target-box" 
                          key={i} 
                          onClick={() => handleTargetSelect(p.username)}
                        >
                          {p.username}
                        </div>
                      ))
                    )}
                  </div>
                )
              ) : (
                <div className="no-action-message">
                  <p>
                    {isPolicemanRound1 
                      ? "You cannot shoot until round 2. Rest and wait." 
                      : "You have no night action. Rest well."
                    }
                  </p>
                  <button 
                    className="continue-button"
                    onClick={() => handleTargetSelect("no-action")}
                  >
                    Continue
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <h2 className="night-text fade-in-section">
            {actionCompleted && activeRole && rolesInGame.includes(activeRole) ? 
              getActionMessage(activeRole, actionCompleted) : 
              activeRole && rolesInGame.includes(activeRole) ? 
                roleDescriptions[activeRole] : 
                "Night passes quietly..."
            }
          </h2>
        )}
      </div>
    </div>
  );
}