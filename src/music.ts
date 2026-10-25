/**
 * A soundtrack composed for each video, in code.
 *
 * Nothing is sampled or licensed: every sound is synthesized here, so videos can be
 * posted anywhere without copyright claims. The music follows the edit. Scene
 * changes land on the beat, the drums come in at the first cut, each camera move
 * gets a whoosh, and the track ends on a final hit instead of being cut off.
 */

export const MUSIC_STYLES = ["upbeat", "calm", "none"] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];

interface Chord {
  /** MIDI note of the bass. */
  bass: number;
  /** MIDI notes of the pad, low to high. */
  pad: number[];
}

interface Style {
  bpm: number;
  /** One chord per bar, looping. The first chord is home: the track ends on it. */
  chords: Chord[];
  drums: "band" | "shaker";
  bass: "pulse" | "hold";
  arp: { perBeat: number; decay: number; pattern: number[]; level: number };
  pad: { attack: number; cutoff: number; level: number };
  sidechain: number;
}

const STYLES: Record<Exclude<MusicStyle, "none">, Style> = {
  // Bright pop in C: I, V, vi, IV with added colour notes.
  upbeat: {
    bpm: 120,
    chords: [
      { bass: 48, pad: [60, 64, 67, 74] }, // C add9
      { bass: 43, pad: [59, 62, 67, 69] }, // G add9 / B
      { bass: 45, pad: [60, 64, 67, 69] }, // A minor 7
      { bass: 41, pad: [60, 65, 67, 69] }, // F add9
    ],
    drums: "band",
    bass: "pulse",
    arp: { perBeat: 2, decay: 0.2, pattern: [0, 1, 2, 3, 2, 1, 3, 2], level: 0.2 },
    pad: { attack: 0.06, cutoff: 2200, level: 0.075 },
    sidechain: 0.5,
  },
  // Soft and warm: a slow walk down from F major 7 to C major 9.
  calm: {
    bpm: 90,
    chords: [
      { bass: 48, pad: [55, 59, 64, 74] }, // C major 9
      { bass: 53, pad: [57, 60, 64, 67] }, // F major 9
      { bass: 52, pad: [55, 59, 62, 67] }, // E minor 7
      { bass: 50, pad: [53, 57, 60, 64] }, // D minor 9
    ],
    drums: "shaker",
    bass: "hold",
    arp: { perBeat: 1, decay: 0.55, pattern: [0, 2, 1, 3, 2, 1], level: 0.22 },
    pad: { attack: 0.35, cutoff: 1500, level: 0.085 },
    sidechain: 0,
  },
};

/** Length of one beat in seconds, or undefined when there's no music. */
export function beatLength(style: MusicStyle): number | undefined {
  return style === "none" ? undefined : 60 / STYLES[style].bpm;
}

export interface SoundtrackOptions {
  style: MusicStyle;
  /** Whooshes on camera moves. */
  sfx: boolean;
  /** Video length in seconds. */
  duration: number;
  /** When each scene starts and how long the camera travels into it. */
  scenes: { start: number; travel: number }[];
  sampleRate?: number;
}

export interface Soundtrack {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

const TAU = Math.PI * 2;
/** Bass notes sit between E2 and E3, low enough to feel and high enough for phone speakers. */
const bassNote = (chord: Chord) => 40 + ((((chord.bass - 40) % 12) + 12) % 12);
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Small seeded random generator, so the same video always gets the same sound. */
function random(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad filter. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private type: "lowpass" | "highpass" | "bandpass",
    private sr: number,
    freq: number,
    q = 0.707,
  ) {
    this.set(freq, q);
  }

