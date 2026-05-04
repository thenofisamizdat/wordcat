/**
 * WordCat sound effects, generated at runtime with the WebAudio API.
 *
 * No asset files needed — every sound is a small synthesized blip with a
 * specific waveform/envelope/pitch profile so each event is distinguishable:
 *   tile           — short ascending pluck (you put a tile on the tray)
 *   untile         — short descending pluck (you took a tile back)
 *   click          — generic UI button click
 *   draw           — sweep up (card drawn)
 *   accept         — short major-arpeggio melody (good answer)
 *   reject         — descending minor-second blip (bad answer)
 *   timeout        — buzzer (turn timer ran out)
 *   gameover       — descending arpeggio (game ended)
 *
 * Call `play("tile")` from anywhere. First call lazily creates the AudioContext
 * (must happen after a user gesture; we don't preinitialise on page load).
 *
 * Mute state is persisted in localStorage as 'wordcat.muted'.
 */

const MUTE_KEY = "wordcat.muted";

let ctx = null;
function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Browsers suspend AudioContext until user gesture; resume eagerly.
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

export function isMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; }
  catch { return false; }
}

export function setMuted(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); }
  catch { /* ignore */ }
  window.dispatchEvent(new Event("wordcat:muted"));
}

export function toggleMuted() {
  setMuted(!isMuted());
  return isMuted();
}

/* ---------- low-level helpers ---------- */

// Single tone at frequency `freq` (Hz), duration `dur` (s), waveform `type`,
// peak gain `gain`, starting at `when` (audioContext time, default now).
function tone({ freq, dur = 0.12, type = "sine", gain = 0.18, when = 0, attack = 0.005, release = 0.05, c }) {
  const audio = c || getCtx();
  if (!audio) return;
  const t0 = audio.currentTime + when;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.linearRampToValueAtTime(gain * 0.7, t0 + Math.min(dur * 0.6, dur - release));
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(g).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Quick frequency sweep — useful for swooshes and buzzers.
function sweep({ from, to, dur = 0.18, type = "sawtooth", gain = 0.15, when = 0 }) {
  const audio = getCtx();
  if (!audio) return;
  const t0 = audio.currentTime + when;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(g).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Tiny burst of filtered noise (for clicks / clacks).
function noise({ dur = 0.05, gain = 0.18, when = 0, freq = 1200, q = 8 }) {
  const audio = getCtx();
  if (!audio) return;
  const t0 = audio.currentTime + when;
  const buffer = audio.createBuffer(1, Math.max(1, Math.ceil(audio.sampleRate * dur)), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const src = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const g = audio.createGain();
  src.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  src.connect(filter).connect(g).connect(audio.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/* ---------- the public sound palette ---------- */

const SOUNDS = {
  // Picking up a tile from the pool: bright wood-block 'tap' + slight upward pluck.
  tile: () => {
    noise({ freq: 2400, q: 12, dur: 0.04, gain: 0.18 });
    tone({ freq: 880, dur: 0.09, type: "triangle", gain: 0.14 });
  },
  // Removing a tile from the tray: lower-pitched companion to 'tile'.
  untile: () => {
    noise({ freq: 1600, q: 10, dur: 0.04, gain: 0.14 });
    tone({ freq: 520, dur: 0.09, type: "triangle", gain: 0.12 });
  },
  // Generic UI button click.
  click: () => {
    noise({ freq: 1800, q: 14, dur: 0.03, gain: 0.16 });
  },
  // Drawing a category card: short upward sweep.
  draw: () => {
    sweep({ from: 380, to: 920, dur: 0.22, type: "sine", gain: 0.14 });
  },
  // Successful submit: cheerful major arpeggio C-E-G-C.
  accept: () => {
    const c = getCtx();
    if (!c) return;
    const root = 523.25; // C5
    const ratios = [1, 5/4, 3/2, 2]; // major triad up to octave
    ratios.forEach((r, i) => {
      tone({ freq: root * r, dur: 0.16, type: "triangle", gain: 0.16, when: i * 0.07, c });
    });
    // sparkle on top
    tone({ freq: root * 4, dur: 0.18, type: "sine", gain: 0.06, when: 0.28, c });
  },
  // Rejected submit: descending minor-second 'eh-uh' blip.
  reject: () => {
    tone({ freq: 330, dur: 0.12, type: "square", gain: 0.12, when: 0 });
    tone({ freq: 247, dur: 0.18, type: "square", gain: 0.12, when: 0.10 });
  },
  // Per-turn timeout: buzzer.
  timeout: () => {
    sweep({ from: 220, to: 110, dur: 0.32, type: "sawtooth", gain: 0.16 });
  },
  // Whole-game over: descending major arpeggio.
  gameover: () => {
    const c = getCtx();
    if (!c) return;
    const notes = [659.25, 523.25, 392.00, 329.63]; // E5, C5, G4, E4
    notes.forEach((f, i) => {
      tone({ freq: f, dur: 0.22, type: "triangle", gain: 0.14, when: i * 0.13, c });
    });
  },
  // "Dud" — user tried a letter that's already been burned. Low filtered-noise
  // thunk + a flat low-pitched buzz; communicates an unavailable selection.
  dud: () => {
    noise({ freq: 320, q: 4, dur: 0.06, gain: 0.18 });
    tone({ freq: 180, dur: 0.18, type: "square", gain: 0.10 });
  },
};

export function play(name) {
  if (isMuted()) return;
  const fn = SOUNDS[name];
  if (!fn) return;
  try { fn(); } catch { /* ignore audio errors */ }
}
