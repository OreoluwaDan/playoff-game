// tests/engine.test.js
// Plays pretend games against the referee and checks the rules.

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../game/engine');

// A fake room, plus a fake "net" that just records every message the engine sends.
function makeRoom(names, questionCount = 5) {
  const room = {
    code: 'TEST01',
    hostId: 'p1',
    status: 'lobby',
    settings: { difficulty: 'easy', questionCount },
    players: names.map((name, i) => ({ id: `p${i + 1}`, name, color: '#000000' })),
  };
  const events = [];
  const net = {
    toPlayer: (to, e, payload) => events.push({ to, e, payload }),
    toRoom: (to, e, payload) => events.push({ to, e, payload }),
  };
  return { room, net, events };
}

// Start a game and jump straight to GO (skipping the 4 second wait).
function startNow(room, net) {
  engine.startGame(room, net);
  room.game.startAt = Date.now();
  engine.beginRace(room, net);
}

// The engine ignores actions less than 150ms apart. In tests we reset that timer.
function answerCorrectly(room, net, id) {
  const p = room.game.players.get(id);
  p.lastActionAt = 0;
  return engine.submitAnswer(room, net, id, String(room.game.questions[p.index].answer));
}

function solveAll(room, net, id) {
  const p = room.game.players.get(id);
  while (p.finishedAt === null) answerCorrectly(room, net, id);
}

test('a player who answers everything correctly finishes the game', () => {
  const { room, net, events } = makeRoom(['Ada']);
  try {
    startNow(room, net);
    solveAll(room, net, 'p1');
    const results = events.find((e) => e.e === 'game:results');
    assert.ok(results, 'results should be sent');
    const me = results.payload.players[0];
    assert.equal(me.finished, true);
    assert.equal(me.wrongs, 0);
    assert.equal(me.rank, 1);
    assert.equal(room.status, 'finished');
  } finally {
    engine.stop(room);
  }
});

test('a wrong answer has no penalty and keeps you on the same question', () => {
  const { room, net } = makeRoom(['Ada']);
  try {
    startNow(room, net);
    const p = room.game.players.get('p1');
    p.lastActionAt = 0;
    const wrong = String(room.game.questions[0].answer + 1);
    const res = engine.submitAnswer(room, net, 'p1', wrong);
    assert.equal(res.correct, false);
    assert.equal(p.index, 0);
    assert.equal(p.penaltyMs, 0);
    assert.equal(p.wrongs, 1);
  } finally {
    engine.stop(room);
  }
});

test('skipping costs 15 seconds and moves to the next question', () => {
  const { room, net } = makeRoom(['Ada']);
  try {
    startNow(room, net);
    const p = room.game.players.get('p1');
    p.lastActionAt = 0;
    const res = engine.submitSkip(room, net, 'p1');
    assert.equal(res.skipped, true);
    assert.equal(p.penaltyMs, 15000);
    assert.equal(p.index, 1);
    assert.equal(res.question.index, 1);
  } finally {
    engine.stop(room);
  }
});

test('the cleaner, faster player ranks first', () => {
  const { room, net, events } = makeRoom(['Ada', 'Tunde']);
  try {
    startNow(room, net);
    solveAll(room, net, 'p1');

    const p2 = room.game.players.get('p2');
    p2.lastActionAt = 0;
    engine.submitSkip(room, net, 'p2');
    solveAll(room, net, 'p2');

    const results = events.find((e) => e.e === 'game:results').payload.players;
    assert.equal(results[0].id, 'p1');
    assert.equal(results[1].skips, 1);
    assert.ok(results[1].totalMs - results[0].totalMs > 14000, 'the skip should add about 15 seconds');
  } finally {
    engine.stop(room);
  }
});

test('questions sent to players never include the answer', () => {
  const { room, net, events } = makeRoom(['Ada']);
  try {
    startNow(room, net);
    const res = answerCorrectly(room, net, 'p1');
    const sent = events.filter((e) => e.e === 'game:question').map((e) => e.payload);
    sent.push(res.question);
    for (const q of sent) {
      assert.ok(q, 'there should be a question');
      assert.ok(!('answer' in q), 'the answer must never be sent');
    }
  } finally {
    engine.stop(room);
  }
});

test('answers sent too quickly are ignored', () => {
  const { room, net } = makeRoom(['Ada']);
  try {
    startNow(room, net);
    const p = room.game.players.get('p1');
    p.lastActionAt = 0;
    engine.submitAnswer(room, net, 'p1', '1');
    const second = engine.submitAnswer(room, net, 'p1', '1');
    assert.equal(second.ok, false);
  } finally {
    engine.stop(room);
  }
});

test('streak bonus: 3 or more right first time in a row takes off 0.5s each', () => {
  const { room, net } = makeRoom(['Ada'], 10);
  try {
    startNow(room, net);
    for (let i = 0; i < 4; i++) answerCorrectly(room, net, 'p1');
    // The streak reaches 3 on the third answer and 4 on the fourth: two bonuses.
    assert.equal(room.game.players.get('p1').bonusMs, 1000);
  } finally {
    engine.stop(room);
  }
});

test('a wrong answer breaks the streak', () => {
  const { room, net } = makeRoom(['Ada'], 10);
  try {
    startNow(room, net);
    const p = room.game.players.get('p1');
    answerCorrectly(room, net, 'p1');
    answerCorrectly(room, net, 'p1');
    p.lastActionAt = 0;
    engine.submitAnswer(room, net, 'p1', String(room.game.questions[p.index].answer + 1));
    answerCorrectly(room, net, 'p1');
    answerCorrectly(room, net, 'p1');
    assert.equal(p.bonusMs, 0);
  } finally {
    engine.stop(room);
  }
});