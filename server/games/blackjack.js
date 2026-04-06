import crypto from 'crypto';

// Secure RNG
const secureRandom = (min, max) => {
  const range = max - min;
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32LE(0);
  return min + (randomValue % range);
};

// Create and shuffle deck
const createDeck = (decks = 6) => {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  let deck = [];
  
  for (let d = 0; d < decks; d++) {
    for (let suit of suits) {
      for (let value of values) {
        deck.push({ suit, value, id: `${d}-${suit}-${value}` });
      }
    }
  }
  
  // Fisher-Yates shuffle with secure RNG
  for (let i = deck.length - 1; i > 0; i--) {
    const j = secureRandom(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
};

const getCardValue = (card) => {
  if (['J', 'Q', 'K'].includes(card.value)) return 10;
  if (card.value === 'A') return 11;
  return parseInt(card.value);
};

const calculateHand = (hand) => {
  let value = 0;
  let aces = 0;
  
  for (let card of hand) {
    value += getCardValue(card);
    if (card.value === 'A') aces++;
  }
  
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  
  return { value, soft: aces > 0 && value <= 21 };
};

const isBlackjack = (hand) => {
  return hand.length === 2 && calculateHand(hand).value === 21;
};

const canSplit = (hand) => {
  return hand.length === 2 && getCardValue(hand[0]) === getCardValue(hand[1]);
};

const canDouble = (hand) => {
  return hand.length === 2;
};

// Dealer plays with soft 17 rule (hits on soft 17)
const dealerPlay = (dealerHand, deck) => {
  let hand = [...dealerHand];
  let currentDeck = [...deck];
  
  while (true) {
    const { value, soft } = calculateHand(hand);
    
    // Hit on soft 17 or below, stand on hard 17+
    if (value < 17 || (value === 17 && soft)) {
      const card = currentDeck.pop();
      hand.push({ ...card, faceUp: true });
    } else {
      break;
    }
  }
  
  return { hand, deck: currentDeck };
};

export {
  createDeck,
  getCardValue,
  calculateHand,
  isBlackjack,
  canSplit,
  canDouble,
  dealerPlay,
  secureRandom
};