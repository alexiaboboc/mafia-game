import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { io } from "socket.io-client";
import "../styles/Chat.css";
import FriendRequestNotification from "../components/FriendRequestNotification";

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
  userId?: string;
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

interface FriendRequest {
  _id: string;
  from: {
    id: string;
    username: string;
  };
  to: {
    id: string;
    username: string;
  };
  status: 'pending' | 'accepted' | 'rejected';
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

  // Friend request state
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [showNotification, setShowNotification] = useState(false);
  const [currentRequest, setCurrentRequest] = useState<FriendRequest | null>(null);
  const [friendStatuses, setFriendStatuses] = useState<Record<string, { isFriend: boolean; requestSent: boolean }>>({});

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

  // Add friend status tracking
  useEffect(() => {
    if (!playerId) return;

    // Load persisted sent requests from localStorage
    const sentRequests = JSON.parse(localStorage.getItem('sentFriendRequests') || '[]');
    
    // Function to fetch and update friend statuses
    const fetchAndUpdateFriendStatuses = async () => {
      try {
        console.log('Fetching friends list for user:', playerId);
        const friendsResponse = await fetch(`http://localhost:5001/api/friends?userId=${playerId}`);
        const friendsData = await friendsResponse.json();
        console.log('Received friends data:', friendsData);

        // Create a Set of friend IDs for faster lookup
        const friendIds = new Set(friendsData.friends.map((f: any) => f.id));

        // Update friend statuses for all messages
        setFriendStatuses(prev => {
          const newStatuses = { ...prev };
          messages.forEach(msg => {
            if (msg.userId && msg.username !== username) {
              const isFriend = friendIds.has(msg.userId);
              newStatuses[msg.userId] = {
                isFriend: isFriend,
                requestSent: !isFriend && sentRequests.includes(msg.userId)
              };
            }
          });
          return newStatuses;
        });
      } catch (err) {
        console.error("Failed to fetch friend statuses:", err);
      }
    };

    // Initial fetch
    fetchAndUpdateFriendStatuses();

    // Set up periodic refresh
    const refreshInterval = setInterval(fetchAndUpdateFriendStatuses, 5000);

    return () => clearInterval(refreshInterval);
  }, [playerId, messages, username]);

  // Update messages when they come in to include userId
  useEffect(() => {
    socket.off('chat-message').on('chat-message', (data: { message: Message }) => {
      // Add userId to the message if it's not a system message
      if (data.message.type !== 'system') {
        const messageWithId = {
          ...data.message,
          userId: players.find(p => p.username === data.message.username)?.id
        };
        setMessages(prev => [...prev, messageWithId]);
      } else {
        setMessages(prev => [...prev, data.message]);
      }
    });

    return () => {
      socket.off('chat-message');
    };
  }, [players]);

  // Update existing messages with userIds when players list changes
  useEffect(() => {
    setMessages(prevMessages => 
      prevMessages.map(msg => {
        if (msg.type !== 'system' && !msg.userId) {
          const player = players.find(p => p.username === msg.username);
          return player ? { ...msg, userId: player.id } : msg;
        }
        return msg;
      })
    );
  }, [players]);

