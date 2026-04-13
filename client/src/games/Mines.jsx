import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

const API_URL = 'https://craftbet.onrender.com';

// ── FIX 3: Mirror backend multiplier — no 1.01 clamp ─────────────────────────
const previewMultiplier = (totalTiles, mineCount, tilesRevealed) => {
  if (tilesRevealed === 0) return 1.00;
  let p = 1;
  for (let i = 0; i < tilesRevealed; i++) {
    p *= (totalTiles - mineCount - i) / (totalTiles - i);
  }
  return parseFloat(((1 / p) * 0.97).toFixed(4));
};

// FIX 4: Next-click safe probability
const getSafeChance = (totalTiles, mineCount, tilesRevealed) => {
  const tilesLeft = totalTiles - tilesRevealed;
  const safeLeft  = tilesLeft - mineCount;
  return parseFloat(((safeLeft / tilesLeft) * 100).toFixed(1));
};

const TILE_HIDDEN = 'hidden';
const TILE_GEM    = 'gem';
const TILE_MINE   = 'mine';
const TILE_GHOST  = 'ghost';

// ── Generate a random client seed ─────────────────────────────────────────────
const generateClientSeed = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

const Mines = () => {
  const { user, updateBalance } = useAuth();

  const [bet, setBet]             = useState(100);
  const [mineCount, setMineCount] = useState(3);

  // FIX 1: Provably fair seeds
  const [clientSeed, setClientSeed]         = useState(generateClientSeed);
  const [serverSeedHash, setServerSeedHash] = useState(null);
  const [revealedServerSeed, setRevealedServerSeed] = useState(null);
  const [revealedNonce, setRevealedNonce]   = useState(null);
  const [firstClickTile, setFirstClickTile] = useState(null);
  const [showFairPanel, setShowFairPanel]   = useState(false);

  // Game state
  const [gameId, setGameId]               = useState(null);
  const [gameState, setGameState]         = useState('betting');
  const [tiles, setTiles]                 = useState(Array(25).fill(TILE_HIDDEN));
  const [multiplier, setMultiplier]       = useState(1.00);
  const [tilesRevealed, setTilesRevealed] = useState(0);
  const [payout, setPayout]               = useState(0);
  const [profit, setProfit]               = useState(0);
  const [loading, setLoading]             = useState(false);
  const [explodingTile, setExplodingTile] = useState(null);
  const [history, setHistory]             = useState([]);

  // FIX 4: live odds from server
  const [safeChance, setSafeChance] = useState(null);
  const [mineChance, setMineChance] = useState(null);

  const GRID  = 5;
  const TOTAL = GRID * GRID;

  // ── Betting helpers ───────────────────────────────────────────────────────
  const clampBet = (value) => {
    const min = 1;
    const max = user?.balance || 0;
    return Math.max(min, Math.min(max, value));
  };

  const step = bet < 100 ? 10 : bet < 1000 ? 50 : 100;

  const isInvalidBet = bet > (user?.balance || 0) || bet < 1;

  // ── Cashout helpers (new) ─────────────────────────────────────────────────
  const canCashout = tilesRevealed >= 2 && multiplier >= 1.05;

  // ── Start game ──────────────────────────────────────────────────────────────
  const startGame = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setRevealedServerSeed(null);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/mines/start`,
        { bet, mineCount, gridSize: GRID, clientSeed },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGameId(data.gameId);
      setServerSeedHash(data.serverSeedHash);
      setRevealedNonce(data.nonce);
      setFirstClickTile(null);
      setTiles(Array(TOTAL).fill(TILE_HIDDEN));
      setMultiplier(1.00);
      setTilesRevealed(0);
      setPayout(bet);
      setProfit(0);
      setGameState('playing');
      setExplodingTile(null);
      setSafeChance(data.safeChance);
      setMineChance(data.mineChance);
      updateBalance(data.balance);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to start game');
    } finally {
      setLoading(false);
    }
  }, [bet, mineCount, loading, clientSeed, updateBalance, TOTAL]);

  // ── Reveal tile ─────────────────────────────────────────────────────────────
  const revealTile = useCallback(async (index) => {
    if (loading || gameState !== 'playing' || tiles[index] !== TILE_HIDDEN) return;
    setLoading(true);
    if (firstClickTile === null) setFirstClickTile(index);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/mines/reveal`,
        { gameId, tileIndex: index },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (data.isMine) {
        setExplodingTile(index);
        setTimeout(() => {
          setTiles(prev => {
            const next = [...prev];
            next[index] = TILE_MINE;
            data.minePositions.forEach(mi => {
              if (mi !== index && next[mi] !== TILE_GEM) next[mi] = TILE_GHOST;
            });
            return next;
          });
          setGameState('lost');
          setMultiplier(0);
          setSafeChance(null);
          setMineChance(null);
          setRevealedServerSeed(data.serverSeed);
          setRevealedNonce(data.nonce);
          setHistory(h => [{ type: 'loss', amount: bet, tiles: data.revealedTiles?.length || 0 }, ...h].slice(0, 10));
        }, 600);
      } else {
        const newTiles = [...tiles];
        newTiles[index] = TILE_GEM;
        setTiles(newTiles);
        setMultiplier(data.multiplier);
        setTilesRevealed(data.tilesRevealed);
        setPayout(data.potentialPayout);
        setSafeChance(data.safeChance);
        setMineChance(data.mineChance);

        if (data.gameState === 'won') {
          setGameState('won');
          setPayout(data.payout);
          setProfit(data.payout - bet);
          setRevealedServerSeed(data.serverSeed);
          setRevealedNonce(data.nonce);
          setSafeChance(null);
          setMineChance(null);
          updateBalance(data.balance);
          setHistory(h => [{ type: 'win', amount: data.payout - bet, tiles: data.tilesRevealed }, ...h].slice(0, 10));
        }
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to reveal tile');
    } finally {
      setLoading(false);
    }
  }, [loading, gameState, tiles, gameId, bet, updateBalance]);

  // ── Cashout ─────────────────────────────────────────────────────────────────
  const cashout = useCallback(async () => {
    if (loading || gameState !== 'playing' || !canCashout) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/mines/cashout`,
        { gameId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGameState('won');
      setPayout(data.payout);
      setProfit(data.profit);
      setMultiplier(data.multiplier);
      setSafeChance(null);
      setMineChance(null);
      setRevealedServerSeed(data.serverSeed);
      setRevealedNonce(data.nonce);
      setTiles(prev => {
        const next = [...prev];
        data.minePositions.forEach(mi => {
          if (next[mi] === TILE_HIDDEN) next[mi] = TILE_GHOST;
        });
        return next;
      });
      updateBalance(data.balance);
      setHistory(h => [{ type: 'win', amount: data.profit, tiles: data.tilesRevealed }, ...h].slice(0, 10));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to cashout');
    } finally {
      setLoading(false);
    }
  }, [loading, gameState, canCashout, gameId, updateBalance]);

  // ── Reset ───────────────────────────────────────────────────────────────────
  const reset = () => {
    setGameId(null);
    setGameState('betting');
    setTiles(Array(TOTAL).fill(TILE_HIDDEN));
    setMultiplier(1.00);
    setTilesRevealed(0);
    setPayout(0);
    setProfit(0);
    setExplodingTile(null);
    setSafeChance(null);
    setMineChance(null);
    setClientSeed(generateClientSeed());
    setServerSeedHash(null);
    setRevealedServerSeed(null);
    setRevealedNonce(null);
    setFirstClickTile(null);
  };

  // ── Next-click multiplier preview ────────────────────────────────────────────
  const nextMult = previewMultiplier(TOTAL, mineCount, tilesRevealed + 1);

  // ── Tile component ───────────────────────────────────────────────────────────
  const Tile = ({ index, state }) => {
    const isExploding = explodingTile === index;
    const isClickable = gameState === 'playing' && state === TILE_HIDDEN && !loading;

    return (
      <motion.button
        onClick={() => revealTile(index)}
        disabled={!isClickable}
        animate={isExploding ? { x: [0, -8, 8, -6, 6, -3, 3, 0], scale: [1, 1.15, 1.1, 1.1, 1.1, 1.05, 1.05, 1] } : {}}
        transition={{ duration: 0.5 }}
        className={`
          relative aspect-square rounded-xl flex items-center justify-center
          text-2xl sm:text-3xl select-none transition-all duration-150
          ${state === TILE_HIDDEN && isClickable
            ? 'bg-craft-gray border border-craft-green/20 hover:border-craft-green/60 hover:bg-craft-green/10 hover:scale-105 cursor-pointer active:scale-95'
            : ''}
          ${state === TILE_HIDDEN && !isClickable
            ? 'bg-craft-gray border border-white/5 opacity-50 cursor-not-allowed'
            : ''}
          ${state === TILE_GEM
            ? 'bg-emerald-500/20 border-2 border-emerald-400/60 shadow-lg shadow-emerald-500/20'
            : ''}
          ${state === TILE_MINE
            ? 'bg-red-500/30 border-2 border-red-500 shadow-lg shadow-red-500/40'
            : ''}
          ${state === TILE_GHOST
            ? 'bg-red-900/20 border border-red-800/30 opacity-60'
            : ''}
        `}
      >
        <AnimatePresence mode="wait">
          {state === TILE_HIDDEN && (
            <motion.span key="h" exit={{ opacity: 0, scale: 0.4 }} className="text-gray-600 text-base">◆</motion.span>
          )}
          {state === TILE_GEM && (
            <motion.span key="g" initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
              💎
            </motion.span>
          )}
          {state === TILE_MINE && (
            <motion.span key="m" initial={{ scale: 0 }} animate={{ scale: [0, 1.4, 1] }} transition={{ duration: 0.35 }}>
              💣
            </motion.span>
          )}
          {state === TILE_GHOST && (
            <motion.span key="gh" initial={{ opacity: 0 }} animate={{ opacity: 0.55 }} className="grayscale">
              💣
            </motion.span>
          )}
        </AnimatePresence>
        {state === TILE_GEM && (
          <motion.div
            className="absolute inset-0 rounded-xl pointer-events-none"
            initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ duration: 0.7 }}
            style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.35) 0%, transparent 70%)' }}
          />
        )}
      </motion.button>
    );
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="pt-24 px-4 max-w-5xl mx-auto pb-12">
      <h1 className="text-3xl font-bold mb-8 text-center">
        <span className="text-yellow-400">Mi</span><span className="text-white">nes</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">

        {/* Left: Grid */}
        <div className="glass rounded-2xl p-6">

          {/* Multiplier + odds bar */}
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm">Multiplier</span>
              <motion.span
                key={multiplier}
                initial={{ scale: 1.25 }}
                animate={{ scale: 1 }}
                className="text-2xl font-bold tabular-nums"
                style={{ color: gameState === 'lost' ? '#ef4444' : '#00ff88' }}
              >
                {gameState === 'lost' ? '0.00' : multiplier.toFixed(2)}×
              </motion.span>
            </div>

            {gameState === 'playing' && safeChance !== null && (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-emerald-400 font-semibold">
                  ✓ Safe: {safeChance}%
                </span>
                <span className="text-red-400 font-semibold">
                  💣 Mine: {mineChance}%
                </span>
              </div>
            )}

            {gameState === 'playing' && tilesRevealed > 0 && (
              <div className="text-right text-sm">
                <span className="text-gray-500">Next → </span>
                <span className="text-craft-green font-semibold">{nextMult.toFixed(2)}×</span>
              </div>
            )}
          </div>

          {/* 5×5 grid */}
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {tiles.map((state, i) => <Tile key={i} index={i} state={state} />)}
          </div>

          {/* Result banner */}
          <AnimatePresence>
            {(gameState === 'won' || gameState === 'lost') && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
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
                      {multiplier.toFixed(2)}× · {tilesRevealed} tile{tilesRevealed !== 1 ? 's' : ''} revealed
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-red-400 font-bold text-xl">💣 Boom! Mine hit.</p>
                    <p className="text-gray-400 text-sm mt-1">
                      −{bet.toLocaleString()} WL · survived {tilesRevealed} tile{tilesRevealed !== 1 ? 's' : ''}
                    </p>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Provably Fair verification panel */}
          {(serverSeedHash || revealedServerSeed) && (
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
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 p-4 rounded-xl bg-black/30 border border-white/10 space-y-3 text-xs font-mono">
                      <div>
                        <p className="text-gray-500 mb-1">Server Seed Hash (committed before game)</p>
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
                      {firstClickTile !== null && (
                        <div>
                          <p className="text-gray-500 mb-1">First Click (excluded tile)</p>
                          <p className="text-blue-400">Tile #{firstClickTile}</p>
                        </div>
                      )}
                      {revealedServerSeed ? (
                        <div>
                          <p className="text-gray-500 mb-1">Server Seed (revealed after game)</p>
                          <p className="text-yellow-400 break-all">{revealedServerSeed}</p>
                          <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/10 text-gray-500 space-y-1 leading-relaxed">
                            <p className="text-gray-400 font-sans font-semibold not-italic mb-2">To verify:</p>
                            <p>1. SHA256(serverSeed) must equal the hash above.</p>
                            <p>2. Mines derived via:</p>
                            <p className="pl-3 text-gray-400">HMAC-SHA256(serverSeed, "{clientSeed}:{revealedNonce}:counter")</p>
                            <p>3. Skip tile #{firstClickTile} (your first click) during derivation.</p>
                            <p>4. Read positions as uint32BE % 25 per 4-byte chunk.</p>
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

        {/* Right: Controls */}
        <div className="flex flex-col gap-4">

          {/* Bet Section */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">Bet Amount</h3>
            
            <input
              type="number"
              value={bet}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!isNaN(value)) setBet(clampBet(value));
              }}
              disabled={gameState === 'playing'}
              className={`w-full text-center text-2xl font-bold bg-craft-gray border rounded-lg py-3 focus:outline-none transition-colors ${
                isInvalidBet ? 'border-red-500 text-red-400' : 'border-white/10'
              }`}
            />

            <div className="flex gap-2 my-4">
              <button 
                onClick={() => setBet(b => clampBet(Math.floor(b / 2)))}
                disabled={gameState === 'playing'}
                className="flex-1 py-2 rounded-lg bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold transition-colors disabled:opacity-40"
              >
                ½
              </button>
              <button 
                onClick={() => setBet(b => clampBet(b * 2))}
                disabled={gameState === 'playing'}
                className="flex-1 py-2 rounded-lg bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold transition-colors disabled:opacity-40"
              >
                2×
              </button>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <button 
                onClick={() => setBet(b => clampBet(b - step))}
                disabled={gameState === 'playing'}
                className="w-12 h-12 rounded-lg bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold text-2xl transition-colors disabled:opacity-40"
              >
                −
              </button>
              
              <div className="flex-1 text-center text-2xl font-bold text-craft-green tabular-nums">
                {bet.toLocaleString()}
              </div>

              <button 
                onClick={() => setBet(b => clampBet(b + step))}
                disabled={gameState === 'playing'}
                className="w-12 h-12 rounded-lg bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold text-2xl transition-colors disabled:opacity-40"
              >
                +
              </button>
            </div>

            <div className="flex gap-1.5 flex-wrap">
              {[10, 50, 100, 500, 1000].map(a => (
                <button 
                  key={a} 
                  onClick={() => setBet(a)} 
                  disabled={gameState === 'playing' || a > (user?.balance || 0)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
                    bet === a ? 'bg-craft-green text-craft-dark' : 'bg-craft-gray text-gray-400 hover:text-white'
                  }`}
                >
                  {a}
                </button>
              ))}
              <button 
                onClick={() => setBet(1)} 
                disabled={gameState === 'playing'}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-craft-gray text-gray-400 hover:text-craft-green transition-colors disabled:opacity-40"
              >
                Min
              </button>
              <button 
                onClick={() => setBet(user?.balance || 0)} 
                disabled={gameState === 'playing'}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-craft-gray text-gray-400 hover:text-craft-green transition-colors disabled:opacity-40"
              >
                Max
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-4">
              Balance: {user?.balance?.toLocaleString() || 0} WL
            </p>
          </div>

          {/* Mines slider */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">
              Mines: <span className="text-red-400 font-bold">{mineCount}</span>
              <span className="text-gray-600 font-normal ml-2">({TOTAL - mineCount} safe)</span>
            </h3>
            <input type="range" min={1} max={24} value={mineCount}
              onChange={e => setMineCount(Number(e.target.value))}
              disabled={gameState === 'playing'}
              className="w-full accent-craft-green disabled:opacity-40 cursor-pointer" />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>1</span><span>24</span>
            </div>
            <div className="flex gap-1.5 mt-3">
              {[{ label: 'Easy', m: 3 }, { label: 'Med', m: 8 }, { label: 'Hard', m: 15 }, { label: 'Insane', m: 23 }].map(({ label, m }) => (
                <button key={label} onClick={() => setMineCount(m)} disabled={gameState === 'playing'}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${mineCount === m ? 'bg-red-500/30 text-red-300 border border-red-500/40' : 'bg-craft-gray text-gray-400 hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Client seed input */}
          {gameState === 'betting' && (
            <div className="glass rounded-2xl p-5">
              <h3 className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wider flex items-center gap-1">
                🔐 Client Seed
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={clientSeed}
                  onChange={e => setClientSeed(e.target.value)}
                  className="flex-1 bg-craft-gray border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-craft-green transition-colors"
                  placeholder="Your client seed"
                />
                <button
                  onClick={() => setClientSeed(generateClientSeed())}
                  className="px-3 py-2 rounded-lg bg-craft-gray text-gray-400 hover:text-craft-green text-xs border border-white/10 transition-colors"
                  title="Generate random seed"
                >↺</button>
              </div>
              <p className="text-gray-600 text-xs mt-1">Change this to any value you want before starting.</p>
            </div>
          )}

          {/* Live stats during play */}
          {gameState === 'playing' && (
            <div className="glass rounded-2xl p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Safe left</div>
                  <div className="text-craft-green font-bold text-lg">{TOTAL - mineCount - tilesRevealed}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Revealed</div>
                  <div className="text-white font-bold text-lg">{tilesRevealed}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Multiplier</div>
                  <div className="text-craft-green font-bold text-lg">{multiplier.toFixed(2)}×</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">Payout</div>
                  <div className="text-craft-green font-bold text-lg">{payout.toLocaleString()}</div>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons - Updated Cashout Logic */}
          {gameState === 'betting' && (
            <button 
              onClick={startGame}
              disabled={loading || isInvalidBet || !clientSeed}
              className="w-full py-4 rounded-xl bg-craft-green text-craft-dark font-bold text-lg hover:bg-craft-greenDark transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-craft-green/20"
            >
              {loading 
                ? 'Starting…' 
                : isInvalidBet 
                  ? 'Invalid Bet' 
                  : 'Start Game'
              }
            </button>
          )}

          {gameState === 'playing' && (
            <button 
              onClick={cashout}
              disabled={loading || !canCashout}
              className="w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              style={{
                background: canCashout ? 'linear-gradient(135deg, #00ff88, #00cc6a)' : '#1a1f1a',
                color: canCashout ? '#0a0f0a' : '#6b7280',
              }}
            >
              {loading 
                ? 'Processing…' 
                : tilesRevealed < 2 
                  ? 'Reveal 2 tiles to cashout'
                  : multiplier < 1.05 
                    ? 'Increase multiplier to 1.05×'
                    : `💰 Cashout ${payout.toLocaleString()} WL`
              }
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
                  <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${h.type === 'win' ? 'bg-craft-green/10 text-craft-green' : 'bg-red-500/10 text-red-400'}`}>
                    <span>{h.type === 'win' ? '💎' : '💣'} {h.tiles} tile{h.tiles !== 1 ? 's' : ''}</span>
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

export default Mines;