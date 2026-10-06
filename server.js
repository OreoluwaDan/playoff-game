// server.js
// The "brain" of PlayOff. Runs on the server, not in the player's browser.

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const rooms = require('./game/rooms');
const engine = require('./game/engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// The helper we give the game engine so it can send messages without knowing
// anything about Socket.IO. Every socket automatically sits in a private Socket.IO
// room named after its own id, so io.to(socketId) reaches just that one player.
const net = {
  toPlayer: (socketId, event, data) => io.to(socketId).emit(event, data),
  toRoom: (roomCode, event, data) => io.to(roomCode).emit(event, data),
};

// Find the room this socket is in (or null).
function getMyRoom(socket) {
  const code = rooms.getRoomCode(socket.id);
  return code ? rooms.getRoom(code) : null;
}

// Remove a player from their room and tell everyone who is still inside.
function leaveCurrentRoom(socket) {
  const room = getMyRoom(socket);
  if (room) engine.playerLeft(room, net, socket.id);

  const result = rooms.removePlayer(socket.id);
  if (!result) return;
  socket.leave(result.code);

  if (result.room) {
    io.to(result.code).emit('room:update', rooms.publicState(result.room));
  } else if (room) {
    engine.stop(room); // the room is empty and deleted, so cancel its timers
  }
}

io.on('connection', (socket) => {
  console.log('A player connected:', socket.id);

  // Clock sync: the browser asks "what time is it for you?" so it can work out
  // how far its own clock is off. That is how everyone starts together.
  socket.on('time:ping', (callback) => {
    if (typeof callback === 'function') callback(Date.now());
  });

  socket.on('room:create', (data, callback) => {
    if (typeof callback !== 'function') return;
    if (rooms.getRoomCode(socket.id)) {
      return callback({ ok: false, error: 'You are already in a room.' });
    }

    const result = rooms.createRoom(socket.id, data && data.name);
    if (result.error) return callback({ ok: false, error: result.error });

    socket.join(result.room.code);
    console.log('Room created:', result.room.code);
    callback({ ok: true, room: rooms.publicState(result.room) });
  });

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
    io.to(result.room.code).emit('room:update', state);
  });

  // The host changes difficulty or number of questions.
  socket.on('room:settings', (data) => {
    const room = getMyRoom(socket);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    if (!rooms.setSettings(room, data && data.difficulty, data && data.questionCount)) return;
    io.to(room.code).emit('room:update', rooms.publicState(room));
  });

  // The host presses Start.
  socket.on('game:start', () => {
    const room = getMyRoom(socket);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    engine.startGame(room, net);
    io.to(room.code).emit('room:update', rooms.publicState(room));
  });

  // A player submits an answer. The reply goes straight back through "callback".
  socket.on('game:answer', (data, callback) => {
    if (typeof callback !== 'function') return;
    const room = getMyRoom(socket);
    if (!room) return callback({ ok: false, error: 'You are not in a room.' });
    callback(engine.submitAnswer(room, net, socket.id, data && data.answer));
  });

  socket.on('game:skip', (data, callback) => {
    if (typeof callback !== 'function') return;
    const room = getMyRoom(socket);
    if (!room) return callback({ ok: false, error: 'You are not in a room.' });
    callback(engine.submitSkip(room, net, socket.id));
  });

  // The host presses Rematch.
  socket.on('game:rematch', () => {
    const room = getMyRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    if (engine.rematch(room)) {
      io.to(room.code).emit('room:update', rooms.publicState(room));
    }
  });

  socket.on('room:leave', () => leaveCurrentRoom(socket));

  socket.on('disconnect', () => {
    console.log('A player left:', socket.id);
    leaveCurrentRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PlayOff is running at http://localhost:${PORT}`);
});


