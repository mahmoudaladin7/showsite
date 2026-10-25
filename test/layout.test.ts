import { describe, expect, it } from "vitest";
import { FORMATS, FRAMES } from "../src/config.js";
import { computeLayout, visibleSiteHeight } from "../src/layout.js";

describe("computeLayout", () => {
  for (const format of FORMATS) {
    for (const frame of FRAMES) {
      it(`${format} in a ${frame} frame fits the video`, () => {
        const L = computeLayout(format, frame);
        expect(L.css.width * 2).toBe(L.output.width);
        expect(L.css.height * 2).toBe(L.output.height);
        // Nothing sticks out at the sides.
        expect(L.screen.x).toBeGreaterThanOrEqual(0);
        expect(L.screen.x + L.screen.width).toBeLessThanOrEqual(L.css.width);
        // The caption sits above the site.
        expect(L.caption.top + L.caption.height).toBeLessThanOrEqual(L.screen.y);
        // The site fills the screen width exactly.
        expect(L.site.width * L.site.scale).toBeCloseTo(L.screen.width, 5);
        expect(visibleSiteHeight(L)).toBeGreaterThan(200);
      });
    }
  }

  it("gives phones a mobile viewport and a status bar", () => {
    const L = computeLayout("9:16", "phone");
    expect(L.site.mobile).toBe(true);
    expect(L.site.width).toBe(390);
    expect(L.screen.statusBar).toBeGreaterThan(0);
    expect(L.frame.y + L.frame.height).toBeLessThanOrEqual(L.css.height);
  });

  it("shows desktop sites at laptop width in a browser frame", () => {
    const L = computeLayout("16:9", "browser");
    expect(L.site.mobile).toBe(false);
    expect(L.site.width).toBe(1280);
    expect(L.frame.bar).toBeGreaterThan(0);
    expect(L.screen.statusBar).toBe(0);
  });
});
