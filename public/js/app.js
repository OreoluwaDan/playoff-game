// public/js/app.js
// This code runs in the player's browser.

const socket = io();

// A short way to grab a page element by its id.
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
const roomCodeEl = $('roomCode');
const copyBtn = $('copyBtn');
const playerListEl = $('playerList');
const leaveBtn = $('leaveBtn');
const difficultySelect = $('difficultySelect');
const countSelect = $('countSelect');
const startBtn = $('startBtn');
const lobbyHint = $('lobbyHint');
const countNumber = $('countNumber');
const qProgress = $('qProgress');
const questionText = $('questionText');
const answerInput = $('answerInput');
const skipBtn = $('skipBtn');
const feedback = $('feedback');
const finishedMsg = $('finishedMsg');
const raceList = $('raceList');
const resultList = $('resultList');
const rematchBtn = $('rematchBtn');
const homeBtn = $('homeBtn');

// ----- State -----
let currentRoom = null;   // the room we are in, or null on the home screen
let clockOffset = 0;      // (server clock) minus (this device's clock), in milliseconds
let countdownTimer = null;
let busy = false;         // true while we wait for the server to answer our last move
let expectedDigits = 0;   // how many digits the current answer has

function showError(message) { errorEl.textContent = message || ''; }

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
      // The server's reply was made roughly halfway through the round trip.
      // Keep the sample with the shortest round trip, because it is the most accurate.
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
// Home and lobby
// ============================================================
function renderRoom(room) {
  currentRoom = room;
  roomCodeEl.textContent = room.code;
  playerListEl.innerHTML = '';

  room.players.forEach((player) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = player.color;

    const name = document.createElement('span');
    // textContent (not innerHTML) stops anyone sneaking HTML into a nickname.
    name.textContent = player.name + (player.id === socket.id ? ' (you)' : '');
    li.append(dot, name);

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
  difficultySelect.value = room.settings.difficulty;
  countSelect.value = String(room.settings.questionCount);
  difficultySelect.disabled = !isHost;
  countSelect.disabled = !isHost;
  startBtn.hidden = !isHost;
  lobbyHint.hidden = isHost;
}

function enterRoom(room) {
  showError('');
  renderRoom(room);
  showScreen('lobby');
  syncClock(); // refresh the clock measurement before a game
}

createBtn.addEventListener('click', () => {
  socket.emit('room:create', { name: nameInput.value }, (res) => {
    if (!res.ok) return showError(res.error);
    enterRoom(res.room);
  });
});

function join() {
  socket.emit('room:join', { name: nameInput.value, code: codeInput.value }, (res) => {
    if (!res.ok) return showError(res.error);
    enterRoom(res.room);
  });
}
joinBtn.addEventListener('click', join);
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });

function leaveRoom() {
  socket.emit('room:leave');
  currentRoom = null;
  clearInterval(countdownTimer);
  showScreen('home');
}
leaveBtn.addEventListener('click', leaveRoom);
homeBtn.addEventListener('click', leaveRoom);

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentRoom.code);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy code'; }, 1200);
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
});

// The host changed a setting.
function sendSettings() {
  socket.emit('room:settings', {
    difficulty: difficultySelect.value,
    questionCount: Number(countSelect.value),
  });
}
difficultySelect.addEventListener('change', sendSettings);
countSelect.addEventListener('change', sendSettings);

startBtn.addEventListener('click', () => socket.emit('game:start'));
rematchBtn.addEventListener('click', () => socket.emit('game:rematch'));

// The server says the room changed (someone joined or left, settings changed...).
socket.on('room:update', (room) => {
  if (!currentRoom || room.code !== currentRoom.code) return;
  renderRoom(room);
  // After a rematch the room goes back to "lobby": bring everyone back too.
  if (room.status === 'lobby' && $('lobby').hidden) showScreen('lobby');
});

