// game/engine.js
// The referee. It owns the rules: countdown, checking answers, timing, penalties,
// skip, auto-skip, the streak bonus and working out the winner.
//
// It never talks to browsers directly. server.js hands it a small "net" helper:
//   net.toPlayer(playerId, eventName, data)  -> message one player
//   net.toRoom(roomCode, eventName, data)    -> message everyone in the room

const { generateQuestions } = require('./questions');

// ----- The game rules. Change a number here to change the game. -----
const COUNTDOWN_LEAD_MS = 4000;     // time between pressing Start and GO
const SKIP_PENALTY_MS = 15000;      // +15 seconds for a skip or an auto-skip
const QUESTION_TIMEOUT_MS = 45000;  // stuck on one question this long = auto-skip
const GRACE_MS = 60000;             // after the first finisher, others get this long
const STREAK_NEEDED = 3;            // right first time this many in a row...
const STREAK_BONUS_MS = 500;        // ...and each such answer after that takes off 0.5s
const MIN_ACTION_GAP_MS = 150;      // ignore answers sent faster than this (anti-spam)
const WRONG_RUN_LIMIT = 5;          // this many wrong answers in a row on one question...
const WRONG_COOLDOWN_MS = 3000;     // ...locks the answer box for this long

// What a player is allowed to see about a question: NO answer in here.
function questionPayload(game, player, reason) {
  const q = game.questions[player.index];
  return {
    index: player.index,
    total: game.questions.length,
    text: q.text,
    // How many digits the answer has, so the browser knows when to check.
    digits: String(q.answer).length,
    timeoutMs: QUESTION_TIMEOUT_MS,
    skipPenaltyMs: SKIP_PENALTY_MS,
    penaltyMs: player.penaltyMs,   // so a returning player's timer is right
    startAt: game.startAt,         // the GO moment, on the server's clock
    elapsedMs: Math.max(0, Date.now() - player.questionStartedAt),
    reason: reason || null,
  };
}

// A finished player's final time: real time + penalties - streak bonus.
function totalMs(game, p) {
  return (p.finishedAt - game.startAt) + p.penaltyMs - p.bonusMs;
}

function sendProgress(room, net) {
  const game = room.game;
  if (!game) return;
  net.toRoom(room.code, 'game:progress', {
    total: game.questions.length,
    players: [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      done: p.index, // how many questions this player has got past
      finished: p.finishedAt !== null,
      left: p.left,
      away: p.away,  // connection dropped, but they may still come back
    })),
  });
}

// ---------- Starting a game ----------

function startGame(room, net) {
  const startAt = Date.now() + COUNTDOWN_LEAD_MS;
  const game = {
    questions: generateQuestions(room.settings.difficulty, room.settings.questionCount),
    startAt,
    startTimer: null,
    graceTimer: null,
    over: false,
    resultsPayload: null,
    players: new Map(),
  };

  for (const p of room.players) {
    game.players.set(p.id, {
      id: p.id,
      name: p.name,
      color: p.color,
      index: 0,              // which question they are on
      penaltyMs: 0,
      bonusMs: 0,
      wrongs: 0,
      skips: 0,
      streak: 0,
      wrongRun: 0,           // wrong answers in a row on the current question
      lockedUntil: 0,        // answers are refused until this time (the cooldown)
      wrongOnCurrent: false, // did they already get this question wrong?
      questionStartedAt: startAt,
      lastActionAt: 0,
      finishedAt: null,
      left: false,
      away: !p.connected,
      timer: null,           // the auto-skip timer
      times: [],             // how long each question took
    });
  }

  room.game = game;
  room.status = 'countdown';

  // Every player gets the same GO time (on the server's clock).
  net.toRoom(room.code, 'game:countdown', { startAt, serverNow: Date.now() });
  game.startTimer = setTimeout(() => beginRace(room, net), startAt - Date.now());
}

