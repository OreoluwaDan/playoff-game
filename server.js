// server.js
// The "brain" of PlayOff. Runs on the server, not in the player's browser.

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const rooms = require('./game/rooms');
const engine = require('./game/engine');

const RECONNECT_GRACE_MS = 60000; // a player who drops has this long to come back

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Every player has a private Socket.IO room named after their permanent id.
// It follows them across reconnects, so we can always message "just this player".
const privateRoom = (playerId) => `p:${playerId}`;

// The helper we give the game engine so it never needs to know about Socket.IO.
const net = {
  toPlayer: (playerId, event, data) => io.to(privateRoom(playerId)).emit(event, data),
  toRoom: (roomCode, event, data) => io.to(roomCode).emit(event, data),
};

// Who is this socket? Returns { room, playerId } or null.
function getMe(socket) {
  const info = rooms.getSocketInfo(socket.id);
  if (!info) return null;
  const room = rooms.getRoom(info.code);
  return room ? { room, playerId: info.playerId } : null;
}

// Remove a player for good and tell everyone who is still inside.
function removeFromRoom(code, playerId, reason) {
  const room = rooms.getRoom(code);
  if (!room) return;

  // Tell the others, but only while a game is under way.
  const leaver = room.players.find((p) => p.id === playerId);
  if (leaver && room.players.length > 1 && (room.status === 'countdown' || room.status === 'playing')) {
    io.to(code).emit('room:notice', {
      text: leaver.name + (reason === 'disconnected' ? ' disconnected' : ' left the game'),
    });
  }

  engine.playerLeft(room, net, playerId);

  const result = rooms.removePlayer(code, playerId);
  if (!result) return;
  if (result.room) io.to(code).emit('room:update', rooms.publicState(result.room));
  else engine.stop(result.closedRoom); // the room is empty and deleted, so cancel its timers
}

// Stops one connection from creating or joining rooms in a rapid-fire loop.
function tooManyAttempts(socket) {
  const now = Date.now();
  const recent = (socket.data.attempts || []).filter((t) => now - t < 60000);
  recent.push(now);
  socket.data.attempts = recent;
  return recent.length > 10;
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
    if (tooManyAttempts(socket)) return callback({ ok: false, error: 'Too many tries. Wait a moment.' });
    if (rooms.getSocketInfo(socket.id)) {
      return callback({ ok: false, error: 'You are already in a room.' });
    }

    const result = rooms.createRoom(
      socket.id,
      data && data.name,
      data && data.practice === true,
      data && data.mode
    );
    if (result.error) return callback({ ok: false, error: result.error });

    socket.join(result.room.code);
    socket.join(privateRoom(result.player.id));
    console.log('Room created:', result.room.code);
    callback({
      ok: true,
      playerId: result.player.id,
      secret: result.player.secret, // only this browser ever receives its secret
      room: rooms.publicState(result.room),
    });
  });

  socket.on('room:join', (data, callback) => {
    if (typeof callback !== 'function') return;
    if (tooManyAttempts(socket)) return callback({ ok: false, error: 'Too many tries. Wait a moment.' });
    if (rooms.getSocketInfo(socket.id)) {
      return callback({ ok: false, error: 'You are already in a room.' });
    }

    const result = rooms.joinRoom(data && data.code, socket.id, data && data.name);
    if (result.error) return callback({ ok: false, error: result.error });

    socket.join(result.room.code);
    socket.join(privateRoom(result.player.id));
    const state = rooms.publicState(result.room);
    callback({ ok: true, playerId: result.player.id, secret: result.player.secret, room: state });
    io.to(result.room.code).emit('room:update', state);
  });

  // A browser that lost its connection (or was refreshed) asks to get its seat back.
  socket.on('room:rejoin', (data, callback) => {
    if (typeof callback !== 'function') return;
    const result = rooms.rejoin(data && data.code, data && data.secret, socket.id);
    if (result.error) return callback({ ok: false, error: result.error });

    const { room, player, oldSocketId } = result;
    // If the old connection is somehow still open, close it so only one copy of this player exists.
    if (oldSocketId && oldSocketId !== socket.id) {
      const old = io.sockets.sockets.get(oldSocketId);
      if (old) old.disconnect(true);
    }

    socket.join(room.code);
    socket.join(privateRoom(player.id));
    const state = rooms.publicState(room);
    callback({ ok: true, playerId: player.id, room: state }); // the reply goes out first...
    io.to(room.code).emit('room:update', state);
    engine.setAway(room, net, player.id, false);
    engine.resync(room, net, player.id); // ...then the current question, countdown or results
  });

  // The host changes difficulty or number of questions.
  socket.on('room:settings', (data) => {
    const me = getMe(socket);
    if (!me || me.room.hostId !== me.playerId || me.room.status !== 'lobby') return;
    if (!rooms.setSettings(me.room, data && data.difficulty, data && data.questionCount)) return;
    io.to(me.room.code).emit('room:update', rooms.publicState(me.room));
  });

  // The host presses Start.
  socket.on('game:start', () => {
    const me = getMe(socket);
    if (!me || me.room.hostId !== me.playerId || me.room.status !== 'lobby') return;
    engine.startGame(me.room, net);
    io.to(me.room.code).emit('room:update', rooms.publicState(me.room));
  });

  // A player submits an answer. The reply goes straight back through "callback".
  socket.on('game:answer', (data, callback) => {
    if (typeof callback !== 'function') return;
    const me = getMe(socket);
    if (!me) return callback({ ok: false, error: 'You are not in a room.' });
    callback(engine.submitAnswer(me.room, net, me.playerId, data && data.answer));
  });

  socket.on('game:skip', (data, callback) => {
    if (typeof callback !== 'function') return;
    const me = getMe(socket);
    if (!me) return callback({ ok: false, error: 'You are not in a room.' });
    callback(engine.submitSkip(me.room, net, me.playerId));
  });

  // The host presses Rematch.
  socket.on('game:rematch', () => {
    const me = getMe(socket);
    if (!me || me.room.hostId !== me.playerId) return;
    if (engine.rematch(me.room)) {
      io.to(me.room.code).emit('room:update', rooms.publicState(me.room));
    }
  });

  // The player chose to leave: remove them straight away.
  socket.on('room:leave', () => {
    const info = rooms.getSocketInfo(socket.id);
    if (!info) return;
    socket.leave(info.code);
    socket.leave(privateRoom(info.playerId));
    removeFromRoom(info.code, info.playerId, 'left');
  });

  // The connection dropped. Keep their seat for a while in case they come back.
  socket.on('disconnect', () => {
    console.log('A player left:', socket.id);
    const result = rooms.markDisconnected(socket.id, RECONNECT_GRACE_MS, (code, playerId) => removeFromRoom(code, playerId, 'disconnected'));
    if (!result) return;
    io.to(result.room.code).emit('room:update', rooms.publicState(result.room));
    engine.setAway(result.room, net, result.player.id, true);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PlayOff is running at http://localhost:${PORT}`);
});