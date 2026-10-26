import type { Camera, SceneConfig, ShowsiteConfig } from "./config.js";

export interface Section {
  index: number;
  name: string;
  caption: string;
  top: number;
  height: number;
  selector: string;
  kind: "hero" | "section" | "footer";
}

export interface ScanResult {
  url: string;
  title: string;
  lang: string;
  dir: string;
  pageHeight: number;
  viewport: { width: number; height: number };
  sections: Section[];
  /** Videos on the page the browser couldn't play. */
  brokenVideos?: number;
  /** Height of a header that stays on screen while scrolling. */
  stickyTop?: number;
}

export interface PlannedScene {
  key: string;
  name: string;
  caption: string;
  narration?: string;
  /** Seconds from the start of the video. */
  start: number;
  duration: number;
  camera: Camera;
  /** Scroll position when the scene settles, and where it ends. */
  fromY: number;
  toY: number;
  /** Seconds spent scrolling in from the previous scene. */
  travel: number;
  zoomTo: number;
}

export interface Plan {
  scenes: PlannedScene[];
  total: number;
  /** Fade from / to the background at the very start and end. */
  fadeIn: number;
  fadeOut: number;
}

export interface PlanInput {
  scan: ScanResult;
  config: Pick<ShowsiteConfig, "scenes" | "maxScenes" | "captions" | "fitToAudio"> & { narration?: { enabled: boolean } };
  /** Height of the site's viewport (iframe), in site pixels. */
  viewportHeight: number;
  /** How much of that viewport is visible in the video. */
  visibleHeight: number;
  /** Resolved positions for scenes that point at a CSS selector. */
  located?: Record<string, { top: number; height: number; caption: string } | null>;
  audioDuration?: number;
  /** Beat length of the composed music. Scene lengths snap to whole beats, so cuts land on the beat. */
  beat?: number;
}

const FIRST_DURATION = 3.4;
const DEFAULT_DURATION = 3;
const ZOOM_AMOUNT = 1.09;

export class PlanError extends Error {}

export function planVideo(input: PlanInput): Plan {
  const { scan, config, viewportHeight, visibleHeight } = input;
  const maxScroll = Math.max(0, scan.pageHeight - viewportHeight);
  const clampY = (y: number) => Math.round(Math.max(0, Math.min(maxScroll, y)));

  const wanted = config.scenes.length ? config.scenes : autoScenes(scan, config.maxScenes, visibleHeight);
  if (!wanted.length) throw new PlanError("Couldn't find anything to show on this page.");

  const drafts = wanted.map((scene, i) => {
    const target = resolveTarget(scene, scan, input.located);
    const camera: Camera = scene.camera ?? (i === 0 ? "zoom" : "scroll");
    const duration = scene.duration ?? (i === 0 ? FIRST_DURATION : DEFAULT_DURATION);
    const caption = config.captions.enabled ? (scene.caption ?? target.caption) : "";
    // Sections near the top start at the very top, so the site's header is in the shot.
    // Others start just below a sticky header instead of underneath it.
    const fromY = target.top <= visibleHeight * 0.3 ? 0 : clampY(target.top - (scan.stickyTop ?? 0));
    let toY = fromY;
    if (camera === "scroll") {
      const pan = Math.min(Math.max(target.height - visibleHeight, 0), visibleHeight * 0.6);
      toY = clampY(fromY + Math.max(pan, visibleHeight * 0.14));
    }
    return { name: target.name, caption, narration: scene.narration ?? scene.caption ?? target.caption, camera, duration, fromY, toY };
  });

  // Stretch or shrink to the audio.
  if (config.fitToAudio && input.audioDuration && input.audioDuration > 1) {
    const sum = drafts.reduce((s, d) => s + d.duration, 0);
    const factor = input.audioDuration / sum;
    for (const d of drafts) d.duration = Math.max(1.2, d.duration * factor);
  } else if (input.beat) {
    const beat = input.beat;
    for (const d of drafts) d.duration = Math.max(2, (config.narration?.enabled ? Math.ceil : Math.round)(d.duration / beat)) * beat;
  }

  let start = 0;
  let prevY = drafts[0]!.fromY;
  let prevZoom = 1;
  const scenes: PlannedScene[] = drafts.map((d, i) => {
    // A scroll that has nowhere to go (end of the page) becomes a gentle push-in, so the shot still moves.
    const zoomTo = d.camera === "zoom" ? ZOOM_AMOUNT : d.camera === "scroll" && d.toY - d.fromY < 8 ? 1.05 : 1;
    const distance = Math.abs(d.fromY - prevY);
    let travel = 0;
    if (i > 0 && distance >= 4) travel = Math.min(d.duration * 0.45, 0.6 + Math.min(distance, 4000) / 3000);
    else if (i > 0 && prevZoom !== 1) travel = Math.min(d.duration * 0.3, 0.6); // ease back out of the zoom
    const scene: PlannedScene = {
      key: `${i}:${d.caption}`,
      name: d.name,
      caption: d.caption,
      narration: d.narration,
      start,
      duration: d.duration,
      camera: d.camera,
      fromY: d.fromY,
      toY: d.toY,
      travel,
      zoomTo,
    };
    start += d.duration;
    prevY = d.toY;
    prevZoom = zoomTo;
    return scene;
  });

  return { scenes, total: round3(start), fadeIn: 0.25, fadeOut: 0.5 };
}

