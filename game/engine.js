// game/engine.js
// The referee. It owns the rules: countdown, checking answers, timing, penalties,
// skip, auto-skip, the streak bonus, Time Attack, Duel and working out the winner.
//
// It never talks to browsers directly. server.js hands it a small "net" helper:
//   net.toPlayer(playerId, eventName, data)  -> message one player
//   net.toRoom(roomCode, eventName, data)    -> message everyone in the room

const { generateQuestions, generateStream } = require('./questions');

// ----- The game rules. Change a number here to change the game. -----
const COUNTDOWN_LEAD_MS = 4000;     // time between pressing Start and GO
const SKIP_PENALTY_MS = 15000;      // +15 seconds for a skip or an auto-skip (Classic Race)
const QUESTION_TIMEOUT_MS = 45000;  // stuck on one question this long = auto-skip (Classic Race)
const GRACE_MS = 60000;             // after the first finisher, others get this long (Classic Race)
const STREAK_NEEDED = 3;            // right first time this many in a row...
const STREAK_BONUS_MS = 500;        // ...and each such answer after that takes off 0.5s
const MIN_ACTION_GAP_MS = 150;      // ignore answers sent faster than this (anti-spam)
const WRONG_RUN_LIMIT = 5;          // this many wrong answers in a row on one question...
const WRONG_COOLDOWN_MS = 3000;     // ...locks the answer box for this long (not used in Duel)
const TA_DURATION_MS = 60000;       // Time Attack lasts this long
const TA_POOL_SIZE = 120;           // how many questions Time Attack prepares up front
const DUEL_POOL_SIZE = 120;         // how many questions a Duel prepares up front
const DUEL_MAX_EMPTY_ROUNDS = 3;    // this many rounds in a row with no answer end an idle Duel

// Duel timing. It is exported so the tests can make it much faster.
const duelTiming = {
  countMs: 2100,          // the quick 3-2-1 before each question
  pauseMs: 1500,          // the "who scored" moment after each round
  roundTimeoutMs: 20000,  // nobody got it: the round ends with no point
};

const isTimeAttack = (game) => game.mode === 'timeattack';
const isDuel = (game) => game.mode === 'duel';

// What a player is allowed to see about a question: NO answer in here.
function questionPayload(game, player, reason) {
  const q = game.questions[player.index];
  return {
    index: player.index,
    total: game.questions.length,
    text: q.text,
    // How many digits the answer has, so the browser knows when to check.
    digits: String(q.answer).length,
    mode: game.mode,
    timeoutMs: QUESTION_TIMEOUT_MS,
    skipPenaltyMs: isTimeAttack(game) ? 0 : SKIP_PENALTY_MS,
    penaltyMs: player.penaltyMs,   // so a returning player's timer is right
    startAt: game.startAt,         // the GO moment, on the server's clock
    endAt: game.endAt,             // Time Attack: when the 60 seconds are up (server clock)
    score: player.score,
    skipsLeft: isTimeAttack(game) ? (player.skipUsed ? 0 : 1) : null,
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
    mode: game.mode,
    players: [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      done: p.index, // how many questions this player has got past
      score: p.score,
      finished: p.finishedAt !== null,
      left: p.left,
      away: p.away,  // connection dropped, but they may still come back
    })),
  });
}

// ---------- Starting a game ----------

function startGame(room, net) {
  const startAt = Date.now() + COUNTDOWN_LEAD_MS;
  const mode = room.mode === 'timeattack' ? 'timeattack' : room.mode === 'duel' ? 'duel' : 'race';
  const timeAttack = mode === 'timeattack';
  const duel = mode === 'duel';
  const { difficulty, questionCount } = room.settings;

  const game = {
    mode,
    questions: timeAttack
      ? generateStream(difficulty, TA_POOL_SIZE)
      : duel
        ? generateStream(difficulty, DUEL_POOL_SIZE)
        : generateQuestions(difficulty, questionCount),
    startAt,
    endAt: timeAttack ? startAt + TA_DURATION_MS : null,
    startTimer: null,
    graceTimer: null,
    endTimer: null,
    roundTimer: null,   // Duel: the "nobody got it" timer
    nextTimer: null,    // Duel: the pauses between rounds
    over: false,
    resultsPayload: null,
    players: new Map(),
    // ----- Duel only -----
    phase: duel ? 'countdown' : null, // 'countdown', 'question' or 'point'
    round: 0,                         // which round we are in (1, 2, 3...)
    target: duel ? (room.settings.pointsToWin || 5) : 0,
    emptyRounds: 0,                   // rounds in a row that nobody answered
    roundStartAt: 0,
    questionOpenedAt: 0,
    questionEndAt: 0,
    lastPoint: null,
  };

  for (const p of room.players) {
    game.players.set(p.id, {
      id: p.id,
      name: p.name,
      color: p.color,
      index: 0,              // which question they are on
      score: 0,              // Time Attack and Duel: points so far
      skipUsed: false,       // Time Attack: the one free skip
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
      timer: null,           // the auto-skip timer (Classic Race only)
      times: [],             // how long each question took
    });
  }

  room.game = game;
  room.status = 'countdown';

  // Every player gets the same GO time (on the server's clock).
  net.toRoom(room.code, 'game:countdown', { startAt, serverNow: Date.now(), mode: game.mode });
  game.startTimer = setTimeout(() => beginRace(room, net), startAt - Date.now());
}

