import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MODES = {
  REME: 'REME',
  QQ:   'QQ',
  CSN:  'CSN',
};

const GAME_TYPES = {
  VS_HOUSE:  'vs_house',
  VS_PLAYER: 'vs_player',
};

const STARTING_BALANCE = 1000;
const MIN_BET = 1;

// European roulette wheel order (0-36)
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36,
  11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9,
  22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const TOTAL_SLOTS = WHEEL_ORDER.length; // 37
const SLOT_ANGLE  = 360 / TOTAL_SLOTS;  // ≈9.73°

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const getColor = (n) => n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black';

// ─────────────────────────────────────────────────────────────────────────────
// GAME LOGIC
// ─────────────────────────────────────────────────────────────────────────────

/** Spin: returns a random number 0–36 */
const spinWheel = () => Math.floor(Math.random() * 37);

/** REME: digit sum, reduce to single digit via mod 10 */
const remeValue = (n) => {
  const sum = Math.floor(n / 10) + (n % 10);
  return sum >= 10 ? sum % 10 : sum;
};

/** QQ: last digit */
const qqValue = (n) => n % 10;

/** CSN: raw number */
const csnValue = (n) => n;

/** Get the "score" for a given mode */
const getScore = (n, mode) => {
  if (mode === MODES.REME) return remeValue(n);
  if (mode === MODES.QQ)   return qqValue(n);
  return csnValue(n);
};

/**
 * Compare two scores. Returns:
 *  +1 if a wins, -1 if b wins, 0 if tie
 * Note: 0 is the highest value in REME/QQ, but NOT in CSN.
 */
const compareScores = (a, b, mode) => {
  if (mode === MODES.CSN) {
    if (a > b) return 1;
    if (a < b) return -1;
    return 0;
  }
  // REME / QQ: 0 is highest
  if (a === 0 && b !== 0) return 1;
  if (b === 0 && a !== 0) return -1;
  if (a === 0 && b === 0) return 0;
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
};

/**
 * Calculate payout multiplier.
 * CSN: always 2x.
 * REME/QQ: 3x if winner's score is 0, else 2x.
 * PvP: no 3x bonus (always 2x).
 */
const getMultiplier = (winnerScore, mode, gameType) => {
  if (mode === MODES.CSN) return 2;
  if (gameType === GAME_TYPES.VS_PLAYER) return 2;
  return winnerScore === 0 ? 3 : 2;
};

