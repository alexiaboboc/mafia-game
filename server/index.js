// ------------------ IMPORTURI ------------------
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import bcrypt from 'bcrypt'
import http from 'http'
import { Server } from 'socket.io'
import dotenv from 'dotenv'

import User from './models/User.js'
import Lobby from './models/Lobby.js'
import Game from './models/Game.js'
import authRoutes from './routes/auth.js'
import FriendRequest from './models/FriendRequest.js'

import { resolveNightActions } from './utils/gameLogic.js'

// Load environment variables
dotenv.config()

// ------------------ CONFIG ------------------
const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  allowUpgrades: true,
  path: '/socket.io/',
  serveClient: false
})
const PORT = process.env.PORT || 5001

// Keep track of connected clients and their online status
const connectedClients = new Map();
const onlineUsers = new Set();
const userHeartbeats = new Map(); // Track last heartbeat time for each user
const endingVotes = new Set(); // Track games currently ending voting to prevent race conditions

// Helper function to check if a user is truly online
const isUserOnline = (userId) => {
  if (!userHeartbeats.has(userId)) return false;
  const lastHeartbeat = userHeartbeats.get(userId);
  const now = Date.now();
  // Consider user offline if no heartbeat received in last 45 seconds
  return (now - lastHeartbeat) <= 45000;
};

// Cleanup function to remove stale users
const cleanupStaleUsers = () => {
  const now = Date.now();
  for (const [userId, lastHeartbeat] of userHeartbeats.entries()) {
    if (now - lastHeartbeat > 45000) {
      // User hasn't sent heartbeat in 45 seconds, consider them offline
      onlineUsers.delete(userId);
      userHeartbeats.delete(userId);
      io.emit('user-status-changed', { userId, status: 'offline' });
      console.log('User marked offline due to stale heartbeat:', userId);
    }
  }
};

// Run cleanup every 30 seconds
setInterval(cleanupStaleUsers, 30000);

// ------------------ MIDDLEWARE ------------------
app.use(cors({ origin: 'http://localhost:3000', credentials: true }))
app.use(express.json())

// ------------------ DB CONNECTION ------------------
mongoose.connect('mongodb://127.0.0.1:27017/mafia', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB error:', err))

// ------------------ UTILS ------------------
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

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// Helper function to get game state
async function getGameState(code) {
  try {
    const game = await Game.findOne({ code });
    if (!game) {
      console.error('Game not found for code:', code);
      return null;
    }
    return game;
  } catch (error) {
    console.error('Error getting game state:', error);
    return null;
  }
}

// Helper function to resolve night phase
async function resolveNightPhase(code) {
  try {
    const response = await fetch("http://localhost:5001/api/game/resolve-night", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    return await response.json();
  } catch (error) {
    console.error('Error resolving night phase:', error);
    throw error;
  }
}

// ------------------ ROUTES ------------------
app.use('/api', authRoutes)

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body
  try {
    const existingEmail = await User.findOne({ email })
    if (existingEmail) return res.status(400).json({ error: 'Email already exists' })
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })

    const hashedPassword = await bcrypt.hash(password, 10)
    const newUser = new User({ username: username.toLowerCase(), email, password: hashedPassword })
    await newUser.save()

    res.status(201).json({ message: 'User registered successfully' })
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' })
  }
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body
  try {
    const user = await User.findOne({ email })
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: 'Invalid credentials' })
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        username: user.username,
        email: user.email || "MISSING"
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' })
  }
})

app.post('/api/lobby/new', async (req, res) => {
  const { username, id } = req.body
  if (!username || !id) return res.status(400).json({ error: "Missing user data" })

  let code
  do {
    code = generateCode()
  } while (await Lobby.findOne({ code }))

  const lobby = new Lobby({ code, users: [{ id, username }] })
  await lobby.save()

  res.json({ message: "Lobby created", code })
})

