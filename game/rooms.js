// game/rooms.js
// Everything about creating, joining and leaving rooms lives here.
// Rooms are kept in memory (no database), which is fine for this game.

const { randomInt } = require('crypto');
const { DIFFICULTIES, QUESTION_COUNTS } = require('./questions');

const MAX_PLAYERS = 8;
const CODE_LENGTH = 6;

// Letters and numbers that are easy to read out loud.
// We left out 0, O, 1, I and L because people mix them up.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// One colour per player, used later for avatars and race lanes.
const COLORS = [
  '#58CC02', '#1CB0F6', '#FF9600', '#FF4B4B',
  '#CE82FF', '#FFC800', '#2B70C9', '#FF86D0',
];

const rooms = new Map();       // room code  -> room object
const playerRoom = new Map();  // socket id  -> room code (so we can find a player's room fast)

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

function createRoom(socketId, name) {
  const cleaned = cleanName(name);
  if (!cleaned) return { error: 'Please enter a nickname.' };

  const code = generateCode();
  const room = {
    code,
    hostId: socketId,
    status: 'lobby', // later: 'countdown', 'playing', 'finished'
    settings: { difficulty: 'medium', questionCount: 10 },
    players: [{ id: socketId, name: cleaned, color: COLORS[0] }],
  };

  rooms.set(code, room);
  playerRoom.set(socketId, code);
  return { room };
}

function joinRoom(code, socketId, name) {
  const cleaned = cleanName(name);
  if (!cleaned) return { error: 'Please enter a nickname.' };
  if (typeof code !== 'string') return { error: 'Please enter a room code.' };

  const room = rooms.get(code.trim().toUpperCase());
  if (!room) return { error: 'Room not found. Check the code and try again.' };
  if (room.status !== 'lobby') return { error: 'That game has already started.' };
  if (room.players.length >= MAX_PLAYERS) return { error: 'That room is full.' };
  if (room.players.some((p) => p.name.toLowerCase() === cleaned.toLowerCase())) {
    return { error: 'That nickname is already taken in this room.' };
  }

  room.players.push({ id: socketId, name: cleaned, color: pickColor(room) });
  playerRoom.set(socketId, room.code);
  return { room };
}

// Remove a player. If the host leaves, the next player becomes host.
// If nobody is left, the room is deleted. This is our room cleanup.
function removePlayer(socketId) {
  const code = playerRoom.get(socketId);
  if (!code) return null;
  playerRoom.delete(socketId);

  const room = rooms.get(code);
  if (!room) return null;

  room.players = room.players.filter((p) => p.id !== socketId);

  if (room.players.length === 0) {
    rooms.delete(code);
    return { code, room: null };
  }
  if (room.hostId === socketId) {
    room.hostId = room.players[0].id;
  }
  return { code, room };
}

function getRoomCode(socketId) {
  return playerRoom.get(socketId) || null;
}

// The version of a room that is safe to send to browsers.
function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    settings: room.settings,
    players: room.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
  };
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

module.exports = {
  createRoom, joinRoom, removePlayer, getRoomCode, getRoom, setSettings, publicState,
};