import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { io } from "socket.io-client";
import "../styles/Chat.css";

// Create socket instance
const socket = io("http://localhost:5001", {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
  withCredentials: true,
});

type ChatPhase = 'testaments' | 'discussions' | 'accusations' | 'completed';

interface Message {
  username: string;
  message: string;
  type: 'normal' | 'testament' | 'accusation' | 'defense' | 'system';
  timestamp: Date;
}

interface Player {
  id: string;
  username: string;
  role: string;
  alive: boolean;
  muted?: string;
}

interface GameState {
  deaths: string[];
  muted: Array<{
    username: string;
    type: 'chat' | 'vote';
    muterName: string;
  }> | string[];
  investigations?: Record<string, string>;
  lookoutResults?: Record<string, string[]>;
}

export default function Chat() {
    const navigate = useNavigate();
  const location = useLocation();
    const messagesEndRef = useRef<HTMLDivElement>(null);

  // Game state
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>({ deaths: [], muted: [] });
  const [currentPhase, setCurrentPhase] = useState<ChatPhase>('testaments');
  
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [canSendMessage, setCanSendMessage] = useState(true);
  
  // Testament state
  const [deadPlayers, setDeadPlayers] = useState<string[]>([]);
  const [currentTestamentPlayer, setCurrentTestamentPlayer] = useState<string | null>(null);
  const [testamentTimeLeft, setTestamentTimeLeft] = useState(20);
  const [hasWrittenTestament, setHasWrittenTestament] = useState(false);
  const [testamentsWritten, setTestamentsWritten] = useState<string[]>([]);
  
  // Timer state
  const [phaseTimeLeft, setPhaseTimeLeft] = useState(0);
  const [totalTimeLeft, setTotalTimeLeft] = useState(0);
  
  // Voting state
  const [accusedPlayer, setAccusedPlayer] = useState<string | null>(null);
  const [voteToProceed, setVoteToProceed] = useState<Set<string>>(new Set());
  const [hasVotedToProceed, setHasVotedToProceed] = useState(false);
  
  // Sync state
  const [isInitialized, setIsInitialized] = useState(false);
  
  // User info
  const username = sessionStorage.getItem("username") || "";
  const playerId = sessionStorage.getItem("id") || "";
  const lobbyCode = sessionStorage.getItem("lobbyCode") || "";
  
  // Check if current user is alive
  const currentPlayer = players.find(p => p.username === username);
  const isAlive = currentPlayer?.alive ?? true;
  const isDead = !isAlive;
  const isDeadViewer = isDead && hasWrittenTestament;
  
  // Check if current user is muted
  const isMuted = (() => {
    if (!Array.isArray(gameState.muted) || gameState.muted.length === 0) return false;
    
    // Check if it's the new format (array of objects)
    if (typeof gameState.muted[0] === 'object' && gameState.muted[0] !== null) {
      const mutedObjects = gameState.muted as Array<{
        username: string;
        type: 'chat' | 'vote';
        muterName: string;
      }>;
      return mutedObjects.some(m => m.username === username && m.type === 'chat');
    }
    
    // Old format (array of strings)
    const mutedStrings = gameState.muted as string[];
    return mutedStrings.includes(username);
  })();

  // Update server state helper
  const updateServerState = (state: Partial<{
    chatPhase: ChatPhase;
    currentTestamentPlayer: string | null;
    testamentTimeLeft: number;
    phaseTimeLeft: number;
    totalTimeLeft: number;
    testamentsWritten: string[];
    accusedPlayer: string | null;
  }>) => {
    socket.emit('update-chat-state', { code: lobbyCode, state });
  };

  // Initialize game state and sync with server
  useEffect(() => {
    if (!lobbyCode || isInitialized) return;

    console.log('Initializing chat state...');

    // Join lobby room
    socket.emit('join-lobby', { 
      code: lobbyCode, 
      username, 
      id: playerId 
    });

    // Join chat and request synchronization
    socket.emit('join-chat', { code: lobbyCode });

    // Get game state from navigation (for initial deaths data)
    const navigationState = location.state?.gameState;
    if (navigationState) {
      setGameState(navigationState);
      setDeadPlayers(navigationState.deaths || []);
    }

    // Fetch current game players
    fetch(`http://localhost:5001/api/game/${lobbyCode}`)
      .then(res => res.json())
      .then(data => {
        if (data.players) {
          setPlayers(data.players);
        }
      })
      .catch(err => console.error("Failed to fetch game data:", err));

    setIsInitialized(true);
  }, [lobbyCode, isInitialized, location.state, username, playerId]);

  // Socket event listeners
  useEffect(() => {
    if (!lobbyCode) return;

    // Chat state synchronization
    const handleChatStateSync = (state: any) => {
      console.log('Chat state synced:', state);
      setCurrentPhase(state.chatPhase);
      setCurrentTestamentPlayer(state.currentTestamentPlayer);
      setTestamentTimeLeft(state.testamentTimeLeft);
      setPhaseTimeLeft(state.phaseTimeLeft);
      setTotalTimeLeft(state.totalTimeLeft);
      setAccusedPlayer(state.accusedPlayer);
      setVoteToProceed(new Set(state.votesToProceed || []));
      
      // Check if current user has written testament
      if (state.testamentsWritten && state.testamentsWritten.includes(username)) {
        setHasWrittenTestament(true);
      }
      setTestamentsWritten(state.testamentsWritten || []);
    };

    // Chat state updates from other players
    const handleChatStateUpdated = (state: any) => {
      console.log('Chat state updated:', state);
      setCurrentPhase(state.chatPhase);
      setCurrentTestamentPlayer(state.currentTestamentPlayer);
      setTestamentTimeLeft(state.testamentTimeLeft);
      setPhaseTimeLeft(state.phaseTimeLeft);
      setTotalTimeLeft(state.totalTimeLeft);
      setAccusedPlayer(state.accusedPlayer);
      
      // Update testaments written list
      if (state.testamentsWritten) {
        setTestamentsWritten(state.testamentsWritten);
      }
    };

    const handleChatMessage = (data: { message: Message }) => {
      setMessages(prev => [...prev, data.message]);
    };

    const handleVoteToProceed = (data: { username: string, total: number, required: number }) => {
      setVoteToProceed(prev => new Set([...Array.from(prev), data.username]));
      
      if (data.total >= data.required) {
        navigate("/vote");
      }
    };

    const handleProceedToVoting = () => {
      console.log('Proceeding to voting phase');
      navigate("/vote");
    };

    // Register socket event listeners
    socket.on('chat-state-sync', handleChatStateSync);
    socket.on('chat-state-updated', handleChatStateUpdated);
    socket.on('chat-message', handleChatMessage);
    socket.on('vote-to-proceed', handleVoteToProceed);
    socket.on('proceed-to-voting', handleProceedToVoting);

    // Cleanup function
    return () => {
      socket.off('chat-state-sync', handleChatStateSync);
      socket.off('chat-state-updated', handleChatStateUpdated);
      socket.off('chat-message', handleChatMessage);
      socket.off('vote-to-proceed', handleVoteToProceed);
      socket.off('proceed-to-voting', handleProceedToVoting);
    };
  }, [lobbyCode, navigate, username]);

  // Testament timer - separate from phase timer
  useEffect(() => {
    if (currentPhase !== 'testaments') return;

    const timer = setInterval(() => {
      setTestamentTimeLeft(prev => {
        if (prev <= 1) {
          // Testament time is up for all players
          if (currentPhase === 'testaments') {
            handleTestamentPhaseComplete();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [currentPhase]);

  // Phase timer - runs for all phases
  useEffect(() => {
    if (currentPhase === 'completed') return;

    const timer = setInterval(() => {
      setPhaseTimeLeft(prev => {
        if (prev <= 1) {
          handlePhaseComplete();
          return 0;
        }
        const newTime = prev - 1;
        // Update server every 10 seconds to keep sync
        if (newTime % 10 === 0) {
          updateServerState({ phaseTimeLeft: newTime });
        }
        return newTime;
      });

      // Only run total timer during discussions and accusations
      if (currentPhase !== 'testaments') {
        setTotalTimeLeft(prev => {
          if (prev <= 1) {
            // Total time is up, proceed to voting
            navigate("/vote");
            return 0;
          }
          const newTime = prev - 1;
          // Update server every 10 seconds to keep sync
          if (newTime % 10 === 0) {
            updateServerState({ totalTimeLeft: newTime });
          }
          return newTime;
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [currentPhase, navigate]);

  const handleTestamentPhaseComplete = () => {
    console.log('Testament phase completed');
    // All testaments phase done, move to discussions
    setCurrentPhase('discussions');
    setPhaseTimeLeft(300); // 5 minutes
    setCurrentTestamentPlayer(null);
    updateServerState({ 
      chatPhase: 'discussions', 
      phaseTimeLeft: 300, 
      currentTestamentPlayer: null 
    });
  };

  const handleTestamentComplete = () => {
    // This player has written their testament, but phase continues
    // Just update the server about this player's testament
    const newTestamentsWritten = [...testamentsWritten, username];
    setTestamentsWritten(newTestamentsWritten);
    updateServerState({ testamentsWritten: newTestamentsWritten });
  };

  const handlePhaseComplete = () => {
    switch (currentPhase) {
      case 'testaments':
        handleTestamentPhaseComplete();
        break;
      case 'discussions':
        setCurrentPhase('accusations');
        setPhaseTimeLeft(30); // 30 seconds
        updateServerState({ chatPhase: 'accusations', phaseTimeLeft: 30 });
        break;
      case 'accusations':
        setCurrentPhase('completed');
        updateServerState({ chatPhase: 'completed' });
        navigate("/vote");
        break;
    }
  };

  const handleSendMessage = () => {
    if (!input.trim() || !canSendMessage) return;

    const message: Message = {
      username,
      message: input.trim(),
      type: 'normal',
      timestamp: new Date()
    };

    // Handle testament phase
    if (currentPhase === 'testaments' && username === currentTestamentPlayer) {
      message.type = 'testament';
      setHasWrittenTestament(true);
      setCanSendMessage(false);
      
      // Update server with testament written
      updateServerState({ testamentsWritten: [username] });
      
      handleTestamentComplete();
    }

    // Handle accusation phase
    if (currentPhase === 'accusations') {
      if (input.startsWith('/accuse ')) {
        const accusedName = input.replace('/accuse ', '').trim();
        const targetPlayer = players.find(p => p.username === accusedName && p.alive);
        
        if (targetPlayer && !accusedPlayer) {
          setAccusedPlayer(accusedName);
          updateServerState({ accusedPlayer: accusedName });
          message.type = 'accusation';
          message.message = `${username} accuses ${accusedName}!`;
          
          // Add system message about defense time
          setTimeout(() => {
            setMessages(prev => [...prev, {
              username: 'System',
              message: `${accusedName} can now defend themselves.`,
              type: 'system',
              timestamp: new Date()
            }]);
          }, 100);
        } else {
          return; // Invalid accusation or already accused someone
        }
      } else if (username === accusedPlayer) {
        message.type = 'defense';
      }
    }

    setMessages(prev => [...prev, message]);
    setInput("");

    // Emit message to other players
    socket.emit('chat-message', {
      code: lobbyCode,
      message: message
    });
  };

  const handleVoteToProceed = () => {
    if (!isAlive || hasVotedToProceed) return;
    
    setHasVotedToProceed(true);
    const newVoteSet = new Set(voteToProceed);
    newVoteSet.add(username);
    setVoteToProceed(newVoteSet);

    socket.emit('vote-to-proceed', {
      code: lobbyCode,
      username
    });

    // Check if all alive players have voted
    const alivePlayers = players.filter(p => p.alive);
    if (newVoteSet.size >= alivePlayers.length) {
      navigate("/vote");
    }
  };

  // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

  // Determine if user can send messages
  const canSend = () => {
    if (isDeadViewer) return false;
    if (isMuted && currentPhase !== 'testaments') return false;
    
    switch (currentPhase) {
      case 'testaments':
        // Any dead player who hasn't written can write during testament phase
        return deadPlayers.includes(username) && !hasWrittenTestament;
      case 'discussions':
        return isAlive;
      case 'accusations':
        return isAlive && (input.startsWith('/accuse ') || username === accusedPlayer);
      default:
        return false;
    }
  };

  const getPhaseTitle = () => {
    switch (currentPhase) {
      case 'testaments': return 'Testaments';
      case 'discussions': return 'Discussions';
      case 'accusations': return 'Accusations & Defense';
      default: return 'Chat';
    }
  };

  const getInputPlaceholder = () => {
    if (!canSend()) {
      if (isDeadViewer) return "You are a dead viewer...";
      if (isMuted) return "You are silenced...";
      return "You cannot speak now...";
    }

    switch (currentPhase) {
      case 'testaments':
        return "Write your last words (20 seconds for all dead players)...";
      case 'discussions':
        return "Share your thoughts...";
      case 'accusations':
        return username === accusedPlayer 
          ? "Defend yourself..." 
          : "Write /accuse [username] to accuse someone...";
      default:
        return "Write a message...";
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const alivePlayers = players.filter(p => p.alive);
  const allVotedToProceed = voteToProceed.size >= alivePlayers.length;

    return (
        <div className="chat-wrapper">
            <div className="chat-container">
        <div className="chat-header">
          <div className="phase-title">{getPhaseTitle()}</div>
          <div className="timer-container">
            <div className="phase-timer">
              {currentPhase === 'testaments' 
                ? `Testaments: ${formatTime(phaseTimeLeft)}`
                : currentPhase === 'discussions'
                ? `Discussion time: ${formatTime(phaseTimeLeft)}`
                : currentPhase === 'accusations' 
                ? `Accusations time: ${formatTime(phaseTimeLeft)}`
                : `Phase: ${formatTime(phaseTimeLeft)}`
              }
            </div>
          </div>
        </div>

                <div className="chat-messages">
                    {messages.map((msg, index) => (
            <div key={index} className={`chat-message ${msg.type}`}>
                            <span className="chat-user">{msg.username}:</span> {msg.message}
                        </div>
                    ))}
          <div ref={messagesEndRef} />
                </div>

                <div className="chat-input-wrapper">
                    <div className="chat-input-area">
                        <input
                            type="text"
              placeholder={getInputPlaceholder()}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              disabled={!canSend()}
                        />
            <button 
              onClick={handleSendMessage}
              disabled={!canSend() || !input.trim()}
            >
              Send
            </button>
                    </div>

          {/* Voting information */}
          {isAlive && (
            <div className="vote-info">
              {voteToProceed.size}/{alivePlayers.length} players ready to proceed
            </div>
          )}
        </div>
      </div>

      {/* Global Proceed to Voting button */}
      {isAlive && (
        <button 
          className={`chat-vote-button ${hasVotedToProceed ? 'voted' : ''} ${allVotedToProceed ? 'ready' : ''}`}
          onClick={handleVoteToProceed}
          disabled={hasVotedToProceed}
        >
          {hasVotedToProceed ? 'Waiting for others...' : 'Proceed to Voting'}
                    </button>
      )}
        </div>
    );
}