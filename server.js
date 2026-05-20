const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const commentRoutes = require('./routes/comments');
const notificationRoutes = require('./routes/notifications');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  }
});

// Set Socket.io instance on app to be accessible in routes
app.set('io', io);

// Middleware for JSON parsing and urlencoding
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// REST API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/notifications', notificationRoutes);

// Catch-all to serve the frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Database Connection
const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/codealpha-pm';
mongoose.connect(dbURI)
  .then(() => console.log('Successfully connected to MongoDB.'))
  .catch((err) => {
    console.error('CRITICAL: MongoDB connection error. Please make sure MongoDB is running locally.');
    console.error(err);
  });

// Socket.io Real-Time Connection Engine
io.on('connection', (socket) => {
  let authenticatedUser = null;

  // Handshake Token Authentication
  const token = socket.handshake.query.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretcodealphapmpasskey123!');
      authenticatedUser = decoded.user;
      
      // Join a private room for targeted direct notifications (e.g. user:userId)
      socket.join(`user:${authenticatedUser.id}`);
      console.log(`Socket authenticated: User ${authenticatedUser.name} (${authenticatedUser.id}) connected.`);
    } catch (err) {
      console.error('Socket token verification failed:', err.message);
    }
  } else {
    console.log('Socket connected anonymously.');
  }

  // Client requests to join a project room for Kanban collaboration
  socket.on('join:project', ({ projectId }) => {
    socket.join(`project:${projectId}`);
    console.log(`Socket ${socket.id} joined project room: project:${projectId}`);
  });

  // Client requests to leave a project room
  socket.on('leave:project', ({ projectId }) => {
    socket.leave(`project:${projectId}`);
    console.log(`Socket ${socket.id} left project room: project:${projectId}`);
  });

  // Handle manual disconnect
  socket.on('disconnect', () => {
    if (authenticatedUser) {
      console.log(`User ${authenticatedUser.name} (${authenticatedUser.id}) disconnected.`);
    } else {
      console.log('Anonymous socket disconnected.');
    }
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`  CodeAlpha Project Management Server Running!`);
  console.log(`  Local Address: http://localhost:${PORT}`);
  console.log(`  Socket.io Engine initialized successfully.`);
  console.log(`===================================================`);
});
