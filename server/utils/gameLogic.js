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
          // Remove any mutes from the doctor when self-healing
          if (mutes.has(a.actorId)) {
            console.log('🏥 Doctor removing mute from self after self-heal');
            mutes.delete(a.actorId);
            // Also remove mute from the actual player object
            const gamePlayer = game.players.find(player => player.id === a.actorId);
            if (gamePlayer) {
              gamePlayer.muted = null;
            }
          }
          console.log('Doctor used self-heal');
        }
        a.result = `Doctor healed themselves (one-time use)`;
      } else {
        const target = playersMap[a.targetId];
        // Remove any mutes from the healed player
        if (target && mutes.has(a.targetId)) {
          console.log('🏥 Doctor removing mute from healed player:', target.username);
          mutes.delete(a.targetId);
          // Also remove mute from the actual player object
          const gamePlayer = game.players.find(player => player.id === a.targetId);
          if (gamePlayer) {
            gamePlayer.muted = null;
          }
        }
        a.result = `Healed ${target?.username}`;
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

  // 6. Sacrifice revenge (after being eliminated)
  actions.filter(a => a.action === 'revenge').forEach(a => {
    if (!blocks.has(a.actorId)) {
      const target = playersMap[a.targetId];
      deaths.add(a.targetId);
      a.resolved = true;
      a.result = `Killed ${target?.username} (Sacrifice's revenge)`;
      
      // Mark the Sacrifice as having used their revenge
      const sacrifice = playersMap[a.actorId];
      if (sacrifice) {
        const gamePlayer = game.players.find(player => player.id === a.actorId);
        if (gamePlayer) {
          gamePlayer.hasUsedRevenge = true;
        }
      }
    } else {
      a.resolved = true;
      a.result = 'Blocked by Queen';
    }
  });

  // 7. Policeman shoots (from round 2+)
  actions.filter(a => a.action === 'shoot').forEach(a => {
    if (currentRound < 2) {
      a.resolved = true;
      a.result = 'Cannot shoot before round 2';
      return;
    }
    
    if (!blocks.has(a.actorId)) {
      const target = playersMap[a.targetId];
      console.log('🔫 Policeman shooting:', { target: target?.username, round: currentRound });
      deaths.add(a.targetId);
      a.resolved = true;
      a.result = `Shot ${target?.username}`;
      
      // Check if target is innocent (not mafia or serial killer)
      if (!['killer', 'mutilator', 'serial-killer'].includes(target?.role)) {
        // Policeman will die next round from broken heart
        const policeman = playersMap[a.actorId];
        if (policeman) {
          // Find the actual player in the game's players array
          const gamePlayer = game.players.find(player => player.id === a.actorId);
          if (gamePlayer) {
            // Mark them for death next round
            if (!gamePlayer.dieNextRound) {
              gamePlayer.dieNextRound = true;
              console.log('👮 Policeman shot innocent - will die next round:', policeman.username);
            }
          }
        }
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
  console.log('💀 Processing deaths:', { deaths: Array.from(deaths), heals: Array.from(heals) });
  const actualDeaths = [];
  const playersWithWills = [];
  const playersWithoutWills = [];
  
  deaths.forEach(id => {
    if (!heals.has(id)) {
      const p = playersMap[id];
      if (p) {
        // Find the actual player in the game's players array and update their status
        const gamePlayer = game.players.find(player => player.id === id);
        if (gamePlayer) {
          console.log('☠️ Marking player as dead:', { 
            username: p.username, 
            role: p.role,
            wasAlive: gamePlayer.alive 
          });
          
          // Special handling for Sacrifice
          if (gamePlayer.role === 'sacrifice' && !gamePlayer.hasUsedRevenge) {
            // If this is the first time Sacrifice dies, mark them for revenge next round
            gamePlayer.canRevenge = true;
            gamePlayer.alive = false; // They're dead but will get one more action
            console.log('🗡️ Sacrifice marked for revenge next round');
          } else {
            gamePlayer.alive = false;
          }
          
          p.alive = false; // Keep playersMap in sync
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
      console.log('Mutilator being promoted to Killer');
      mutilator.role = 'killer';
      // Update the role in the playersMap as well
      playersMap[mutilator.id].role = 'killer';
      console.log('Mutilator promoted to Killer');
    }
  }

  // Check for players marked to die this round from previous actions
  game.players.forEach(player => {
    if (player.dieNextRound) {
      console.log('💔 Policeman dying from broken heart:', player.username);
      // Mark as dead but keep in survivors list until next round
      player.alive = false;
      player.dieNextRound = false; // Reset the flag
      actualDeaths.push(player.username);
      // Always give testament to policeman who dies from broken heart
      playersWithWills.push(player.username);
      console.log('👮 Policeman can write testament before dying');
    }
  });

  // Update game state
  game.phase = 'day';
  game.round = currentRound + 1;

  // Get list of survivors for game over check
  const survivors = game.players.filter(p => p.alive || p.dieNextRound); // Include players marked to die next round
  console.log('Current survivors:', survivors.map(p => ({ username: p.username, role: p.role })));

  // Check win conditions
  let gameOver = false;
  let gameOverMessage = '';
  let winner = '';

  // Count alive players by faction
  const aliveMafia = survivors.filter(p => ['killer', 'mutilator'].includes(p.role)).length;
  const aliveSerialKiller = survivors.filter(p => p.role === 'serial-killer').length;
  const aliveTown = survivors.filter(p => !['killer', 'mutilator', 'serial-killer'].includes(p.role)).length;

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
