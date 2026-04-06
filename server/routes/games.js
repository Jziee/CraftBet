import express from 'express';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// Placeholder game endpoints - we'll implement actual game logic later
router.post('/bet', authenticate, async (req, res) => {
  try {
    const { amount, game } = req.body;
    const user = await User.findById(req.user.userId);
    
    if (user.balance < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Deduct bet
    user.balance -= amount;
    await user.save();

    res.json({ 
      message: 'Bet placed',
      newBalance: user.balance,
      game
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/win', authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user.userId);
    
    user.balance += amount;
    await user.save();
    
    res.json({ balance: user.balance });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;