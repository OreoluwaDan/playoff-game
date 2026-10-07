// public/js/app.js
// This code runs in the player's browser.

const socket = io();
const $ = (id) => document.getElementById(id);

// ----- Screens: only one is visible at a time -----
const SCREENS = ['welcome', 'home', 'lobby', 'countdown', 'game', 'results', 'profile'];
function showScreen(name) {
  SCREENS.forEach((s) => { $(s).hidden = s !== name; });
}

// ----- Page elements -----
// welcome / edit profile
const setupBack = $('setupBack');
const setupHeading = $('setupHeading');
const setupSub = $('setupSub');
const setupName = $('setupName');
const avatarGrid = $('avatarGrid');
const setupError = $('setupError');
const setupBtn = $('setupBtn');

// home
const profileBtn = $('profileBtn');
const homeAvatar = $('homeAvatar');
const homeGreeting = $('homeGreeting');
const helpBtn = $('helpBtn');
const createBtn = $('createBtn');
const practiceBtn = $('practiceBtn');
const codeInput = $('codeInput');
const joinBtn = $('joinBtn');
const errorEl = $('error');
const banner = $('banner');
const help = $('help');
const helpClose = $('helpClose');

// lobby
const leaveBtn = $('leaveBtn');
const lobbyTitle = $('lobbyTitle');
const codeCard = $('codeCard');
const roomCodeEl = $('roomCode');
const copyBtn = $('copyBtn');
const copyLinkBtn = $('copyLinkBtn');
const playersLabel = $('playersLabel');
const playerCount = $('playerCount');
const playerListEl = $('playerList');
const practiceBest = $('practiceBest');
const difficultyTiles = $('difficultyTiles');
const countTiles = $('countTiles');
const startBtn = $('startBtn');
const lobbyHint = $('lobbyHint');

// countdown and game
const countNumber = $('countNumber');
const countInfo = $('countInfo');
const progressFill = $('progressFill');
const timerEl = $('timer');
const penPop = $('penPop');
const raceTrack = $('raceTrack');
const qProgress = $('qProgress');
const questionText = $('questionText');
const answerInput = $('answerInput');
const feedback = $('feedback');
const hintLine = $('hintLine');
const skipBtn = $('skipBtn');
const skipPen = $('skipPen');
const finishedMsg = $('finishedMsg');

// results
const resultTitle = $('resultTitle');
const resultSub = $('resultSub');
const bestLine = $('bestLine');
const podium = $('podium');
const resultList = $('resultList');
const chartCard = $('chartCard');
const timeBars = $('timeBars');
const chartNote = $('chartNote');
const rematchBtn = $('rematchBtn');
const rematchHint = $('rematchHint');
const homeBtn = $('homeBtn');

// profile
const profileBack = $('profileBack');
const profileEditBtn = $('profileEditBtn');
const profileAvatar = $('profileAvatar');
const profileNameEl = $('profileName');
const profileSince = $('profileSince');
const statGames = $('statGames');
const statWins = $('statWins');
const statRate = $('statRate');
const bestGrid = $('bestGrid');
const recentList = $('recentList');
const resetStatsBtn = $('resetStatsBtn');
const switchBtn = $('switchBtn');
const statsNote = $('statsNote');

// ----- Sound on/off -----
const soundButtons = document.querySelectorAll('.sound-toggle');
const ICON_ON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_OFF = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>';

function renderSoundButtons() {
  soundButtons.forEach((button) => {
    button.innerHTML = Sound.isMuted() ? ICON_OFF : ICON_ON;
    button.setAttribute('aria-label', Sound.isMuted() ? 'Sound off. Tap to turn on' : 'Sound on. Tap to turn off');
  });
}

soundButtons.forEach((button) => {
  button.addEventListener('click', () => {
    Sound.setMuted(!Sound.isMuted());
    renderSoundButtons();
    if (!Sound.isMuted()) Sound.correct(); // a little preview blip
  });
});
renderSoundButtons();

// Browsers only allow sound after a tap or key press, so wake the audio on the first one.
document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
document.addEventListener('keydown', () => Sound.unlock(), { once: true });