app.post('/api/lobby/join', async (req, res) => {
  const { code, username, id } = req.body;

  try {
    const lobby = await Lobby.findOne({ code });
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });

    // Check if user is already in lobby
    const existingUserIndex = lobby.users.findIndex(u => u.id === id);
    if (existingUserIndex !== -1) {
      // User is already in lobby, just return success without adding again
      return res.status(200).json({ message: "Already in lobby" });
    }

    // Add new user to lobby while maintaining order
    lobby.users.push({ id, username, joinedAt: new Date() });
    await lobby.save();

    res.json({ message: "Joined lobby" });
  } catch (err) {
    console.error("Failed to join lobby:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get('/api/lobby/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const lobby = await Lobby.findOne({ code });
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

    // Ensure unique players sorted by join time
    const uniquePlayers = Array.from(
      new Map(lobby.users.map(u => [u.id, u])).values()
    ).sort((a, b) => {
      // Sort by joinedAt if available, otherwise maintain current order
      if (a.joinedAt && b.joinedAt) {
        return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
      }
      return 0;
    });

    const players = uniquePlayers.map(u => ({
      id: u.id,
      username: u.username
    }));

    res.json({ players });
  } catch (err) {
    console.error("Failed to get lobby:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/lobby/leave', async (req, res) => {
  const { code, id } = req.body;
  try {
    const lobby = await Lobby.findOne({ code });
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });

    // Remove user from lobby
    lobby.users = lobby.users.filter(user => user.id !== id);
    await lobby.save();

    res.json({ message: "Left lobby" });
  } catch (err) {
    console.error("Failed to leave lobby:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/game/start', async (req, res) => {
  const { code } = req.body;
  try {
    const lobby = await Lobby.findOne({ code });
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });

    const users = lobby.users;
    const count = users.length;

    const rolePresets = {
      5: ["queen", "doctor", "killer", "mutilator", "policeman"],
      6: ["queen", "doctor", "killer", "mutilator", "policeman", "citizen"],
      7: ["queen", "doctor", "killer", "mutilator", "policeman", "citizen", "sacrifice"],
      8: ["queen", "doctor", "killer", "mutilator", "policeman", "citizen", "sacrifice", "serial-killer"],
      9: ["queen", "doctor", "killer", "mutilator", "policeman", "citizen", "sacrifice", "serial-killer", "sheriff"],
      10: ["queen", "doctor", "killer", "mutilator", "policeman", "citizen", "sacrifice", "serial-killer", "sheriff", "mayor"],
      11: ["queen", "doctor", "killer", "mutilator", "policeman", "citizen", "sacrifice", "serial-killer", "sheriff", "mayor", "lookout"]
    };

    const roles = rolePresets[count];
    if (!roles || roles.length !== users.length) return res.status(400).json({ error: "Invalid number of players" });

    const shuffledRoles = [...roles].sort(() => Math.random() - 0.5);
    const players = users.map((u, i) => ({ ...u, role: shuffledRoles[i], alive: true }));

    // Initialize game with first round history
    const newGame = new Game({ 
      code, 
      players,
      round: 1,
      phase: 'night',
      history: [{
        round: 1,
        nightActions: [],
        resolvedDeaths: []
      }]
    });
    await newGame.save();

    // Update lobby state
    lobby.gameStarted = true;
    await lobby.save();

    // Get all roles in the game in order to start night flow
    const actualGameRoles = players.map(p => p.role);
    
    // Filter roleOrder to only include roles that are actually in this game
    const rolesInGame = roleOrder.filter(r => actualGameRoles.includes(r));
    
    console.log('Game started with', count, 'players');
    console.log('Roles assigned:', actualGameRoles);
    console.log('Night order will be:', rolesInGame);
    
    if (rolesInGame.length > 0) {
      // Start with the first role
      const firstRole = rolesInGame[0];
      console.log('Setting initial role for night phase:', firstRole);
      
      // Store the current role in the game state
      newGame.currentRole = firstRole;
      await newGame.save();

      // Emit game started event to all players
      io.in(code).emit('game-started', { code });
    }

    res.json({ message: "Game started", players });
  } catch (err) {
    console.error("❌ Failed to start game:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/game/action', async (req, res) => {
  const { code, actorId, targetUsername, action } = req.body;
  console.log('Received action request:', { code, actorId, targetUsername, action });
  
  try {
    const game = await Game.findOne({ code });
    if (!game) {
      console.log('Game not found for code:', code);
      return res.status(404).json({ error: "Game not found" });
    }

    const actor = game.players.find(p => p.id === actorId);
    const targetPlayer = game.players.find(p => p.username === targetUsername);
    
    if (!actor || !targetPlayer) {
      console.log('Player not found:', { actor: !!actor, target: !!targetPlayer });
      return res.status(404).json({ error: "Player not found" });
    }

    if (!actor.alive || !targetPlayer.alive) {
      console.log('Player is dead:', { actorAlive: actor.alive, targetAlive: targetPlayer.alive });
      return res.status(400).json({ error: "Cannot perform action on dead players" });
    }

    // Ensure history exists for current round
    let roundHistory = game.history.find(h => h.round === game.round);
    if (!roundHistory) {
      roundHistory = { round: game.round, nightActions: [], resolvedDeaths: [] };
      game.history.push(roundHistory);
    }

    // Check if player already performed an action this round
    const existingAction = roundHistory.nightActions.find(a => a.actorId === actorId);
    if (existingAction) {
      console.log('Player already performed action:', actorId);
      return res.status(400).json({ error: "Already performed an action this round" });
    }

    roundHistory.nightActions.push({
      actorId,
      targetId: targetPlayer.id,
      action,
      timestamp: new Date()
    });

    // Special handling for lookout - return who the target visited
    let lookoutResult = null;
    if (action === 'watch') {
      // Find actions where the target (the person being watched) acted on someone else
      const targetActions = roundHistory.nightActions.filter(a => 
        a.actorId === targetPlayer.id && a.actorId !== actorId
      );
      
      if (targetActions.length > 0) {
        // Get the names of who the target visited
        const visitedPlayers = targetActions.map(a => {
          const visitedPlayer = game.players.find(p => p.id === a.targetId);
          return visitedPlayer ? visitedPlayer.username : null;
        }).filter(Boolean);
        
        lookoutResult = {
          watchedPlayer: targetPlayer.username,
          visitedPlayers: visitedPlayers
        };
      } else {
        lookoutResult = {
          watchedPlayer: targetPlayer.username,
          visitedPlayers: []
        };
      }
    }

    await game.save();
    console.log('Action recorded successfully');
    
    if (lookoutResult) {
      res.json({ 
        message: "Action recorded", 
        lookoutResult 
      });
    } else {
      res.json({ message: "Action recorded" });
    }
  } catch (err) {
    console.error("Error processing action:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/game/resolve-night', async (req, res) => {
  const { code } = req.body;
  try {
    const result = await resolveNightActions(code);
    
    // Check if game is over and clean up
    const game = await Game.findOne({ code });
    if (game) {
      const alivePlayers = game.players.filter(p => p.alive);
      if (alivePlayers.length <= 1) {
        // Game is over, clean up
        await Game.deleteOne({ code });
        await Lobby.deleteOne({ code });
        console.log(`Cleaned up game and lobby data for code: ${code}`);
      }
    }
    
    res.json(result);
  } catch (err) {
    console.error("Resolve error:", err);
    res.status(500).json({ error: "Resolve failed" });
  }
});

// Add new endpoint to manually clean up old games and lobbies
app.post('/api/cleanup', async (req, res) => {
  try {
    const { includeUsers } = req.body;
    
    // Delete all games and lobbies
    await Game.deleteMany({});
    await Lobby.deleteMany({});
    console.log('Cleaned up all games and lobbies');
    
    // Optionally delete users
    if (includeUsers) {
      await User.deleteMany({});
      console.log('Cleaned up all users');
    }
    
    res.json({ 
      message: "Cleanup successful",
      cleaned: {
        games: true,
        lobbies: true,
        users: includeUsers || false
      }
    });
  } catch (err) {
    console.error("Cleanup error:", err);
    res.status(500).json({ error: "Cleanup failed" });
  }
});

app.get('/api/game/:code', async (req, res) => {
  const { code } = req.params;
  const game = await Game.findOne({ code });
  if (!game) return res.status(404).json({ error: "Game not found" });

  res.json({ 
    players: game.players,
    round: game.round,
    phase: game.phase
  });
});

app.get('/api/lobby/:code/status', async (req, res) => {
  const { code } = req.params;
  try {
    const lobby = await Lobby.findOne({ code });
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    
    res.json({ 
      gameStarted: lobby.gameStarted,
      players: lobby.users.map(u => u.username)
    });
  } catch (err) {
    console.error("Failed to get lobby status:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get chat state endpoint
app.get('/api/game/:code/chat-state', async (req, res) => {
  const { code } = req.params;
  try {
    const game = await Game.findOne({ code });
    if (!game) return res.status(404).json({ error: "Game not found" });
    
    // Calculate actual time left based on start time if chat is active
    let actualPhaseTimeLeft = game.phaseTimeLeft;
    let actualTotalTimeLeft = game.totalTimeLeft;
    let actualTestamentTimeLeft = game.testamentTimeLeft;
    
    if (game.chatStartTime && game.phase === 'day') {
      const elapsedTime = Math.floor((Date.now() - game.chatStartTime.getTime()) / 1000);
      actualPhaseTimeLeft = Math.max(0, game.phaseTimeLeft - elapsedTime);
      actualTotalTimeLeft = Math.max(0, game.totalTimeLeft - elapsedTime);
      
      if (game.chatPhase === 'testaments' && game.currentTestamentPlayer) {
        actualTestamentTimeLeft = Math.max(0, game.testamentTimeLeft - elapsedTime);
      }
    }
    
    res.json({
      phase: game.phase,
      chatPhase: game.chatPhase,
      currentTestamentPlayer: game.currentTestamentPlayer,
      testamentTimeLeft: actualTestamentTimeLeft,
      phaseTimeLeft: actualPhaseTimeLeft,
      totalTimeLeft: actualTotalTimeLeft,
      testamentsWritten: game.testamentsWritten,
      accusedPlayer: game.accusedPlayer,
      votesToProceed: game.votesToProceed || []
    });
  } catch (err) {
    console.error("Failed to get chat state:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Update chat state endpoint
app.post('/api/game/:code/chat-state', async (req, res) => {
  const { code } = req.params;
  const { 
    chatPhase, 
    currentTestamentPlayer, 
    testamentTimeLeft, 
    phaseTimeLeft, 
    totalTimeLeft,
    testamentsWritten,
    accusedPlayer 
  } = req.body;
  
  try {
    const game = await Game.findOne({ code });
    if (!game) return res.status(404).json({ error: "Game not found" });
    
    // Update chat state
    if (chatPhase !== undefined) game.chatPhase = chatPhase;
    if (currentTestamentPlayer !== undefined) game.currentTestamentPlayer = currentTestamentPlayer;
    if (testamentTimeLeft !== undefined) game.testamentTimeLeft = testamentTimeLeft;
    if (phaseTimeLeft !== undefined) game.phaseTimeLeft = phaseTimeLeft;
    if (totalTimeLeft !== undefined) game.totalTimeLeft = totalTimeLeft;
    if (testamentsWritten !== undefined) game.testamentsWritten = testamentsWritten;
    if (accusedPlayer !== undefined) game.accusedPlayer = accusedPlayer;
    
    // Update timestamp
    game.chatStartTime = new Date();
    
    await game.save();
    
    // Broadcast state update to all players
    io.in(code).emit('chat-state-updated', {
      chatPhase: game.chatPhase,
      currentTestamentPlayer: game.currentTestamentPlayer,
      testamentTimeLeft: game.testamentTimeLeft,
      phaseTimeLeft: game.phaseTimeLeft,
      totalTimeLeft: game.totalTimeLeft,
      testamentsWritten: game.testamentsWritten,
      accusedPlayer: game.accusedPlayer
    });
    
    res.json({ message: "Chat state updated" });
  } catch (err) {
    console.error("Failed to update chat state:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Friend request endpoints
app.post('/api/friends/request', async (req, res) => {
  const { fromId, fromUsername, toId, toUsername } = req.body;
  
  try {
    // Check if request already exists
    const existingRequest = await FriendRequest.findOne({
      from: { id: fromId },
      to: { id: toId },
      status: 'pending'
    });

    if (existingRequest) {
      return res.status(400).json({ error: "Friend request already sent" });
    }

    // Create new friend request
    const friendRequest = new FriendRequest({
      from: { id: fromId, username: fromUsername },
      to: { id: toId, username: toUsername }
    });

    const savedRequest = await friendRequest.save();

    // Emit socket event to notify recipient in their personal room
    // Include the full request object including the _id
    io.to(toId).emit('friend-request', {
      _id: savedRequest._id,
      from: { id: fromId, username: fromUsername },
      to: { id: toId, username: toUsername },
      status: 'pending'
    });

    console.log(`Emitting friend request to user ${toId} from ${fromUsername}`);

    res.json({ 
      message: "Friend request sent",
      request: savedRequest
    });
  } catch (err) {
    console.error("Failed to send friend request:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/api/friends/accept', async (req, res) => {
  const { requestId, fromId, toId } = req.body;
  console.log('Received accept request:', { requestId, fromId, toId });
  
  if (!requestId || !fromId || !toId) {
    console.log('Missing required fields:', { requestId, fromId, toId });
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  try {
    console.log('Looking for friend request with ID:', requestId);
    const request = await FriendRequest.findById(requestId);
    
    if (!request) {
      console.log('Friend request not found:', requestId);
      return res.status(404).json({ error: "Friend request not found" });
    }

    console.log('Found request:', {
      id: request._id,
      from: request.from,
      to: request.to,
      status: request.status
    });

    // Check if request is already accepted
    if (request.status === 'accepted') {
      console.log('Request already accepted');
      return res.status(400).json({ error: "Friend request already accepted" });
    }

    // Verify the request matches the provided IDs
    if (request.from.id !== fromId || request.to.id !== toId) {
      console.log('Request IDs do not match:', {
        requestFrom: request.from.id,
        requestTo: request.to.id,
        providedFrom: fromId,
        providedTo: toId
      });
      return res.status(400).json({ error: "Invalid request IDs" });
    }

    request.status = 'accepted';
    const savedRequest = await request.save();
    console.log('Saved accepted request:', {
      id: savedRequest._id,
      from: savedRequest.from,
      to: savedRequest.to,
      status: savedRequest.status
    });

    // Emit socket event to notify sender
    io.to(request.from.id).emit('friend-request-accepted', {
      by: { id: request.to.id, username: request.to.username }
    });

    res.json({ 
      message: "Friend request accepted",
      request: savedRequest
    });
  } catch (err) {
    console.error("Error accepting friend request:", err);
    res.status(500).json({ 
      error: "Failed to accept friend request",
      details: err.message 
    });
  }
});

app.post('/api/friends/reject', async (req, res) => {
  const { requestId } = req.body;
  
  try {
    const request = await FriendRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ error: "Friend request not found" });
    }

    request.status = 'rejected';
    await request.save();

    // Emit socket event to notify sender
    io.to(request.from.id).emit('friend-request-rejected', {
      by: { id: request.to.id, username: request.to.username }
    });

    res.json({ message: "Friend request rejected" });
  } catch (err) {
    console.error("Failed to reject friend request:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get('/api/friends/requests', async (req, res) => {
  const { userId } = req.query;
  
  try {
    const requests = await FriendRequest.find({
      'to.id': userId,
      status: 'pending'
    });

    res.json({ requests });
  } catch (err) {
    console.error("Failed to get friend requests:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Temporary debug endpoint
app.get('/api/debug/friend-requests', async (req, res) => {
  try {
    const allRequests = await FriendRequest.find({});
    console.log('All friend requests in database:', allRequests);
    res.json({ requests: allRequests });
  } catch (err) {
    console.error("Debug endpoint error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get user's friends - updated with more detailed error handling
app.get('/api/friends', async (req, res) => {
  const { userId } = req.query;
  console.log('Fetching friends for user:', userId);
  
  if (!userId) {
    console.log('No userId provided');
    return res.status(400).json({ error: "No userId provided" });
  }

  try {
    // Get accepted requests for this user
    const friendRequests = await FriendRequest.find({
      $or: [
        { 'from.id': userId, status: 'accepted' },
        { 'to.id': userId, status: 'accepted' }
      ]
    });

    console.log('Friend requests found for user:', {
      userId,
      requestsCount: friendRequests.length
    });

    // Use a Map to ensure unique friends by ID
    const uniqueFriendsMap = new Map();

    friendRequests.forEach(request => {
      const isSender = request.from.id === userId;
      const friendInfo = isSender ? request.to : request.from;
      
      // Only add if not already in the map
      if (!uniqueFriendsMap.has(friendInfo.id)) {
        uniqueFriendsMap.set(friendInfo.id, {
          id: friendInfo.id,
          username: friendInfo.username
        });
      }
    });

    // Convert Map to array
    const friends = Array.from(uniqueFriendsMap.values());

    console.log('Final friends list (unique):', friends);
    res.json({ friends });
  } catch (err) {
    console.error("Failed to fetch friends:", err);
    res.status(500).json({ error: "Failed to fetch friends: " + err.message });
  }
});

// Get online status for multiple users
app.get('/api/users/online-status', (req, res) => {
  const { userIds } = req.query;
  console.log('Checking online status for users:', userIds);

  if (!userIds) {
    return res.status(400).json({ error: "No user IDs provided" });
  }

  try {
    const userIdArray = userIds.split(',');
    const statuses = {};
    
    userIdArray.forEach(userId => {
      // Check if user is truly online based on heartbeat
      statuses[userId] = isUserOnline(userId);
    });

    console.log('Online statuses:', statuses);
    res.json({ statuses });
  } catch (err) {
    console.error("Failed to get online status:", err);
    res.status(500).json({ error: "Failed to get online status" });
  }
});

// Add endpoint for removing friends
app.delete('/api/friends/remove', async (req, res) => {
  try {
    const { userId, friendId } = req.body;
    console.log('Removing friendship between:', userId, 'and', friendId);
    
    if (!userId || !friendId) {
      return res.status(400).json({ error: 'Missing userId or friendId' });
    }

    // Find and update all friend requests between these users
    const requests = await FriendRequest.find({
      $or: [
        { 'from.id': userId, 'to.id': friendId },
        { 'from.id': friendId, 'to.id': userId }
      ],
      status: 'accepted'
    });

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    // Delete the friend requests
    await FriendRequest.deleteMany({
      $or: [
        { 'from.id': userId, 'to.id': friendId },
        { 'from.id': friendId, 'to.id': userId }
      ]
    });

    // Notify both users about the friendship removal
    io.to(userId).emit('friend-removed', { userId, friendId });
    io.to(friendId).emit('friend-removed', { userId, friendId });
    
    res.json({ message: 'Friend removed successfully' });
  } catch (error) {
    console.error('Error removing friend:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

// ------------------ SOCKET.IO ------------------
io.on('connection', socket => {
  const clientId = socket.id;
  
  // Check if this client is already connected
  if (connectedClients.has(clientId)) {
    console.log('Duplicate connection attempt from client:', clientId);
    socket.disconnect(true);
    return;
  }

  console.log('Client connected:', clientId);
  connectedClients.set(clientId, {
    connectedAt: Date.now(),
    rooms: new Set()
  });

  socket.on('user-connected', ({ userId }) => {
    console.log('User connected with ID:', userId);
    
    // Update client info with userId
    const client = connectedClients.get(clientId);
    if (client) {
      client.userId = userId;
      connectedClients.set(clientId, client);
    }

    // Add to online users set and update heartbeat
    onlineUsers.add(userId);
    userHeartbeats.set(userId, Date.now());
    
    // Broadcast to all clients that this user is now online
    io.emit('user-status-changed', { userId, status: 'online' });
    console.log('Broadcasted online status for user:', userId);
    console.log('Current online users:', Array.from(onlineUsers));
  });

  socket.on('heartbeat', ({ userId }) => {
    if (userId) {
      userHeartbeats.set(userId, Date.now());
      // If user was previously considered offline, mark them as online
      if (!onlineUsers.has(userId)) {
        onlineUsers.add(userId);
        io.emit('user-status-changed', { userId, status: 'online' });
      }
    }
  });

  socket.on('user-status', ({ userId, status }) => {
    if (userId) {
      if (status === 'online' || status === 'away') {
        onlineUsers.add(userId);
        userHeartbeats.set(userId, Date.now());
      } else {
        onlineUsers.delete(userId);
        userHeartbeats.delete(userId);
      }
      io.emit('user-status-changed', { userId, status });
    }
  });

  socket.on('user-disconnected', ({ userId }) => {
    console.log('User explicitly disconnected:', userId);
    if (userId) {
      onlineUsers.delete(userId);
      userHeartbeats.delete(userId);
      io.emit('user-status-changed', { userId, status: 'offline' });
      console.log('User marked as offline:', userId);
      console.log('Current online users:', Array.from(onlineUsers));
    }
  });

  socket.on('disconnect', async () => {
    console.log('Socket disconnected:', clientId);
    const client = connectedClients.get(clientId);
    if (client) {
      // Don't immediately remove from online users on socket disconnect
      // Wait for heartbeat timeout instead
      console.log('Socket disconnected but keeping user online until heartbeat timeout');

      // Clean up rooms and remove from lobbies
      for (const room of client.rooms) {
        try {
          const lobby = await Lobby.findOne({ code: room });
          if (lobby) {
            const user = lobby.users.find(u => u.id === client.userId);
            if (user) {
              lobby.users = lobby.users.filter(u => u.id !== client.userId);
              await lobby.save();
              io.in(room).emit('user-left', { username: user.username });
            }
          }
        } catch (err) {
          console.error("Failed to clean up lobby on disconnect:", err);
        }
      }
      connectedClients.delete(clientId);
    }
  });

  socket.on('join-lobby', ({ code, username, id }) => {
    // Check if user is already in this lobby
    const client = connectedClients.get(clientId);
    if (client && client.rooms.has(code)) {
      console.log(`User ${username} already in lobby ${code}`);
      return;
    }

    console.log(`User ${username} joined lobby ${code}`);
    socket.join(code);
    if (client) {
      client.rooms.add(code);
    }
    io.in(code).emit('user-joined', { username });
  });

  socket.on('leave-lobby', async ({ code, username, id }) => {
    console.log(`User ${username} left lobby ${code}`);
    
    try {
      // Remove user from lobby in database
      const lobby = await Lobby.findOne({ code });
      if (lobby) {
        lobby.users = lobby.users.filter(user => user.id !== id);
        await lobby.save();
      }
    } catch (err) {
      console.error("Failed to remove user from lobby:", err);
    }

    socket.leave(code);
    const client = connectedClients.get(clientId);
    if (client) {
      client.rooms.delete(code);
    }
    io.in(code).emit('user-left', { username });
  });

  socket.on('join-night-actions', async ({ code }) => {
    try {
      console.log('Player joining night actions:', { code });
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      // Get actual roles in the game
      const actualGameRoles = game.players.map(p => p.role);
      const rolesInGame = roleOrder.filter(r => actualGameRoles.includes(r));
      
      // Get current role
      const currentRole = game.currentRole;
      if (!currentRole) {
        // Start with first role
        game.currentRole = rolesInGame[0];
        await game.save();
      }
      
      // Get the current role player
      const currentRolePlayer = game.players.find(p => p.role === game.currentRole);
      
      // Check if it's Sacrifice's revenge turn
      const isSacrificeRevenge = currentRolePlayer?.role === 'sacrifice' && 
                                currentRolePlayer.canRevenge && 
                                !currentRolePlayer.hasUsedRevenge;
      
      // Check if killer is dead and current role is mutilator
      const isKillerDead = !game.players.find(p => p.role === "killer" && p.alive);
      const isMutilatorWithDeadKiller = game.currentRole === "mutilator" && isKillerDead;
      
      // Save promotion info before making the change
      let promotionHappened = false;
      
      // If mutilator when killer is dead, promote mutilator to killer first
      if (isMutilatorWithDeadKiller) {
        const mutilatorPlayer = game.players.find(p => p.role === "mutilator" && p.alive);
        if (mutilatorPlayer) {
          console.log('Promoting mutilator to killer:', mutilatorPlayer.username);
          mutilatorPlayer.role = "killer";
          promotionHappened = true;
          await game.save();
        }
      }
      
      const isNoActionRole = ["mayor", "citizen"].includes(game.currentRole) || 
                            (game.currentRole === "sacrifice" && !isSacrificeRevenge) ||
                            isMutilatorWithDeadKiller; // Treat mutilator as no-action when killer is dead
      
      // Emit current role to all clients
      io.in(code).emit('night-action-started', { 
        role: game.currentRole,
        isDead: !currentRolePlayer?.alive && !isSacrificeRevenge,
        isNoActionRole: isNoActionRole,
        isSacrificeRevenge: isSacrificeRevenge
      });
      
      console.log('Night action started event emitted for role:', {
        role: game.currentRole,
        isSacrificeRevenge,
        isNoActionRole,
        isMutilatorWithDeadKiller,
        promotionHappened
      });

      // If it's a no-action role (including mutilator with dead killer), automatically complete it after 5 seconds
      if (isNoActionRole) {
        console.log('🕒 No-action role turn, will auto-complete in 5 seconds:', game.currentRole, 'promotionHappened:', promotionHappened);
        setTimeout(async () => {
          console.log('⏰⏰⏰ TIMEOUT EXECUTED FOR ROLE:', game.currentRole, '⏰⏰⏰');
          console.log('⏰ Timeout triggered for role:', game.currentRole);
          
          // Get fresh game state
          const updatedGame = await Game.findOne({ code });
          if (!updatedGame) {
            console.log('❌ Game not found in timeout for code:', code);
            return;
          }
          
          console.log('🔍 Checking current role in timeout:', {
            timeoutRole: game.currentRole,
            dbCurrentRole: updatedGame.currentRole,
            match: updatedGame.currentRole === game.currentRole
          });
          
          if (updatedGame && updatedGame.currentRole === game.currentRole) {
            // Use the saved promotion info instead of recalculating
            const target = promotionHappened ? "mutilator-promotion" : "no-action";
            
            console.log('✅ Auto-completing role:', game.currentRole, 'with target:', target);
            console.log('🚀 About to call handleNightActionCompleted...');
            
            // Call the night-action-completed logic directly
            await handleNightActionCompleted(code, game.currentRole, target, io);
            
            console.log('✅ handleNightActionCompleted call completed');
          } else {
            console.log('⚠️ Role has changed, skipping timeout completion');
          }
        }, 5000);
      } else {
        console.log('👤 Role requires player action, no timeout set');
      }
    } catch (error) {
      console.error('Error joining night actions:', error);
    }
  });

  socket.on('night-action-completed', async ({ code, role, target }) => {
    await handleNightActionCompleted(code, role, target, io);
  });

  // Chat message handling
  socket.on('chat-message', ({ code, message }) => {
    console.log('Chat message received:', { code, message });
    // Add user ID to the message
    const messageWithId = {
      ...message,
      userId: socket.id
    };
    // Broadcast the message to all players in the room
    socket.to(code).emit('chat-message', { message: messageWithId });
  });

  // Join chat synchronization
  socket.on('join-chat', async ({ code }) => {
    try {
      console.log('Client joining chat for code:', code);
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      // Calculate actual time left based on start time
      let actualPhaseTimeLeft = game.phaseTimeLeft;
      let actualTotalTimeLeft = game.totalTimeLeft;
      let actualTestamentTimeLeft = game.testamentTimeLeft;
      
      if (game.chatStartTime && game.phase === 'day') {
        const elapsedTime = Math.floor((Date.now() - game.chatStartTime.getTime()) / 1000);
        actualPhaseTimeLeft = Math.max(0, game.phaseTimeLeft - elapsedTime);
        actualTotalTimeLeft = Math.max(0, game.totalTimeLeft - elapsedTime);
        
        if (game.chatPhase === 'testaments' && game.currentTestamentPlayer) {
          actualTestamentTimeLeft = Math.max(0, game.testamentTimeLeft - elapsedTime);
        }
      }

      // Send current chat state to the joining client
      socket.emit('chat-state-sync', {
        chatPhase: game.chatPhase,
        currentTestamentPlayer: game.currentTestamentPlayer,
        testamentTimeLeft: actualTestamentTimeLeft,
        phaseTimeLeft: actualPhaseTimeLeft,
        totalTimeLeft: actualTotalTimeLeft,
        testamentsWritten: game.testamentsWritten,
        accusedPlayer: game.accusedPlayer,
        votesToProceed: game.votesToProceed || []
      });
      
      console.log('Chat state synced for joining client');
    } catch (error) {
      console.error('Error joining chat:', error);
    }
  });

  // Chat state update from client
  socket.on('update-chat-state', async ({ code, state }) => {
    try {
      console.log('Chat state update received:', { code, state });
      
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      // Update the game state
      if (state.chatPhase !== undefined) game.chatPhase = state.chatPhase;
      if (state.currentTestamentPlayer !== undefined) game.currentTestamentPlayer = state.currentTestamentPlayer;
      if (state.testamentTimeLeft !== undefined) game.testamentTimeLeft = state.testamentTimeLeft;
      if (state.phaseTimeLeft !== undefined) game.phaseTimeLeft = state.phaseTimeLeft;
      if (state.totalTimeLeft !== undefined) game.totalTimeLeft = state.totalTimeLeft;
      if (state.testamentsWritten !== undefined) game.testamentsWritten = state.testamentsWritten;
      if (state.accusedPlayer !== undefined) game.accusedPlayer = state.accusedPlayer;
      
      // Update timestamp
      game.chatStartTime = new Date();
      
      await game.save();

      // Broadcast state update to all other players
      socket.to(code).emit('chat-state-updated', {
        chatPhase: game.chatPhase,
        currentTestamentPlayer: game.currentTestamentPlayer,
        testamentTimeLeft: game.testamentTimeLeft,
        phaseTimeLeft: game.phaseTimeLeft,
        totalTimeLeft: game.totalTimeLeft,
        testamentsWritten: game.testamentsWritten,
        accusedPlayer: game.accusedPlayer
      });
      
      console.log('Chat state updated and broadcasted');
    } catch (error) {
      console.error('Error updating chat state:', error);
    }
  });

  // Voting system handlers
  socket.on('join-voting', async ({ code }) => {
    try {
      console.log('Client joining voting for code:', code);
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      const currentPhase = game.phase || 'voting';
      let timeLeft = 60; // Default time
      let stateData = {};

      if (currentPhase === 'voting') {
        // Initialize voting state if not exists
        if (!game.votingState) {
          const startTime = new Date();
          game.votingState = {
            votes: new Map(),
            timeLeft: 60,
            startTime: startTime
          };
          game.voteTimerStarted = false;
          await game.save();
          
          console.log('🆕 Initialized new voting state:', {
            startTime: startTime.toISOString(),
            timeLeft: 60,
            gameCode: code
          });
        }

        // Calculate actual time left only if startTime exists
        if (game.votingState.startTime) {
          const now = Date.now();
          const startTime = game.votingState.startTime.getTime();
          const elapsedTime = Math.floor((now - startTime) / 1000);
          const originalTimeLeft = game.votingState.timeLeft;
          timeLeft = Math.max(0, originalTimeLeft - elapsedTime);
          
          console.log('⏰ Voting timer calculation:', {
            now: new Date(now).toISOString(),
            startTime: new Date(startTime).toISOString(),
            elapsedTime,
            originalTimeLeft,
            calculatedTimeLeft: timeLeft,
            votingStateExists: !!game.votingState,
            timerStarted: game.voteTimerStarted
          });
        } else {
          console.log('⏰ No startTime found, using default timeLeft:', timeLeft);
        }

        // Convert Map to Object for transmission
        const votesObject = Object.fromEntries(game.votingState.votes);

        stateData = {
          phase: 'voting',
          timeLeft,
          votes: votesObject
        };

        // Send current voting state
        socket.emit('vote-update', {
          votes: votesObject,
          timeLeft
        });

        // Start vote timer if not already started and time remaining
        if (!game.voteTimerStarted && timeLeft > 0) {
          console.log(`⏰ Starting vote timer for ${timeLeft} seconds for game ${code}`);
          
          // Set timer flag first to prevent race conditions
          game.voteTimerStarted = true;
          await game.save();
          
          // Use a global timer to prevent multiple timers
          setTimeout(async () => {
            try {
              const currentGame = await Game.findOne({ code });
              if (currentGame && currentGame.phase === 'voting' && currentGame.voteTimerStarted) {
                console.log(`⏰ Vote timer expired for game ${code}, ending voting`);
                await endVotingPhase(code);
              } else {
                console.log(`⏰ Vote timer expired but voting already ended for game ${code}`);
              }
            } catch (error) {
              console.error('❌ Error in vote timer expiration:', error);
            }
          }, timeLeft * 1000);
        } else if (timeLeft <= 0) {
          // Time already expired, end voting immediately
          console.log('⏰ Vote time already expired, ending voting immediately');
          await endVotingPhase(code);
          return;
        }
      } else if (currentPhase === 'results') {
        stateData = {
          phase: 'results',
          voteResult: {
            eliminatedPlayer: game.lastVoteResult?.eliminatedPlayer,
            voteCounts: Object.fromEntries(game.lastVoteResult?.voteCounts || new Map()),
            totalVotes: game.lastVoteResult?.totalVotes || 0,
            tie: game.lastVoteResult?.tie || false
          }
        };
      } else if (currentPhase === 'testament') {
        // Calculate testament time left
        if (game.testamentStartTime) {
          const elapsedTime = Math.floor((Date.now() - game.testamentStartTime.getTime()) / 1000);
          timeLeft = Math.max(0, 30 - elapsedTime);
        } else {
          timeLeft = 30;
        }

        stateData = {
          phase: 'testament',
          timeLeft,
          eliminatedPlayer: game.eliminatedPlayer
        };
      } else if (currentPhase === 'game-over') {
        // Game is over, should redirect to results
        stateData = {
          phase: 'game-over'
        };
      }

      // Send complete state sync
      socket.emit('voting-state-sync', stateData);
      
      console.log('Voting state synced for joining client:', stateData);
    } catch (error) {
      console.error('Error joining voting:', error);
    }
  });

  socket.on('cast-triple-vote', async ({ code, vote, username }) => {
    try {
      console.log('Triple vote cast by mayor:', { code, vote, username });
      
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      const voter = game.players.find(p => p.username === username);
      if (!voter || !voter.alive || voter.isSpectator) {
        console.log('Invalid voter, voter is dead, or is spectator');
        return;
      }

      // Check if voter is actually mayor
      if (voter.role !== 'mayor') {
        console.log('Non-mayor trying to cast triple vote');
        return;
      }

      // Check if mayor already used triple vote
      if (voter.hasUsedTripleVote) {
        console.log('Mayor already used triple vote');
        return;
      }

      // Check if voter is vote-muted
      if (voter.muted === 'vote') {
        console.log('Voter is vote-muted');
        return;
      }

      // Initialize voting state if not exists
      if (!game.votingState) {
        const startTime = new Date();
        game.votingState = {
          votes: new Map(),
          timeLeft: 60,
          startTime: startTime
        };
        game.voteTimerStarted = false;
        
        console.log('🆕 Initialized voting state in cast-triple-vote:', {
          startTime: startTime.toISOString(),
          timeLeft: 60,
          gameCode: code
        });
      }

      // Mark mayor as having used triple vote and revealed
      voter.hasUsedTripleVote = true;
      voter.mayorRevealed = true;

      // Record the triple vote (stored as special format to distinguish)
      game.votingState.votes.set(voter.username, `TRIPLE:${vote}`);
      await game.save();

      // Calculate actual time left only if startTime exists
      let actualTimeLeft = game.votingState.timeLeft;
      if (game.votingState.startTime) {
        const now = Date.now();
        const startTime = game.votingState.startTime.getTime();
        const elapsedTime = Math.floor((now - startTime) / 1000);
        actualTimeLeft = Math.max(0, game.votingState.timeLeft - elapsedTime);
      }

      // Convert Map to Object for transmission
      const votesObject = Object.fromEntries(game.votingState.votes);

      // Broadcast mayor reveal and vote update
      io.in(code).emit('mayor-revealed', {
        mayorUsername: username,
        vote: vote,
        isTripleVote: true
      });

      io.in(code).emit('vote-update', {
        votes: votesObject,
        timeLeft: actualTimeLeft
      });

      // Check if all alive, non-muted, non-spectator players have voted
      const eligibleVoters = game.players.filter(p => p.alive && p.muted !== 'vote' && !p.isSpectator);
      const votedPlayers = Array.from(game.votingState.votes.keys());
      
      console.log('🗳️ Triple vote check details:', {
        eligibleVoters: eligibleVoters.map(p => p.username),
        votedPlayers: votedPlayers,
        eligibleCount: eligibleVoters.length,
        votedCount: votedPlayers.length,
        shouldEndVoting: votedPlayers.length >= eligibleVoters.length
      });

      // If all eligible players have voted, end voting immediately
      if (votedPlayers.length >= eligibleVoters.length) {
        console.log('⚠️ All eligible players have voted (including triple vote), ending voting immediately');
        await endVotingPhase(code);
      }

      console.log('Triple vote recorded and broadcasted');
    } catch (error) {
      console.error('Error casting triple vote:', error);
    }
  });

  socket.on('cast-vote', async ({ code, vote, username }) => {
    try {
      console.log('Vote cast:', { code, vote, username });
      
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      const voter = game.players.find(p => p.username === username);
      if (!voter || !voter.alive || voter.isSpectator) {
        console.log('Invalid voter, voter is dead, or is spectator');
        return;
      }

      // Check if voter is vote-muted
      if (voter.muted === 'vote') {
        console.log('Voter is vote-muted');
        return;
      }

      // Initialize voting state if not exists
      if (!game.votingState) {
        const startTime = new Date();
        game.votingState = {
          votes: new Map(),
          timeLeft: 60,
          startTime: startTime
        };
        game.voteTimerStarted = false;
        
        console.log('🆕 Initialized voting state in cast-vote:', {
          startTime: startTime.toISOString(),
          timeLeft: 60,
          gameCode: code
        });
      }

      // Record the vote
      game.votingState.votes.set(voter.username, vote);
      await game.save();

      // Calculate actual time left only if startTime exists
      let actualTimeLeft = game.votingState.timeLeft;
      if (game.votingState.startTime) {
        const now = Date.now();
        const startTime = game.votingState.startTime.getTime();
        const elapsedTime = Math.floor((now - startTime) / 1000);
        actualTimeLeft = Math.max(0, game.votingState.timeLeft - elapsedTime);
        
        console.log('⏰ Timer calculation in cast-vote:', {
          now: new Date(now).toISOString(),
          startTime: new Date(startTime).toISOString(),
          elapsedTime,
          originalTimeLeft: game.votingState.timeLeft,
          calculatedTimeLeft: actualTimeLeft
        });
      }

      // Convert Map to Object for transmission
      const votesObject = Object.fromEntries(game.votingState.votes);

      // Broadcast vote update
      io.in(code).emit('vote-update', {
        votes: votesObject,
        timeLeft: actualTimeLeft
      });

      // Check if all alive, non-muted, non-spectator players have voted
      const eligibleVoters = game.players.filter(p => p.alive && p.muted !== 'vote' && !p.isSpectator);
      const votedPlayers = Array.from(game.votingState.votes.keys());
      
      console.log('🗳️ Vote check details:', {
        allPlayers: game.players.map(p => ({ username: p.username, alive: p.alive, muted: p.muted, isSpectator: p.isSpectator })),
        eligibleVoters: eligibleVoters.map(p => p.username),
        votedPlayers: votedPlayers,
        eligibleCount: eligibleVoters.length,
        votedCount: votedPlayers.length,
        allVotes: Object.fromEntries(game.votingState.votes),
        shouldEndVoting: votedPlayers.length >= eligibleVoters.length
      });

      // If all eligible players have voted, end voting immediately
      if (votedPlayers.length >= eligibleVoters.length) {
        console.log('⚠️ All eligible players have voted, ending voting immediately');
        await endVotingPhase(code);
      } else {
        console.log('✅ Not all players voted yet, continuing voting timer');
      }

      console.log('Vote recorded and broadcasted');
    } catch (error) {
      console.error('Error casting vote:', error);
    }
  });

  socket.on('check-game-state', async ({ code }) => {
    await checkGameStateAndProceed(code);
  });

  socket.on('testament-message', async ({ code, username, message }) => {
    try {
      console.log('📝 Received testament message:', { code, username, message });
      await handleTestamentComplete(code, username, message);
    } catch (error) {
      console.error('❌ Error processing testament message:', error);
    }
  });

  socket.on('vote-to-proceed', async ({ code, username }) => {
    try {
      console.log('Vote to proceed received:', { code, username });
      
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      // Initialize votes array if it doesn't exist
      if (!game.votesToProceed) {
        game.votesToProceed = [];
      }

      // Add vote if not already voted
      if (!game.votesToProceed.includes(username)) {
        game.votesToProceed.push(username);
        await game.save();
      }

      // Get count of alive players who can participate (exclude spectators)
      const alivePlayers = game.players.filter(p => p.alive && !p.isSpectator);
      const totalVotes = game.votesToProceed.length;
      const requiredVotes = alivePlayers.length;

      console.log('Vote count:', { totalVotes, requiredVotes });

      // Broadcast vote status to all players
      io.in(code).emit('vote-to-proceed', { 
        username, 
        total: totalVotes, 
        required: requiredVotes 
      });

      // If all alive players have voted, proceed to voting
      if (totalVotes >= requiredVotes) {
        console.log('All players voted to proceed');
        // Reset votes for next phase and start voting
        game.votesToProceed = [];
        game.phase = 'voting';
        
        // Initialize fresh voting state
        game.votingState = {
          votes: new Map(),
          timeLeft: 60,
          startTime: new Date()
        };
        game.voteTimerStarted = false;
        game.voteEnding = false;
        
        await game.save();
        
        console.log('🗳️ Voting phase started with fresh state');
        
        // Redirect all players to voting
        io.in(code).emit('proceed-to-voting');
      }
    } catch (error) {
      console.error('Error handling vote to proceed:', error);
    }
  });

  // Join user's personal room for friend requests
  socket.on('join-user-room', ({ userId }) => {
    socket.join(userId);
    console.log(`User ${userId} joined their personal room`);
  });

  // Leave user's personal room
  socket.on('leave-user-room', ({ userId }) => {
    socket.leave(userId);
    console.log(`User ${userId} left their personal room`);
  });
});

// Helper function to end voting phase
async function endVotingPhase(code) {
  try {
    console.log('🗳️ Starting endVotingPhase for code:', code);
    
    const game = await Game.findOne({ code });
    if (!game) {
      console.log('❌ Game not found for code:', code);
      return;
    }
    
    if (game.phase !== 'voting') {
      console.log(`⚠️ Game not in voting phase. Current phase: ${game.phase}`);
      return;
    }

    // Prevent multiple executions using both game state and global tracking
    if (game.voteEnding || endingVotes.has(code)) {
      console.log('⚠️ Voting is already ending, skipping duplicate call');
      return;
    }
    
    // Mark voting as ending both in game state and globally
    game.voteEnding = true;
    endingVotes.add(code);
    await game.save();

    const votesMap = game.votingState?.votes || new Map();
    const votes = Object.fromEntries(votesMap);
    const alivePlayers = game.players.filter(p => p.alive);
    
    console.log('📊 Ending voting phase with votes:', votes);
    console.log('👥 Alive players:', alivePlayers.map(p => p.username));
    
    // Count votes (including triple votes)
    const voteCounts = {};
    let totalVotes = 0;
    
    Object.entries(votes).forEach(([voter, vote]) => {
      if (vote && vote !== 'abstain') {
        // Check if this is a triple vote from mayor
        if (vote.startsWith('TRIPLE:')) {
          const actualVote = vote.replace('TRIPLE:', '');
          voteCounts[actualVote] = (voteCounts[actualVote] || 0) + 3; // Count as 3 votes
          totalVotes += 3;
          console.log(`🏛️ Triple vote from mayor ${voter}: ${actualVote} (counts as 3)`);
        } else {
          voteCounts[vote] = (voteCounts[vote] || 0) + 1;
          totalVotes++;
        }
      }
    });

    // Add abstain votes to counts
    const abstainCount = Object.values(votes).filter(vote => vote === 'abstain').length;
    if (abstainCount > 0) {
      voteCounts['abstain'] = abstainCount;
    }

    console.log('📈 Vote counts:', voteCounts, 'Total votes:', totalVotes);

    // Find player(s) with most votes
    const maxVotes = Math.max(...Object.values(voteCounts), 0);
    const playersWithMaxVotes = Object.keys(voteCounts).filter(
      player => voteCounts[player] === maxVotes && player !== 'abstain'
    );

    let eliminatedPlayer = null;
    let tie = false;

    // Determine elimination
    if (maxVotes > 0 && playersWithMaxVotes.length === 1) {
      eliminatedPlayer = playersWithMaxVotes[0];
      console.log(`💀 Player eliminated: ${eliminatedPlayer}`);
      
      // Mark player as dead
      const player = game.players.find(p => p.username === eliminatedPlayer);
      if (player) {
        // Check if sacrifice was voted out - special handling
        if (player.role === 'sacrifice') {
          console.log('⚰️ Sacrifice was voted out - marked for revenge, game continues');
          // Mark sacrifice for revenge but don't mark as dead yet
          player.canRevenge = true;
          player.hasWonByVoting = true; // Mark that they achieved their goal
          // Keep them alive for testament and ghost mode, but mark as spectator-to-be
          player.willBecomeSpectator = true; 
          console.log('🗡️ Sacrifice stays alive for testament, will become spectator after');
          
          // Broadcast updated game state so clients know sacrifice is no longer targetable
          await game.save();
          console.log('📡 Broadcasting sacrifice elimination status to clients');
          io.in(code).emit('player-status-updated', {
            playerId: player.id,
            username: player.username,
            willBecomeSpectator: true
          });
          
          // Don't set alive = false for sacrifice
        } else {
          // Normal elimination for other players
          player.alive = false;
        }
      }
    } else if (playersWithMaxVotes.length > 1 && maxVotes > 0) {
      tie = true;
      console.log('🤝 Vote resulted in a tie');
    } else {
      console.log('🤷‍♀️ No majority reached');
    }

    const voteResult = {
      eliminatedPlayer,
      voteCounts,
      totalVotes: Object.values(votes).length,
      tie
    };

    console.log('📋 Final vote result:', voteResult);

    // Store vote result and update game phase
    game.lastVoteResult = {
      eliminatedPlayer,
      voteCounts: new Map(Object.entries(voteCounts)),
      totalVotes: Object.values(votes).length,
      tie
    };
    game.eliminatedPlayer = eliminatedPlayer;
    game.phase = 'results';
    game.votingState = null;
    game.voteTimerStarted = false;
    game.voteEnding = false; // Reset the ending flag
    await game.save();
    
    // Remove from global tracking
    endingVotes.delete(code);

    console.log('💾 Game state updated, emitting vote-ended event');
    
    // Get all sockets in the room to verify broadcast
    const socketsInRoom = await io.in(code).fetchSockets();
    console.log(`📡 Broadcasting to ${socketsInRoom.length} sockets in room ${code}`);
    
    // Broadcast vote result
    io.in(code).emit('vote-ended', voteResult);
    console.log('📡 vote-ended event emitted to room:', code);
    
    // Also emit directly to ensure delivery
    socketsInRoom.forEach(socket => {
      console.log(`📤 Emitting vote-ended directly to socket ${socket.id}`);
      socket.emit('vote-ended', voteResult);
    });

    // If someone was eliminated, transition to testament phase after results
    if (eliminatedPlayer) {
      console.log(`📝 Will start testament phase for ${eliminatedPlayer} in 3 seconds`);
      setTimeout(async () => {
        const updatedGame = await Game.findOne({ code });
        if (updatedGame) {
          updatedGame.phase = 'testament';
          updatedGame.testamentStartTime = new Date();
          await updatedGame.save();
          
          console.log(`📝 Testament phase started for ${eliminatedPlayer}`);
          
          // Start testament timer
          setTimeout(async () => {
            // Auto-complete testament if no message sent
            const finalGame = await Game.findOne({ code });
            if (finalGame && finalGame.phase === 'testament') {
              console.log('⏰ Testament time expired, auto-completing');
              await handleTestamentComplete(code, eliminatedPlayer, null);
            }
          }, 30000);
        }
      }, 3000);
    } else {
      // No elimination, check game state after results display
      console.log('➡️ No elimination, will check game state in 3 seconds');
      setTimeout(async () => {
        await checkGameStateAndProceed(code);
      }, 3000);
    }
    
    console.log('✅ Voting phase ended successfully');
  } catch (error) {
    console.error('❌ Error ending voting phase:', error);
  }
}

// Helper function to handle testament completion
async function handleTestamentComplete(code, username, message) {
  try {
    console.log('📝 Testament completed:', { code, username, message });
    
    const game = await Game.findOne({ code });
    if (!game) {
      console.log('❌ Game not found for testament');
      return;
    }

    // Store testament in game history
    const currentRound = game.history[game.history.length - 1];
    if (currentRound) {
      if (!currentRound.testaments) {
        currentRound.testaments = [];
      }
      currentRound.testaments.push({
        username,
        message: message || 'No final words...',
        timestamp: new Date()
      });
    }
    
    // Check if this is sacrifice's testament - convert them to spectator after testament
    const sacrificePlayer = game.players.find(p => p.username === username && p.role === 'sacrifice');
    if (sacrificePlayer && sacrificePlayer.willBecomeSpectator) {
      console.log('👻 Converting sacrifice to spectator after testament');
      sacrificePlayer.isSpectator = true;
      sacrificePlayer.willBecomeSpectator = false;
      // Now mark as "dead" for game logic but keep as spectator for client
      sacrificePlayer.alive = false;
      console.log('💀 Sacrifice marked as dead but remains spectator');
    } else {
      // For non-sacrifice players, they were already marked dead during elimination
    }
    
    await game.save();
    
    // Broadcast testament to all players
    console.log('📡 Broadcasting testament to all players');
    io.in(code).emit('testament-received', {
      username,
      message: message || 'No final words...'
    });
    
    // Wait a moment to ensure testament is displayed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check game state after testament
    console.log('🔄 Checking game state after testament');
    await checkGameStateAndProceed(code);
    
  } catch (error) {
    console.error('❌ Error handling testament completion:', error);
  }
}

// Helper function to check game state and proceed
async function checkGameStateAndProceed(code) {
  try {
    console.log('🔄 Checking game state and proceeding...');
    const gameResult = await checkVictoryConditions(code);
    
    if (gameResult.gameOver) {
      console.log('🎮 Game is over, emitting game-over event');
      const game = await Game.findOne({ code });
      if (game) {
        game.phase = 'game-over';
        await game.save();
      }
      io.in(code).emit('game-over', gameResult);
    } else {
      // Start next round
      console.log('🌙 Starting next round...');
      const game = await Game.findOne({ code });
      if (game) {
        // Increment round number
        game.round += 1;
        
        // Reset all phase-related state
        game.phase = 'night';
        game.chatPhase = 'testaments';
        game.votingState = null; // Reset to null, will be initialized when voting starts
        game.voteTimerStarted = false;
        game.votesToProceed = [];
        game.lastVoteResult = null;
        game.eliminatedPlayer = null;
        game.testamentStartTime = null;
        game.currentRole = null; // Will be set when night phase starts
        
        // Add new round to history
        game.history.push({
          round: game.round,
          nightActions: [],
          resolvedDeaths: []
        });
        
        await game.save();
        console.log(`✅ Round ${game.round} initialized`);
      }
      
      // Emit next round event after a small delay
      setTimeout(() => {
        console.log('📡 Emitting next-round event');
        io.in(code).emit('next-round');
      }, 1000);
    }
  } catch (error) {
    console.error('❌ Error checking game state and proceeding:', error);
  }
}

// Helper function to check victory conditions
async function checkVictoryConditions(code) {
  try {
    const game = await Game.findOne({ code });
    if (!game) return { gameOver: false };

    const alivePlayers = game.players.filter(p => p.alive);
    
    // Count factions
    const mafia = alivePlayers.filter(p => ['killer', 'mutilator'].includes(p.role));
    const town = alivePlayers.filter(p => 
      ['queen', 'doctor', 'policeman', 'sheriff', 'lookout', 'mayor', 'citizen'].includes(p.role)
    );
    const serialKiller = alivePlayers.filter(p => p.role === 'serial-killer');
    const sacrifice = game.players.find(p => p.role === 'sacrifice' && (p.hasUsedRevenge || p.hasWonByVoting));

    console.log('Victory check:', {
      total: alivePlayers.length,
      alivePlayers: alivePlayers.map(p => ({ username: p.username, role: p.role })),
      mafia: mafia.length,
      town: town.length,
      serialKiller: serialKiller.length,
      sacrifice: sacrifice ? 'completed revenge' : 'not completed'
    });

    // Check edge case: only 1 or 2 players left
    if (alivePlayers.length <= 1) {
      let winners = [];
      let messages = [];

      if (serialKiller.length > 0) {
        winners.push('serial-killer');
        messages.push('🔪 The Serial Killer has eliminated everyone! Chaos reigns supreme!');
      } else if (mafia.length > 0) {
        winners.push('mafia');
        messages.push('🔴 The Mafia has taken control! Darkness triumphs!');
      } else if (town.length > 0) {
        winners.push('town');
        messages.push('🏛️ The Town survives! Justice triumphs!');
      }

      // Add Sacrifice to winners if they completed their revenge
      if (sacrifice) {
        winners.push('sacrifice');
        messages.push('💀 The Sacrifice has completed their revenge from beyond!');
      }

      if (winners.length > 0) {
        return {
          gameOver: true,
          winners,
          message: messages.join('\n'),
          alivePlayers
        };
      }
    }

    // Serial Killer wins if they're the last player or among the last 2 (with advantage)
    if (serialKiller.length > 0 && alivePlayers.length <= 2) {
      let winners = ['serial-killer'];
      let messages = ['🔪 The Serial Killer has eliminated everyone! Chaos reigns supreme!'];
      
      if (sacrifice) {
        winners.push('sacrifice');
        messages.push('💀 The Sacrifice has completed their revenge from beyond!');
      }

      return {
        gameOver: true,
        winners,
        message: messages.join('\n'),
        alivePlayers
      };
    }

    // Mafia wins if they equal or outnumber non-mafia players (excluding serial killer if present)
    const nonMafiaPlayers = town.length;
    if (mafia.length > 0 && mafia.length >= nonMafiaPlayers && serialKiller.length === 0) {
      let winners = ['mafia'];
      let messages = ['The Mafia has taken control of the town! Darkness prevails!'];
      
      if (sacrifice) {
        winners.push('sacrifice');
        messages.push('💀 The Sacrifice has completed their revenge from beyond!');
      }

      return {
        gameOver: true,
        winners,
        message: messages.join('\n'),
        alivePlayers
      };
    }

    // Town wins if all threats are eliminated (mafia + serial killer)
    if (mafia.length === 0 && serialKiller.length === 0) {
      let winners = ['town'];
      let messages = ['🏛️ The Town has restored peace! Justice prevails!'];
      
      if (sacrifice) {
        winners.push('sacrifice');
        messages.push('💀 The Sacrifice has completed their revenge from beyond!');
      }

      return {
        gameOver: true,
        winners,
        message: messages.join('\n'),
        alivePlayers
      };
    }

    // Game continues
    console.log('Game continues - no victory condition met');
    return { gameOver: false };
  } catch (error) {
    console.error('Error checking victory conditions:', error);
    return { gameOver: false };
  }
}

// Helper function to end night phase
async function endNightPhase(code) {
  try {
    console.log('Resolving night phase');
    const result = await resolveNightPhase(code);
    console.log('Night phase resolved, broadcasting end');
    
    // Initialize chat state when night ends
    const game = await Game.findOne({ code });
    if (game) {
      // Check victory conditions after night actions
      const gameResult = await checkVictoryConditions(code);
      
      if (gameResult.gameOver) {
        console.log('🎮 Game is over after night phase, emitting game-over event');
        game.phase = 'game-over';
        await game.save();
        io.in(code).emit('game-over', gameResult);
        return;
      }
      
      game.phase = 'day';
      game.chatStartTime = new Date();
      
      const deaths = result.deaths || [];
      if (deaths.length === 0) {
        // No deaths, skip testaments and go to discussions
        game.chatPhase = 'discussions';
        game.phaseTimeLeft = 300; // 5 minutes for discussions
        game.totalTimeLeft = 330; // 5:30 total (5m discussions + 30s accusations)
        game.currentTestamentPlayer = null;
        game.testamentTimeLeft = 0;
      } else {
        // Start with testaments - all dead players get 20 seconds together
        game.chatPhase = 'testaments';
        game.currentTestamentPlayer = null; // No specific player, all can write
        game.testamentTimeLeft = 20; // 20 seconds for all testaments
        game.phaseTimeLeft = 20; // Phase time = testament time
        game.totalTimeLeft = 20 + 300 + 30; // 20s testaments + 5m discussions + 30s accusations
      }
      
      game.testamentsWritten = [];
      game.accusedPlayer = null;
      game.votesToProceed = [];
      
      await game.save();
    }
    
    io.in(code).emit('night-ended', result);
    console.log('Night end broadcast complete');
  } catch (error) {
    console.error('Error resolving night phase:', error);
    io.in(code).emit('night-ended', { error: 'Failed to resolve night phase' });
  }
}

// Helper function to handle night action completion
async function handleNightActionCompleted(code, role, target, io) {
  try {
    console.log('🌙 Handling night action completed:', { code, role, target });
    const game = await Game.findOne({ code });
    if (!game) {
      console.log('❌ Game not found for code:', code);
      return;
    }

    // Get actual roles in the game - refresh this since roles might have changed
    const actualGameRoles = game.players.map(p => p.role);
    let rolesInGame = roleOrder.filter(r => actualGameRoles.includes(r));
    
    // Special case: force include sacrifice if they have revenge pending
    const sacrificeWithRevenge = game.players.find(p => p.role === 'sacrifice' && p.canRevenge && !p.hasUsedRevenge);
    if (sacrificeWithRevenge && !rolesInGame.includes('sacrifice')) {
      // Insert sacrifice in correct position
      const sacrificePosition = roleOrder.indexOf('sacrifice');
      const insertIndex = rolesInGame.findIndex(role => roleOrder.indexOf(role) > sacrificePosition);
      if (insertIndex === -1) {
        rolesInGame.push('sacrifice');
      } else {
        rolesInGame.splice(insertIndex, 0, 'sacrifice');
      }
      console.log('🗡️ Force-added sacrifice to rolesInGame for revenge:', rolesInGame);
    }
    
    // Special case for mutilator promotion: use the original role order
    let currentRoleIndex;
    let nextRole;
    
    if (role === "mutilator" && target === "mutilator-promotion") {
      // For mutilator promotion, the next role should be "killer" 
      // because the mutilator was just promoted to killer and needs to act
      console.log('🔄 Special case: mutilator promotion, next role should be killer');
      nextRole = "killer";
      console.log('🎯 Next role after mutilator promotion:', nextRole);
    } else {
      // Normal case: use current rolesInGame
      currentRoleIndex = rolesInGame.indexOf(role);
      if (currentRoleIndex < rolesInGame.length - 1) {
        nextRole = rolesInGame[currentRoleIndex + 1];
      }
    }

    console.log('📋 Current game state:', {
      currentRole: role,
      currentRoleIndex,
      rolesInGame,
      target,
      actualGameRoles,
      nextRole
    });

    // Broadcast completion
    io.in(code).emit('night-action-completed', { role, target });
    console.log('📡 Broadcasted night-action-completed:', { role, target });

    // Wait 3 seconds before proceeding to next role
    console.log('⏳ Waiting 3 seconds before next role...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (nextRole) {
      console.log('➡️ Moving to next role:', nextRole);
      
      game.currentRole = nextRole;
      await game.save();
      
      const nextRolePlayer = game.players.find(p => p.role === nextRole);
      
      // Check if sacrifice has revenge available
      const isSacrificeRevenge = nextRolePlayer?.role === 'sacrifice' && 
                                nextRolePlayer.canRevenge && 
                                !nextRolePlayer.hasUsedRevenge;
      
      // Debug logging for sacrifice
      if (nextRole === 'sacrifice') {
        console.log('🗡️ SACRIFICE DEBUG:', {
          playerFound: !!nextRolePlayer,
          username: nextRolePlayer?.username,
          role: nextRolePlayer?.role,
          canRevenge: nextRolePlayer?.canRevenge,
          hasUsedRevenge: nextRolePlayer?.hasUsedRevenge,
          isSpectator: nextRolePlayer?.isSpectator,
          alive: nextRolePlayer?.alive,
          calculatedIsSacrificeRevenge: isSacrificeRevenge
        });
      }
      
      // Check if next role is a no-action role or dead player
      let isNoActionRole = ["citizen", "mayor"].includes(nextRole);
      
      // Sacrifice is no-action role unless they have revenge
      if (nextRole === 'sacrifice' && !isSacrificeRevenge) {
        isNoActionRole = true; // Treat normal sacrifice as no-action
      }
      
      // Special check: if next role is mutilator and killer is dead, treat as no-action
      const isKillerDead = !game.players.find(p => p.role === "killer" && p.alive);
      const isMutilatorWithDeadKiller = nextRole === "mutilator" && isKillerDead;
      
      if (isMutilatorWithDeadKiller) {
        console.log('🔄 Next role is mutilator but killer is dead - promoting and treating as no-action');
        // Promote mutilator to killer
        const mutilatorPlayer = game.players.find(p => p.role === "mutilator" && p.alive);
        if (mutilatorPlayer) {
          console.log('🔄 Promoting mutilator to killer:', mutilatorPlayer.username);
          mutilatorPlayer.role = "killer";
          await game.save();
        }
        isNoActionRole = true;
      }
      
      // Check if next role player is marked to die next round (policeman with broken heart)
      const isPolicemanDying = nextRolePlayer?.role === "policeman" && nextRolePlayer.dieNextRound;
      
      console.log('🎭 Next role details:', {
        role: nextRole,
        player: nextRolePlayer?.username,
        isAlive: nextRolePlayer?.alive,
        isNoActionRole,
        isSacrificeRevenge,
        isMutilatorWithDeadKiller,
        isPolicemanDying,
        willAutoComplete: (isNoActionRole || isPolicemanDying || (nextRolePlayer && !nextRolePlayer.alive)) && !isSacrificeRevenge
      });
      
      // Always show role message for 5 seconds, regardless of player status
      io.in(code).emit('night-action-started', { 
        role: nextRole,
        isDead: !nextRolePlayer?.alive && !isSacrificeRevenge,
        isNoActionRole: isNoActionRole || isPolicemanDying, // Policeman dying acts like no-action role
        isSacrificeRevenge: isSacrificeRevenge,
        isPolicemanDying: isPolicemanDying,
        narration: nextRolePlayer?.alive ? undefined : `${nextRolePlayer?.username} (${nextRole}) is no longer with us...`
      });
      
      console.log('📡 Emitted night-action-started for:', nextRole);
      
      // If it's a no-action role, dead player, or policeman dying (but not sacrifice revenge), wait 5 seconds then auto-proceed
      if ((isNoActionRole || isPolicemanDying || (nextRolePlayer && !nextRolePlayer.alive)) && !isSacrificeRevenge) {
        console.log('🔄 Next role is no-action/dead/dying, will auto-complete in 5 seconds');
        setTimeout(async () => {
          const updatedGame = await Game.findOne({ code });
          if (updatedGame && updatedGame.currentRole === nextRole) {
            console.log('🔄 Auto-completing no-action role:', nextRole);
            const autoTarget = isMutilatorWithDeadKiller ? "mutilator-promotion" : "no-action";
            // Only auto-complete if the role hasn't changed
            await handleNightActionCompleted(code, nextRole, autoTarget, io);
          }
        }, 5000);
      } else {
        console.log('✋ Next role requires player action, waiting for input');
      }
    } else {
      console.log('🌅 All roles completed, ending night phase');
      await endNightPhase(code);
    }
  } catch (error) {
    console.error('❌ Error handling night action completion:', error);
  }
}

// ------------------ START SERVER ------------------
server.listen(PORT, () => {
  console.log(`Server with Socket.IO running on http://localhost:${PORT}`)
})