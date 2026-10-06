// public/js/app.js
// This code runs in the player's browser.

const socket = io();
const $ = (id) => document.getElementById(id);

// ----- Screens: only one is visible at a time -----
const SCREENS = ['home', 'lobby', 'countdown', 'game', 'results'];
function showScreen(name) {
  SCREENS.forEach((s) => { $(s).hidden = s !== name; });
}

// ----- Page elements -----
const nameInput = $('nameInput');
const codeInput = $('codeInput');
const createBtn = $('createBtn');
const joinBtn = $('joinBtn');
const errorEl = $('error');

const leaveBtn = $('leaveBtn');
const roomCodeEl = $('roomCode');
const copyBtn = $('copyBtn');
const copyLinkBtn = $('copyLinkBtn');
const playerCount = $('playerCount');
const playerListEl = $('playerList');
const difficultyTiles = $('difficultyTiles');
const countTiles = $('countTiles');
const startBtn = $('startBtn');
const lobbyHint = $('lobbyHint');

const countNumber = $('countNumber');
const countInfo = $('countInfo');

const progressFill = $('progressFill');
const timerEl = $('timer');
const penPop = $('penPop');
const raceList = $('raceList');
const qProgress = $('qProgress');
const questionText = $('questionText');
const answerInput = $('answerInput');
const feedback = $('feedback');
const hintLine = $('hintLine');
const skipBtn = $('skipBtn');
const skipPen = $('skipPen');
const finishedMsg = $('finishedMsg');

const resultTitle = $('resultTitle');
const resultSub = $('resultSub');
const podium = $('podium');
const resultList = $('resultList');
const chartCard = $('chartCard');
const timeBars = $('timeBars');
const chartNote = $('chartNote');
const rematchBtn = $('rematchBtn');
const rematchHint = $('rematchHint');
const homeBtn = $('homeBtn');

// ----- State -----
let currentRoom = null;     // the room we are in, or null on the home screen
let clockOffset = 0;        // (server clock) minus (this device's clock), in ms
let countdownTimer = null;
let gameTicker = null;      // updates the timer and hints while playing
let busy = false;           // true while we wait for the server to answer our last move
let finished = false;       // true once we have answered every question
let expectedDigits = 0;     // how many digits the current answer has
let goAtLocal = 0;          // the moment GO happens, on THIS device's clock
let penaltyMs = 0;          // skip penalties so far (display only, the server keeps the real total)
let questionShownAt = 0;
let currentIndex = 0;
let tipQuestion = -1;       // which question showed the skip tip (it shows once per game)
let timeoutMs = 45000;
let skipPenaltyMs = 15000;
let laneEls = new Map();    // player id -> pieces of that player's race lane

// ============================================================
// Small helpers
// ============================================================
function showError(message) { errorEl.textContent = message || ''; }

function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

