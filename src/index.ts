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

export { startStudio } from "./studio.js";
export { listVoices, type Voice } from "./narration.js";

export { renderTour, scanTour, previewTourStop, tourLayout } from "./tour.js";
export { planTour, autoTourStops, tourY, type TourStep } from "./tour-plan.js";
export { type TourConfig, type TourStop } from "./config.js";