// GO! Send everyone question 1.
function beginRace(room, net) {
  const game = room.game;
  if (!game || game.over) return;
  clearTimeout(game.startTimer);
  room.status = 'playing';

  for (const p of game.players.values()) {
    if (p.left) continue;
    p.questionStartedAt = game.startAt;
    armTimer(room, net, p);
    net.toPlayer(p.id, 'game:question', questionPayload(game, p));
  }
  sendProgress(room, net);
}

// ---------- Auto-skip timer ----------

function armTimer(room, net, p) {
  clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    const game = room.game;
    if (!game || game.over || p.left || p.finishedAt !== null) return;
    const out = takeSkip(room, net, p, 'timeout');
    if (out.finished) net.toPlayer(p.id, 'game:finished', {});
    else net.toPlayer(p.id, 'game:question', out.question);
  }, QUESTION_TIMEOUT_MS);
}

// ---------- Moving through the questions ----------

// Called after a correct answer or a skip.
function moveOn(room, net, p, now, reason) {
  const game = room.game;
  p.index++;
  p.wrongOnCurrent = false;
  p.wrongRun = 0;
  p.lockedUntil = 0;

  if (p.index >= game.questions.length) {
    finishPlayer(room, net, p, now);
    sendProgress(room, net);
    return { finished: true };
  }

  p.questionStartedAt = now;
  armTimer(room, net, p);
  sendProgress(room, net);
  return { finished: false, question: questionPayload(game, p, reason) };
}

function takeSkip(room, net, p, reason) {
  const now = Date.now();
  p.skips++;
  p.streak = 0;
  p.penaltyMs += SKIP_PENALTY_MS;
  p.times.push({ ms: now - p.questionStartedAt, skipped: true });
  return moveOn(room, net, p, now, reason);
}

// Returns the player if they are allowed to act right now, otherwise null.
function getActivePlayer(room, playerId) {
  const game = room.game;
  if (!game || game.over || room.status !== 'playing') return null;
  const p = game.players.get(playerId);
  if (!p || p.left || p.finishedAt !== null) return null;
  return p;
}

// ---------- What players can do ----------

function submitAnswer(room, net, playerId, raw) {
  const p = getActivePlayer(room, playerId);
  if (!p) return { ok: false, error: 'You cannot answer right now.' };

  const now = Date.now();
  if (now < p.lockedUntil) {
    return { ok: false, error: 'Too many wrong tries. Wait a moment.', cooldownMs: p.lockedUntil - now };
  }
  if (now - p.lastActionAt < MIN_ACTION_GAP_MS) {
    return { ok: false, error: 'Slow down a little.' };
  }
  p.lastActionAt = now;

  // Never trust the browser: the answer must be plain digits.
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,9}$/.test(text)) return { ok: false, error: 'Type a number.' };

  const game = room.game;
  const question = game.questions[p.index];

  if (Number(text) !== question.answer) {
    p.wrongs++;
    p.streak = 0;
    p.wrongOnCurrent = true;
    p.wrongRun++;
    if (p.wrongRun >= WRONG_RUN_LIMIT) {
      p.wrongRun = 0;
      p.lockedUntil = now + WRONG_COOLDOWN_MS;
      return { ok: true, correct: false, cooldownMs: WRONG_COOLDOWN_MS };
    }
    return { ok: true, correct: false };
  }

  p.times.push({ ms: now - p.questionStartedAt, skipped: false });
  if (!p.wrongOnCurrent) {
    p.streak++; // right first time keeps the streak going
    if (p.streak >= STREAK_NEEDED) p.bonusMs += STREAK_BONUS_MS;
  }
  const out = moveOn(room, net, p, now);
  return { ok: true, correct: true, ...out };
}

function submitSkip(room, net, playerId) {
  const p = getActivePlayer(room, playerId);
  if (!p) return { ok: false, error: 'You cannot skip right now.' };

  const now = Date.now();
  if (now - p.lastActionAt < MIN_ACTION_GAP_MS) {
    return { ok: false, error: 'Slow down a little.' };
  }
  p.lastActionAt = now;

  const out = takeSkip(room, net, p, 'skip');
  return { ok: true, skipped: true, penaltyMs: SKIP_PENALTY_MS, ...out };
}

