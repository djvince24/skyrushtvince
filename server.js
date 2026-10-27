const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const server = new WebSocket.Server({ port: PORT });

let gameState = {
  status: 'waiting', // 'waiting', 'flying', 'crashed'
  multiplier: 1.00,
  crashPoint: 2.00,
  countdownSecs: 5.0,
  targetRTP: 95,
  houseShield: true,
  history: [1.45, 2.10, 1.12, 5.80, 1.05, 3.40],
  metrics: { totalBets: 0, totalWins: 0, netProfit: 0, totalDeposits: 4000 },
  players: {
    p1: { balance: 1000, currentBet: 0, nextBet: 0, status: 'idle', autoCash: false, autoVal: 2.0, winAmt: 0 },
    p2: { balance: 1000, currentBet: 0, nextBet: 0, status: 'idle', autoCash: false, autoVal: 2.0, winAmt: 0 },
    p3: { balance: 1000, currentBet: 0, nextBet: 0, status: 'idle', autoCash: false, autoVal: 2.0, winAmt: 0 },
    p4: { balance: 1000, currentBet: 0, nextBet: 0, status: 'idle', autoCash: false, autoVal: 2.0, winAmt: 0 }
  }
};

function generateCrashPoint() {
  const rand = Math.random();
  let crash = Math.floor((100 / (100 - rand * 99)) * 100) / 100;
  return Math.max(1.01, crash);
}

function triggerTakeoff() {
  gameState.status = 'flying';
  gameState.multiplier = 1.00;
  gameState.crashPoint = generateCrashPoint();
  
  ['p1', 'p2', 'p3', 'p4'].forEach(id => {
    const p = gameState.players[id];
    if (p.nextBet > 0) {
      p.currentBet = p.nextBet;
      p.nextBet = 0;
      p.status = 'in_game';
      p.winAmt = 0;
      gameState.metrics.totalBets += p.currentBet;
    } else {
      p.status = 'idle';
    }
  });
}

function triggerCrash() {
  gameState.status = 'crashed';
  gameState.history.unshift(gameState.multiplier);
  if (gameState.history.length > 20) gameState.history.pop();

  ['p1', 'p2', 'p3', 'p4'].forEach(id => {
    const p = gameState.players[id];
    if (p.status === 'in_game') p.status = 'lost';
  });

  setTimeout(() => {
    gameState.status = 'waiting';
    gameState.countdownSecs = 5.0;
  }, 3000);
}

// Master Server Tick (100ms)
setInterval(() => {
  if (gameState.status === 'waiting') {
    gameState.countdownSecs -= 0.1;
    if (gameState.countdownSecs <= 0) {
      triggerTakeoff();
    }
  } else if (gameState.status === 'flying') {
    gameState.multiplier += 0.01 + (gameState.multiplier * 0.002);

    // Auto-cashout processing
    ['p1', 'p2', 'p3', 'p4'].forEach(id => {
      const p = gameState.players[id];
      if (p.status === 'in_game' && p.autoCash && gameState.multiplier >= p.autoVal) {
        const win = p.currentBet * gameState.multiplier;
        p.balance += win;
        p.winAmt = win;
        p.status = 'cashed_out';
        gameState.metrics.totalWins += win;
        gameState.metrics.netProfit = gameState.metrics.totalBets - gameState.metrics.totalWins;
      }
    });

    // House Shield check
    if (gameState.houseShield) {
      let activePayouts = 0;
      ['p1', 'p2', 'p3', 'p4'].forEach(id => {
        const p = gameState.players[id];
        if (p.status === 'in_game') activePayouts += (p.currentBet * gameState.multiplier);
      });
      if (activePayouts > 5000) {
        triggerCrash();
      }
    }

    if (gameState.multiplier >= gameState.crashPoint) {
      triggerCrash();
    }
  }

  broadcastState();
}, 100);

function broadcastState() {
  const payload = JSON.stringify({ type: 'STATE_UPDATE', state: gameState });
  server.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

server.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'STATE_UPDATE', state: gameState }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'PLAYER_ACTION') {
        const { action, playerId, betAmount, autoCash, autoVal } = data;
        const p = gameState.players[playerId];
        if (!p) return;

        if (action === 'PLACE_BET') {
          if (p.balance >= betAmount) {
            p.balance -= betAmount;
            p.nextBet = betAmount;
            p.autoCash = autoCash;
            p.autoVal = autoVal;
            p.status = 'queued';
          }
        } else if (action === 'CANCEL_BET') {
          p.balance += p.nextBet;
          p.nextBet = 0;
          p.status = 'idle';
        } else if (action === 'CASHOUT') {
          if (p.status === 'in_game' && gameState.status === 'flying') {
            const win = p.currentBet * gameState.multiplier;
            p.balance += win;
            p.winAmt = win;
            p.status = 'cashed_out';
            gameState.metrics.totalWins += win;
            gameState.metrics.netProfit = gameState.metrics.totalBets - gameState.metrics.totalWins;
          }
        }
      } else if (data.type === 'ADMIN_ACTION') {
        const { action, value, playerId, amount } = data;
        if (action === 'START_FLIGHT' && gameState.status === 'waiting') {
          triggerTakeoff();
        } else if (action === 'FORCE_CRASH' && gameState.status === 'flying') {
          triggerCrash();
        } else if (action === 'UPDATE_RTP') {
          gameState.targetRTP = value;
        } else if (action === 'TOGGLE_SHIELD') {
          gameState.houseShield = value;
        } else if (action === 'ADJUST_BALANCE') {
          const p = gameState.players[playerId];
          if (p) {
            if (value === 'deposit') {
              p.balance += amount;
              gameState.metrics.totalDeposits += amount;
            } else if (value === 'withdraw') {
              p.balance = Math.max(0, p.balance - amount);
            }
          }
        }
      }
      broadcastState();
    } catch(e) {}
  });
});

console.log(`SkyRush Centralized Server running on port ${PORT}`);
