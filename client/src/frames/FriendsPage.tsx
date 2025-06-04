import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/FriendsPage.css";
import { socket } from "../socket";

interface Friend {
  id: string;
  username: string;
  isOnline?: boolean;
}

interface FriendData {
  id: string;
  username: string;
}

export default function FriendsPage() {
  const navigate = useNavigate();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [removingFriend, setRemovingFriend] = useState<string | null>(null);

  const playerId = sessionStorage.getItem("id");

  const handleRemoveFriend = async (friendId: string) => {
    try {
      setRemovingFriend(friendId);
      const response = await fetch('http://localhost:5001/api/friends/remove', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: playerId,
          friendId: friendId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to remove friend');
      }

      // Remove friend from local state
      setFriends(prevFriends => prevFriends.filter(friend => friend.id !== friendId));
    } catch (err) {
      console.error('Error removing friend:', err);
      setError('Failed to remove friend. Please try again.');
    } finally {
      setRemovingFriend(null);
    }
  };

  useEffect(() => {
    console.log("FriendsPage mounted, playerId:", playerId);

    if (!playerId) {
      console.error("No playerId found in sessionStorage");
      setError("User ID not found. Please log in again.");
      setLoading(false);
      return;
    }

    // Initialize socket connection
    if (!socket.connected) {
      console.log("Connecting socket...");
      socket.connect();
    }

    // Join user's personal room for real-time updates
    socket.emit('join-user-room', { userId: playerId });
    
    // Send initial online status
    socket.emit('user-status', { userId: playerId, status: 'online' });
    
    // Start heartbeat
    const heartbeat = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat', { userId: playerId });
      }
    }, 15000);

    const fetchFriends = async () => {
      try {
        console.log("Fetching friends for userId:", playerId);
        
        // Now fetch friends list
        const response = await fetch(`http://localhost:5001/api/friends?userId=${playerId}`);
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log("Friends API response:", data);
        
        if (data.error) {
          throw new Error(data.error);
        }
        
        if (data.friends && data.friends.length > 0) {
          try {
            // Get online status for all friends
            const statusResponse = await fetch(`http://localhost:5001/api/users/online-status?userIds=${data.friends.map((f: FriendData) => f.id).join(',')}`);
            const statusData = await statusResponse.json();
            console.log("Status data for friends:", statusData);
            
            // Combine friend data with online status
            const friendsWithStatus = data.friends.map((friend: FriendData) => ({
              ...friend,
              isOnline: statusData.statuses[friend.id] || false
            }));
            
            console.log("Setting friends with status:", friendsWithStatus);
            setFriends(friendsWithStatus);
          } catch (statusErr) {
            console.error("Failed to fetch online status:", statusErr);
            // If status fetch fails, still show friends but mark them as offline
            const friendsWithoutStatus = data.friends.map((friend: FriendData) => ({
              ...friend,
              isOnline: false
            }));
            setFriends(friendsWithoutStatus);
          }
        } else {
          console.log("No friends found in response");
          setFriends([]);
        }
      } catch (err) {
        console.error("Failed to fetch friends:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch friends");
      } finally {
        setLoading(false);
      }
    };

    // Set up socket listeners for status changes
    const handleStatusChange = ({ userId, status }: { userId: string, status: string }) => {
      console.log("Status changed for user:", userId, status);
      setFriends(prevFriends => {
        // Only update if the user is actually in our friends list
        const friendExists = prevFriends.some(friend => friend.id === userId);
        if (!friendExists) return prevFriends;

        return prevFriends.map(friend => 
          friend.id === userId 
            ? { ...friend, isOnline: status === 'online' || status === 'away' }
            : friend
        );
      });
    };

    // Listen for friend removal
    const handleFriendRemoved = ({ userId, friendId }: { userId: string, friendId: string }) => {
      if (userId === playerId || friendId === playerId) {
        setFriends(prevFriends => prevFriends.filter(friend => 
          friend.id !== (userId === playerId ? friendId : userId)
        ));
      }
    };

    // Listen for friendsUpdated event from Chat component
    const handleFriendsUpdated = (event: CustomEvent) => {
      console.log("Received friendsUpdated event:", event);
      fetchFriends();
    };

    socket.on('user-status-changed', handleStatusChange);
    socket.on('friend-removed', handleFriendRemoved);
    window.addEventListener('friendsUpdated', handleFriendsUpdated as EventListener);

    // Initial fetch
    fetchFriends();

    // Periodic refresh of online status - more frequent now
    const statusInterval = setInterval(async () => {
      if (friends.length > 0) {
        try {
          const statusResponse = await fetch(`http://localhost:5001/api/users/online-status?userIds=${friends.map(f => f.id).join(',')}`);
          const statusData = await statusResponse.json();
          
          setFriends(prevFriends => {
            const updatedFriends = prevFriends.map(friend => ({
              ...friend,
              isOnline: statusData.statuses[friend.id] || false
            }));
            
            // Only update state if there are actual changes
            const hasChanges = updatedFriends.some((friend, index) => 
              friend.isOnline !== prevFriends[index].isOnline
            );
            
            return hasChanges ? updatedFriends : prevFriends;
          });
        } catch (err) {
          console.error("Failed to refresh online status:", err);
        }
      }
    }, 10000); // Check every 10 seconds instead of 30

    // Handle window close/tab close
    const handleBeforeUnload = () => {
      socket.emit('user-status', { userId: playerId, status: 'offline' });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(statusInterval);
      socket.off('user-status-changed', handleStatusChange);
      socket.off('friend-removed', handleFriendRemoved);
      window.removeEventListener('friendsUpdated', handleFriendsUpdated as EventListener);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      socket.emit('leave-user-room', { userId: playerId });
      // Send offline status when component unmounts
      socket.emit('user-status', { userId: playerId, status: 'offline' });
      clearInterval(heartbeat);
    };
  }, [playerId]);

  const filteredFriends = friends.filter((friend) => {
    const matchesSearch = friend.username.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "online" && friend.isOnline) ||
      (statusFilter === "offline" && !friend.isOnline);
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="friends-wrapper">
      <div className="friends-header">
        <img src="/mafia-logo.png" alt="Mafia Logo" className="friends-mafia-logo" />
        <h1 className="friends-title">Friends</h1>
      </div>
      <img src="/Start.png" alt="Background" className="friends-background" />
      <div className="friends-panel">
        <div className="filters">
          <input
            type="text"
            placeholder="Search players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          <select
            className="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
        </div>

        {error ? (
          <div className="error-message">{error}</div>
        ) : loading ? (
          <div className="loading-message">Loading friends...</div>
        ) : friends.length === 0 ? (
          <div className="no-friends-message">No friends yet. Add some friends from the lobby!</div>
        ) : (
        <ul className="friends-list">
            {filteredFriends.map((friend) => (
              <li key={friend.id} className="friend-item">
                <div className="friend-info">
                  <span className={`status-indicator ${friend.isOnline ? 'online' : 'offline'}`} />
                  {friend.username}
                </div>
                <button
                  className={`remove-friend-button ${removingFriend === friend.id ? 'removing' : ''}`}
                  onClick={() => handleRemoveFriend(friend.id)}
                  disabled={removingFriend === friend.id}
                >
                  {removingFriend === friend.id ? '...' : '×'}
                </button>
            </li>
          ))}
        </ul>
        )}
      </div>
      <button className="friends-back-button" onClick={() => navigate("/menu")}>
          ⟵ Back
        </button>
    </div>
  );
}