  set(freq: number, q = 0.707) {
    const f = Math.min(Math.max(freq, 10), this.sr * 0.45);
    const w = (TAU * f) / this.sr;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    let b0: number, b1: number, b2: number;
    if (this.type === "lowpass") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (this.type === "highpass") {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Band-limited sawtooth (PolyBLEP), so high notes don't alias into harshness. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Freeverb-style stereo reverb. */
function reverb(inL: Float32Array, inR: Float32Array, sr: number, room = 0.84, damp = 0.3): [Float32Array, Float32Array] {
  const scale = sr / 44100;
  const combSizes = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpassSizes = [556, 441, 341, 225];
  const make = (spread: number) => ({
    combs: combSizes.map((s) => ({ buf: new Float32Array(Math.round((s + spread) * scale)), i: 0, f: 0 })),
    alls: allpassSizes.map((s) => ({ buf: new Float32Array(Math.round((s + spread) * scale)), i: 0 })),
  });
  const chans = [make(0), make(23)];
  const n = inL.length;
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const x = (inL[i]! + inR[i]!) * 0.015;
    for (let c = 0; c < 2; c++) {
      const ch = chans[c]!;
      let sum = 0;
      for (const comb of ch.combs) {
        const y = comb.buf[comb.i]!;
        comb.f = y * (1 - damp) + comb.f * damp;
        comb.buf[comb.i] = x + comb.f * room;
        if (++comb.i >= comb.buf.length) comb.i = 0;
        sum += y;
      }
      for (const ap of ch.alls) {
        const b = ap.buf[ap.i]!;
        ap.buf[ap.i] = sum + b * 0.5;
        sum = b - sum;
        if (++ap.i >= ap.buf.length) ap.i = 0;
      }
      out[c]![i] = sum;
    }
  }
  return out;
}

/** Writes the soundtrack for a video. */
export function renderSoundtrack(opts: SoundtrackOptions): Soundtrack {
  const sr = opts.sampleRate ?? 44100;
  const n = Math.max(1, Math.ceil(opts.duration * sr));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rand = random(7);

  if (opts.style !== "none") composeMusic(STYLES[opts.style], opts, sr, L, R, rand);
  if (opts.sfx) addWhooshes(opts, sr, L, R, rand);
  // Music is brought to a steady level. Whooshes alone keep a fixed level, so they sit
  // under your own audio instead of being turned up to fill the silence between them.
  master(L, R, sr, opts.style === "upbeat" ? 0.2 : opts.style === "calm" ? 0.15 : undefined);
  return { sampleRate: sr, left: L, right: R };
}

function composeMusic(
  style: Style,
  opts: SoundtrackOptions,
  sr: number,
  outL: Float32Array,
  outR: Float32Array,
  rand: () => number,
) {
  const n = outL.length;
  const duration = opts.duration;
  const beat = 60 / style.bpm;
  const bar = beat * 4;

  // The beat drops at the first cut. Everything is counted from there, so earlier
  // bars lead into it (the bar just before the drop is the last chord of the loop).
  const drop = opts.scenes.length > 1 ? opts.scenes[1]!.start : 0;
  const snap = (t: number) => drop + Math.round((t - drop) / beat) * beat;

  // The final hit: the last strong beat that leaves about a second to ring out.
  let end = snap(duration - 1.05);
  while (end > duration - 0.95) end -= beat;
  while (end > drop && (Math.round((end - drop) / beat) % 2 + 2) % 2 !== 0) end -= beat;
  if (end <= drop + beat) end = Math.max(beat, duration - 1); // very short videos

  const chordAt = (t: number) => {
    if (t >= end - 1e-6) return style.chords[0]!;
    const index = Math.floor((t - drop) / bar + 1e-6);
    return style.chords[((index % style.chords.length) + style.chords.length) % style.chords.length]!;
  };

  // Chord segments: bar lines (counted from the drop), plus the final hit.
  const cuts = new Set<number>([0, end]);
  for (let t = drop; t < end; t += bar) cuts.add(t);
  for (let t = drop - bar; t > 0; t -= bar) cuts.add(t);
  const times = [...cuts].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);
  const segments = times.map((start, i) => ({ start, stop: times[i + 1] ?? duration, chord: chordAt(start + 1e-3) }));

  // Buses.
  const padL = new Float32Array(n);
  const padR = new Float32Array(n);
  const arpL = new Float32Array(n);
  const arpR = new Float32Array(n);
  const bass = new Float32Array(n);
  const drumL = new Float32Array(n);
  const drumR = new Float32Array(n);
  const sendL = new Float32Array(n);
  const sendR = new Float32Array(n);
  const duck = new Float32Array(n).fill(1);

  const at = (t: number) => Math.max(0, Math.min(n, Math.round(t * sr)));

  // Pad: two detuned saws per note (one per side) plus a sine for warmth.
  for (const seg of segments) {
    const isLast = seg.start >= end - 1e-6;
    const release = isLast ? 0.2 : 0.35;
    const i0 = at(seg.start);
    const i1 = at(seg.stop + release);
    const len = seg.stop - seg.start;
    for (const note of seg.chord.pad) {
      const f = mtof(note);
      const fl = f * Math.pow(2, -7 / 1200);
      const fr = f * Math.pow(2, 7 / 1200);
      let pl = rand();
      let pr = rand();
      let ps = 0;
      for (let i = i0; i < i1; i++) {
        const t = i / sr - seg.start;
        let env = Math.min(1, t / style.pad.attack);
        if (t > len) env *= Math.max(0, 1 - (t - len) / release);
        if (isLast) env *= Math.exp(-t / 1.6);
        const sawL = 2 * pl - 1 - blep(pl, fl / sr);
        const sawR = 2 * pr - 1 - blep(pr, fr / sr);
        const sine = Math.sin(TAU * ps);
        padL[i] = padL[i]! + (env * (sawL * 0.55 + sine * 0.45));
        padR[i] = padR[i]! + (env * (sawR * 0.55 + sine * 0.45));
        pl += fl / sr;
        if (pl >= 1) pl -= 1;
        pr += fr / sr;
        if (pr >= 1) pr -= 1;
        ps += f / sr;
        if (ps >= 1) ps -= 1;
      }
    }
  }
  // Filter the pad; it opens up over the intro.
  {
    const lpL = new Biquad("lowpass", sr, 900, 0.6);
    const lpR = new Biquad("lowpass", sr, 900, 0.6);
    const openBy = Math.max(drop, bar);
    for (let i = 0; i < n; i++) {
      if (i % 32 === 0) {
        const t = i / sr;
        const p = Math.min(1, t / openBy);
        const cutoff = 900 * Math.pow(style.pad.cutoff / 900, p * p * (3 - 2 * p));
        lpL.set(cutoff, 0.6);
        lpR.set(cutoff, 0.6);
      }
      padL[i] = lpL.process(padL[i]!) * style.pad.level;
      padR[i] = lpR.process(padR[i]!) * style.pad.level;
    }
  }

  // Arpeggio: a soft mallet tone cycling through the chord an octave up.
  {
    const step = beat / style.arp.perBeat;
    const first = Math.ceil((0 - drop) / step - 1e-6);
    for (let k = first; ; k++) {
      const t0 = drop + k * step;
      if (t0 >= end - 1e-6) break;
      if (t0 < 0) continue;
      const chord = chordAt(t0 + 1e-3);
      const note = chord.pad[style.arp.pattern[((k % style.arp.pattern.length) + style.arp.pattern.length) % style.arp.pattern.length]!]! + 12;
      const f = mtof(note);
      // Quieter before the drop, then full.
      const vel = (t0 < drop ? 0.85 : 1) * (k % 2 === 0 ? 1 : 0.78) * style.arp.level;
      const pan = (k % 4) / 3 - 0.5;
      const i0 = at(t0);
      const i1 = at(t0 + style.arp.decay * 6);
      for (let i = i0; i < i1; i++) {
        const t = i / sr - t0;
        const env = Math.min(1, t / 0.003) * Math.exp(-t / style.arp.decay);
        const v =
          vel *
          env *
          (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.06) + 0.12 * Math.sin(TAU * 3 * f * t) * Math.exp(-t / 0.035));
        arpL[i] = arpL[i]! + (v * (0.5 - pan * 0.5));
        arpR[i] = arpR[i]! + (v * (0.5 + pan * 0.5));
      }
    }
    // Ping-pong delay, a dotted eighth.
    const d = Math.round(beat * 0.75 * sr);
    const bl = new Float32Array(d);
    const br = new Float32Array(d);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const dl = bl[j]!;
      const dr = br[j]!;
      bl[j] = (arpL[i]! + arpR[i]!) * 0.5 + dr * 0.35;
      br[j] = dl * 0.35;
      arpL[i] = arpL[i]! + (dl * 0.32);
      arpR[i] = arpR[i]! + (dr * 0.32);
      if (++j >= d) j = 0;
    }
  }

  // Bass: rounded sine with a little drive so it still reads on phone speakers.
  {
    const notes: { t0: number; len: number; note: number; vel: number }[] = [];
    if (style.bass === "pulse") {
      const startK = Math.ceil((0 - drop) / (beat / 2) - 1e-6);
      for (let k = startK; ; k++) {
        const t0 = drop + (k * beat) / 2;
        if (t0 >= end - 1e-6) break;
        if (t0 < drop) continue; // the pulse starts at the drop
        notes.push({ t0, len: beat * 0.42, note: bassNote(chordAt(t0 + 1e-3)), vel: k % 2 === 0 ? 1 : 0.8 });
      }
      // Before the drop: soft held notes, so the opening has some body.
      for (const seg of segments) if (seg.stop <= drop + 1e-6) notes.push({ t0: seg.start, len: seg.stop - seg.start - 0.02, note: bassNote(seg.chord), vel: 0.5 });
    } else {
      for (const seg of segments) if (seg.start < end - 1e-6) notes.push({ t0: seg.start, len: seg.stop - seg.start, note: bassNote(seg.chord), vel: seg.start < drop ? 0.6 : 1 });
    }
    notes.push({ t0: end, len: duration - end, note: bassNote(style.chords[0]!), vel: 1.1 });
    for (const b of notes) {
      const f = mtof(b.note);
      const i0 = at(b.t0);
      const rel = 0.04;
      const i1 = at(b.t0 + b.len + rel);
      const isLast = b.t0 >= end - 1e-6;
      let ph = 0;
      for (let i = i0; i < i1; i++) {
        const t = i / sr - b.t0;
        let env = Math.min(1, t / (style.bass === "hold" ? 0.08 : 0.006));
        if (t > b.len) env *= Math.max(0, 1 - (t - b.len) / rel);
        if (isLast) env *= Math.exp(-t / 0.9);
        const s = Math.sin(TAU * ph) + 0.35 * Math.sin(2 * TAU * ph) + 0.12 * Math.sin(3 * TAU * ph);
        bass[i] = bass[i]! + (b.vel * env * Math.tanh(s * 1.8) * 0.26);
        ph += f / sr;
        if (ph >= 1) ph -= 1;
      }
    }
    const lp = new Biquad("lowpass", sr, style.bass === "hold" ? 500 : 900, 0.7);
    for (let i = 0; i < n; i++) bass[i] = lp.process(bass[i]!);
  }

  // Drums.
  const kick = (t0: number, vel: number) => {
    const i0 = at(t0);
    const i1 = at(t0 + 0.75);
    let ph = 0;
    for (let i = i0; i < i1; i++) {
      const t = i / sr - t0;
      const f = 56 + 120 * Math.exp(-t / 0.03);
      ph += f / sr;
      const body = Math.sin(TAU * ph) * Math.exp(-t / 0.13);
      const click = (rand() * 2 - 1) * Math.exp(-t / 0.0025) * 0.25;
      const v = vel * Math.tanh((body + click) * 1.4) * 0.62;
      drumL[i] = drumL[i]! + (v);
      drumR[i] = drumR[i]! + (v);
    }
    if (style.sidechain > 0) {
      const j1 = at(t0 + 0.4);
      for (let i = i0; i < j1; i++) {
        const t = i / sr - t0;
        duck[i] = Math.min(duck[i]!, 1 - style.sidechain * vel * Math.exp(-t / 0.11));
      }
    }
  };
  const noiseHit = (t0: number, dur: number, decay: number, filter: Biquad, gain: number, toSend = 0, pan = 0) => {
    const i0 = at(t0);
    const i1 = at(t0 + dur);
    for (let i = i0; i < i1; i++) {
      const t = i / sr - t0;
      const v = filter.process(rand() * 2 - 1) * Math.exp(-t / decay) * gain;
      drumL[i] = drumL[i]! + (v * (1 - pan) );
      drumR[i] = drumR[i]! + (v * (1 + pan));
      sendL[i] = sendL[i]! + (v * toSend);
      sendR[i] = sendR[i]! + (v * toSend);
    }
  };
  const clap = (t0: number) => {
    const bp = new Biquad("bandpass", sr, 1300, 0.9);
    for (const off of [0, 0.011, 0.022]) noiseHit(t0 + off, 0.012, 0.004, bp, 0.5, 0.4);
    noiseHit(t0 + 0.03, 0.3, 0.07, bp, 0.55, 0.6);
  };
  const hat = (t0: number, vel: number, open = false) => {
    const hp = new Biquad("highpass", sr, 7500, 0.7);
    noiseHit(t0, open ? 0.35 : 0.06, open ? 0.09 : 0.016, hp, 0.16 * vel, 0.05, (rand() - 0.5) * 0.3);
  };
  const shaker = (t0: number, vel: number) => {
    const bp = new Biquad("bandpass", sr, 6500, 1.2);
    noiseHit(t0, 0.09, 0.025, bp, 0.3 * vel, 0.1, 0.2);
  };
  const crash = (t0: number, vel: number) => {
    const hp = new Biquad("highpass", sr, 4500, 0.6);
    noiseHit(t0, 2.4, 0.55, hp, 0.14 * vel, 0.3);
  };

  const beatsFrom = Math.ceil((0 - drop) / (beat / 2) - 1e-6);
  for (let k = beatsFrom; ; k++) {
    const t = drop + (k * beat) / 2;
    if (t >= end - 1e-6) break;
    if (t < 0) continue;
    const pos = (((k / 2) % 4) + 4) % 4; // position in the bar, in beats
    const barNo = Math.floor(k / 8);
    if (style.drums === "band") {
      if (t < drop) {
        // The intro keeps time with quiet hats only.
        if (t >= drop - bar * 2) hat(t, pos % 1 === 0.5 ? 0.6 : 0.3);
        continue;
      }
      if (pos === 0 || pos === 2 || (pos === 2.5 && barNo % 2 === 1)) kick(t, pos === 2.5 ? 0.75 : 1);
      if (pos === 1 || pos === 3) clap(t);
      hat(t, pos % 1 === 0.5 ? 1 : 0.55, pos === 3.5 && barNo % 2 === 1);
    } else {
      // Calm: a shaker with a little swing, and a soft heartbeat kick once the music settles.
      const swing = pos % 1 === 0.5 ? beat * 0.06 : 0;
      shaker(t + swing, (pos % 1 === 0.5 ? 0.8 : 0.5) * (t < drop ? 0.5 : 1));
      if (t >= drop && pos === 0) kick(t, 0.35);
    }
  }

  // Into the drop: a short noise swell. At the drop and at the end: a crash.
  if (drop > beat * 2 && style.drums === "band") {
    const t0 = drop - beat * 2;
    const hp = new Biquad("highpass", sr, 2000, 0.7);
    const i0 = at(t0);
    const i1 = at(drop);
    for (let i = i0; i < i1; i++) {
      const p = (i / sr - t0) / (beat * 2);
      if (i % 32 === 0) hp.set(1500 * Math.pow(5, p), 0.7);
      const v = hp.process(rand() * 2 - 1) * p * p * p * 0.18;
      drumL[i] = drumL[i]! + (v);
      drumR[i] = drumR[i]! + (v);
    }
  }
  if (style.drums === "band" && drop > 0) crash(drop, 0.7);
  if (end < duration) {
    kick(end, style.drums === "band" ? 1 : 0.5);
    crash(end, style.drums === "band" ? 1 : 0.5);
  }

  // Reverb send from the pad and arpeggio.
  for (let i = 0; i < n; i++) {
    sendL[i] = sendL[i]! + (padL[i]! * 0.5 + arpL[i]! * 0.45);
    sendR[i] = sendR[i]! + (padR[i]! * 0.5 + arpR[i]! * 0.45);
  }
  const [wetL, wetR] = reverb(sendL, sendR, sr, style.drums === "band" ? 0.82 : 0.88);

  for (let i = 0; i < n; i++) {
    const d = duck[i]!;
    outL[i] = outL[i]! + ((padL[i]! + arpL[i]!) * d + bass[i]! * d + drumL[i]! + wetL[i]! * 0.9);
    outR[i] = outR[i]! + ((padR[i]! + arpR[i]!) * d + bass[i]! * d + drumR[i]! + wetR[i]! * 0.9);
  }
}