// ============================================================
// Countdown: 3, 2, 1, GO!
// ============================================================
socket.on('game:countdown', ({ startAt }) => {
  showScreen('countdown');
  // startAt is on the SERVER's clock. Convert it to this device's clock.
  const goAt = startAt - clockOffset;

  clearInterval(countdownTimer);
  const tick = () => {
    const left = goAt - Date.now();
    let text;
    if (left > 3000) text = '…';
    else if (left > 2000) text = '3';
    else if (left > 1000) text = '2';
    else if (left > 0) text = '1';
    else text = 'GO!';
    if (countNumber.textContent !== text) countNumber.textContent = text;
    if (left < -2000) clearInterval(countdownTimer);
  };
  tick();
  countdownTimer = setInterval(tick, 30);
});

// ============================================================
// Playing
// ============================================================
function showQuestion(q, message) {
  clearInterval(countdownTimer);
  showScreen('game');
  answerInput.hidden = false;
  skipBtn.hidden = false;
  finishedMsg.hidden = true;

  expectedDigits = q.digits;
  answerInput.maxLength = q.digits; // the box stops accepting digits at the right length

  qProgress.textContent = `Question ${q.index + 1} of ${q.total}`;
  questionText.textContent = q.text;
  feedback.textContent = message || '';
  answerInput.value = '';
  answerInput.focus();
}

function showFinished() {
  answerInput.hidden = true;
  skipBtn.hidden = true;
  feedback.textContent = '';
  finishedMsg.hidden = false;
}

// The server sends a question when the race starts, and also when it auto-skips us.
socket.on('game:question', (q) => {
  showQuestion(q, q.reason === 'timeout' ? 'Out of time. Skipped (+15s).' : '');
});

socket.on('game:finished', showFinished);

// Restarts the little shake animation on the answer box.
function shake() {
  answerInput.classList.remove('shake');
  void answerInput.offsetWidth; // forces the browser to restart the animation
  answerInput.classList.add('shake');
}


function submitAnswer() {
  if (busy) return;
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
  if (busy) return;
  busy = true;
  socket.emit('game:skip', {}, (res) => {
    busy = false;
    if (!res.ok) { feedback.textContent = res.error; return; }
    if (res.finished) showFinished();
    else showQuestion(res.question, 'Skipped (+15s)');
  });
}

skipBtn.addEventListener('click', submitSkip);
// Every time a digit is typed: keep only digits, then check if the answer is complete.
answerInput.addEventListener('input', () => {
  answerInput.value = answerInput.value.replace(/\D/g, '');
  submitAnswer();
});

answerInput.addEventListener('animationend', () => answerInput.classList.remove('shake'));

// Everyone's progress, live.
socket.on('game:progress', ({ players, total }) => {
  raceList.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;

    const name = document.createElement('span');
    name.textContent = p.name + (p.id === socket.id ? ' (you)' : '');

    const info = document.createElement('span');
    info.className = 'tag';
    info.textContent = p.left ? 'left' : p.finished ? 'finished' : `${p.done}/${total}`;

    li.append(dot, name, info);
    raceList.append(li);
  });
});

// ============================================================
// Results
// ============================================================
// 62400 milliseconds -> "1:02.4"
function formatTime(ms) {
  const tenths = Math.round(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

socket.on('game:results', ({ players, total }) => {
  clearInterval(countdownTimer);
  resultList.innerHTML = '';

  players.forEach((p) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;

    const name = document.createElement('span');
    name.textContent = `${p.rank}. ${p.name}` + (p.id === socket.id ? ' (you)' : '');

    const info = document.createElement('span');
    info.className = 'tag';
    info.textContent = p.finished
      ? `${formatTime(p.totalMs)} · ${p.wrongs} wrong · ${p.skips} skipped`
      : `${p.left ? 'left' : 'did not finish'} (${p.completed}/${total})`;

    li.append(dot, name, info);
    resultList.append(li);
  });

  rematchBtn.hidden = !(currentRoom && currentRoom.hostId === socket.id);
  showScreen('results');
});

// If the connection drops, the server removes us from the room, so go home.
socket.on('disconnect', () => {
  currentRoom = null;
  clearInterval(countdownTimer);
  showScreen('home');
  showError('Connection lost. Please join again.');
});