import mongoose from 'mongoose';

const PlayerSchema = new mongoose.Schema({
  id: String,
  username: String,
  role: String,
  alive: { type: Boolean, default: true },
  muted: { type: String, default: null }, // 'chat' sau 'vote'
  healedSelf: { type: Boolean, default: false },
  revealed: { type: Boolean, default: false },
});

const GameSchema = new mongoose.Schema({
  code: String,
  round: { type: Number, default: 1 },
  phase: { type: String, default: 'night' },
  players: [PlayerSchema],
  history: [
    {
      round: Number,
      nightActions: [],
      resolvedDeaths: [],
    }
  ]
});

export default mongoose.model('Game', GameSchema);