  // Socket event listener for friend requests
  useEffect(() => {
    if (!playerId) return;

    // Load persisted sent requests from localStorage
    const sentRequests = JSON.parse(localStorage.getItem('sentFriendRequests') || '[]');

    const handleFriendRequest = (data: { 
      _id: string;
      from: { id: string; username: string };
      to: { id: string; username: string };
      status: 'pending' | 'accepted' | 'rejected';
    }) => {
      console.log('Received friend request in real-time:', data);
      
      // Update friend requests list and show notification
      setFriendRequests(prev => {
        // Check if we already have this request
        if (!prev.some(req => req._id === data._id)) {
          const updatedRequests = [...prev, data];
          console.log('Updated friend requests:', updatedRequests);
          
          // If no notification is currently showing, show this one
          if (!showNotification) {
            setCurrentRequest(data);
            setShowNotification(true);
          }
          
          return updatedRequests;
        }
        return prev;
      });
    };

    const handleFriendRequestAccepted = (data: { by: { id: string; username: string } }) => {
      console.log(`${data.by.username} accepted your friend request`);
      
      // Update friend status in messages
      setFriendStatuses(prev => {
        const newStatuses = { ...prev };
        if (newStatuses[data.by.id]) {
          newStatuses[data.by.id] = { isFriend: true, requestSent: false };
        }
        return newStatuses;
      });

      // Add system message
      setMessages(prev => [...prev, {
        username: 'System',
        message: `${data.by.username} accepted your friend request!`,
        type: 'system',
        timestamp: new Date()
      }]);

      // Emit event to update FriendsPage
      const friendsUpdatedEvent = new CustomEvent('friendsUpdated');
      window.dispatchEvent(friendsUpdatedEvent);
    };

    const handleFriendRequestRejected = (data: { by: { id: string; username: string } }) => {
      console.log(`${data.by.username} rejected your friend request`);
      
      // Update friend status
      setFriendStatuses(prev => {
        const newStatuses = { ...prev };
        if (newStatuses[data.by.id]) {
          newStatuses[data.by.id] = { isFriend: false, requestSent: false };
        }
        return newStatuses;
      });

      // Add system message
      setMessages(prev => [...prev, {
        username: 'System',
        message: `${data.by.username} rejected your friend request.`,
        type: 'system',
        timestamp: new Date()
      }]);
    };

    // Set up socket listeners
    socket.on('friend-request', handleFriendRequest);
    socket.on('friend-request-accepted', handleFriendRequestAccepted);
    socket.on('friend-request-rejected', handleFriendRequestRejected);

    // Function to fetch and update friend requests
    const fetchAndUpdateRequests = async () => {
      try {
        const response = await fetch(`http://localhost:5001/api/friends/requests?userId=${playerId}`);
        const data = await response.json();
        
        if (data.requests) {
          setFriendRequests(data.requests);
          
          // Update current notification if needed
          if (!showNotification && data.requests.length > 0) {
            setCurrentRequest(data.requests[0]);
            setShowNotification(true);
          }
        }
      } catch (err) {
        console.error("Failed to fetch friend requests:", err);
      }
    };

    // Fetch initial friend requests and sent requests
    const fetchInitialData = async () => {
      try {
        // Fetch pending requests
        await fetchAndUpdateRequests();

        // Fetch sent requests to update button states
        const sentRequestsResponse = await fetch(`http://localhost:5001/api/friends/sent?userId=${playerId}`);
        const sentRequestsData = await sentRequestsResponse.json();
        
        if (sentRequestsData.requests) {
          const newSentRequests = sentRequestsData.requests.map((req: any) => req.to.id);
          localStorage.setItem('sentFriendRequests', JSON.stringify(newSentRequests));
          
          // Update friend statuses
          setFriendStatuses(prev => {
            const newStatuses = { ...prev };
            newSentRequests.forEach((id: string) => {
              if (newStatuses[id]) {
                newStatuses[id] = { ...newStatuses[id], requestSent: true };
              }
            });
            return newStatuses;
          });
        }
      } catch (err) {
        console.error("Failed to fetch initial friend data:", err);
      }
    };

    fetchInitialData();

    // Set up periodic refresh for friend requests
    const requestsRefreshInterval = setInterval(fetchAndUpdateRequests, 3000);

    // Make sure we're in the user's personal room for real-time notifications
    socket.emit('join-user-room', { userId: playerId });
    console.log('Joined personal notification room:', playerId);

    return () => {
      socket.off('friend-request', handleFriendRequest);
      socket.off('friend-request-accepted', handleFriendRequestAccepted);
      socket.off('friend-request-rejected', handleFriendRequestRejected);
      socket.emit('leave-user-room', { userId: playerId });
      clearInterval(requestsRefreshInterval);
    };
  }, [playerId, username, showNotification]);

