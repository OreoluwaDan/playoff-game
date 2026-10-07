// game/rooms.js
// Everything about creating, joining, leaving and rejoining rooms lives here.
// Rooms are kept in memory (no database), which is fine for this game.
//
// Each player has:
//   id      - a permanent public id (other players can see it)
//   secret  - a private password that only this player's browser knows.
//             It proves "I am the same person" when reconnecting.
//   socketId - the CURRENT connection. It changes every time they reconnect.

const { randomInt, randomBytes } = require('crypto');
const { DIFFICULTIES, QUESTION_COUNTS } = require('./questions');

const MAX_PLAYERS = 8;
const MAX_ROOMS = 500;
const CODE_LENGTH = 6;

// Letters and numbers that are easy to read out loud (no 0, O, 1, I or L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const COLORS = [
  '#58CC02', '#1CB0F6', '#FF9600', '#FF4B4B',
  '#CE82FF', '#FFC800', '#2B70C9', '#FF86D0',
];

const rooms = new Map();       // room code  -> room object
const socketInfo = new Map();  // socket id  -> { code, playerId }

function generateCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    }
  } while (rooms.has(code)); // keep trying until the code is unique
  return code;
}

// Never trust names from the browser: must be text, trimmed, max 20 characters.
function cleanName(name) {
  if (typeof name !== 'string') return null;
  const cleaned = name.trim().replace(/\s+/g, ' ').slice(0, 20);
  return cleaned.length > 0 ? cleaned : null;
}

// Pick the first colour nobody in the room is using yet.
function pickColor(room) {
  const used = room.players.map((p) => p.color);
  return COLORS.find((c) => !used.includes(c)) || COLORS[0];
}

function makePlayer(socketId, name, color) {
  return {
    id: randomBytes(6).toString('hex'),
    secret: randomBytes(16).toString('hex'),
    name,
    color,
    socketId,
    connected: true,
    dropTimer: null, // counts down the 60 seconds a disconnected player has to come back
  };
}

function createRoom(socketId, name, practice) {
  if (rooms.size >= MAX_ROOMS) return { error: 'The server is busy right now. Try again soon.' };
  const cleaned = cleanName(name);
  if (!cleaned) return { error: 'Please enter a nickname.' };

  const code = generateCode();
  const player = makePlayer(socketId, cleaned, COLORS[0]);
  const room = {
    code,
    hostId: player.id,
    status: 'lobby', // later: 'countdown', 'playing', 'finished'
    settings: { difficulty: 'medium', questionCount: 10 },
    players: [player],
    game: null,
    practice: practice === true,
  };

  rooms.set(code, room);
  socketInfo.set(socketId, { code, playerId: player.id });
  return { room, player };
}

function joinRoom(code, socketId, name) {
  const cleaned = cleanName(name);
  if (!cleaned) return { error: 'Please enter a nickname.' };
  if (typeof code !== 'string') return { error: 'Please enter a room code.' };

  const room = rooms.get(code.trim().toUpperCase());
  if (!room) return { error: 'Room not found. Check the code and try again.' };
  if (room.practice) return { error: 'Room not found. Check the code and try again.' };
  if (room.status !== 'lobby') return { error: 'That game has already started.' };
  if (room.players.length >= MAX_PLAYERS) return { error: 'That room is full.' };
  if (room.players.some((p) => p.name.toLowerCase() === cleaned.toLowerCase())) {
    return { error: 'That nickname is already taken in this room.' };
  }

  const player = makePlayer(socketId, cleaned, pickColor(room));
  room.players.push(player);
  socketInfo.set(socketId, { code: room.code, playerId: player.id });
  return { room, player };
}

// A player came back (new connection, same person). The secret proves who they are.
function rejoin(code, secret, socketId) {
  if (typeof code !== 'string' || typeof secret !== 'string') {
    return { error: 'Your session is not valid any more.' };
  }
  const room = rooms.get(code.trim().toUpperCase());
  if (!room) return { error: 'That game no longer exists.' };

  const player = room.players.find((p) => p.secret === secret);
  if (!player) return { error: 'You are no longer in that game.' };

  const oldSocketId = player.socketId;
  if (oldSocketId) socketInfo.delete(oldSocketId);

  clearTimeout(player.dropTimer);
  player.dropTimer = null;
  player.socketId = socketId;
  player.connected = true;
  socketInfo.set(socketId, { code: room.code, playerId: player.id });
  return { room, player, oldSocketId };
}

// A connection dropped. We do NOT remove the player yet: they get graceMs to come back.
// onExpire(code, playerId) is called if they don't.
function markDisconnected(socketId, graceMs, onExpire) {
  const info = socketInfo.get(socketId);
  if (!info) return null; // already removed, or already replaced by a newer connection

  socketInfo.delete(socketId);
  const room = rooms.get(info.code);
  const player = room && room.players.find((p) => p.id === info.playerId);
  if (!player) return null;

  player.connected = false;
  player.socketId = null;
  clearTimeout(player.dropTimer);
  player.dropTimer = setTimeout(() => onExpire(room.code, player.id), graceMs);
  // "unref" means this timer alone never keeps the program alive.
  if (player.dropTimer.unref) player.dropTimer.unref();
  return { room, player };
}

// Remove a player for good (they left, or their 60 seconds ran out).
// If the host goes, another player becomes host. If nobody is left, the room is deleted.
function removePlayer(code, playerId) {
  const room = rooms.get(code);
  if (!room) return null;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return null;

  clearTimeout(player.dropTimer);
  if (player.socketId) socketInfo.delete(player.socketId);
  room.players = room.players.filter((p) => p.id !== playerId);

  if (room.players.length === 0) {
    rooms.delete(code);
    return { code, room: null, closedRoom: room };
  }
  if (room.hostId === playerId) {
    const next = room.players.find((p) => p.connected) || room.players[0];
    room.hostId = next.id;
  }
  return { code, room };
}

function getSocketInfo(socketId) {
  return socketInfo.get(socketId) || null;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

// The host changes the difficulty or question count. We check both values.
function setSettings(room, difficulty, questionCount) {
  if (!DIFFICULTIES.includes(difficulty)) return false;
  if (!QUESTION_COUNTS.includes(questionCount)) return false;
  room.settings = { difficulty, questionCount };
  return true;
}

// The version of a room that is safe to send to browsers. It never includes secrets.
function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    practice: room.practice,
    settings: room.settings,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
    })),
  };
}

module.exports = {
  createRoom, joinRoom, rejoin, markDisconnected, removePlayer,
  getSocketInfo, getRoom, setSettings, publicState,
};


