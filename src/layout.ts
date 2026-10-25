import type { Format, FrameKind } from "./config.js";

/**
 * Geometry of one video frame.
 *
 * The compositor page is laid out at half the output size and captured at
 * deviceScaleFactor 2. The site inside it is rendered at retina resolution,
 * so text stays sharp even though the site is scaled down to fit the frame.
 */
export interface Layout {
  output: { width: number; height: number };
  css: { width: number; height: number };
  caption: { top: number; left: number; width: number; height: number; fontSize: number };
  frame: { kind: FrameKind; x: number; y: number; width: number; height: number; radius: number; bar: number; bezel: number };
  /** The display area. On a phone, the top `statusBar` pixels show the clock and icons, not the site. */
  screen: { x: number; y: number; width: number; height: number; radius: number; statusBar: number };
  /** The website's own viewport (CSS pixels inside the iframe) and how much it is scaled. */
  site: { width: number; height: number; scale: number; mobile: boolean };
}

const OUTPUT: Record<Format, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

const DESKTOP_WIDTH = 1280;
const MOBILE = { width: 390, height: 844 };
/** iPhone status bar height, in the phone's own points. */
const STATUS_BAR = 47;

export function computeLayout(format: Format, frameKind: FrameKind): Layout {
  const output = OUTPUT[format];
  const css = { width: output.width / 2, height: output.height / 2 };
  const mobile = format === "9:16" || frameKind === "phone";

  // Caption zone at the top.
  const captionByFormat: Record<Format, { top: number; height: number; fontSize: number; side: number }> = {
    "16:9": { top: 30, height: 80, fontSize: 30, side: 100 },
    "1:1": { top: 34, height: 86, fontSize: 28, side: 34 },
    "9:16": { top: 84, height: 132, fontSize: 32, side: 40 },
  };
  const c = captionByFormat[format];
  const caption = { top: c.top, left: c.side, width: css.width - c.side * 2, height: c.height, fontSize: c.fontSize };

  const top = c.top + c.height + (format === "9:16" ? 30 : 16);

  if (frameKind === "phone") {
    const bezel = format === "9:16" ? 9 : 6;
    const bottomGap = format === "9:16" ? 64 : 20;
    const outerHeight = css.height - top - bottomGap;
    const screenHeight = outerHeight - bezel * 2;
    const screenWidth = Math.round((screenHeight * MOBILE.width) / MOBILE.height);
    const outerWidth = screenWidth + bezel * 2;
    const x = Math.round((css.width - outerWidth) / 2);
    const scale = screenWidth / MOBILE.width;
    const statusBar = Math.round(STATUS_BAR * scale);
    const radius = Math.round(screenWidth * 0.135);
    return {
      output,
      css,
      caption,
      frame: { kind: "phone", x, y: top, width: outerWidth, height: outerHeight, radius: radius + bezel, bar: 0, bezel },
      screen: { x: x + bezel, y: top + bezel, width: screenWidth, height: screenHeight, radius, statusBar },
      site: { width: MOBILE.width, height: Math.round((screenHeight - statusBar) / scale), scale, mobile: true },
    };
  }

  // Browser window (or a bare rounded screenshot) that runs off the bottom edge.
  const side = format === "16:9" ? 100 : format === "1:1" ? 34 : 34;
  const width = css.width - side * 2;
  const bleed = 40;
  const height = css.height - top + bleed;
  const bar = frameKind === "browser" ? 26 : 0;
  const screen = { x: side, y: top + bar, width, height: height - bar, radius: frameKind === "browser" ? 0 : 12, statusBar: 0 };
  const siteWidth = mobile ? MOBILE.width : DESKTOP_WIDTH;
  const scale = screen.width / siteWidth;
  return {
    output,
    css,
    caption,
    frame: { kind: frameKind, x: side, y: top, width, height, radius: 12, bar, bezel: 0 },
    screen,
    site: { width: siteWidth, height: Math.round(screen.height / scale), scale, mobile },
  };
}

/** How much of the site's viewport is actually visible (the frame runs off the bottom edge). */
export function visibleSiteHeight(layout: Layout): number {
  const siteTop = layout.screen.y + layout.screen.statusBar;
  const visibleCss = Math.min(layout.screen.y + layout.screen.height, layout.css.height) - siteTop;
  return Math.round(visibleCss / layout.site.scale);
}
