// public/js/app.js
// This code runs in the player's browser.

const socket = io();

// Grab the page elements we need to control.
const home = document.getElementById('home');
const lobby = document.getElementById('lobby');
const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const errorEl = document.getElementById('error');
const roomCodeEl = document.getElementById('roomCode');
const copyBtn = document.getElementById('copyBtn');
const playerListEl = document.getElementById('playerList');
const leaveBtn = document.getElementById('leaveBtn');

let currentRoom = null; // the room we are in, or null if we are on the home screen

// Show one screen and hide the other.
function showScreen(name) {
  home.hidden = name !== 'home';
  lobby.hidden = name !== 'lobby';
}

function showError(message) {
  errorEl.textContent = message || '';
}

// Draw the room code and the player list.
function renderRoom(room) {
  currentRoom = room;
  roomCodeEl.textContent = room.code;
  playerListEl.innerHTML = ''; // clear the old list

  room.players.forEach((player) => {
    const li = document.createElement('li');

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = player.color;

    const name = document.createElement('span');
    // textContent (not innerHTML) is important: it stops anyone typing HTML
    // or scripts into their nickname to attack the other players.
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
}

// Called when the server confirms we are in a room.
function enterRoom(room) {
  showError('');
  renderRoom(room);
  showScreen('lobby');
}

createBtn.addEventListener('click', () => {
  // The third argument is a function the server calls with its answer.
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

leaveBtn.addEventListener('click', () => {
  socket.emit('room:leave');
  currentRoom = null;
  showScreen('home');
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentRoom.code);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy code'; }, 1200);
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
});

// The server tells us the player list changed (someone joined or left).
socket.on('room:update', (room) => {
  if (currentRoom && room.code === currentRoom.code) renderRoom(room);
});

// If the connection drops, the server removes us from the room, so go home.
socket.on('disconnect', () => {
  currentRoom = null;
  showScreen('home');
  showError('Connection lost. Please join again.');
});