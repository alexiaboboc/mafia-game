// ------------------ IMPORTURI ------------------
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import bcrypt from 'bcrypt'
import http from 'http'
import { Server } from 'socket.io'

import User from './models/User.js'
import Lobby from './models/Lobby.js'
import Game from './models/Game.js';

import { resolveNightActions } from './utils/gameLogic.js';

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
const PORT = 5001

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

  socket.on('leave-lobby', ({ code, username, id }) => {
    console.log(`User ${username} left lobby ${code}`);
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

      // Get actual roles in the game, not from roleOrder
      const actualGameRoles = game.players.map(p => p.role);
      
      // Filter roleOrder to only include roles that are actually in this game
      const rolesInGame = roleOrder.filter(r => actualGameRoles.includes(r));
      
      console.log('Actual roles in game:', actualGameRoles);
      console.log('Ordered roles for night:', rolesInGame);

      const currentRoleIndex = rolesInGame.indexOf(role);
      console.log('Current role index:', currentRoleIndex);

      // Broadcast completion to all clients
      console.log('Broadcasting completion to all clients');
      io.in(code).emit('night-action-completed', { role, target });
      console.log('Completion broadcast complete');

      // Proceed to next role after a delay
      if (currentRoleIndex < rolesInGame.length - 1) {
        const nextRole = rolesInGame[currentRoleIndex + 1];
        console.log('Will start next role:', nextRole, 'in 3 seconds');
        
        // Store the next role in the game state
        game.currentRole = nextRole;
        await game.save();
        
        // Wait for 3 seconds before starting next role
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('Starting next role:', nextRole);
        // Re-emit to all clients in case some reconnected
        io.in(code).emit('night-action-started', { role: nextRole });
        console.log('Next role event emitted');
      } else {
        console.log('All roles completed, will end night phase in 3 seconds');
        // Wait for 3 seconds before ending night
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        try {
          console.log('Resolving night phase');
          const result = await resolveNightPhase(code);
          console.log('Night phase resolved, broadcasting end');
          io.in(code).emit('night-ended', result);
          console.log('Night end broadcast complete');
        } catch (error) {
          console.error('Error resolving night phase:', error);
          io.in(code).emit('night-ended', { error: 'Failed to resolve night phase' });
        }
      }
    } catch (error) {
      console.error('Error handling night action:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', clientId);
    const client = connectedClients.get(clientId);
    if (client) {
      // Clean up rooms
      client.rooms.forEach(room => {
        io.in(room).emit('user-left', { username: 'A player' });
      });
      connectedClients.delete(clientId);
    }
  });
});

// ------------------ START SERVER ------------------
server.listen(PORT, () => {
  console.log(`Server with Socket.IO running on http://localhost:${PORT}`)
})