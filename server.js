const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname)));

app.get('/healthz', (req, res) => {
    res.status(200).send('OK');
});

class SkyRushEngine {
  constructor(venueId = 'maestro-sports-bar', rtpTarget = 85) {
    this.venueId = venueId;
    this.rtpTarget = rtpTarget;
    this.volatility = 'medium';
    this.status = 'waiting'; 
    this.multiplier = 1.00;
    this.countdownSecs = 5.0;
    this.flightTime = 0;
    this.crashTarget = 2.00;
    this.history = [1.24, 2.10, 3.45, 1.05, 4.20];
    this.players = {
      p1: { name: "Player 1", balance: 1000.00, status: 'idle', currentBet: 0, nextBet: 10, winAmt: 0, transactions: [] },
      p2: { name: "Player 2", balance: 1000.00, status: 'idle', currentBet: 0, nextBet: 10, winAmt: 0, transactions: [] },
      p3: { name: "Player 3", balance: 1000.00, status: 'idle', currentBet: 0, nextBet: 10, winAmt: 0, transactions: [] },
      p4: { name: "Player 4", balance: 1000.00, status: 'idle', currentBet: 0, nextBet: 10, winAmt: 0, transactions: [] }
    };
    this.metrics = {
      totalBets: 0.00,
      totalWins: 0.00,
      netProfit: 0.00,
      totalDeposits: 4000.00,
      totalWithdrawals: 0.00
    };
    this.auditLedger = [];
  }

  secureRandom() {
    const buffer = crypto.randomBytes(4);
    return buffer.readUInt32BE(0) / 4294967296;
  }

  generateCrashMultiplier() {
    const r = this.secureRandom();
    const effectiveRtp = this.rtpTarget / 100.0;
    if (r < (1 - effectiveRtp)) return 1.00;
    let multiplier = (1 / (1 - r)) * (effectiveRtp * 0.98);
    return parseFloat(Math.max(1.00, multiplier).toFixed(2));
  }

  startRound() {
    if (this.status !== 'waiting') return;
    this.crashTarget = this.generateCrashMultiplier();
    this.multiplier = 1.00;
    this.flightTime = 0;
    this.status = 'flying';

    Object.keys(this.players).forEach(id => {
      const p = this.players[id];
      if (p.nextBet > 0 && p.balance >= p.nextBet) {
        p.balance -= p.nextBet;
        p.currentBet = p.nextBet;
        p.status = 'in_game';
        this.metrics.totalBets += p.currentBet;
      } else {
        p.status = 'idle';
        p.currentBet = 0;
      }
    });
  }

  tick(deltaSecs = 0.05) {
    if (this.status === 'waiting') {
      this.countdownSecs -= deltaSecs;
      if (this.countdownSecs <= 0) this.startRound();
    } else if (this.status === 'flying') {
      this.flightTime += deltaSecs;
      this.multiplier = parseFloat(Math.max(1.00, Math.exp(0.08 * this.flightTime)).toFixed(2));
      if (this.multiplier >= this.crashTarget) {
        this.multiplier = this.crashTarget;
        this.crashRound();
      }
    }
  }

  crashRound() {
    this.status = 'crashed';
    this.history.unshift(this.multiplier);
    if (this.history.length > 20) this.history.pop();

    Object.keys(this.players).forEach(id => {
      const p = this.players[id];
      if (p.status === 'in_game') p.status = 'lost';
    });

    setTimeout(() => {
      this.status = 'waiting';
      this.countdownSecs = 5.0;
      Object.keys(this.players).forEach(id => {
        const p = this.players[id];
        if (p.status !== 'queued') p.status = 'idle';
      });
    }, 3000);
  }

  processCashierTransaction(playerId, type, amount, cashierUsername) {
    const p = this.players[playerId];
    if (!p) return { success: false, error: 'Invalid player slot' };
    if (amount <= 0) return { success: false, error: 'Amount must be positive' };

    let prevBalance = p.balance;
    if (type === 'WITHDRAW') {
      if (p.status === 'in_game') return { success: false, error: 'Cannot withdraw while player has active bet in flight' };
      if (p.balance < amount) return { success: false, error: 'Insufficient player balance' };
      p.balance -= amount;
      this.metrics.totalWithdrawals += amount;
    } else if (type === 'DEPOSIT') {
      p.balance += amount;
      this.metrics.totalDeposits += amount;
    } else {
      return { success: false, error: 'Unknown transaction type' };
    }

    const txId = 'TX-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const txRecord = {
      txId,
      venueId: this.venueId,
      cashier: cashierUsername || 'Vince_Cashier',
      playerSlot: p.name,
      type,
      amount,
      prevBalance,
      newBalance: p.balance,
      timestamp: new Date().toLocaleTimeString(),
      status: 'COMPLETED'
    };

    p.transactions.unshift(txRecord);
    if (p.transactions.length > 10) p.transactions.pop();
    this.auditLedger.unshift(txRecord);
    if (this.auditLedger.length > 50) this.auditLedger.pop();

    return { success: true, txId, newBalance: p.balance, record: txRecord };
  }

  getState() {
    return {
      venueId: this.venueId,
      status: this.status,
      multiplier: this.multiplier,
      countdownSecs: this.countdownSecs,
      history: this.history,
      players: this.players,
      metrics: this.metrics,
      rtp: this.rtpTarget,
      volatility: this.volatility,
      auditLedger: this.auditLedger
    };
  }
}

const venues = {};
function getVenueEngine(venueId = 'maestro-sports-bar') {
    if (!venues[venueId]) {
        venues[venueId] = new SkyRushEngine(venueId, 85);
    }
    return venues[venueId];
}

wss.on('connection', (ws) => {
    let currentVenue = 'maestro-sports-bar';

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.venue_id) currentVenue = data.venue_id;

            const engine = getVenueEngine(currentVenue);

            if (data.type === 'CASHIER_ACTION') {
                const result = engine.processCashierTransaction(data.playerId, data.action, parseFloat(data.amount), data.cashier);
                ws.send(JSON.stringify({ type: 'CASHIER_RESPONSE', playerId: data.playerId, ...result }));
            } else if (data.type === 'ADMIN_ACTION') {
                if (data.action === 'START_FLIGHT' && engine.status === 'waiting') engine.startRound();
                else if (data.action === 'FORCE_CRASH' && engine.status === 'flying') engine.crashRound();
            }
        } catch (e) {
            console.error('WebSocket error:', e);
        }
    });
});

setInterval(() => {
    for (let venueId in venues) {
        const engine = venues[venueId];
        engine.tick(0.05);

        const payload = JSON.stringify({
            type: 'STATE_UPDATE',
            state: engine.getState()
        });

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`SkyRush Cashier Server running on port ${PORT}`);
});