// 62400 milliseconds -> "1:02.4"
function formatTime(ms) {
  const tenths = Math.round(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

// 1 -> "1st", 2 -> "2nd", 11 -> "11th"
function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

// "Ada Obi" -> "AO", "Tunde" -> "TU"
function initials(name) {
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

// Dark text on light colours (like yellow), white text on dark ones.
function readableText(hex) {
  const n = parseInt(hex.slice(1), 16);
  const brightness = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return brightness > 0.7 ? '#4b4b4b' : '#ffffff';
}

function makeAvatar(player, big) {
  const el = document.createElement('span');
  el.className = 'avatar' + (big ? ' lg' : '');
  el.style.background = player.color;
  el.style.color = readableText(player.color);
  el.textContent = initials(player.name);
  return el;
}

// Remember the nickname on this device. Wrapped in try/catch because some
// browsers (private mode) block storage.
function saveName(name) { try { localStorage.setItem('playoff-name', name); } catch {} }
function loadName() { try { return localStorage.getItem('playoff-name') || ''; } catch { return ''; } }

// Old-style copy, used when the modern clipboard is blocked (it is on plain http pages).
function legacyCopy(text) {
  const box = document.createElement('textarea');
  box.value = text;
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.append(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  box.remove();
  return ok;
}

async function copyText(text, button, doneLabel) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = legacyCopy(text);
  }
  button.textContent = ok ? doneLabel : 'Copy failed';
  setTimeout(() => { button.textContent = original; }, 1200);
}

// ============================================================
// Clock sync: work out how far this device's clock is from the server's,
// so the countdown ends at the same real moment for everyone.
// ============================================================
function syncClock() {
  let best = null;
  let remaining = 5;
  const once = () => {
    const sentAt = Date.now();
    socket.emit('time:ping', (serverTime) => {
      const gotAt = Date.now();
      const roundTrip = gotAt - sentAt;
      // Keep the sample with the shortest round trip: it is the most accurate.
      if (!best || roundTrip < best.roundTrip) {
        best = { roundTrip, offset: serverTime - (sentAt + gotAt) / 2 };
        clockOffset = best.offset;
      }
      if (--remaining > 0) setTimeout(once, 100);
    });
  };
  once();
}
socket.on('connect', syncClock);

// ============================================================
// Home
// ============================================================
function join() {
  const name = nameInput.value;
  socket.emit('room:join', { name, code: codeInput.value }, (res) => {
    if (!res.ok) return showError(res.error);
    saveName(name);
    enterRoom(res.room);
  });
}

createBtn.addEventListener('click', () => {
  const name = nameInput.value;
  socket.emit('room:create', { name }, (res) => {
    if (!res.ok) return showError(res.error);
    saveName(name);
    enterRoom(res.room);
  });
});

joinBtn.addEventListener('click', join);
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });

// ============================================================
// Lobby
// ============================================================
function setTiles(container, value, enabled) {
  container.querySelectorAll('.tile').forEach((tile) => {
    tile.classList.toggle('on', tile.dataset.value === String(value));
    tile.disabled = !enabled;
  });
}

function renderRoom(room) {
  currentRoom = room;
  roomCodeEl.textContent = room.code;
  playerCount.textContent = `· ${room.players.length}`;
  playerListEl.innerHTML = '';

  room.players.forEach((player) => {
    const li = document.createElement('li');
    li.className = 'player';

    const name = document.createElement('span');
    name.className = 'name';
    // textContent (not innerHTML) stops anyone sneaking HTML into a nickname.
    name.textContent = player.name + (player.id === socket.id ? ' (you)' : '');
    li.append(makeAvatar(player), name);

    if (player.id === room.hostId) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'HOST';
      li.append(tag);
    }
    playerListEl.append(li);
  });

  // Only the host can change settings or start the game.
  const isHost = room.hostId === socket.id;
  setTiles(difficultyTiles, room.settings.difficulty, isHost);
  setTiles(countTiles, room.settings.questionCount, isHost);
  startBtn.hidden = !isHost;
  lobbyHint.hidden = isHost;
}

function enterRoom(room) {
  showError('');
  renderRoom(room);
  showScreen('lobby');
  syncClock(); // refresh the clock measurement before a game
}

function leaveRoom() {
  socket.emit('room:leave');
  currentRoom = null;
  clearInterval(countdownTimer);
  stopTicker();
  showScreen('home');
}
leaveBtn.addEventListener('click', leaveRoom);
homeBtn.addEventListener('click', leaveRoom);

copyBtn.addEventListener('click', () => copyText(currentRoom.code, copyBtn, 'Copied!'));
copyLinkBtn.addEventListener('click', () => {
  copyText(`${location.origin}/?code=${currentRoom.code}`, copyLinkBtn, 'Copied!');
});

// The host taps a difficulty or question-count tile.
function tileHandler(kind) {
  return (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || tile.disabled || !currentRoom) return;
    socket.emit('room:settings', {
      difficulty: kind === 'difficulty' ? tile.dataset.value : currentRoom.settings.difficulty,
      questionCount: kind === 'count' ? Number(tile.dataset.value) : currentRoom.settings.questionCount,
    });
  };
}
difficultyTiles.addEventListener('click', tileHandler('difficulty'));
countTiles.addEventListener('click', tileHandler('count'));

