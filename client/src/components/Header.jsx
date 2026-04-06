import { useState } from 'react'
import { MessageSquare, User, X, Lock, Gift, LogOut, Shield } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'

const Header = ({ onChatToggle, onAuthOpen }) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const { user, logout, isAuthenticated } = useAuth()

  const handleLogout = () => {
    logout()
    onAuthOpen()
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass h-16 flex items-center justify-between px-4 lg:px-8">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div style={{ background: 'linear-gradient(135deg, #00ff88, #00cc6a)' }}>
          <span className="text-craft-dark font-bold text-xl">C</span>
        </div>
        <span className="text-2xl font-bold tracking-tight">
          <span className="text-craft-green">Craft</span>
          <span className="text-white">Bet</span>
        </span>
      </div>

      {/* World Lock Balance */}
      {isAuthenticated && user && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-craft-gray border border-craft-green/20">
          <div className="w-6 h-6 rounded-full bg-yellow-300 flex items-center justify-center">
            <span className="text-craft-dark text-xs font-bold">BC</span>
          </div>
          <span className="text-yellow-300 font-semibold tabular-nums">
            {user.balance?.toLocaleString() || '0'}
          </span>
          <span className="text-white text-sm">Byte Coins</span>
        </div>
      )}

      {/* Right Side Actions */}
      <div className="flex items-center gap-4">
        {/* Chat Toggle */}
        <button 
          onClick={onChatToggle}
          className="p-2 rounded-lg hover:bg-craft-gray transition-colors relative"
        >
          <MessageSquare className="w-6 h-6 text-gray-300 hover:text-craft-green transition-colors" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-craft-green rounded-full animate-pulse"></span>
        </button>

        {/* Profile Dropdown */}
        {isAuthenticated ? (
          <div className="relative">
            <button 
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-craft-gray transition-colors"
            >
              <div style={{ background: 'linear-gradient(135deg, #00ff88, #00cc6a)' }} className="w-8 h-8 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-craft-dark" />
              </div>
              <span className="hidden sm:block text-sm font-medium">{user?.username}</span>
            </button>

            <AnimatePresence>
              {isProfileOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 top-full mt-2 w-48 glass rounded-xl overflow-hidden shadow-2xl"
                >
                  <div className="py-2">
                    {/* Admin Panel Button - Only for admins */}
                    {user?.isAdmin && (
                      <button 
                        onClick={() => window.location.href = '/admin'}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-craft-green/10 transition-colors text-left text-craft-green"
                      >
                        <Shield className="w-4 h-4" />
                        <span>Admin Panel</span>
                      </button>
                    )}
                    
                    <button className="w-full px-4 py-3 flex items-center gap-3 hover:bg-craft-green/10 transition-colors text-left">
                      <User className="w-4 h-4 text-craft-green" />
                      <span>Profile</span>
                    </button>
                    <button className="w-full px-4 py-3 flex items-center gap-3 hover:bg-craft-green/10 transition-colors text-left">
                      <Gift className="w-4 h-4 text-craft-green" />
                      <span>Promocodes</span>
                    </button>
                    <button className="w-full px-4 py-3 flex items-center gap-3 hover:bg-craft-green/10 transition-colors text-left">
                      <Lock className="w-4 h-4 text-craft-green" />
                      <span>Vault</span>
                      <span className="ml-auto text-xs text-craft-green">({user?.vault || 0})</span>
                    </button>
                    <hr className="my-2 border-craft-green/20" />
                    <button 
                      onClick={handleLogout}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-red-500/10 transition-colors text-left text-red-400"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Logout</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <button 
            onClick={onAuthOpen}
            className="px-4 py-2 rounded-lg bg-craft-green text-craft-dark font-semibold hover:bg-craft-greenDark transition-colors"
          >
            Login
          </button>
        )}
      </div>
    </header>
  )
}

export default Header