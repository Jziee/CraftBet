import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { Gamepad2, Dices, Bomb, ArrowUpDown, Target, CircleDot, Swords, ShipWheel } from 'lucide-react'

const games = [
  { id: 'blackjack', name: 'Blackjack', icon: Gamepad2, color: 'from-red-500 to-orange-500', desc: 'Beat the dealer to 21' },
  { id: 'roulette', name: 'Roulette', icon: Dices, color: 'from-purple-500 to-pink-500', desc: 'Spin the wheel' },
  { id: 'mines', name: 'Mines', icon: Bomb, color: 'from-yellow-500 to-red-500', desc: 'Avoid the bombs' },
  { id: 'towers', name: 'Towers', icon: ArrowUpDown, color: 'from-blue-500 to-cyan-500', desc: 'Climb to the top' },
  { id: 'hilo', name: 'Hi-Lo', icon: Target, color: 'from-green-500 to-emerald-500', desc: 'Higher or lower' },
  { id: 'limbo', name: 'Limbo', icon: CircleDot, color: 'from-indigo-500 to-purple-500', desc: 'How low can you go' },
  { id: 'coinflip', name: 'Coinflip', icon: Swords, color: 'from-craft-green to-craft-greenDark', desc: 'Coin flip PVP and Solo' },
  { id: 'casino', name: 'Casino', icon: ShipWheel, color: 'from-red-500 to-orange-500', desc: 'Play REME, QQ, CSN here!' },
]

const Dashboard = () => {
  const { user } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="pt-24 pb-12 px-4 lg:px-8">
      {/* Welcome Section */}
      <div className="max-w-6xl mx-auto mb-12">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Welcome to <span className="gradient-text">CraftBet</span>
        </h1>
        <p className="text-gray-400 text-lg">
          {user ? `Good to see you, ${user.username}! Ready to win some World Locks?` : 'Please login to start playing'}
        </p>
      </div>

      {/* Games Grid */}
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <span className="w-1 h-8 bg-craft-green rounded-full"></span>
          Popular Games
        </h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {games.map((game) => {
            const Icon = game.icon
            return (
              <div
                key={game.id}
                onClick={() => navigate(`/${game.id}`)}
                className="group relative bg-craft-gray rounded-2xl p-6 border border-craft-green/10 hover:border-craft-green/30 transition-all duration-300 hover:transform hover:-translate-y-1 cursor-pointer overflow-hidden"
              >
                {/* Glow effect on hover */}
                <div className={`absolute inset-0 bg-linear-to-br ${game.color} opacity-0 group-hover:opacity-10 transition-opacity duration-300`}></div>
                
                <div className={`w-14 h-14 rounded-xl bg-linear-to-br ${game.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="w-7 h-7 text-white" />
                </div>
                
                <h3 className="text-xl font-bold mb-2 group-hover:text-craft-green transition-colors">
                  {game.name}
                </h3>
                <p className="text-gray-400 text-sm mb-4">
                  {game.desc}
                </p>
                
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Instant play</span>
                  <div className="w-8 h-8 rounded-full bg-craft-green/20 flex items-center justify-center group-hover:bg-craft-green transition-colors">
                    <span className="text-craft-green group-hover:text-craft-dark font-bold text-sm">→</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Stats Section */}
      <div className="max-w-6xl mx-auto mt-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass rounded-xl p-6 text-center">
            <div className="text-3xl font-bold text-craft-green mb-2">7</div>
            <div className="text-gray-400">Games Available</div>
          </div>
          <div className="glass rounded-xl p-6 text-center">
            <div className="text-3xl font-bold text-craft-green mb-2">1</div>
            <div className="text-gray-400">Active Players</div>
          </div>
          <div className="glass rounded-xl p-6 text-center">
            <div className="text-3xl font-bold text-craft-green mb-2">100%</div>
            <div className="text-gray-400">Fun Guaranteed</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard