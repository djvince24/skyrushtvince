const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static frontend files directly from root
app.use(express.static(path.join(__dirname)));

// Health check endpoint for Render monitoring
app.get('/healthz', (req, res) => {
    res.status(200).send('OK');
});

/**
 * SkyRush Pro - Self-Contained Secure Server Engine
 */
class SkyRushEngine {
  constructor(venueId = 'default-venue', rtpTarget = 95) {
    this.venueId = venueId;
    this.rtpTarget = rtpTarget;
    this.volatility = 'medium';
    this.status = 'waiting'; // 'waiting', 'flying', 'crashed'
    this.multiplier = 1.00;
    this.countdownSecs = 5.0;
    this.flightTime = 0;
    this.crashTarget = 2.00;
    this.history = [1.24, 2.10, 3.45, 1.05, 4.20];
    this.players = {
      p1: { balance: 1000.00, status: 'idle', currentBet: 0, nextBet: 10, winAmt: 0 },
      p2: { balance: 1000.00, status: 'idle', currentBet: 0, nextBet: 10, winAmt: 0 },
      p3: { balance: 1000.00, status: 'idle', currentBet: 0, nextBet: 10, winAmt: 0 },
      p4: { balance: 1000.00, status: 'idle', currentBet: 0, nextBet: 10, winAmt: 0 }
    };
    this.metrics = {
      totalBets: 0.00,
      totalWins: 0.00,
      netProfit: 0.00,
      totalDeposits: 4000.00
    };
    this.serverSecretSeed = crypto.randomBytes(32).toString('hex');
  }

  secureRandom() {
    const buffer = crypto.randomBytes(4);
    const value = buffer.readUInt32BE(0);
    return value / 4294967296;
  }

  generateCrashMultiplier() {
    const r = this.secureRandom();
    const effectiveRtp = this.rtpTarget / 100.0;
    
    if (r < (1 - effectiveRtp)) {
      return 1.00;
    }

    let multiplier = (1 / (1 - r)) * (effectiveRtp * 0.98);
    
    if (this.volatility === 'low') {
      multiplier = 1.00 + (multiplier - 1.00) * 0.6;
    } else if (this.volatility === 'high') {
      multiplier = Math.pow(multiplier, 1.15);
    } else if (this.volatility === 'extreme') {
      multiplier = Math.pow(multiplier, 1.35);
    }

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
      if (this.countdownSecs <= 0) {
        this.startRound();
      }
    } else if (this.status === 'flying') {
      this.flightTime += deltaSecs;
      this.multiplier = parseFloat(Math.max(1.00, Math.exp(0.08 * this.flightTime)).toFixed(2));

      if (this.multiplier >= this.crashTarget) {
        this.multiplier = this.crashTarget;
        this.crashRound();
      }
    }
  }

  cashOut(playerId) {
    const p = this.players[playerId];
    if (this.status === 'flying' && p && p.status === 'in_game') {
      p.winAmt = parseFloat((p.currentBet * this.multiplier).toFixed(2));
      p.balance += p.winAmt;
      p.status = 'cashed_out';
      this.metrics.totalWins += p.winAmt;
      this.metrics.netProfit = this.metrics.totalBets - this.metrics.totalWins;
      return true;
    }
    return false;
  }

  crashRound() {
    this.status = 'crashed';
    this.history.unshift(this.multiplier);
    if (this.history.length > 20) this.history.pop();

    Object.keys(this.players).forEach(id => {
      const p = this.players[id];
      if (p.status === 'in_game') {
        p.status = 'lost';
      }
    });

    this.metrics.netProfit = this.metrics.totalBets - this.metrics.totalWins;

    setTimeout(() => {
      this.status = 'waiting';
      this.countdownSecs = 5.0;
      Object.keys(this.players).forEach(id => {
        const p = this.players[id];
        if (p.status !== 'queued') p.status = 'idle';
      });
    }, 3000);
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
      volatility: this.volatility
    };
  }
}

// Multi-venue engine store
const venues = {};
function getVenueEngine(venueId = 'default-venue') {
    if (!venues[venueId]) {
        venues[venueId] = new SkyRushEngine(venueId, 95);
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

            if (data.type === 'PLAYER_ACTION') {
                const p = engine.players[data.playerId];
                if (data.action === 'PLACE_BET' && p) {
                    p.nextBet = parseFloat(data.betAmount) || 10;
                } else if (data.action === 'CANCEL_BET' && p) {
                    p.nextBet = 0;
                } else if (data.action === 'CASHOUT' && data.playerId) {
                    engine.cashOut(data.playerId);
                }
            } else if (data.type === 'ADMIN_ACTION') {
                if (data.action === 'START_FLIGHT') {
                    if (engine.status === 'waiting') engine.startRound();
                } else if (data.action === 'FORCE_CRASH') {
                    if (engine.status === 'flying') engine.crashRound();
                } else if (data.action === 'UPDATE_RTP') {
                    engine.rtpTarget = parseInt(data.value) || 95;
                } else if (data.action === 'UPDATE_VOLATILITY') {
                    engine.volatility = data.value || 'medium';
                } else if (data.action === 'ADJUST_BALANCE') {
                    const p = engine.players[data.playerId];
                    if (p && data.amount > 0) {
                        if (data.value === 'deposit') {
                            p.balance += data.amount;
                            engine.metrics.totalDeposits += data.amount;
                        } else if (data.value === 'withdraw' && p.balance >= data.amount) {
                            p.balance -= data.amount;
                        }
                    }
                }
            }
        } catch (e) {
            console.error('WebSocket error:', e);
        }
    });
});

// Global game tick loop (50ms)
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
    console.log(`SkyRush Unified Server running on port ${PORT}`);
});
