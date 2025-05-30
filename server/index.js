// ------------------ IMPORTURI ------------------
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import bcrypt from 'bcrypt'
import http from 'http'
import { Server } from 'socket.io'

import User from './models/User.js'
import Lobby from './models/Lobby.js'

// ------------------ CONFIG ------------------
const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
})
const PORT = 5001

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
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
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

// ------------------ SOCKET.IO ------------------
io.on('connection', socket => {
  console.log('Client connected:', socket.id);

  socket.on('join-lobby', ({ code, username }) => {
    socket.join(code);
    io.to(code).emit('user-joined', { username });
  });

  socket.on('leave-lobby', async ({ code, username, id }) => {
    console.log(`🔁 ${username} is leaving lobby ${code}`);

    try {
      const lobby = await Lobby.findOne({ code });
      if (!lobby) return;

      // elimină userul după id (nu doar username!)
      lobby.users = lobby.users.filter(user => user.id !== id);
      await lobby.save();

      socket.leave(code);
      io.to(code).emit('user-left', { username });

      console.log(`✅ ${username} removed from lobby ${code}`);
    } catch (err) {
      console.error("❌ Failed to remove user from lobby:", err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ------------------ START SERVER ------------------
server.listen(PORT, () => {
  console.log(`Server with Socket.IO running on http://localhost:${PORT}`)
})