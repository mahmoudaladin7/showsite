import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ComposeState } from "./compositor.js";
import { defaultOutFile, type ShowsiteConfig } from "./config.js";
import { probeDuration, startEncoder, type AudioTrack } from "./ffmpeg.js";
import { computeLayout, visibleSiteHeight } from "./layout.js";
import { log } from "./log.js";
import { beatLength, encodeWav, renderSoundtrack, type MusicStyle } from "./music.js";
import { LOCATE_SCRIPT } from "./page-scripts.js";
import { cameraAt, planVideo, type Plan, type ScanResult } from "./plan.js";
import { openSite, scanPage, warmUp } from "./session.js";
import { renderTour, scanTour } from "./tour.js";
import { fitNarration, narratePlan, speechDelay } from "./narration.js";

export interface RenderProgress { phase: string; percent: number }
export interface RenderOptions { signal?: AbortSignal; onProgress?: (progress: RenderProgress) => void }

export interface RenderResult {
  file: string;
  duration: number;
  frames: number;
  plan: Plan;
  scan: ScanResult;
  seconds: number;
}

/** Records the website described by `config` and writes an MP4. */
export async function render(config: ShowsiteConfig, options: RenderOptions = {}): Promise<RenderResult> {
  if (config.mode === "tour") return renderTour(config, options);
  options.signal?.throwIfAborted();
  const progress = (phase: string, percent: number) => options.onProgress?.({ phase, percent });
  const started = Date.now();
  const layout = computeLayout(config.format, config.frame);
  const visibleHeight = visibleSiteHeight(layout);
  const out = path.resolve(config.out ?? defaultOutFile(config.url, config.format));
  const audioDuration = config.audio ? probeDuration(config.audio) : undefined;
  // Your own audio replaces the composed music.
  const musicStyle: MusicStyle = config.audio ? "none" : config.music;

  const host = new URL(config.url).host;
  log.step(`Opening ${host}`);
  progress("Opening website", 2);
  const session = await openSite(config, layout);
  let temp: string | undefined;
  const cancel = () => { void session.close().catch(() => {}); };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    options.signal?.throwIfAborted();
    temp = await mkdtemp(path.join(os.tmpdir(), "showsite-render-"));
    progress("Loading images and finding scenes", 5);
    await warmUp(session.frame, layout.site.height, config.hide);
    const scan = await scanPage(session, config.url);
    log.info(`${scan.sections.length} sections found${scan.title ? ` on "${scan.title}"` : ""}`);
    if (scan.brokenVideos) {
      log.warn(
        `${scan.brokenVideos === 1 ? "A video" : `${scan.brokenVideos} videos`} on this page can't play in this browser. ` +
          "Install Google Chrome or Microsoft Edge (or pass --chrome <path>) so MP4 videos show up.",
      );
    }

    const located: Record<string, { top: number; height: number; caption: string } | null> = {};
    for (const scene of config.scenes) {
      if (typeof scene.section === "string") {
        const hit = (await session.frame.evaluate(LOCATE_SCRIPT(scene.section))) as
          | { top: number; height: number; caption: string }
          | { error: string }
          | null;
        located[scene.section] = hit && "top" in hit ? hit : null;
      }
    }

    let plan = planVideo({
      scan,
      config,
      viewportHeight: layout.site.height,
      visibleHeight,
      located,
      audioDuration,
      beat: beatLength(musicStyle),
    });
    const audio: AudioTrack[] = [];
    if (config.narration.enabled) {
      log.step("Recording the voice-over");
      progress("Generating local voice-over", 10);
      const clips = await narratePlan(plan, config, temp, options.signal);
      plan = fitNarration(plan, clips.map(clip => clip?.duration ?? 0), config.fps, beatLength(musicStyle));
      clips.forEach((clip, i) => {
        if (clip) audio.push({ file: clip.file, fade: false, speech: true, delay: plan.scenes[i]!.start + speechDelay(plan.scenes[i]!.travel) });
      });
    }
    log.info(`${plan.scenes.length} scenes, ${plan.total.toFixed(1)} seconds`);

    const frames = Math.max(1, Math.round(plan.total * config.fps));

    if (config.audio) audio.push({ file: config.audio, fade: true });
    if (musicStyle !== "none" || config.sfx) {
      if (musicStyle !== "none") log.step(`Composing the music (${musicStyle})`);
      const track = renderSoundtrack({
        style: musicStyle,
        sfx: config.sfx,
        duration: frames / config.fps,
        scenes: plan.scenes.map((s) => ({ start: s.start, travel: s.travel })),
      });
      const soundtrack = path.join(temp, "soundtrack.wav");
      await writeFile(soundtrack, encodeWav(track));
      audio.push({ file: soundtrack, fade: false, gain: config.narration.enabled ? 0.13 : 1 });
    }

    const encoder = startEncoder({
      out,
      fps: config.fps,
      width: layout.output.width,
      height: layout.output.height,
      duration: frames / config.fps,
      audio,
    });

    const stopEncoding = () => encoder.abort();
    options.signal?.addEventListener("abort", stopEncoding, { once: true });
    try {
      options.signal?.throwIfAborted();
      const cdp = await session.context.newCDPSession(session.page);
      log.step(`Recording ${frames} frames`);
      for (let i = 0; i < frames; i++) {
        options.signal?.throwIfAborted();
        const t = i / config.fps;
        const cam = cameraAt(plan, t);
        // Virtual time for the site's own animations; starts 1s in so nothing begins at zero.
        const vt = 1000 + t * 1000;
        const statusColor = (await session.frame.evaluate(
          ([y, time]) => {
            const s = (window as any).__showsite;
            s.scrollToY(y);
            return s.tick(time);
          },
          [cam.y, vt] as const,
        )) as string | undefined;
        // The caption waits until the camera is mostly there before it animates in.
        const captionDelay = cam.scene.travel * 0.6;
        const state: ComposeState = {
          key: cam.scene.key,
          text: cam.scene.caption,
          local: cam.local - captionDelay,
          duration: cam.scene.duration - captionDelay,
          animation: config.captions.animation,
          zoom: cam.zoom,
          cover: cam.cover,
          statusColor,
        };
        await session.page.evaluate((s) => (window as any).__compose(s), state);
        const shot = (await cdp.send("Page.captureScreenshot", {
          format: "jpeg",
          quality: 94,
          optimizeForSpeed: true,
        })) as { data: string };
        await encoder.write(Buffer.from(shot.data, "base64"));
        log.progress(`${(t + 1 / config.fps).toFixed(1)}s of ${plan.total.toFixed(1)}s`, i + 1, frames);
        if (i % Math.max(1, Math.round(config.fps / 2)) === 0) progress("Rendering video", Math.round(18 + (i + 1) / frames * 77));
      }
      log.step("Encoding");
      progress("Finishing MP4", 97);
      await encoder.finish();
      progress("Ready", 100);
    } catch (error) {
      encoder.abort();
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", stopEncoding);
    }

    return {
      file: out,
      duration: frames / config.fps,
      frames,
      plan,
      scan,
      seconds: (Date.now() - started) / 1000,
    };
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    await session.close().catch(() => {});
    if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Opens the site and lists its sections, without recording. */
export async function scan(config: ShowsiteConfig, thumbnails = false): Promise<{ scan: ScanResult; visibleHeight: number; thumbnails?: Record<string, string> }> {
  if (config.mode === "tour") return scanTour(config, thumbnails);
  const layout = computeLayout(config.format, config.frame);
  const session = await openSite(config, layout);
  try {
    await warmUp(session.frame, layout.site.height, config.hide);
    const result = await scanPage(session, config.url);
    const images: Record<string, string> = {};
    if (thumbnails) {
      for (const section of result.sections.slice(0, 20)) {
        await session.frame.evaluate(top => {
          const s = (window as any).__showsite;
          s.scrollToY(top);
          return s.tick(2000);
        }, Math.max(0, section.top - (result.stickyTop ?? 0)));
        await new Promise(resolve => setTimeout(resolve, 450));
        const shot = await session.page.locator("#site").screenshot({ type: "jpeg", quality: 65, timeout: 10000 });
        images[section.index] = `data:image/jpeg;base64,${shot.toString("base64")}`;
      }
    }
    return { scan: result, visibleHeight: visibleSiteHeight(layout), ...(thumbnails ? { thumbnails: images } : {}) };
  } finally {
    await session.close();
  }
}
