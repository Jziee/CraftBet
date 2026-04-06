import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import axios from 'axios'

const AdminPanel = () => {
  const { user } = useAuth()
  const [username, setUsername] = useState('')
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [users, setUsers] = useState([])

  const API_URL = 'http://localhost:5002'

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await axios.get(`${API_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setUsers(response.data)
    } catch (err) {
      console.error('Failed to fetch users')
    }
  }

  const handleAddCurrency = async (e) => {
    e.preventDefault()
    setMessage('')
    setError('')

    try {
      const token = localStorage.getItem('token')
      const response = await axios.post(`${API_URL}/api/admin/add-currency`, {
        username,
        amount: parseInt(amount)
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      setMessage(response.data.message)
      setUsername('')
      setAmount('')
      fetchUsers()
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add currency')
    }
  }

  if (!user?.isAdmin) {
    return (
      <div className="pt-24 px-8 text-center">
        <h1 className="text-2xl text-red-400">Access Denied</h1>
        <p className="text-gray-400 mt-4">Admin only area</p>
      </div>
    )
  }

  return (
    <div className="pt-24 px-4 lg:px-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">
        <span className="text-craft-green">Admin</span> Panel
      </h1>

      {/* Add Currency Form */}
      <div className="glass rounded-2xl p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4 text-craft-green">Add World Locks</h2>
        
        <form onSubmit={handleAddCurrency} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-craft-gray border border-craft-green/20 rounded-lg px-4 py-3 focus:outline-none focus:border-craft-green"
              placeholder="Enter username"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-craft-gray border border-craft-green/20 rounded-lg px-4 py-3 focus:outline-none focus:border-craft-green"
              placeholder="Enter amount"
              required
              min="1"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-craft-green text-craft-dark font-bold hover:bg-craft-greenDark transition-colors"
          >
            Add World Locks
          </button>
        </form>

        {message && (
          <div className="mt-4 p-3 rounded-lg bg-craft-green/20 border border-craft-green text-craft-green">
            {message}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/20 border border-red-500 text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Users List */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4 text-craft-green">All Users</h2>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-craft-green/20">
                <th className="text-left py-3 px-4 text-gray-400">Username</th>
                <th className="text-left py-3 px-4 text-gray-400">Email</th>
                <th className="text-right py-3 px-4 text-gray-400">Balance</th>
                <th className="text-right py-3 px-4 text-gray-400">Vault</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className="border-b border-craft-green/10 hover:bg-craft-green/5">
                  <td className="py-3 px-4 font-medium">{u.username}</td>
                  <td className="py-3 px-4 text-gray-400">{u.email}</td>
                  <td className="py-3 px-4 text-right text-craft-green">{u.balance}</td>
                  <td className="py-3 px-4 text-right text-gray-400">{u.vault}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default AdminPanel