// ─────────────────────────────────────────────────────────────────────────────
// WHEEL SVG COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const RouletteWheel = ({ rotation, spinning }) => {
  const cx = 150, cy = 150, r = 135, innerR = 55;

  const slots = WHEEL_ORDER.map((num, i) => {
    const startAngle = i * SLOT_ANGLE - SLOT_ANGLE / 2;
    const endAngle   = startAngle + SLOT_ANGLE;
    const toRad      = (deg) => (deg * Math.PI) / 180;

    const x1 = cx + r * Math.sin(toRad(startAngle));
    const y1 = cy - r * Math.cos(toRad(startAngle));
    const x2 = cx + r * Math.sin(toRad(endAngle));
    const y2 = cy - r * Math.cos(toRad(endAngle));
    const xi1 = cx + innerR * Math.sin(toRad(startAngle));
    const yi1 = cy - innerR * Math.cos(toRad(startAngle));
    const xi2 = cx + innerR * Math.sin(toRad(endAngle));
    const yi2 = cy - innerR * Math.cos(toRad(endAngle));

    const color = getColor(num);
    const fill  = color === 'red' ? '#c0392b' : color === 'green' ? '#27ae60' : '#1a1a2e';

    const midAngle  = toRad(i * SLOT_ANGLE);
    const textR     = (r + innerR) / 2;
    const tx        = cx + textR * Math.sin(midAngle);
    const ty        = cy - textR * Math.cos(midAngle);
    const textAngle = i * SLOT_ANGLE;

    return (
      <g key={num}>
        <path
          d={`M ${xi1} ${yi1} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} L ${xi2} ${yi2} A ${innerR} ${innerR} 0 0 0 ${xi1} ${yi1} Z`}
          fill={fill}
          stroke="#0a0f0a"
          strokeWidth="0.8"
        />
        <text
          x={tx} y={ty}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="7.5"
          fontWeight="700"
          fill="#ffffff"
          transform={`rotate(${textAngle}, ${tx}, ${ty})`}
          style={{ fontFamily: 'monospace' }}
        >
          {num}
        </text>
      </g>
    );
  });

  return (
    <div className="relative" style={{ width: 300, height: 300 }}>
      {/* Outer glow ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: spinning
            ? '0 0 40px rgba(255,215,0,0.5), 0 0 80px rgba(255,215,0,0.2)'
            : '0 0 20px rgba(255,215,0,0.15)',
          borderRadius: '50%',
          transition: 'box-shadow 0.5s ease',
        }}
      />
      {/* Pointer / ball indicator */}
      <div
        className="absolute z-20"
        style={{
          top: '4px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderTop: '20px solid #ffd700',
          filter: 'drop-shadow(0 0 6px rgba(255,215,0,0.8))',
        }}
      />

      <motion.svg
        viewBox="0 0 300 300"
        width={300}
        height={300}
        style={{ display: 'block' }}
        animate={{ rotate: rotation }}
        transition={spinning
          ? { duration: 0, ease: 'linear' }
          : { duration: 0 }
        }
      >
        {/* Outer rim */}
        <circle cx={cx} cy={cy} r={r + 8} fill="#1a1408" stroke="#ffd700" strokeWidth="3" />
        <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#8B6914" strokeWidth="2" />

        {slots}

        {/* Center hub */}
        <circle cx={cx} cy={cy} r={innerR} fill="#0a0f0a" stroke="#ffd700" strokeWidth="2" />
        <circle cx={cx} cy={cy} r={innerR - 8} fill="none" stroke="#8B6914" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={10} fill="#ffd700" />
        <circle cx={cx} cy={cy} r={5} fill="#1a1408" />

        {/* Decorative dots around inner hub */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          const dx = cx + (innerR - 18) * Math.sin(rad);
          const dy = cy - (innerR - 18) * Math.cos(rad);
          return <circle key={angle} cx={dx} cy={dy} r={2.5} fill="#ffd700" opacity="0.7" />;
        })}
      </motion.svg>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// RESULT BADGE
// ─────────────────────────────────────────────────────────────────────────────

