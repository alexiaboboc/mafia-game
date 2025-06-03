import mongoose from 'mongoose'

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    minlength: 3,
    lowercase: true 
  },
  email: {
    type: String,
    required: true,
    unique: true, 
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  resetToken: String,
  resetTokenExpiry: Date
}, { timestamps: true })

export default mongoose.model('User', UserSchema)