/** A filtered-noise whoosh on every camera move, peaking where the camera moves fastest. */
function addWhooshes(opts: SoundtrackOptions, sr: number, L: Float32Array, R: Float32Array, rand: () => number) {
  const n = L.length;
  opts.scenes.forEach((scene, index) => {
    if (index === 0 || scene.travel < 0.15) return;
    const t0 = Math.max(0, scene.start - 0.08);
    const len = scene.travel + 0.45;
    const peak = 0.08 + scene.travel * 0.5;
    const bp = new Biquad("bandpass", sr, 400, 1.1);
    const i0 = Math.round(t0 * sr);
    const i1 = Math.min(n, Math.round((t0 + len) * sr));
    const dir = index % 2 === 0 ? 1 : -1;
    for (let i = i0; i < i1; i++) {
      const t = i / sr - t0;
      const x = t / peak;
      const env = t < peak ? x * x * (3 - 2 * x) : Math.exp(-(t - peak) / 0.16);
      if (i % 32 === 0) bp.set(350 * Math.pow(7, t < peak ? x : Math.exp(-(t - peak) / 0.25)), 1.1);
      const v = bp.process(rand() * 2 - 1) * env * 0.6;
      const pan = dir * (Math.min(1, t / len) - 0.5) * 0.8;
      L[i] = L[i]! + (v * (1 - pan));
      R[i] = R[i]! + (v * (1 + pan));
    }
  });
}

