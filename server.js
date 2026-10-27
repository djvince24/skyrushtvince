const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const server = new WebSocket.Server({ port: PORT });

let adminPassword = process.env.ADMIN_PASS || 'admin123';

let gameState = {
  status: 'waiting', // 'waiting', 'flying', 'crashed'
  multiplier: 1.00,
  crashPoint: 2.00,
  countdownSecs: 5.0,
  targetRTP: 85, // Default low RTP for house advantage
  volatility: 'medium',
  houseShield: true, // House Always Wins Protection Mode
  lastHourlyHighTime: Date.now(),
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
  const now = Date.now();
  const oneHour = 3600 * 1000;
  let allowHighMultiplier = false;

  // Hourly High Multiplier Hook (Triggers roughly once an hour, rare up to 3 hours)
  if (now - gameState.lastHourlyHighTime > (oneHour * (1 + Math.random() * 2))) {
    if (Math.random() < 0.25) { // 25% chance once hourly window opens
      allowHighMultiplier = true;
      gameState.lastHourlyHighTime = now;
    }
  }

  let crash;
  const rand = Math.random();

  if (allowHighMultiplier) {
    // Rare High Multiplier event (capped strictly at 200x max)
    crash = 5.0 + Math.pow(Math.random(), 3) * 195.0;
    if (crash > 200.0) crash = 200.0;
  } else {
    // Complex Unpredictable Algorithm: Most of the time DOES NOT reach 5x
    const subRand = Math.random();
    if (subRand < 0.65) {
      // 65% crash very early (1.01x - 2.20x)
      crash = 1.01 + (Math.random() * 1.19);
    } else if (subRand < 0.88) {
      // 23% crash moderately (2.20x - 4.99x)
      crash = 2.20 + (Math.random() * 2.79);
    } else {
      // 12% chance to break past 5x (up to 18x) during normal play
      crash = 5.00 + (Math.random() * 13.00);
    }
  }

  // Factor in Target RTP & Volatility
  crash = crash * (gameState.targetRTP / 100);
  return Math.max(1.01, Math.floor(crash * 100) / 100);
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
  if (gameState.history.length > 30) gameState.history.pop();

  ['p1', 'p2', 'p3', 'p4'].forEach(id => {
    const p = gameState.players[id];
    if (p.status === 'in_game') p.status = 'lost';
  });

  setTimeout(() => {
    gameState.status = 'waiting';
    gameState.countdownSecs = 5.0;
  }, 3000);
}

// Master Server Tick (100ms) - Strong & Responsive Engine
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

    // House Always Wins Balance Protection Mechanism
    if (gameState.houseShield) {
      let activePayouts = 0;
      ['p1', 'p2', 'p3', 'p4'].forEach(id => {
        const p = gameState.players[id];
        if (p.status === 'in_game') activePayouts += (p.currentBet * gameState.multiplier);
      });

      // If active player potential winnings threaten house stability, force instant emergency crash
      if (activePayouts > 3000 || gameState.metrics.netProfit < -500) {
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

        if (action === 'PLACE_BET' && p.balance >= betAmount) {
          p.balance -= betAmount;
          p.nextBet = betAmount;
          p.autoCash = autoCash;
          p.autoVal = autoVal;
          p.status = 'queued';
        } else if (action === 'CANCEL_BET') {
          p.balance += p.nextBet;
          p.nextBet = 0;
          p.status = 'idle';
        } else if (action === 'CASHOUT' && p.status === 'in_game' && gameState.status === 'flying') {
          const win = p.currentBet * gameState.multiplier;
          p.balance += win;
          p.winAmt = win;
          p.status = 'cashed_out';
          gameState.metrics.totalWins += win;
          gameState.metrics.netProfit = gameState.metrics.totalBets - gameState.metrics.totalWins;
        }
      } else if (data.type === 'ADMIN_ACTION') {
        const { action, value, playerId, amount, password } = data;
        
        if (action === 'START_FLIGHT' && gameState.status === 'waiting') {
          triggerTakeoff();
        } else if (action === 'FORCE_CRASH' && gameState.status === 'flying') {
          triggerCrash();
        } else if (action === 'UPDATE_RTP') {
          gameState.targetRTP = value;
        } else if (action === 'UPDATE_VOLATILITY') {
          gameState.volatility = value;
        } else if (action === 'TOGGLE_SHIELD') {
          gameState.houseShield = value;
        } else if (action === 'UPDATE_PASSWORD') {
          if (password && password.length >= 4) adminPassword = password;
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
