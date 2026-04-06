import express from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// In-memory game store
const activeGames = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1: PROVABLY FAIR SYSTEM (no first-click protection)
// Mines are generated at game start with no excluded tile
// ─────────────────────────────────────────────────────────────────────────────

const hashSeed = (seed) =>
  crypto.createHash('sha256').update(seed).digest('hex');

const deriveMinePositions = (serverSeed, clientSeed, nonce, totalTiles, mineCount) => {
  const positions = new Set();
  let counter = 0;
  while (positions.size < mineCount) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}:${counter}`);
    const bytes = hmac.digest();
    for (let i = 0; i + 4 <= bytes.length && positions.size < mineCount; i += 4) {
      const pos = bytes.readUInt32BE(i) % totalTiles;
      positions.add(pos);
    }
    counter++;
  }
  return positions;
};

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3: No Math.max(1.01, ...) clamp — raw math only
// ─────────────────────────────────────────────────────────────────────────────

const calculateMultiplier = (totalTiles, mineCount, tilesRevealed) => {
  if (tilesRevealed === 0) return 1.00;
  let probability = 1;
  for (let i = 0; i < tilesRevealed; i++) {
    probability *= (totalTiles - mineCount - i) / (totalTiles - i);
  }
  // 97% RTP, no artificial floor
  return parseFloat(((1 / probability) * 0.97).toFixed(4));
};

// FIX 4: Win probability per next click
const getClickOdds = (totalTiles, mineCount, tilesRevealed) => {
  const tilesLeft = totalTiles - tilesRevealed;
  const safeLeft  = tilesLeft - mineCount;
  const safeChance = parseFloat(((safeLeft / tilesLeft) * 100).toFixed(1));
  return { safeChance, mineChance: parseFloat((100 - safeChance).toFixed(1)) };
};

// ── POST /api/mines/start ─────────────────────────────────────────────────────
router.post('/start', authenticate, async (req, res) => {
  try {
    const { bet, mineCount, gridSize = 5, clientSeed } = req.body;
    const userId    = req.user.userId;
    const totalTiles = gridSize * gridSize;

    if (!bet || bet < 1 || bet > 100000)
      return res.status(400).json({ message: 'Invalid bet (1–100000)' });
    if (!mineCount || mineCount < 1 || mineCount > totalTiles - 1)
      return res.status(400).json({ message: `Mine count must be 1–${totalTiles - 1}` });
    if (![3, 4, 5, 6, 7].includes(gridSize))
      return res.status(400).json({ message: 'Invalid grid size' });
    if (!clientSeed || typeof clientSeed !== 'string' || clientSeed.length < 1)
      return res.status(400).json({ message: 'clientSeed is required' });
    if (clientSeed.length > 64)
      return res.status(400).json({ message: 'clientSeed must be 64 characters or fewer' });

    // Forfeit any existing game
    for (const [id, game] of activeGames) {
      if (game.userId === userId && game.gameState === 'playing') {
        activeGames.delete(id);
      }
    }

    const user = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: bet } },
      { $inc: { balance: -bet } },
      { new: true }
    );
    if (!user) return res.status(400).json({ message: 'Insufficient balance' });

    const serverSeed     = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = hashSeed(serverSeed);
    const nonce = Date.now();

    const gameId = crypto.randomUUID();

    const minePositions = deriveMinePositions(
      serverSeed,
      clientSeed,
      nonce,
      totalTiles,
      mineCount
    );

    activeGames.set(gameId, {
      gameId, userId, bet, mineCount, gridSize, totalTiles,
      serverSeed, clientSeed, nonce,
      minePositions,
      revealedTiles: new Set(),
      gameState: 'playing',
      createdAt: Date.now(),
    });

    setTimeout(() => activeGames.delete(gameId), 30 * 60 * 1000);

    const odds = getClickOdds(totalTiles, mineCount, 0);

    res.json({
      gameId, gridSize, totalTiles, mineCount, bet,
      serverSeedHash, clientSeed, nonce,
      multiplier: 1.00,
      potentialPayout: bet,
      tilesRevealed: 0,
      gameState: 'playing',
      balance: user.balance,
      safeChance: odds.safeChance,
      mineChance: odds.mineChance,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/mines/reveal ────────────────────────────────────────────────────
router.post('/reveal', authenticate, async (req, res) => {
  try {
    const { gameId, tileIndex } = req.body;
    const userId = req.user.userId;

    const game = activeGames.get(gameId);
    if (!game)                        return res.status(400).json({ message: 'No active game' });
    if (game.userId !== userId)       return res.status(403).json({ message: 'Not your game' });
    if (game.gameState !== 'playing') return res.status(400).json({ message: 'Game already ended' });
    if (tileIndex < 0 || tileIndex >= game.totalTiles)
      return res.status(400).json({ message: 'Invalid tile index' });
    if (game.revealedTiles.has(tileIndex))
      return res.status(400).json({ message: 'Tile already revealed' });

    const isMine = game.minePositions.has(tileIndex);

    if (isMine) {
      game.gameState = 'lost';
      activeGames.set(gameId, game);
      setTimeout(() => activeGames.delete(gameId), 10000);

      return res.json({
        gameState: 'lost', isMine: true, tileIndex,
        minePositions: [...game.minePositions],
        revealedTiles: [...game.revealedTiles],
        multiplier: 0, payout: 0,
        serverSeed: game.serverSeed,
        clientSeed: game.clientSeed,
        nonce: game.nonce,
      });
    }

    game.revealedTiles.add(tileIndex);
    const tilesRevealed  = game.revealedTiles.size;
    const safeTilesTotal = game.totalTiles - game.mineCount;
    const multiplier     = calculateMultiplier(game.totalTiles, game.mineCount, tilesRevealed);
    const potentialPayout = Math.round(game.bet * multiplier);

    if (tilesRevealed >= safeTilesTotal) {
      game.gameState = 'won';
      const user = await User.findByIdAndUpdate(
        userId, { $inc: { balance: potentialPayout } }, { new: true }
      );
      activeGames.delete(gameId);
      return res.json({
        gameState: 'won', isMine: false, tileIndex, tilesRevealed,
        minePositions: [...game.minePositions],
        revealedTiles: [...game.revealedTiles],
        multiplier, payout: potentialPayout,
        profit: potentialPayout - game.bet,
        balance: user.balance,
        serverSeed: game.serverSeed, clientSeed: game.clientSeed, nonce: game.nonce,
      });
    }

    activeGames.set(gameId, game);
    const odds = getClickOdds(game.totalTiles, game.mineCount, tilesRevealed);

    res.json({
      gameState: 'playing', isMine: false, tileIndex,
      tilesRevealed, revealedTiles: [...game.revealedTiles],
      multiplier, potentialPayout,
      safeChance: odds.safeChance, mineChance: odds.mineChance,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/mines/cashout ───────────────────────────────────────────────────
router.post('/cashout', authenticate, async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.userId;

    const game = activeGames.get(gameId);
    if (!game)                        return res.status(400).json({ message: 'No active game' });
    if (game.userId !== userId)       return res.status(403).json({ message: 'Not your game' });
    if (game.gameState !== 'playing') return res.status(400).json({ message: 'Game already ended' });

    const tilesRevealed = game.revealedTiles.size;
    const multiplier    = calculateMultiplier(game.totalTiles, game.mineCount, tilesRevealed);
    const rawPayout     = game.bet * multiplier;
    const payout        = Math.floor(rawPayout);

    // NEW: Enforce minimum cashout rules (backend is source of truth)
    if (tilesRevealed < 2 || multiplier < 1.05) {
      return res.status(400).json({
        message: 'Minimum cashout is 2 tiles and 1.05× multiplier'
      });
    }

    // NEW: Prevent zero-profit or loss cashouts (fixes bet=1 abuse)
    if (payout <= game.bet) {
      return res.status(400).json({
        message: 'Payout must be greater than bet'
      });
    }

    game.gameState = 'won';
    activeGames.delete(gameId);

    const user = await User.findByIdAndUpdate(
      userId, { $inc: { balance: payout } }, { new: true }
    );

    res.json({
      gameState: 'won', tilesRevealed,
      minePositions: [...game.minePositions],
      revealedTiles: [...game.revealedTiles],
      multiplier, payout, profit: payout - game.bet,
      balance: user.balance,
      serverSeed: game.serverSeed,
      clientSeed: game.clientSeed,
      nonce: game.nonce,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;