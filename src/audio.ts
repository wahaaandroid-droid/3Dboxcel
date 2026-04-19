let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export async function resumeAudio(): Promise<void> {
  const c = getCtx();
  if (c?.state === "suspended") await c.resume();
}

function beep(freq: number, dur: number, type: OscillatorType, gain: number, freqEnd?: number): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function playMoveSound(): void {
  beep(220, 0.06, "triangle", 0.08, 160);
}

export function playMergeSound(): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(330, t0);
  osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.12);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.2);
}

export function playSpawnSound(): void {
  beep(520, 0.05, "square", 0.06, 780);
}
