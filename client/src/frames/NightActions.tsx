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
  doctor: "The doctor is choosing who to heal and save from death (healing also removes silence)...",
  "serial-killer": "The serial killer is picking their victim for tonight...",
  sacrifice: "The sacrifice is resting, waiting for the town's judgment...",
  "sacrifice-revenge": "The sacrifice is choosing their final victim...",
  policeman: "The policeman is taking aim at a suspect...",
  "policeman-dying": "The policeman is dying from a broken heart...",
  sheriff: "The sheriff is investigating someone's allegiance...",
  lookout: "The lookout is watching someone's house to see visitors...",
  mayor: "The mayor is sleeping soundly, preserving their strength...",
  citizen: "The citizen is sleeping soundly, hoping for dawn..."
};

const yourTurnMessages: Record<string, string> = {
  queen: "Choose someone to nullify their power tonight",
  mutilator: "Choose someone to silence (chat or vote)",
  killer: "Choose your target to eliminate (cannot kill Serial Killer)",
  doctor: "Choose someone to heal and save from death (also removes any silence effects)",
  "serial-killer": "Choose your victim (can kill anyone including mafia)",
  sacrifice: "You must wait - convince the town to vote you out tomorrow",
  "sacrifice-revenge": "Choose someone to take with you to the afterlife",
  policeman: "Choose someone to shoot (only from round 2+)",
  "policeman-dying": "You died from a broken heart after shooting an innocent...",
  sheriff: "Choose someone to investigate (👍 = Mafia/SK, 👎 = Innocent, 🤷‍♀️ = Queen visited)",
  lookout: "Choose someone to watch (you will see who visits them tonight)",
  mayor: "You have no night action - rest and preserve your vote power",
  citizen: "You have no night action - sleep and hope for dawn"
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
  dieNextRound?: boolean; // Track if policeman is dying from broken heart
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
  gameOver?: boolean;
  gameOverMessage?: string;
  winner?: string;
  alivePlayers?: any[];
}

