// public/js/sound.js
// Makes every sound with the browser's built-in Web Audio, so no audio files are needed.
// Browsers only allow sound after the person has tapped or pressed a key,
// so app.js calls Sound.unlock() on the first tap.

const Sound = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('playoff-muted') === '1'; } catch {}

  function getCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Plays one short note: its pitch (freq), when it starts, and how long it lasts.
  function tone(freq, start, duration, type = 'sine', volume = 0.15) {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    // Fade in and out quickly so the sound doesn't click.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  // Vibrate the phone (only on devices that support it).
  function buzz(pattern) {
    if (muted) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
  }

  const play = (fn) => { if (!muted) fn(); };

  return {
    unlock() { if (!muted) getCtx(); },
    isMuted() { return muted; },
    setMuted(value) {
      muted = value;
      try { localStorage.setItem('playoff-muted', value ? '1' : '0'); } catch {}
      if (!value) getCtx();
    },

    tick() { play(() => tone(660, 0, 0.12, 'sine', 0.12)); },
    go() {
      play(() => {
        tone(880, 0, 0.1, 'triangle', 0.15);
        tone(1320, 0.09, 0.3, 'triangle', 0.15);
      });
    },
    correct() {
      play(() => {
        tone(784, 0, 0.07, 'triangle', 0.1);
        tone(1175, 0.06, 0.1, 'triangle', 0.1);
      });
      buzz(12);
    },
    wrong() {
      play(() => tone(180, 0, 0.18, 'sawtooth', 0.07));
      buzz(45);
    },
    skip() {
      play(() => {
        tone(420, 0, 0.1, 'square', 0.05);
        tone(300, 0.09, 0.14, 'square', 0.05);
      });
      buzz(25);
    },
    finish() {
      play(() => {
        tone(523, 0, 0.15, 'triangle', 0.13);
        tone(659, 0.14, 0.25, 'triangle', 0.13);
      });
      buzz(40);
    },
    win() {
      play(() => {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.14));
        tone(1047, 0.5, 0.5, 'triangle', 0.14);
      });
      buzz([60, 40, 60, 40, 140]);
    },
  };
})();