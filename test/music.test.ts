import { describe, expect, it } from "vitest";
import { beatLength, encodeWav, renderSoundtrack } from "../src/music.js";

const scenes = [
  { start: 0, travel: 0 },
  { start: 3.5, travel: 1 },
  { start: 6.5, travel: 1 },
  { start: 9.5, travel: 0.8 },
];

const rms = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("renderSoundtrack", () => {
  for (const style of ["upbeat", "calm"] as const) {
    it(`${style}: fills the video, stays below clipping, ends quietly`, () => {
      const track = renderSoundtrack({ style, sfx: true, duration: 12.5, scenes, sampleRate: 22050 });
      const sr = track.sampleRate;
      expect(track.left.length).toBe(Math.ceil(12.5 * sr));
      expect(peak(track.left)).toBeLessThan(0.9);
      expect(peak(track.right)).toBeLessThan(0.9);
      // Sound all the way through, not just at the start.
      for (let t = 0.5; t < 11.5; t += 1) expect(rms(track.left, Math.round(t * sr), Math.round((t + 1) * sr))).toBeGreaterThan(0.01);
      // Faded out at the very end.
      expect(Math.abs(track.left[track.left.length - 1]!)).toBeLessThan(0.01);
    });
  }

  it("brings the drums in at the first cut", () => {
    const track = renderSoundtrack({ style: "upbeat", sfx: false, duration: 12.5, scenes, sampleRate: 22050 });
    const sr = track.sampleRate;
    const before = rms(track.left, Math.round(2.2 * sr), Math.round(3.4 * sr));
    const after = rms(track.left, Math.round(3.5 * sr), Math.round(4.7 * sr));
    expect(after).toBeGreaterThan(before * 1.4);
  });

  it("is the same every time", () => {
    const a = renderSoundtrack({ style: "calm", sfx: true, duration: 6, scenes: scenes.slice(0, 2), sampleRate: 22050 });
    const b = renderSoundtrack({ style: "calm", sfx: true, duration: 6, scenes: scenes.slice(0, 2), sampleRate: 22050 });
    expect(a.left).toEqual(b.left);
  });

  it("can be whooshes only", () => {
    const track = renderSoundtrack({ style: "none", sfx: true, duration: 8, scenes, sampleRate: 22050 });
    const sr = track.sampleRate;
    expect(rms(track.left, 0, Math.round(3 * sr))).toBe(0);
    expect(rms(track.left, Math.round(3.5 * sr), Math.round(4.5 * sr))).toBeGreaterThan(0.005);
  });

  it("handles a single short scene", () => {
    const track = renderSoundtrack({ style: "upbeat", sfx: true, duration: 2, scenes: [{ start: 0, travel: 0 }], sampleRate: 22050 });
    expect(peak(track.left)).toBeGreaterThan(0.05);
    expect(peak(track.left)).toBeLessThan(0.9);
  });
});

describe("beatLength", () => {
  it("matches each style's tempo", () => {
    expect(beatLength("upbeat")).toBeCloseTo(0.5);
    expect(beatLength("calm")).toBeCloseTo(60 / 90);
    expect(beatLength("none")).toBeUndefined();
  });
});

describe("encodeWav", () => {
  it("writes a float stereo WAV", () => {
    const track = renderSoundtrack({ style: "none", sfx: false, duration: 0.1, scenes: [{ start: 0, travel: 0 }], sampleRate: 8000 });
    const wav = encodeWav(track);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt16LE(20)).toBe(3);
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.length).toBe(44 + 800 * 8);
  });
});
