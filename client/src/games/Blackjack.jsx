import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

const API_URL = 'http://localhost:5002';

const Blackjack = () => {
  const { user, updateBalance } = useAuth();
  const [bet, setBet] = useState(100);
  const [loading, setLoading] = useState(false);
  const [gameState, setGameState] = useState('betting');
  const [gameId, setGameId] = useState(null);
  const [sequence, setSequence] = useState(0);
  const [playerHands, setPlayerHands] = useState([]);
  const [playerBets, setPlayerBets] = useState([]);
  const [activeHandIndex, setActiveHandIndex] = useState(0);
  const [dealerHand, setDealerHand] = useState([]);
  const [playerValues, setPlayerValues] = useState([]);
  const [dealerValue, setDealerValue] = useState(0);
  const [result, setResult] = useState(null);
  const [insuranceResult, setInsuranceResult] = useState(null);
  const [canSplit, setCanSplit] = useState(false);
  const [canDouble, setCanDouble] = useState(false);
  const [canHit, setCanHit] = useState(true);
  const [canStand, setCanStand] = useState(true);
  const [canInsurance, setCanInsurance] = useState(false);
  const [history, setHistory] = useState([]);

  const startGame = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setSequence(0);
    
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_URL}/api/blackjack/start`,
        { bet },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setGameId(response.data.gameId);
      setPlayerHands(response.data.playerHands);
      setPlayerBets(response.data.playerBets);
      setActiveHandIndex(response.data.activeHandIndex);
      setDealerHand(response.data.dealerHand);
      setPlayerValues([response.data.playerValue]);
      setDealerValue(response.data.dealerValue);
      setGameState(response.data.gameState);
      setResult(response.data.result);
      setInsuranceResult(null);
      setCanSplit(response.data.canSplit);
      setCanDouble(response.data.canDouble);
      setCanHit(response.data.canHit);
      setCanStand(response.data.canStand);
      setCanInsurance(response.data.canInsurance);
      updateBalance(response.data.balance);

      if (response.data.result) {
        addToHistory(response.data.result);
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to start game');
    } finally {
      setLoading(false);
    }
  }, [bet, loading, updateBalance]);

  const handleAction = useCallback(async (action) => {
    if (loading || gameState !== 'playing' || !gameId) return;
    setLoading(true);
    
    const nextSequence = sequence + 1;

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_URL}/api/blackjack/action`,
        { gameId, action, sequence: nextSequence },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setSequence(nextSequence);
      setPlayerHands(response.data.playerHands);
      setPlayerBets(response.data.playerBets);
      setActiveHandIndex(response.data.activeHandIndex);
      setDealerHand(response.data.dealerHand);
      setPlayerValues(response.data.playerValues || [response.data.playerValue]);
      setDealerValue(response.data.dealerValue);
      setGameState(response.data.gameState);
      setCanSplit(response.data.canSplit);
      setCanDouble(response.data.canDouble);
      setCanHit(response.data.canHit);
      setCanStand(response.data.canStand);
      setCanInsurance(response.data.canInsurance);
      updateBalance(response.data.balance);

      if (response.data.insuranceResult) {
        setInsuranceResult(response.data.insuranceResult);
      }

      if (response.data.result) {
        setResult(response.data.result);
        addToHistory(response.data.result);
        setGameId(null);
      }

      if (response.data.message) {
        console.log(response.data.message);
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  }, [loading, gameState, gameId, sequence, updateBalance]);

  const addToHistory = (result) => {
    const entry = {
      type: result.type,
      amount: result.totalPayout || 0,
      hands: result.hands?.length || 1,
      details: result.hands,
      time: new Date().toLocaleTimeString()
    };
    setHistory(prev => [entry, ...prev].slice(0, 10));
  };

  const reset = () => {
    setGameState('betting');
    setGameId(null);
    setSequence(0);
    setPlayerHands([]);
    setPlayerBets([]);
    setDealerHand([]);
    setResult(null);
    setInsuranceResult(null);
    setCanSplit(false);
    setCanDouble(false);
    setCanHit(true);
    setCanStand(true);
    setCanInsurance(false);
  };

  const Card = ({ card }) => {
    if (card.hidden) {
      return (
        <div className="w-16 h-24 rounded-lg bg-blue-800 border-2 border-blue-900 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full bg-blue-600"></div>
        </div>
      );
    }
    
    const isRed = card.suit === '♥' || card.suit === '♦';
    return (
      <div className={`w-16 h-24 rounded-lg bg-white border-2 border-gray-300 flex flex-col items-center justify-center text-2xl font-bold ${isRed ? 'text-red-500' : 'text-black'}`}>
        <span>{card.value}</span>
        <span className="text-3xl">{card.suit}</span>
      </div>
    );
  };

  return (
    <div className="pt-24 px-4 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-center">
        <span className="text-craft-green">Black</span>jack
      </h1>

      {loading && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-craft-green border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      <div className="glass rounded-2xl p-8 mb-6">
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-gray-400">Dealer</h3>
            <span className="text-craft-green font-bold">
              {gameState === 'ended' ? dealerValue : dealerValue > 0 ? `${dealerValue}+?` : '?'}
            </span>
          </div>
          <div className="flex gap-2 justify-center">
            {dealerHand.map((card, i) => (
              <Card key={i} card={card} />
            ))}
          </div>
        </div>

        <div className="mb-6">
          {playerHands.map((hand, handIndex) => (
            <div 
              key={handIndex} 
              className={`mb-4 p-4 rounded-lg ${handIndex === activeHandIndex && gameState === 'playing' ? 'bg-craft-green/10 border-2 border-craft-green' : 'border border-transparent'}`}
            >
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-gray-400">
                  Your Hand {playerHands.length > 1 ? handIndex + 1 : ''}
                  {handIndex === activeHandIndex && gameState === 'playing' && ' (ACTIVE)'}
                </h3>
                <div className="text-right">
                  <span className="text-craft-green font-bold block text-xl">
                    {playerValues[handIndex] || '?'}
                  </span>
                  <span className="text-xs text-gray-400">
                    Bet: {playerBets[handIndex] || bet} WL
                  </span>
                </div>
              </div>
              <div className="flex gap-2 justify-center">
                {hand.map((card, i) => (
                  <Card key={i} card={card} />
                ))}
              </div>
            </div>
          ))}
          {playerHands.length === 0 && (
            <div className="text-center text-gray-500 py-8">Place your bet to start</div>
          )}
        </div>

        {insuranceResult && (
          <div className={`text-center mb-4 p-3 rounded-lg ${insuranceResult.type === 'win' ? 'bg-yellow-500/20 border border-yellow-500' : 'bg-gray-500/20 border border-gray-500'}`}>
            <p className={insuranceResult.type === 'win' ? 'text-yellow-400 font-bold' : 'text-gray-400'}>
              Insurance: {insuranceResult.type === 'win' ? `+${insuranceResult.payout} WL` : `-${insuranceResult.amount} WL`}
            </p>
          </div>
        )}

        {result && (
          <div className={`text-center mb-4 p-4 rounded-lg ${result.type === 'win' ? 'bg-craft-green/20 border border-craft-green' : result.type === 'push' ? 'bg-yellow-500/20 border border-yellow-500' : result.type === 'mixed' ? 'bg-blue-500/20 border border-blue-500' : 'bg-red-500/20 border border-red-500'}`}>
            <p className={`font-bold text-lg ${result.type === 'win' ? 'text-craft-green' : result.type === 'push' ? 'text-yellow-400' : result.type === 'mixed' ? 'text-blue-400' : 'text-red-400'}`}>
              {result.message}
            </p>
            {result.totalPayout !== 0 && (
              <p className={`font-bold mt-2 ${result.totalPayout > 0 ? 'text-craft-green' : 'text-red-400'}`}>
                {result.totalPayout > 0 ? '+' : ''}{result.totalPayout} WL
              </p>
            )}
          </div>
        )}
      </div>

      {gameState === 'betting' && (
        <div className="glass rounded-2xl p-6 text-center">
          <h3 className="text-lg mb-4">Place Your Bet</h3>
          <div className="flex items-center justify-center gap-4 mb-6">
            <button 
              onClick={() => setBet(Math.max(10, bet - 10))}
              disabled={loading}
              className="w-12 h-12 rounded-full bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold disabled:opacity-50"
            >-</button>
            <div className="text-3xl font-bold text-craft-green">{bet}</div>
            <button 
              onClick={() => setBet(Math.min(user?.balance || 0, bet + 10))}
              disabled={loading}
              className="w-12 h-12 rounded-full bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold disabled:opacity-50"
            >+</button>
          </div>
          <div className="flex gap-2 justify-center mb-6">
            {[10, 50, 100, 500, 1000].map(amount => (
              <button
                key={amount}
                onClick={() => setBet(amount)}
                disabled={loading}
                className={`px-3 py-1 rounded-lg text-sm ${bet === amount ? 'bg-craft-green text-craft-dark' : 'bg-craft-gray text-gray-400'}`}
              >
                {amount}
              </button>
            ))}
          </div>
          <button 
            onClick={startGame}
            disabled={loading || bet > (user?.balance || 0) || bet < 1}
            className="px-8 py-3 rounded-lg bg-craft-green text-craft-dark font-bold hover:bg-craft-greenDark transition-colors disabled:opacity-50"
          >
            Deal
          </button>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="flex gap-4 justify-center flex-wrap">
          {canInsurance && (
            <button 
              onClick={() => handleAction('insurance')}
              disabled={loading}
              className="px-6 py-3 rounded-lg bg-yellow-600 text-white font-bold hover:bg-yellow-700 transition-colors disabled:opacity-50"
            >
              Insurance
            </button>
          )}
          <button 
            onClick={() => handleAction('hit')}
            disabled={loading || !canHit}
            className="px-6 py-3 rounded-lg bg-craft-green text-craft-dark font-bold hover:bg-craft-greenDark transition-colors disabled:opacity-50"
          >
            Hit
          </button>
          <button 
            onClick={() => handleAction('stand')}
            disabled={loading || !canStand}
            className="px-6 py-3 rounded-lg bg-craft-gray text-white font-bold hover:bg-craft-green/20 transition-colors border border-craft-green disabled:opacity-50"
          >
            Stand
          </button>
          {canDouble && (
            <button 
              onClick={() => handleAction('double')}
              disabled={loading}
              className="px-6 py-3 rounded-lg bg-yellow-500 text-craft-dark font-bold hover:bg-yellow-600 transition-colors disabled:opacity-50"
            >
              Double
            </button>
          )}
          {canSplit && (
            <button 
              onClick={() => handleAction('split')}
              disabled={loading}
              className="px-6 py-3 rounded-lg bg-blue-500 text-white font-bold hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              Split ({playerHands.length + 1}/4)
            </button>
          )}
        </div>
      )}

      {gameState === 'ended' && (
        <div className="text-center">
          <button 
            onClick={reset}
            disabled={loading}
            className="px-8 py-3 rounded-lg bg-craft-green text-craft-dark font-bold hover:bg-craft-greenDark transition-colors disabled:opacity-50"
          >
            Play Again
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="glass rounded-2xl p-6 mt-8">
          <h3 className="text-lg mb-4">Session History</h3>
          <div className="flex gap-2 overflow-x-auto">
            {history.map((h, i) => (
              <div key={i} className={`px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap ${h.type === 'win' ? 'bg-craft-green text-craft-dark' : h.type === 'push' ? 'bg-yellow-500 text-craft-dark' : h.type === 'mixed' ? 'bg-blue-500 text-white' : 'bg-red-500/20 text-red-400'}`}>
                {h.type === 'win' ? '+' : h.type === 'push' ? '=' : h.type === 'mixed' ? '~' : '-'}{Math.abs(h.amount)}
                {h.hands > 1 && ` (${h.hands}h)`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Blackjack;