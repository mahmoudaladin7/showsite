import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { log } from "./log.js";

const require = createRequire(import.meta.url);

const ARGS = [
  "--hide-scrollbars",
  "--autoplay-policy=no-user-gesture-required",
  "--force-color-profile=srgb",
  "--disable-features=Translate",
  "--mute-audio",
];

/**
 * Launches a headless browser. Order of preference:
 * an explicit path, Google Chrome or Microsoft Edge installed on the machine (they
 * play MP4/H.264 videos, which Playwright's Chromium can't), Playwright's own browser.
 * If none is available, downloads Playwright's headless browser once.
 */
export async function launchBrowser(chromePath?: string): Promise<Browser> {
  const executablePath = chromePath ?? process.env.SHOWSITE_CHROME;
  if (executablePath) return chromium.launch({ executablePath, args: ARGS });

  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, args: ARGS });
    } catch {
      // Not installed: try the next one.
    }
  }

  try {
    return await chromium.launch({ args: ARGS });
  } catch (error) {
    if (!isMissingBrowser(error)) throw error;
  }

  log.step("Downloading a headless browser. This happens once and takes a minute.");
  await installHeadlessShell();
  return chromium.launch({ args: ARGS });
}

function isMissingBrowser(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Executable doesn't exist|browserType\.launch: .*not found|Looks like Playwright/i.test(message);
}

function installHeadlessShell(): Promise<void> {
  const cli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [cli, "install", "chromium-headless-shell"], { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("Downloading the browser failed. Try: npx playwright install chromium-headless-shell"))));
  });
}
