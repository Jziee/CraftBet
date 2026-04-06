import express from 'express';
import { authenticate, isAdmin } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// Add World Locks to user (Admin only)
router.post('/add-currency', authenticate, isAdmin, async (req, res) => {
  try {
    const { username, amount } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.balance += amount;
    await user.save();

    res.json({ 
      message: `Added ${amount} World Locks to ${username}`,
      newBalance: user.balance 
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all users (Admin only)
router.get('/users', authenticate, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;