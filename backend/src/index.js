'use strict';

require('dotenv').config();

const http = require('node:http');
const { Server } = require('socket.io');

const createApp = require('./app');
const { attachSocket } = require('./socket');

const PORT = process.env.PORT || 3000;

const app = createApp();
const server = http.createServer(app);

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    credentials: true,
  },
});

attachSocket(io);

server.listen(PORT, () => {
  console.log(`[drawguess-backend] listening on http://localhost:${PORT}`);
});