// GO! Send everyone question 1.
function beginRace(room, net) {
  const game = room.game;
  if (!game || game.over) return;
  clearTimeout(game.startTimer);
  room.status = 'playing';

  // Duel: round 1 opens straight away (the big 3-2-1 has just been shown).
  if (isDuel(game)) {
    openQuestion(room, net, 1);
    return;
  }

  // Time Attack: the server ends the game when the 60 seconds are up.
  if (isTimeAttack(game)) {
    game.endTimer = setTimeout(() => endGame(room, net), Math.max(0, game.endAt - Date.now()));
  }

  for (const p of game.players.values()) {
    if (p.left) continue;
    p.questionStartedAt = game.startAt;
    if (!isTimeAttack(game)) armTimer(room, net, p);
    net.toPlayer(p.id, 'game:question', questionPayload(game, p));
  }
  sendProgress(room, net);
}

// ---------- Duel: one shared question at a time ----------

function scoreboard(game) {
  return [...game.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    score: p.score,
    left: p.left,
    away: p.away,
  }));
}

// Everything a browser needs to draw the Duel right now. It is also sent to
// a player who reconnects, so they can carry on where they were.
function duelState(game) {
  const state = {
    mode: 'duel',
    phase: game.phase,
    round: game.round,
    target: game.target,
    scores: scoreboard(game),
  };
  if (game.phase === 'countdown') {
    state.startAt = game.roundStartAt;   // when the question appears (server clock)
    state.countMs = duelTiming.countMs;
  } else if (game.phase === 'question') {
    const q = game.questions[game.round - 1];
    state.text = q.text;                 // the question, but never the answer
    state.digits = String(q.answer).length;
    state.startAt = game.questionOpenedAt;
    state.endAt = game.questionEndAt;
  } else if (game.phase === 'point') {
    state.point = game.lastPoint;        // who scored (the answer is shown once the round is over)
  }
  return state;
}

function broadcastDuel(room, net) {
  if (room.game) net.toRoom(room.code, 'duel:state', duelState(room.game));
}

// The question appears for everybody at the same moment.
function openQuestion(room, net, round) {
  const game = room.game;
  if (!game || game.over) return;
  const now = Date.now();
  game.round = round;
  game.phase = 'question';
  game.questionOpenedAt = now;
  game.questionEndAt = now + duelTiming.roundTimeoutMs;

  clearTimeout(game.roundTimer);
  game.roundTimer = setTimeout(() => endRound(room, net, null), duelTiming.roundTimeoutMs);
  broadcastDuel(room, net);
}

// The quick 3-2-1 before the next question.
function startNextRound(room, net) {
  const game = room.game;
  if (!game || game.over) return;
  game.round += 1;
  game.phase = 'countdown';
  game.roundStartAt = Date.now() + duelTiming.countMs;
  broadcastDuel(room, net);

  const round = game.round;
  clearTimeout(game.nextTimer);
  game.nextTimer = setTimeout(() => openQuestion(room, net, round), duelTiming.countMs);
}

// A round is over: someone got it (winner), or nobody did (winner is null).
function endRound(room, net, winner) {
  const game = room.game;
  if (!game || game.over || game.phase !== 'question') return;
  clearTimeout(game.roundTimer);

  const q = game.questions[game.round - 1];
  game.phase = 'point';
  if (winner) {
    winner.score += 1;
    game.emptyRounds = 0;
  } else {
    game.emptyRounds += 1;
  }
  game.lastPoint = {
    round: game.round,
    winnerId: winner ? winner.id : null,
    winnerName: winner ? winner.name : null,
    answer: q.answer,
    timeout: !winner,
  };
  broadcastDuel(room, net);

  // Is the game over? Otherwise the next round follows the pause.
  let reason = null;
  if (winner && winner.score >= game.target) reason = 'target';
  else if (game.emptyRounds >= DUEL_MAX_EMPTY_ROUNDS) reason = 'idle';
  else if (game.round >= game.questions.length) reason = 'pool';

  clearTimeout(game.nextTimer);
  game.nextTimer = setTimeout(() => {
    if (reason) endGame(room, net, reason);
    else startNextRound(room, net);
  }, duelTiming.pauseMs);
}