/**
 * Clean up the low end, bring the track to a steady level (about -14 LUFS, what
 * Instagram, TikTok and YouTube play at), round off the loudest peaks, fade the edges.
 */
function master(L: Float32Array, R: Float32Array, sr: number, targetRms?: number) {
  const n = L.length;
  const hpL = new Biquad("highpass", sr, 32, 0.7);
  const hpR = new Biquad("highpass", sr, 32, 0.7);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    L[i] = hpL.process(L[i]!);
    R[i] = hpR.process(R[i]!);
    sum += L[i]! * L[i]! + R[i]! * R[i]!;
  }
  const rms = Math.sqrt(sum / (2 * n));
  if (rms < 1e-7) return;
  const gain = targetRms ? targetRms / rms : 1;
  // Soft knee: untouched below the knee, smoothly limited above it.
  const knee = 0.55;
  const limit = (x: number) => {
    const a = Math.abs(x);
    if (a <= knee) return x;
    return Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  };
  const fadeIn = Math.round(0.02 * sr);
  const fadeOut = Math.round(Math.min(0.6, n / sr / 4) * sr);
  for (let i = 0; i < n; i++) {
    let g = 0.89;
    if (i < fadeIn) g *= i / fadeIn;
    if (i > n - fadeOut) g *= 0.5 + 0.5 * Math.cos((Math.PI * (i - (n - fadeOut))) / fadeOut);
    L[i] = limit(L[i]! * gain) * g;
    R[i] = limit(R[i]! * gain) * g;
  }
}

/** 32-bit float WAV, which ffmpeg reads directly. */
export function encodeWav(track: Soundtrack): Buffer {
  const n = track.left.length;
  const dataBytes = n * 2 * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(track.sampleRate, 24);
  buf.writeUInt32LE(track.sampleRate * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(track.left[i]!, o);
    buf.writeFloatLE(track.right[i]!, o + 4);
    o += 8;
  }
  return buf;
}
