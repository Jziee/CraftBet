import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, User, Mail, Lock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const AuthModal = ({ isOpen, onClose, initialTab = 'login', onTabChange }) => {
  const [activeTab, setActiveTab] = useState(initialTab)
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  
  const { login, register } = useAuth()

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setError('')
    onTabChange?.(tab)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (activeTab === 'register') {
        if (formData.password !== formData.confirmPassword) {
          throw new Error('Passwords do not match')
        }
        await register(formData.username, formData.email, formData.password)
      } else {
        await login(formData.username, formData.password)
      }
      onClose()
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-md glass rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg hover:bg-craft-gray transition-colors z-10"
        >
          <X className="w-5 h-5 text-gray-400" />
        </button>

        {/* Tabs */}
        <div className="flex border-b border-craft-green/20">
          <button
            onClick={() => handleTabChange('login')}
            className={`flex-1 py-4 text-center font-semibold transition-colors relative ${
              activeTab === 'login' ? 'text-craft-green' : 'text-gray-400 hover:text-white'
            }`}
          >
            Login
            {activeTab === 'login' && (
              <motion.div 
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-craft-green"
              />
            )}
          </button>
          <button
            onClick={() => handleTabChange('register')}
            className={`flex-1 py-4 text-center font-semibold transition-colors relative ${
              activeTab === 'register' ? 'text-craft-green' : 'text-gray-400 hover:text-white'
            }`}
          >
            Register
            {activeTab === 'register' && (
              <motion.div 
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-craft-green"
              />
            )}
          </button>
        </div>

        {/* Form */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            <motion.form
              key={activeTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              {/* Username */}
              <div className="space-y-2">
                <label className="text-sm text-gray-400 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={formData.username}
                  onChange={(e) => setFormData({...formData, username: e.target.value})}
                  className="w-full bg-craft-gray border border-craft-green/20 rounded-lg px-4 py-3 focus:outline-none focus:border-craft-green transition-colors"
                  placeholder="Enter username"
                />
              </div>

              {/* Email (Register only) */}
              {activeTab === 'register' && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-2"
                >
                  <label className="text-sm text-gray-400 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="w-full bg-craft-gray border border-craft-green/20 rounded-lg px-4 py-3 focus:outline-none focus:border-craft-green transition-colors"
                    placeholder="Enter email"
                  />
                </motion.div>
              )}

              {/* Password */}
              <div className="space-y-2">
                <label className="text-sm text-gray-400 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  className="w-full bg-craft-gray border border-craft-green/20 rounded-lg px-4 py-3 focus:outline-none focus:border-craft-green transition-colors"
                  placeholder="Enter password"
                />
              </div>

              {/* Confirm Password (Register only) */}
              {activeTab === 'register' && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-2"
                >
                  <label className="text-sm text-gray-400 flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    required
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                    className="w-full bg-craft-gray border border-craft-green/20 rounded-lg px-4 py-3 focus:outline-none focus:border-craft-green transition-colors"
                    placeholder="Confirm password"
                  />
                </motion.div>
              )}

              {/* Error Message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
                >
                  {error}
                </motion.div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg bg-craft-green text-craft-dark font-bold hover:bg-craft-greenDark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Processing...' : activeTab === 'login' ? 'Login' : 'Create Account'}
              </button>
            </motion.form>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

export default AuthModal