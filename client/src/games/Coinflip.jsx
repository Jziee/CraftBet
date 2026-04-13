import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

const API_URL = 'https://craftbet.onrender.com';

// ── Helpers ───────────────────────────────────────────────────────────────────
const generateClientSeed = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const SOLO_MULTIPLIER = parseFloat((2 * 0.97).toFixed(2)); // 1.94

// ── Coin face ─────────────────────────────────────────────────────────────────
const CoinFace = ({ side, size = 96 }) => (
  <div style={{ width: size, height: size }} className="rounded-full flex items-center justify-center select-none">
    {side === 'heads' ? (
      <div
        style={{ width: size, height: size }}
        className="rounded-full bg-linear-to-br from-yellow-300 via-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg border-4 border-yellow-200/40"
      >
        <span style={{ fontSize: size * 0.38 }}>👑</span>
      </div>
    ) : (
      <div
        style={{ width: size, height: size }}
        className="rounded-full bg-linear-to-br from-gray-300 via-gray-400 to-gray-600 flex items-center justify-center shadow-lg border-4 border-gray-200/40"
      >
        <span style={{ fontSize: size * 0.38 }}>⚔️</span>
      </div>
    )}
  </div>
);

// ── Animated flipping coin ────────────────────────────────────────────────────
const FlippingCoin = ({ flipping, result }) => {
  const [face, setFace] = useState('heads');
  const intervalRef = useRef(null);

  useEffect(() => {
    if (flipping) {
      intervalRef.current = setInterval(() => setFace(f => f === 'heads' ? 'tails' : 'heads'), 120);
    } else {
      clearInterval(intervalRef.current);
      if (result) setFace(result);
    }
    return () => clearInterval(intervalRef.current);
  }, [flipping, result]);

  return (
    <motion.div
      animate={flipping ? { rotateY: [0, 180, 360], scale: [1, 1.15, 1] } : { rotateY: 0, scale: 1 }}
      transition={flipping ? { repeat: Infinity, duration: 0.24, ease: 'linear' } : { duration: 0.3 }}
      style={{ perspective: 400 }}
    >
      <CoinFace side={face} size={112} />
    </motion.div>
  );
};

// ── Shared: Bet input ─────────────────────────────────────────────────────────
const BetInput = ({ bet, setBet, maxBalance, disabled }) => (
  <div className="glass rounded-2xl p-5">
    <h3 className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">Bet Amount</h3>
    <input
      type="number" value={bet}
      onChange={e => setBet(Math.max(1, parseInt(e.target.value) || 1))}
      onBlur={() => setBet(Math.min(maxBalance || 0, Math.max(1, bet)))}
      disabled={disabled} min="1" max={maxBalance || 0}
      className="w-full bg-craft-gray border border-craft-green/30 rounded-xl px-4 py-3 text-2xl font-bold text-center text-craft-green tabular-nums focus:outline-none focus:border-craft-green transition-colors disabled:opacity-40"
    />
    <div className="flex gap-2 mt-2">
      {[{ label: '½', mult: 0.5 }, { label: '2×', mult: 2 }, { label: 'Max', mult: null }].map(({ label, mult }) => (
        <button key={label} disabled={disabled}
          onClick={() => mult ? setBet(b => Math.max(1, Math.min(maxBalance || 0, Math.floor(b * mult)))) : setBet(maxBalance || 0)}
          className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-craft-gray border border-white/10 text-gray-400 hover:text-craft-green hover:border-craft-green/40 transition-colors disabled:opacity-40"
        >{label}</button>
      ))}
    </div>
  </div>
);

// ── Shared: Side picker ───────────────────────────────────────────────────────
const SidePicker = ({ side, setSide, disabled, label = 'Your Side' }) => (
  <div className="glass rounded-2xl p-5">
    <h3 className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">{label}</h3>
    <div className="grid grid-cols-2 gap-3">
      {['heads', 'tails'].map(s => (
        <button key={s} onClick={() => setSide(s)} disabled={disabled}
          className={`py-3 rounded-xl font-bold text-sm capitalize flex items-center justify-center gap-2 border transition-all disabled:opacity-40 ${
            side === s
              ? s === 'heads' ? 'bg-yellow-500/20 border-yellow-400/60 text-yellow-300' : 'bg-gray-500/20 border-gray-400/60 text-gray-200'
              : 'bg-craft-gray border-white/10 text-gray-500 hover:border-white/30'
          }`}
        >
          <CoinFace side={s} size={22} /> {s}
        </button>
      ))}
    </div>
  </div>
);

