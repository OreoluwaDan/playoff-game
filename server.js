// server.js
// This file is the "brain" of Debugrr_. It runs on your computer (later, on Render),
// not in the player's browser.

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// Express serves the web page. Socket.IO needs a plain HTTP server underneath it,
// so we create one and give it to both.
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Send everything inside the "public" folder to the browser when it asks.
// index.html, the CSS and the front-end JavaScript all live there.
app.use(express.static(path.join(__dirname, 'public')));

// This runs every time a browser connects to the server.
io.on('connection', (socket) => {
  console.log('A player connected:', socket.id);

  // Tell EVERYONE how many people are connected right now.
  io.emit('online', io.engine.clientsCount);

  // A browser can send us a "hello" message with a name.
  socket.on('hello', (name) => {
    // Never trust what a browser sends. Check it before using it.
    if (typeof name !== 'string') return;
    const cleanName = name.trim().slice(0, 20); // max 20 characters
    if (cleanName.length === 0) return;

    // Reply to just this one browser.
    socket.emit('welcome', `Hi ${cleanName}! The server can hear you.`);
  });

  // This runs when the browser closes or loses connection.
  socket.on('disconnect', () => {
    console.log('A player left:', socket.id);
    io.emit('online', io.engine.clientsCount);
  });
});

// Render will give us a port number through process.env.PORT.
// On your own computer we fall back to 3000.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PlayOff is running at http://localhost:${PORT}`);
});