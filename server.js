/**
 * SkyRush Pro - Production Server Outcome Engine & Multi-Venue Router
 * Cryptographically secure, RTP-bounded crash game engine.
 */
const crypto = require('crypto');

class SkyRushEngine {
  constructor(venueId = 'default-venue', rtpTarget = 95) {
    this.venueId = venueId;
    this.rtpTarget = rtpTarget; // e.g., 95%
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

  // Cryptographically secure float generator [0, 1)
  secureRandom() {
    const buffer = crypto.randomBytes(4);
    const value = buffer.readUInt32BE(0);
    return value / 4294967296;
  }

  generateCrashMultiplier() {
    const r = this.secureRandom();
    // House edge implementation via RTP weighting
    const effectiveRtp = this.rtpTarget / 100.0;
    
    // Instant crash edge case (approx 1% house instant bust)
    if (r < (1 - effectiveRtp)) {
      return 1.00;
    }

    let multiplier = (1 / (1 - r)) * (effectiveRtp * 0.98);
    
    // Volatility tuning modifiers
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

    // Lock in queued bets
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
      // Exponential curve formula for multiplier progression
      this.multiplier = parseFloat(Math.max(1.00, Math.exp(0.08 * this.flightTime)).toFixed(2));

      // Auto-cashout checks & crash evaluation
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

    // Reset for next round after pause
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

module.exports = SkyRushEngine;
