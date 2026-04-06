import express from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// ── In-memory lobby ───────────────────────────────────────────────────────────
// Map<gameId, PVPGame>
const lobby = new Map();

// ── Provably fair ─────────────────────────────────────────────────────────────
const hashSeed = (seed) =>
  crypto.createHash('sha256').update(seed).digest('hex');

/**
 * Derive coin result from seeds.
 * HMAC-SHA256(serverSeed, "clientSeed:nonce") → hex
 * h = first 8 hex chars → integer → 0–(2^32 - 1)
 * result = h / 2^32  → [0, 1)
 * < 0.5 = Heads, ≥ 0.5 = Tails
 */
const deriveCoinResult = (serverSeed, clientSeed, nonce) => {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonce}`);
  const hash = hmac.digest('hex');
  const h = parseInt(hash.slice(0, 8), 16);
  const normalized = h / 0x100000000; // divide by 2^32
  return normalized < 0.5 ? 'heads' : 'tails';
};

// ── Timeout: auto-cancel games with no joiner after 5 minutes ─────────────────
const LOBBY_TIMEOUT_MS = 5 * 60 * 1000;

const scheduleTimeout = (gameId) => {
  setTimeout(async () => {
    const game = lobby.get(gameId);
    if (!game || game.status !== 'waiting') return;

    // Refund creator
    try {
      await User.findByIdAndUpdate(game.creatorId, { $inc: { balance: game.bet } });
    } catch (_) {}

    game.status = 'cancelled';
    game.cancelReason = 'timeout';
    // Keep briefly for client polling, then remove
    setTimeout(() => lobby.delete(gameId), 10000);
  }, LOBBY_TIMEOUT_MS);
};

// ── POST /api/coinflip/pvp/create ─────────────────────────────────────────────
router.post('/create', authenticate, async (req, res) => {
  try {
    const { bet, side, clientSeed, inviteOnly = false } = req.body;
    const userId = req.user.userId;

    if (!bet || bet < 1 || bet > 100000)
      return res.status(400).json({ message: 'Invalid bet (1–100000)' });

    if (!['heads', 'tails'].includes(side))
      return res.status(400).json({ message: 'Side must be "heads" or "tails"' });

    if (!clientSeed || typeof clientSeed !== 'string' || clientSeed.length < 1)
      return res.status(400).json({ message: 'clientSeed is required' });

    if (clientSeed.length > 64)
      return res.status(400).json({ message: 'clientSeed must be ≤ 64 characters' });

    // Deduct bet from creator
    const user = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: bet } },
      { $inc: { balance: -bet } },
      { new: true }
    );
    if (!user) return res.status(400).json({ message: 'Insufficient balance' });

    const gameId = crypto.randomUUID();
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = hashSeed(serverSeed);
    const nonce = crypto.randomBytes(8).toString('hex');

    const game = {
      gameId,
      status: 'waiting',                // waiting | active | resolved | cancelled
      bet,
      pot: bet * 2,
      inviteOnly,
      creatorId: userId.toString(),
      creatorUsername: user.username,
      creatorSide: side,
      joinerSide: side === 'heads' ? 'tails' : 'heads',
      clientSeed,                        // from creator — revealed after resolve
      serverSeed,                        // hidden until resolve
      serverSeedHash,                    // shared immediately
      nonce,
      result: null,
      winnerId: null,
      winnerUsername: null,
      createdAt: Date.now(),
    };

    lobby.set(gameId, game);
    scheduleTimeout(gameId);

    res.json({
      gameId,
      status: 'waiting',
      bet,
      pot: game.pot,
      creatorSide: side,
      joinerSide: game.joinerSide,
      serverSeedHash,
      clientSeed,
      nonce,
      inviteOnly,
      balance: user.balance,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/coinflip/pvp/lobby ───────────────────────────────────────────────
router.get('/lobby', authenticate, async (req, res) => {
  try {
    const games = [];
    for (const game of lobby.values()) {
      if (game.status === 'waiting' && !game.inviteOnly) {
        games.push({
          gameId: game.gameId,
          bet: game.bet,
          pot: game.pot,
          creatorUsername: game.creatorUsername,
          creatorSide: game.creatorSide,
          joinerSide: game.joinerSide,
          createdAt: game.createdAt,
        });
      }
    }
    // Newest first
    games.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ games });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/coinflip/pvp/join ───────────────────────────────────────────────
router.post('/join', authenticate, async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.userId;

    const game = lobby.get(gameId);
    if (!game)
      return res.status(404).json({ message: 'Game not found' });
    if (game.status !== 'waiting')
      return res.status(400).json({ message: 'Game is no longer open' });
    if (game.creatorId === userId.toString())
      return res.status(400).json({ message: 'Cannot join your own game' });

    // Deduct bet from joiner
    const joiner = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: game.bet } },
      { $inc: { balance: -game.bet } },
      { new: true }
    );
    if (!joiner) return res.status(400).json({ message: 'Insufficient balance' });

    // Mark active before resolving
    game.status = 'active';
    game.joinerId = userId.toString();
    game.joinerUsername = joiner.username;

    // ── Resolve ────────────────────────────────────────────────────────────────
    const result = deriveCoinResult(game.serverSeed, game.clientSeed, game.nonce);
    game.result = result;

    const creatorWon = game.creatorSide === result;
    const winnerId = creatorWon ? game.creatorId : game.joinerId;
    const winnerUsername = creatorWon ? game.creatorUsername : game.joinerUsername;

    game.winnerId = winnerId;
    game.winnerUsername = winnerUsername;
    game.status = 'resolved';

    // House edge: 3%
    const houseEdge = 0.03;
    const payout = Math.floor(game.pot * (1 - houseEdge));

    // Credit winner
    await User.findByIdAndUpdate(winnerId, { $inc: { balance: payout } });

    // Update joiner balance after payout (re-fetch)
    const updatedJoiner = await User.findById(userId);

    lobby.set(gameId, game);
    // Clean up after 30s
    setTimeout(() => lobby.delete(gameId), 30000);

    res.json({
      gameId,
      status: 'resolved',
      result,
      creatorSide: game.creatorSide,
      joinerSide: game.joinerSide,
      creatorUsername: game.creatorUsername,
      joinerUsername: game.joinerUsername,
      winnerId,
      winnerUsername,
      bet: game.bet,
      pot: game.pot,
      payout,
      profit: payout - game.bet,
      // Provably fair reveal
      serverSeed: game.serverSeed,
      serverSeedHash: game.serverSeedHash,
      clientSeed: game.clientSeed,
      nonce: game.nonce,
      balance: updatedJoiner.balance,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/coinflip/pvp/game/:gameId ────────────────────────────────────────
// Poll a single game state (for the creator waiting on a joiner)
router.get('/game/:gameId', authenticate, async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.userId;
    const game = lobby.get(gameId);

    if (!game) return res.status(404).json({ message: 'Game not found' });

    // Only participants can see full details once resolved
    const isParticipant =
      game.creatorId === userId.toString() ||
      game.joinerId  === userId.toString();

    if (game.status === 'resolved' && !isParticipant)
      return res.status(403).json({ message: 'Not a participant' });

    res.json({
      gameId: game.gameId,
      status: game.status,
      bet: game.bet,
      pot: game.pot,
      creatorUsername: game.creatorUsername,
      joinerUsername: game.joinerUsername || null,
      creatorSide: game.creatorSide,
      joinerSide: game.joinerSide,
      result: game.result,
      winnerId: game.winnerId,
      winnerUsername: game.winnerUsername,
      serverSeedHash: game.serverSeedHash,
      ...(game.status === 'resolved' ? {
        serverSeed: game.serverSeed,
        clientSeed: game.clientSeed,
        nonce: game.nonce,
      } : {}),
      cancelReason: game.cancelReason || null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/coinflip/pvp/cancel ─────────────────────────────────────────────
router.post('/cancel', authenticate, async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.userId;

    const game = lobby.get(gameId);
    if (!game)
      return res.status(404).json({ message: 'Game not found' });
    if (game.creatorId !== userId.toString())
      return res.status(403).json({ message: 'Only the creator can cancel' });
    if (game.status !== 'waiting')
      return res.status(400).json({ message: 'Cannot cancel — game already has a joiner' });

    game.status = 'cancelled';
    game.cancelReason = 'creator';

    // Refund
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { balance: game.bet } },
      { new: true }
    );

    setTimeout(() => lobby.delete(gameId), 10000);

    res.json({ gameId, status: 'cancelled', balance: user.balance });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;