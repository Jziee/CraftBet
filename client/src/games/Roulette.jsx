import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import axios from 'axios'

const Roulette = () => {
  const { user, updateBalance } = useAuth()
  const [bet, setBet] = useState(100)
  const [selectedBet, setSelectedBet] = useState(null) // 'red', 'black', 'green', or number
  const [betType, setBetType] = useState(null) // 'color' or 'number'
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState([])

  const API_URL = 'http://localhost:5002'

  // Roulette numbers: 0 is green, rest alternate red/black
  const wheelNumbers = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
  ]

  const getNumberColor = (num) => {
    if (num === 0) return 'green'
    const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]
    return redNumbers.includes(num) ? 'red' : 'black'
  }

  const placeBet = (type, value) => {
    setBetType(type)
    setSelectedBet(value)
    setMessage('')
    setError('')
  }

  const spin = async () => {
    if (!selectedBet) {
      setError('Please select a bet first!')
      return
    }

    if (bet > user.balance) {
      setError('Insufficient balance')
      return
    }

    setSpinning(true)
    setError('')
    setMessage('')

    try {
      // Deduct bet
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/api/games/bet`, {
        amount: bet,
        game: 'roulette'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      updateBalance(user.balance - bet)

      // Simulate spin delay
      setTimeout(async () => {
        const winningNumber = Math.floor(Math.random() * 37)
        const winningColor = getNumberColor(winningNumber)
        
        setResult({ number: winningNumber, color: winningColor })
        setHistory(prev => [{ number: winningNumber, color: winningColor }, ...prev].slice(0, 10))

        // Check win
        let won = false
        let winAmount = 0

        if (betType === 'color') {
          if (selectedBet === winningColor) {
            won = true
            winAmount = selectedBet === 'green' ? bet * 14 : bet * 2 // 35:1 for 0, 1:1 for red/black
          }
        } else if (betType === 'number') {
          if (selectedBet === winningNumber) {
            won = true
            winAmount = bet * 36 // 35:1 payout
          }
        }

        if (won) {
          setMessage(`You won ${winAmount} World Locks!`)
          await axios.post(`${API_URL}/api/games/win`, {
            amount: winAmount,
            game: 'roulette'
          }, {
            headers: { Authorization: `Bearer ${token}` }
          })
          updateBalance(user.balance + winAmount)
        } else {
          setMessage(`You lost! ${winningNumber} ${winningColor}`)
        }

        setSpinning(false)
      }, 3000)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to spin')
      setSpinning(false)
    }
  }

  const reset = () => {
    setSelectedBet(null)
    setBetType(null)
    setResult(null)
    setMessage('')
    setError('')
  }

  const renderWheel = () => (
    <div className="relative w-64 h-64 mx-auto mb-8">
      <div className={`w-full h-full rounded-full border-8 border-craft-gray relative overflow-hidden ${spinning ? 'animate-spin' : ''}`} style={{ animationDuration: spinning ? '0.5s' : '0s' }}>
        {wheelNumbers.map((num, i) => {
          const rotation = (i * 360) / 37
          const color = getNumberColor(num)
          return (
            <div
              key={num}
              className={`absolute w-full h-full text-xs font-bold flex items-start justify-center pt-2 ${color === 'red' ? 'text-red-500' : color === 'black' ? 'text-gray-800' : 'text-green-500'}`}
              style={{ 
                transform: `rotate(${rotation}deg)`,
                backgroundColor: color === 'red' ? '#ef4444' : color === 'black' ? '#1f2937' : '#22c55e',
                clipPath: `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin((2 * Math.PI) / 37)}% ${50 - 50 * Math.cos((2 * Math.PI) / 37)}%)`
              }}
            >
              <span style={{ transform: `rotate(${-rotation}deg)`, display: 'inline-block' }}>{num}</span>
            </div>
          )
        })}
      </div>
      {/* Pointer */}
      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-2 w-0 h-0 border-l-8 border-r-8 border-t-16 border-l-transparent border-r-transparent border-t-craft-green"></div>
    </div>
  )

  return (
    <div className="pt-24 px-4 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-center">
        <span className="text-red-500">Rou</span><span className="text-white">lette</span>
      </h1>

      {/* Result Display */}
      {result && !spinning && (
        <div className="text-center mb-6">
          <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full text-3xl font-bold mb-2 ${getNumberColor(result.number) === 'red' ? 'bg-red-500' : getNumberColor(result.number) === 'black' ? 'bg-gray-800' : 'bg-green-500'}`}>
            {result.number}
          </div>
          <p className="text-xl text-craft-green">{message}</p>
        </div>
      )}

      {/* Spinning Indicator */}
      {spinning && (
        <div className="text-center mb-6">
          <div className="w-20 h-20 mx-auto border-4 border-craft-green border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-craft-green animate-pulse">Spinning...</p>
        </div>
      )}

      {/* Bet Controls */}
      {!spinning && (
        <>
          {/* Bet Amount */}
          <div className="glass rounded-2xl p-6 mb-6 text-center">
            <h3 className="text-lg mb-4">Bet Amount</h3>
            <div className="flex items-center justify-center gap-4 mb-4">
              <button 
                onClick={() => setBet(Math.max(10, bet - 10))}
                className="w-12 h-12 rounded-full bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold"
              >-</button>
              <div className="text-3xl font-bold text-craft-green">{bet}</div>
              <button 
                onClick={() => setBet(Math.min(user?.balance || 0, bet + 10))}
                className="w-12 h-12 rounded-full bg-craft-gray hover:bg-craft-green/20 text-craft-green font-bold"
              >+</button>
            </div>
            <div className="flex gap-2 justify-center">
              {[10, 50, 100, 500, 1000].map(amount => (
                <button
                  key={amount}
                  onClick={() => setBet(amount)}
                  className={`px-3 py-1 rounded-lg text-sm ${bet === amount ? 'bg-craft-green text-craft-dark' : 'bg-craft-gray text-gray-400'}`}
                >
                  {amount}
                </button>
              ))}
            </div>
          </div>

          {/* Betting Options */}
          <div className="glass rounded-2xl p-6 mb-6">
            <h3 className="text-lg mb-4 text-center">Place Your Bet</h3>
            
            {/* Color Bets */}
            <div className="flex gap-4 justify-center mb-6">
              <button
                onClick={() => placeBet('color', 'red')}
                className={`w-24 h-24 rounded-xl bg-red-500 hover:bg-red-600 transition-all ${selectedBet === 'red' ? 'ring-4 ring-craft-green scale-110' : ''}`}
              >
                <span className="text-2xl font-bold text-white">Red</span>
                <p className="text-xs text-white/80 mt-1">2x</p>
              </button>
              
              <button
                onClick={() => placeBet('color', 'green')}
                className={`w-24 h-24 rounded-xl bg-green-500 hover:bg-green-600 transition-all ${selectedBet === 'green' ? 'ring-4 ring-craft-green scale-110' : ''}`}
              >
                <span className="text-2xl font-bold text-white">0</span>
                <p className="text-xs text-white/80 mt-1">14x</p>
              </button>
              
              <button
                onClick={() => placeBet('color', 'black')}
                className={`w-24 h-24 rounded-xl bg-gray-800 hover:bg-gray-900 transition-all ${selectedBet === 'black' ? 'ring-4 ring-craft-green scale-110' : ''}`}
              >
                <span className="text-2xl font-bold text-white">Black</span>
                <p className="text-xs text-white/80 mt-1">2x</p>
              </button>
            </div>

            {/* Number Grid */}
            <div className="grid grid-cols-6 gap-2 max-w-md mx-auto">
              {Array.from({ length: 37 }, (_, i) => (
                <button
                  key={i}
                  onClick={() => placeBet('number', i)}
                  className={`h-10 rounded-lg font-bold text-sm transition-all ${selectedBet === i ? 'ring-2 ring-craft-green scale-110' : ''} ${getNumberColor(i) === 'red' ? 'bg-red-500 text-white' : getNumberColor(i) === 'black' ? 'bg-gray-800 text-white' : 'bg-green-500 text-white'}`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 justify-center">
            <button 
              onClick={spin}
              disabled={!selectedBet}
              className="px-8 py-4 rounded-xl bg-craft-green text-craft-dark font-bold text-xl hover:bg-craft-greenDark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              SPIN
            </button>
            <button 
              onClick={reset}
              className="px-6 py-4 rounded-xl bg-craft-gray text-white font-bold hover:bg-craft-green/20 transition-colors border border-craft-green"
            >
              Clear
            </button>
          </div>

          {error && <p className="mt-4 text-center text-red-400">{error}</p>}
        </>
      )}

      {/* History */}
      <div className="glass rounded-2xl p-6 mt-8">
        <h3 className="text-lg mb-4">History</h3>
        <div className="flex gap-2 overflow-x-auto">
          {history.map((h, i) => (
            <div 
              key={i}
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${h.color === 'red' ? 'bg-red-500' : h.color === 'black' ? 'bg-gray-800' : 'bg-green-500'}`}
            >
              {h.number}
            </div>
          ))}
          {history.length === 0 && <p className="text-gray-400">No spins yet</p>}
        </div>
      </div>
    </div>
  )
}

export default Roulette