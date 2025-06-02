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
  const mutes = new Map(); // targetId -> { type: 'chat'|'vote', muterName: string }
  const investigations = new Map(); // actorId -> result
  const lookoutResults = new Map(); // actorId -> visitors[]
  const policemanDeaths = new Set(); // Players who will die next round from broken heart

  console.log('Resolving night actions for round', currentRound);
  console.log('Actions to process:', actions);

  // 1. Queen blocks (highest priority)
  actions.filter(a => a.action === 'block').forEach(a => {
    const target = playersMap[a.targetId];
    blocks.add(a.targetId);
    a.resolved = true;
    a.result = `Blocked ${target?.username}`;
    
    // Special case: Queen visits Serial Killer -> Queen dies with bloody will
    if (target?.role === 'serial-killer') {
      deaths.add(a.actorId);
      console.log('Queen visited Serial Killer - Queen dies');
    }
  });

  // 2. Mutilator mutes
  actions.filter(a => a.action === 'muteChat' || a.action === 'muteVote').forEach(a => {
    if (!blocks.has(a.actorId)) {
      const type = a.action === 'muteChat' ? 'chat' : 'vote';
      const target = playersMap[a.targetId];
      mutes.set(a.targetId, { 
        type, 
        muterName: playersMap[a.actorId]?.username 
      });
      a.resolved = true;
      a.result = `Muted ${target?.username} (${type})`;
    } else {
      a.resolved = true;
      a.result = 'Blocked by Queen';
    }
  });

  // 3. Killer attacks
  actions.filter(a => a.action === 'kill').forEach(a => {
    if (!blocks.has(a.actorId)) {
      const target = playersMap[a.targetId];
      // Killer cannot kill Serial Killer
      if (target?.role !== 'serial-killer') {
        deaths.add(a.targetId);
        a.resolved = true;
        a.result = `Killed ${target?.username}`;
      } else {
        a.resolved = true;
        a.result = 'Cannot kill Serial Killer';
      }
    } else {
      a.resolved = true;
      a.result = 'Blocked by Queen';
    }
  });

  // 4. Doctor heals
  actions.filter(a => a.action === 'heal' || a.action === 'heal-self').forEach(a => {
    if (!blocks.has(a.actorId)) {
      heals.add(a.targetId);
      a.resolved = true;
      
      // Mark doctor as having used self-heal if they healed themselves
      if (a.action === 'heal-self') {
        const doctor = playersMap[a.actorId];
        if (doctor) {
          doctor.healedSelf = true;
          console.log('Doctor used self-heal');
        }
        a.result = `Doctor healed themselves (one-time use)`;
      } else {
        a.result = `Healed ${playersMap[a.targetId]?.username}`;
      }
    } else {
      a.resolved = true;
      a.result = 'Blocked by Queen';
    }
  });

  // 5. Serial Killer attacks (can kill anyone)
  actions.filter(a => a.action === 'sk-kill').forEach(a => {
    if (!blocks.has(a.actorId)) {
      deaths.add(a.targetId);
      a.resolved = true;
      a.result = `Killed ${playersMap[a.targetId]?.username}`;
    } else {
      a.resolved = true;
      a.result = 'Blocked by Queen';
    }
  });

  // 6. Sacrifice (no night action, but processes during day)
  // Sacrifice doesn't have night actions

  // 7. Policeman shoots (from round 2+)
  actions.filter(a => a.action === 'shoot').forEach(a => {
    if (currentRound < 2) {
      a.resolved = true;
      a.result = 'Cannot shoot before round 2';
      return;
    }
    
    if (!blocks.has(a.actorId)) {
      const target = playersMap[a.targetId];
      deaths.add(a.targetId);
      a.resolved = true;
      a.result = `Shot ${target?.username}`;
      
      // Check if target is innocent (not mafia or serial killer)
      if (!['killer', 'mutilator', 'serial-killer'].includes(target?.role)) {
        // Policeman will die next round from broken heart
        policemanDeaths.add(a.actorId);
        console.log('Policeman shot innocent - will die next round');
      }
    } else {
      a.resolved = true;
      a.result = 'Blocked by Queen';
    }
  });

  // 8. Sheriff investigates
  actions.filter(a => a.action === 'investigate').forEach(a => {
    if (!blocks.has(a.actorId)) {
      const target = playersMap[a.targetId];
      let result;
      
      if (['killer', 'mutilator', 'serial-killer'].includes(target?.role)) {
        result = '👍'; // Suspicious
      } else {
        result = '👎'; // Not suspicious
      }
      
      investigations.set(a.actorId, result);
      a.resolved = true;
      a.result = `Investigated ${target?.username}: ${result}`;
    } else {
      investigations.set(a.actorId, '🤷‍♀️');
      a.resolved = true;
      a.result = 'Blocked by Queen: 🤷‍♀️';
    }
  });

  // 9. Lookout watches
  actions.filter(a => a.action === 'watch').forEach(a => {
    if (!blocks.has(a.actorId)) {
      const visitors = actions
        .filter(other => other.targetId === a.targetId && other.actorId !== a.actorId)
        .map(other => playersMap[other.actorId]?.username)
        .filter(Boolean);
      
      lookoutResults.set(a.actorId, visitors);
      a.resolved = true;
      a.result = `Watched ${playersMap[a.targetId]?.username}: ${visitors.length ? visitors.join(', ') : 'No visitors'}`;
    } else {
      a.resolved = true;
      a.result = 'Blocked by Queen';
    }
  });

  // 10. Mayor and 11. Citizen have no night actions

  // Apply deaths (but save those healed)
  const actualDeaths = [];
  const playersWithWills = [];
  const playersWithoutWills = [];
  
  deaths.forEach(id => {
    if (!heals.has(id)) {
      const p = playersMap[id];
      if (p) {
        p.alive = false;
        actualDeaths.push(p.username);
        
        // Check if player should have a will
        let hasWill = true;
        
        // Exception 1: Queen who visited Serial Killer (bloody will = no testament)
        const queenAction = actions.find(a => a.action === 'block' && a.actorId === id);
        if (queenAction && p.role === 'queen') {
          const target = playersMap[queenAction.targetId];
          if (target?.role === 'serial-killer') {
            hasWill = false; // Bloody will - no testament
          }
        }
        
        // Exception 2: Player who was chat-muted cannot write testament
        const muteInfo = mutes.get(id);
        if (muteInfo && muteInfo.type === 'chat') {
          hasWill = false;
        }
        
        if (hasWill) {
          playersWithWills.push(p.username);
        } else {
          playersWithoutWills.push(p.username);
        }
      }
    }
  });

  // Apply mutes
  const actualMutes = [];
  mutes.forEach((muteInfo, id) => {
    const p = playersMap[id];
    if (p && p.alive) {
      p.muted = muteInfo.type;
      actualMutes.push({
        username: p.username,
        type: muteInfo.type,
        muterName: muteInfo.muterName
      });
    }
  });

  // Check if Killer died and promote Mutilator
  const killerDied = game.players.find(p => p.role === 'killer' && !p.alive);
  if (killerDied) {
    const mutilator = game.players.find(p => p.role === 'mutilator' && p.alive);
    if (mutilator) {
      mutilator.role = 'killer';
      console.log('Mutilator promoted to Killer');
    }
  }

  // Handle policeman broken heart deaths (for next round)
  // This would need to be stored and processed in the next round

  // Update game state
  game.phase = 'day';
  game.round = currentRound + 1;
  await game.save();

  // Return results for client
  return {
    deaths: actualDeaths,
    muted: actualMutes,
    wills: {
      withWills: playersWithWills,
      withoutWills: playersWithoutWills
    },
    investigations: Object.fromEntries(
      Array.from(investigations.entries()).map(([actorId, result]) => [
        playersMap[actorId]?.username, result
      ])
    ),
    lookoutResults: Object.fromEntries(
      Array.from(lookoutResults.entries()).map(([actorId, visitors]) => [
        playersMap[actorId]?.username, visitors
      ])
    )
  };
}
