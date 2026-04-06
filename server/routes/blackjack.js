import express from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';
import {
  createDeck,
  calculateHand,
  isBlackjack,
  canSplit,
  canDouble,
  dealerPlay
} from '../games/blackjack.js';

const router = express.Router();
const activeGames = new Map();
const actionCounts = new Map();

// Memory cleanup
setInterval(() => {
  const now = Date.now();
  
  for (const [id, game] of activeGames) {
    // Keep ended games for 5 seconds to handle retries
    const timeout = game.gameState === 'ended' ? 5 * 1000 : 30 * 60 * 1000;
    if (now - game.createdAt > timeout) {
      activeGames.delete(id);
    }
  }
  
  for (const [userId, timestamps] of actionCounts) {
    const filtered = timestamps.filter(t => now - t < 1000);
    if (filtered.length === 0) {
      actionCounts.delete(userId);
    } else {
      actionCounts.set(userId, filtered);
    }
  }
}, 60000);

// Rate limiting
const checkRateLimit = (userId) => {
  const now = Date.now();
  const windowStart = now - 1000;
  
  if (!actionCounts.has(userId)) {
    actionCounts.set(userId, []);
  }
  
  const counts = actionCounts.get(userId).filter(t => t > windowStart);
  counts.push(now);
  actionCounts.set(userId, counts);
  
  return counts.length <= 10;
};

// Helpers
const maskDealerHand = (hand, gameState) => {
  if (gameState === 'ended') {
    return hand.map(c => ({ ...c, hidden: false }));
  }
  return hand.map((c, i) => ({ ...c, hidden: i === 1 }));
};

const getVisibleDealerValue = (hand) => {
  const visibleCards = hand.filter((c, i) => i !== 1);
  return calculateHand(visibleCards).value;
};

const generateGameId = () => crypto.randomUUID();

