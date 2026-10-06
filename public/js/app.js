// public/js/app.js
// This code runs in the player's browser.

// io() opens the live connection to the server.
const socket = io();

const statusEl = document.getElementById('status');
const onlineEl = document.getElementById('online');
const replyEl = document.getElementById('reply');
const nameInput = document.getElementById('nameInput');
const helloBtn = document.getElementById('helloBtn');

// Fires when we connect successfully.
socket.on('connect', () => {
  statusEl.textContent = 'Connected to the server';
});

// Fires if the connection drops (Wi-Fi off, server stopped, etc.).
socket.on('disconnect', () => {
  statusEl.textContent = 'Connection lost… reconnecting';
});

// The server tells us how many people are online.
socket.on('online', (count) => {
  onlineEl.textContent = `Players online: ${count}`;
});

// The server replies to our hello.
socket.on('welcome', (message) => {
  replyEl.textContent = message;
});

// When the button is clicked, send our name to the server.
helloBtn.addEventListener('click', () => {
  socket.emit('hello', nameInput.value);
});