/**
 * Casino Route — REME / QQ / CSN
 *
 * The Casino game is primarily client-side (no persistent state needed).
 * This route provides a provably fair spin endpoint for production use
 * and balance deduction/payout via the authenticated user account.
 *
 * Routes:
 *   POST /api/casino/spin   — authenticated spin with balance update
 */

import express from 'express';
import crypto  from 'crypto';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// ── Provably fair helpers ─────────────────────────────────────────────────────
const hashSeed = (seed) =>
  crypto.createHash('sha256').update(seed).digest('hex');

/**
 * Derive a number 0–36 from seeds.
 * HMAC-SHA256(serverSeed, "clientSeed:nonce") → hex
 * h = first 8 hex chars → uint32 → mod 37
 */
const deriveSpinResult = (serverSeed, clientSeed, nonce) => {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  const hash = hmac.digest('hex');
  const h    = parseInt(hash.slice(0, 8), 16);
  return h % 37; // 0–36
};

// ── Game logic helpers ────────────────────────────────────────────────────────
const remeValue = (n) => {
  const sum = Math.floor(n / 10) + (n % 10);
  return sum >= 10 ? sum % 10 : sum;
};

const getScore = (n, mode) => {
  if (mode === 'REME') return remeValue(n);
  if (mode === 'QQ')   return n % 10;
  return n; // CSN
};

/**
 * Compare scores. Returns +1 (p1 wins), -1 (p2 wins), 0 (tie).
 * REME/QQ: 0 is highest.
 * CSN: higher raw number wins.
 */
const compareScores = (s1, s2, mode) => {
  if (mode === 'CSN') {
    return s1 > s2 ? 1 : s1 < s2 ? -1 : 0;
  }
  if (s1 === 0 && s2 !== 0) return 1;
  if (s2 === 0 && s1 !== 0) return -1;
  if (s1 === 0 && s2 === 0) return 0;
  return s1 > s2 ? 1 : s1 < s2 ? -1 : 0;
};

const getMultiplier = (winnerScore, mode, gameType) => {
  if (mode === 'CSN' || gameType === 'vs_player') return 2;
  return winnerScore === 0 ? 3 : 2;
};

// ── POST /api/casino/spin ─────────────────────────────────────────────────────
router.post('/spin', authenticate, async (req, res) => {
  try {
    const { bet, mode, gameType, clientSeed, nonce: clientNonce } = req.body;
    const userId = req.user.userId;

    // Validate
    if (!bet || bet < 1 || bet > 100000)
      return res.status(400).json({ message: 'Invalid bet (1–100000)' });
    if (!['REME', 'QQ', 'CSN'].includes(mode))
      return res.status(400).json({ message: 'Invalid mode' });
    if (!['vs_house', 'vs_player'].includes(gameType))
      return res.status(400).json({ message: 'Invalid gameType' });
    if (!clientSeed || typeof clientSeed !== 'string' || clientSeed.length > 64)
      return res.status(400).json({ message: 'Invalid clientSeed' });

    const nonce = Number.isInteger(clientNonce) && clientNonce >= 0
      ? clientNonce
      : parseInt(crypto.randomBytes(4).toString('hex'), 16);

    // Deduct bet atomically
    const user = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: bet } },
      { $inc: { balance: -bet } },
      { new: true }
    );
    if (!user) return res.status(400).json({ message: 'Insufficient balance' });

    // Generate two server seeds (one per player/side)
    const serverSeed1     = crypto.randomBytes(32).toString('hex');
    const serverSeed2     = crypto.randomBytes(32).toString('hex');
    const serverSeedHash1 = hashSeed(serverSeed1);
    const serverSeedHash2 = hashSeed(serverSeed2);

    // Spin both
    let n1 = deriveSpinResult(serverSeed1, clientSeed, nonce);
    let n2 = deriveSpinResult(serverSeed2, clientSeed, nonce + 1);

    let s1 = getScore(n1, mode);
    let s2 = getScore(n2, mode);
    let cmp = compareScores(s1, s2, mode);
    let respins = 0;

    // Auto-respin on tie in PvP (max 10 respins to prevent infinite loop)
    const respinSeeds = [];
    while (cmp === 0 && gameType === 'vs_player' && respins < 10) {
      const rs1 = crypto.randomBytes(32).toString('hex');
      const rs2 = crypto.randomBytes(32).toString('hex');
      respinSeeds.push({ h1: hashSeed(rs1), h2: hashSeed(rs2) });
      n1  = deriveSpinResult(rs1, clientSeed, nonce + (respins + 2) * 2);
      n2  = deriveSpinResult(rs2, clientSeed, nonce + (respins + 2) * 2 + 1);
      s1  = getScore(n1, mode);
      s2  = getScore(n2, mode);
      cmp = compareScores(s1, s2, mode);
      respins++;
    }

    // Resolve winner
    let winner, multiplier, payout, profit;
    if (cmp === 0) {
      // vs_house tie (or unresolved pvp after max respins)
      winner = 'opponent'; multiplier = 0; payout = 0; profit = -bet;
    } else if (cmp === 1) {
      const winnerScore = s1;
      multiplier = getMultiplier(winnerScore, mode, gameType);
      payout = Math.floor(bet * multiplier);
      profit = payout - bet;
      winner = 'player';
    } else {
      winner = 'opponent'; multiplier = 0; payout = 0; profit = -bet;
    }

    // Credit winnings
    if (payout > 0) {
      user.balance += payout;
      await user.save();
    }

    res.json({
      n1, n2, s1, s2,
      winner, multiplier, payout, profit,
      balance: user.balance,
      respins,
      // Provably fair
      serverSeed1, serverSeedHash1,
      serverSeed2, serverSeedHash2,
      clientSeed,  nonce,
      respinSeeds,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;