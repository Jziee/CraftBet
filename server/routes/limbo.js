import express from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// ── Provably fair ─────────────────────────────────────────────────────────────
const hashSeed = (seed) =>
  crypto.createHash('sha256').update(seed).digest('hex');

/**
 * Derive the roll result from seeds.
 * Uses the standard Limbo/Crash formula:
 *   h = first 13 hex chars of HMAC → integer
 *   e = 2^52
 *   raw = floor((100 * e - h) / (e - h)) / 100
 *   result = raw * 0.97  (97% RTP house edge)
 *
 * Result is clamped to [1.00, 1000.00].
 * The result is generated FIRST — the player's target only checks win/loss.
 */
const deriveResult = (serverSeed, clientSeed, nonce) => {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  const hash = hmac.digest('hex');

  const h   = parseInt(hash.slice(0, 13), 16);
  const e   = Math.pow(2, 52);
  const raw = Math.floor((100 * e - h) / (e - h)) / 100;

  // Apply 97% RTP, clamp to [1.00, 1000.00]
  const result = Math.min(1000.00, Math.max(1.00, parseFloat((raw * 0.97).toFixed(2))));
  return result;
};

// ── POST /api/limbo/bet ───────────────────────────────────────────────────────
router.post('/bet', authenticate, async (req, res) => {
  try {
    const { bet, target, clientSeed } = req.body;
    const userId = req.user.userId;

    // Validate bet
    if (!bet || bet < 1 || bet > 100000)
      return res.status(400).json({ message: 'Invalid bet (1–100000)' });

    // Validate target
    const targetNum = parseFloat(target);
    if (isNaN(targetNum) || targetNum < 1.01 || targetNum > 1000)
      return res.status(400).json({ message: 'Target must be between 1.01× and 1000×' });

    // Validate clientSeed
    if (!clientSeed || typeof clientSeed !== 'string' || clientSeed.length < 1)
      return res.status(400).json({ message: 'clientSeed is required' });
    if (clientSeed.length > 64)
      return res.status(400).json({ message: 'clientSeed must be 64 characters or fewer' });

    // Atomic balance deduction
    const user = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: bet } },
      { $inc: { balance: -bet } },
      { new: true }
    );
    if (!user) return res.status(400).json({ message: 'Insufficient balance' });

    // Generate seeds — result derived BEFORE comparing to target
    const serverSeed         = crypto.randomBytes(32).toString('hex');
    const serverSeedHash     = hashSeed(serverSeed);
    const nonce              = crypto.randomBytes(16).toString('hex');
    const nextServerSeed     = crypto.randomBytes(32).toString('hex');
    const nextServerSeedHash = hashSeed(nextServerSeed);

    // Roll result
    const result = deriveResult(serverSeed, clientSeed, nonce);
    const won    = result >= targetNum;
    const payout = won ? Math.round(bet * targetNum) : 0;
    const profit = payout - bet;

    // Credit winnings
    if (won) {
      user.balance += payout;
      await user.save();
    }

    res.json({
      // Game result
      result,
      target: targetNum,
      won,
      payout,
      profit,
      bet,
      balance: user.balance,

      // Provably fair — server seed revealed immediately (single-roll game)
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      nextServerSeedHash,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;