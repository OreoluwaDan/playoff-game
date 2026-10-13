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
    players: names.map((name, i) => ({ id: `p${i + 1}`, name, color: '#000000', connected: true })),
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

test('five wrong answers in a row trigger a short cooldown', () => {
  const { room, net } = makeRoom(['Ada']);
  try {
    startNow(room, net);
    const p = room.game.players.get('p1');
    const wrong = String(room.game.questions[0].answer + 1);
    let last;
    for (let i = 0; i < 5; i++) {
      p.lastActionAt = 0;
      last = engine.submitAnswer(room, net, 'p1', wrong);
    }
    assert.equal(last.correct, false);
    assert.equal(last.cooldownMs, 3000);

    // Even the RIGHT answer is refused while the box is locked.
    p.lastActionAt = 0;
    const blocked = engine.submitAnswer(room, net, 'p1', String(room.game.questions[0].answer));
    assert.equal(blocked.ok, false);
    assert.ok(blocked.cooldownMs > 0);
  } finally {
    engine.stop(room);
  }
});

test('results include a game id so the browser never saves one game twice', () => {
  const { room, net, events } = makeRoom(['Ada']);
  try {
    startNow(room, net);
    solveAll(room, net, 'p1');
    const results = events.find((e) => e.e === 'game:results');
    assert.equal(typeof results.payload.gameId, 'number');
  } finally {
    engine.stop(room);
  }
});

// A solo room set up for Time Attack.
function makeTimeAttackRoom() {
  const made = makeRoom(['Ada']);
  made.room.practice = true;
  made.room.mode = 'timeattack';
  made.room.settings = { difficulty: 'easy', questionCount: 10 };
  return made;
}

test('time attack prepares a long supply of questions and counts correct answers', () => {
  const { room, net } = makeTimeAttackRoom();
  try {
    startNow(room, net);
    assert.ok(room.game.questions.length >= 100);
    for (let i = 0; i < 5; i++) answerCorrectly(room, net, 'p1');
    assert.equal(room.game.players.get('p1').score, 5);
  } finally {
    engine.stop(room);
  }
});

test('time attack gives exactly one free skip', () => {
  const { room, net } = makeTimeAttackRoom();
  try {
    startNow(room, net);
    const p = room.game.players.get('p1');

    p.lastActionAt = 0;
    const first = engine.submitSkip(room, net, 'p1');
    assert.equal(first.ok, true);
    assert.equal(first.penaltyMs, 0);
    assert.equal(p.penaltyMs, 0);
    assert.equal(p.index, 1);

    p.lastActionAt = 0;
    const second = engine.submitSkip(room, net, 'p1');
    assert.equal(second.ok, false);
    assert.equal(p.index, 1);
  } finally {
    engine.stop(room);
  }
});

test('time attack: wrong answers cost nothing and the score is the result', () => {
  const { room, net, events } = makeTimeAttackRoom();
  try {
    startNow(room, net);
    const p = room.game.players.get('p1');
    for (let i = 0; i < 3; i++) answerCorrectly(room, net, 'p1');

    p.lastActionAt = 0;
    const wrong = String(room.game.questions[p.index].answer + 1);
    const res = engine.submitAnswer(room, net, 'p1', wrong);
    assert.equal(res.correct, false);
    assert.equal(p.penaltyMs, 0);

    engine.playerLeft(room, net, 'p1'); // the only player leaves, so the game ends
    const results = events.find((e) => e.e === 'game:results').payload;
    assert.equal(results.mode, 'timeattack');
    assert.equal(results.players[0].score, 3);
    assert.equal(room.status, 'finished');
  } finally {
    engine.stop(room);
  }
});

