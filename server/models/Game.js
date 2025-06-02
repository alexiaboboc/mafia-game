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
  phase: { type: String, default: 'night' }, // 'night', 'day', 'voting', 'results', 'testament', 'game-over'
  currentRole: { type: String, default: null },
  players: [PlayerSchema],
  votesToProceed: { type: [String], default: [] }, // Array of usernames who voted to proceed
  
  // Chat state persistence
  chatPhase: { type: String, default: 'testaments' }, // 'testaments', 'discussions', 'accusations', 'completed'
  currentTestamentPlayer: { type: String, default: null },
  testamentTimeLeft: { type: Number, default: 20 },
  phaseTimeLeft: { type: Number, default: 0 },
  totalTimeLeft: { type: Number, default: 0 },
  testamentsWritten: { type: [String], default: [] }, // Array of usernames who wrote testaments
  accusedPlayer: { type: String, default: null },
  chatStartTime: { type: Date, default: null },
  
  // Voting state
  votingState: {
    votes: { type: Map, of: String, default: new Map() }, // Map of username -> vote
    timeLeft: { type: Number, default: 60 },
    startTime: { type: Date, default: null }
  },
  voteTimerStarted: { type: Boolean, default: false },
  
  // Results and testament state
  lastVoteResult: {
    eliminatedPlayer: String,
    voteCounts: { type: Map, of: Number, default: new Map() },
    totalVotes: Number,
    tie: Boolean
  },
  eliminatedPlayer: { type: String, default: null },
  testamentStartTime: { type: Date, default: null },
  
  history: [
    {
      round: Number,
      nightActions: [],
      resolvedDeaths: [],
    }
  ]
});

export default mongoose.model('Game', GameSchema);