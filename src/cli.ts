#!/usr/bin/env node
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Command, Option } from "commander";
import {
  CAPTION_ANIMATIONS,
  ConfigError,
  FORMATS,
  FRAMES,
  loadConfigFile,
  resolveConfig,
  type PartialConfig,
} from "./config.js";
import { color, log } from "./log.js";
import { MUSIC_STYLES } from "./music.js";
import { PlanError } from "./plan.js";
import { render, scan } from "./render.js";
import { SiteError } from "./session.js";
import { listVoices } from "./narration.js";
import { projectFromScan } from "./project.js";
import { startStudio } from "./studio.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const CONFIG_FILE = "showsite.json";

interface CliOptions {
  mode?: "tour" | "highlights";
  speed?: string;
  pause?: string;
  endClick?: string;
  endScroll?: string;
  clickHold?: string;
  format?: string;
  frame?: string;
  background?: string;
  theme?: string;
  lang?: string;
  audio?: string;
  music?: string | false;
  sfx?: boolean;
  fitAudio?: boolean;
  fps?: string;
  maxScenes?: string;
  hide?: string[];
  captions?: boolean;
  animation?: string;
  out?: string;
  addressBar?: string;
  chrome?: string;
  quiet?: boolean;
  narration?: boolean;
  voice?: string;
  speechRate?: string;
}

function withVideoOptions(cmd: Command): Command {
  return cmd
    .addOption(new Option("--mode <mode>", "full silent viewport tour or composed highlights").choices(["tour", "highlights"]))
    .option("--speed <pixels>", "tour maximum scroll speed, 30–2000 CSS pixels/second")
    .option("--pause <seconds>", "tour pause at each stop, 0–30 seconds")
    .option("--end-click <selector>", "click one button after the tour")
    .option("--end-scroll <selector>", "scroll the opened panel after clicking")
    .option("--click-hold <seconds>", "record the ending action for 7–60 seconds")
    .addOption(new Option("-f, --format <format>", "video shape").choices([...FORMATS]))
    .addOption(new Option("--frame <frame>", "what the site sits in").choices([...FRAMES]))
    .option("-b, --background <color>", "ink, coral, mist, white, black, forest, ocean, or any CSS color")
    .addOption(new Option("--theme <theme>", "record the site's light or dark mode").choices(["light", "dark"]))
    .option("--lang <code>", "browser language, e.g. ar to record the Arabic version")
    .addOption(new Option("-m, --music <style>", "music composed for the video (default: upbeat)").choices([...MUSIC_STYLES]))
    .option("--no-music", "no music")
    .option("--narration", "read each scene aloud using a free local voice")
    .option("--no-narration", "disable generated speech from a config")
    .option("--voice <name>", "installed voice name (see showsite voices); enables narration")
    .option("--speech-rate <wpm>", "speaking speed, 80 to 300 words per minute (default: 175)")
    .option("--no-sfx", "no whooshes on camera moves")
    .option("-a, --audio <file>", "your own music or voiceover, instead of the composed music")
    .option("--fit-audio", "make the video exactly as long as the audio")
    .option("--fps <n>", "frames per second (12 to 60)")
    .option("--max-scenes <n>", "how many sections to show when picking automatically")
    .option("--hide <selectors...>", "CSS selectors to hide while recording")
    .option("--no-captions", "no text above the site")
    .addOption(new Option("--animation <style>", "caption animation").choices([...CAPTION_ANIMATIONS]))
    .option("--address-bar <text>", "text in the browser frame's address bar (default: the site's host)")
    .option("-o, --out <file>", "output file")
    .option("--chrome <path>", "use this Chrome or Chromium executable")
    .option("-q, --quiet", "only print errors");
}

function toConfig(base: PartialConfig, opts: CliOptions): PartialConfig {
  const merged: PartialConfig = { ...base, captions: { ...base.captions }, narration: { ...base.narration } };
  merged.tour = { ...base.tour };
  if (opts.mode) merged.mode = opts.mode;
  if (opts.speed !== undefined) merged.tour.speed = Number(opts.speed);
  if (opts.pause !== undefined) merged.tour.hold = Number(opts.pause);
  if (opts.endClick) merged.tour.endClick = opts.endClick;
  if (opts.endScroll) merged.tour.endScroll = opts.endScroll;
  if (opts.clickHold !== undefined) merged.tour.clickHold = Number(opts.clickHold);
  if (opts.format) merged.format = opts.format as PartialConfig["format"];
  if (opts.frame) merged.frame = opts.frame as PartialConfig["frame"];
  if (opts.background) merged.background = opts.background;
  if (opts.theme) merged.theme = opts.theme as PartialConfig["theme"];
  if (opts.lang) merged.language = opts.lang;
  if (opts.music === false) merged.music = "none";
  else if (opts.music) merged.music = opts.music as PartialConfig["music"];
  if (opts.narration !== undefined) merged.narration = { ...merged.narration, enabled: opts.narration };
  if (opts.voice) merged.narration = { ...merged.narration, enabled: true, voice: opts.voice };
  if (opts.speechRate) merged.narration = { ...merged.narration, rate: Number(opts.speechRate) };
  if (opts.sfx === false) merged.sfx = false;
  if (opts.audio) merged.audio = path.resolve(opts.audio);
  if (opts.fitAudio) merged.fitToAudio = true;
  if (opts.fps) merged.fps = Number(opts.fps);
  if (opts.maxScenes) merged.maxScenes = Number(opts.maxScenes);
  if (opts.hide?.length) merged.hide = [...(base.hide ?? []), ...opts.hide];
  if (opts.captions === false) merged.captions = { ...merged.captions, enabled: false };
  if (opts.animation) merged.captions = { ...merged.captions, animation: opts.animation as "words" };
  if (opts.addressBar) merged.addressBar = opts.addressBar;
  if (opts.out) merged.out = opts.out;
  if (opts.chrome) merged.chromePath = opts.chrome;
  return merged;
}

