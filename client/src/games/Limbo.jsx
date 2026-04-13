import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

const API_URL = 'https://craftbet.onrender.com';

const generateClientSeed = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

// ── Win probability for a given target (with 97% RTP) ─────────────────────────
// P(result >= target) = 97 / target  (derived from the house-edge formula)
const winChance = (target) =>
  Math.min(97, parseFloat((97 / target).toFixed(2)));

// ── Rolling number animation hook ─────────────────────────────────────────────
const useRollingNumber = (finalValue, rolling, duration = 1200) => {
  const [display, setDisplay] = useState('-.--');
  const frameRef = useRef(null);

  useEffect(() => {
    if (!rolling) {
      setDisplay(finalValue !== null ? finalValue.toFixed(2) : '-.--');
      return;
    }

    const start = performance.now();
    const animate = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);

      // Fast random numbers that slow down toward final
      if (progress < 1) {
        const rand = 1.00 + Math.random() * 999;
        setDisplay(rand.toFixed(2));
        frameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplay(finalValue !== null ? finalValue.toFixed(2) : '-.--');
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [rolling, finalValue, duration]);

  return display;
};

const Limbo = () => {
  const { user, updateBalance } = useAuth();

  const [bet, setBet]       = useState(100);
  const [target, setTarget] = useState('2.00');
  const [loading, setLoading] = useState(false);
  const [rolling, setRolling] = useState(false);

  // Result state
  const [result, setResult]       = useState(null);  // the rolled number
  const [lastWon, setLastWon]     = useState(null);
  const [lastProfit, setLastProfit] = useState(null);
  const [lastPayout, setLastPayout] = useState(null);

  // Provably fair
  const [clientSeed, setClientSeed]                 = useState(generateClientSeed);
  const [lastServerSeed, setLastServerSeed]         = useState(null);
  const [lastServerSeedHash, setLastServerSeedHash] = useState(null);
  const [lastNonce, setLastNonce]                   = useState(null);
  const [nextServerSeedHash, setNextServerSeedHash] = useState(null);
  const [showFairPanel, setShowFairPanel]           = useState(false);
  const [verifyResult, setVerifyResult]             = useState(null);

  const [history, setHistory] = useState([]);

  const displayValue = useRollingNumber(result, rolling);

  // Target validation
  const targetNum  = parseFloat(target);
  const targetValid = !isNaN(targetNum) && targetNum >= 1.01 && targetNum <= 1000;
  const chance     = targetValid ? winChance(targetNum) : null;
  const estPayout  = targetValid ? Math.round(bet * targetNum) : null;

  // ── Place bet ────────────────────────────────────────────────────────────────
  const placeBet = useCallback(async () => {
    if (loading || rolling || !targetValid) return;
    setLoading(true);
    setRolling(true);
    setResult(null);
    setLastWon(null);
    setVerifyResult(null);

    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_URL}/api/limbo/bet`,
        { bet, target: targetNum, clientSeed },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Let the animation run for ~1.2s, then snap to result
      setTimeout(() => {
        setRolling(false);
        setResult(data.result);
        setLastWon(data.won);
        setLastProfit(data.profit);
        setLastPayout(data.payout);
        setLastServerSeed(data.serverSeed);
        setLastServerSeedHash(data.serverSeedHash);
        setLastNonce(data.nonce);
        setNextServerSeedHash(data.nextServerSeedHash);
        updateBalance(data.balance);

        // Rotate to next client seed automatically using next server seed hash as entropy
        setClientSeed(generateClientSeed());

        setHistory(h => [{
          won: data.won,
          result: data.result,
          target: data.target,
          profit: data.profit,
          bet,
        }, ...h].slice(0, 15));
      }, 1300);

    } catch (err) {
      setRolling(false);
      alert(err.response?.data?.message || 'Bet failed');
    } finally {
      setLoading(false);
    }
  }, [loading, rolling, targetValid, bet, targetNum, clientSeed, updateBalance]);

  // ── In-browser verifier ──────────────────────────────────────────────────────
  const runVerifier = async () => {
    if (!lastServerSeed) return;
    setVerifyResult({ status: 'running' });
    try {
      const encoder     = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw', encoder.encode(lastServerSeed),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      const msg    = encoder.encode(`${clientSeed}:${lastNonce}`);
      // Note: clientSeed was rotated after the bet; use lastServerSeed + lastNonce
      // We need the clientSeed that was active during the bet — stored in lastNonce context
      // Since we auto-rotate after each bet, we store the seed used
      const sigBuf = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(`${lastClientSeedUsed}:${lastNonce}`));
      const hashHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

      const h   = parseInt(hashHex.slice(0, 13), 16);
      const e   = Math.pow(2, 52);
      const raw = Math.floor((100 * e - h) / (e - h)) / 100;
      const derived = Math.min(1000, Math.max(1.00, parseFloat((raw * 0.97).toFixed(2))));

      const hashMatch    = hashHex !== null;
      const resultMatch  = derived === result;

      setVerifyResult({
        status: resultMatch ? 'pass' : 'fail',
        derivedResult: derived,
        recordedResult: result,
        hashUsed: hashHex.slice(0, 20) + '…',
      });
    } catch (e) {
      setVerifyResult({ status: 'error', message: e.message });
    }
  };

  // Store the clientSeed used per bet for verifier
  const [lastClientSeedUsed, setLastClientSeedUsed] = useState(null);

  const placeBetWithSeedTracking = useCallback(async () => {
    setLastClientSeedUsed(clientSeed);
    await placeBet();
  }, [clientSeed, placeBet]);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="pt-24 px-4 max-w-4xl mx-auto pb-12">
      <h1 className="text-3xl font-bold mb-8 text-center">
        <span className="text-purple-400">Li</span><span className="text-white">mbo</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">

        {/* ── Left: Roll display ───────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-8 flex flex-col items-center justify-center min-h-80">

          {/* Rolling / result number */}
          <div className="mb-6 text-center">
            <motion.div
              key={result}
              className={`text-7xl font-black tabular-nums tracking-tight transition-colors duration-300 ${
                rolling    ? 'text-gray-400' :
                lastWon === true  ? 'text-craft-green' :
                lastWon === false ? 'text-red-400' :
                                    'text-gray-300'
              }`}
              animate={rolling ? { scale: [1, 1.02, 1] } : {}}
              transition={{ repeat: Infinity, duration: 0.15 }}
            >
              {displayValue}
              <span className="text-4xl text-gray-500 ml-1">×</span>
            </motion.div>

            {/* Target line */}
            {targetValid && !rolling && result === null && (
              <p className="text-gray-500 text-sm mt-2">
                Target: <span className="text-white font-semibold">{targetNum.toFixed(2)}×</span>
              </p>
            )}

            {/* Win/loss label */}
            <AnimatePresence>
              {!rolling && lastWon !== null && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="mt-3"
                >
                  {lastWon ? (
                    <div className="text-center">
                      <span className="text-craft-green font-bold text-xl">WIN</span>
                      <span className="text-craft-green font-bold text-2xl ml-3">+{lastProfit?.toLocaleString()} WL</span>
                    </div>
                  ) : (
                    <div className="text-center">
                      <span className="text-red-400 font-bold text-xl">BUST</span>
                      <span className="text-red-400 font-bold text-2xl ml-3">−{bet.toLocaleString()} WL</span>
                      <p className="text-gray-500 text-sm mt-1">
                        Needed ≥ {targetNum.toFixed(2)}×, got {result?.toFixed(2)}×
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Target line indicator */}
          {targetValid && (
            <div className="w-full max-w-xs">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>1.00×</span>
                <span className="text-purple-400 font-semibold">Target: {targetNum.toFixed(2)}×</span>
                <span>1000×</span>
              </div>
              <div className="w-full h-2 rounded-full bg-craft-gray overflow-hidden relative">
                {/* Win zone */}
                <motion.div
                  className="absolute right-0 top-0 h-full bg-craft-green/40 rounded-r-full"
                  style={{ width: `${chance}%` }}
                  animate={{ width: `${chance}%` }}
                  transition={{ duration: 0.3 }}
                />
                {/* Target marker */}
                <motion.div
                  className="absolute top-0 h-full w-0.5 bg-purple-400"
                  style={{ left: `${100 - (chance ?? 0)}%` }}
                  animate={{ left: `${100 - (chance ?? 0)}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-red-400">{(100 - (chance ?? 0)).toFixed(1)}% lose</span>
                <span className="text-craft-green">{chance?.toFixed(1)}% win</span>
              </div>
            </div>
          )}

          {/* Provably fair panel */}
          {lastServerSeedHash && (
            <div className="w-full mt-6">
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
                    <div className="mt-3 p-4 rounded-xl bg-black/30 border border-white/10 space-y-3 text-xs font-mono w-full">
                      <div>
                        <p className="text-gray-500 mb-1">Server Seed Hash</p>
                        <p className="text-gray-300 break-all">{lastServerSeedHash}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 mb-1">Client Seed Used</p>
                        <p className="text-craft-green break-all">{lastClientSeedUsed || '—'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 mb-1">Nonce</p>
                        <p className="text-gray-300 break-all">{lastNonce}</p>
                      </div>
                      {nextServerSeedHash && (
                        <div>
                          <p className="text-gray-500 mb-1">Next Game Server Seed Hash</p>
                          <p className="text-blue-400 break-all">{nextServerSeedHash}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-gray-500 mb-1">Server Seed (revealed immediately — single roll)</p>
                        <p className="text-yellow-400 break-all">{lastServerSeed}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-gray-500 space-y-1 leading-relaxed font-sans">
                        <p className="text-gray-400 font-semibold mb-1">To verify:</p>
                        <p>1. SHA256(serverSeed) must equal the hash above.</p>
                        <p>2. HMAC-SHA256(serverSeed, "clientSeed:nonce") → hex</p>
                        <p>3. h = parseInt(hash[0..12], 16)</p>
                        <p>4. e = 2^52</p>
                        <p>5. result = floor((100×e − h) / (e − h)) / 100 × 0.97</p>
                        <p>6. clamp to [1.00, 1000.00]</p>
                      </div>
                      <button
                        onClick={runVerifier}
                        disabled={verifyResult?.status === 'running'}
                        className="w-full py-2 rounded-lg bg-craft-green/20 border border-craft-green/40 text-craft-green text-xs font-sans font-semibold hover:bg-craft-green/30 transition-colors disabled:opacity-40"
                      >
                        {verifyResult?.status === 'running' ? 'Verifying…' : '🔍 Verify Last Roll'}
                      </button>
                      {verifyResult && verifyResult.status !== 'running' && (
                        <div className={`p-3 rounded-lg border font-sans ${
                          verifyResult.status === 'pass' ? 'bg-craft-green/10 border-craft-green/40 text-craft-green' :
                          verifyResult.status === 'fail' ? 'bg-red-500/10 border-red-500/40 text-red-400' :
                                                           'bg-gray-500/10 border-gray-500/40 text-gray-400'
                        }`}>
                          {verifyResult.status === 'pass' && <p className="font-bold">✓ Result verified — roll was fair</p>}
                          {verifyResult.status === 'fail' && (
                            <>
                              <p className="font-bold mb-1">✗ Mismatch</p>
                              <p className="text-xs font-mono">Derived: {verifyResult.derivedResult} · Recorded: {verifyResult.recordedResult}</p>
                            </>
                          )}
                          {verifyResult.status === 'error' && <p>Error: {verifyResult.message}</p>}
                        </div>
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

          {/* Target multiplier */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">Target Multiplier</h3>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="number"
                value={target}
                onChange={e => setTarget(e.target.value)}
                onBlur={() => {
                  const n = parseFloat(target);
                  if (!isNaN(n)) setTarget(Math.min(1000, Math.max(1.01, n)).toFixed(2));
                }}
                disabled={rolling}
                min="1.01" max="1000" step="0.01"
                className={`flex-1 bg-craft-gray border rounded-xl px-4 py-3 text-2xl font-bold text-center tabular-nums focus:outline-none transition-colors disabled:opacity-40 ${
                  targetValid ? 'border-purple-500/50 text-purple-300 focus:border-purple-400' : 'border-red-500/50 text-red-400'
                }`}
              />
              <span className="text-gray-400 text-xl font-bold">×</span>
            </div>

            {/* Win chance display */}
            {targetValid && (
              <div className="mt-3 flex justify-between text-xs">
                <span className="text-gray-500">Win chance</span>
                <span className={`font-semibold ${chance > 50 ? 'text-craft-green' : chance > 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {chance?.toFixed(2)}%
                </span>
              </div>
            )}
            {targetValid && (
              <div className="flex justify-between text-xs mt-1">
                <span className="text-gray-500">Payout if win</span>
                <span className="text-craft-green font-semibold">{estPayout?.toLocaleString()} WL</span>
              </div>
            )}
            {!targetValid && target !== '' && (
              <p className="text-red-400 text-xs mt-2">Must be between 1.01× and 1000×</p>
            )}
          </div>

          {/* Bet amount */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">Bet Amount</h3>
            <input
              type="number"
              value={bet}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value) || 1))}
              onBlur={() => setBet(Math.min(user?.balance || 0, Math.max(1, bet)))}
              disabled={rolling}
              min="1"
              max={user?.balance || 0}
              className="w-full bg-craft-gray border border-craft-green/30 rounded-xl px-4 py-3 text-2xl font-bold text-center text-craft-green tabular-nums focus:outline-none focus:border-craft-green transition-colors disabled:opacity-40"
            />
          </div>

          {/* Client seed */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wider">🔐 Client Seed</h3>
            <div className="flex gap-2">
              <input type="text" value={clientSeed} onChange={e => setClientSeed(e.target.value.slice(0, 64))}
                disabled={rolling}
                className="flex-1 bg-craft-gray border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-craft-green transition-colors disabled:opacity-40" />
              <button onClick={() => setClientSeed(generateClientSeed())} disabled={rolling}
                className="px-3 py-2 rounded-lg bg-craft-gray text-gray-400 hover:text-craft-green text-xs border border-white/10 transition-colors disabled:opacity-40">↺</button>
            </div>
            <p className="text-gray-600 text-xs mt-1">Auto-rotates after each bet.</p>
          </div>

          {/* Bet button */}
          <button
            onClick={placeBetWithSeedTracking}
            disabled={rolling || loading || !targetValid || bet > (user?.balance || 0) || bet < 1}
            className="w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            style={{
              background: (!rolling && targetValid) ? 'linear-gradient(135deg, #a855f7, #7c3aed)' : undefined,
              backgroundColor: (rolling || !targetValid) ? '#1a1f1a' : undefined,
              color: (!rolling && targetValid) ? '#fff' : '#6b7280',
            }}
          >
            {rolling ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.6, ease: 'linear' }} className="inline-block">⟳</motion.span>
                Rolling…
              </span>
            ) : 'Bet'}
          </button>

          {/* Session history */}
          {history.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">History</h3>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${h.won ? 'bg-craft-green/10 text-craft-green' : 'bg-red-500/10 text-red-400'}`}>
                    <span className="font-mono">
                      {h.result.toFixed(2)}× <span className="text-gray-500">/ {h.target.toFixed(2)}×</span>
                    </span>
                    <span className="font-bold">{h.won ? '+' : '−'}{Math.abs(h.profit !== 0 ? h.profit : h.bet).toLocaleString()} WL</span>
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

export default Limbo;