// ----- State -----
let myProfile = null;       // { name, avatar, createdAt } saved on this device, or null
let currentRoom = null;     // the room we are in, or null on the home screen
let myId = null;            // our permanent player id (it survives reconnects)
let clockOffset = 0;        // (server clock) minus (this device's clock), in ms
let countdownTimer = null;
let gameTicker = null;      // updates the timer and hints while playing
let lockTimer = null;       // counts down the "too many wrong tries" pause
let busy = false;           // true while we wait for the server to answer our last move
let finished = false;       // true once we have answered every question
let expectedDigits = 0;     // how many digits the current answer has
let goAtLocal = 0;          // the moment GO happens, on THIS device's clock
let penaltyMs = 0;          // skip penalties so far (display only)
let questionShownAt = 0;
let currentIndex = 0;
let tipQuestion = -1;       // which question showed the skip tip (once per game)
let timeoutMs = 45000;
let skipPenaltyMs = 15000;
let laneEls = new Map();    // player id -> pieces of that player's race lane
let ghostReady = false;     // has the practice "PB" lane been set up for this game?
let ghostBestMs = 0;        // the best time the ghost lane follows (0 = no ghost)
let ghostDot = null;        // the practice "PB" dot on the race track
let setupMode = 'new';      // 'new' (first visit) or 'edit' (changing the profile)
let setupAvatar = 0;        // the avatar chosen on the setup screen

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

// The coloured initials circle used for players inside a room.
function makeAvatar(player, big) {
  const el = document.createElement('span');
  el.className = 'avatar' + (big ? ' lg' : '');
  el.style.background = player.color;
  el.style.color = readableText(player.color);
  el.textContent = initials(player.name);
  return el;
}

// ----- Saving things on this device (wrapped in try/catch: some browsers block storage) -----
function loadName() { try { return localStorage.getItem('playoff-name') || ''; } catch { return ''; } }

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value === null || value === undefined ? fallback : value;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// The session lets us rejoin our room after a dropped connection or a page refresh.
// sessionStorage belongs to ONE browser tab, so two windows never share a session.
function saveSession(code, secret) {
  try { sessionStorage.setItem('playoff-session', JSON.stringify({ code, secret })); } catch {}
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem('playoff-session')); } catch { return null; }
}
function clearSession() {
  try { sessionStorage.removeItem('playoff-session'); } catch {}
}

// The coloured strip at the top of the page: "Connecting…", "Reconnecting…".
function setBanner(text) {
  banner.textContent = text || '';
  banner.hidden = !text;
  // No point letting people press these while there is no connection.
  createBtn.disabled = !socket.connected;
  practiceBtn.disabled = !socket.connected;
  joinBtn.disabled = !socket.connected;
}

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
// Profile: name + avatar, saved on this device
// ============================================================
const PROFILE_KEY = 'playoff-profile';