// Start game
router.post('/start', authenticate, async (req, res) => {
  try {
    const { bet } = req.body;
    const userId = req.user.userId;
    
    if (!bet || bet < 1 || bet > 100000) {
      return res.status(400).json({ message: 'Invalid bet amount (1-100000)' });
    }
    
    // Atomic balance check and deduct
    const user = await User.findOneAndUpdate(
      { _id: userId, balance: { $gte: bet } },
      { $inc: { balance: -bet } },
      { new: true }
    );
    
    if (!user) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }
    
    // Create deck once per game
    const deck = createDeck(6);
    
    const playerHand = [
      { ...deck.pop(), id: crypto.randomUUID() },
      { ...deck.pop(), id: crypto.randomUUID() }
    ];
    const dealerHand = [
      { ...deck.pop(), id: crypto.randomUUID() },
      { ...deck.pop(), id: crypto.randomUUID() }
    ];
    
    const playerBJ = isBlackjack(playerHand);
    const dealerBJ = isBlackjack(dealerHand);
    
    const gameId = generateGameId();
    const game = {
      id: gameId,
      userId,
      deck, // Single deck for entire game
      playerHands: [[...playerHand]],
      playerBets: [bet],
      hasActed: [false],
      activeHandIndex: 0,
      dealerHand,
      insurance: 0,
      insuranceTaken: false,
      gameState: 'playing',
      actionSequence: 0,
      createdAt: Date.now()
    };
    
    let result = null;
    
    if (playerBJ && dealerBJ) {
      result = { type: 'push', message: 'Push! Both have Blackjack', payout: bet, hands: [{ hand: 1, result: 'push', payout: bet }] };
      user.balance += bet;
      await user.save();
      game.gameState = 'ended';
    } else if (playerBJ) {
      const payout = bet + Math.floor(bet * 1.5);
      result = { type: 'win', message: 'Blackjack! 3:2 payout', payout, hands: [{ hand: 1, result: 'blackjack', payout }] };
      user.balance += payout;
      await user.save();
      game.gameState = 'ended';
    } else if (dealerBJ) {
      result = { type: 'loss', message: 'Dealer has Blackjack', payout: 0, hands: [{ hand: 1, result: 'loss', payout: 0 }] };
      game.gameState = 'ended';
    }
    
    const playerValues = game.playerHands.map(h => calculateHand(h).value);
    
    if (game.gameState === 'playing') {
      activeGames.set(gameId, game);
    } else {
      activeGames.set(gameId, game); // Keep briefly for state retrieval
    }
    
    res.json({
      gameId,
      playerHands: game.playerHands.map(h => h.map(c => ({ value: c.value, suit: c.suit }))),
      playerBets: game.playerBets,
      playerValues,
      activeHandIndex: 0,
      dealerHand: maskDealerHand(dealerHand, game.gameState).map(c => 
        c.hidden ? { hidden: true } : { value: c.value, suit: c.suit }
      ),
      dealerValue: game.gameState === 'ended' ? calculateHand(dealerHand).value : getVisibleDealerValue(dealerHand),
      gameState: game.gameState,
      result,
      balance: user.balance,
      canSplit: canSplit(playerHand) && game.gameState === 'playing',
      canDouble: canDouble(playerHand) && game.gameState === 'playing' && !game.hasActed[0],
      canInsurance: dealerHand[0].value === 'A' && game.gameState === 'playing' && !game.insuranceTaken,
      canHit: true,
      canStand: true
    });
    
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Actions
router.post('/action', authenticate, async (req, res) => {
  try {
    const { gameId, action, sequence } = req.body;
    const userId = req.user.userId;
    
    if (!checkRateLimit(userId)) {
      return res.status(429).json({ message: 'Too many actions' });
    }
    
    const game = activeGames.get(gameId);
    if (!game) {
      return res.status(400).json({ message: 'No active game' });
    }
    
    if (game.userId !== userId) {
      return res.status(403).json({ message: 'Not your game' });
    }
    
    // Strict sequence check - only accept +1
    if (sequence !== game.actionSequence + 1) {
      return res.status(400).json({ message: 'Invalid action sequence' });
    }
    game.actionSequence = sequence;
    
    if (game.gameState !== 'playing') {
      // Return final state if game ended
      return res.json({
        gameState: 'ended',
        playerHands: game.playerHands.map(h => h.map(c => ({ value: c.value, suit: c.suit }))),
        playerValues: game.playerHands.map(h => calculateHand(h).value),
        dealerHand: game.dealerHand.map(c => ({ value: c.value, suit: c.suit })),
        dealerValue: calculateHand(game.dealerHand).value,
        result: game.finalResult,
        balance: game.finalBalance,
        canInsurance: false,
        canHit: false,
        canStand: false,
        canDouble: false,
        canSplit: false
      });
    }
    
    // No deck reshuffle mid-game - use existing deck
    if (game.deck.length < 10) {
      return res.status(400).json({ message: 'Deck exhausted - game cannot continue' });
    }
    
    const user = await User.findById(userId);
    let { deck, playerHands, playerBets, hasActed, activeHandIndex, dealerHand, insuranceTaken } = game;
    let currentHand = [...playerHands[activeHandIndex]];
    let response = {};
    
    const handValue = calculateHand(currentHand);
    const canDoubleNow = canDouble(currentHand) && !hasActed[activeHandIndex];
    const canSplitNow = canSplit(currentHand) && playerHands.length < 4 && !hasActed[activeHandIndex];
    
    switch (action) {
      case 'hit': {
        if (handValue >= 21) {
          return res.status(400).json({ message: 'Cannot hit on 21 or bust' });
        }
        
        hasActed[activeHandIndex] = true;
        
        const card = { ...deck.pop(), id: crypto.randomUUID() };
        currentHand.push(card);
        playerHands[activeHandIndex] = currentHand;
        
        const newValue = calculateHand(currentHand).value;
        const playerValues = playerHands.map(h => calculateHand(h).value);
        
        if (newValue > 21) {
          if (activeHandIndex < playerHands.length - 1) {
            game.activeHandIndex++;
            response = {
              playerHands: playerHands.map(h => h.map(c => ({ value: c.value, suit: c.suit }))),
              playerBets,
              playerValues,
              activeHandIndex: game.activeHandIndex,
              dealerHand: maskDealerHand(dealerHand, 'playing').map(c => 
                c.hidden ? { hidden: true } : { value: c.value, suit: c.suit }
              ),
              dealerValue: getVisibleDealerValue(dealerHand),
              gameState: 'playing',
              canHit: true,
              canStand: true,
              canDouble: canDouble(playerHands[game.activeHandIndex]) && !hasActed[game.activeHandIndex],
              canSplit: canSplit(playerHands[game.activeHandIndex]) && playerHands.length < 4 && !hasActed[game.activeHandIndex],
              canInsurance: false
            };
          } else {
            const finalResult = await resolveDealer(dealerHand, deck, playerHands, playerBets, user, game);
            response = { ...finalResult, gameState: 'ended' };
            game.gameState = 'ended';
            game.finalResult = finalResult.result;
            game.finalBalance = finalResult.balance;
            // Keep for 5 seconds then delete
            setTimeout(() => activeGames.delete(gameId), 5000);
          }
        } else {
          response = {
            playerHands: playerHands.map(h => h.map(c => ({ value: c.value, suit: c.suit }))),
            playerBets,
            playerValues,
            activeHandIndex,
            dealerHand: maskDealerHand(dealerHand, 'playing').map(c => 
              c.hidden ? { hidden: true } : { value: c.value, suit: c.suit }
            ),
            dealerValue: getVisibleDealerValue(dealerHand),
            gameState: 'playing',
            canHit: newValue < 21,
            canStand: true,
            canDouble: false,
            canSplit: false,
            canInsurance: false
          };
        }
        break;
      }
      
      case 'stand': {
        hasActed[activeHandIndex] = true;
        
        if (activeHandIndex < playerHands.length - 1) {
          game.activeHandIndex++;
          const playerValues = playerHands.map(h => calculateHand(h).value);
          
          response = {
            playerHands: playerHands.map(h => h.map(c => ({ value: c.value, suit: c.suit }))),
            playerBets,
            playerValues,
            activeHandIndex: game.activeHandIndex,
            dealerHand: maskDealerHand(dealerHand, 'playing').map(c => 
              c.hidden ? { hidden: true } : { value: c.value, suit: c.suit }
            ),
            dealerValue: getVisibleDealerValue(dealerHand),
            gameState: 'playing',
            canHit: true,
            canStand: true,
            canDouble: canDouble(playerHands[game.activeHandIndex]) && !hasActed[game.activeHandIndex],
            canSplit: canSplit(playerHands[game.activeHandIndex]) && playerHands.length < 4 && !hasActed[game.activeHandIndex],
            canInsurance: false
          };
        } else {
          const finalResult = await resolveDealer(dealerHand, deck, playerHands, playerBets, user, game);
          response = { ...finalResult, gameState: 'ended' };
          game.gameState = 'ended';
          game.finalResult = finalResult.result;
          game.finalBalance = finalResult.balance;
          setTimeout(() => activeGames.delete(gameId), 5000);
        }
        break;
      }
      
      case 'double': {
        if (!canDoubleNow) {
          return res.status(400).json({ message: 'Cannot double down' });
        }
        
        // Atomic update
        const updatedUser = await User.findOneAndUpdate(
          { _id: userId, balance: { $gte: playerBets[activeHandIndex] } },
          { $inc: { balance: -playerBets[activeHandIndex] } },
          { new: true }
        );
        
        if (!updatedUser) {
          return res.status(400).json({ message: 'Insufficient balance for double' });
        }
        
        hasActed[activeHandIndex] = true;
        
        playerBets[activeHandIndex] *= 2;
        
        const card = { ...deck.pop(), id: crypto.randomUUID() };
        currentHand.push(card);
        playerHands[activeHandIndex] = currentHand;
        
        const newValue = calculateHand(currentHand).value;
        const playerValues = playerHands.map(h => calculateHand(h).value);
        
        if (activeHandIndex < playerHands.length - 1) {
          game.activeHandIndex++;
          response = {
            playerHands: playerHands.map(h => h.map(c => ({ value: c.value, suit: c.suit }))),
            playerBets,
            playerValues,
            activeHandIndex: game.activeHandIndex,
            dealerHand: maskDealerHand(dealerHand, 'playing').map(c => 
              c.hidden ? { hidden: true } : { value: c.value, suit: c.suit }
            ),
            dealerValue: getVisibleDealerValue(dealerHand),
            gameState: 'playing',
            canHit: true,
            canStand: true,
            canDouble: canDouble(playerHands[game.activeHandIndex]) && !hasActed[game.activeHandIndex],
            canSplit: canSplit(playerHands[game.activeHandIndex]) && playerHands.length < 4 && !hasActed[game.activeHandIndex],
            canInsurance: false,
            balance: updatedUser.balance
          };
        } else {
          const finalResult = await resolveDealer(dealerHand, deck, playerHands, playerBets, updatedUser, game);
          response = { ...finalResult, gameState: 'ended' };
          game.gameState = 'ended';
          game.finalResult = finalResult.result;
          game.finalBalance = finalResult.balance;
          setTimeout(() => activeGames.delete(gameId), 5000);
        }
        break;
      }
      
      case 'split': {
        if (!canSplitNow) {
          return res.status(400).json({ message: 'Cannot split' });
        }
        
        const currentBet = playerBets[activeHandIndex];
        
        const updatedUser = await User.findOneAndUpdate(
          { _id: userId, balance: { $gte: currentBet } },
          { $inc: { balance: -currentBet } },
          { new: true }
        );
        
        if (!updatedUser) {
          return res.status(400).json({ message: 'Insufficient balance for split' });
        }
        
        const card1 = currentHand[0];
        const card2 = currentHand[1];
        const isAces = card1.value === 'A';
        
        const newHand1 = [card1, { ...deck.pop(), id: crypto.randomUUID() }];
        const newHand2 = [card2, { ...deck.pop(), id: crypto.randomUUID() }];
        
        // Replace current hand with two new ones
        playerHands.splice(activeHandIndex, 1, newHand1, newHand2);
        playerBets.splice(activeHandIndex, 1, currentBet, currentBet);
        
        // Create new hasActed array properly
        const newHasActed = [...hasActed];
        newHasActed.splice(activeHandIndex, 1, false, false);
        game.hasActed = newHasActed;
        
        if (isAces) {
          // Split aces: one card each, auto-stand
          game.hasActed[activeHandIndex] = true;
          game.hasActed[activeHandIndex + 1] = true;
          
          const playerValues = playerHands.map(h => calculateHand(h).value);
          const finalResult = await resolveDealer(dealerHand, deck, playerHands, playerBets, updatedUser, game);
          response = { ...finalResult, gameState: 'ended', playerValues };
          game.gameState = 'ended';
          game.finalResult = finalResult.result;
          game.finalBalance = finalResult.balance;
          setTimeout(() => activeGames.delete(gameId), 5000);
        } else {
          const playerValues = playerHands.map(h => calculateHand(h).value);
          
          response = {
            playerHands: playerHands.map(h => h.map(c => ({ value: c.value, suit: c.suit }))),
            playerBets,
            playerValues,
            activeHandIndex,
            dealerHand: maskDealerHand(dealerHand, 'playing').map(c => 
              c.hidden ? { hidden: true } : { value: c.value, suit: c.suit }
            ),
            dealerValue: getVisibleDealerValue(dealerHand),
            gameState: 'playing',
            canHit: true,
            canStand: true,
            canDouble: canDouble(newHand1) && !game.hasActed[activeHandIndex],
            canSplit: canSplit(newHand1) && playerHands.length < 4 && !game.hasActed[activeHandIndex],
            canInsurance: false,
            balance: updatedUser.balance
          };
        }
        break;
      }
      
      case 'insurance': {
        if (insuranceTaken) {
          return res.status(400).json({ message: 'Insurance already taken' });
        }
        
        const insuranceBet = Math.floor(playerBets[0] / 2);
        
        const updatedUser = await User.findOneAndUpdate(
          { _id: userId, balance: { $gte: insuranceBet } },
          { $inc: { balance: -insuranceBet } },
          { new: true }
        );
        
        if (!updatedUser) {
          return res.status(400).json({ message: 'Insufficient balance for insurance' });
        }
        
        game.insurance = insuranceBet;
        game.insuranceTaken = true;
        
        const dealerHasBJ = isBlackjack(dealerHand);
        
        if (dealerHasBJ) {
          const insurancePayout = insuranceBet * 3;
          updatedUser.balance += insurancePayout;
          await updatedUser.save();
          
          const playerValues = playerHands.map(h => calculateHand(h).value);
          const finalResult = await resolveDealer(dealerHand, deck, playerHands, playerBets, updatedUser, game);
          response = { 
            ...finalResult, 
            gameState: 'ended',
            playerValues,
            insuranceResult: { type: 'win', payout: insurancePayout - insuranceBet },
            canInsurance: false
          };
          game.gameState = 'ended';
          game.finalResult = finalResult.result;
          game.finalBalance = finalResult.balance;
          setTimeout(() => activeGames.delete(gameId), 5000);
        } else {
          const playerValues = playerHands.map(h => calculateHand(h).value);
          
          response = {
            playerHands: playerHands.map(h => h.map(c => ({ value: c.value, suit: c.suit }))),
            playerBets,
            playerValues,
            activeHandIndex,
            dealerHand: maskDealerHand(dealerHand, 'playing').map(c => 
              c.hidden ? { hidden: true } : { value: c.value, suit: c.suit }
            ),
            dealerValue: getVisibleDealerValue(dealerHand),
            gameState: 'playing',
            canHit: true,
            canStand: true,
            canDouble: canDoubleNow,
            canSplit: canSplitNow,
            canInsurance: false,
            insuranceResult: { type: 'loss', amount: insuranceBet },
            balance: updatedUser.balance
          };
        }
        break;
      }
      
      default:
        return res.status(400).json({ message: 'Invalid action' });
    }
    
    game.deck = deck;
    game.playerHands = playerHands;
    game.playerBets = playerBets;
    activeGames.set(gameId, game);
    
    res.json({
      ...response,
      balance: response.balance || user.balance
    });
    
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Resolve dealer
async function resolveDealer(dealerHand, deck, playerHands, playerBets, user, game) {
  const dealerResult = dealerPlay(dealerHand, deck);
  const finalDealerValue = calculateHand(dealerResult.hand).value;
  
  let totalPayout = 0;
  let handResults = [];
  
  for (let i = 0; i < playerHands.length; i++) {
    const hand = playerHands[i];
    const handValue = calculateHand(hand).value;
    const handBet = playerBets[i];
    
    let result, payout;
    
    if (handValue > 21) {
      result = 'loss';
      payout = 0;
    } else if (finalDealerValue > 21) {
      result = 'win';
      payout = handBet * 2;
    } else if (handValue > finalDealerValue) {
      result = 'win';
      payout = handBet * 2;
    } else if (handValue < finalDealerValue) {
      result = 'loss';
      payout = 0;
    } else {
      result = 'push';
      payout = handBet;
    }
    
    totalPayout += payout;
    handResults.push({ hand: i + 1, result, payout: payout > 0 ? payout - handBet : 0, bet: handBet });
  }
  
  if (totalPayout > 0) {
    user.balance += totalPayout;
    await user.save();
  }
  
  const wins = handResults.filter(h => h.result === 'win').length;
  const losses = handResults.filter(h => h.result === 'loss').length;
  
  let overallType;
  if (wins > 0 && losses === 0) overallType = 'win';
  else if (losses > 0 && wins === 0) overallType = 'loss';
  else overallType = 'mixed';
  
  return {
    playerHands: playerHands.map(h => h.map(c => ({ value: c.value, suit: c.suit }))),
    playerBets,
    playerValues: playerHands.map(h => calculateHand(h).value),
    dealerHand: dealerResult.hand.map(c => ({ value: c.value, suit: c.suit })),
    dealerValue: finalDealerValue,
    result: {
      type: overallType,
      hands: handResults,
      totalPayout: totalPayout - playerBets.reduce((a, b) => a + b, 0),
      message: handResults.map(h => `Hand ${h.hand}: ${h.result}`).join(', ')
    },
    balance: user.balance
  };
}

export default router;