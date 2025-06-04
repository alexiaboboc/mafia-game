import mongoose from 'mongoose'

const friendRequestSchema = new mongoose.Schema({
  from: {
    id: { type: String, required: true },
    username: { type: String, required: true }
  },
  to: {
    id: { type: String, required: true },
    username: { type: String, required: true }
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

export default mongoose.model('FriendRequest', friendRequestSchema) 