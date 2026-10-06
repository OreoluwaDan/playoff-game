// server.js
// The "brain" of Playoff. Runs on the server, not in the player's browser.

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const rooms = require('./game/rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Remove a player from their room and tell everyone who is still inside.
function leaveCurrentRoom(socket) {
  const result = rooms.removePlayer(socket.id);
  if (!result) return;
  socket.leave(result.code);
  if (result.room) {
    io.to(result.code).emit('room:update', rooms.publicState(result.room));
  }
}

io.on('connection', (socket) => {
  console.log('A player connected:', socket.id);

  // A browser asks to create a room.
  // "callback" is how we send the answer straight back to that one browser.
  socket.on('room:create', (data, callback) => {
    if (typeof callback !== 'function') return;
    if (rooms.getRoomCode(socket.id)) {
      return callback({ ok: false, error: 'You are already in a room.' });
    }

    const result = rooms.createRoom(socket.id, data && data.name);
    if (result.error) return callback({ ok: false, error: result.error });

    socket.join(result.room.code); // a Socket.IO "room": lets us message everyone inside it
    console.log('Room created:', result.room.code);
    callback({ ok: true, room: rooms.publicState(result.room) });
  });

  // A browser asks to join a room with a code.
  socket.on('room:join', (data, callback) => {
    if (typeof callback !== 'function') return;
    if (rooms.getRoomCode(socket.id)) {
      return callback({ ok: false, error: 'You are already in a room.' });
    }

    const result = rooms.joinRoom(data && data.code, socket.id, data && data.name);
    if (result.error) return callback({ ok: false, error: result.error });

    socket.join(result.room.code);
    const state = rooms.publicState(result.room);
    callback({ ok: true, room: state });
    // Tell everyone already in the room that the player list changed.
    io.to(result.room.code).emit('room:update', state);
  });

  socket.on('room:leave', () => leaveCurrentRoom(socket));

  socket.on('disconnect', () => {
    console.log('A player left:', socket.id);
    leaveCurrentRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Playoff is running at http://localhost:${PORT}`);
});