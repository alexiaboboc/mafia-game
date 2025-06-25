import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "../styles/Vote.css";

// Create socket instance
const socket = io("http://localhost:5001", {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
  withCredentials: true,
});

type VotePhase = 'voting' | 'results' | 'testament' | 'game-over' | 'next-round' | 'testament-display';

interface Player {
  id: string;
  username: string;
  role: string;
  alive: boolean;
  muted?: string;
  isSpectator?: boolean;
  willBecomeSpectator?: boolean;
  hasUsedTripleVote?: boolean;
  mayorRevealed?: boolean;
}

interface VoteResult {
  eliminatedPlayer: string | null;
  voteCounts: Record<string, number>;
  totalVotes: number;
  tie: boolean;
}

interface GameResult {
  gameOver: boolean;
  winner: 'mafia' | 'town' | 'sacrifice' | 'serial-killer' | null;
  message: string;
  alivePlayers: Player[];
}

export default function VotingFrame() {
  const navigate = useNavigate();
  
  // Game state
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPhase, setCurrentPhase] = useState<VotePhase>('voting');
  const [voteTimeLeft, setVoteTimeLeft] = useState(60); // 1 minute to vote
  const [testamentTimeLeft, setTestamentTimeLeft] = useState(30); // 30s for testament
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Voting state
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteResult, setVoteResult] = useState<VoteResult | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [tripleVoteMode, setTripleVoteMode] = useState(false);
  const [revealedMayors, setRevealedMayors] = useState<Set<string>>(new Set());
  
  // Testament state
  const [eliminatedPlayer, setEliminatedPlayer] = useState<string | null>(null);
  const [testamentMessage, setTestamentMessage] = useState("");
  const [testamentWritten, setTestamentWritten] = useState(false);
  
  // User info
  const username = sessionStorage.getItem("username") || "";
  const playerId = sessionStorage.getItem("id") || "";
  const lobbyCode = sessionStorage.getItem("lobbyCode") || "";
  
  const currentPlayer = players.find(p => p.username === username);
  const isAlive = currentPlayer?.alive ?? true;
  const isEliminated = eliminatedPlayer === username;
  const isSacrificeSpectator = currentPlayer?.isSpectator ?? false;
  
  // Check if player is vote-muted
  const isVoteMuted = currentPlayer?.muted === 'vote';
  
  // Check if current player is mayor and can use triple vote
  const isMayor = currentPlayer?.role === 'mayor';
  const canUseTripleVote = isMayor && !currentPlayer?.hasUsedTripleVote;

  // Initialize game state
  useEffect(() => {
    if (!lobbyCode || isInitialized) return;

    console.log('Initializing voting state...');

    // Join lobby room
    socket.emit('join-lobby', { 
      code: lobbyCode, 
      username, 
      id: playerId 
    });

    // Fetch current game state
    fetch(`http://localhost:5001/api/game/${lobbyCode}`)
      .then(res => res.json())
      .then(data => {
        if (data.players) {
          setPlayers(data.players);
        }
      })
      .catch(err => console.error("Failed to fetch game data:", err));

    // Request current voting state and sync
    socket.emit('join-voting', { code: lobbyCode });
    
    setIsInitialized(true);
  }, [lobbyCode, username, playerId, isInitialized]);

  // Socket event listeners
  useEffect(() => {
    if (!lobbyCode) return;

    const handleVoteUpdate = (data: { votes: Record<string, string>, timeLeft: number }) => {
      console.log('📊 Vote update received:', data);
      setVoteTimeLeft(data.timeLeft);
      
      // Check if current user has already voted
      if (data.votes[username]) {
        setSelectedPlayer(data.votes[username]);
        setHasVoted(true);
        console.log(`✅ User ${username} has already voted for: ${data.votes[username]}`);
      }
    };

    const handleVoteEnded = (data: VoteResult) => {
      console.log('🎯 Vote ended event received:', data);
      setVoteResult(data);
      setCurrentPhase('results');
      
      if (data.eliminatedPlayer) {
        console.log(`💀 Player eliminated: ${data.eliminatedPlayer}`);
        setEliminatedPlayer(data.eliminatedPlayer);
        // If eliminated player should write testament, go to testament phase
        setTimeout(() => {
          console.log('📝 Transitioning to testament phase');
          setCurrentPhase('testament');
          setTestamentTimeLeft(30);
        }, 3000);
      } else {
        console.log('🤷‍♀️ No elimination, checking game state');
        // No elimination, check game state or go to next round
        setTimeout(() => {
          checkGameStateAndProceed();
        }, 3000);
      }
    };

    const handleGameOver = (data: GameResult) => {
      console.log('🎮 Game over event received:', data);
      setGameResult(data);
      setCurrentPhase('game-over');
    };

    const handleTestamentReceived = (data: { username: string, message: string }) => {
      console.log('📝 Testament received:', data);
      
      // Show testament message in UI
      setCurrentPhase('testament-display');
      setTestamentMessage(data.message);
      setEliminatedPlayer(data.username);
      
      // After 3 seconds, proceed to next round
      setTimeout(() => {
        checkGameStateAndProceed();
      }, 3000);
    };

    const handleNextRound = () => {
      console.log('🌙 Next round event received');
      setCurrentPhase('next-round');
      
      // Clean up all state
      setVoteResult(null);
      setEliminatedPlayer(null);
      setTestamentMessage("");
      setTestamentWritten(false);
      setSelectedPlayer(null);
      setHasVoted(false);
      
      // Get current role and round from sessionStorage
      const currentRole = sessionStorage.getItem("role");
      const currentRound = parseInt(sessionStorage.getItem("round") || "1");
      
      // Add a small delay before navigating
      setTimeout(() => {
        console.log('➡️ Navigating to night actions with role:', currentRole, 'round:', currentRound + 1);
        // Use replace: true to prevent back navigation
        navigate("/night-actions", { 
          replace: true,
          state: {
            role: currentRole,
            round: currentRound + 1
          }
        });
      }, 2000);
    };

    const handleVotingStateSync = (data: any) => {
      console.log('🔄 Voting state synced:', data);
      if (data.phase) {
        console.log(`🎭 Setting phase to: ${data.phase}`);
        setCurrentPhase(data.phase);
      }
      if (data.voteResult) {
        console.log('📊 Setting vote result:', data.voteResult);
        setVoteResult(data.voteResult);
      }
      if (data.eliminatedPlayer) {
        console.log(`💀 Setting eliminated player: ${data.eliminatedPlayer}`);
        setEliminatedPlayer(data.eliminatedPlayer);
      }
      if (data.gameResult) {
        console.log('🎮 Setting game result:', data.gameResult);
        setGameResult(data.gameResult);
      }
      if (data.timeLeft !== undefined) {
        if (data.phase === 'voting') {
          console.log(`⏰ Setting vote time left: ${data.timeLeft}`);
          setVoteTimeLeft(data.timeLeft);
        } else if (data.phase === 'testament') {
          console.log(`📝 Setting testament time left: ${data.timeLeft}`);
          setTestamentTimeLeft(data.timeLeft);
        }
      }
      if (data.votes && data.phase === 'voting') {
        // Check if current user has already voted
        if (data.votes[username]) {
          setSelectedPlayer(data.votes[username]);
          setHasVoted(true);
          console.log(`✅ Restored vote for ${username}: ${data.votes[username]}`);
        }
      }
    };

    const handlePlayerStatusUpdated = (data: { playerId: string, username: string, willBecomeSpectator?: boolean, isSpectator?: boolean }) => {
      console.log('🔄 Player status updated in voting:', data);
      setPlayers(prevPlayers => 
        prevPlayers.map(player => 
          player.id === data.playerId 
            ? { 
                ...player, 
                willBecomeSpectator: data.willBecomeSpectator ?? player.willBecomeSpectator,
                isSpectator: data.isSpectator ?? player.isSpectator
              }
            : player
        )
      );
    };

    const handleMayorRevealed = (data: { mayorUsername: string, vote: string, isTripleVote: boolean }) => {
      console.log('🏛️ Mayor revealed:', data);
      setRevealedMayors(prev => new Set(prev).add(data.mayorUsername));
      
      // Update player state
      setPlayers(prevPlayers => 
        prevPlayers.map(player => 
          player.username === data.mayorUsername
            ? { 
                ...player, 
                mayorRevealed: true,
                hasUsedTripleVote: true
              }
            : player
        )
      );
    };

    console.log('🔌 Setting up socket listeners for voting');

    // Register socket event listeners
    socket.on('vote-update', handleVoteUpdate);
    socket.on('vote-ended', handleVoteEnded);
    socket.on('game-over', handleGameOver);
    socket.on('next-round', handleNextRound);
    socket.on('testament-received', handleTestamentReceived);
    socket.on('voting-state-sync', handleVotingStateSync);
    socket.on('player-status-updated', handlePlayerStatusUpdated);
    socket.on('mayor-revealed', handleMayorRevealed);

    return () => {
      console.log('🔌 Cleaning up socket listeners for voting');
      socket.off('vote-update', handleVoteUpdate);
      socket.off('vote-ended', handleVoteEnded);
      socket.off('game-over', handleGameOver);
      socket.off('next-round', handleNextRound);
      socket.off('testament-received', handleTestamentReceived);
      socket.off('voting-state-sync', handleVotingStateSync);
      socket.off('player-status-updated', handlePlayerStatusUpdated);
      socket.off('mayor-revealed', handleMayorRevealed);
    };
  }, [lobbyCode, navigate, username]);

  // Vote timer
  useEffect(() => {
    if (currentPhase !== 'voting') return;

    const timer = setInterval(() => {
      setVoteTimeLeft(prev => {
        if (prev <= 1) {
          // Time's up, automatically submit if not voted
          if (!hasVoted) {
            handleSubmitVote();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [currentPhase, hasVoted]);

  // Testament timer
  useEffect(() => {
    if (currentPhase !== 'testament') return;

    const timer = setInterval(() => {
      setTestamentTimeLeft(prev => {
        if (prev <= 1) {
          // Testament time is up
          handleTestamentComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [currentPhase]);

  const handleVote = (targetUsername: string) => {
    if (hasVoted || !isAlive || isVoteMuted) return;
    
    setSelectedPlayer(targetUsername);
  };

  const handleSubmitVote = () => {
    if (hasVoted || !isAlive || isVoteMuted || isSacrificeSpectator) return;
    
    const vote = selectedPlayer || 'abstain';
    console.log(`🗳️ Submitting vote: ${vote}${tripleVoteMode ? ' (TRIPLE)' : ''}`);
    setHasVoted(true);
    
    if (tripleVoteMode && canUseTripleVote) {
      socket.emit('cast-triple-vote', { 
        code: lobbyCode, 
        vote: vote,
        username: username
      });
    } else {
      socket.emit('cast-vote', { 
        code: lobbyCode, 
        vote: vote,
        username: username
      });
    }
  };

  const toggleTripleVote = () => {
    if (canUseTripleVote) {
      setTripleVoteMode(!tripleVoteMode);
    }
  };

  const handleTestamentSubmit = () => {
    if (!testamentMessage.trim() || testamentWritten) return;
    
    console.log('📝 Submitting testament:', testamentMessage);
    setTestamentWritten(true);
    
    socket.emit('testament-message', {
      code: lobbyCode,
      username: username,
      message: testamentMessage.trim()
    });

    // If this is the eliminated player and NOT sacrifice, redirect to main menu after submitting testament
    if (isEliminated && currentPlayer?.role !== 'sacrifice') {
      setTimeout(() => {
        navigate("/");
      }, 3000);
    }
  };

  const handleTestamentComplete = () => {
    if (!testamentWritten) {
      setTestamentWritten(true);
      socket.emit('testament-message', {
        code: lobbyCode,
        username: eliminatedPlayer,
        message: null // No testament
      });

      // If this is the eliminated player and NOT sacrifice, redirect to main menu
      if (isEliminated && currentPlayer?.role !== 'sacrifice') {
        setTimeout(() => {
          navigate("/");
        }, 3000);
      }
    }
  };

  const checkGameStateAndProceed = () => {
    // Request game state check from server
    socket.emit('check-game-state', { code: lobbyCode });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const alivePlayers = players.filter(p => p.alive && !p.isSpectator && !p.willBecomeSpectator);
  const votablePlayers = alivePlayers.filter(p => p.username !== username);

  // Render different phases
  if (currentPhase === 'voting') {
    return (
      <div className="voting-wrapper">
        <div className="voting-container">
          <h1 className="voting-title">🗳️ Voting Phase</h1>
          <div className="vote-timer">Time left: {formatTime(voteTimeLeft)}</div>
          <p className="voting-instruction">
            {!isAlive 
              ? "You are dead and cannot participate in voting." 
              : isSacrificeSpectator
                ? "You are spectating the game and cannot participate in voting."
              : isVoteMuted 
                ? "You are vote-silenced and cannot participate." 
                : "Choose someone you suspect. Majority decides the fate."
            }
          </p>

          {isAlive && !isVoteMuted && !isSacrificeSpectator ? (
            <div className="voting-section">
              <div className="voting-grid">
                {votablePlayers.map((player, i) => (
                  <div
                    key={i}
                    className={`vote-box ${selectedPlayer === player.username ? "selected" : ""} ${player.mayorRevealed ? "mayor-revealed" : ""}`}
                    onClick={() => handleVote(player.username)}
                  >
                    {player.username}
                    {player.mayorRevealed && <span className="mayor-badge">🏛️ MAYOR</span>}
                  </div>
                ))}
                <div
                  className={`vote-box ${selectedPlayer === 'abstain' ? "selected" : ""}`}
                  onClick={() => handleVote('abstain')}
                >
                  Abstain
                </div>
              </div>
              
              {selectedPlayer && !hasVoted && (
                <div className="vote-submit-section">
                  <p className="selected-vote">
                    Selected: <strong>{selectedPlayer === 'abstain' ? 'Abstain' : selectedPlayer}</strong>
                    {tripleVoteMode && <span className="triple-vote-indicator"> (Triple Vote - 3x)</span>}
                  </p>
                  
                  {canUseTripleVote && (
                    <div className="triple-vote-section">
                      <label className="triple-vote-checkbox">
                        <input 
                          type="checkbox" 
                          checked={tripleVoteMode}
                          onChange={toggleTripleVote}
                        />
                        Use Triple Vote (One time only - reveals you as Mayor)
                      </label>
                    </div>
                  )}
                  
                  <button 
                    className={`submit-vote-button ${tripleVoteMode ? 'triple-vote-active' : ''}`}
                    onClick={handleSubmitVote}
                  >
                    {tripleVoteMode ? 'Submit Triple Vote' : 'Submit Vote'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="voting-spectator">
              {!isAlive 
                ? "You are dead and cannot vote." 
                : isSacrificeSpectator 
                  ? "You are spectating and cannot vote." 
                  : "You cannot vote this round."
              }
            </div>
          )}

          {hasVoted && (
            <div className="voting-result">
              <p>✅ Vote submitted: <strong>{selectedPlayer === 'abstain' ? 'Abstain' : selectedPlayer}</strong></p>
              <p className="waiting-message">Waiting for other players...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (currentPhase === 'results') {
    return (
      <div className="voting-wrapper">
        <div className="voting-container">
          <h1 className="voting-title">📊 Vote Results</h1>
          {voteResult && (
            <div className="vote-results">
              {voteResult.tie ? (
                <div className="result-message">
                  <h2>🤝 It's a tie! No one is eliminated.</h2>
                </div>
              ) : voteResult.eliminatedPlayer ? (
                <div className="result-message">
                  <h2>⚰️ {voteResult.eliminatedPlayer} has been eliminated!</h2>
                </div>
              ) : (
                <div className="result-message">
                  <h2>🤷‍♀️ No majority reached. No elimination.</h2>
                </div>
              )}
              
              <div className="vote-breakdown">
                <h3>Vote Breakdown:</h3>
                {Object.entries(voteResult.voteCounts).map(([player, count]) => (
                  <div key={player} className="vote-count">
                    {player}: {count} vote{count !== 1 ? 's' : ''}
                  </div>
                ))}
                <div className="vote-total">
                  Total votes cast: {voteResult.totalVotes}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (currentPhase === 'testament') {
    return (
      <div className="voting-wrapper">
        <div className="voting-container testament-container">
          <h1 className="voting-title">🪦 Final Words</h1>
          <div className="testament-timer">Time left: {testamentTimeLeft}s</div>
          
          {isEliminated ? (
            <div className="testament-section">
              <p className="testament-instruction">Write your final message to the town:</p>
              <textarea
                className="testament-input"
                placeholder="Your last words..."
                value={testamentMessage}
                onChange={(e) => setTestamentMessage(e.target.value)}
                disabled={testamentWritten}
                maxLength={200}
                rows={3}
              />
              <div className="testament-actions">
                <button 
                  className="testament-submit"
                  onClick={handleTestamentSubmit}
                  disabled={testamentWritten || !testamentMessage.trim()}
                >
                  {testamentWritten ? "Testament Sent" : "Send Testament"}
                </button>
                <div className="character-count">
                  {testamentMessage.length}/200
                </div>
              </div>
            </div>
          ) : (
            <div className="testament-waiting">
              <p>{eliminatedPlayer} is writing their final words...</p>
              <div className="waiting-indicator">⏳</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (currentPhase === 'testament-display') {
    return (
      <div className="voting-wrapper">
        <div className="voting-container">
          <h1 className="voting-title">📜 Final Testament</h1>
          <div className="testament-display">
            <p className="testament-author">{eliminatedPlayer}'s last words:</p>
            <div className="testament-message">
              {testamentMessage || "No final words..."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (currentPhase === 'game-over') {
    return (
      <div className="voting-wrapper">
        <div className="voting-container game-over">
          <h1 className="voting-title">🎮 Game Over!</h1>
          {gameResult && (
            <div className="game-result">
              <div className={`winner-announcement ${gameResult.winner}`}>
                <h2>{gameResult.message}</h2>
              </div>
              
              <div className="survivors">
                <h3>Survivors:</h3>
                {gameResult.alivePlayers.map(player => (
                  <div key={player.id} className="survivor">
                    {player.username} ({player.role})
                  </div>
                ))}
              </div>
              
              <button 
                className="new-game-button"
                onClick={() => navigate("/")}
              >
                Return to Main Menu
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (currentPhase === 'next-round') {
    return (
      <div className="voting-wrapper">
        <div className="voting-container">
          <h1 className="voting-title">🌙 Preparing Night Phase</h1>
          <p className="next-round-message">The game continues... Prepare for the night.</p>
          <div className="round-transition">Starting next round...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="voting-wrapper">
      <div className="voting-container">
        <h1 className="voting-title">🔄 Loading...</h1>
        <p>Synchronizing game state...</p>
      </div>
    </div>
  );
}