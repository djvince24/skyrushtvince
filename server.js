const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const server = new WebSocket.Server({ port: PORT });

let gameState = {
  status: 'waiting', // 'waiting', 'flying', 'crashed'
  multiplier: 1.00,
  crashPoint: 2.00,
  countdownSecs: 5.0,
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

// Master Server Tick (100ms) - Exact same speed & curve across all devices
setInterval(() => {
  if (gameState.status === 'waiting') {
    gameState.countdownSecs -= 0.1;
    if (gameState.countdownSecs <= 0) {
      gameState.status = 'flying';
      gameState.multiplier = 1.00;
      gameState.crashPoint = generateCrashPoint();
      
      // Move queued bets into active game
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
  } else if (gameState.status === 'flying') {
    // Shared acceleration velocity formula
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

    if (gameState.multiplier >= gameState.crashPoint) {
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
  }

  // Broadcast updated state to all connected clients across networks
  const payload = JSON.stringify({ type: 'STATE_UPDATE', state: gameState });
  server.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}, 100);

server.on('connection', (ws) => {
  // Send current state immediately upon client connection
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
      }
    } catch(e) {}
  });
});

console.log(`SkyRush Centralized Server running on port ${PORT}`);