startBtn.addEventListener('click', () => socket.emit('game:start'));
rematchBtn.addEventListener('click', () => socket.emit('game:rematch'));

// The server says the room changed (someone joined or left, settings changed, rematch...).
socket.on('room:update', (room) => {
  if (!currentRoom || room.code !== currentRoom.code) return;
  renderRoom(room);
  // After a rematch the room goes back to "lobby": bring everyone back too.
  if (room.status === 'lobby' && $('lobby').hidden) showScreen('lobby');
});

// ============================================================
// Countdown: 3, 2, 1, GO!
// ============================================================
function resetGameUI() {
  stopTicker();
  finished = false;
  busy = false;
  penaltyMs = 0;
  tipQuestion = -1;
  laneEls = new Map();
  raceList.innerHTML = '';
  progressFill.style.width = '0%';
  timerEl.textContent = '0:00.0';
  feedback.textContent = '';
  hintLine.hidden = true;
  answerInput.hidden = false;
  skipBtn.hidden = false;
  finishedMsg.hidden = true;
}

socket.on('game:countdown', ({ startAt }) => {
  resetGameUI();
  showScreen('countdown');
  // startAt is on the SERVER's clock. Convert it to this device's clock.
  goAtLocal = startAt - clockOffset;

  if (currentRoom) {
    countInfo.textContent =
      `${currentRoom.settings.questionCount} questions · ${capitalize(currentRoom.settings.difficulty)}`;
  }

  const ring = countNumber.parentElement;
  clearInterval(countdownTimer);
  const tick = () => {
    const left = goAtLocal - Date.now();
    let text;
    if (left > 3000) text = '…';
    else if (left > 2000) text = '3';
    else if (left > 1000) text = '2';
    else if (left > 0) text = '1';
    else text = 'GO!';

    if (countNumber.textContent !== text) {
      countNumber.textContent = text;
      ring.classList.toggle('go', text === 'GO!');
      // Restart the little "pop" animation on every new number.
      countNumber.classList.remove('pop');
      void countNumber.offsetWidth;
      countNumber.classList.add('pop');
    }
    if (left < -2000) clearInterval(countdownTimer);
  };
  tick();
  countdownTimer = setInterval(tick, 30);
});

// ============================================================
// Playing
// ============================================================
function startTicker() {
  if (gameTicker) return;
  gameTicker = setInterval(tickGame, 100);
  tickGame();
}

function stopTicker() {
  clearInterval(gameTicker);
  gameTicker = null;
}

// Runs 10 times a second: updates the timer and the "stuck" hints.
function tickGame() {
  if (finished) return;
  timerEl.textContent = formatTime(Math.max(0, Date.now() - goAtLocal) + penaltyMs);

  const elapsed = Date.now() - questionShownAt;
  const left = timeoutMs - elapsed;

  if (left <= 15000) {
    // The last 15 seconds before the auto-skip.
    hintLine.textContent = `Auto-skip in ${Math.max(0, Math.ceil(left / 1000))}s (+${skipPenaltyMs / 1000}s)`;
    hintLine.hidden = false;
  } else if (elapsed >= 20000 && (tipQuestion === -1 || tipQuestion === currentIndex)) {
    // A friendly tip, shown once per game.
    tipQuestion = currentIndex;
    hintLine.textContent = `Stuck? Skip moves you on, but adds ${skipPenaltyMs / 1000} seconds.`;
    hintLine.hidden = false;
  } else {
    hintLine.hidden = true;
  }
}

// A small "+15s" that floats away next to the timer.
function showPenaltyPop(ms) {
  penPop.textContent = `+${ms / 1000}s`;
  penPop.classList.remove('show');
  void penPop.offsetWidth;
  penPop.classList.add('show');
}

