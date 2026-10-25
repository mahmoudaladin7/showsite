/**
 * showsite: turn any website into a smooth promo video.
 *
 *   import { render, resolveConfig } from "showsite";
 *   await render(resolveConfig({ url: "https://example.com", format: "9:16" }));
 */
export { render, scan, type RenderResult } from "./render.js";
export {
  resolveConfig,
  loadConfigFile,
  ConfigError,
  BACKGROUNDS,
  FORMATS,
  FRAMES,
  CAMERAS,
  CAPTION_ANIMATIONS,
  type ShowsiteConfig,
  type PartialConfig,
  type SceneConfig,
  type Format,
  type FrameKind,
  type Camera,
  type CaptionAnimation,
} from "./config.js";
export { planVideo, cameraAt, autoScenes, PlanError, type Plan, type PlannedScene, type ScanResult, type Section } from "./plan.js";
export { computeLayout, type Layout } from "./layout.js";
export { renderSoundtrack, encodeWav, beatLength, MUSIC_STYLES, type MusicStyle, type Soundtrack } from "./music.js";
