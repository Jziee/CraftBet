import express from 'express';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update vault (deposit/withdraw from balance)
router.post('/vault', authenticate, async (req, res) => {
  try {
    const { amount, type } = req.body; // type: 'deposit' or 'withdraw'
    const user = await User.findById(req.user.userId);
    
    if (type === 'deposit') {
      if (user.balance < amount) {
        return res.status(400).json({ message: 'Insufficient balance' });
      }
      user.balance -= amount;
      user.vault += amount;
    } else if (type === 'withdraw') {
      if (user.vault < amount) {
        return res.status(400).json({ message: 'Insufficient vault balance' });
      }
      user.vault -= amount;
      user.balance += amount;
    }
    
    await user.save();
    res.json({ balance: user.balance, vault: user.vault });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;