  // Update handleAcceptRequest to properly refresh FriendsPage
  const handleAcceptRequest = async () => {
    if (!currentRequest) {
      console.log('No current request to accept');
      return;
    }

    try {
      const response = await fetch('http://localhost:5001/api/friends/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          requestId: currentRequest._id,
          fromId: currentRequest.from.id,
          toId: currentRequest.to.id
        })
      });

      if (response.ok) {
        console.log('Friend request accepted successfully');
        
        // Update friend statuses for all messages from this user
        setFriendStatuses(prev => {
          const newStatuses = { ...prev };
          if (currentRequest) {
            newStatuses[currentRequest.from.id] = { isFriend: true, requestSent: false };
          }
          return newStatuses;
        });

        // Update localStorage
        const sentRequests = JSON.parse(localStorage.getItem('sentFriendRequests') || '[]');
        const updatedSentRequests = sentRequests.filter((id: string) => 
          id !== currentRequest.from.id && id !== currentRequest.to.id
        );
        localStorage.setItem('sentFriendRequests', JSON.stringify(updatedSentRequests));

        // Remove the current request from the list
        setFriendRequests(prev => prev.filter(req => req._id !== currentRequest._id));
        
        // Hide notification and clear current request
        setShowNotification(false);
        setCurrentRequest(null);

        // Add success message to chat
        setMessages(prev => [...prev, {
          username: 'System',
          message: `You are now friends with ${currentRequest.from.username}!`,
          type: 'system',
          timestamp: new Date()
        }]);

        // Force refresh friends list to update FriendsPage
        try {
          const friendsResponse = await fetch(`http://localhost:5001/api/friends?userId=${playerId}`);
          const friendsData = await friendsResponse.json();
          console.log('Updated friends list:', friendsData);

          // Emit a custom event to notify FriendsPage
          const friendsUpdatedEvent = new CustomEvent('friendsUpdated', {
            detail: { friends: friendsData.friends }
          });
          window.dispatchEvent(friendsUpdatedEvent);
        } catch (err) {
          console.error("Failed to refresh friends list:", err);
        }
      }
    } catch (err: any) {
      console.error("Error accepting friend request:", err);
      setMessages(prev => [...prev, {
        username: 'System',
        message: `Failed to accept friend request from ${currentRequest.from.username}. Error: ${err.message}`,
        type: 'system',
        timestamp: new Date()
      }]);
    }
  };

  // Update handleSendFriendRequest to refresh friend statuses
  const handleSendFriendRequest = async (targetUsername: string, targetId: string) => {
    try {
      const response = await fetch('http://localhost:5001/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromId: playerId,
          fromUsername: username,
          toId: targetId,
          toUsername: targetUsername
        })
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Failed to send friend request");
      } else {
        // Update friend status to show "Sent"
        setFriendStatuses(prev => ({
          ...prev,
          [targetId]: { ...prev[targetId], requestSent: true }
        }));

        // Store in localStorage
        const sentRequests = JSON.parse(localStorage.getItem('sentFriendRequests') || '[]');
        if (!sentRequests.includes(targetId)) {
          sentRequests.push(targetId);
          localStorage.setItem('sentFriendRequests', JSON.stringify(sentRequests));
        }

        // Add system message
        setMessages(prev => [...prev, {
          username: 'System',
          message: `Friend request sent to ${targetUsername}!`,
          type: 'system',
          timestamp: new Date()
        }]);
      }
    } catch (err) {
      console.error("Failed to send friend request:", err);
      alert("Failed to send friend request");
    }
  };

  // Update handleRejectRequest to match the same pattern
  const handleRejectRequest = async () => {
    if (!currentRequest) return;

    try {
      const response = await fetch('http://localhost:5001/api/friends/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: currentRequest._id })
      });

      if (response.ok) {
        // Remove the current request from the list
        setFriendRequests(prev => prev.filter(req => req._id !== currentRequest._id));
        
        // Hide notification and clear current request
        setShowNotification(false);
        setCurrentRequest(null);
      }
    } catch (err) {
      console.error("Failed to reject friend request:", err);
    }
  };

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
              <div className="message-header">
                <span 
                  className="chat-user"
                  onClick={() => {
                    if (msg.username !== username && msg.userId) {
                      const status = friendStatuses[msg.userId];
                      if (!status?.isFriend && !status?.requestSent) {
                        handleSendFriendRequest(msg.username, msg.userId);
                      }
                    }
                  }}
                  style={{ 
                    cursor: msg.username !== username && msg.userId && !friendStatuses[msg.userId]?.isFriend ? 'pointer' : 'default',
                    position: 'relative'
                  }}
                >
                  {msg.username}
                  {msg.username !== username && msg.userId && (
                    <span 
                      className="friend-status"
                      data-status={
                        friendStatuses[msg.userId]?.isFriend 
                          ? 'friends' 
                          : friendStatuses[msg.userId]?.requestSent 
                            ? 'sent' 
                            : 'add'
                      }
                    >
                      {friendStatuses[msg.userId]?.isFriend 
                        ? "Friends" 
                        : friendStatuses[msg.userId]?.requestSent 
                          ? "Sent" 
                          : "Add Friend"}
                    </span>
                  )}
                </span>
              </div>
              <div className="message-content">{msg.message}</div>
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

      {showNotification && currentRequest && (
        <FriendRequestNotification
          from={currentRequest.from}
          onAccept={handleAcceptRequest}
          onReject={handleRejectRequest}
        />
      )}
        </div>
    );
}