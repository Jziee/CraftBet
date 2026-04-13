import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

const API_URL = 'https://craftbet.onrender.com';

// ── Difficulty config (mirrors backend) ───────────────────────────────────────
const DIFFICULTIES = {
  easy:    { rows: 12, tiles: 4, safe: 3, label: 'Easy',    color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/50' },
  medium:  { rows: 12, tiles: 3, safe: 2, label: 'Medium',  color: 'text-yellow-400',  bg: 'bg-yellow-500/20  border-yellow-500/50'  },
  hard:    { rows: 12, tiles: 2, safe: 1, label: 'Hard',    color: 'text-orange-400',  bg: 'bg-orange-500/20  border-orange-500/50'  },
  extreme: { rows: 12, tiles: 3, safe: 1, label: 'Extreme', color: 'text-red-400',     bg: 'bg-red-500/20     border-red-500/50'     },
};

// ── Local multiplier preview (mirrors backend) ────────────────────────────────
const previewMultiplier = (safe, tiles, rowsCleared) => {
  if (rowsCleared === 0) return 1.00;
  const prob = Math.pow(safe / tiles, rowsCleared);
  return parseFloat(((1 / prob) * 0.97).toFixed(4));
};

// ── Generate random client seed ───────────────────────────────────────────────
const generateClientSeed = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

// ── Tile states ───────────────────────────────────────────────────────────────
const TILE_HIDDEN  = 'hidden';
const TILE_SAFE    = 'safe';
const TILE_BOMB    = 'bomb';
const TILE_GHOST   = 'ghost';   // revealed safe tiles after game ends
const TILE_CLEARED = 'cleared'; // rows the player already passed through

const Towers = () => {
  const { user, updateBalance } = useAuth();

  // Config
  const [bet, setBet]               = useState(100);
  const [difficulty, setDifficulty] = useState('medium');

  // Provably fair
  const [clientSeed, setClientSeed]                 = useState(generateClientSeed);
  const [serverSeedHash, setServerSeedHash]         = useState(null);
  const [revealedServerSeed, setRevealedServerSeed] = useState(null);
  const [revealedNonce, setRevealedNonce]           = useState(null);
  const [showFairPanel, setShowFairPanel]           = useState(false);

  // Game state
  const [gameId, setGameId]               = useState(null);
  const [gameState, setGameState]         = useState('betting');
  const [currentRow, setCurrentRow]       = useState(0);
  const [rowsCleared, setRowsCleared]     = useState(0);
  const [multiplier, setMultiplier]       = useState(1.00);
  const [payout, setPayout]               = useState(0);
  const [profit, setProfit]               = useState(0);
  const [safeChance, setSafeChance]       = useState(null);
  const [mineChance, setMineChance]       = useState(null);
  const [loading, setLoading]             = useState(false);
  const [history, setHistory]             = useState([]);

  // Board: rows × tiles grid of tile states
  // Index 0 = bottom row visually (displayed reversed)
  const [board, setBoard] = useState([]);

  // Track which tile the player clicked per row (for highlight)
  const [clickedTiles, setClickedTiles] = useState({});

  const cfg = DIFFICULTIES[difficulty];
  const ROWS  = cfg.rows;
  const TILES = cfg.tiles;

  // ── Start game ──────────────────────────────────────────────────────────────
  const startGame = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setRevealedServerSeed(null);
    setRevealedNonce(null);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/towers/start`,
        { bet, difficulty, clientSeed },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Build blank board: rows × tiles, all hidden
      setBoard(Array.from({ length: data.rows }, () => Array(data.tiles).fill(TILE_HIDDEN)));
      setClickedTiles({});
      setGameId(data.gameId);
      setServerSeedHash(data.serverSeedHash);
      setRevealedNonce(data.nonce);
      setCurrentRow(0);
      setRowsCleared(0);
      setMultiplier(1.00);
      setPayout(bet);
      setProfit(0);
      setSafeChance(data.safeChance);
      setMineChance(data.mineChance);
      setGameState('playing');
      updateBalance(data.balance);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to start game');
    } finally {
      setLoading(false);
    }
  }, [bet, difficulty, clientSeed, loading, updateBalance]);

  // ── Place a tile ────────────────────────────────────────────────────────────
  const placeTile = useCallback(async (row, tileIndex) => {
    if (loading || gameState !== 'playing' || row !== currentRow) return;
    if (board[row][tileIndex] !== TILE_HIDDEN) return;
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/towers/place`,
        { gameId, tileIndex },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setClickedTiles(prev => ({ ...prev, [row]: tileIndex }));

      if (!data.isSafe) {
        // ── Bomb hit ─────────────────────────────────────────────────────
        setBoard(prev => {
          const next = prev.map(r => [...r]);
          next[row][tileIndex] = TILE_BOMB;
          // Reveal all safe positions on all rows
          if (data.towerRevealed) {
            data.towerRevealed.forEach((safeIndices, r) => {
              safeIndices.forEach(si => {
                if (next[r][si] === TILE_HIDDEN) next[r][si] = TILE_GHOST;
              });
            });
          }
          return next;
        });
        setGameState('lost');
        setMultiplier(0);
        setSafeChance(null);
        setMineChance(null);
        setRevealedServerSeed(data.serverSeed);
        setRevealedNonce(data.nonce);
        setHistory(h => [{ type: 'loss', amount: bet, rows: rowsCleared }, ...h].slice(0, 10));

      } else {
        // ── Safe — advance ────────────────────────────────────────────────
        setBoard(prev => {
          const next = prev.map(r => [...r]);
          next[row][tileIndex] = TILE_SAFE;
          return next;
        });
        setCurrentRow(data.currentRow);
        setRowsCleared(data.rowsCleared);
        setMultiplier(data.multiplier ?? data.payout / bet);
        setPayout(data.potentialPayout ?? data.payout);
        setSafeChance(data.safeChance ?? null);
        setMineChance(data.mineChance ?? null);

        if (data.gameState === 'won') {
          // Auto-win: reached the top
          setBoard(prev => {
            const next = prev.map(r => [...r]);
            if (data.towerRevealed) {
              data.towerRevealed.forEach((safeIndices, r) => {
                safeIndices.forEach(si => {
                  if (next[r][si] === TILE_HIDDEN) next[r][si] = TILE_GHOST;
                });
              });
            }
            return next;
          });
          setGameState('won');
          setProfit(data.profit);
          setPayout(data.payout);
          setMultiplier(data.multiplier);
          setRevealedServerSeed(data.serverSeed);
          setRevealedNonce(data.nonce);
          updateBalance(data.balance);
          setHistory(h => [{ type: 'win', amount: data.profit, rows: data.rowsCleared }, ...h].slice(0, 10));
        }
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to place tile');
    } finally {
      setLoading(false);
    }
  }, [loading, gameState, currentRow, board, gameId, bet, rowsCleared, updateBalance]);

  // ── Cashout ─────────────────────────────────────────────────────────────────
  const cashout = useCallback(async () => {
    if (loading || gameState !== 'playing' || rowsCleared === 0) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/towers/cashout`,
        { gameId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setBoard(prev => {
        const next = prev.map(r => [...r]);
        if (data.towerRevealed) {
          data.towerRevealed.forEach((safeIndices, r) => {
            safeIndices.forEach(si => {
              if (next[r][si] === TILE_HIDDEN) next[r][si] = TILE_GHOST;
            });
          });
        }
        return next;
      });
      setGameState('won');
      setProfit(data.profit);
      setPayout(data.payout);
      setMultiplier(data.multiplier);
      setSafeChance(null);
      setMineChance(null);
      setRevealedServerSeed(data.serverSeed);
      setRevealedNonce(data.nonce);
      updateBalance(data.balance);
      setHistory(h => [{ type: 'win', amount: data.profit, rows: data.rowsCleared }, ...h].slice(0, 10));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to cashout');
    } finally {
      setLoading(false);
    }
  }, [loading, gameState, rowsCleared, gameId, updateBalance]);

  // ── Reset ───────────────────────────────────────────────────────────────────
  const reset = () => {
    setGameId(null);
    setGameState('betting');
    setBoard([]);
    setClickedTiles({});
    setCurrentRow(0);
    setRowsCleared(0);
    setMultiplier(1.00);
    setPayout(0);
    setProfit(0);
    setSafeChance(null);
    setMineChance(null);
    setClientSeed(generateClientSeed());
    setServerSeedHash(null);
    setRevealedServerSeed(null);
    setRevealedNonce(null);
  };

  // ── Tile component ────────────────────────────────────────────────────────
  const TileBtn = ({ row, tileIndex, state }) => {
    const isActive    = gameState === 'playing' && row === currentRow && !loading;
    const isClickable = isActive && state === TILE_HIDDEN;
    const isPast      = row < currentRow;
    const isClicked   = clickedTiles[row] === tileIndex;

    return (
      <motion.button
        onClick={() => placeTile(row, tileIndex)}
        disabled={!isClickable}
        whileHover={isClickable ? { scale: 1.06 } : {}}
        whileTap={isClickable ? { scale: 0.94 } : {}}
        className={`
          relative h-12 rounded-xl flex items-center justify-center
          text-xl font-bold select-none border transition-all duration-150
          ${state === TILE_HIDDEN && isActive
            ? 'bg-craft-gray border-craft-green/30 hover:border-craft-green hover:bg-craft-green/10 cursor-pointer shadow-sm'
            : ''}
          ${state === TILE_HIDDEN && !isActive
            ? 'bg-craft-gray/40 border-white/5 cursor-not-allowed opacity-40'
            : ''}
          ${state === TILE_SAFE
            ? 'bg-emerald-500/25 border-emerald-400/70 shadow-md shadow-emerald-500/20'
            : ''}
          ${state === TILE_BOMB
            ? 'bg-red-500/30 border-red-500 shadow-md shadow-red-500/30'
            : ''}
          ${state === TILE_GHOST
            ? 'bg-emerald-900/20 border-emerald-800/30 opacity-50'
            : ''}
        `}
      >
        <AnimatePresence mode="wait">
          {state === TILE_HIDDEN && (
            <motion.span key="h" exit={{ opacity: 0, scale: 0.4 }} className="text-gray-600 text-sm">◆</motion.span>
          )}
          {state === TILE_SAFE && (
            <motion.span key="s" initial={{ scale: 0, rotate: -15 }} animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
              ✦
            </motion.span>
          )}
          {state === TILE_BOMB && (
            <motion.span key="b" initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1] }} transition={{ duration: 0.35 }}>
              💣
            </motion.span>
          )}
          {state === TILE_GHOST && (
            <motion.span key="g" initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} className="text-emerald-500 text-sm">
              ✦
            </motion.span>
          )}
        </AnimatePresence>

        {/* Sparkle on safe reveal */}
        {state === TILE_SAFE && (
          <motion.div
            className="absolute inset-0 rounded-xl pointer-events-none"
            initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ duration: 0.6 }}
            style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.3) 0%, transparent 70%)' }}
          />
        )}
      </motion.button>
    );
  };

  // ── Row multiplier label ─────────────────────────────────────────────────────
  const rowMultiplier = (rowIdx) => previewMultiplier(cfg.safe, cfg.tiles, rowIdx + 1);

  // ── Cashout eligibility (mirrors backend rule) ────────────────────────────
  const currentPayout  = Math.round(bet * previewMultiplier(cfg.safe, cfg.tiles, rowsCleared));
  const canCashout     = gameState === 'playing' && rowsCleared > 0 && currentPayout > bet;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="pt-24 px-4 max-w-5xl mx-auto pb-12">
      <h1 className="text-3xl font-bold mb-8 text-center">
        <span className="text-blue-400">To</span><span className="text-white">wers</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

        {/* ── Left: Tower ─────────────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-5">

          {/* Header bar */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
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

            {/* Live odds */}
            {gameState === 'playing' && safeChance !== null && (
              <div className="flex gap-3 text-sm">
                <span className="text-emerald-400 font-semibold">✓ {safeChance}%</span>
                <span className="text-red-400 font-semibold">💣 {mineChance}%</span>
              </div>
            )}

            {gameState === 'playing' && (
              <div className="text-right text-sm">
                <span className="text-gray-500">Payout </span>
                <span className="text-craft-green font-bold">{currentPayout.toLocaleString()} WL</span>
              </div>
            )}
          </div>

          {/* Tower grid — displayed bottom-to-top (reversed) */}
          {board.length > 0 ? (
            <div className="flex flex-col-reverse gap-1.5">
              {board.map((row, rowIdx) => {
                const isActiveRow = gameState === 'playing' && rowIdx === currentRow;
                const isPastRow   = rowIdx < currentRow;
                const multLabel   = rowMultiplier(rowIdx).toFixed(2);

                return (
                  <div key={rowIdx} className={`flex items-center gap-2 rounded-xl px-2 py-1 transition-all ${
                    isActiveRow ? 'bg-craft-green/5 ring-1 ring-craft-green/30' : ''
                  }`}>
                    {/* Row number + multiplier */}
                    <div className="w-16 shrink-0 text-right">
                      <div className={`text-xs font-bold tabular-nums ${
                        isPastRow ? 'text-craft-green' :
                        isActiveRow ? 'text-craft-green' : 'text-gray-600'
                      }`}>
                        {multLabel}×
                      </div>
                      <div className="text-gray-700 text-xs">{rowIdx + 1}</div>
                    </div>

                    {/* Tiles */}
                    <div className={`flex-1 grid gap-2`} style={{ gridTemplateColumns: `repeat(${TILES}, 1fr)` }}>
                      {row.map((state, tileIdx) => (
                        <TileBtn key={tileIdx} row={rowIdx} tileIndex={tileIdx} state={state} />
                      ))}
                    </div>

                    {/* Progress indicator */}
                    <div className="w-4 shrink-0 flex items-center justify-center">
                      {isPastRow && (
                        <motion.span
                          initial={{ scale: 0 }} animate={{ scale: 1 }}
                          className="text-craft-green text-xs"
                        >✓</motion.span>
                      )}
                      {isActiveRow && (
                        <motion.span
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ repeat: Infinity, duration: 1.2 }}
                          className="text-craft-green text-xs"
                        >▶</motion.span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-600 text-sm">
              Configure your bet and start climbing
            </div>
          )}

          {/* Result banner */}
          <AnimatePresence>
            {(gameState === 'won' || gameState === 'lost') && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={`mt-4 p-4 rounded-xl text-center border ${
                  gameState === 'won'
                    ? 'bg-craft-green/15 border-craft-green'
                    : 'bg-red-500/15 border-red-500'
                }`}
              >
                {gameState === 'won' ? (
                  <>
                    <p className="text-craft-green font-bold text-xl">🏆 Cashed Out!</p>
                    <p className="text-craft-green text-3xl font-bold mt-1">+{profit.toLocaleString()} WL</p>
                    <p className="text-gray-400 text-sm mt-1">
                      {multiplier.toFixed(2)}× · {rowsCleared} row{rowsCleared !== 1 ? 's' : ''} cleared
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-red-400 font-bold text-xl">💣 You hit a bomb!</p>
                    <p className="text-gray-400 text-sm mt-1">
                      −{bet.toLocaleString()} WL · survived {rowsCleared} row{rowsCleared !== 1 ? 's' : ''}
                    </p>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Provably fair panel */}
          {serverSeedHash && (
            <div className="mt-4">
              <button
                onClick={() => setShowFairPanel(f => !f)}
                className="text-xs text-gray-500 hover:text-craft-green transition-colors flex items-center gap-1"
              >
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
                        <p className="text-gray-300">{revealedNonce}</p>
                      </div>
                      {revealedServerSeed ? (
                        <div>
                          <p className="text-gray-500 mb-1">Server Seed (revealed)</p>
                          <p className="text-yellow-400 break-all">{revealedServerSeed}</p>
                          <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/10 text-gray-500 space-y-1 leading-relaxed font-sans">
                            <p className="text-gray-400 font-semibold mb-2">To verify:</p>
                            <p>1. SHA256(serverSeed) must equal the hash above.</p>
                            <p>2. For each row R, derive safe tiles via:</p>
                            <p className="pl-3 text-gray-400 font-mono">HMAC-SHA256(serverSeed, "{clientSeed}:{revealedNonce}:R:counter")</p>
                            <p>3. Read positions as uint32BE % {TILES} per 4-byte chunk.</p>
                          </div>
                        </div>
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

          {/* Difficulty */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">Difficulty</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(DIFFICULTIES).map(([key, d]) => (
                <button
                  key={key}
                  onClick={() => setDifficulty(key)}
                  disabled={gameState === 'playing'}
                  className={`py-2.5 rounded-xl text-sm font-bold border transition-all disabled:opacity-40 ${
                    difficulty === key
                      ? `${d.bg} ${d.color} border-current`
                      : 'bg-craft-gray text-gray-400 border-white/5 hover:text-white'
                  }`}
                >
                  <div>{d.label}</div>
                  <div className="text-xs font-normal opacity-70 mt-0.5">{d.safe}/{d.tiles} safe</div>
                </button>
              ))}
            </div>
          </div>

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
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
                    bet === a ? 'bg-craft-green text-craft-dark' : 'bg-craft-gray text-gray-400 hover:text-white'
                  }`}>{a}</button>
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
                  className="flex-1 bg-craft-gray border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-craft-green transition-colors"
                  placeholder="Your client seed" />
                <button onClick={() => setClientSeed(generateClientSeed())}
                  className="px-3 py-2 rounded-lg bg-craft-gray text-gray-400 hover:text-craft-green text-xs border border-white/10 transition-colors" title="Randomize">↺</button>
              </div>
            </div>
          )}

          {/* Live stats */}
          {gameState === 'playing' && (
            <div className="glass rounded-2xl p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Row</div>
                  <div className="text-white font-bold text-xl">{currentRow + 1}<span className="text-gray-600 text-sm">/{ROWS}</span></div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Cleared</div>
                  <div className="text-craft-green font-bold text-xl">{rowsCleared}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Multiplier</div>
                  <div className="text-craft-green font-bold text-xl">{multiplier.toFixed(2)}×</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Next row</div>
                  <div className="text-blue-400 font-bold text-xl">
                    {previewMultiplier(cfg.safe, cfg.tiles, rowsCleared + 1).toFixed(2)}×
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {gameState === 'betting' && (
            <button onClick={startGame}
              disabled={loading || bet > (user?.balance || 0) || bet < 1}
              className="w-full py-4 rounded-xl bg-craft-green text-craft-dark font-bold text-lg hover:bg-craft-greenDark transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-craft-green/20">
              {loading ? 'Starting…' : 'Start Climbing'}
            </button>
          )}

          {gameState === 'playing' && (
            <button onClick={cashout} disabled={loading || !canCashout}
              className="w-full py-4 rounded-xl font-bold text-lg transition-all shadow-lg disabled:cursor-not-allowed"
              style={{
                background: canCashout ? 'linear-gradient(135deg, #00ff88, #00cc6a)' : undefined,
                backgroundColor: !canCashout ? '#1a1f1a' : undefined,
                color: canCashout ? '#0a0f0a' : '#6b7280',
                opacity: loading ? 0.5 : 1,
              }}>
              {loading ? 'Processing…'
                : rowsCleared === 0 ? 'Clear a row first'
                : !canCashout ? 'Keep climbing for profit'
                : `💰 Cashout ${currentPayout.toLocaleString()} WL`}
            </button>
          )}

          {(gameState === 'won' || gameState === 'lost') && (
            <button onClick={reset} disabled={loading}
              className="w-full py-4 rounded-xl bg-craft-green text-craft-dark font-bold text-lg hover:bg-craft-greenDark transition-colors disabled:opacity-50 shadow-lg shadow-craft-green/20">
              Play Again
            </button>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">History</h3>
              <div className="flex flex-col gap-1.5">
                {history.map((h, i) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                    h.type === 'win' ? 'bg-craft-green/10 text-craft-green' : 'bg-red-500/10 text-red-400'
                  }`}>
                    <span>{h.type === 'win' ? '🏆' : '💣'} {h.rows} row{h.rows !== 1 ? 's' : ''}</span>
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

export default Towers;