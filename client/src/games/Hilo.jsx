import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

const API_URL = 'http://localhost:5002';

// ── Helpers ───────────────────────────────────────────────────────────────────
const generateClientSeed = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

const getSuitColor = (suit) =>
  suit === '♥' || suit === '♦' ? 'text-red-500' : 'text-gray-900';

const getValueLabel = (value) => value; // A, 2-10, J, Q, K as-is

// ── Card component ────────────────────────────────────────────────────────────
const PlayingCard = ({ card, size = 'md', revealed = true, prevResult = null }) => {
  const sizeCls = size === 'lg'
    ? 'w-28 h-40 text-4xl'
    : size === 'sm'
    ? 'w-14 h-20 text-xl'
    : 'w-20 h-28 text-2xl';

  if (!revealed) {
    return (
      <div className={`${sizeCls} rounded-2xl bg-blue-900 border-2 border-blue-700 flex items-center justify-center shadow-xl`}>
        <span className="text-blue-500 text-3xl select-none">?</span>
      </div>
    );
  }

  const borderColor =
    prevResult === 'win'  ? 'border-craft-green shadow-craft-green/30' :
    prevResult === 'loss' ? 'border-red-500 shadow-red-500/30'         :
                            'border-gray-300 shadow-black/20';

  return (
    <motion.div
      initial={{ rotateY: 90, scale: 0.8 }}
      animate={{ rotateY: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={`${sizeCls} rounded-2xl bg-white border-2 ${borderColor} flex flex-col items-center justify-center shadow-xl select-none`}
    >
      <span className={`font-black leading-none ${getSuitColor(card.suit)}`}>
        {getValueLabel(card.value)}
      </span>
      <span className={`text-3xl leading-none mt-1 ${getSuitColor(card.suit)}`}>
        {card.suit}
      </span>
    </motion.div>
  );
};

// ── Odds bar component ────────────────────────────────────────────────────────
const OddsBar = ({ higherChance, lowerChance }) => (
  <div className="w-full mt-3">
    <div className="flex rounded-full overflow-hidden h-2">
      <div
        className="bg-blue-500 transition-all duration-500"
        style={{ width: `${lowerChance}%` }}
      />
      <div className="bg-gray-600 w-px shrink-0" />
      <div
        className="bg-orange-400 transition-all duration-500"
        style={{ width: `${higherChance}%` }}
      />
    </div>
    <div className="flex justify-between text-xs mt-1">
      <span className="text-blue-400">{lowerChance}% lower</span>
      <span className="text-orange-400">{higherChance}% higher</span>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────

const HiLo = () => {
  const { user, updateBalance } = useAuth();

  const [bet, setBet]       = useState(100);
  const [loading, setLoading] = useState(false);

  // Provably fair
  const [clientSeed, setClientSeed]                 = useState(generateClientSeed);
  const [serverSeedHash, setServerSeedHash]         = useState(null);
  const [revealedServerSeed, setRevealedServerSeed] = useState(null);
  const [revealedNonce, setRevealedNonce]           = useState(null);
  const [nextServerSeedHash, setNextServerSeedHash] = useState(null);
  const [showFairPanel, setShowFairPanel]           = useState(false);
  const [verifyResult, setVerifyResult]             = useState(null);
  const [gameHistory, setGameHistory]               = useState(null); // full history on end

  // Game state
  const [gameId, setGameId]             = useState(null);
  const [gameState, setGameState]       = useState('betting');
  const [currentCard, setCurrentCard]   = useState(null);
  const [previousCard, setPreviousCard] = useState(null);
  const [lastResult, setLastResult]     = useState(null); // 'win' | 'loss'
  const [roundsWon, setRoundsWon]       = useState(0);
  const [multiplier, setMultiplier]     = useState(1.00);
  const [payout, setPayout]             = useState(0);
  const [profit, setProfit]             = useState(0);
  const [higherChance, setHigherChance] = useState(null);
  const [lowerChance, setLowerChance]   = useState(null);
  const [history, setHistory]           = useState([]); // session summary

  // ── Start game ──────────────────────────────────────────────────────────────
  const startGame = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setRevealedServerSeed(null);
    setVerifyResult(null);
    setGameHistory(null);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/hilo/start`,
        { bet, clientSeed },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGameId(data.gameId);
      setServerSeedHash(data.serverSeedHash);
      setRevealedNonce(data.nonce);
      setNextServerSeedHash(data.nextServerSeedHash);
      setCurrentCard(data.currentCard);
      setPreviousCard(null);
      setLastResult(null);
      setRoundsWon(0);
      setMultiplier(1.00);
      setPayout(bet);
      setProfit(0);
      setHigherChance(data.higherChance);
      setLowerChance(data.lowerChance);
      setGameState('playing');
      updateBalance(data.balance);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to start game');
    } finally {
      setLoading(false);
    }
  }, [bet, clientSeed, loading, updateBalance]);

  // ── Make a guess ────────────────────────────────────────────────────────────
  const makeGuess = useCallback(async (guess) => {
    if (loading || gameState !== 'playing') return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/hilo/guess`,
        { gameId, guess },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setPreviousCard(currentCard);
      setLastResult(data.result);
      setCurrentCard(data.drawnCard);

      if (data.result === 'loss') {
        setGameState('lost');
        setMultiplier(0);
        setHigherChance(null);
        setLowerChance(null);
        setRevealedServerSeed(data.serverSeed);
        setRevealedNonce(data.nonce);
        setNextServerSeedHash(data.nextServerSeedHash);
        setGameHistory(data.history);
        setHistory(h => [{ type: 'loss', amount: bet, rounds: data.roundsWon }, ...h].slice(0, 10));
      } else {
        setRoundsWon(data.roundsWon);
        setMultiplier(data.multiplier);
        setPayout(data.potentialPayout);
        setHigherChance(data.higherChance);
        setLowerChance(data.lowerChance);
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Guess failed');
    } finally {
      setLoading(false);
    }
  }, [loading, gameState, gameId, currentCard, bet]);

  // ── Cashout ─────────────────────────────────────────────────────────────────
  const cashout = useCallback(async () => {
    if (loading || gameState !== 'playing' || roundsWon === 0) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/hilo/cashout`,
        { gameId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGameState('won');
      setProfit(data.profit);
      setPayout(data.payout);
      setMultiplier(data.multiplier);
      setHigherChance(null);
      setLowerChance(null);
      setRevealedServerSeed(data.serverSeed);
      setRevealedNonce(data.nonce);
      setNextServerSeedHash(data.nextServerSeedHash);
      setGameHistory(data.history);
      updateBalance(data.balance);
      setHistory(h => [{ type: 'win', amount: data.profit, rounds: data.roundsWon }, ...h].slice(0, 10));
    } catch (err) {
      alert(err.response?.data?.message || 'Cashout failed');
    } finally {
      setLoading(false);
    }
  }, [loading, gameState, roundsWon, gameId, updateBalance]);

  // ── In-browser verifier ──────────────────────────────────────────────────────
  const runVerifier = async () => {
    if (!revealedServerSeed || !gameHistory) return;
    setVerifyResult({ status: 'running' });
    try {
      const encoder     = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw', encoder.encode(revealedServerSeed),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );

      const VALUES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
      const SUITS  = ['♠','♥','♦','♣'];

      const deriveCard = async (round, counter) => {
        const msg    = encoder.encode(`${clientSeed}:${revealedNonce}:${round}:${counter}`);
        const sigBuf = await crypto.subtle.sign('HMAC', keyMaterial, msg);
        const bytes  = new Uint8Array(sigBuf);
        const val    = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
        const idx    = val % 52;
        return { value: VALUES[idx % 13], suit: SUITS[Math.floor(idx / 13)], numericValue: (idx % 13) + 1 };
      };

      const results = [];
      for (const entry of gameHistory) {
        let counter = 0;
        let card    = await deriveCard(entry.round, counter);
        // Simulate push redraws
        const prevEntry = gameHistory[gameHistory.indexOf(entry) - 1];
        const prevValue = prevEntry?.card?.numericValue ?? null;
        if (prevValue !== null) {
          while (card.numericValue === prevValue && counter < 20) {
            counter++;
            card = await deriveCard(entry.round, counter);
          }
        }
        const match = card.value === entry.card.value && card.suit === entry.card.suit;
        results.push({ round: entry.round, derived: `${card.value}${card.suit}`, recorded: `${entry.card.value}${entry.card.suit}`, match });
      }

      const allMatch = results.every(r => r.match);
      setVerifyResult({ status: allMatch ? 'pass' : 'fail', results });
    } catch (e) {
      setVerifyResult({ status: 'error', message: e.message });
    }
  };

  // ── Reset ───────────────────────────────────────────────────────────────────
  const reset = () => {
    setGameId(null);
    setGameState('betting');
    setCurrentCard(null);
    setPreviousCard(null);
    setLastResult(null);
    setRoundsWon(0);
    setMultiplier(1.00);
    setPayout(0);
    setProfit(0);
    setHigherChance(null);
    setLowerChance(null);
    setClientSeed(generateClientSeed());
    setServerSeedHash(null);
    setRevealedServerSeed(null);
    setRevealedNonce(null);
    setNextServerSeedHash(null);
    setVerifyResult(null);
    setGameHistory(null);
  };

  const canCashout = gameState === 'playing' && roundsWon > 0 && payout > bet;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="pt-24 px-4 max-w-4xl mx-auto pb-12">
      <h1 className="text-3xl font-bold mb-8 text-center">
        <span className="text-orange-400">Hi</span>
        <span className="text-white">-</span>
        <span className="text-blue-400">Lo</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">

        {/* ── Left: Game area ─────────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6">

          {/* Multiplier bar */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm">Multiplier</span>
              <motion.span
                key={multiplier}
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                className="text-2xl font-bold tabular-nums"
                style={{ color: gameState === 'lost' ? '#ef4444' : '#00ff88' }}
              >
                {gameState === 'lost' ? '0.00' : multiplier.toFixed(2)}×
              </motion.span>
            </div>

            {gameState === 'playing' && roundsWon > 0 && (
              <div className="text-sm">
                <span className="text-gray-500">Payout </span>
                <span className="text-craft-green font-bold">{payout.toLocaleString()} WL</span>
              </div>
            )}

            {gameState === 'playing' && (
              <div className="text-sm text-gray-400">
                Round <span className="text-white font-bold">{roundsWon + 1}</span>
              </div>
            )}
          </div>

          {/* Card display area */}
          <div className="flex items-center justify-center gap-8 mb-8 min-h-44">
            {/* Previous card */}
            <div className="flex flex-col items-center gap-2">
              {previousCard ? (
                <>
                  <PlayingCard card={previousCard} size="md" prevResult={lastResult} />
                  <span className={`text-xs font-semibold ${lastResult === 'win' ? 'text-craft-green' : 'text-red-400'}`}>
                    {lastResult === 'win' ? '✓ Correct' : '✗ Wrong'}
                  </span>
                </>
              ) : (
                <div className="w-20 h-28 rounded-2xl border-2 border-dashed border-white/10 flex items-center justify-center">
                  <span className="text-gray-700 text-xs">prev</span>
                </div>
              )}
            </div>

            {/* Arrow */}
            <div className="text-gray-600 text-2xl">→</div>

            {/* Current card */}
            <div className="flex flex-col items-center gap-2">
              {currentCard ? (
                <>
                  <PlayingCard card={currentCard} size="lg" prevResult={null} />
                  <span className="text-xs text-gray-400">Current</span>
                </>
              ) : (
                <div className="w-28 h-40 rounded-2xl border-2 border-dashed border-white/10 flex items-center justify-center">
                  <span className="text-gray-600 text-sm">card</span>
                </div>
              )}
            </div>
          </div>

          {/* Odds bar */}
          {gameState === 'playing' && higherChance !== null && (
            <OddsBar higherChance={higherChance} lowerChance={lowerChance} />
          )}

          {/* Result banner */}
          <AnimatePresence>
            {(gameState === 'won' || gameState === 'lost') && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={`mt-5 p-4 rounded-xl text-center border ${
                  gameState === 'won'
                    ? 'bg-craft-green/15 border-craft-green'
                    : 'bg-red-500/15 border-red-500'
                }`}
              >
                {gameState === 'won' ? (
                  <>
                    <p className="text-craft-green font-bold text-xl">💰 Cashed Out!</p>
                    <p className="text-craft-green text-3xl font-bold mt-1">+{profit.toLocaleString()} WL</p>
                    <p className="text-gray-400 text-sm mt-1">
                      {multiplier.toFixed(2)}× · {roundsWon} correct guess{roundsWon !== 1 ? 'es' : ''}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-red-400 font-bold text-xl">Wrong guess!</p>
                    <p className="text-gray-400 text-sm mt-1">
                      −{bet.toLocaleString()} WL · {roundsWon} correct guess{roundsWon !== 1 ? 'es' : ''}
                    </p>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons — playing phase */}
          {gameState === 'playing' && (
            <div className="flex gap-3 mt-6 flex-wrap">
              <motion.button
                onClick={() => makeGuess('lower')}
                disabled={loading}
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                className="flex-1 py-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg transition-colors disabled:opacity-50 shadow-lg shadow-blue-500/20"
              >
                ↓ Lower
                {lowerChance !== null && (
                  <span className="block text-xs font-normal opacity-70 mt-0.5">{lowerChance}% · {(1 / (lowerChance / 100) * 0.97).toFixed(2)}×</span>
                )}
              </motion.button>

              <motion.button
                onClick={() => makeGuess('higher')}
                disabled={loading}
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                className="flex-1 py-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg transition-colors disabled:opacity-50 shadow-lg shadow-orange-500/20"
              >
                ↑ Higher
                {higherChance !== null && (
                  <span className="block text-xs font-normal opacity-70 mt-0.5">{higherChance}% · {(1 / (higherChance / 100) * 0.97).toFixed(2)}×</span>
                )}
              </motion.button>
            </div>
          )}

          {/* Cashout button */}
          {gameState === 'playing' && (
            <button
              onClick={cashout}
              disabled={loading || !canCashout}
              className="w-full mt-3 py-3 rounded-xl font-bold transition-all disabled:cursor-not-allowed shadow-lg"
              style={{
                background: canCashout ? 'linear-gradient(135deg, #00ff88, #00cc6a)' : undefined,
                backgroundColor: !canCashout ? '#1a1f1a' : undefined,
                color: canCashout ? '#0a0f0a' : '#6b7280',
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? 'Processing…'
                : roundsWon === 0 ? 'Win a round to cashout'
                : !canCashout ? 'Keep going for profit'
                : `💰 Cashout ${payout.toLocaleString()} WL`}
            </button>
          )}

          {/* Play again */}
          {(gameState === 'won' || gameState === 'lost') && (
            <button onClick={reset} disabled={loading}
              className="w-full mt-4 py-3 rounded-xl bg-craft-green text-craft-dark font-bold text-lg hover:bg-craft-greenDark transition-colors disabled:opacity-50 shadow-lg shadow-craft-green/20">
              Play Again
            </button>
          )}

          {/* Provably fair panel */}
          {serverSeedHash && (
            <div className="mt-5">
              <button onClick={() => setShowFairPanel(f => !f)}
                className="text-xs text-gray-500 hover:text-craft-green transition-colors flex items-center gap-1">
                🔐 Provably Fair {showFairPanel ? '▲' : '▼'}
              </button>
              <AnimatePresence>
                {showFairPanel && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 p-4 rounded-xl bg-black/30 border border-white/10 space-y-3 text-xs font-mono">
                      <div>
                        <p className="text-gray-500 mb-1">Server Seed Hash</p>
                        <p className="text-gray-300 break-all">{serverSeedHash}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 mb-1">Client Seed</p>
                        <p className="text-craft-green break-all">{clientSeed}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 mb-1">Nonce</p>
                        <p className="text-gray-300 break-all">{revealedNonce}</p>
                      </div>
                      {nextServerSeedHash && (
                        <div>
                          <p className="text-gray-500 mb-1">Next Game Server Seed Hash</p>
                          <p className="text-blue-400 break-all">{nextServerSeedHash}</p>
                        </div>
                      )}
                      {revealedServerSeed ? (
                        <>
                          <div>
                            <p className="text-gray-500 mb-1">Server Seed (revealed)</p>
                            <p className="text-yellow-400 break-all">{revealedServerSeed}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-gray-500 space-y-1 leading-relaxed font-sans text-xs">
                            <p className="text-gray-400 font-semibold mb-1">To verify:</p>
                            <p>1. SHA256(serverSeed) must equal the hash above.</p>
                            <p>2. Each card derived via:</p>
                            <p className="pl-3 font-mono text-gray-400">HMAC-SHA256(serverSeed, "{clientSeed}:{revealedNonce}:round:counter")</p>
                            <p>3. cardIndex = uint32BE % 52 · value = (index % 13) + 1 · Ace=1</p>
                            <p>4. Push (equal card): increment counter, redraw same round.</p>
                          </div>
                          <button
                            onClick={runVerifier}
                            disabled={!gameHistory || verifyResult?.status === 'running'}
                            className="w-full py-2 rounded-lg bg-craft-green/20 border border-craft-green/40 text-craft-green text-xs font-sans font-semibold hover:bg-craft-green/30 transition-colors disabled:opacity-40"
                          >
                            {verifyResult?.status === 'running' ? 'Verifying…' : '🔍 Verify This Game'}
                          </button>
                          {verifyResult && verifyResult.status !== 'running' && (
                            <div className={`p-3 rounded-lg border font-sans ${
                              verifyResult.status === 'pass' ? 'bg-craft-green/10 border-craft-green/40 text-craft-green' :
                              verifyResult.status === 'fail' ? 'bg-red-500/10 border-red-500/40 text-red-400' :
                                                               'bg-gray-500/10 border-gray-500/40 text-gray-400'
                            }`}>
                              {verifyResult.status === 'pass' && <p className="font-bold mb-2">✓ All cards verified — game was fair</p>}
                              {verifyResult.status === 'fail' && <p className="font-bold mb-2">✗ Mismatch detected</p>}
                              {verifyResult.status === 'error' && <p>Error: {verifyResult.message}</p>}
                              {verifyResult.results && (
                                <div className="space-y-1 text-xs font-mono mt-1">
                                  {verifyResult.results.map((r, i) => (
                                    <div key={i} className={r.match ? 'text-gray-400' : 'text-red-400'}>
                                      Round {r.round}: derived {r.derived} · recorded {r.recorded} {r.match ? '✓' : '✗'}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-gray-600 font-sans">Server seed revealed after game ends.</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* ── Right: Controls ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Bet */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">Bet Amount</h3>
            <div className="flex items-center gap-3 mb-3">
              <button onClick={() => setBet(b => Math.max(10, b - 10))} disabled={gameState === 'playing'}
                className="w-10 h-10 rounded-lg bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold text-lg transition-colors disabled:opacity-40">−</button>
              <div className="flex-1 text-center text-2xl font-bold text-craft-green tabular-nums">{bet.toLocaleString()}</div>
              <button onClick={() => setBet(b => Math.min(user?.balance || 0, b + 10))} disabled={gameState === 'playing'}
                className="w-10 h-10 rounded-lg bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold text-lg transition-colors disabled:opacity-40">+</button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[10, 50, 100, 500, 1000].map(a => (
                <button key={a} onClick={() => setBet(a)} disabled={gameState === 'playing' || a > (user?.balance || 0)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${bet === a ? 'bg-craft-green text-craft-dark' : 'bg-craft-gray text-gray-400 hover:text-white'}`}>
                  {a}
                </button>
              ))}
              <button onClick={() => setBet(user?.balance || 0)} disabled={gameState === 'playing'}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-craft-gray text-gray-400 hover:text-craft-green transition-colors disabled:opacity-40">Max</button>
            </div>
          </div>

          {/* Client seed */}
          {gameState === 'betting' && (
            <div className="glass rounded-2xl p-5">
              <h3 className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wider">🔐 Client Seed</h3>
              <div className="flex gap-2">
                <input type="text" value={clientSeed} onChange={e => setClientSeed(e.target.value.slice(0, 64))}
                  className="flex-1 bg-craft-gray border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-craft-green transition-colors" />
                <button onClick={() => setClientSeed(generateClientSeed())}
                  className="px-3 py-2 rounded-lg bg-craft-gray text-gray-400 hover:text-craft-green text-xs border border-white/10 transition-colors">↺</button>
              </div>
            </div>
          )}

          {/* Live stats */}
          {gameState === 'playing' && (
            <div className="glass rounded-2xl p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Streak</div>
                  <div className="text-craft-green font-bold text-xl">{roundsWon}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Multiplier</div>
                  <div className="text-craft-green font-bold text-xl">{multiplier.toFixed(2)}×</div>
                </div>
                <div className="text-center col-span-2">
                  <div className="text-xs text-gray-500 mb-1">Potential Payout</div>
                  <div className="text-craft-green font-bold text-lg">{payout.toLocaleString()} WL</div>
                </div>
              </div>
            </div>
          )}

          {/* Start button */}
          {gameState === 'betting' && (
            <button onClick={startGame}
              disabled={loading || bet > (user?.balance || 0) || bet < 1}
              className="w-full py-4 rounded-xl bg-craft-green text-craft-dark font-bold text-lg hover:bg-craft-greenDark transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-craft-green/20">
              {loading ? 'Dealing…' : 'Deal Card'}
            </button>
          )}

          {/* Session history */}
          {history.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">History</h3>
              <div className="flex flex-col gap-1.5">
                {history.map((h, i) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${h.type === 'win' ? 'bg-craft-green/10 text-craft-green' : 'bg-red-500/10 text-red-400'}`}>
                    <span>{h.type === 'win' ? '💰' : '💔'} {h.rounds} guess{h.rounds !== 1 ? 'es' : ''}</span>
                    <span className="font-bold">{h.type === 'win' ? '+' : '−'}{Math.abs(h.amount).toLocaleString()} WL</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HiLo;