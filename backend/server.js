const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

const corsOptions = {
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

const server = http.createServer(app);

const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'pong' });
});

const drawings = [];

io.on('connection', (socket) => {
  console.log('new client connecteed', socket.id);
  
  socket.emit('load-drawings', drawings);

  socket.on('draw', (data) => {
    drawings.push(data);
    // include sender in the re broadcast
    io.emit('draw', data);
  });

  socket.on('clear', () => {
    drawings.length = 0;
    io.emit('clear');
  });

  socket.on('disconnect', () => {
    console.log('client disconnected', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.error('conn error:', err);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