// The 12 avatars. Each is a colour plus a simple white shape we drew ourselves.
// These are our own fixed strings, never typed by a player, so putting them
// into the page as HTML is safe.
const AVATARS = [
  { color: '#58CC02', icon: '<polygon points="12,2 15,9 22,9.5 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9.5 9,9"/>' },
  { color: '#1CB0F6', icon: '<polygon points="13,2 4,14 11,14 10,22 20,10 13,10"/>' },
  { color: '#FF4B4B', icon: '<path d="M12 21C5 16.5 2 12.5 2 8.5 2 5.5 4.3 3.5 7 3.5c2 0 3.8 1.1 5 3 1.2-1.9 3-3 5-3 2.7 0 5 2 5 5 0 4-3 8-10 12.5z"/>' },
  { color: '#FF9600', icon: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4.5 3-7 .5 2 1.5 3 2 3 .5-3 0-5 1-8z"/>' },
  { color: '#CE82FF', icon: '<polygon points="12,2 22,12 12,22 2,12"/>' },
  { color: '#2B70C9', icon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>' },
  { color: '#F5A300', icon: '<polygon points="3,19 3,8 8,12.5 12,5 16,12.5 21,8 21,19"/>' },
  { color: '#00B894', icon: '<path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15z"/>' },
  { color: '#FF86D0', icon: '<circle cx="8.5" cy="10" r="2.3"/><circle cx="15.5" cy="10" r="2.3"/><path d="M7.5 15.5Q12 19.5 16.5 15.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>' },
  { color: '#7C5CFF', icon: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="3"/><circle cx="12" cy="12" r="2.5"/>' },
  { color: '#FF7A59', icon: '<circle cx="12" cy="12" r="4.5"/><g stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g>' },
  { color: '#4B4B4B', icon: '<path d="M12 2C8 8 5 11 5 15a7 7 0 0 0 14 0c0-4-3-7-7-13z"/>' },
];

// Draws one profile avatar at the given size (in pixels).
function avatarEl(index, size) {
  const a = AVATARS[index] || AVATARS[0];
  const el = document.createElement('span');
  el.className = 'pf-avatar';
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.background = a.color;
  const inner = Math.round(size * 0.58);
  el.innerHTML = `<svg viewBox="0 0 24 24" width="${inner}" height="${inner}" fill="#fff" aria-hidden="true">${a.icon}</svg>`;
  return el;
}

// Reads the saved profile and checks it is sensible. Returns null if there is none.
function loadProfile() {
  const p = readJSON(PROFILE_KEY, null);
  if (!p || typeof p.name !== 'string' || !p.name.trim()) return null;
  return {
    name: p.name.trim().slice(0, 20),
    avatar: Number.isInteger(p.avatar) && p.avatar >= 0 && p.avatar < AVATARS.length ? p.avatar : 0,
    createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
  };
}

// Show the home screen, or the welcome screen if there is no profile yet.
function goHome() {
  if (!myProfile) { openSetup('new'); return; }
  homeGreeting.textContent = `Hi, ${myProfile.name}`; // textContent: safe even if the name has odd characters
  homeAvatar.replaceChildren(avatarEl(myProfile.avatar, 36));
  showScreen('home');
}

// ----- The setup screen (used for both "Get started" and "Edit profile") -----
function buildAvatarGrid() {
  avatarGrid.innerHTML = '';
  AVATARS.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-opt';
    btn.setAttribute('aria-label', `Avatar ${i + 1}`);
    btn.append(avatarEl(i, 52));
    btn.addEventListener('click', () => { setupAvatar = i; markAvatar(); });
    avatarGrid.append(btn);
  });
}

function markAvatar() {
  [...avatarGrid.children].forEach((btn, i) => {
    btn.classList.toggle('on', i === setupAvatar);
    btn.setAttribute('aria-pressed', i === setupAvatar ? 'true' : 'false');
  });
}

function openSetup(mode) {
  const editing = mode === 'edit' && !!myProfile;
  setupMode = editing ? 'edit' : 'new';
  setupBack.hidden = !editing;
  setupHeading.textContent = editing ? 'Edit profile' : 'Welcome to PlayOff';
  setupSub.textContent = editing ? 'Change your name or avatar.' : 'Pick a name and an avatar to get started.';
  setupBtn.textContent = editing ? 'Save' : 'Get started';
  setupName.value = editing ? myProfile.name : loadName(); // loadName() carries over an older nickname
  setupAvatar = editing ? myProfile.avatar : 0;
  setupError.textContent = '';
  markAvatar();
  showScreen('welcome');
}

function submitSetup() {
  const name = setupName.value.trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!name) {
    setupError.textContent = 'Please enter a name.';
    setupName.focus();
    return;
  }
  const createdAt = setupMode === 'edit' && myProfile ? myProfile.createdAt : Date.now();
  myProfile = { name, avatar: setupAvatar, createdAt };
  writeJSON(PROFILE_KEY, myProfile); // if the browser blocks storage, the profile just lasts until the page closes

  if (setupMode === 'edit') { renderProfile(); showScreen('profile'); }
  else goHome();
}

setupBtn.addEventListener('click', submitSetup);
setupName.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitSetup(); });
setupBack.addEventListener('click', () => { renderProfile(); showScreen('profile'); });