/** Sections showsite picks by itself: the top of the page first, no footer, nothing too close together. */
export function autoScenes(scan: ScanResult, maxScenes: number, visibleHeight: number): SceneConfig[] {
  const picked: Section[] = [];
  for (const section of scan.sections) {
    if (section.kind === "footer") continue;
    const last = picked[picked.length - 1];
    if (last && section.top - last.top < visibleHeight * 0.45) continue;
    picked.push(section);
    if (picked.length >= maxScenes) break;
  }
  return picked.map((s) => ({ section: s.index }));
}

function resolveTarget(
  scene: SceneConfig,
  scan: ScanResult,
  located: PlanInput["located"],
): { name: string; caption: string; top: number; height: number } {
  if (typeof scene.section === "number") {
    const section = scan.sections[scene.section - 1];
    if (!section) {
      throw new PlanError(
        `Scene points at section ${scene.section}, but the page has ${scan.sections.length} section${scan.sections.length === 1 ? "" : "s"}. Run "showsite init" again to see them.`,
      );
    }
    return section;
  }
  const hit = located?.[scene.section];
  if (!hit) throw new PlanError(`Nothing on the page matches the selector "${scene.section}".`);
  return { name: scene.section, caption: hit.caption, top: hit.top, height: hit.height };
}

export interface CameraState {
  index: number;
  scene: PlannedScene;
  /** Seconds since the scene started. */
  local: number;
  y: number;
  zoom: number;
  /** 1 = covered by the background (start and end fades). */
  cover: number;
}

/** Where the camera is at time t (seconds). */
export function cameraAt(plan: Plan, t: number): CameraState {
  const { scenes } = plan;
  let index = scenes.findIndex((s) => t >= s.start && t < s.start + s.duration);
  if (index === -1) index = t < 0 ? 0 : scenes.length - 1;
  const scene = scenes[index]!;
  const prev = scenes[index - 1];
  const local = Math.max(0, t - scene.start);

  let y: number;
  let zoom: number;
  if (prev && local < scene.travel) {
    // A soft ease: without motion blur, a sharp one shows as big jumps between frames.
    const p = easeInOutSine(local / scene.travel);
    y = lerp(prev.toY, scene.fromY, p);
    zoom = lerp(prev.zoomTo, 1, Math.min(1, p * 1.6));
  } else {
    const span = scene.duration - scene.travel;
    const p = span > 0 ? easeInOutSine(Math.min(1, (local - scene.travel) / span)) : 1;
    y = lerp(scene.fromY, scene.toY, p);
    zoom = lerp(1, scene.zoomTo, p);
  }

  const fadeIn = plan.fadeIn > 0 ? Math.max(0, 1 - t / plan.fadeIn) : 0;
  const fadeOut = plan.fadeOut > 0 ? Math.max(0, 1 - (plan.total - t) / plan.fadeOut) : 0;
  return { index, scene, local, y: Math.round(y * 100) / 100, zoom, cover: Math.min(1, Math.max(fadeIn, fadeOut)) };
}

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const easeInOutSine = (p: number) => -(Math.cos(Math.PI * p) - 1) / 2;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
