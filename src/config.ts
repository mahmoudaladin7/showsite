import { readFile } from "node:fs/promises";
import path from "node:path";
import { MUSIC_STYLES, type MusicStyle } from "./music.js";

export const FORMATS = ["16:9", "1:1", "9:16"] as const;
export type Format = (typeof FORMATS)[number];

export const FRAMES = ["browser", "phone", "none"] as const;
export type FrameKind = (typeof FRAMES)[number];

export const CAMERAS = ["scroll", "zoom", "hold"] as const;
export type Camera = (typeof CAMERAS)[number];

export const CAPTION_ANIMATIONS = ["words", "fade", "none"] as const;
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];

/** Named background presets. Any CSS color or gradient also works. */
export const BACKGROUNDS: Record<string, string> = {
  ink: "#1E2230",
  coral: "#C9401C",
  mist: "#E3E7EE",
  white: "#FFFFFF",
  black: "#000000",
  forest: "#14532D",
  ocean: "#0B3B60",
};

export interface SceneConfig {
  /** Which part of the page: a section number from `showsite init` (1-based), or a CSS selector. */
  section: number | string;
  /** Text shown above the site. Empty string hides the caption for this scene. */
  caption?: string;
  /** Spoken script. Defaults to the caption; an empty string makes this scene silent. */
  narration?: string;
  /** Seconds on screen, including the scroll into this section. */
  duration?: number;
  /** How the camera moves while the scene is on screen. */
  camera?: Camera;
}

export interface ShowsiteConfig {
  url: string;
  format: Format;
  fps: number;
  frame: FrameKind;
  background: string;
  /** Emulated color scheme, for sites with a dark mode. */
  theme: "light" | "dark";
  /** Browser language (Accept-Language), e.g. "ar" to record the Arabic version. */
  language?: string;
  captions: {
    enabled: boolean;
    animation: CaptionAnimation;
  };
  /** Soundtrack composed for the video. Ignored when `audio` is set. */
  music: MusicStyle;
  narration: { enabled: boolean; voice?: string; rate: number };
  /** Whooshes on camera moves. */
  sfx: boolean;
  /** Path to your own audio file (mp3, m4a, wav). Replaces the composed music. */
  audio?: string;
  /** Stretch or shrink the scenes so the video is exactly as long as the audio. */
  fitToAudio: boolean;
  /** Extra CSS selectors to hide while recording (cookie banners and chat widgets are hidden already). */
  hide: string[];
  /** Scenes in order. Leave empty to let showsite pick the sections. */
  scenes: SceneConfig[];
  /** Upper limit when showsite picks the sections itself. */
  maxScenes: number;
  /** Text in the browser frame's address bar. Defaults to the site's host. */
  addressBar?: string;
  /** Output file. Defaults to "<site>-<format>.mp4". */
  out?: string;
  /** Use a specific Chrome or Chromium executable. */
  chromePath?: string;
}

export const DEFAULTS: Omit<ShowsiteConfig, "url"> = {
  format: "16:9",
  fps: 30,
  frame: "browser",
  background: "ink",
  theme: "light",
  captions: { enabled: true, animation: "words" },
  music: "upbeat",
  narration: { enabled: false, rate: 175 },
  sfx: true,
  fitToAudio: false,
  hide: [],
  scenes: [],
  maxScenes: 6,
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type PartialConfig = Partial<Omit<ShowsiteConfig, "captions" | "narration">> & {
  captions?: Partial<ShowsiteConfig["captions"]>;
  narration?: Partial<ShowsiteConfig["narration"]>;
};

/** Fill in defaults and check every value, with error messages a person can act on. */
export function resolveConfig(input: PartialConfig): ShowsiteConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ConfigError("The config must be an object.");
  for (const key of ["captions", "narration"] as const) {
    if (input[key] !== undefined && (!input[key] || typeof input[key] !== "object" || Array.isArray(input[key]))) {
      throw new ConfigError(`"${key}" must be an object.`);
    }
  }
  for (const [key, value] of Object.entries({ "captions.enabled": input.captions?.enabled, "narration.enabled": input.narration?.enabled, sfx: input.sfx, fitToAudio: input.fitToAudio })) {
    if (value !== undefined && typeof value !== "boolean") throw new ConfigError(`"${key}" must be true or false.`);
  }
  for (const key of ["url", "language", "background", "audio", "out", "chromePath", "addressBar"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || input[key].length > 4096)) throw new ConfigError(`"${key}" must be text up to 4096 characters.`);
  }
  if (input.hide !== undefined && (!Array.isArray(input.hide) || input.hide.length > 100 || input.hide.some(v => typeof v !== "string"))) throw new ConfigError('"hide" must be an array of CSS selectors (up to 100).');
  if (input.scenes !== undefined && (!Array.isArray(input.scenes) || input.scenes.length > 30)) throw new ConfigError('"scenes" must be an array with up to 30 scenes.');
  if (!input.url) throw new ConfigError('Add the website address, e.g. "url": "https://example.com".');
  const url = normalizeUrl(input.url);

  const format = input.format ?? DEFAULTS.format;
  if (!FORMATS.includes(format)) {
    throw new ConfigError(`"format" must be one of ${FORMATS.join(", ")}. Got "${format}".`);
  }

  const frame = input.frame ?? (format === "9:16" ? "phone" : DEFAULTS.frame);
  if (!FRAMES.includes(frame)) {
    throw new ConfigError(`"frame" must be one of ${FRAMES.join(", ")}. Got "${frame}".`);
  }

  const fps = input.fps ?? DEFAULTS.fps;
  if (!Number.isInteger(fps) || fps < 12 || fps > 60) {
    throw new ConfigError(`"fps" must be a whole number from 12 to 60. Got ${fps}.`);
  }

  const theme = input.theme ?? DEFAULTS.theme;
  if (theme !== "light" && theme !== "dark") {
    throw new ConfigError(`"theme" must be "light" or "dark". Got "${theme}".`);
  }

  const animation = input.captions?.animation ?? DEFAULTS.captions.animation;
  if (!CAPTION_ANIMATIONS.includes(animation)) {
    throw new ConfigError(`"captions.animation" must be one of ${CAPTION_ANIMATIONS.join(", ")}. Got "${animation}".`);
  }

  const narration = { ...DEFAULTS.narration, ...input.narration };
  if (!Number.isInteger(narration.rate) || narration.rate < 80 || narration.rate > 300) throw new ConfigError('"narration.rate" must be a whole number from 80 to 300 words per minute.');
  if (narration.voice !== undefined && (typeof narration.voice !== "string" || !narration.voice.trim() || narration.voice.length > 200)) throw new ConfigError('"narration.voice" must be a voice name from "showsite voices".');
  if (narration.enabled && input.audio) throw new ConfigError('Choose generated narration or your own audio file, not both.');
  if (narration.enabled && input.fitToAudio) throw new ConfigError('Narration already fits each scene to its speech. Remove "fitToAudio".');
  const music = input.music ?? (narration.enabled ? "none" : DEFAULTS.music);
  if (!MUSIC_STYLES.includes(music)) {
    throw new ConfigError(`"music" must be one of ${MUSIC_STYLES.join(", ")}. Got "${music}".`);
  }

  const maxScenes = input.maxScenes ?? DEFAULTS.maxScenes;
  if (!Number.isInteger(maxScenes) || maxScenes < 1 || maxScenes > 30) {
    throw new ConfigError(`"maxScenes" must be a whole number from 1 to 30. Got ${maxScenes}.`);
  }

  const scenes = (input.scenes ?? []).map((scene, i) => checkScene(scene, i));

  return {
    url,
    format,
    fps,
    frame,
    background: input.background ?? DEFAULTS.background,
    theme,
    language: input.language,
    captions: { enabled: input.captions?.enabled ?? true, animation },
    music,
    narration,
    sfx: input.sfx ?? DEFAULTS.sfx,
    audio: input.audio,
    fitToAudio: input.fitToAudio ?? false,
    hide: input.hide ?? [],
    scenes,
    maxScenes,
    addressBar: input.addressBar,
    out: input.out,
    chromePath: input.chromePath,
  };
}

