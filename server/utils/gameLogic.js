// gameLogic.js
import Game from '../models/Game.js';

export async function resolveNightActions(code) {
  const game = await Game.findOne({ code });
  if (!game) throw new Error('Game not found');

  const playersMap = Object.fromEntries(game.players.map(p => [p.id, p]));
  const currentRound = game.round;

  // Initialize history for current round if it doesn't exist
  let history = game.history.find(h => h.round === currentRound);
  if (!history) {
    history = { 
      round: currentRound, 
      nightActions: [], 
      resolvedDeaths: [] 
    };
    game.history.push(history);
    await game.save();
  }

  const actions = history.nightActions || [];
  const deaths = new Set();
  const blocks = new Set();
  const heals = new Set();
  const mutes = new Map();

  // 1. Queen blocks
  actions.filter(a => a.action === 'block').forEach(a => {
    blocks.add(a.targetId);
    a.resolved = true;
    a.result = 'Blocked';
  });

  // 2. Killer
  actions.filter(a => a.action === 'kill').forEach(a => {
    if (!blocks.has(a.actorId)) deaths.add(a.targetId);
    a.resolved = true;
  });

  // 3. Mutilator
  actions.filter(a => a.action === 'muteVote' || a.action === 'muteChat').forEach(a => {
    if (!blocks.has(a.actorId)) mutes.set(a.targetId, a.action === 'muteVote' ? 'vote' : 'chat');
    a.resolved = true;
  });

  // 4. Doctor
  actions.filter(a => a.action === 'heal').forEach(a => {
    if (!blocks.has(a.actorId)) heals.add(a.targetId);
    a.resolved = true;
  });

  // 5. Serial Killer
  actions.filter(a => a.action === 'sk-kill').forEach(a => {
    if (!blocks.has(a.actorId)) deaths.add(a.targetId);
    a.resolved = true;
  });

  // 6. Policeman
  actions.filter(a => a.action === 'shoot').forEach(a => {
    if (!blocks.has(a.actorId)) deaths.add(a.targetId);
    a.resolved = true;
  });

  // 7. Sheriff
  actions.filter(a => a.action === 'investigate').forEach(a => {
    a.resolved = true;
    const target = playersMap[a.targetId];
    if (blocks.has(a.actorId)) {
      a.result = '🤷‍♀️';
    } else if (["killer", "mutilator", "serial-killer"].includes(target.role)) {
      a.result = '👍';
    } else {
      a.result = '👎';
    }
  });

  // 8. Lookout
  actions.filter(a => a.action === 'watch').forEach(a => {
    a.resolved = true;
    const visitors = actions
      .filter(other => other.targetId === a.targetId && other.actorId !== a.actorId)
      .map(other => playersMap[other.actorId]?.username);
    a.result = visitors.join(', ');
  });

  // Apply deaths & mutes
  deaths.forEach(id => {
    if (!heals.has(id)) {
      const p = playersMap[id];
      if (p) p.alive = false;
    }
  });

  mutes.forEach((type, id) => {
    const p = playersMap[id];
    if (p) p.muted = type;
  });

  // Update game state
  game.phase = 'day';
  await game.save();

  return {
    deaths: [...deaths].filter(id => !heals.has(id)),
    mutes: Object.fromEntries(mutes),
  };
}
