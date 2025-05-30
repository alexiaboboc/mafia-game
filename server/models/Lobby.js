import mongoose from 'mongoose'

const LobbySchema = new mongoose.Schema({
  code: {
    type: String,
    unique: true,
    required: true
  },
  users: [
    {
      id: String,
      username: String
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600 // 10 minute până se șterge automat
  },
  gameStarted: {
    type: Boolean,
    default: false
  }
})

export default mongoose.model('Lobby', LobbySchema)