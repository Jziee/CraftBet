import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import ChatSidebar from './components/ChatSidebar'
import AuthModal from './components/AuthModal'
import Dashboard from './pages/Dashboard'
import AdminPanel from './pages/AdminPanel'
import { AuthProvider } from './context/AuthContext'
import Blackjack from './games/Blackjack'
import Roulette from './games/Roulette'
import Mines from './games/Mines'
import Towers from './games/Towers'
import HiLo from './games/HiLo'
import Limbo from './games/Limbo'
import Coinflip from './games/Coinflip'

function App() {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [authTab, setAuthTab] = useState('login')

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      setIsAuthOpen(true)
    }
  }, [])

  return (
    <AuthProvider>
      <div className="min-h-screen bg-craft-dark">
        <Header 
          onChatToggle={() => setIsChatOpen(!isChatOpen)}
          onAuthOpen={() => setIsAuthOpen(true)}
        />
        
        <ChatSidebar isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
        
        <main className={`transition-all duration-300 ${isChatOpen ? 'ml-80' : 'ml-0'}`}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/blackjack" element={<Blackjack />} />
            <Route path="/roulette" element={<Roulette />} />
            <Route path="/mines" element={<Mines />} />
            <Route path="/towers" element={<Towers />} />
            <Route path="/hilo" element={<HiLo />} />
            <Route path="/limbo" element={<Limbo />} />
            <Route path="/coinflip" element={<Coinflip />} />
          </Routes>
        </main>

        <AuthModal 
          isOpen={isAuthOpen} 
          onClose={() => setIsAuthOpen(false)}
          initialTab={authTab}
          onTabChange={setAuthTab}
        />
      </div>
    </AuthProvider>
  )
}

export default App