// ----- The "How to play" card -----
function openHelp() { help.hidden = false; helpClose.focus(); }
function closeHelp() { help.hidden = true; }
helpBtn.addEventListener('click', openHelp);
helpClose.addEventListener('click', closeHelp);
help.addEventListener('click', (e) => { if (e.target === help) closeHelp(); }); // tap outside the card
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !help.hidden) closeHelp(); });

// ============================================================
// Stats: best times, totals and game history (all saved on THIS device)
// ============================================================
const HISTORY_KEY = 'playoff-history';
const TOTALS_KEY = 'playoff-totals';
const MAX_HISTORY = 50;
const DIFFICULTY_LIST = ['easy', 'medium', 'hard'];
const COUNT_LIST = [5, 10, 15, 20];

function bestKey(difficulty, count) { return `playoff-best-${difficulty}-${count}`; }

function getBest(difficulty, count) {
  try { return Number(localStorage.getItem(bestKey(difficulty, count))) || null; } catch { return null; }
}
function setBest(difficulty, count, ms) {
  try { localStorage.setItem(bestKey(difficulty, count), String(ms)); } catch {}
}

// Saves one finished game. Returns false if this exact game was already saved
// (which happens when you refresh on the results screen).
function recordGame(entry) {
  const stored = readJSON(HISTORY_KEY, []);
  const history = Array.isArray(stored) ? stored : [];
  if (history.some((g) => g.id === entry.id)) return false;

  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;

  const saved = readJSON(TOTALS_KEY, null);
  const totals = {
    games: (saved && saved.games) || 0,
    wins: (saved && saved.wins) || 0,
    versus: (saved && saved.versus) || 0,
  };
  totals.games++;
  if (entry.mode === 'versus') {
    totals.versus++;
    if (entry.won) totals.wins++;
  }

  writeJSON(HISTORY_KEY, history);
  writeJSON(TOTALS_KEY, totals);
  return true;
}

