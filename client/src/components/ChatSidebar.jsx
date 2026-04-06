import { motion } from 'framer-motion'
import { X, Send } from 'lucide-react'
import { useState } from 'react'

const ChatSidebar = ({ isOpen, onClose }) => {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([
    { id: 1, user: 'System', text: 'Welcome to CraftBet chat!', type: 'system' },
    { id: 2, user: 'Player1', text: 'Good luck everyone!', type: 'user' },
    { id: 3, user: 'Player2', text: 'Just won 500 WL on Mines 🔥', type: 'user' },
  ])

  const handleSend = (e) => {
    e.preventDefault()
    if (!message.trim()) return
    
    setMessages([...messages, { 
      id: Date.now(), 
      user: 'You', 
      text: message, 
      type: 'user' 
    }])
    setMessage('')
  }

  return (
    <motion.aside
      initial={{ x: '-100%' }}
      animate={{ x: isOpen ? 0 : '-100%' }}
      transition={{ type: 'tween', duration: 0.3 }}
      className="fixed left-0 top-16 bottom-0 w-80 bg-craft-darker border-r border-craft-green/20 z-40 flex flex-col"
    >
      {/* Chat Header */}
      <div className="flex items-center justify-between p-4 border-b border-craft-green/20">
        <h3 className="font-semibold text-craft-green flex items-center gap-2">
          <span className="w-2 h-2 bg-craft-green rounded-full animate-pulse"></span>
          Live Chat
        </h3>
        <button 
          onClick={onClose}
          className="p-1 rounded hover:bg-craft-gray transition-colors"
        >
          <X className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div 
            key={msg.id}
            className={`p-3 rounded-lg ${
              msg.type === 'system' 
                ? 'bg-craft-green/10 border border-craft-green/30' 
                : 'bg-craft-gray'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-semibold ${
                msg.type === 'system' ? 'text-craft-green' : 'text-gray-400'
              }`}>
                {msg.user}
              </span>
            </div>
            <p className="text-sm text-gray-200">{msg.text}</p>
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-craft-green/20">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-craft-gray border border-craft-green/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-craft-green transition-colors"
          />
          <button 
            type="submit"
            className="p-2 rounded-lg bg-craft-green text-craft-dark hover:bg-craft-greenDark transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </motion.aside>
  )
}

export default ChatSidebar