// ---------- Finishing ----------

function finishPlayer(room, net, p, now) {
  const game = room.game;
  clearTimeout(p.timer);
  p.finishedAt = now;

  // The first finisher starts a countdown for everyone still playing.
  if (!game.graceTimer) {
    game.graceTimer = setTimeout(() => endGame(room, net), GRACE_MS);
  }
  endIfEveryoneDone(room, net);
}

function endIfEveryoneDone(room, net) {
  const game = room.game;
  if (!game || game.over) return;
  const done = [...game.players.values()].every((p) => p.left || p.finishedAt !== null);
  if (done) endGame(room, net);
}

function endGame(room, net) {
  const game = room.game;
  if (!game || game.over) return;
  game.over = true;
  clearTimeout(game.startTimer);
  clearTimeout(game.graceTimer);
  for (const p of game.players.values()) clearTimeout(p.timer);
  room.status = 'finished';

  const results = [...game.players.values()].map((p) => {
    const finished = p.finishedAt !== null;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      finished,
      left: p.left,
      completed: p.times.length, // questions answered or skipped
      totalMs: finished ? totalMs(game, p) : null,
      wrongs: p.wrongs,
      skips: p.skips,
      bonusMs: p.bonusMs,
      times: p.times,
    };
  });

  // Finished players first (fastest time wins, fewer wrongs breaks a tie).
  // Anyone who did not finish is ranked by how far they got.
  results.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return (a.totalMs - b.totalMs) || (a.wrongs - b.wrongs);
    return (b.completed - a.completed) || (a.wrongs - b.wrongs);
  });
  results.forEach((r, i) => { r.rank = i + 1; });

  // Saved so a player who reconnects after the end can still see the results.
  game.resultsPayload = { players: results, total: game.questions.length };
  net.toRoom(room.code, 'game:results', game.resultsPayload);
}

// ---------- Connections, leaving, cleanup, rematch ----------

// A player's connection dropped (away = true) or came back (away = false).
function setAway(room, net, playerId, away) {
  const game = room.game;
  if (!game || game.over) return;
  const p = game.players.get(playerId);
  if (!p) return;
  p.away = away;
  sendProgress(room, net);
}

// A player came back: send them whatever they need to carry on where they were.
function resync(room, net, playerId) {
  const game = room.game;
  if (!game) return;

  if (room.status === 'countdown') {
    net.toPlayer(playerId, 'game:countdown', { startAt: game.startAt, serverNow: Date.now() });
  } else if (room.status === 'playing') {
    const p = game.players.get(playerId);
    if (!p || p.left) return;
    if (p.finishedAt !== null) net.toPlayer(playerId, 'game:finished', {});
    else net.toPlayer(playerId, 'game:question', questionPayload(game, p));
  } else if (room.status === 'finished' && game.resultsPayload) {
    net.toPlayer(playerId, 'game:results', game.resultsPayload);
  }
}

// A player left for good (or their time to reconnect ran out).
function playerLeft(room, net, playerId) {
  const game = room.game;
  if (!game || game.over) return;
  const p = game.players.get(playerId);
  if (!p) return;
  p.left = true;
  clearTimeout(p.timer);
  sendProgress(room, net);
  endIfEveryoneDone(room, net);
}

// Cancel every timer for this room (used when the room is deleted).
function stop(room) {
  const game = room.game;
  if (!game) return;
  game.over = true;
  clearTimeout(game.startTimer);
  clearTimeout(game.graceTimer);
  for (const p of game.players.values()) clearTimeout(p.timer);
}

// Host presses Rematch: back to the lobby, same room, same people.
function rematch(room) {
  if (room.status !== 'finished') return false;
  stop(room);
  room.game = null;
  room.status = 'lobby';
  return true;
}

module.exports = {
  startGame, beginRace, submitAnswer, submitSkip,
  setAway, resync, playerLeft, stop, rematch,
};