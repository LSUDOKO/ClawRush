// Synthesized arcade sounds (Web Audio, no samples) + haptics.
let ctx: AudioContext | null = null;
let muted = typeof localStorage !== "undefined" && localStorage.getItem("clawrush.muted") === "1";
export const isMuted = () => muted;
export function setMuted(m: boolean) { muted = m; localStorage.setItem("clawrush.muted", m ? "1" : "0"); }
function ac() {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
function tone(freq: number, dur: number, type: OscillatorType = "square", gain = 0.06, at = 0, slideTo?: number) {
  if (muted) return;
  const a = ac(), t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const buzz = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
export const sfx = {
  whirr: () => tone(110, 0.08, "sawtooth", 0.025, 0, 140),
  servo: () => tone(220, 0.6, "triangle", 0.04, 0, 90),
  clink: () => { tone(1800, 0.08, "square", 0.05); tone(2400, 0.06, "square", 0.04, 0.05); buzz(20); },
  drumroll: () => { for (let i = 0; i < 14; i++) tone(90 + (i % 2) * 20, 0.05, "square", 0.04, i * 0.05); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "square", 0.06, i * 0.11)); buzz([40, 40, 120]); },
  slip: () => { tone(392, 0.25, "triangle", 0.06, 0, 196); tone(330, 0.35, "triangle", 0.05, 0.2, 150); buzz(60); },
  miss: () => tone(160, 0.3, "sawtooth", 0.04, 0, 80),
  coin: () => { tone(988, 0.07, "square", 0.05); tone(1319, 0.2, "square", 0.05, 0.07); },
  turn: () => { tone(660, 0.1, "square", 0.05); tone(880, 0.14, "square", 0.05, 0.1); buzz(30); },
};
