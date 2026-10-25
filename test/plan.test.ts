import { describe, expect, it } from "vitest";
import { resolveConfig, type PartialConfig } from "../src/config.js";
import { autoScenes, cameraAt, planVideo, PlanError, type ScanResult } from "../src/plan.js";

const VIEWPORT = 800;
const VISIBLE = 700;

function scanOf(tops: number[], pageHeight = 6000, extra: Partial<ScanResult> = {}): ScanResult {
  return {
    url: "https://example.com/",
    title: "Example",
    lang: "en",
    dir: "ltr",
    pageHeight,
    viewport: { width: 1280, height: VIEWPORT },
    sections: tops.map((top, i) => ({
      index: i + 1,
      name: `Section ${i + 1}`,
      caption: `Caption ${i + 1}`,
      top,
      height: 600,
      selector: `#s${i + 1}`,
      kind: i === 0 ? "hero" : i === tops.length - 1 ? "footer" : "section",
    })),
    ...extra,
  };
}

function plan(scan: ScanResult, config: Omit<PartialConfig, "url"> = {}, audioDuration?: number) {
  return planVideo({
    scan,
    config: resolveConfig({ url: "example.com", ...config }),
    viewportHeight: VIEWPORT,
    visibleHeight: VISIBLE,
    audioDuration,
  });
}

describe("autoScenes", () => {
  it("skips the footer and sections too close together", () => {
    const scan = scanOf([0, 900, 1000, 2000, 3000, 5500]);
    expect(autoScenes(scan, 10, VISIBLE).map((s) => s.section)).toEqual([1, 2, 4, 5]);
  });

  it("stops at the limit", () => {
    const scan = scanOf([0, 900, 1800, 2700, 3600, 4500, 5500]);
    expect(autoScenes(scan, 3, VISIBLE)).toHaveLength(3);
  });
});

describe("planVideo", () => {
  it("opens on a zoom and scrolls through the rest", () => {
    const p = plan(scanOf([60, 1200, 2400, 5500]));
    expect(p.scenes.map((s) => s.camera)).toEqual(["zoom", "scroll", "scroll"]);
    // The first scene starts at the very top, so the site's header is visible.
    expect(p.scenes[0]!.fromY).toBe(0);
    expect(p.scenes[1]!.fromY).toBe(1200);
    expect(p.scenes[1]!.toY).toBeGreaterThan(1200);
    expect(p.total).toBeCloseTo(3.4 + 3 + 3, 3);
  });

  it("starts sections below a sticky header", () => {
    const p = plan(scanOf([0, 1200, 2400, 5500], 6000, { stickyTop: 64 }));
    expect(p.scenes[1]!.fromY).toBe(1136);
  });

  it("never scrolls past the end of the page", () => {
    const p = plan(scanOf([0, 1500, 3400], 3600), { scenes: [{ section: 1 }, { section: 3 }] });
    expect(p.scenes[1]!.fromY).toBe(3600 - VIEWPORT);
    expect(p.scenes[1]!.toY).toBe(3600 - VIEWPORT);
    // With nowhere to scroll, the scene pushes in instead.
    expect(p.scenes[1]!.zoomTo).toBeGreaterThan(1);
  });

  it("uses scene settings from the config", () => {
    const p = plan(scanOf([0, 1200, 2400, 5500]), {
      scenes: [{ section: 3, caption: "Pricing", duration: 5, camera: "hold" }],
    });
    expect(p.scenes).toHaveLength(1);
    expect(p.scenes[0]).toMatchObject({ caption: "Pricing", duration: 5, camera: "hold", fromY: 2400, toY: 2400 });
  });

  it("hides captions when they are turned off", () => {
    const p = plan(scanOf([0, 1200, 5500]), { captions: { enabled: false } });
    expect(p.scenes.every((s) => s.caption === "")).toBe(true);
  });

  it("fits the scenes to the audio", () => {
    const p = plan(scanOf([0, 1200, 2400, 5500]), { fitToAudio: true }, 20);
    expect(p.total).toBeCloseTo(20, 2);
  });

  it("snaps scene lengths to the music's beat", () => {
    const p = planVideo({
      scan: scanOf([0, 1200, 2400, 5500]),
      config: resolveConfig({ url: "example.com" }),
      viewportHeight: VIEWPORT,
      visibleHeight: VISIBLE,
      beat: 0.5,
    });
    expect(p.scenes.map((s) => s.duration)).toEqual([3.5, 3, 3]);
    for (const s of p.scenes) expect((s.start / 0.5) % 1).toBe(0);
  });

  it("explains a missing section", () => {
    expect(() => plan(scanOf([0, 1200]), { scenes: [{ section: 9 }] })).toThrow(PlanError);
  });
});

describe("cameraAt", () => {
  const p = plan(scanOf([0, 1200, 2400, 3600, 5500]));

  it("moves smoothly, with no jumps between frames", () => {
    let prev = cameraAt(p, 0);
    for (let t = 1 / 30; t < p.total; t += 1 / 30) {
      const cam = cameraAt(p, t);
      expect(Math.abs(cam.y - prev.y)).toBeLessThan(80);
      expect(Math.abs(cam.zoom - prev.zoom)).toBeLessThan(0.03);
      prev = cam;
    }
  });

  it("fades in and out at the ends", () => {
    expect(cameraAt(p, 0).cover).toBe(1);
    expect(cameraAt(p, 1).cover).toBe(0);
    expect(cameraAt(p, p.total).cover).toBe(1);
  });

  it("arrives at each scene's start position after travelling", () => {
    const scene = p.scenes[2]!;
    expect(cameraAt(p, scene.start + scene.travel).y).toBeCloseTo(scene.fromY, 0);
  });
});