// A Duel answer. The first correct one takes the point. Wrong answers cost nothing.
function duelAnswer(room, net, playerId, raw) {
  const game = room.game;
  const p = getActivePlayer(room, playerId);
  if (!p) return { ok: false, error: 'You cannot answer right now.' };
  // The round already ended (someone was faster): this answer is simply too late.
  if (game.phase !== 'question') return { ok: false, late: true, error: '' };

  const now = Date.now();
  if (now - p.lastActionAt < MIN_ACTION_GAP_MS) {
    return { ok: false, error: 'Slow down a little.' };
  }
  p.lastActionAt = now;

  // Never trust the browser: the answer must be plain digits.
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,9}$/.test(text)) return { ok: false, error: 'Type a number.' };

  const question = game.questions[game.round - 1];
  if (Number(text) !== question.answer) {
    p.wrongs++;
    return { ok: true, correct: false };
  }

  p.times.push({ ms: now - game.questionOpenedAt, skipped: false });
  endRound(room, net, p); // this switches the phase at once, so later answers are "too late"
  return { ok: true, correct: true, won: true };
}

// ---------- Auto-skip timer (Classic Race only) ----------

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
  if (!isTimeAttack(game)) armTimer(room, net, p);
  sendProgress(room, net);
  return { finished: false, question: questionPayload(game, p, reason) };
}

// A skip in Classic Race: costs 15 seconds.
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
  if (room.game && isDuel(room.game)) return duelAnswer(room, net, playerId, raw);

  const p = getActivePlayer(room, playerId);
  if (!p) return { ok: false, error: 'You cannot answer right now.' };

  const game = room.game;
  const now = Date.now();
  if (isTimeAttack(game) && now >= game.endAt) return { ok: false, error: 'Time is up.' };
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
  if (isTimeAttack(game)) {
    p.score++; // every correct answer is a point
  } else if (!p.wrongOnCurrent) {
    p.streak++; // right first time keeps the streak going
    if (p.streak >= STREAK_NEEDED) p.bonusMs += STREAK_BONUS_MS;
  }
  const out = moveOn(room, net, p, now);
  return { ok: true, correct: true, score: p.score, ...out };
}

function submitSkip(room, net, playerId) {
  if (room.game && isDuel(room.game)) {
    return { ok: false, error: 'There is no skip in a duel.' };
  }

  const p = getActivePlayer(room, playerId);
  if (!p) return { ok: false, error: 'You cannot skip right now.' };

  const game = room.game;
  const now = Date.now();
  if (isTimeAttack(game) && now >= game.endAt) return { ok: false, error: 'Time is up.' };
  if (now - p.lastActionAt < MIN_ACTION_GAP_MS) {
    return { ok: false, error: 'Slow down a little.' };
  }
  p.lastActionAt = now;

  // Time Attack: ONE free skip for the whole run.
  if (isTimeAttack(game)) {
    if (p.skipUsed) return { ok: false, error: 'You already used your skip.' };
    p.skipUsed = true;
    p.skips++;
    p.streak = 0;
    p.times.push({ ms: now - p.questionStartedAt, skipped: true });
    const out = moveOn(room, net, p, now, 'skip');
    return { ok: true, skipped: true, penaltyMs: 0, ...out };
  }

  const out = takeSkip(room, net, p, 'skip');
  return { ok: true, skipped: true, penaltyMs: SKIP_PENALTY_MS, ...out };
}

// ---------- Finishing ----------

