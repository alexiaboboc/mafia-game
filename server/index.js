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

// Keep track of connected clients to prevent duplicates
const connectedClients = new Map();

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
  const { code, username, id } = req.body

  const lobby = await Lobby.findOne({ code })
  if (!lobby) return res.status(404).json({ error: "Lobby not found" })

  if (lobby.users.find(u => u.id === id)) {
    return res.status(200).json({ message: "Already in lobby" })
  }

  lobby.users.push({ id, username })
  await lobby.save()

  res.json({ message: "Joined lobby" })
})

app.get('/api/lobby/:code', async (req, res) => {
  const { code } = req.params;
  const lobby = await Lobby.findOne({ code });
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });

  const players = lobby.users.map(u => u.username);
  res.json({ players });
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

    await game.save();
    console.log('Action recorded successfully');
    res.json({ message: "Action recorded" });
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
      console.log('Client joining night actions for code:', code);
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      // Get actual roles in the game, not from roleOrder
      const actualGameRoles = game.players.map(p => p.role);
      
      // Filter roleOrder to only include roles that are actually in this game
      const rolesInGame = roleOrder.filter(r => actualGameRoles.includes(r));

      if (rolesInGame.length === 0) {
        console.log('No roles found in game');
        return;
      }

      console.log('Actual roles in game:', actualGameRoles);
      console.log('Ordered roles for night:', rolesInGame);

      // If we have a current role set, emit it. Otherwise start with the first role.
      let currentRole = game.currentRole;
      if (!currentRole || !actualGameRoles.includes(currentRole)) {
        currentRole = rolesInGame[0];
        game.currentRole = currentRole;
        await game.save();
        console.log('Starting night phase with first role:', currentRole);
      } else {
        console.log('Resuming night phase with current role:', currentRole);
      }

      // Emit the current role's turn to this specific client
      socket.emit('night-action-started', { role: currentRole });
      
      // Also emit to all clients in the room to sync everyone
      setTimeout(() => {
        io.in(code).emit('night-action-started', { role: currentRole });
        console.log('Night action started event emitted for role:', currentRole);
      }, 500);
    } catch (error) {
      console.error('Error joining night actions:', error);
    }
  });

  socket.on('night-action-completed', async ({ code, role, target }) => {
    try {
      console.log('Night action completed:', { code, role, target });
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      // Get actual roles in the game
      const actualGameRoles = game.players.map(p => p.role);
      const rolesInGame = roleOrder.filter(r => actualGameRoles.includes(r));
      const currentRoleIndex = rolesInGame.indexOf(role);

      // Broadcast completion
      io.in(code).emit('night-action-completed', { role, target });

      if (currentRoleIndex < rolesInGame.length - 1) {
        const nextRole = rolesInGame[currentRoleIndex + 1];
        game.currentRole = nextRole;
        await game.save();
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const nextRolePlayer = game.players.find(p => p.role === nextRole);
        
        // Check if next role's player is dead
        if (nextRolePlayer && !nextRolePlayer.alive) {
          // Show dead player's quote
          io.in(code).emit('night-action-started', { 
            role: nextRole,
            isDead: true,
            narration: `${nextRolePlayer.username} (${nextRole}) is no longer with us...`
          });
          
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Find next alive role
          const nextAliveRoleIndex = rolesInGame.findIndex((r, i) => 
            i > currentRoleIndex + 1 && game.players.find(p => p.role === r)?.alive
          );
          
          if (nextAliveRoleIndex !== -1) {
            const nextAliveRole = rolesInGame[nextAliveRoleIndex];
            game.currentRole = nextAliveRole;
            await game.save();
            
            // Handle mutilator promotion to killer
            if (nextAliveRole === 'mutilator') {
              const mutilator = game.players.find(p => p.role === 'mutilator');
              const killer = game.players.find(p => p.role === 'killer');
              
              if (mutilator && mutilator.alive && killer && !killer.alive) {
                // Promote mutilator to killer
                mutilator.role = 'killer';
                await game.save();
                
                // Show promotion message
                io.in(code).emit('night-action-started', { 
                  role: 'mutilator',
                  isPromoted: true,
                  narration: `${mutilator.username} has been promoted to Killer!`
                });
                
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Update game roles
                const updatedGame = await Game.findOne({ code });
                if (updatedGame) {
                  const updatedRoles = updatedGame.players.map(p => p.role);
                  const updatedRolesInGame = roleOrder.filter(r => updatedRoles.includes(r));
                  io.in(code).emit('roles-updated', { roles: updatedRolesInGame });
                }
              }
            }
            
            io.in(code).emit('night-action-started', { role: nextAliveRole });
          } else {
            await endNightPhase(code);
          }
        } else {
          io.in(code).emit('night-action-started', { role: nextRole });
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 3000));
        await endNightPhase(code);
      }
    } catch (error) {
      console.error('Error handling night action:', error);
    }
  });

  // Chat message handling
  socket.on('chat-message', ({ code, message }) => {
    console.log('Chat message received:', { code, message });
    // Broadcast the message to all players in the room
    socket.to(code).emit('chat-message', { message });
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
          game.votingState = {
            votes: new Map(),
            timeLeft: 60,
            startTime: new Date()
          };
          game.voteTimerStarted = false;
          await game.save();
        }

        // Calculate actual time left only if startTime exists
        if (game.votingState.startTime) {
          const elapsedTime = Math.floor((Date.now() - game.votingState.startTime.getTime()) / 1000);
          timeLeft = Math.max(0, game.votingState.timeLeft - elapsedTime);
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
          game.voteTimerStarted = true;
          await game.save();
          
          console.log(`Starting vote timer for ${timeLeft} seconds`);
          
          setTimeout(async () => {
            await endVotingPhase(code);
          }, timeLeft * 1000);
        } else if (timeLeft <= 0) {
          // Time already expired, end voting immediately
          console.log('Vote time expired, ending voting');
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

  socket.on('cast-vote', async ({ code, vote, username }) => {
    try {
      console.log('Vote cast:', { code, vote, username });
      
      const game = await Game.findOne({ code });
      if (!game) {
        console.log('Game not found for code:', code);
        return;
      }

      const voter = game.players.find(p => p.username === username);
      if (!voter || !voter.alive) {
        console.log('Invalid voter or voter is dead');
        return;
      }

      // Check if voter is vote-muted
      if (voter.muted === 'vote') {
        console.log('Voter is vote-muted');
        return;
      }

      // Initialize voting state if not exists
      if (!game.votingState) {
        game.votingState = {
          votes: new Map(),
          timeLeft: 60,
          startTime: new Date()
        };
        game.voteTimerStarted = false;
      }

      // Record the vote
      game.votingState.votes.set(voter.username, vote);
      await game.save();

      // Calculate actual time left only if startTime exists
      let actualTimeLeft = game.votingState.timeLeft;
      if (game.votingState.startTime) {
        const elapsedTime = Math.floor((Date.now() - game.votingState.startTime.getTime()) / 1000);
        actualTimeLeft = Math.max(0, game.votingState.timeLeft - elapsedTime);
      }

      // Convert Map to Object for transmission
      const votesObject = Object.fromEntries(game.votingState.votes);

      // Broadcast vote update
      io.in(code).emit('vote-update', {
        votes: votesObject,
        timeLeft: actualTimeLeft
      });

      // Check if all alive, non-muted players have voted
      const eligibleVoters = game.players.filter(p => p.alive && p.muted !== 'vote');
      const votedPlayers = Array.from(game.votingState.votes.keys());
      
      console.log('Vote check:', {
        eligibleVoters: eligibleVoters.map(p => p.username),
        votedPlayers: votedPlayers,
        eligibleCount: eligibleVoters.length,
        votedCount: votedPlayers.length
      });

      // If all eligible players have voted, end voting immediately
      if (votedPlayers.length >= eligibleVoters.length) {
        console.log('All eligible players have voted, ending voting immediately');
        await endVotingPhase(code);
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

      // Get count of alive players
      const alivePlayers = game.players.filter(p => p.alive);
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
        await game.save();
        
        // Redirect all players to voting
        io.in(code).emit('proceed-to-voting');
      }
    } catch (error) {
      console.error('Error handling vote to proceed:', error);
    }
  });

  socket.on('disconnect', async () => {
    console.log('Client disconnected:', clientId);
    const client = connectedClients.get(clientId);
    if (client) {
      // Clean up rooms and remove from lobbies
      for (const room of client.rooms) {
        try {
          const lobby = await Lobby.findOne({ code: room });
          if (lobby) {
            // Find the user's ID in this lobby
            const user = lobby.users.find(u => u.id === clientId);
            if (user) {
              lobby.users = lobby.users.filter(u => u.id !== clientId);
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

    const votesMap = game.votingState?.votes || new Map();
    const votes = Object.fromEntries(votesMap);
    const alivePlayers = game.players.filter(p => p.alive);
    
    console.log('📊 Ending voting phase with votes:', votes);
    console.log('👥 Alive players:', alivePlayers.map(p => p.username));
    
    // Count votes
    const voteCounts = {};
    let totalVotes = 0;
    
    Object.values(votes).forEach(vote => {
      if (vote && vote !== 'abstain') {
        voteCounts[vote] = (voteCounts[vote] || 0) + 1;
        totalVotes++;
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
        player.alive = false;
        
        // Check if sacrifice was voted out
        if (player.role === 'sacrifice') {
          console.log('⚰️ Sacrifice was voted out - they win!');
          // Sacrifice wins immediately
          const gameResult = {
            gameOver: true,
            winner: 'sacrifice',
            message: '⚰️ The Sacrifice has achieved their goal! They win by being voted out!',
            alivePlayers: alivePlayers.filter(p => p.alive)
          };
          
          game.phase = 'game-over';
          await game.save();
          console.log('🎮 Emitting game-over event');
          io.in(code).emit('game-over', gameResult);
          return;
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
    await game.save();

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
      await game.save();
    }
    
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
        game.votingState = {
          votes: new Map(),
          timeLeft: 60,
          startTime: new Date()
        };
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
    const sacrifice = alivePlayers.filter(p => p.role === 'sacrifice');

    console.log('Victory check:', {
      total: alivePlayers.length,
      alivePlayers: alivePlayers.map(p => ({ username: p.username, role: p.role })),
      mafia: mafia.length,
      town: town.length,
      serialKiller: serialKiller.length,
      sacrifice: sacrifice.length
    });

    // Check edge case: only 1 or 2 players left
    if (alivePlayers.length <= 1) {
      if (serialKiller.length > 0) {
        return {
          gameOver: true,
          winner: 'serial-killer',
          message: '🔪 The Serial Killer has eliminated everyone! Chaos reigns supreme!',
          alivePlayers
        };
      } else if (mafia.length > 0) {
        return {
          gameOver: true,
          winner: 'mafia',
          message: '🔴 The Mafia has taken control! Darkness triumphs!',
          alivePlayers
        };
      } else if (town.length > 0) {
        return {
          gameOver: true,
          winner: 'town',
          message: '🏛️ The Town survives! Justice triumphs!',
          alivePlayers
        };
      }
    }

    // Serial Killer wins if they're the last player or among the last 2 (with advantage)
    if (serialKiller.length > 0 && alivePlayers.length <= 2) {
      return {
        gameOver: true,
        winner: 'serial-killer',
        message: '🔪 The Serial Killer has eliminated everyone! Chaos reigns supreme!',
        alivePlayers
      };
    }

    // Mafia wins if they equal or outnumber non-mafia players (excluding serial killer if present)
    const nonMafiaPlayers = town.length + sacrifice.length;
    if (mafia.length > 0 && mafia.length >= nonMafiaPlayers && serialKiller.length === 0) {
      return {
        gameOver: true,
        winner: 'mafia',
        message: '🔴 The Mafia has taken control of the town! Darkness prevails!',
        alivePlayers
      };
    }

    // Town wins if all threats are eliminated (mafia + serial killer + sacrifice)
    if (mafia.length === 0 && serialKiller.length === 0 && sacrifice.length === 0) {
      return {
        gameOver: true,
        winner: 'town',
        message: '🏛️ The Town has restored peace! Justice prevails!',
        alivePlayers
      };
    }

    // Special case: if only town vs sacrifice, town wins
    if (mafia.length === 0 && serialKiller.length === 0 && town.length > 0 && sacrifice.length > 0) {
      return {
        gameOver: true,
        winner: 'town',
        message: '🏛️ The Town has eliminated all threats! Justice prevails!',
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

// ------------------ START SERVER ------------------
server.listen(PORT, () => {
  console.log(`Server with Socket.IO running on http://localhost:${PORT}`)
})