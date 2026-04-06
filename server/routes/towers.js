import express from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();
const activeGames = new Map();

// ── Difficulty config ─────────────────────────────────────────────────────────
const DIFFICULTIES = {
  easy:    { rows: 12, tiles: 4, safe: 3 },
  medium:  { rows: 12, tiles: 3, safe: 2 },
  hard:    { rows: 12, tiles: 2, safe: 1 },
  extreme: { rows: 12, tiles: 3, safe: 1 },
};

// ── Provably fair ─────────────────────────────────────────────────────────────
const hashSeed = (seed) =>
  crypto.createHash('sha256').update(seed).digest('hex');

/**
 * Derive safe tile indices for a single row.
 * HMAC input: "clientSeed:nonce:row:counter"
 * Returns a Set of safe tile indices (0-based).
 */
const deriveSafeTiles = (serverSeed, clientSeed, nonce, row, tiles, safe) => {
  const positions = new Set();
  let counter = 0;
  while (positions.size < safe) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}:${row}:${counter}`);
    const bytes = hmac.digest();
    for (let i = 0; i + 4 <= bytes.length && positions.size < safe; i += 4) {
      positions.add(bytes.readUInt32BE(i) % tiles);
    }
    counter++;
  }
  return positions;
};

/**
 * Derive the full tower layout upfront.
 * Returns an array of Sets, index 0 = bottom row.
 */
const deriveTower = (serverSeed, clientSeed, nonce, rows, tiles, safe) => {
  return Array.from({ length: rows }, (_, row) =>
    deriveSafeTiles(serverSeed, clientSeed, nonce, row, tiles, safe)
  );
};

// ── Multiplier — probability-based, 97% RTP ───────────────────────────────────
// Survival probability after `rowsCleared` rows = (safe/tiles)^rowsCleared
// Multiplier = (1 / survivalProbability) * 0.97
const calculateMultiplier = (safe, tiles, rowsCleared) => {
  if (rowsCleared === 0) return 1.00;
  const survivalProb = Math.pow(safe / tiles, rowsCleared);
  return parseFloat(((1 / survivalProb) * 0.97).toFixed(4));
};

// ── Per-row click odds ─────────────────────────────────────────────────────────
const getRowOdds = (safe, tiles) => ({
  safeChance: parseFloat(((safe / tiles) * 100).toFixed(1)),
  mineChance: parseFloat((((tiles - safe) / tiles) * 100).toFixed(1)),
});

// ── POST /api/towers/start ────────────────────────────────────────────────────
router.post('/start', authenticate, async (req, res) => {
  try {
    const { bet, difficulty = 'medium', clientSeed } = req.body;
    const userId = req.user.userId;

    if (!bet || bet < 1 || bet > 100000)
      return res.status(400).json({ message: 'Invalid bet (1–100000)' });
    if (!DIFFICULTIES[difficulty])
      return res.status(400).json({ message: 'Invalid difficulty' });
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

    const { rows, tiles, safe } = DIFFICULTIES[difficulty];
    const serverSeed     = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = hashSeed(serverSeed);
    const nonce          = Date.now();

    // Derive full tower layout server-side (SECRET until game ends)
    const tower = deriveTower(serverSeed, clientSeed, nonce, rows, tiles, safe);

    const gameId = crypto.randomUUID();
    activeGames.set(gameId, {
      gameId, userId, bet, difficulty,
      rows, tiles, safe,
      serverSeed, clientSeed, nonce, serverSeedHash,
      tower,           // array of Sets — never sent to client
      currentRow: 0,
      rowsCleared: 0,
      revealed: [],    // [{ row, tileIndex, safe }]
      gameState: 'playing',
      createdAt: Date.now(),
    });

    setTimeout(() => activeGames.delete(gameId), 30 * 60 * 1000);

    const odds = getRowOdds(safe, tiles);

    res.json({
      gameId, difficulty, rows, tiles, safe,
      serverSeedHash, clientSeed, nonce,
      currentRow: 0,
      rowsCleared: 0,
      multiplier: 1.00,
      potentialPayout: bet,
      gameState: 'playing',
      balance: user.balance,
      safeChance: odds.safeChance,
      mineChance: odds.mineChance,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/towers/place ────────────────────────────────────────────────────
router.post('/place', authenticate, async (req, res) => {
  try {
    const { gameId, tileIndex } = req.body;
    const userId = req.user.userId;

    const game = activeGames.get(gameId);
    if (!game)                        return res.status(400).json({ message: 'No active game' });
    if (game.userId !== userId)       return res.status(403).json({ message: 'Not your game' });
    if (game.gameState !== 'playing') return res.status(400).json({ message: 'Game already ended' });

    // Anti-abuse: validate tile index
    if (tileIndex < 0 || tileIndex >= game.tiles)
      return res.status(400).json({ message: 'Invalid tile index' });

    // Anti-abuse: cannot click a row already played
    const alreadyPlayed = game.revealed.some(r => r.row === game.currentRow);
    if (alreadyPlayed)
      return res.status(400).json({ message: 'Row already played' });

    const currentRowSafe = game.tower[game.currentRow];
    const isSafe = currentRowSafe.has(tileIndex);

    // Record the click
    game.revealed.push({ row: game.currentRow, tileIndex, safe: isSafe });

    if (!isSafe) {
      // ── Hit a bomb — game over ──────────────────────────────────────────
      game.gameState = 'lost';
      activeGames.set(gameId, game);
      setTimeout(() => activeGames.delete(gameId), 10000);

      // Reveal the full tower layout
      const towerRevealed = game.tower.map(rowSet => [...rowSet]);

      return res.json({
        gameState: 'lost',
        isSafe: false,
        tileIndex,
        row: game.currentRow,
        towerRevealed,
        revealed: game.revealed,
        payout: 0,
        serverSeed: game.serverSeed,
        clientSeed: game.clientSeed,
        nonce: game.nonce,
      });
    }

    // ── Safe tile — advance ────────────────────────────────────────────────
    game.currentRow++;
    game.rowsCleared++;

    const multiplier     = calculateMultiplier(game.safe, game.tiles, game.rowsCleared);
    const potentialPayout = Math.round(game.bet * multiplier);
    const odds           = getRowOdds(game.safe, game.tiles);

    // ── Auto win — reached the top ─────────────────────────────────────────
    if (game.currentRow >= game.rows) {
      game.gameState = 'won';
      const user = await User.findByIdAndUpdate(
        userId, { $inc: { balance: potentialPayout } }, { new: true }
      );
      activeGames.delete(gameId);

      const towerRevealed = game.tower.map(rowSet => [...rowSet]);

      return res.json({
        gameState: 'won',
        isSafe: true,
        tileIndex,
        row: game.rowsCleared - 1,
        currentRow: game.currentRow,
        rowsCleared: game.rowsCleared,
        multiplier,
        payout: potentialPayout,
        profit: potentialPayout - game.bet,
        balance: user.balance,
        towerRevealed,
        revealed: game.revealed,
        serverSeed: game.serverSeed,
        clientSeed: game.clientSeed,
        nonce: game.nonce,
      });
    }

    activeGames.set(gameId, game);

    res.json({
      gameState: 'playing',
      isSafe: true,
      tileIndex,
      row: game.rowsCleared - 1,
      currentRow: game.currentRow,
      rowsCleared: game.rowsCleared,
      multiplier,
      potentialPayout,
      safeChance: odds.safeChance,
      mineChance: odds.mineChance,
      revealed: game.revealed,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/towers/cashout ──────────────────────────────────────────────────
router.post('/cashout', authenticate, async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.userId;

    const game = activeGames.get(gameId);
    if (!game)                        return res.status(400).json({ message: 'No active game' });
    if (game.userId !== userId)       return res.status(403).json({ message: 'Not your game' });
    if (game.gameState !== 'playing') return res.status(400).json({ message: 'Game already ended' });
    if (game.rowsCleared === 0)
      return res.status(400).json({ message: 'Clear at least one row before cashing out' });

    const multiplier = calculateMultiplier(game.safe, game.tiles, game.rowsCleared);
    const payout     = Math.round(game.bet * multiplier);

    // Cashout rule: payout must be > bet (profit ≥ 1 WL)
    if (payout <= game.bet)
      return res.status(400).json({ message: 'Payout would not exceed your bet — keep climbing!' });

    game.gameState = 'won';
    activeGames.delete(gameId);

    const user = await User.findByIdAndUpdate(
      userId, { $inc: { balance: payout } }, { new: true }
    );

    const towerRevealed = game.tower.map(rowSet => [...rowSet]);

    res.json({
      gameState: 'won',
      rowsCleared: game.rowsCleared,
      multiplier,
      payout,
      profit: payout - game.bet,
      balance: user.balance,
      towerRevealed,
      revealed: game.revealed,
      serverSeed: game.serverSeed,
      clientSeed: game.clientSeed,
      nonce: game.nonce,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;