import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import User from './models/User.js'

const app = express()
const PORT = 5001

// Middleware
// CORS CONFIG
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
  }))
  
  app.use(express.json())

// MongoDB connection
mongoose.connect('mongodb://127.0.0.1:27017/mafia', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB error:', err))

// Routes
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body

  try {
    const existingEmail = await User.findOne({ email })
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already exists' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const newUser = new User({
      username: username.toLowerCase(),
      email,
      password: hashedPassword
    })
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
    if (!user) return res.status(400).json({ error: 'Invalid credentials' })

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' })

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