export default function NightActions() {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentRole, setCurrentRole] = useState(location.state?.role || sessionStorage.getItem("role") || null);
  const playerId = sessionStorage.getItem("id");
  const lobbyCode = sessionStorage.getItem("lobbyCode");
  const username = sessionStorage.getItem("username");

  // Store role in sessionStorage if we got it from location state
  useEffect(() => {
    if (location.state?.role) {
      sessionStorage.setItem("role", location.state.role);
      setCurrentRole(location.state.role);
    }
  }, [location.state?.role]);

  // Store round in sessionStorage
  useEffect(() => {
    if (location.state?.round) {
      sessionStorage.setItem("round", location.state.round.toString());
    }
  }, [location.state?.round]);

  // Update role when promotion happens
  useEffect(() => {
    const handleRoleUpdate = () => {
      const newRole = sessionStorage.getItem("role");
      if (newRole && newRole !== currentRole) {
        console.log('Role updated from', currentRole, 'to', newRole);
        setCurrentRole(newRole);
      }
    };

    // Listen for storage events (in case role is updated in another tab)
    window.addEventListener('storage', handleRoleUpdate);
    
    return () => {
      window.removeEventListener('storage', handleRoleUpdate);
    };
  }, [currentRole]);

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
  const [gameRound, setGameRound] = useState(parseInt(sessionStorage.getItem("round") || "1"));
  const [rolesInGame, setRolesInGame] = useState<string[]>([]);
  const [isDead, setIsDead] = useState(false);

  // Initialize game state
  useEffect(() => {
    if (!lobbyCode || isInitialized) return;

    console.log('Initializing game state...', { currentRole, gameRound });

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
        sessionStorage.setItem("round", (data.round || 1).toString());
        
        // Extract roles that are actually in this game
        const gameRoles = data.players.map((p: Player) => p.role);
        setRolesInGame(gameRoles);
        console.log('Roles in this game:', gameRoles);
        
        // Check if current player is dead
        const currentPlayer = data.players.find((p: Player) => p.id === playerId);
        if (currentPlayer) {
          // Only set as dead if actually dead, not if marked to die next round
          setIsDead(!currentPlayer.alive && !currentPlayer.dieNextRound);
          if (!currentRole) {
            sessionStorage.setItem("role", currentPlayer.role);
            window.location.reload(); // Reload to get the role
          }
        }
        
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
  }, [lobbyCode, isInitialized, currentRole, playerId]);

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

    const handleNightActionStarted = ({ role, isDead, isPromoted, narration, isNoActionRole, isSacrificeRevenge }: any) => {
      console.log('🌙 Night action started event received:', { 
        role, isDead, isPromoted, narration, isNoActionRole, isSacrificeRevenge 
      });
      console.log('🎭 Current client state:', {
        currentRole,
        sessionRole: sessionStorage.getItem("role"),
        playerId,
        username: sessionStorage.getItem("username")
      });
      
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

      // Check if killer is dead and role is mutilator
      const isKillerDead = !players.find(p => p.role === "killer" && p.alive);
      const mutilatorPlayer = players.find(p => p.role === "mutilator");
      
      console.log('🔍 Mutilator promotion check:', {
        role,
        isKillerDead,
        mutilatorPlayer: mutilatorPlayer?.username,
        mutilatorAlive: mutilatorPlayer?.alive
      });
      
      // Special case: mutilator when killer is dead
      if (role === "mutilator" && isKillerDead && mutilatorPlayer?.alive) {
        console.log('✅ Mutilator turn with dead killer - showing narration only');
        setActionCompleted("mutilator-promotion");
        
        // Promote mutilator to killer in local storage if this is the current player
        if (mutilatorPlayer.id === playerId) {
          console.log('🔄 Promoting current player from mutilator to killer in sessionStorage');
          sessionStorage.setItem("role", "killer");
          setCurrentRole("killer");
        }
        
        // Server will handle the auto-completion after 5 seconds
        return;
      }

      // Check if this is the killer role and current player was the mutilator
      if (role === "killer") {
        const currentPlayerSessionRole = sessionStorage.getItem("role");
        console.log('🎯 Killer role event - checking if current player should act:', {
          role,
          currentPlayerSessionRole,
          currentRole,
          playerId,
          killerInPlayers: players.find(p => p.role === "killer")
        });
        
        // If session role is killer (was promoted from mutilator), this is our turn
        if (currentPlayerSessionRole === "killer") {
          console.log('✅ Current player is the new killer - this is our turn!');
          setCurrentRole("killer");
        }
      }

      // Check if current player is policeman dying from broken heart
      const currentPlayer = players.find(p => p.id === playerId);
      const isPolicemanDying = currentPlayer?.role === "policeman" && currentPlayer.dieNextRound;
      
      // If this is a dead player's turn, a role without night action, or policeman dying, show their role description and auto-complete
      if ((isDead && !isSacrificeRevenge) || isNoActionRole || isPolicemanDying) {
        console.log('🪦 Dead player, no-action role, or dying policeman turn:', role);
        setActionCompleted(role);
        // For no-action roles and dying players, the server will handle the auto-completion
        return;
      }
      
      console.log('✅ Role event processed, activeRole set to:', role);
    };

    const handleNightActionCompleted = ({ role, target }: { role: string, target: string }) => {
      console.log('Night action completed:', { role, target });
      setActionCompleted(target);
    };

    const handleNightEnded = (data: NightResult) => {
      console.log('Night ended event received:', data);
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
      
      // Check if current player is dead
      const currentPlayer = players.find(p => p.id === playerId);
      if (currentPlayer && !currentPlayer.alive) {
        // If player is dead, redirect to main menu after showing results
        setTimeout(() => {
          navigate("/");
        }, 5000);
        return;
      }
      
      // Pass night result data to Chat component
      setTimeout(() => {
        navigate("/chat", { 
          state: { 
            gameState: {
              deaths: data.deaths || [],
              muted: data.muted || [],
              wills: data.wills || { withWills: [], withoutWills: [] },
              investigations: data.investigations,
              lookoutResults: data.lookoutResults
            }
          } 
        });
      }, 5000);
    };

    const handleGameOver = (data: { message: string, winner: string, alivePlayers: any[] }) => {
      console.log('Game over event received:', data);
      setNightEnded(true);
      setNightResult({
        deaths: [],
        muted: [],
        wills: { withWills: [], withoutWills: [] },
        gameOver: true,
        gameOverMessage: data.message,
        winner: data.winner,
        alivePlayers: data.alivePlayers
      });
      
      // Redirect to main menu after showing game over message
      setTimeout(() => {
        navigate("/");
      }, 5000);
    };

    // Register socket event listeners
    socket.on('game-started', handleGameStarted);
    socket.on('night-action-started', handleNightActionStarted);
    socket.on('night-action-completed', handleNightActionCompleted);
    socket.on('night-ended', handleNightEnded);
    socket.on('game-over', handleGameOver);

    // Cleanup function
    return () => {
      socket.off('game-started', handleGameStarted);
      socket.off('night-action-started', handleNightActionStarted);
      socket.off('night-action-completed', handleNightActionCompleted);
      socket.off('night-ended', handleNightEnded);
      socket.off('game-over', handleGameOver);
    };
  }, [lobbyCode, navigate, rolesInGame, players, playerId]);

  const handleTargetSelect = (targetUsername: string) => {
    if (hasActed) return;
    
    // Additional safety check for policeman in round 1
    if (currentRole === "policeman" && gameRound < 2 && targetUsername !== "no-action") {
      console.warn('Policeman attempted action in round 1, blocking');
      return;
    }
    
    // Validate that the current role is actually in the game
    if (!rolesInGame.includes(currentRole)) {
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
        role: currentRole, 
        target: "no-action" 
      });
      return;
    }
    
    // Handle doctor self-heal
    if (targetUsername === "self-heal" && currentRole === "doctor") {
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
          role: currentRole, 
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
    if (currentRole === "mutilator") {
      setSelectedTarget(targetUsername);
      // Don't set hasActed yet, wait for mute type selection
      return;
    }
    
    // Handle all other action roles
    setHasActed(true);
    
    const action = actionMap[currentRole] || "noop";

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
      
      // For Lookout and Sheriff, show immediate result
      if (currentRole === "lookout") {
        // Get current round's actions for the target
        const currentRound = gameRound;
        const targetPlayer = players.find(p => p.username === targetUsername);
        if (targetPlayer) {
          const visitors = players.filter(p => 
            p.id !== playerId && // Exclude lookout
            p.id !== targetPlayer.id && // Exclude target
            p.alive // Only alive players
          ).map(p => p.username);
          
          setActionCompleted(`${targetUsername} - ${visitors.length > 0 ? visitors.join(", ") : "No visitors"}`);
        } else {
          setActionCompleted(targetUsername);
        }
        
        // Wait 3 seconds before proceeding to next role
        setTimeout(() => {
          socket.emit('night-action-completed', { 
            code: lobbyCode, 
            role: currentRole, 
            target: targetUsername 
          });
        }, 3000);
      } else if (currentRole === "sheriff") {
        // Determine result based on target's role
        const targetPlayer = players.find(p => p.username === targetUsername);
        let result = "👎"; // Default to innocent
        
        if (targetPlayer) {
          if (['killer', 'mutilator', 'serial-killer'].includes(targetPlayer.role)) {
            result = "👍"; // Mafia or Serial Killer
          } else if (targetPlayer.role === 'queen') {
            result = "🤷‍♀️"; // Queen
          }
        }
        
        // Only show result to the sheriff
        if (sessionStorage.getItem("role") === "sheriff") {
          setActionCompleted(`${targetUsername} - ${result}`);
        } else {
          setActionCompleted(targetUsername);
        }
        
        // Wait 3 seconds before proceeding to next role
        setTimeout(() => {
          socket.emit('night-action-completed', { 
            code: lobbyCode, 
            role: currentRole, 
            target: targetUsername 
          });
        }, 3000);
      } else {
        // For other roles, proceed normally
        socket.emit('night-action-completed', { 
          code: lobbyCode, 
          role: currentRole, 
          target: targetUsername 
        });
      }
    })
    .catch(err => {
      console.error("❌ Failed to send action:", err);
      setHasActed(false);
    });
  };

  const handleMutilatorAction = (type: "chat" | "vote") => {
    if (!selectedTarget || hasActed) return;
    
    // Validate that the current role is actually in the game
    if (!rolesInGame.includes(currentRole)) {
      console.warn('Player role not in current game, forcing reload');
      window.location.reload();
      return;
    }
    
    // Validate that this is actually the mutilator
    if (currentRole !== "mutilator") {
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
        role: currentRole, 
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

  const getYourTurnMessage = (role: string, round: number, isSacrificeRevenge?: boolean) => {
    // Remove the mutilator promotion logic from here since it's handled elsewhere
    
    if (role === "policeman") {
      const currentPlayer = players.find(p => p.id === playerId);
      if (currentPlayer?.dieNextRound) {
        return yourTurnMessages["policeman-dying"];
      }
      if (round < 2) {
        return "You cannot shoot until round 2. Rest and wait.";
      }
    }
    if (role === "sacrifice" && isSacrificeRevenge) {
      return yourTurnMessages["sacrifice-revenge"];
    }
    if (role === "lookout") {
      return "Choose someone to watch - you will see who visits them tonight";
    }
    if (role === "sheriff") {
      return "Choose someone to investigate:\n👍 = Mafia or Serial Killer\n👎 = Innocent\n🤷‍♀️ = If visited by Queen";
    }
    return yourTurnMessages[role] || "Choose your action";
  };

  const getActionMessage = (role: string, target: string, isSacrificeRevenge?: boolean) => {
    if (target === "no-action") {
      return `${role === "sacrifice" ? "The sacrifice" : role === "mayor" ? "The mayor" : "The citizen"} rests quietly through the night.`;
    }

    // Special case for mutilator promotion - show original mutilator description
    if (target === "mutilator-promotion") {
      return roleDescriptions["mutilator"];
    }

    // Special handling for Lookout and Sheriff
    if (role === "lookout") {
      // Extract visitors from target string (format: "username - visitor1, visitor2")
      const [username, visitors] = target.split(" - ");
      return `You are watching ${username}...\nVisitors: ${visitors}`;
    }
    if (role === "sheriff") {
      // Only show result to the sheriff
      if (sessionStorage.getItem("role") === "sheriff") {
        const [username, result] = target.split(" - ");
        return `You investigated ${username} and found: ${result}`;
      }
      return roleDescriptions["sheriff"];
    }

    // Always show the role description from roleDescriptions if available
    if (roleDescriptions[role]) {
      if (role === "sacrifice" && isSacrificeRevenge) {
        return roleDescriptions["sacrifice-revenge"];
      }
      // For policeman dying from broken heart, show normal message to others
      const currentPlayer = players.find(p => p.id === playerId);
      if (role === "policeman" && currentPlayer?.dieNextRound && currentPlayer.id === playerId) {
        return roleDescriptions["policeman-dying"];
      }
      return roleDescriptions[role];
    }
    
    const messages: Record<string, string> = {
      queen: "The queen has made their choice and nullified someone's power.",
      mutilator: "The mutilator has made their choice and decided how to silence someone.",
      killer: "The killer has made their choice and marked their target.",
      doctor: "The doctor has made their choice and prepared to heal someone.",
      "serial-killer": "The serial killer has made their choice and selected their victim.",
      sacrifice: "The sacrifice rests, waiting for dawn and judgment.",
      "sacrifice-revenge": "The sacrifice has chosen their final victim.",
      policeman: "The policeman has made their choice and taken aim.",
      sheriff: "The sheriff has made their choice and begun their investigation.",
      lookout: "The lookout has made their choice and begun watching.",
      mayor: "The mayor sleeps soundly, preserving their strength.",
      citizen: "The citizen sleeps peacefully, hoping for a better tomorrow."
    };
    
    if (role === "sacrifice" && isSacrificeRevenge) {
      return messages["sacrifice-revenge"];
    }
    return messages[role] || "Night passes quietly...";
  };

  const getNightResultMessage = () => {
    const { deaths, muted, wills, investigations, lookoutResults, gameOver, gameOverMessage } = nightResult;
    const currentPlayerRole = sessionStorage.getItem("role");
    
    if (gameOver) {
      return gameOverMessage;
    }
    
    let message = "";
    
    // Show deaths to everyone
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

    // Show muted players to everyone
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

    // Show investigation results only to the Sheriff
    if (currentPlayerRole === "sheriff" && investigations && Object.keys(investigations).length > 0) {
      const currentPlayerUsername = sessionStorage.getItem("username");
      if (currentPlayerUsername && investigations[currentPlayerUsername]) {
        message += `\n🔍 Investigation result: ${investigations[currentPlayerUsername]}`;
      }
    }

    // Show lookout results only to the Lookout
    if (currentPlayerRole === "lookout" && lookoutResults && Object.keys(lookoutResults).length > 0) {
      const currentPlayerUsername = sessionStorage.getItem("username");
      if (currentPlayerUsername && lookoutResults[currentPlayerUsername]) {
        const myVisitors = lookoutResults[currentPlayerUsername];
        const visitorList = Array.isArray(myVisitors) && myVisitors.length > 0 ? myVisitors.join(", ") : "No visitors";
        message += `\n👁️ You saw: ${visitorList}`;
      }
    }

    return message;
  };

  // Determine what to show
  const isMyTurn = (activeRole === currentRole && actionRoles.includes(currentRole) && !hasActed && !isDead) ||
                   // Special case: if activeRole is "killer" and current player was promoted from mutilator to killer
                   (activeRole === "killer" && currentRole === "killer" && sessionStorage.getItem("role") === "killer" && !hasActed && !isDead);
  const alivePlayers = players.filter(p => {
    // Include players who are alive OR marked to die next round (policeman)
    return (p.alive || p.dieNextRound) && p.username !== username;
  });
  
  // Special case: Policeman cannot act in round 1
  const canActuallyAct = currentRole !== "policeman" || gameRound >= 2;
  
  // Additional validation to prevent inconsistent states
  const shouldShowAction = isMyTurn && canActuallyAct && rolesInGame.includes(currentRole) && !isDead;
  
  // Policeman specific validation - force no action in round 1
  const isPolicemanRound1 = currentRole === "policeman" && gameRound < 2;

  console.log('Render state:', {
    activeRole,
    currentRole,
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
    rolesInGame,
    isDead
  });

  // Update roles in game when they change
  useEffect(() => {
    if (!lobbyCode) return;

    const handleRoleUpdate = async () => {
      try {
        const response = await fetch(`http://localhost:5001/api/game/${lobbyCode}`);
        const data = await response.json();
        if (data.players) {
          const gameRoles = data.players.map((p: Player) => p.role);
          setRolesInGame(gameRoles);
        }
      } catch (error) {
        console.error('Failed to update roles:', error);
      }
    };

    socket.on('role-updated', handleRoleUpdate);

    return () => {
      socket.off('role-updated', handleRoleUpdate);
    };
  }, [lobbyCode]);

  if (!currentRole || !isInitialized) {
    console.log('Not ready to render - missing currentRole or not initialized');
    return (
      <div className="night-actions-wrapper">
        <div className="night-actions-container">
          <h2 className="night-text fade-in-section">Loading game state...</h2>
        </div>
      </div>
    );
  }

  // If player is dead, show a message and redirect to main menu
  if (isDead) {
    return (
      <div className="night-actions-wrapper">
        <div className="night-actions-container">
          <h2 className="night-text fade-in-section">You are no longer in the game.</h2>
          <p>Redirecting to main menu...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="night-actions-wrapper">
      <div className={`night-actions-container ${
        isMyTurn && currentRole === "mutilator" ? "mutilator-active" : ""
      }`}>
        {nightEnded ? (
          <div className="night-end-screen fade-in-section">
            {nightResult.gameOver ? (
              <div className="game-over-screen">
                <h2>Game Over!</h2>
                <p className="victory-message">{nightResult.gameOverMessage}</p>
                <div className="survivors">
                  <h3>Survivors:</h3>
                  <ul>
                    {nightResult.alivePlayers?.map((player: any) => (
                      <li key={player.username}>
                        {player.username} ({player.role})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <>
                <h2>Morning time!</h2>
                <p>{getNightResultMessage()}</p>
              </>
            )}
          </div>
        ) : isMyTurn ? (
          <div className="player-turn-ui fade-in-section">
            <h2 className="your-turn">Your turn</h2>
            <p className="turn-instruction">{getYourTurnMessage(currentRole, gameRound, nightResult.gameOver)}</p>
            <div className="card-grid">
              <img
                className="your-role-img"
                src={`/cards/${currentRole}.png`}
                alt={currentRole.replace("-", " ")}
              />
              {shouldShowAction && !isPolicemanRound1 ? (
                currentRole === "mutilator" && selectedTarget ? (
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
                    {currentRole === "doctor" ? (
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
              getActionMessage(activeRole, actionCompleted, nightResult.gameOver) : 
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