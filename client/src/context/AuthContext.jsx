import { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      fetchUser(token)
    } else {
      setLoading(false)
    }
  }, [])

  const fetchUser = async (token) => {
    try {
      const response = await axios.get('https://craftbet.onrender.com/api/user/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
      setUser(response.data)
    } catch (error) {
      localStorage.removeItem('token')
    } finally {
      setLoading(false)
    }
  }

const login = async (username, password) => {
  const response = await axios.post(
    'https://craftbet.onrender.com/api/auth/login',
    { username, password }
  )

  const token = response.data.token
  const user = response.data.user

  if (!token) throw new Error("No token returned")

  localStorage.setItem('token', token)
  setUser(user)

  return user
}

const register = async (username, email, password) => {
  const response = await axios.post(
    'https://craftbet.onrender.com/api/auth/register',
    { username, email, password }
  )

  const token = response.data.token
  const user = response.data.user

  if (!token) throw new Error("No token returned")

  localStorage.setItem('token', token)
  setUser(user)

  return user
}

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  const updateBalance = (newBalance) => {
    setUser(prev => ({ ...prev, balance: newBalance }))
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      login, 
      register, 
      logout, 
      loading,
      updateBalance,
      isAuthenticated: !!user 
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)