// Fills in the whole profile screen.
function renderProfile() {
  if (!myProfile) return;

  profileAvatar.replaceChildren(avatarEl(myProfile.avatar, 84));
  profileNameEl.textContent = myProfile.name;
  profileSince.textContent =
    `Playing since ${new Date(myProfile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;

  const saved = readJSON(TOTALS_KEY, null);
  const totals = {
    games: (saved && saved.games) || 0,
    wins: (saved && saved.wins) || 0,
    versus: (saved && saved.versus) || 0,
  };
  statGames.textContent = totals.games;
  statWins.textContent = totals.wins;
  statRate.textContent = totals.versus ? `${Math.round((totals.wins / totals.versus) * 100)}%` : '–';

  // Best times grid: a row for each difficulty, a column for each question count.
  bestGrid.innerHTML = '';
  const addCell = (text, className) => {
    const cell = document.createElement('div');
    cell.className = className;
    cell.textContent = text;
    bestGrid.append(cell);
  };
  addCell('', 'head');
  COUNT_LIST.forEach((count) => addCell(`${count} Q`, 'head'));
  DIFFICULTY_LIST.forEach((difficulty) => {
    addCell(capitalize(difficulty), 'rowlabel');
    COUNT_LIST.forEach((count) => {
      const best = getBest(difficulty, count);
      addCell(best ? formatTime(best) : '–', best ? 'cell has' : 'cell');
    });
  });

  // The last 10 games.
  recentList.innerHTML = '';
  const stored = readJSON(HISTORY_KEY, []);
  const history = Array.isArray(stored) ? stored.slice(0, 10) : [];
  if (history.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No games yet. Go play one!';
    recentList.append(empty);
  }
  history.forEach((g) => {
    const li = document.createElement('li');
    li.className = 'player history-row';

    let label;
    if (g.mode === 'versus') label = g.finished ? `${ordinal(g.rank)} of ${g.players}` : 'Did not finish';
    else label = (g.mode === 'practice' ? 'Practice' : 'Solo') + (g.finished ? '' : ' · unfinished');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;

    const date = new Date(g.t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent =
      `${capitalize(g.difficulty)} · ${g.count} questions · ${g.finished && g.totalMs ? formatTime(g.totalMs) : '–'} · ${date}`;

    li.append(name, meta);
    recentList.append(li);
  });

  // Tell people honestly if their browser can't save anything.
  let canSave = true;
  try {
    localStorage.setItem('playoff-test', '1');
    localStorage.removeItem('playoff-test');
  } catch { canSave = false; }
  statsNote.textContent = canSave
    ? 'Saved on this device only. Clearing your browser data erases it.'
    : "This browser is blocking storage, so your profile and stats can't be saved here.";
}

profileBtn.addEventListener('click', () => { renderProfile(); showScreen('profile'); });
profileBack.addEventListener('click', goHome);
profileEditBtn.addEventListener('click', () => openSetup('edit'));

// Reset stats: keeps your profile, deletes games and best times.
resetStatsBtn.addEventListener('click', () => {
  if (!window.confirm('Delete your game history and best times? Your profile is kept.')) return;
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(TOTALS_KEY);
    Object.keys(localStorage)
      .filter((key) => key.startsWith('playoff-best-'))
      .forEach((key) => localStorage.removeItem(key));
  } catch {}
  renderProfile();
});

// Switch player: deletes the profile AND its stats from this device.
// (There is no account behind a profile, so there is nothing to log back in to.)
switchBtn.addEventListener('click', () => {
  if (!window.confirm('Switch player? This deletes your name, avatar, stats and best times from this device.')) return;
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('playoff-') && key !== 'playoff-muted') // keep the sound setting
      .forEach((key) => localStorage.removeItem(key));
  } catch {}
  clearSession();
  myProfile = null;
  openSetup('new');
});

// ============================================================
// Clock sync: work out how far this device's clock is from the server's,
// so the countdown ends at the same real moment for everyone.
// ============================================================
function syncClock(done) {
  let best = null;
  let remaining = 5;
  let called = false;
  const finish = () => { if (!called && done) { called = true; done(); } };

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
      finish();
      if (--remaining > 0) setTimeout(once, 100);
    });
  };
  once();
  setTimeout(finish, 3000); // never wait forever, even if the server is slow to answer
}

// ============================================================
// Home: create, practice, join
// ============================================================
// Called when the server says "you are in a room".
function onEntered(res) {
  myId = res.playerId;
  saveSession(res.room.code, res.secret);
  enterRoom(res.room);
}

function join() {
  if (!myProfile) return goHome();
  socket.emit('room:join', { name: myProfile.name, code: codeInput.value }, (res) => {
    if (!res.ok) return showError(res.error);
    onEntered(res);
  });
}

createBtn.addEventListener('click', () => {
  if (!myProfile) return goHome();
  socket.emit('room:create', { name: myProfile.name }, (res) => {
    if (!res.ok) return showError(res.error);
    onEntered(res);
  });
});

// Practice: a private room just for you.
practiceBtn.addEventListener('click', () => {
  if (!myProfile) return goHome();
  socket.emit('room:create', { name: myProfile.name, practice: true }, (res) => {
    if (!res.ok) return showError(res.error);
    onEntered(res);
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
  const practice = !!room.practice;

  // A practice room has no code and no other players, so hide those parts.
  lobbyTitle.textContent = practice ? 'Practice' : 'Waiting room';
  codeCard.hidden = practice;
  playersLabel.hidden = practice;
  playerListEl.hidden = practice;
  startBtn.textContent = practice ? 'Start practice' : 'Start game';

  roomCodeEl.textContent = room.code;
  playerCount.textContent = `· ${room.players.length}`;
  playerListEl.innerHTML = '';

  room.players.forEach((player) => {
    const li = document.createElement('li');
    li.className = 'player';

    const name = document.createElement('span');
    name.className = 'name';
    // textContent (not innerHTML) stops anyone sneaking HTML into a nickname.
    name.textContent = player.name + (player.id === myId ? ' (you)' : '');
    li.append(makeAvatar(player), name);

    if (player.id === room.hostId) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'HOST';
      li.append(tag);
    }
    if (!player.connected) {
      const away = document.createElement('span');
      away.className = 'tag muted';
      away.textContent = 'RECONNECTING…';
      li.append(away);
    }
    playerListEl.append(li);
  });

  // In practice, show your best time for the chosen setting.
  if (practice) {
    const best = getBest(room.settings.difficulty, room.settings.questionCount);
    practiceBest.textContent = best
      ? `Your best on this setting: ${formatTime(best)}`
      : 'No best time on this setting yet';
    practiceBest.hidden = false;
  } else {
    practiceBest.hidden = true;
  }

  // Only the host can change settings or start the game.
  const isHost = room.hostId === myId;
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
  clearSession();
  currentRoom = null;
  myId = null;
  clearInterval(countdownTimer);
  stopTicker();
  goHome();
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
  clearInterval(lockTimer);
  finished = false;
  busy = false;
  penaltyMs = 0;
  tipQuestion = -1;
  laneEls = new Map();
  ghostReady = false;
  ghostBestMs = 0;
  ghostDot = null;
  raceTrack.querySelectorAll('.race-dot').forEach((d) => d.remove());
  progressFill.style.width = '0%';
  timerEl.textContent = '0:00.0';
  feedback.textContent = '';
  hintLine.hidden = true;
  answerInput.hidden = false;
  answerInput.readOnly = false;
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
      if (text === 'GO!') Sound.go();
      else if (text !== '…') Sound.tick();
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

// Runs 10 times a second: updates the timer, the ghost lane and the "stuck" hints.
function tickGame() {
  if (finished) return;
  const runMs = Math.max(0, Date.now() - goAtLocal);
  timerEl.textContent = formatTime(runMs + penaltyMs);

  // The practice ghost moves at a steady pace across your best time.
  if (ghostDot && ghostBestMs > 0) {
    ghostDot.style.left = `${Math.min(100, (runMs / ghostBestMs) * 100)}%`;
  }

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

// In practice with a saved best time, add a grey "PB" lane that follows that pace.
function setupGhost() {
  ghostReady = true;
  ghostBestMs = 0;
  ghostDot = null;
  raceTrack.querySelectorAll('.race-dot.ghost').forEach((d) => d.remove());
  if (!currentRoom || !currentRoom.practice) return;

  const best = getBest(currentRoom.settings.difficulty, currentRoom.settings.questionCount);
  if (!best) return;
  ghostBestMs = best;

  const dot = document.createElement('span');
  dot.className = 'race-dot ghost';
  dot.title = `Your best (${formatTime(best)})`;
  dot.style.left = '0%';
  raceTrack.append(dot);
  ghostDot = dot;
}

function showQuestion(q, message) {
  clearInterval(countdownTimer);
  clearInterval(lockTimer);
  showScreen('game');
  if (!ghostReady) setupGhost();

  expectedDigits = q.digits;
  timeoutMs = q.timeoutMs;
  skipPenaltyMs = q.skipPenaltyMs;
  currentIndex = q.index;
  questionShownAt = Date.now() - (q.elapsedMs || 0); // right even if we just came back
  penaltyMs = q.penaltyMs || 0;                      // the server's penalty total
  goAtLocal = q.startAt - clockOffset;

  answerInput.hidden = false;
  answerInput.readOnly = false;
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
  clearInterval(lockTimer);
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
    showPenaltyPop(q.skipPenaltyMs);
    Sound.skip();
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

// Locks the answer box for a few seconds after too many wrong tries.
function lockInput(ms) {
  clearInterval(lockTimer);
  answerInput.readOnly = true;
  const until = Date.now() + ms;
  const update = () => {
    const left = until - Date.now();
    if (left <= 0) {
      clearInterval(lockTimer);
      answerInput.readOnly = false;
      feedback.textContent = '';
      answerInput.focus();
    } else {
      feedback.textContent = `Too many wrong tries. Wait ${Math.ceil(left / 1000)}s`;
    }
  };
  update();
  lockTimer = setInterval(update, 200);
}

function submitAnswer() {
  if (busy || finished || !socket.connected) return;
  const value = answerInput.value.trim();
  if (value.length !== expectedDigits) return; // not finished typing yet
  busy = true;

  socket.emit('game:answer', { answer: value }, (res) => {
    busy = false;
    if (!res.ok) {
      answerInput.value = '';
      if (res.cooldownMs) lockInput(res.cooldownMs);
      else feedback.textContent = res.error;
      return;
    }
    if (!res.correct) {
      feedback.textContent = 'Wrong, try again';
      answerInput.value = '';
      answerInput.focus();
      shake();
      Sound.wrong();
      if (res.cooldownMs) lockInput(res.cooldownMs);
      return;
    }
    // Correct: the reply already contains the next question, so show it at once.
    Sound.correct();
    if (res.finished) showFinished();
    else showQuestion(res.question);
  });
}

function submitSkip() {
  if (busy || finished || !socket.connected) return;
  busy = true;
  socket.emit('game:skip', {}, (res) => {
    busy = false;
    if (!res.ok) { feedback.textContent = res.error; return; }
    showPenaltyPop(res.penaltyMs);
    Sound.skip();
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
  const same = players.length === laneEls.size && players.every((p) => laneEls.has(p.id));

  if (!same) {
    raceTrack.querySelectorAll('.race-dot:not(.ghost)').forEach((d) => d.remove());
    laneEls = new Map();
    players.forEach((p, i) => {
      const dot = document.createElement('span');
      dot.className = 'race-dot' + (p.id === myId ? ' me' : '');
      dot.style.background = p.color;
      // Stagger the dots up and down a little so players at the same spot don't hide each other.
      dot.style.setProperty('--dy', `${((i % 3) - 1) * 9}px`);
      dot.title = p.name + (p.id === myId ? ' (you)' : '');
      raceTrack.append(dot);
      laneEls.set(p.id, dot);
    });
  }

  // Move the existing dots, so they slide instead of jumping.
  players.forEach((p) => {
    const dot = laneEls.get(p.id);
    dot.style.left = `${(p.done / total) * 100}%`;
    dot.classList.toggle('away', !!(p.away || p.left));
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
    name.textContent = p.name + (p.id === myId ? ' (you)' : '');

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
    (me.skips ? ` · Skipped: ${me.skips} (orange)` : '') +
    (me.bonusMs ? ` · Streak bonus: -${(me.bonusMs / 1000).toFixed(1)}s` : '');
}

// A burst of falling confetti for the winner.
function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#58CC02', '#1CB0F6', '#FF9600', '#FF4B4B', '#CE82FF', '#FFC800'];
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';

  for (let i = 0; i < 90; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty('--spin', `${Math.random() * 720 - 360}deg`);
    piece.style.animationDuration = `${2.2 + Math.random() * 1.8}s`;
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    layer.append(piece);
  }

  document.body.append(layer);
  setTimeout(() => layer.remove(), 5000);
}

socket.on('game:results', ({ players, total, gameId }) => {
  clearInterval(countdownTimer);
  stopTicker();

  const me = players.find((p) => p.id === myId);
  const room = currentRoom;
  const practice = !!(room && room.practice);
  const versus = !practice && players.length >= 2;

  // 1) Save this game to the history (skipped if it was already saved).
  let fresh = false;
  if (me && room) {
    fresh = recordGame({
      id: `${room.code}-${gameId || Date.now()}-${myId}`,
      t: Date.now(),
      mode: practice ? 'practice' : versus ? 'versus' : 'solo',
      difficulty: room.settings.difficulty,
      count: total,
      players: players.length,
      rank: me.rank,
      finished: me.finished,
      totalMs: me.totalMs,
      wrongs: me.wrongs,
      skips: me.skips,
      won: versus && me.finished && me.rank === 1,
    });
  }

  // 2) Compare with your personal best on this setting.
  let newBest = false;
  bestLine.hidden = true;
  if (me && me.finished && room) {
    const { difficulty } = room.settings;
    const previous = getBest(difficulty, total);

    if (previous === null) {
      setBest(difficulty, total, me.totalMs);
      newBest = true;
      bestLine.textContent = 'Saved as your best time on this setting';
    } else if (me.totalMs < previous) {
      setBest(difficulty, total, me.totalMs);
      newBest = true;
      bestLine.textContent = `New personal best! ${formatTime(previous - me.totalMs)} faster than before`;
    } else if (me.totalMs === previous) {
      bestLine.textContent = 'This is your best time on this setting';
    } else {
      bestLine.textContent = `${formatTime(me.totalMs - previous)} slower than your best (${formatTime(previous)})`;
    }
    bestLine.hidden = false;
  }

  // 3) Title and subtitle.
  if (me) {
    if (!me.finished) resultTitle.textContent = 'Time is up';
    else if (practice) resultTitle.textContent = newBest ? 'New best!' : 'Done!';
    else if (players.length === 1) resultTitle.textContent = 'Finished!';
    else if (me.rank === 1) resultTitle.textContent = 'You won!';
    else resultTitle.textContent = `${ordinal(me.rank)} place`;

    resultSub.textContent = me.finished
      ? `${total} of ${total} · ${formatTime(me.totalMs)}`
      : `${me.completed} of ${total} answered`;
  }

  // 4) Podium and ranking (not needed when you are alone in practice).
  podium.hidden = practice;
  resultList.hidden = practice;
  if (!practice) renderPodium(players);

  resultList.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'player';

    const rank = document.createElement('span');
    rank.className = 'rank-num';
    rank.textContent = p.rank;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name + (p.id === myId ? ' (you)' : '');

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = p.finished
      ? `${formatTime(p.totalMs)} · ${p.wrongs} wrong · ${p.skips} skipped`
      : `${p.left ? 'left' : 'did not finish'} (${p.completed}/${total})`;

    li.append(rank, makeAvatar(p), name, meta);
    resultList.append(li);
  });

  renderChart(me);

  const isHost = room && room.hostId === myId;
  rematchBtn.textContent = practice ? 'Play again' : 'Rematch';
  rematchBtn.hidden = !isHost;
  rematchHint.hidden = isHost;
  showScreen('results');

  // 5) Celebrate (only the first time we see these results, not after a refresh).
  const celebrate = fresh && me && me.finished && ((practice && newBest) || (versus && me.rank === 1));
  setTimeout(() => {
    if ($('results').hidden) return; // they already left the results screen
    if (celebrate) { Sound.win(); confetti(); }
    else if (fresh && me && me.finished) Sound.finish();
  }, practice ? 300 : 900);
});

// ============================================================
// Connection: dropped connections, reconnecting, rejoining
// ============================================================
function tryRejoin() {
  const session = loadSession();
  if (!session) { setBanner(null); return; }

  socket.emit('room:rejoin', session, (res) => {
    setBanner(null);
    if (!res.ok) {
      // The game is gone (the server restarted, or we were away too long).
      clearSession();
      currentRoom = null;
      myId = null;
      clearInterval(countdownTimer);
      stopTicker();
      goHome();
      showError(res.error);
      return;
    }
    myId = res.playerId;
    renderRoom(res.room);
    // For a game in progress, the server now re-sends the question, the countdown
    // or the results, and those handlers show the right screen.
    if (res.room.status === 'lobby') showScreen('lobby');
  });
}

// Fires on the first connection AND on every automatic reconnection.
socket.on('connect', () => syncClock(tryRejoin));

socket.on('disconnect', (reason) => {
  setBanner('Connection lost. Reconnecting…');
  if (reason === 'io server disconnect') socket.connect(); // the server hung up: knock again
});

socket.on('connect_error', () => {
  setBanner("Can't reach the server. Trying again…");
});

// ============================================================
// On page load
// ============================================================
buildAvatarGrid();
myProfile = loadProfile(); // a saved profile means we skip straight to the home screen

// An invite link looks like /?code=K7Q2X9. Fill the code in automatically.
const inviteCode = new URLSearchParams(location.search).get('code');
if (inviteCode) codeInput.value = inviteCode.toUpperCase().slice(0, 6);

goHome(); // shows the home screen, or the welcome screen for a new player

// Until the server answers, show a friendly note. (A free server can take a while to wake up.)
setBanner('Connecting… the free server can take up to a minute to wake up.');  