const NumberBadge = ({ number, label, score, mode, size = 'md' }) => {
  const color  = getColor(number);
  const bg     = color === 'red' ? 'bg-red-600 border-red-400' : color === 'green' ? 'bg-emerald-600 border-emerald-400' : 'bg-gray-800 border-gray-500';
  const sz     = size === 'lg' ? 'w-16 h-16 text-2xl' : 'w-12 h-12 text-xl';

  return (
    <div className="flex flex-col items-center gap-1.5">
      {label && <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">{label}</p>}
      <div className={`${sz} ${bg} rounded-full border-2 flex items-center justify-center font-black text-white shadow-lg`}>
        {number}
      </div>
      {score !== undefined && (
        <div className="text-center">
          <p className="text-xs text-gray-500">{mode === MODES.REME ? 'digit sum' : mode === MODES.QQ ? 'last digit' : 'value'}</p>
          <p className="text-lg font-black text-amber-300 leading-none">{score === 0 ? <span className="text-yellow-300">0 ✦</span> : score}</p>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY LOG
// ─────────────────────────────────────────────────────────────────────────────

const HistoryLog = ({ history }) => {
  if (!history.length) return null;
  return (
    <div className="glass-dark rounded-2xl p-4">
      <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-3 font-semibold">Last 5 Rounds</h3>
      <div className="flex flex-col gap-2">
        {history.map((h, i) => (
          <div key={i} className="flex items-center justify-between text-xs bg-black/30 rounded-xl px-3 py-2">
            <span className="text-gray-500 font-mono w-4">{i + 1}</span>
            <span className="text-gray-400">{h.mode} · {h.gameType === GAME_TYPES.VS_HOUSE ? 'vs House' : 'vs Player'}</span>
            <span className={`font-bold ${h.won ? 'text-emerald-400' : 'text-red-400'}`}>
              {h.won ? `+${h.profit}` : `-${h.bet}`}
            </span>
            <div className="flex gap-1">
              {[h.n1, h.n2].map((n, j) => {
                const c = getColor(n);
                return (
                  <span key={j} className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-white text-xs ${c === 'red' ? 'bg-red-600' : c === 'green' ? 'bg-emerald-700' : 'bg-gray-700'}`}>
                    {n}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CASINO COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const Casino = () => {
  const [mode,     setMode]     = useState(MODES.REME);
  const [gameType, setGameType] = useState(GAME_TYPES.VS_HOUSE);
  const [balance,  setBalance]  = useState(STARTING_BALANCE);
  const [bet,      setBet]      = useState(50);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result,   setResult]   = useState(null);   // { n1, n2, s1, s2, winner, multiplier, payout, profit }
  const [history,  setHistory]  = useState([]);
  const [phase,    setPhase]    = useState('idle'); // idle | spinning | result
  const rotRef = useRef(0);
  const animRef = useRef(null);

  // ── Clamp bet ──────────────────────────────────────────────────────────────
  const safeBet = Math.max(MIN_BET, Math.min(balance, bet));

  // ── Spin animation loop ────────────────────────────────────────────────────
  const runSpinAnimation = useCallback((targetNumber, onDone) => {
    const duration   = 2500 + Math.random() * 1500; // 2.5–4s
    const startTime  = performance.now();
    const startRot   = rotRef.current;

    // Find target slot index
    const slotIdx    = WHEEL_ORDER.indexOf(targetNumber);
    // Target rotation: many full rotations + land on slot
    const extraSpins = 6 + Math.floor(Math.random() * 4); // 6–9 full spins
    const slotAngle  = slotIdx * SLOT_ANGLE;
    // The pointer is at top (0°). We want the target slot at top.
    const targetRot  = startRot + (extraSpins * 360) + (360 - slotAngle);

    const ease = (t) => {
      // Ease-in-out cubic, but mostly fast then slow
      return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    const tick = (now) => {
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedP   = ease(progress);
      const current  = startRot + (targetRot - startRot) * easedP;

      rotRef.current = current;
      setRotation(current);

      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        rotRef.current = targetRot % 360;
        setRotation(targetRot % 360);
        onDone();
      }
    };

    animRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  // ── Resolve one round (may recurse for PvP ties) ───────────────────────────
  const resolveRound = useCallback((n1, n2, currentBet, isRespin = false) => {
    const s1   = getScore(n1, mode);
    const s2   = getScore(n2, mode);
    const cmp  = compareScores(s1, s2, mode);

    if (cmp === 0) {
      // Tie
      if (gameType === GAME_TYPES.VS_HOUSE) {
        // House wins on tie
        return { n1, n2, s1, s2, winner: 'house', multiplier: 0, payout: 0, profit: -currentBet, respin: false };
      } else {
        // PvP: flag for auto-respin
        return { n1, n2, s1, s2, winner: 'tie', multiplier: 0, payout: 0, profit: 0, respin: true };
      }
    }

    const playerWon = cmp === 1; // +1 = player/p1 wins
    const winnerScore = playerWon ? s1 : s2;
    const multiplier  = getMultiplier(winnerScore, mode, gameType);

    if (playerWon) {
      const payout = currentBet * multiplier;
      const profit = payout - currentBet;
      return { n1, n2, s1, s2, winner: 'player', multiplier, payout, profit, respin: false };
    } else {
      return { n1, n2, s1, s2, winner: 'opponent', multiplier: 0, payout: 0, profit: -currentBet, respin: false };
    }
  }, [mode, gameType]);

  // ── Main spin handler ──────────────────────────────────────────────────────
  const handleSpin = useCallback(async () => {
    if (spinning || safeBet < MIN_BET || safeBet > balance) return;

    setSpinning(true);
    setPhase('spinning');
    setResult(null);

    const n1 = spinWheel();
    const n2 = spinWheel();

    // Animate wheel to n1 (player's result — main visual)
    runSpinAnimation(n1, () => {
      const outcome = resolveRound(n1, n2, safeBet);

      if (outcome.respin) {
        // PvP tie — brief pause then respin automatically
        setTimeout(() => {
          const rn1 = spinWheel();
          const rn2 = spinWheel();
          runSpinAnimation(rn1, () => {
            const outcome2 = resolveRound(rn1, rn2, safeBet);
            finalise(rn1, rn2, outcome2);
          });
        }, 500);
      } else {
        finalise(n1, n2, outcome);
      }
    });
  }, [spinning, safeBet, balance, runSpinAnimation, resolveRound]);

  const finalise = (n1, n2, outcome) => {
    const newBalance = balance - safeBet + outcome.payout;
    setBalance(newBalance);
    setResult({ ...outcome, n1, n2 });
    setPhase('result');
    setSpinning(false);

    setHistory(prev => [{
      mode, gameType, n1, n2,
      won: outcome.winner === 'player',
      bet: safeBet,
      profit: outcome.profit,
    }, ...prev].slice(0, 5));
  };

  // ── Bet helpers ────────────────────────────────────────────────────────────
  const adjustBet = (mult) => setBet(b => Math.max(MIN_BET, Math.min(balance, Math.floor(b * mult))));
  const maxBet    = () => setBet(balance);

  const p1Label = gameType === GAME_TYPES.VS_HOUSE ? 'Player' : 'Player 1';
  const p2Label = gameType === GAME_TYPES.VS_HOUSE ? 'House'  : 'Player 2';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-craft-dark pt-24 pb-16 px-4" style={{ fontFamily: "'Georgia', serif" }}>

      {/* Page header */}
      <div className="max-w-4xl mx-auto mb-8 text-center">
        <h1 className="text-5xl font-black tracking-tight mb-1" style={{ letterSpacing: '-0.02em' }}>
          <span style={{ color: '#ffd700' }}>CASINO</span>
        </h1>
        <p className="text-gray-500 text-sm tracking-widest uppercase">Spin · Bet · Win</p>
      </div>

      <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">

        {/* ── LEFT: Wheel + result ─────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-6">

          {/* Mode selector */}
          <div className="flex gap-2 p-1 rounded-2xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {Object.values(MODES).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setResult(null); setPhase('idle'); }}
                disabled={spinning}
                className={`px-5 py-2 rounded-xl font-bold text-sm transition-all tracking-widest uppercase disabled:opacity-40 ${
                  mode === m
                    ? 'text-black'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
                style={mode === m ? { background: 'linear-gradient(135deg, #ffd700, #e6a817)' } : {}}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Roulette wheel */}
          <div className="relative flex items-center justify-center">
            <RouletteWheel rotation={rotation} spinning={spinning} />
          </div>

          {/* Result display */}
          <AnimatePresence mode="wait">
            {phase === 'spinning' && (
              <motion.div key="spinning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-center py-6">
                <p className="text-amber-400 font-bold tracking-widest uppercase text-sm animate-pulse">Spinning…</p>
              </motion.div>
            )}

            {phase === 'result' && result && (
              <motion.div key="result" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }}
                className="w-full rounded-2xl p-6"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,215,0,0.15)' }}
              >
                {/* Numbers row */}
                <div className="flex items-center justify-around mb-5">
                  <NumberBadge number={result.n1} label={p1Label} score={result.s1} mode={mode} size="lg" />
                  <div className="text-2xl text-gray-600 font-black">VS</div>
                  <NumberBadge number={result.n2} label={p2Label} score={result.s2} mode={mode} size="lg" />
                </div>

                {/* Winner banner */}
                <div className={`rounded-xl py-3 px-4 text-center mb-4 ${
                  result.winner === 'player'
                    ? 'bg-emerald-500/15 border border-emerald-500/40'
                    : result.winner === 'tie'
                    ? 'bg-yellow-500/10 border border-yellow-500/30'
                    : 'bg-red-500/10 border border-red-500/30'
                }`}>
                  {result.winner === 'player' && (
                    <>
                      <p className="text-emerald-300 font-black text-xl tracking-wide">🏆 YOU WIN!</p>
                      <p className="text-emerald-400 text-sm mt-0.5">
                        {result.multiplier}× · +{result.profit.toLocaleString()} credits
                      </p>
                    </>
                  )}
                  {result.winner === 'opponent' && (
                    <>
                      <p className="text-red-400 font-black text-xl tracking-wide">
                        {gameType === GAME_TYPES.VS_HOUSE ? '🏦 House Wins' : '🎲 Player 2 Wins'}
                      </p>
                      <p className="text-red-500 text-sm mt-0.5">−{safeBet.toLocaleString()} credits</p>
                    </>
                  )}
                  {result.winner === 'house' && (
                    <>
                      <p className="text-red-400 font-black text-xl tracking-wide">🏦 Tie → House Wins</p>
                      <p className="text-red-500 text-sm mt-0.5">−{safeBet.toLocaleString()} credits</p>
                    </>
                  )}
                </div>

                {/* Mode explanation */}
                <div className="flex items-center justify-center gap-4 text-xs text-gray-600">
                  {mode === MODES.REME && (
                    <>
                      <span>{result.n1} → {result.s1 === 0 ? <span className="text-yellow-400 ">0 (highest!)</span> : result.s1}</span>
                      <span className="text-gray-700">·</span>
                      <span>{result.n2} → {result.s2 === 0 ? <span className="text-yellow-400">0 (highest!)</span> : result.s2}</span>
                    </>
                  )}
                  {mode === MODES.QQ && (
                    <>
                      <span>last digit of {result.n1} = {result.s1 === 0 ? <span className="text-yellow-400">0 ★</span> : result.s1}</span>
                      <span className="text-gray-700">·</span>
                      <span>last digit of {result.n2} = {result.s2 === 0 ? <span className="text-yellow-400">0 ★</span> : result.s2}</span>
                    </>
                  )}
                  {mode === MODES.CSN && (
                    <span className="text-gray-500">Higher number wins · always 2×</span>
                  )}
                </div>
              </motion.div>
            )}

            {phase === 'idle' && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="py-4 text-center text-gray-700 text-sm tracking-widest uppercase">
                Place your bet and spin
              </motion.div>
            )}
          </AnimatePresence>

          {/* History */}
          <div className="w-full">
            <HistoryLog history={history} />
          </div>
        </div>

        {/* ── RIGHT: Controls ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Balance */}
          <div className="rounded-2xl p-5 text-center" style={{ background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.2)' }}>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Balance</p>
            <p className="text-4xl font-black" style={{ color: '#ffd700' }}>
              {balance.toLocaleString()}
            </p>
            <p className="text-xs text-gray-600 mt-1">credits</p>
            {balance === 0 && (
              <button
                onClick={() => setBalance(STARTING_BALANCE)}
                className="mt-3 px-4 py-1.5 rounded-lg text-xs font-bold text-black"
                style={{ background: 'linear-gradient(135deg,#ffd700,#e6a817)' }}
              >
                Reload 1,000
              </button>
            )}
          </div>

          {/* Game type toggle */}
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-3">Game Type</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: GAME_TYPES.VS_HOUSE,  label: 'vs House',  icon: '🏦' },
                { key: GAME_TYPES.VS_PLAYER, label: 'vs Player', icon: '🎲' },
              ].map(({ key, label, icon }) => (
                <button key={key} onClick={() => { setGameType(key); setResult(null); setPhase('idle'); }}
                  disabled={spinning}
                  className={`py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-40 border ${
                    gameType === key
                      ? 'text-black border-transparent'
                      : 'text-gray-500 border-white/10 hover:border-white/20 hover:text-gray-300'
                  }`}
                  style={gameType === key ? { background: 'linear-gradient(135deg,#ffd700,#e6a817)' } : {}}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode info */}
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">
              {mode} Rules
            </p>
            {mode === MODES.REME && (
              <div className="text-xs text-gray-400 space-y-1 leading-relaxed">
                <p>Add the digits of the spun number.</p>
                <p>If 2 digits, reduce via mod 10.</p>
                <p className="text-amber-400 font-semibold">0 is the highest value.</p>
                <p>Win: 2× · Win with 0: <span className="text-amber-400">3×</span>{gameType === GAME_TYPES.VS_PLAYER ? ' (no bonus in PvP)' : ''}</p>
                <p className="text-gray-600">Tie → {gameType === GAME_TYPES.VS_HOUSE ? 'House wins' : 'auto respin'}</p>
                <div className="mt-2 pt-2 border-t border-white/5 text-gray-600">
                  <p>16 → 1+6 = 7</p>
                  <p>28 → 2+8 = 10 → 0</p>
                </div>
              </div>
            )}
            {mode === MODES.QQ && (
              <div className="text-xs text-gray-400 space-y-1 leading-relaxed">
                <p>Use only the last digit of the number.</p>
                <p className="text-amber-400 font-semibold">0 is the highest value.</p>
                <p>Win: 2× · Win with 0: <span className="text-amber-400">3×</span>{gameType === GAME_TYPES.VS_PLAYER ? ' (no bonus in PvP)' : ''}</p>
                <p className="text-gray-600">Tie → {gameType === GAME_TYPES.VS_HOUSE ? 'House wins' : 'auto respin'}</p>
                <div className="mt-2 pt-2 border-t border-white/5 text-gray-600">
                  <p>10 → 0 · 19 → 9</p>
                </div>
              </div>
            )}
            {mode === MODES.CSN && (
              <div className="text-xs text-gray-400 space-y-1 leading-relaxed">
                <p>Full number — higher wins.</p>
                <p>Win: always <span className="text-amber-400">2×</span></p>
                <p className="text-gray-600">Tie → {gameType === GAME_TYPES.VS_HOUSE ? 'House wins' : 'auto respin'}</p>
                <div className="mt-2 pt-2 border-t border-white/5 text-gray-600">
                  <p>29 vs 30 → 30 wins</p>
                </div>
              </div>
            )}
          </div>

          {/* Bet amount */}
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-3">Bet Amount</p>
            <input
              type="number"
              value={bet}
              onChange={e => setBet(Math.max(MIN_BET, Math.min(balance, parseInt(e.target.value) || MIN_BET)))}
              disabled={spinning}
              min={MIN_BET} max={balance}
              className="w-full rounded-xl px-4 py-3 text-2xl font-black text-center focus:outline-none transition-colors disabled:opacity-40"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,215,0,0.3)', color: '#ffd700' }}
            />
            <div className="grid grid-cols-3 gap-2 mt-2">
              <button onClick={() => adjustBet(0.5)} disabled={spinning}
                className="py-1.5 text-xs font-bold rounded-lg text-gray-400 transition-all disabled:opacity-40 hover:text-amber-300"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>½</button>
              <button onClick={() => adjustBet(2)} disabled={spinning}
                className="py-1.5 text-xs font-bold rounded-lg text-gray-400 transition-all disabled:opacity-40 hover:text-amber-300"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>2×</button>
              <button onClick={maxBet} disabled={spinning}
                className="py-1.5 text-xs font-bold rounded-lg text-gray-400 transition-all disabled:opacity-40 hover:text-amber-300"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>Max</button>
            </div>
            {safeBet !== bet && (
              <p className="text-xs text-amber-500 mt-1.5 text-center">Clamped to {safeBet}</p>
            )}
          </div>

          {/* Payout preview */}
          <div className="rounded-xl px-4 py-3 flex justify-between items-center text-xs"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="text-gray-600">Normal win</span>
            <span className="text-gray-400 font-bold">{(safeBet * 2 - safeBet).toLocaleString()} profit</span>
          </div>
          {mode !== MODES.CSN && gameType === GAME_TYPES.VS_HOUSE && (
            <div className="rounded-xl px-4 py-3 flex justify-between items-center text-xs"
              style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.15)' }}>
              <span className="text-amber-600">Win with 0 (3×)</span>
              <span className="text-amber-400 font-bold">{(safeBet * 3 - safeBet).toLocaleString()} profit</span>
            </div>
          )}

          {/* Spin button */}
          <button
            onClick={handleSpin}
            disabled={spinning || balance < MIN_BET}
            className="w-full py-5 rounded-2xl font-black text-xl tracking-widest uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: spinning || balance < MIN_BET
                ? 'rgba(50,50,50,0.5)'
                : 'linear-gradient(135deg, #ffd700 0%, #e6a817 50%, #c8860a 100%)',
              color: spinning || balance < MIN_BET ? '#555' : '#0a0f0a',
              boxShadow: spinning || balance < MIN_BET ? 'none' : '0 4px 30px rgba(255,215,0,0.3)',
              border: '2px solid transparent',
              letterSpacing: '0.1em',
            }}
          >
            {spinning ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }} className="inline-block">⟳</motion.span>
                Spinning…
              </span>
            ) : balance < MIN_BET ? (
              'No Balance'
            ) : (
              '🎰 Spin'
            )}
          </button>

          {/* Mode quick-ref */}
          <div className="rounded-xl p-3 text-center text-xs text-gray-700"
            style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)' }}>
            {gameType === GAME_TYPES.VS_PLAYER
              ? 'PvP: Tie triggers automatic respin.'
              : 'vs House: Tie goes to the house.'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Casino;