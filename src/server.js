require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { connectDB, getDBStatus } = require('./config/db');
const { initKeepAlive } = require('./cron/keepAlive');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Allowed CORS Origins
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:3000',
  'http://localhost:3001',
  'https://personalcarebd.com',
];

// Socket.io Setup
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl) or allowed origins
      if (!origin || allowedOrigins.includes(origin) || origin.includes('localhost')) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in dev/staging
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  },
});

// Attach io to Express app for use inside route handlers / controllers
app.set('io', io);

// Socket.io Connection lifecycle
io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  socket.on('join_admin', () => {
    socket.join('admin_room');
    console.log(`[Socket.io] Admin joined notification channel: ${socket.id}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket.io] Client disconnected: ${socket.id} (${reason})`);
  });
});

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow all origins (Vercel, Render, Localhost, Custom Domain)
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Connect to DB
connectDB();

// Root Welcome Endpoint
app.get('/', (req, res) => {
  const { isConnected, isMockMode } = getDBStatus();
  res.json({
    success: true,
    message: 'Personal Care BD API is running smoothly',
    status: 'online',
    environment: process.env.NODE_ENV || 'production',
    database: isConnected ? 'connected' : isMockMode ? 'mock-mode' : 'disconnected',
    socketConnections: io.engine ? io.engine.clientsCount : 0,
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      orders: '/api/orders',
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Personal Care BD API Root',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      orders: '/api/orders',
    },
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', require('./routes/orders'));

// Health check
app.get('/api/health', (req, res) => {
  const { isConnected, isMockMode } = getDBStatus();
  res.json({
    status: 'OK',
    message: 'Personal Care BD API is running',
    database: isConnected ? 'connected' : isMockMode ? 'mock-mode' : 'disconnected',
    socketConnections: io.engine ? io.engine.clientsCount : 0,
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'রুট পাওয়া যায়নি।' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ success: false, message: 'অভ্যন্তরীণ সার্ভার ত্রুটি।', error: err.message });
});

// Start Server
server.listen(PORT, () => {
  console.log(`[Server] Personal Care BD API running on http://localhost:${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
  console.log(`[Server] WebSocket (Socket.io) initialized`);

  // Initialize Render 14-minute keep-alive cron job
  initKeepAlive(PORT);
});

module.exports = { app, server, io };

