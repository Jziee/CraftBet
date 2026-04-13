import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// CORS middleware - MUST be before any routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(cors());
app.use(express.json());

// Test route - check if server is alive
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import gameRoutes from './routes/games.js';
import blackjackRoutes from './routes/blackjack.js';
import minesRoutes from './routes/mines.js';
import towersRoutes from './routes/towers.js';
import hiloRoutes from './routes/hilo.js';
import limboRoutes from './routes/limbo.js';
import coinflipPVPRoutes from './routes/coinflippvp.js';
import coinflipSoloRoutes from './routes/coinflipsolo.js';
import casinoRoutes from './routes/casino.js';


app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/blackjack', blackjackRoutes);
app.use('/api/mines', minesRoutes);
app.use('/api/towers', towersRoutes);
app.use('/api/hilo', hiloRoutes);
app.use('/api/limbo', limboRoutes);
app.use('/api/coinflip/pvp', coinflipPVPRoutes);
app.use('/api/coinflip/solo', coinflipSoloRoutes);
app.use('/api/casino', casinoRoutes);


// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/craftbet')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


export { io };