/**
 * Cues for taking boxes in by scanner without watching the screen: a rising
 * two-note chime when a box is saved, a low double buzz when something stops
 * the worker (a repeated serial, a refused save or paste). Web Audio tones,
 * no sound files. On by default; muting is per browser (localStorage) and
 * read through useSyncExternalStore, so the server render never guesses it.
 */
const KEY = "intake-sound";
const listeners = new Set<() => void>();
let audio: AudioContext | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage blocked: the toggle still applies until the page reloads
  }
  listeners.forEach((l) => l());
}

export function subscribeSound(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

function tone(ctx: AudioContext, freq: number, at: number, length: number, type: OscillatorType, volume: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // A short attack and an exponential tail: no click at either end.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

export function playCue(kind: "ok" | "error"): void {
  if (!soundOn()) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const t = audio.currentTime + 0.01;
    if (kind === "ok") {
      tone(audio, 880, t, 0.09, "sine", 0.18);
      tone(audio, 1320, t + 0.1, 0.14, "sine", 0.18);
    } else {
      tone(audio, 196, t, 0.14, "square", 0.08);
      tone(audio, 196, t + 0.2, 0.14, "square", 0.08);
    }
  } catch {
    // no audio device or Web Audio: the screen still says it all
  }
}