function checkScene(scene: SceneConfig, i: number): SceneConfig {
  const where = `scenes[${i}]`;
  if (scene === null || typeof scene !== "object") throw new ConfigError(`${where} must be an object.`);
  const { section, duration, camera, caption, narration } = scene;
  if (typeof section === "number") {
    if (!Number.isInteger(section) || section < 1) {
      throw new ConfigError(`${where}.section must be a section number (1, 2, 3...) or a CSS selector.`);
    }
  } else if (typeof section !== "string" || !section.trim()) {
    throw new ConfigError(`${where}.section must be a section number (1, 2, 3...) or a CSS selector.`);
  }
  if (duration !== undefined && (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0.5 || duration > 60)) {
    throw new ConfigError(`${where}.duration must be between 0.5 and 60 seconds.`);
  }
  if (camera !== undefined && !CAMERAS.includes(camera)) {
    throw new ConfigError(`${where}.camera must be one of ${CAMERAS.join(", ")}.`);
  }
  if (caption !== undefined && typeof caption !== "string") {
    throw new ConfigError(`${where}.caption must be text.`);
  }
  if (caption && caption.length > 2000) throw new ConfigError(`${where}.caption must be 2000 characters or fewer.`);
  if (narration !== undefined && (typeof narration !== "string" || narration.length > 2000)) throw new ConfigError(`${where}.narration must be text up to 2000 characters.`);
  return scene;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|\[::1\]|[^/:]+\.local)(?=[:/]|$)/i;

export function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) throw new ConfigError("Only HTTP and HTTPS websites can be recorded.");
  // Local dev servers rarely have https, so "localhost:3000" means http.
  const withProtocol = /^https?:\/\//i.test(value) ? value : `${LOCAL_HOST.test(value) ? "http" : "https"}://${value}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use HTTP or HTTPS without embedded credentials.");
    return url.toString();
  } catch {
    throw new ConfigError(`"${raw}" doesn't look like a website address.`);
  }
}

export async function loadConfigFile(file: string): Promise<PartialConfig> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new ConfigError(`Couldn't find ${file}. Create one with: npx showsite init <url>`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${file} isn't valid JSON: ${(error as Error).message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ConfigError(`${file} must contain a JSON object.`);
  const config = data as PartialConfig & { $schema?: string };
  delete config.$schema;
  // Relative audio paths are relative to the config file, not the shell.
  if (typeof config.audio === "string" && config.audio && !path.isAbsolute(config.audio)) {
    config.audio = path.resolve(path.dirname(file), config.audio);
  }
  return config;
}

export function resolveBackground(value: string): string {
  return BACKGROUNDS[value.toLowerCase()] ?? value;
}

/** Pick white or ink text so captions stay readable on the chosen background. */
export function captionColorFor(background: string): string {
  const hex = resolveBackground(background).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return "#FFFFFF";
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.4 ? "#14161D" : "#FFFFFF";
}

export function defaultOutFile(url: string, format: Format): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return `${host}-${format.replace(":", "x")}.mp4`;
}
