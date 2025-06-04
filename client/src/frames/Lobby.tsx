import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "../styles/Lobby.css";
import FriendRequestNotification from "../components/FriendRequestNotification";

const socket = io("http://localhost:5001", {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
  withCredentials: true
});

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

interface Player {
  id: string;
  username: string;
  friendRequestSent?: boolean;
  isFriend?: boolean;
}

export default function Lobby() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [showNotification, setShowNotification] = useState(false);
  const [currentRequest, setCurrentRequest] = useState<FriendRequest | null>(null);

  // User info
  const username = sessionStorage.getItem("username") || "";
  const playerId = sessionStorage.getItem("id") || "";

  const refreshLobby = async (lobbyCode: string) => {
    try {
      const response = await fetch(`http://localhost:5001/api/lobby/${lobbyCode}`);
      const data = await response.json();
      
      // Update players while maintaining sent friend request states
      setPlayers(prevPlayers => {
        const newPlayers = data.players.map((p: any) => ({
          ...p,
          // Preserve friendRequestSent state from previous players
          friendRequestSent: prevPlayers.find(prev => prev.id === p.id)?.friendRequestSent || false,
          // Preserve isFriend state from previous players
          isFriend: prevPlayers.find(prev => prev.id === p.id)?.isFriend || false
        }));
        return newPlayers;
      });
      
      setIsHost(data.players?.[0]?.username === sessionStorage.getItem("username"));
    } catch (err) {
      console.error("Failed to refresh lobby:", err);
    }
  };

  useEffect(() => {
    const codeFromStorage = sessionStorage.getItem("lobbyCode");
    const username = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    if (!codeFromStorage || !username || !id) return;

    setCode(codeFromStorage);

    // Initial lobby load and rejoin
    const initializeLobby = async () => {
      try {
        // First check if we're already in the lobby
        const lobbyResponse = await fetch(`http://localhost:5001/api/lobby/${codeFromStorage}`);
        const lobbyData = await lobbyResponse.json();
        const isInLobby = lobbyData.players.some((p: any) => p.id === id);

        // Fetch friends list
        const friendsResponse = await fetch(`http://localhost:5001/api/friends?userId=${id}`);
        const friendsData = await friendsResponse.json();
        const friendIds = friendsData.friends.map((f: any) => f.id);

        if (!isInLobby) {
          // Only try to join if we're not already in the lobby
          const joinResponse = await fetch("http://localhost:5001/api/lobby/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: codeFromStorage, username, id })
          });

          if (!joinResponse.ok) {
            console.error("Failed to join lobby");
            return;
          }
        }

        // Update players with friend status
        const updatedPlayers = lobbyData.players.map((p: any) => ({
          ...p,
          isFriend: friendIds.includes(p.id)
        }));
        setPlayers(updatedPlayers);
        
        // Join the socket rooms
        socket.emit("join-lobby", { code: codeFromStorage, username, id });
        socket.emit("join-user-room", { userId: id }); // Join user's personal room for friend requests
        console.log(`Joined lobby ${codeFromStorage} as ${username}`);
      } catch (err) {
        console.error("Failed to initialize lobby:", err);
      }
    };

    initializeLobby();

    // Set up periodic refresh with a longer interval
    const refreshInterval = setInterval(async () => {
      try {
        // Fetch lobby data
        const lobbyResponse = await fetch(`http://localhost:5001/api/lobby/${codeFromStorage}`);
        const lobbyData = await lobbyResponse.json();

        // Fetch friends list
        const friendsResponse = await fetch(`http://localhost:5001/api/friends?userId=${id}`);
        const friendsData = await friendsResponse.json();
        const friendIds = friendsData.friends.map((f: any) => f.id);

        // Update players while maintaining friend status and sent request states
        setPlayers(prevPlayers => {
          const newPlayers = lobbyData.players.map((p: any) => ({
            ...p,
            friendRequestSent: prevPlayers.find(prev => prev.id === p.id)?.friendRequestSent || false,
            isFriend: friendIds.includes(p.id)
          }));
          return newPlayers;
        });
        
        setIsHost(lobbyData.players?.[0]?.username === username);
      } catch (err) {
        console.error("Failed to refresh lobby:", err);
      }
    }, 5000);

    // Listen for new players
    socket.off("user-joined").on("user-joined", ({ username }) => {
      console.log(`New player joined: ${username}`);
      refreshLobby(codeFromStorage);
    });

    // Listen for players leaving
    socket.off("user-left").on("user-left", ({ username }) => {
      console.log(`Player left: ${username}`);
      refreshLobby(codeFromStorage);
    });

    // Listen for game start
    socket.off("game-started").on("game-started", () => {
      console.log("Game started event received, navigating to gamestart");
      navigate("/gamestart");
    });

    // Check game status periodically
    const statusInterval = setInterval(() => {
      fetch(`http://localhost:5001/api/lobby/${codeFromStorage}/status`)
        .then(res => res.json())
        .then(data => {
          if (data.gameStarted) {
            console.log("Game started detected via status check");
            clearInterval(statusInterval);
            navigate("/gamestart");
          }
        })
        .catch(err => console.error("Failed to check game status:", err));
    }, 1000);

    // Force disconnect (tab close)
    const handleUnload = () => {
      const username = sessionStorage.getItem("username");
      const id = sessionStorage.getItem("id");

      if (codeFromStorage && username && id) {
        // Use sendBeacon for more reliable cleanup when closing tab
        const data = new Blob([JSON.stringify({ code: codeFromStorage, id })], {
          type: 'application/json'
        });
        navigator.sendBeacon("http://localhost:5001/api/lobby/leave", data);
        
        // Also try to emit socket event
        socket.emit("leave-lobby", { code: codeFromStorage, username, id });
      }
    };

    window.addEventListener("beforeunload", handleUnload);

    // Cleanup on component unmount
    return () => {
      clearInterval(statusInterval);
      clearInterval(refreshInterval);
      socket.emit("leave-lobby", { code: codeFromStorage, username, id });
      socket.emit("leave-user-room", { userId: id }); // Leave user's personal room
      window.removeEventListener("beforeunload", handleUnload);
      socket.disconnect();
    };
  }, []);

  // Friend request handling
  useEffect(() => {
    if (!playerId) return;

    // Load persisted sent requests from localStorage
    const sentRequests = JSON.parse(localStorage.getItem('sentFriendRequests') || '[]');
    setPlayers(prev => prev.map(p => ({
      ...p,
      friendRequestSent: sentRequests.includes(p.id)
    })));

    const handleFriendRequest = (data: FriendRequest) => {
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

    // Set up socket listeners for friend requests
    socket.off('friend-request').on('friend-request', handleFriendRequest);
    socket.off('friend-request-accepted').on('friend-request-accepted', (data: { by: { id: string; username: string } }) => {
      console.log(`${data.by.username} accepted your friend request`);
      setPlayers(prev => prev.map(p => 
        p.id === data.by.id ? { ...p, friendRequestSent: true, isFriend: true } : p
      ));
    });
    socket.off('friend-request-rejected').on('friend-request-rejected', (data: { by: { id: string; username: string } }) => {
      console.log(`${data.by.username} rejected your friend request`);
    });

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
          
          setPlayers(prev => prev.map(p => ({
            ...p,
            friendRequestSent: newSentRequests.includes(p.id)
          })));
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
      socket.off('friend-request');
      socket.off('friend-request-accepted');
      socket.off('friend-request-rejected');
      socket.emit('leave-user-room', { userId: playerId });
      clearInterval(requestsRefreshInterval);
    };
  }, [playerId, username, showNotification]);

  const handleBack = async () => {
    const username = sessionStorage.getItem("username");
    const id = sessionStorage.getItem("id");

    if (code && username && id) {
      try {
        // Call the leave API endpoint
        await fetch("http://localhost:5001/api/lobby/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, id })
        });
        
        // Emit socket event
        socket.emit("leave-lobby", { code, username, id });
        
        // Clear lobby code from storage
        sessionStorage.removeItem("lobbyCode");
        
        // Navigate back
        navigate("/menu");
      } catch (err) {
        console.error("Failed to leave lobby:", err);
        navigate("/menu");
      }
    } else {
      navigate("/menu");
    }
  };

  const handleStartGame = async () => {
    if (players.length < 5) {
      setShowWarning(true);
      setTimeout(() => setShowWarning(false), 3000);
      return;
    }

    try {
      console.log("Attempting to start game...");
      const response = await fetch("http://localhost:5001/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });

      if (response.ok) {
        console.log("Game start request successful, emitting game-started event");
        socket.emit("game-started", { code });
        navigate("/gamestart");
      } else {
        const data = await response.json();
        alert(data.error || "Failed to start game");
      }
    } catch (err) {
      console.error("Failed to start game:", err);
      alert("Failed to start game");
    }
  };

  const handleSendFriendRequest = async (targetPlayer: Player) => {
    try {
      const response = await fetch('http://localhost:5001/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromId: playerId,
          fromUsername: username,
          toId: targetPlayer.id,
          toUsername: targetPlayer.username
        })
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Failed to send friend request");
      } else {
        // Update the player's state to show "Sent" and persist it
        setPlayers(prev => prev.map(p => 
          p.id === targetPlayer.id ? { ...p, friendRequestSent: true } : p
        ));

        // Store the sent state in localStorage to persist across refreshes
        const sentRequests = JSON.parse(localStorage.getItem('sentFriendRequests') || '[]');
        if (!sentRequests.includes(targetPlayer.id)) {
          sentRequests.push(targetPlayer.id);
          localStorage.setItem('sentFriendRequests', JSON.stringify(sentRequests));
        }
      }
    } catch (err) {
      console.error("Failed to send friend request:", err);
      alert("Failed to send friend request");
    }
  };

  const handleAcceptRequest = async () => {
    if (!currentRequest) return;

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
        // Update both players' states to show they are now friends
        setPlayers(prev => prev.map(p => 
          p.id === currentRequest?.from.id || p.id === currentRequest?.to.id 
            ? { ...p, isFriend: true, friendRequestSent: false } 
            : p
        ));
        
        // Remove the current request and show next one if available
        setFriendRequests(prev => {
          const updatedRequests = prev.filter(req => req._id !== currentRequest._id);
          if (updatedRequests.length > 0) {
            setCurrentRequest(updatedRequests[0]);
            setShowNotification(true);
          } else {
            setCurrentRequest(null);
            setShowNotification(false);
          }
          return updatedRequests;
        });

        // Update localStorage to reflect the new friendship
        const sentRequests = JSON.parse(localStorage.getItem('sentFriendRequests') || '[]');
        const updatedSentRequests = sentRequests.filter((id: string) => 
          id !== currentRequest.from.id && id !== currentRequest.to.id
        );
        localStorage.setItem('sentFriendRequests', JSON.stringify(updatedSentRequests));
      }
    } catch (err) {
      console.error("Failed to accept friend request:", err);
    }
  };

  const handleRejectRequest = async () => {
    if (!currentRequest) return;

    try {
      const response = await fetch('http://localhost:5001/api/friends/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: currentRequest._id })
      });

      if (response.ok) {
        // Remove the current request and show next one if available
        setFriendRequests(prev => {
          const updatedRequests = prev.filter(req => req._id !== currentRequest._id);
          if (updatedRequests.length > 0) {
            setCurrentRequest(updatedRequests[0]);
            setShowNotification(true);
          } else {
            setCurrentRequest(null);
            setShowNotification(false);
          }
          return updatedRequests;
        });
      }
    } catch (err) {
      console.error("Failed to reject friend request:", err);
    }
  };

  return (
    <div className="lobby-wrapper">
      <div className="lobby-container">
        <div className="lobby-header">
          <button className="lobby-back" onClick={handleBack}>⟵ Back</button>
          <div className="game-code">
            <span>Game code:</span>
            <div className="code-box">{code}</div>
          </div>
        </div>

        <div className="lobby-info">
          <div className="lobby-title">Lobby</div>
          <div className="player-count">{players.length}/11</div>
        </div>

        <div className="players-table">
          <div className="table-header">
            <div className="col-id">id.</div>
            <div className="col-name">username</div>
            <div className="col-actions">actions</div>
          </div>
          {Array.from({ length: Math.max(players.length, 5) }).map((_, i) => (
            <div className="table-row" key={i}>
              <div className="col-id">{i + 1}</div>
              <div className="col-name">{players[i]?.username || "-"}</div>
              <div className="col-actions">
                {players[i] && players[i].username !== username && (
                  <button
                    className={`friend-request-button ${
                      players[i].isFriend 
                        ? 'friends'
                        : players[i].friendRequestSent 
                          ? 'sent' 
                          : ''
                    }`}
                    onClick={() => !players[i].isFriend && handleSendFriendRequest(players[i])}
                    disabled={players[i].friendRequestSent || players[i].isFriend}
                  >
                    {players[i].isFriend 
                      ? "Friends" 
                      : players[i].friendRequestSent 
                        ? "Sent" 
                        : "Add Friend"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {showWarning && (
          <div className="lobby-warning">Need at least 5 players to start the game</div>
        )}

        {isHost && (
          <button className="start-button" onClick={handleStartGame}>
            Start Game
          </button>
        )}
      </div>

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