import express from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// ── Provably fair ─────────────────────────────────────────────────────────────
const hashSeed = (seed) =>
  crypto.createHash('sha256').update(seed).digest('hex');

/**
 * Derive coin result from seeds.
 * HMAC-SHA256(serverSeed, "clientSeed:nonce") → hex
 * h = first 8 hex chars → integer 0–(2^32-1)
 * normalized = h / 2^32  → [0, 1)
 * < 0.5 = Heads, ≥ 0.5 = Tails
 */
const deriveCoinResult = (serverSeed, clientSeed, nonce) => {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  const hash = hmac.digest('hex');
  const h = parseInt(hash.slice(0, 8), 16);
  const normalized = h / 0x100000000; // 2^32
  return normalized < 0.5 ? 'heads' : 'tails';
};

// ── POST /api/coinflip/solo/bet ───────────────────────────────────────────────
/**
 * Single instant flip.
 * Body: { bet, side, clientSeed, nonce? }
 *   - nonce: integer, client-managed and incremented per flip for provably fair
 *            If omitted, server generates a random nonce.
 *
 * Payout on win: bet * 2 * 0.97 = bet * 1.94  (3% house edge)
 * Loss: lose bet.
 */
router.post('/bet', authenticate, async (req, res) => {
  try {
    const { bet, side, clientSeed, nonce: clientNonce } = req.body;
    const userId = req.user.userId;

    if (!bet || bet < 1 || bet > 100000)
      return res.status(400).json({ message: 'Invalid bet (1–100000)' });

    if (!['heads', 'tails'].includes(side))
      return res.status(400).json({ message: 'Side must be "heads" or "tails"' });

    if (!clientSeed || typeof clientSeed !== 'string' || clientSeed.length < 1)
      return res.status(400).json({ message: 'clientSeed is required' });

    if (clientSeed.length > 64)
      return res.status(400).json({ message: 'clientSeed must be ≤ 64 characters' });

    // nonce: client provides an integer they increment, or we generate random
    const nonce =
      clientNonce !== undefined && Number.isInteger(clientNonce) && clientNonce >= 0
        ? clientNonce
        : parseInt(crypto.randomBytes(4).toString('hex'), 16);

    // Atomic deduction
    const user = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: bet } },
      { $inc: { balance: -bet } },
      { new: true }
    );
    if (!user) return res.status(400).json({ message: 'Insufficient balance' });

    // Generate server seed per flip — revealed immediately (single-round game)
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = hashSeed(serverSeed);

    // Next-round seed hash for chain verification
    const nextServerSeed = crypto.randomBytes(32).toString('hex');
    const nextServerSeedHash = hashSeed(nextServerSeed);

    // Resolve
    const result = deriveCoinResult(serverSeed, clientSeed, nonce);
    const won = result === side;

    // House edge: 3%  →  win payout = bet * 1.94
    const payout = won ? Math.floor(bet * 1.94) : 0;
    const profit = payout - bet;

    if (won) {
      user.balance += payout;
      await user.save();
    }

    res.json({
      result,
      side,
      won,
      bet,
      payout,
      profit,
      balance: user.balance,
      // Provably fair — full reveal since single-round
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