async function runRender(partial: PartialConfig, opts: CliOptions) {
  log.setQuiet(Boolean(opts.quiet));
  const config = resolveConfig(partial);
  const result = await render(config);
  const rel = path.relative(process.cwd(), result.file) || result.file;
  log.done(
    `Saved ${color.bold(rel)} ${color.dim(`(${result.duration.toFixed(1)}s, ${result.plan.scenes.length} scenes, made in ${Math.round(result.seconds)}s)`)}`,
  );
}

const program = new Command()
  .name("showsite")
  .description("Turn any website into a smooth promo video.")
  .version(version, "-v, --version");

withVideoOptions(
  program
    .command("record [url]", { isDefault: true })
    .description("record a website (or the showsite.json in this folder)"),
).action(async (url: string | undefined, opts: CliOptions) => {
  if (!url) {
    if (existsSync(CONFIG_FILE)) return runRender(toConfig(await loadConfigFile(path.resolve(CONFIG_FILE)), opts), opts);
    program.help();
  }
  await runRender(toConfig({ url }, opts), opts);
});

withVideoOptions(
  program.command("render [config]").description(`record using a config file (default: ${CONFIG_FILE})`),
).action(async (file: string | undefined, opts: CliOptions) => {
  const configPath = path.resolve(file ?? CONFIG_FILE);
  await runRender(toConfig(await loadConfigFile(configPath), opts), opts);
});

withVideoOptions(
  program
    .command("init <url>")
    .description(`find the page's sections and write an editable ${CONFIG_FILE}`)
    .option("--force", `overwrite an existing ${CONFIG_FILE}`),
).action(async (url: string, opts: CliOptions & { force?: boolean }) => {
  log.setQuiet(Boolean(opts.quiet));
  const target = path.resolve(opts.out?.endsWith(".json") ? opts.out : CONFIG_FILE);
  if (existsSync(target) && !opts.force) {
    throw new ConfigError(`${path.basename(target)} already exists. Use --force to replace it.`);
  }
  const { out: _ignored, ...rest } = toConfig({ url }, opts);
  const config = resolveConfig(rest);

  log.step(`Opening ${new URL(config.url).host}`);
  const { scan: result, visibleHeight } = await scan(config);

  const file = projectFromScan(config, result, visibleHeight, path.dirname(target));
  const scenes = file.scenes;
  const picked = new Set(scenes.map(scene => scene.section));
  await writeFile(target, JSON.stringify(file, null, 2) + "\n");

  log.done(`Wrote ${path.relative(process.cwd(), target)} with ${config.mode === "tour" ? file.tour.stops.length + " tour stops" : scenes.length + " scenes"}`);
  if (!opts.quiet) {
    for (const s of result.sections) {
      const mark = picked.has(s.index) ? color.green("●") : color.dim("○");
      process.stderr.write(`  ${mark} ${String(s.index).padStart(2)}. ${s.name}${s.caption && s.caption !== s.name ? color.dim(`  "${s.caption}"`) : ""}\n`);
    }
    process.stderr.write(`\n  Edit the captions, order and timing in ${CONFIG_FILE}, then run ${color.bold("npx showsite")}\n`);
  }
});

program.command("voices").description("list installed, free local narration voices").action(async () => {
  const voices = await listVoices();
  for (const voice of voices) process.stdout.write(`${voice.id.padEnd(32)} ${voice.language}\n`);
});

program.command("studio [url]")
  .alias("dashboard")
  .description("open the visual editor in your browser")
  .option("-p, --port <port>", "localhost port", "4310")
  .option("--no-open", "print the URL without opening a browser")
  .action(async (url: string | undefined, opts: { port: string; open: boolean }) => {
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new ConfigError("Choose a port from 1024 to 65535.");
    const studio = await startStudio({ port, open: opts.open, url });
    process.stdout.write(`\n  Showsite Studio  ${studio.url}\n  Local editor · free system voices · no account required\n  Press Ctrl+C to stop.\n\n`);
    const stop = () => { void studio.close().then(() => process.exit(0)); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof ConfigError || error instanceof PlanError || error instanceof SiteError) {
    log.error(error.message);
  } else {
    log.error(error instanceof Error ? error.message : String(error));
    if (process.env.DEBUG && error instanceof Error) process.stderr.write(`${error.stack}\n`);
  }
  process.exit(1);
});