function showQuestion(q, message) {
  clearInterval(countdownTimer);
  showScreen('game');

  expectedDigits = q.digits;
  timeoutMs = q.timeoutMs;
  skipPenaltyMs = q.skipPenaltyMs;
  currentIndex = q.index;
  questionShownAt = Date.now();

  answerInput.hidden = false;
  skipBtn.hidden = false;
  finishedMsg.hidden = true;
  hintLine.hidden = true;
  skipPen.textContent = `+${skipPenaltyMs / 1000}s`;

  answerInput.maxLength = q.digits; // the box stops accepting digits at the right length
  qProgress.textContent = `Question ${q.index + 1} of ${q.total}`;
  questionText.textContent = q.text;
  progressFill.style.width = `${(q.index / q.total) * 100}%`;
  feedback.textContent = message || '';
  answerInput.value = '';
  answerInput.focus();
  startTicker();
}

function showFinished() {
  finished = true;
  stopTicker();
  progressFill.style.width = '100%';
  answerInput.hidden = true;
  skipBtn.hidden = true;
  hintLine.hidden = true;
  feedback.textContent = '';
  finishedMsg.hidden = false;
}

// The server sends a question when the race starts, and also when it auto-skips us.
socket.on('game:question', (q) => {
  if (q.reason === 'timeout') {
    penaltyMs += q.skipPenaltyMs;
    showPenaltyPop(q.skipPenaltyMs);
    showQuestion(q, 'Out of time. Skipped.');
  } else {
    showQuestion(q);
  }
});

socket.on('game:finished', showFinished);

// Restarts the little shake animation on the answer box.
function shake() {
  answerInput.classList.remove('shake');
  void answerInput.offsetWidth;
  answerInput.classList.add('shake');
}
answerInput.addEventListener('animationend', () => answerInput.classList.remove('shake'));

function submitAnswer() {
  if (busy || finished) return;
  const value = answerInput.value.trim();
  if (value.length !== expectedDigits) return; // not finished typing yet
  busy = true;

  socket.emit('game:answer', { answer: value }, (res) => {
    busy = false;
    if (!res.ok) {
      feedback.textContent = res.error;
      answerInput.value = '';
      return;
    }
    if (!res.correct) {
      feedback.textContent = 'Wrong, try again';
      answerInput.value = '';
      answerInput.focus();
      shake();
      return;
    }
    // Correct: the reply already contains the next question, so show it at once.
    if (res.finished) showFinished();
    else showQuestion(res.question);
  });
}

function submitSkip() {
  if (busy || finished) return;
  busy = true;
  socket.emit('game:skip', {}, (res) => {
    busy = false;
    if (!res.ok) { feedback.textContent = res.error; return; }
    penaltyMs += res.penaltyMs;
    showPenaltyPop(res.penaltyMs);
    if (res.finished) showFinished();
    else showQuestion(res.question);
  });
}

skipBtn.addEventListener('click', submitSkip);

// Every time a digit is typed: keep only digits, then check if the answer is complete.
answerInput.addEventListener('input', () => {
  answerInput.value = answerInput.value.replace(/\D/g, '');
  submitAnswer();
});

// ----- Race lanes: everyone's progress, live -----
function renderLanes(players, total) {
  const sameLanes = players.length === laneEls.size && players.every((p) => laneEls.has(p.id));

  if (!sameLanes) {
    raceList.innerHTML = '';
    laneEls = new Map();
    players.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'lane' + (p.id === socket.id ? ' me' : '');

      const main = document.createElement('div');
      main.className = 'lane-main';
      const name = document.createElement('div');
      name.className = 'lane-name';
      name.textContent = p.name + (p.id === socket.id ? ' (you)' : '');
      const track = document.createElement('div');
      track.className = 'track';
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.background = p.color;
      track.append(fill);
      main.append(name, track);

      const count = document.createElement('span');
      count.className = 'lane-count';

      li.append(makeAvatar(p), main, count);
      raceList.append(li);
      laneEls.set(p.id, { fill, count });
    });
  }

  // Update the existing lanes in place, so the bars slide instead of jumping.
  players.forEach((p) => {
    const lane = laneEls.get(p.id);
    lane.fill.style.width = `${(p.done / total) * 100}%`;
    lane.count.textContent = p.left ? 'left' : p.finished ? 'done' : `${p.done}/${total}`;
  });
}
socket.on('game:progress', ({ players, total }) => renderLanes(players, total));