function finishPlayer(room, net, p, now) {
  const game = room.game;
  clearTimeout(p.timer);
  p.finishedAt = now;

  // Classic Race: the first finisher starts a countdown for everyone still playing.
  if (!isTimeAttack(game) && !game.graceTimer) {
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

function clearGameTimers(game) {
  clearTimeout(game.startTimer);
  clearTimeout(game.graceTimer);
  clearTimeout(game.endTimer);
  clearTimeout(game.roundTimer);
  clearTimeout(game.nextTimer);
  for (const p of game.players.values()) clearTimeout(p.timer);
}

function endGame(room, net, reason) {
  const game = room.game;
  if (!game || game.over) return;
  game.over = true;
  clearGameTimers(game);
  room.status = 'finished';

  // ----- Time Attack: the score is the number of correct answers -----
  if (isTimeAttack(game)) {
    const results = [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      finished: true,
      left: p.left,
      score: p.score,
      completed: p.times.length,
      totalMs: null,
      wrongs: p.wrongs,
      skips: p.skips,
      bonusMs: 0,
      times: p.times,
    }));
    results.sort((a, b) => (b.score - a.score) || (a.wrongs - b.wrongs));
    results.forEach((r, i) => { r.rank = i + 1; });

    game.resultsPayload = {
      mode: 'timeattack',
      players: results,
      total: 0,
      durationMs: TA_DURATION_MS,
      gameId: game.startAt,
    };
    net.toRoom(room.code, 'game:results', game.resultsPayload);
    return;
  }

  // ----- Duel: the most points wins -----
  if (isDuel(game)) {
    const forfeit = reason === 'forfeit'; // everyone else quit, so the last player wins
    const results = [...game.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      finished: !p.left,
      left: p.left,
      forfeitWin: false,
      score: p.score,
      completed: p.score,
      totalMs: null,
      wrongs: p.wrongs,
      skips: 0,
      bonusMs: 0,
      times: p.times,
    }));
    // Players still in come first, then the most points, then the fewest wrong answers.
    results.sort((a, b) => {
      if (a.left !== b.left) return a.left ? 1 : -1;
      return (b.score - a.score) || (a.wrongs - b.wrongs);
    });
    results.forEach((r, i) => { r.rank = i + 1; });
    if (forfeit && results.length > 0) results[0].forfeitWin = true;

    game.resultsPayload = {
      mode: 'duel',
      players: results,
      total: 0,
      target: game.target,
      rounds: game.round,
      reason: reason || 'target',
      forfeit,
      gameId: game.startAt,
    };
    net.toRoom(room.code, 'game:results', game.resultsPayload);
    return;
  }

  // ----- Classic Race: the lowest total time wins -----
  const forfeit = reason === 'forfeit'; // everyone else quit, so the last player wins
  const results = [...game.players.values()].map((p) => {
    const finished = p.finishedAt !== null;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      finished,
      left: p.left,
      forfeitWin: forfeit && !p.left && !finished,
      completed: p.times.length, // questions answered or skipped
      totalMs: finished ? totalMs(game, p) : null,
      wrongs: p.wrongs,
      skips: p.skips,
      bonusMs: p.bonusMs,
      times: p.times,
    };
  });

  // Group 0: finished (fastest first). Group 1: still in, but not finished.
  // Group 2: quit before finishing, so they always rank last.
  const group = (r) => (r.finished ? 0 : r.left ? 2 : 1);
  results.sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) return (a.totalMs - b.totalMs) || (a.wrongs - b.wrongs);
    return (b.completed - a.completed) || (a.wrongs - b.wrongs);
  });
  results.forEach((r, i) => { r.rank = i + 1; });

  // Saved so a player who reconnects after the end can still see the results.
  game.resultsPayload = {
    mode: 'race',
    players: results,
    total: game.questions.length,
    gameId: game.startAt,
    forfeit,
  };
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
  if (isDuel(game)) broadcastDuel(room, net);
  else sendProgress(room, net);
}

// A player came back: send them whatever they need to carry on where they were.
function resync(room, net, playerId) {
  const game = room.game;
  if (!game) return;

  if (room.status === 'countdown') {
    net.toPlayer(playerId, 'game:countdown', { startAt: game.startAt, serverNow: Date.now(), mode: game.mode });
  } else if (room.status === 'playing') {
    if (isDuel(game)) {
      net.toPlayer(playerId, 'duel:state', duelState(game));
      return;
    }
    const p = game.players.get(playerId);
    if (!p || p.left) return;
    if (p.finishedAt !== null) net.toPlayer(playerId, 'game:finished', {});
    else net.toPlayer(playerId, 'game:question', questionPayload(game, p));
  } else if (room.status === 'finished' && game.resultsPayload) {
    net.toPlayer(playerId, 'game:results', game.resultsPayload);
  }
}

// A player left for good (they quit, or their time to reconnect ran out).
function playerLeft(room, net, playerId) {
  const game = room.game;
  if (!game || game.over) return;
  const p = game.players.get(playerId);
  if (!p || p.left) return;
  p.left = true;
  clearTimeout(p.timer);

  // Duel: when only one player is left, that player wins straight away.
  if (isDuel(game)) {
    const stillIn = [...game.players.values()].filter((q) => !q.left);
    if (stillIn.length <= 1) {
      endGame(room, net, stillIn.length === 1 ? 'forfeit' : 'empty');
      return;
    }
    broadcastDuel(room, net);
    return;
  }

  sendProgress(room, net);

  // Classic Race with friends: if only one player is left, and nobody has finished,
  // that player wins straight away.
  if (!isTimeAttack(game) && game.players.size >= 2) {
    const all = [...game.players.values()];
    const stillIn = all.filter((q) => !q.left);
    const anyFinished = all.some((q) => q.finishedAt !== null);
    if (stillIn.length === 1 && !anyFinished) {
      endGame(room, net, 'forfeit');
      return;
    }
  }
  endIfEveryoneDone(room, net);
}

// Cancel every timer for this room (used when the room is deleted).
function stop(room) {
  const game = room.game;
  if (!game) return;
  game.over = true;
  clearGameTimers(game);
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
  duelTiming,
};