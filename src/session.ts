import { readFile } from "node:fs/promises";
import type { Browser, BrowserContext, Frame, Page } from "playwright";
import { launchBrowser } from "./browser.js";
import { COMPOSITOR_ORIGIN, compositorHtml } from "./compositor.js";
import { captionColorFor, resolveBackground, type ShowsiteConfig } from "./config.js";
import type { Layout } from "./layout.js";
import { log } from "./log.js";
import { INIT_SCRIPT, SCAN_SCRIPT } from "./page-scripts.js";
import type { ScanResult } from "./plan.js";

const ASSETS = new URL("../assets/", import.meta.url);

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const FRAMING_AND_TRANSPORT_HEADERS = [
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  // The body is handed over already decoded and complete.
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "connection",
  "keep-alive",
];

const redirectPage = (target: string) =>
  `<!doctype html><meta http-equiv="refresh" content="0;url=${target.replace(/"/g, "&quot;")}"><script>location.replace(${JSON.stringify(target)})</script>`;

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  frame: Frame;
  layout: Layout;
  close(): Promise<void>;
}

export class SiteError extends Error {}

/**
 * Opens the compositor page with the website inside it.
 * The site runs in an iframe sized to its own viewport, so it lays out
 * exactly as it would on a laptop or phone.
 */
export async function openSite(config: ShowsiteConfig, layout: Layout): Promise<Session> {
  const browser = await launchBrowser(config.chromePath);
  try {
    const context = await browser.newContext({
      viewport: layout.css,
      deviceScaleFactor: 2,
      colorScheme: config.theme,
      locale: config.language,
      userAgent: layout.site.mobile ? MOBILE_UA : undefined,
      hasTouch: layout.site.mobile,
      reducedMotion: "no-preference",
    });
    await context.addInitScript({ content: INIT_SCRIPT });

    const html = compositorHtml({
      layout,
      background: resolveBackground(config.background),
      captionColor: captionColorFor(config.background),
      host: config.addressBar ?? new URL(config.url).host.replace(/^www\./, ""),
      dark: config.theme === "dark",
    });

    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();

      // Our own compositor page and its fonts.
      if (url.startsWith(COMPOSITOR_ORIGIN)) {
        const { pathname } = new URL(url);
        if (pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: html });
        if (pathname.startsWith("/fonts/") && /^[\w.-]+\.woff2$/.test(pathname.slice(7))) {
          const body = await readFile(new URL(`fonts/${pathname.slice(7)}`, ASSETS)).catch(() => null);
          if (body) return route.fulfill({ status: 200, contentType: "font/woff2", body });
        }
        return route.fulfill({ status: 404, body: "" });
      }

      // Pages loaded inside the frame: drop the headers that forbid framing.
      let isSubframeDocument = false;
      try {
        isSubframeDocument = request.resourceType() === "document" && request.frame().parentFrame() !== null;
      } catch {
        // Service worker requests have no frame.
      }
      if (!isSubframeDocument) return route.continue();

      try {
        const response = await route.fetch({ maxRedirects: 0 });
        const headers = { ...response.headers() };
        for (const name of FRAMING_AND_TRANSPORT_HEADERS) delete headers[name];
        const status = response.status();
        if (status >= 300 && status < 400 && headers.location) {
          // Chromium won't follow a redirect we fulfil ourselves, so redirect from inside the page.
          const target = new URL(headers.location, url).toString();
          return route.fulfill({ status: 200, contentType: "text/html", body: redirectPage(target) });
        }
        return route.fulfill({ response, headers });
      } catch {
        return route.continue();
      }
    });

    const page = await context.newPage();
    await page.goto(`${COMPOSITOR_ORIGIN}/`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const frame = await loadFrame(page, config.url);
    return {
      browser,
      context,
      page,
      frame,
      layout,
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async function loadFrame(page: Page, url: string): Promise<Frame> {
  const handle = await page.$("#site");
  if (!handle) throw new SiteError("Compositor failed to start.");
  const host = new URL(url).host;

  // Status of the last page the frame loaded (after redirects).
  let status = 0;
  const onResponse = (response: import("playwright").Response) => {
    const request = response.request();
    if (request.resourceType() === "document" && request.frame().parentFrame() === page.mainFrame()) status = response.status();
  };
  page.on("response", onResponse);

  const navigated = page.waitForEvent("framenavigated", {
    predicate: (f) => f.parentFrame() === page.mainFrame(),
    timeout: 45_000,
  });
  await page.evaluate((src) => {
    (document.getElementById("site") as HTMLIFrameElement).src = src;
  }, url);
  try {
    await navigated;
  } catch {
    throw new SiteError(`${url} didn't load within 45 seconds. Check the address and your connection.`);
  }
  const frame = await handle.contentFrame();
  if (!frame) throw new SiteError(`Couldn't open ${url}.`);
  await settle(frame);
  page.off("response", onResponse);

  if (frame.url().startsWith("chrome-error:")) {
    throw new SiteError(`Couldn't reach ${host}. Check the address, and that the site is running if it's local.`);
  }
  if (status >= 400) {
    log.warn(`${host} answered with HTTP ${status}. The video will show that page.`);
  }
  return frame;
}

/** Waits for the page to finish loading, fonts included, then hides banners and widgets. */
export async function settle(frame: Frame, hide: string[] = []): Promise<void> {
  await frame.waitForLoadState("load", { timeout: 45_000 }).catch(() => {});
  await frame.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await frame.evaluate(() => (document.fonts ? document.fonts.ready.then(() => undefined) : undefined)).catch(() => {});
  await frame.evaluate((extra) => (window as any).__showsite?.prepare(extra), hide).catch(() => {});
}

/** Scrolls through the page once so lazy content and images load, then reloads it fresh. */
export async function warmUp(frame: Frame, viewportHeight: number, hide: string[]): Promise<Frame> {
  const height = await frame.evaluate(() => document.scrollingElement?.scrollHeight ?? document.body.scrollHeight);
  for (let y = 0; y < height; y += Math.round(viewportHeight * 0.8)) {
    await frame.evaluate((top) => window.scrollTo({ top, behavior: "instant" as ScrollBehavior }), y);
    await new Promise((r) => setTimeout(r, 110));
  }
  await frame.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

  // Reload so scroll-triggered animations play again on camera (assets now come from cache).
  const url = frame.url();
  await frame.goto(url, { waitUntil: "load", timeout: 45_000 }).catch(() => {});
  await settle(frame, hide);
  await frame.evaluate(() => (window as any).__showsite?.waitForImagesInView()).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
  // Banners sometimes appear late.
  await frame.evaluate((extra) => (window as any).__showsite?.prepare(extra), hide).catch(() => {});
  return frame;
}

export async function scanPage(session: Session, url: string): Promise<ScanResult> {
  await session.frame.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
  const result = (await session.frame.evaluate(SCAN_SCRIPT)) as Omit<ScanResult, "url">;
  return { url, ...result };
}