// ── Shared: Provably fair panel ───────────────────────────────────────────────
const FairPanel = ({ data, clientSeed, setClientSeed, disabled, showSeedInput = false }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass rounded-2xl p-5 w-full">
      {showSeedInput && !data && (
        <>
          <h3 className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wider">🔐 Client Seed</h3>
          <div className="flex gap-2">
            <input type="text" value={clientSeed} onChange={e => setClientSeed(e.target.value.slice(0, 64))}
              disabled={disabled}
              className="flex-1 bg-craft-gray border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-craft-green transition-colors disabled:opacity-40"
            />
            <button onClick={() => setClientSeed(generateClientSeed())} disabled={disabled}
              className="px-3 py-2 rounded-lg bg-craft-gray text-gray-400 hover:text-craft-green text-xs border border-white/10 transition-colors disabled:opacity-40">↺</button>
          </div>
        </>
      )}
      {data && (
        <>
          <button onClick={() => setOpen(o => !o)} className="text-xs text-gray-500 hover:text-craft-green transition-colors flex items-center gap-1 w-full">
            🔐 Provably Fair {open ? '▲' : '▼'}
          </button>
          <AnimatePresence>
            {open && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-3 p-4 rounded-xl bg-black/30 border border-white/10 space-y-3 text-xs font-mono">
                  {data.serverSeedHash && <div><p className="text-gray-500 mb-1">Server Seed Hash</p><p className="text-gray-300 break-all">{data.serverSeedHash}</p></div>}
                  {data.serverSeed && <div><p className="text-gray-500 mb-1">Server Seed (revealed)</p><p className="text-yellow-400 break-all">{data.serverSeed}</p></div>}
                  {data.clientSeed && <div><p className="text-gray-500 mb-1">Client Seed</p><p className="text-craft-green break-all">{data.clientSeed}</p></div>}
                  {data.nonce !== undefined && <div><p className="text-gray-500 mb-1">Nonce</p><p className="text-gray-300">{data.nonce}</p></div>}
                  {data.nextServerSeedHash && <div><p className="text-gray-500 mb-1">Next Server Seed Hash</p><p className="text-blue-400 break-all">{data.nextServerSeedHash}</p></div>}
                  <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-gray-500 space-y-1 leading-relaxed font-sans">
                    <p className="text-gray-400 font-semibold mb-1">To verify:</p>
                    <p>1. SHA256(serverSeed) = serverSeedHash</p>
                    <p>2. HMAC-SHA256(serverSeed, "clientSeed:nonce") → hex</p>
                    <p>3. h = parseInt(hash[0..7], 16)</p>
                    <p>4. h / 2³² &lt; 0.5 → Heads, else Tails</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════════
// SOLO TAB
// ════════════════════════════════════════════════════════════════════════════════
const SoloTab = () => {
  const { user, updateBalance } = useAuth();
  const [bet, setBet]           = useState(100);
  const [side, setSide]         = useState('heads');
  const [loading, setLoading]   = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [result, setResult]     = useState(null);
  const [lastWon, setLastWon]   = useState(null);
  const [lastProfit, setLastProfit] = useState(null);
  const [clientSeed, setClientSeed] = useState(generateClientSeed);
  const [nonce, setNonce]           = useState(0);
  const [fairData, setFairData]     = useState(null);
  const [history, setHistory]       = useState([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const [stopOnProfit, setStopOnProfit] = useState('');
  const [stopOnLoss, setStopOnLoss]     = useState('');
  const [sessionProfit, setSessionProfit] = useState(0);
  const [streak, setStreak]             = useState(0);
  const [streakType, setStreakType]     = useState(null);
  const autoRef = useRef(false);

  const doFlip = useCallback(async (currentNonce, currentSeed) => {
    setLoading(true); setFlipping(true); setResult(null); setLastWon(null);
    try {
      const { data } = await axios.post(`${API_URL}/api/coinflip/solo/bet`,
        { bet, side, clientSeed: currentSeed, nonce: currentNonce },
        { headers: authHeaders() }
      );
      await new Promise(r => setTimeout(r, 900));
      setFlipping(false); setResult(data.result); setLastWon(data.won); setLastProfit(data.profit);
      updateBalance(data.balance);
      setNonce(n => n + 1);
      setClientSeed(generateClientSeed());
      setFairData({ serverSeed: data.serverSeed, serverSeedHash: data.serverSeedHash, clientSeed: data.clientSeed, nonce: data.nonce, nextServerSeedHash: data.nextServerSeedHash });
      setHistory(h => [{ result: data.result, side, won: data.won, profit: data.profit, bet }, ...h.slice(0, 49)]);
      setSessionProfit(sp => sp + data.profit);
      setStreak(s => { const same = data.won ? streakType === 'win' : streakType === 'loss'; return same ? s + 1 : 1; });
      setStreakType(data.won ? 'win' : 'loss');
      return data;
    } catch (err) { setFlipping(false); console.error(err); return null; }
    finally { setLoading(false); }
  }, [bet, side, streakType, updateBalance]);

  useEffect(() => {
    if (!autoRunning) return;
    autoRef.current = true;
    let cn = nonce; let cs = clientSeed; let rp = sessionProfit;
    const loop = async () => {
      while (autoRef.current) {
        const data = await doFlip(cn, cs);
        if (!data) break;
        cn++; cs = generateClientSeed(); rp += data.profit;
        const sp = parseFloat(stopOnProfit); const sl = parseFloat(stopOnLoss);
        if (stopOnProfit && rp >= sp) { setAutoRunning(false); break; }
        if (stopOnLoss && rp <= -Math.abs(sl)) { setAutoRunning(false); break; }
        await new Promise(r => setTimeout(r, 200));
      }
    };
    loop();
    return () => { autoRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunning]);

  const canBet = !loading && !flipping && !autoRunning && bet >= 1 && bet <= (user?.balance || 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
      {/* Coin display */}
      <div className="glass rounded-2xl p-8 flex flex-col items-center justify-center min-h-80 gap-6">
        <FlippingCoin flipping={flipping} result={result} />
        <AnimatePresence mode="wait">
          {!flipping && lastWon !== null ? (
            <motion.div key="result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-center">
              <p className={`text-2xl font-black ${lastWon ? 'text-craft-green' : 'text-red-400'}`}>{lastWon ? 'WIN' : 'LOSS'}</p>
              <p className={`text-xl font-bold mt-1 ${lastWon ? 'text-craft-green' : 'text-red-400'}`}>
                {lastWon ? `+${lastProfit?.toLocaleString()}` : `−${bet.toLocaleString()}`} WL
              </p>
              <p className="text-gray-500 text-sm mt-1 capitalize">Landed: <span className="text-white font-semibold">{result}</span> · Picked: <span className="text-white font-semibold">{side}</span></p>
            </motion.div>
          ) : !flipping ? (
            <motion.p key="idle" className="text-gray-600 text-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Pick a side and flip!</motion.p>
          ) : (
            <motion.p key="flipping" className="text-gray-400 text-sm animate-pulse" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Flipping…</motion.p>
          )}
        </AnimatePresence>
        {streak > 1 && !flipping && (
          <div className={`px-4 py-2 rounded-full text-xs font-bold border ${streakType === 'win' ? 'bg-craft-green/10 border-craft-green/40 text-craft-green' : 'bg-red-500/10 border-red-500/40 text-red-400'}`}>
            🔥 {streak}× {streakType} streak
          </div>
        )}
        {autoRunning && (
          <div className="px-4 py-2 rounded-full text-xs font-bold border bg-yellow-500/10 border-yellow-400/40 text-yellow-300 animate-pulse">
            Auto — session P/L: {sessionProfit >= 0 ? '+' : ''}{sessionProfit.toLocaleString()} WL
          </div>
        )}
        <div className="w-full max-w-md">
          <FairPanel data={fairData} clientSeed={clientSeed} setClientSeed={setClientSeed} disabled={flipping || autoRunning} showSeedInput={false} />
        </div>
      </div>
      {/* Controls */}
      <div className="flex flex-col gap-4">
        <SidePicker side={side} setSide={setSide} disabled={flipping || autoRunning} />
        <BetInput bet={bet} setBet={setBet} maxBalance={user?.balance} disabled={flipping || autoRunning} />
        <div className="glass rounded-2xl p-4 flex justify-between text-sm">
          <span className="text-gray-500">Win payout</span>
          <span className="text-craft-green font-bold">{Math.floor(bet * SOLO_MULTIPLIER).toLocaleString()} WL</span>
        </div>
        {/* Client seed */}
        <div className="glass rounded-2xl p-5">
          <h3 className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wider">🔐 Client Seed</h3>
          <div className="flex gap-2">
            <input type="text" value={clientSeed} onChange={e => setClientSeed(e.target.value.slice(0, 64))} disabled={flipping || autoRunning}
              className="flex-1 bg-craft-gray border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-craft-green transition-colors disabled:opacity-40" />
            <button onClick={() => setClientSeed(generateClientSeed())} disabled={flipping || autoRunning}
              className="px-3 py-2 rounded-lg bg-craft-gray text-gray-400 hover:text-craft-green text-xs border border-white/10 transition-colors disabled:opacity-40">↺</button>
          </div>
          {fairData && <FairPanel data={fairData} clientSeed="" setClientSeed={() => {}} disabled={true} showSeedInput={false} />}
        </div>
        <button onClick={() => { if (autoRunning) { autoRef.current = false; setAutoRunning(false); } else doFlip(nonce, clientSeed); }}
          disabled={!canBet && !autoRunning}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: canBet || autoRunning ? autoRunning ? 'linear-gradient(135deg,#ef4444,#b91c1c)' : 'linear-gradient(135deg,#00ff88,#00cc6a)' : undefined, backgroundColor: (!canBet && !autoRunning) ? '#1a1f1a' : undefined, color: canBet || autoRunning ? '#000' : '#6b7280' }}
        >
          {autoRunning ? '⏹ Stop Auto' : flipping ? '🪙 Flipping…' : '🪙 Flip'}
        </button>
        {/* Auto flip */}
        <div className="glass rounded-2xl p-5 space-y-3">
          <h3 className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Auto Flip</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Stop on profit</label>
              <input type="number" value={stopOnProfit} onChange={e => setStopOnProfit(e.target.value)} placeholder="e.g. 5000" disabled={autoRunning}
                className="w-full bg-craft-gray border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-craft-green transition-colors disabled:opacity-40" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Stop on loss</label>
              <input type="number" value={stopOnLoss} onChange={e => setStopOnLoss(e.target.value)} placeholder="e.g. 2000" disabled={autoRunning}
                className="w-full bg-craft-gray border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-craft-green transition-colors disabled:opacity-40" />
            </div>
          </div>
          <button onClick={() => { if (autoRunning) { autoRef.current = false; setAutoRunning(false); } else { setSessionProfit(0); setAutoRunning(true); } }}
            disabled={!canBet && !autoRunning}
            className={`w-full py-3 rounded-xl font-bold text-sm transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${autoRunning ? 'bg-red-500/20 border-red-400/40 text-red-300 hover:bg-red-500/30' : 'bg-craft-gray border-craft-green/30 text-craft-green hover:bg-craft-green/10'}`}
          >{autoRunning ? '⏹ Stop Auto' : '▶ Start Auto Flip'}</button>
        </div>
        {/* History */}
        {history.length > 0 && (
          <div className="glass rounded-2xl p-4">
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">History</h3>
            <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
              {history.map((h, i) => (
                <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${h.won ? 'bg-craft-green/10 text-craft-green' : 'bg-red-500/10 text-red-400'}`}>
                  <span className="capitalize font-semibold">{h.result}</span>
                  <span className="font-bold">{h.won ? '+' : '−'}{Math.abs(h.won ? h.profit : h.bet).toLocaleString()} WL</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════════
// PVP TAB
// ════════════════════════════════════════════════════════════════════════════════
const PVPTab = () => {
  const { user, updateBalance } = useAuth();
  const [bet, setBet]   = useState(100);
  const [side, setSide] = useState('heads');
  const [clientSeed, setClientSeed] = useState(generateClientSeed);
  const [creating, setCreating]     = useState(false);
  const [myGame, setMyGame]         = useState(null);
  const pollRef                     = useRef(null);
  const [lobbyGames, setLobbyGames] = useState([]);
  const [lobbyLoading, setLobbyLoading] = useState(false);
  const [joinResult, setJoinResult]     = useState(null);
  const [joining, setJoining]           = useState(null);
  const [flipping, setFlipping]         = useState(false);

  const fetchLobby = useCallback(async () => {
    setLobbyLoading(true);
    try { const { data } = await axios.get(`${API_URL}/api/coinflip/pvp/lobby`, { headers: authHeaders() }); setLobbyGames(data.games || []); }
    catch (_) {} setLobbyLoading(false);
  }, []);

  useEffect(() => { fetchLobby(); const id = setInterval(fetchLobby, 4000); return () => clearInterval(id); }, [fetchLobby]);

  const startPolling = useCallback((gameId) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API_URL}/api/coinflip/pvp/game/${gameId}`, { headers: authHeaders() });
        if (data.status === 'resolved') {
          clearInterval(pollRef.current);
          setMyGame(data);
          const me = await axios.get(`${API_URL}/api/user/me`, { headers: authHeaders() });
          updateBalance(me.data.balance);
        } else if (data.status === 'cancelled') { clearInterval(pollRef.current); setMyGame(null); }
      } catch (_) {}
    }, 2000);
  }, [updateBalance]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { data } = await axios.post(`${API_URL}/api/coinflip/pvp/create`, { bet, side, clientSeed }, { headers: authHeaders() });
      updateBalance(user.balance - bet);
      setMyGame({ ...data, status: 'waiting', creatorSide: side, joinerSide: side === 'heads' ? 'tails' : 'heads' });
      startPolling(data.gameId);
      setClientSeed(generateClientSeed());
    } catch (err) { console.error(err); }
    setCreating(false);
  };

  const handleCancel = async () => {
    if (!myGame) return;
    try {
      const { data } = await axios.post(`${API_URL}/api/coinflip/pvp/cancel`, { gameId: myGame.gameId }, { headers: authHeaders() });
      clearInterval(pollRef.current); setMyGame(null); updateBalance(data.balance);
    } catch (_) {}
  };

  const handleJoin = async (gameId) => {
    setJoining(gameId); setJoinResult(null); setFlipping(true);
    try {
      await new Promise(r => setTimeout(r, 900));
      const { data } = await axios.post(`${API_URL}/api/coinflip/pvp/join`, { gameId }, { headers: authHeaders() });
      setFlipping(false); setJoinResult(data); updateBalance(data.balance); fetchLobby();
    } catch (err) { setFlipping(false); console.error(err); }
    setJoining(null);
  };

  const isMyGameResolved = myGame?.status === 'resolved';
  const iCreatedWon = isMyGameResolved && myGame.winnerId === user?._id;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
      {/* Left: coin / results / lobby */}
      <div className="flex flex-col gap-6">
        {/* Join result */}
        <AnimatePresence>
          {joinResult && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className={`glass rounded-2xl p-8 flex flex-col items-center gap-4 border-2 ${joinResult.winnerId === user?._id ? 'border-craft-green/50' : 'border-red-500/40'}`}>
              <FlippingCoin flipping={false} result={joinResult.result} />
              <div className="text-center">
                <p className={`text-3xl font-black ${joinResult.winnerId === user?._id ? 'text-craft-green' : 'text-red-400'}`}>
                  {joinResult.winnerId === user?._id ? '🏆 YOU WIN!' : '💀 YOU LOSE'}
                </p>
                <p className="text-gray-400 mt-1">Coin: <span className="text-white font-bold capitalize">{joinResult.result}</span></p>
                <p className="text-gray-400 text-sm mt-1">Winner: <span className="text-yellow-300 font-bold">{joinResult.winnerUsername}</span></p>
                {joinResult.winnerId === user?._id && <p className="text-craft-green font-bold text-xl mt-2">+{(joinResult.payout - joinResult.bet).toLocaleString()} WL profit</p>}
              </div>
              <FairPanel data={joinResult} clientSeed="" setClientSeed={() => {}} disabled={true} showSeedInput={false} />
              <button onClick={() => setJoinResult(null)} className="px-6 py-2 rounded-xl bg-craft-gray border border-white/20 text-gray-300 text-sm hover:border-craft-green/40 hover:text-craft-green transition-colors">Back to Lobby</button>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Flip animation for joiner */}
        <AnimatePresence>
          {flipping && !joinResult && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass rounded-2xl p-8 flex flex-col items-center gap-4">
              <FlippingCoin flipping={true} result={null} />
              <p className="text-gray-400 animate-pulse">Flipping…</p>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Creator waiting */}
        {myGame && myGame.status === 'waiting' && !joinResult && !flipping && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 border border-yellow-400/20">
            <h3 className="text-yellow-300 font-bold text-lg mb-4">⏳ Waiting for a challenger…</h3>
            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
              <div><p className="text-gray-500">Your side</p>
                <div className="flex items-center gap-2 mt-1"><CoinFace side={myGame.creatorSide} size={24} /><span className="text-white font-bold capitalize">{myGame.creatorSide}</span></div>
              </div>
              <div><p className="text-gray-500">Pot</p><p className="text-craft-green font-bold text-lg mt-1">{(myGame.bet * 2).toLocaleString()} WL</p></div>
            </div>
            <div className="text-xs text-gray-600 font-mono break-all mb-4">Game ID: {myGame.gameId}</div>
            <button onClick={handleCancel} className="w-full py-3 rounded-xl font-bold text-sm bg-red-500/10 border border-red-400/40 text-red-400 hover:bg-red-500/20 transition-colors">Cancel & Refund</button>
          </motion.div>
        )}
        {/* Creator resolved */}
        {myGame && isMyGameResolved && !joinResult && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className={`glass rounded-2xl p-8 flex flex-col items-center gap-4 border-2 ${iCreatedWon ? 'border-craft-green/50' : 'border-red-500/40'}`}>
            <FlippingCoin flipping={false} result={myGame.result} />
            <div className="text-center">
              <p className={`text-3xl font-black ${iCreatedWon ? 'text-craft-green' : 'text-red-400'}`}>{iCreatedWon ? '🏆 YOU WIN!' : '💀 YOU LOSE'}</p>
              <p className="text-gray-400 mt-1">Coin: <span className="text-white font-bold capitalize">{myGame.result}</span></p>
              <p className="text-gray-400 text-sm mt-1">Opponent: <span className="text-white font-bold">{myGame.joinerUsername}</span></p>
            </div>
            <FairPanel data={myGame} clientSeed="" setClientSeed={() => {}} disabled={true} showSeedInput={false} />
            <button onClick={() => setMyGame(null)} className="px-6 py-2 rounded-xl bg-craft-gray border border-white/20 text-gray-300 text-sm hover:border-craft-green/40 hover:text-craft-green transition-colors">New Game</button>
          </motion.div>
        )}
        {/* Lobby */}
        {!myGame && !joinResult && !flipping && (
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-lg">🎰 Open Games</h3>
              <button onClick={fetchLobby} disabled={lobbyLoading} className="text-xs text-gray-500 hover:text-craft-green transition-colors disabled:opacity-40">{lobbyLoading ? '…' : '↺ Refresh'}</button>
            </div>
            {lobbyGames.length === 0 ? (
              <div className="text-center py-10 text-gray-600"><p className="text-4xl mb-2">🪙</p><p>No open games.</p><p className="text-sm mt-1">Be the first to create one!</p></div>
            ) : (
              <div className="flex flex-col gap-3">
                {lobbyGames.map(game => (
                  <div key={game.gameId} className="flex items-center justify-between p-4 rounded-xl bg-black/30 border border-white/10 hover:border-white/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <CoinFace side={game.creatorSide} size={32} />
                      <div>
                        <p className="text-white font-semibold text-sm">{game.creatorUsername}</p>
                        <p className="text-gray-500 text-xs capitalize">{game.creatorSide} · Pot: <span className="text-craft-green font-bold">{game.pot.toLocaleString()} WL</span></p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-white font-bold">{game.bet.toLocaleString()} WL</p>
                        <div className="flex items-center gap-1 justify-end mt-0.5">
                          <CoinFace side={game.joinerSide} size={14} /><span className="text-gray-400 text-xs capitalize">{game.joinerSide}</span>
                        </div>
                      </div>
                      <button onClick={() => handleJoin(game.gameId)}
                        disabled={joining === game.gameId || game.creatorUsername === user?.username || (user?.balance || 0) < game.bet}
                        className="px-4 py-2 rounded-xl font-bold text-sm bg-craft-green/20 border border-craft-green/40 text-craft-green hover:bg-craft-green/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        {joining === game.gameId ? '…' : 'Join'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Right: Create game */}
      {!myGame && !joinResult && !flipping && (
        <div className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-5">
            <h3 className="text-white font-bold text-lg mb-1">Create a Game</h3>
            <p className="text-gray-500 text-xs mb-0">Pick a side and wait for a challenger.</p>
          </div>
          <SidePicker side={side} setSide={setSide} disabled={creating} />
          <BetInput bet={bet} setBet={setBet} maxBalance={user?.balance} disabled={creating} />
          <div className="glass rounded-2xl p-4 text-xs text-gray-500 space-y-1">
            <div className="flex justify-between"><span>Pot</span><span className="text-white">{(bet * 2).toLocaleString()} WL</span></div>
            <div className="flex justify-between"><span>Win payout (3% edge)</span><span className="text-craft-green font-bold">{Math.floor(bet * 2 * 0.97).toLocaleString()} WL</span></div>
          </div>
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wider">🔐 Client Seed</h3>
            <div className="flex gap-2">
              <input type="text" value={clientSeed} onChange={e => setClientSeed(e.target.value.slice(0, 64))} disabled={creating}
                className="flex-1 bg-craft-gray border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-craft-green transition-colors disabled:opacity-40" />
              <button onClick={() => setClientSeed(generateClientSeed())} disabled={creating}
                className="px-3 py-2 rounded-lg bg-craft-gray text-gray-400 hover:text-craft-green text-xs border border-white/10 transition-colors disabled:opacity-40">↺</button>
            </div>
          </div>
          <button onClick={handleCreate} disabled={creating || bet < 1 || bet > (user?.balance || 0)}
            className="w-full py-4 rounded-xl font-bold text-lg transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: (!creating && bet >= 1 && bet <= (user?.balance || 0)) ? 'linear-gradient(135deg,#00ff88,#00cc6a)' : undefined, backgroundColor: (creating || bet < 1 || bet > (user?.balance || 0)) ? '#1a1f1a' : undefined, color: (!creating && bet >= 1 && bet <= (user?.balance || 0)) ? '#000' : '#6b7280' }}
          >{creating ? '⏳ Creating…' : '🪙 Create Game'}</button>
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════════
// ROOT — tab switcher
// ════════════════════════════════════════════════════════════════════════════════
const Coinflip = () => {
  const [tab, setTab] = useState('pvp');
  return (
    <div className="pt-24 px-4 max-w-5xl mx-auto pb-12">
      <h1 className="text-3xl font-bold mb-6 text-center">
        <span className="text-yellow-400">Coin</span><span className="text-white">flip</span>
      </h1>
      <div className="flex justify-center mb-8">
        <div className="glass rounded-2xl p-1 flex gap-1">
          {[{ key: 'pvp', label: '⚔️ PVP', sub: 'Player vs Player' }, { key: 'solo', label: '🪙 Solo', sub: 'Instant flip' }].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-6 py-3 rounded-xl font-semibold text-sm transition-all flex flex-col items-center ${tab === t.key ? 'bg-craft-green/20 border border-craft-green/40 text-craft-green' : 'text-gray-500 hover:text-gray-300'}`}>
              <span>{t.label}</span>
              <span className="text-xs font-normal opacity-70 mt-0.5">{t.sub}</span>
            </button>
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
          {tab === 'pvp'  && <PVPTab />}
          {tab === 'solo' && <SoloTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default Coinflip;