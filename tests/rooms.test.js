// tests/rooms.test.js
// Checks room creation, joining, reconnecting and cleanup.

const test = require('node:test');
const assert = require('node:assert/strict');
const rooms = require('../game/rooms');

test('creating and joining a room never leaks secrets', () => {
  const a = rooms.createRoom('s1', 'Ada');
  assert.equal(a.room.code.length, 6);
  const b = rooms.joinRoom(a.room.code.toLowerCase(), 's2', 'Tunde');
  assert.equal(b.room.players.length, 2);

  const state = JSON.stringify(rooms.publicState(b.room));
  assert.ok(!state.includes(a.player.secret));
  assert.ok(!state.includes(b.player.secret));

  rooms.removePlayer(a.room.code, a.player.id);
  rooms.removePlayer(a.room.code, b.player.id);
});

test('rejects duplicate nicknames and full rooms', () => {
  const a = rooms.createRoom('f1', 'Host');
  assert.ok(rooms.joinRoom(a.room.code, 'f2', 'host').error); // same name, different capitals
  for (let i = 0; i < 7; i++) {
    assert.ok(rooms.joinRoom(a.room.code, `f${i + 3}`, `P${i}`).room);
  }
  assert.match(rooms.joinRoom(a.room.code, 'f99', 'Late').error, /full/);
  [...a.room.players].forEach((p) => rooms.removePlayer(a.room.code, p.id));
});

test('a dropped player can rejoin with their secret and keeps their identity', () => {
  const a = rooms.createRoom('r1', 'Ada');
  const b = rooms.joinRoom(a.room.code, 'r2', 'Tunde');

  const dropped = rooms.markDisconnected('r2', 60000, () => {});
  assert.equal(dropped.player.connected, false);

  assert.ok(rooms.rejoin(a.room.code, 'wrong-secret', 'r3').error);

  const back = rooms.rejoin(a.room.code, b.player.secret, 'r3');
  assert.equal(back.player.id, b.player.id);
  assert.equal(back.player.connected, true);

  // The old connection finishing later must not mark them as away again.
  assert.equal(rooms.markDisconnected('r2', 60000, () => {}), null);

  rooms.removePlayer(a.room.code, a.player.id);
  rooms.removePlayer(a.room.code, b.player.id);
});

test('the next player becomes host, and empty rooms are deleted', () => {
  const a = rooms.createRoom('h1', 'Ada');
  const b = rooms.joinRoom(a.room.code, 'h2', 'Tunde');

  const result = rooms.removePlayer(a.room.code, a.player.id);
  assert.equal(result.room.hostId, b.player.id);

  const last = rooms.removePlayer(a.room.code, b.player.id);
  assert.equal(last.room, null);
  assert.equal(rooms.getRoom(a.room.code), null);
});

test('only valid settings are accepted', () => {
  const a = rooms.createRoom('t1', 'Ada');
  assert.equal(rooms.setSettings(a.room, 'hard', 15), true);
  assert.equal(rooms.setSettings(a.room, 'insane', 15), false);
  assert.equal(rooms.setSettings(a.room, 'easy', 7), false);
  assert.deepEqual(a.room.settings, { difficulty: 'hard', questionCount: 15, pointsToWin: 5 });
  rooms.removePlayer(a.room.code, a.player.id);
});

test('practice rooms cannot be joined by other people', () => {
  const a = rooms.createRoom('pr1', 'Ada', true);
  assert.equal(a.room.practice, true);
  assert.equal(rooms.publicState(a.room).practice, true);
  assert.ok(rooms.joinRoom(a.room.code, 'pr2', 'Tunde').error);
  rooms.removePlayer(a.room.code, a.player.id);
});

test('duel rooms hold up to 6 players, and the host cannot switch to duel with more', () => {
  const a = rooms.createRoom('d1', 'Host');
  for (let i = 0; i < 6; i++) {
    assert.ok(rooms.joinRoom(a.room.code, `d${i + 2}`, `Player${i}`).room);
  }
  assert.equal(a.room.players.length, 7);

  assert.ok(rooms.setMode(a.room, 'duel').error);
  assert.equal(a.room.mode, 'race');
  assert.ok(rooms.setMode(a.room, 'chess').error);

  rooms.removePlayer(a.room.code, a.room.players[6].id);
  assert.equal(rooms.setMode(a.room, 'duel').ok, true);
  assert.equal(a.room.mode, 'duel');
  assert.match(rooms.joinRoom(a.room.code, 'dx', 'Late').error, /full/);

  [...a.room.players].forEach((p) => rooms.removePlayer(a.room.code, p.id));
});

test('points to win only accepts 3, 5 or 10', () => {
  const a = rooms.createRoom('pw1', 'Ada');
  assert.equal(a.room.settings.pointsToWin, 5);
  assert.equal(rooms.setSettings(a.room, undefined, undefined, 10), true);
  assert.equal(rooms.setSettings(a.room, undefined, undefined, 7), false);
  assert.equal(a.room.settings.pointsToWin, 10);
  rooms.removePlayer(a.room.code, a.player.id);
});