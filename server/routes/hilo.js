import express from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();
const activeGames = new Map();

// ── Card system ───────────────────────────────────────────────────────────────
// Ace = 1 (lowest), 2–10, J=11, Q=12, K=13
// Infinite deck — suits are cosmetic only, value is all that matters for logic
const SUITS  = ['♠', '♥', '♦', '♣'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// cardIndex 0–51: index % 13 = value index, index % 4 = suit index
const TOTAL_CARDS = 52;

const cardFromIndex = (idx) => ({
  value: VALUES[idx % 13],
  suit:  SUITS[Math.floor(idx / 13)],
  numericValue: (idx % 13) + 1, // A=1 … K=13
});

// ── Provably fair ─────────────────────────────────────────────────────────────
const hashSeed = (seed) =>
  crypto.createHash('sha256').update(seed).digest('hex');

/**
 * Derive a card for a given round from seeds.
 * HMAC input: "clientSeed:nonce:round:counter"
 * counter handles push re-draws within the same round.
 */
const deriveCard = (serverSeed, clientSeed, nonce, round, counter = 0) => {
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(`${clientSeed}:${nonce}:${round}:${counter}`);
  const bytes = hmac.digest();
  const idx   = bytes.readUInt32BE(0) % TOTAL_CARDS;
  return { ...cardFromIndex(idx), cardIndex: idx };
};

// ── Probability & multiplier ──────────────────────────────────────────────────
/**
 * For an infinite deck and a current card value (1–13):
 *   higher: cards with value > current  → (13 - current) ranks × 4 cards
 *   lower:  cards with value < current  → (current - 1)  ranks × 4 cards
 *   equal:  4 cards — treated as push, not a win or loss
 *
 * Win probability = higher or lower count / (52 - equal count)
 * We exclude equal cards from the denominator because equal = push (redraw).
 */
const getOdds = (currentValue, guess) => {
  const higherCount = (13 - currentValue) * 4;
  const lowerCount  = (currentValue - 1)  * 4;
  const equalCount  = 4;
  const playableCards = TOTAL_CARDS - equalCount; // 48

  const winCount = guess === 'higher' ? higherCount : lowerCount;
  const winChance = winCount / playableCards; // excludes equal from denominator

  return {
    winChance: parseFloat((winChance * 100).toFixed(1)),
    loseChance: parseFloat(((1 - winChance) * 100).toFixed(1)),
    winCount,
    loseCount: playableCards - winCount,
  };
};

/**
 * Cumulative multiplier after `roundsWon` correct guesses.
 * Each round multiplies by (1 / winChance) * 0.97.
 * We track the running product so each guess compounds correctly.
 */
const calculateMultiplier = (roundMultipliers) => {
  if (!roundMultipliers.length) return 1.00;
  const product = roundMultipliers.reduce((acc, m) => acc * m, 1);
  return parseFloat(product.toFixed(4));
};

// ── POST /api/hilo/start ──────────────────────────────────────────────────────
router.post('/start', authenticate, async (req, res) => {
  try {
    const { bet, clientSeed } = req.body;
    const userId = req.user.userId;

    if (!bet || bet < 1 || bet > 100000)
      return res.status(400).json({ message: 'Invalid bet (1–100000)' });
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

    const serverSeed         = crypto.randomBytes(32).toString('hex');
    const serverSeedHash     = hashSeed(serverSeed);
    const nonce              = crypto.randomBytes(16).toString('hex');
    const nextServerSeed     = crypto.randomBytes(32).toString('hex');
    const nextServerSeedHash = hashSeed(nextServerSeed);

    // Draw the first card (round 0, counter 0)
    const firstCard = deriveCard(serverSeed, clientSeed, nonce, 0, 0);

    const gameId = crypto.randomUUID();
    activeGames.set(gameId, {
      gameId, userId, bet,
      serverSeed, clientSeed, nonce, serverSeedHash,
      nextServerSeed, nextServerSeedHash,
      currentCard: firstCard,
      round: 0,          // increments on each non-push draw
      pushCounter: 0,    // counter within a round for push redraws
      roundsWon: 0,
      roundMultipliers: [], // per-round multiplier factors
      history: [],          // [{ round, card, guess, result, multiplier }]
      gameState: 'playing',
      createdAt: Date.now(),
    });

    setTimeout(() => activeGames.delete(gameId), 30 * 60 * 1000);

    // Pre-compute odds for first card (no guess yet — show both options)
    const higherOdds = getOdds(firstCard.numericValue, 'higher');
    const lowerOdds  = getOdds(firstCard.numericValue, 'lower');

    res.json({
      gameId,
      serverSeedHash, clientSeed, nonce, nextServerSeedHash,
      currentCard: { value: firstCard.value, suit: firstCard.suit, numericValue: firstCard.numericValue },
      round: 0,
      roundsWon: 0,
      multiplier: 1.00,
      potentialPayout: bet,
      gameState: 'playing',
      balance: user.balance,
      higherChance: higherOdds.winChance,
      lowerChance:  lowerOdds.winChance,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/hilo/guess ──────────────────────────────────────────────────────
router.post('/guess', authenticate, async (req, res) => {
  try {
    const { gameId, guess } = req.body;
    const userId = req.user.userId;

    const game = activeGames.get(gameId);
    if (!game)                        return res.status(400).json({ message: 'No active game' });
    if (game.userId !== userId)       return res.status(403).json({ message: 'Not your game' });
    if (game.gameState !== 'playing') return res.status(400).json({ message: 'Game already ended' });
    if (!['higher', 'lower'].includes(guess))
      return res.status(400).json({ message: 'Guess must be "higher" or "lower"' });

    const currentValue = game.currentCard.numericValue;
    const odds         = getOdds(currentValue, guess);

    // Draw next card — use round+1 so each new card is unique
    let nextRound   = game.round + 1;
    let pushCounter = 0;
    let nextCard    = deriveCard(game.serverSeed, game.clientSeed, game.nonce, nextRound, pushCounter);

    // ── Equal = push: redraw until non-equal ──────────────────────────────────
    const MAX_REDRAWS = 20;
    while (nextCard.numericValue === currentValue && pushCounter < MAX_REDRAWS) {
      pushCounter++;
      nextCard = deriveCard(game.serverSeed, game.clientSeed, game.nonce, nextRound, pushCounter);
    }

    // Determine outcome
    const nextValue = nextCard.numericValue;
    let result;
    if (guess === 'higher') {
      result = nextValue > currentValue ? 'win' : 'loss';
    } else {
      result = nextValue < currentValue ? 'win' : 'loss';
    }

    // Per-round multiplier factor for this guess
    const roundFactor = parseFloat(((1 / (odds.winChance / 100)) * 0.97).toFixed(4));

    if (result === 'loss') {
      game.gameState = 'lost';
      game.history.push({
        round: nextRound, card: nextCard, guess, result,
        multiplier: calculateMultiplier(game.roundMultipliers),
      });
      activeGames.set(gameId, game);
      setTimeout(() => activeGames.delete(gameId), 10000);

      return res.json({
        gameState: 'lost',
        result: 'loss',
        guess,
        drawnCard: { value: nextCard.value, suit: nextCard.suit, numericValue: nextCard.numericValue },
        previousCard: { value: game.currentCard.value, suit: game.currentCard.suit, numericValue: currentValue },
        roundsWon: game.roundsWon,
        multiplier: 0,
        payout: 0,
        history: game.history,
        serverSeed: game.serverSeed,
        clientSeed: game.clientSeed,
        nonce: game.nonce,
        nextServerSeedHash: game.nextServerSeedHash,
      });
    }

    // ── Win — advance ─────────────────────────────────────────────────────────
    game.roundMultipliers.push(roundFactor);
    game.roundsWon++;
    game.round       = nextRound;
    game.pushCounter = pushCounter;
    game.currentCard = nextCard;

    const multiplier     = calculateMultiplier(game.roundMultipliers);
    const potentialPayout = Math.round(game.bet * multiplier);

    game.history.push({ round: nextRound, card: nextCard, guess, result: 'win', multiplier });
    activeGames.set(gameId, game);

    // Odds for next guess based on the NEW current card
    const newHigherOdds = getOdds(nextValue, 'higher');
    const newLowerOdds  = getOdds(nextValue, 'lower');

    res.json({
      gameState: 'playing',
      result: 'win',
      guess,
      drawnCard: { value: nextCard.value, suit: nextCard.suit, numericValue: nextValue },
      previousCard: { value: game.history[game.history.length - 2]?.card?.value, suit: game.history[game.history.length - 2]?.card?.suit },
      round: nextRound,
      roundsWon: game.roundsWon,
      multiplier,
      potentialPayout,
      higherChance: newHigherOdds.winChance,
      lowerChance:  newLowerOdds.winChance,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/hilo/cashout ────────────────────────────────────────────────────
router.post('/cashout', authenticate, async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.userId;

    const game = activeGames.get(gameId);
    if (!game)                        return res.status(400).json({ message: 'No active game' });
    if (game.userId !== userId)       return res.status(403).json({ message: 'Not your game' });
    if (game.gameState !== 'playing') return res.status(400).json({ message: 'Game already ended' });
    if (game.roundsWon === 0)
      return res.status(400).json({ message: 'Win at least one round before cashing out' });

    const multiplier = calculateMultiplier(game.roundMultipliers);
    const payout     = Math.round(game.bet * multiplier);

    if (payout <= game.bet)
      return res.status(400).json({ message: 'Payout would not exceed your bet — keep going!' });

    game.gameState = 'won';
    activeGames.delete(gameId);

    const user = await User.findByIdAndUpdate(
      userId, { $inc: { balance: payout } }, { new: true }
    );

    res.json({
      gameState: 'won',
      roundsWon: game.roundsWon,
      multiplier,
      payout,
      profit: payout - game.bet,
      balance: user.balance,
      history: game.history,
      serverSeed: game.serverSeed,
      clientSeed: game.clientSeed,
      nonce: game.nonce,
      nextServerSeedHash: game.nextServerSeedHash,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;