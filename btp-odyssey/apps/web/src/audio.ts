/** Subtle UI audio — opt-in, never manipulative loops. */

let ctx: AudioContext | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (!enabled || typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  return ctx;
}

export function setAudioEnabled(on: boolean) {
  enabled = on;
  if (!on && ctx) void ctx.suspend();
  if (on && ctx?.state === "suspended") void ctx.resume();
}

export function isAudioEnabled() {
  return enabled;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.03,
  delay = 0,
) {
  const c = ac();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  click() {
    tone(520, 0.06, "triangle", 0.02);
  },
  hover() {
    tone(660, 0.04, "sine", 0.01);
  },
  success() {
    tone(523.25, 0.1, "sine", 0.04);
    tone(659.25, 0.12, "sine", 0.035, 0.08);
    tone(783.99, 0.18, "sine", 0.03, 0.16);
  },
  fail() {
    tone(200, 0.15, "triangle", 0.03);
    tone(160, 0.2, "sine", 0.02, 0.08);
  },
  unlock() {
    tone(440, 0.08, "sine", 0.03);
    tone(554, 0.1, "sine", 0.03, 0.07);
    tone(880, 0.2, "triangle", 0.025, 0.14);
  },
  launch() {
    tone(180, 0.25, "sawtooth", 0.015);
    tone(360, 0.2, "sine", 0.03, 0.05);
    tone(720, 0.25, "triangle", 0.02, 0.12);
  },
  tick() {
    tone(900, 0.03, "square", 0.008);
  },
};
