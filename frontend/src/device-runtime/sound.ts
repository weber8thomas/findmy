/**
 * A synthesized two-tone alert (no audio asset, and nothing borrowed from other products).
 * Browsers only allow audio after a user gesture: call `unlockAudio()` from a click handler.
 */

let ctx: AudioContext | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let loop: ReturnType<typeof setInterval> | null = null;

type DebugState = { playing: boolean; plays: number };
const debug: DebugState = { playing: false, plays: 0 };
(window as unknown as { __locusSound: DebugState }).__locusSound = debug;

function audioContext(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function unlockAudio() {
  const c = audioContext();
  if (c && c.state === "suspended") void c.resume();
}

export function audioReady(): boolean {
  return audioContext()?.state === "running";
}

function chirp(c: AudioContext, start: number, freq: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.6, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + 0.25);
}

function burst(c: AudioContext) {
  const t = c.currentTime + 0.01;
  chirp(c, t, 1318.5);
  chirp(c, t + 0.25, 1760);
  chirp(c, t + 0.5, 1318.5);
  chirp(c, t + 0.75, 1760);
}

/** Plays for `durationMs` or until `stopSound()`. Returns false if audio is blocked. */
export async function playSound(durationMs = 20_000): Promise<boolean> {
  stopSound();
  const c = audioContext();
  if (!c) return false;
  if (c.state !== "running") {
    try {
      await c.resume();
    } catch {
      /* blocked */
    }
  }
  if (c.state !== "running") return false;
  burst(c);
  loop = setInterval(() => burst(c), 1500);
  navigator.vibrate?.([300, 150, 300, 150, 300]);
  debug.playing = true;
  debug.plays += 1;
  stopTimer = setTimeout(stopSound, durationMs);
  return true;
}

export function stopSound() {
  if (loop) clearInterval(loop);
  if (stopTimer) clearTimeout(stopTimer);
  loop = stopTimer = null;
  debug.playing = false;
  navigator.vibrate?.(0);
}