// ============================================================
// Results
// ============================================================
function renderPodium(players) {
  podium.innerHTML = '';
  const top = players.slice(0, 3);
  // Display order: 2nd, 1st, 3rd, so the winner stands in the middle.
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const delays = { 3: '0.1s', 2: '0.4s', 1: '0.8s' }; // third place rises first

  order.forEach((p) => {
    const col = document.createElement('div');
    col.className = `pod rank${p.rank}`;
    col.style.setProperty('--delay', delays[p.rank]);

    const block = document.createElement('div');
    block.className = 'pod-block';
    block.textContent = p.rank;

    const name = document.createElement('div');
    name.className = 'pod-name';
    name.textContent = p.name + (p.id === socket.id ? ' (you)' : '');

    const time = document.createElement('div');
    time.className = 'pod-time';
    time.textContent = p.finished ? formatTime(p.totalMs) : 'DNF';

    col.append(makeAvatar(p, true), block, name, time);
    podium.append(col);
  });
}

function renderChart(me) {
  timeBars.innerHTML = '';
  if (!me || me.times.length === 0) { chartCard.hidden = true; return; }
  chartCard.hidden = false;

  const max = Math.max(...me.times.map((t) => t.ms), 1);
  let slowest = 0;
  me.times.forEach((t, i) => {
    if (t.ms > me.times[slowest].ms) slowest = i;
    const bar = document.createElement('div');
    bar.className = 'bar' + (t.skipped ? ' skipped' : '');
    bar.style.height = `${Math.max(8, (t.ms / max) * 100)}%`;
    bar.title = `Q${i + 1}: ${(t.ms / 1000).toFixed(1)}s`;
    timeBars.append(bar);
  });

  chartNote.textContent =
    `Slowest: Q${slowest + 1} (${(me.times[slowest].ms / 1000).toFixed(1)}s)` +
    (me.skips ? ` · Skipped: ${me.skips} (orange)` : '');
}

socket.on('game:results', ({ players, total }) => {
  clearInterval(countdownTimer);
  stopTicker();

  const me = players.find((p) => p.id === socket.id);

  if (me) {
    if (!me.finished) resultTitle.textContent = 'Time is up';
    else if (players.length === 1) resultTitle.textContent = 'Finished!';
    else if (me.rank === 1) resultTitle.textContent = 'You won!';
    else resultTitle.textContent = `${ordinal(me.rank)} place`;

    resultSub.textContent = me.finished
      ? `${total} of ${total} · ${formatTime(me.totalMs)}`
      : `${me.completed} of ${total} answered`;
  }

  renderPodium(players);

  resultList.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'player';

    const rank = document.createElement('span');
    rank.className = 'rank-num';
    rank.textContent = p.rank;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name + (p.id === socket.id ? ' (you)' : '');

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = p.finished
      ? `${formatTime(p.totalMs)} · ${p.wrongs} wrong · ${p.skips} skipped`
      : `${p.left ? 'left' : 'did not finish'} (${p.completed}/${total})`;

    li.append(rank, makeAvatar(p), name, meta);
    resultList.append(li);
  });

  renderChart(me);

  const isHost = currentRoom && currentRoom.hostId === socket.id;
  rematchBtn.hidden = !isHost;
  rematchHint.hidden = isHost;
  showScreen('results');
});

// If the connection drops, the server removes us from the room, so go home.
socket.on('disconnect', () => {
  currentRoom = null;
  clearInterval(countdownTimer);
  stopTicker();
  showScreen('home');
  showError('Connection lost. Please join again.');
});

// ============================================================
// On page load
// ============================================================
nameInput.value = loadName();

// An invite link looks like /?code=K7Q2X9. Fill the code in automatically.
const inviteCode = new URLSearchParams(location.search).get('code');
if (inviteCode) {
  codeInput.value = inviteCode.toUpperCase().slice(0, 6);
  if (!nameInput.value) nameInput.focus();
}