test('with two players, the one who stays wins at once when the other quits', () => {
  const { room, net, events } = makeRoom(['Ada', 'Tunde']);
  try {
    startNow(room, net);
    answerCorrectly(room, net, 'p2');
    engine.playerLeft(room, net, 'p1');

    const results = events.find((e) => e.e === 'game:results').payload;
    assert.equal(results.forfeit, true);
    assert.equal(results.players[0].id, 'p2');
    assert.equal(results.players[0].rank, 1);
    assert.equal(results.players[0].forfeitWin, true);
    assert.equal(results.players[1].id, 'p1');
    assert.equal(results.players[1].left, true);
    assert.equal(room.status, 'finished');
  } finally {
    engine.stop(room);
  }
});

test('with three players, the game carries on and the quitter ranks last', () => {
  const { room, net, events } = makeRoom(['Ada', 'Tunde', 'Chi']);
  try {
    startNow(room, net);
    engine.playerLeft(room, net, 'p3');
    assert.equal(room.status, 'playing');
    assert.equal(events.some((e) => e.e === 'game:results'), false);

    solveAll(room, net, 'p1');
    solveAll(room, net, 'p2');
    const results = events.find((e) => e.e === 'game:results').payload;
    assert.equal(results.forfeit, false);
    assert.equal(results.players[2].id, 'p3');
    assert.equal(results.players[2].rank, 3);
  } finally {
    engine.stop(room);
  }
});

test('no forfeit win if someone had already finished', () => {
  const { room, net, events } = makeRoom(['Ada', 'Tunde']);
  try {
    startNow(room, net);
    solveAll(room, net, 'p1');
    engine.playerLeft(room, net, 'p2');

    const results = events.find((e) => e.e === 'game:results').payload;
    assert.equal(results.forfeit, false);
    assert.equal(results.players[0].id, 'p1');
    assert.equal(typeof results.players[0].totalMs, 'number');
  } finally {
    engine.stop(room);
  }
});

// ---------- Duel ----------

// A room set up for a Duel.
function makeDuelRoom(names, pointsToWin = 3) {
  const made = makeRoom(names);
  made.room.mode = 'duel';
  made.room.settings = { difficulty: 'easy', questionCount: 10, pointsToWin };
  return made;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wait until the game is showing a question (gives up after 2 seconds).
async function untilQuestion(room) {
  for (let i = 0; i < 400; i++) {
    if (room.game.phase === 'question') return true;
    await wait(5);
  }
  return false;
}

// Answer the current Duel question (right or wrong) for one player.
function duelAnswer(room, net, id, correct = true) {
  const game = room.game;
  game.players.get(id).lastActionAt = 0;
  const answer = game.questions[game.round - 1].answer;
  return engine.submitAnswer(room, net, id, String(correct ? answer : answer + 1));
}

// Makes the Duel pauses very short for a test, and returns a function that puts them back.
function fastDuel(overrides = {}) {
  const saved = { ...engine.duelTiming };
  Object.assign(engine.duelTiming, { countMs: 5, pauseMs: 5, roundTimeoutMs: 5000, ...overrides });
  return () => Object.assign(engine.duelTiming, saved);
}

test('duel: the first correct answer takes the point and later answers are too late', () => {
  const { room, net, events } = makeDuelRoom(['Ada', 'Tunde']);
  try {
    startNow(room, net);
    assert.equal(room.game.phase, 'question');

    const first = duelAnswer(room, net, 'p2');
    assert.equal(first.correct, true);
    assert.equal(room.game.players.get('p2').score, 1);

    const late = duelAnswer(room, net, 'p1');
    assert.equal(late.ok, false);
    assert.equal(late.late, true);
    assert.equal(room.game.players.get('p1').score, 0);

    const states = events.filter((e) => e.e === 'duel:state');
    const point = states.filter((e) => e.payload.phase === 'point').pop().payload;
    assert.equal(point.point.winnerId, 'p2');
    assert.equal(typeof point.point.answer, 'number');
  } finally {
    engine.stop(room);
  }
});

test('duel: the question is sent without its answer', () => {
  const { room, net, events } = makeDuelRoom(['Ada', 'Tunde']);
  try {
    startNow(room, net);
    const open = events.filter((e) => e.e === 'duel:state' && e.payload.phase === 'question').pop().payload;
    assert.equal(typeof open.text, 'string');
    assert.equal(typeof open.digits, 'number');
    assert.ok(!('answer' in open));
  } finally {
    engine.stop(room);
  }
});

test('duel: wrong answers cost nothing and are never locked out', () => {
  const { room, net } = makeDuelRoom(['Ada', 'Tunde']);
  try {
    startNow(room, net);
    for (let i = 0; i < 12; i++) {
      const res = duelAnswer(room, net, 'p1', false);
      assert.equal(res.ok, true);
      assert.equal(res.correct, false);
    }
    assert.equal(room.game.players.get('p1').wrongs, 12);
    assert.equal(duelAnswer(room, net, 'p1').correct, true);
  } finally {
    engine.stop(room);
  }
});

test('duel: there is no skip', () => {
  const { room, net } = makeDuelRoom(['Ada', 'Tunde']);
  try {
    startNow(room, net);
    room.game.players.get('p1').lastActionAt = 0;
    assert.equal(engine.submitSkip(room, net, 'p1').ok, false);
  } finally {
    engine.stop(room);
  }
});

test('duel: first to the target wins the game', async () => {
  const restore = fastDuel();
  const { room, net, events } = makeDuelRoom(['Ada', 'Tunde'], 3);
  try {
    startNow(room, net);
    for (let round = 1; round <= 3; round++) {
      assert.ok(await untilQuestion(room), 'a question should appear');
      assert.equal(room.game.round, round);
      assert.equal(duelAnswer(room, net, 'p1').correct, true);
    }
    for (let i = 0; i < 200 && room.status !== 'finished'; i++) await wait(5);

    const results = events.find((e) => e.e === 'game:results').payload;
    assert.equal(results.mode, 'duel');
    assert.equal(results.players[0].id, 'p1');
    assert.equal(results.players[0].score, 3);
    assert.equal(results.players[1].score, 0);
    assert.equal(results.forfeit, false);
    assert.equal(results.reason, 'target');
  } finally {
    engine.stop(room);
    restore();
  }
});

test('duel: when one of two players quits, the other wins at once', () => {
  const { room, net, events } = makeDuelRoom(['Ada', 'Tunde']);
  try {
    startNow(room, net);
    engine.playerLeft(room, net, 'p1');

    const results = events.find((e) => e.e === 'game:results').payload;
    assert.equal(results.forfeit, true);
    assert.equal(results.players[0].id, 'p2');
    assert.equal(results.players[0].forfeitWin, true);
    assert.equal(results.players[1].id, 'p1');
    assert.equal(results.players[1].left, true);
    assert.equal(room.status, 'finished');
  } finally {
    engine.stop(room);
  }
});

test('duel: with three players the game carries on after one quits', () => {
  const { room, net, events } = makeDuelRoom(['Ada', 'Tunde', 'Chi']);
  try {
    startNow(room, net);
    engine.playerLeft(room, net, 'p3');
    assert.equal(room.status, 'playing');
    assert.equal(events.some((e) => e.e === 'game:results'), false);

    engine.playerLeft(room, net, 'p2');
    const results = events.find((e) => e.e === 'game:results').payload;
    assert.equal(results.forfeit, true);
    assert.equal(results.players[0].id, 'p1');
  } finally {
    engine.stop(room);
  }
});

test('duel: three rounds in a row with no answer end the game', async () => {
  const restore = fastDuel({ roundTimeoutMs: 20 });
  const { room, net, events } = makeDuelRoom(['Ada', 'Tunde'], 5);
  try {
    startNow(room, net);
    for (let i = 0; i < 300 && room.status !== 'finished'; i++) await wait(10);
    assert.equal(room.status, 'finished');

    const results = events.find((e) => e.e === 'game:results').payload;
    assert.equal(results.reason, 'idle');
    assert.equal(results.players[0].score, 0);

    const timeouts = events.filter((e) => e.e === 'duel:state' && e.payload.phase === 'point' && e.payload.point.timeout);
    assert.equal(timeouts.length, 3);
  } finally {
    engine.stop(room);
    restore();
  }
});