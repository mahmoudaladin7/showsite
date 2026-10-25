import { unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ComposeState } from "./compositor.js";
import { defaultOutFile, type ShowsiteConfig } from "./config.js";
import { probeDuration, startEncoder } from "./ffmpeg.js";
import { computeLayout, visibleSiteHeight } from "./layout.js";
import { log } from "./log.js";
import { beatLength, encodeWav, renderSoundtrack, type MusicStyle } from "./music.js";
import { LOCATE_SCRIPT } from "./page-scripts.js";
import { cameraAt, planVideo, type Plan, type ScanResult } from "./plan.js";
import { openSite, scanPage, warmUp } from "./session.js";

export interface RenderResult {
  file: string;
  duration: number;
  frames: number;
  plan: Plan;
  scan: ScanResult;
  seconds: number;
}

/** Records the website described by `config` and writes an MP4. */
export async function render(config: ShowsiteConfig): Promise<RenderResult> {
  const started = Date.now();
  const layout = computeLayout(config.format, config.frame);
  const visibleHeight = visibleSiteHeight(layout);
  const out = path.resolve(config.out ?? defaultOutFile(config.url, config.format));
  const audioDuration = config.audio ? probeDuration(config.audio) : undefined;
  // Your own audio replaces the composed music.
  const musicStyle: MusicStyle = config.audio ? "none" : config.music;

  const host = new URL(config.url).host;
  log.step(`Opening ${host}`);
  const session = await openSite(config, layout);
  let soundtrack: string | undefined;
  try {
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

    const plan = planVideo({
      scan,
      config,
      viewportHeight: layout.site.height,
      visibleHeight,
      located,
      audioDuration,
      beat: beatLength(musicStyle),
    });
    log.info(`${plan.scenes.length} scenes, ${plan.total.toFixed(1)} seconds`);

    const frames = Math.max(1, Math.round(plan.total * config.fps));

    const audio: { file: string; fade: boolean }[] = [];
    if (config.audio) audio.push({ file: config.audio, fade: true });
    if (musicStyle !== "none" || config.sfx) {
      if (musicStyle !== "none") log.step(`Composing the music (${musicStyle})`);
      const track = renderSoundtrack({
        style: musicStyle,
        sfx: config.sfx,
        duration: frames / config.fps,
        scenes: plan.scenes.map((s) => ({ start: s.start, travel: s.travel })),
      });
      soundtrack = path.join(os.tmpdir(), `showsite-${process.pid}-${Date.now()}.wav`);
      await writeFile(soundtrack, encodeWav(track));
      audio.push({ file: soundtrack, fade: false });
    }

    const encoder = startEncoder({
      out,
      fps: config.fps,
      width: layout.output.width,
      height: layout.output.height,
      duration: frames / config.fps,
      audio,
    });

    const cdp = await session.context.newCDPSession(session.page);
    log.step(`Recording ${frames} frames`);
    try {
      for (let i = 0; i < frames; i++) {
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
      }
      log.step("Encoding");
      await encoder.finish();
    } catch (error) {
      encoder.abort();
      throw error;
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
    await session.close();
    if (soundtrack) await unlink(soundtrack).catch(() => {});
  }
}

/** Opens the site and lists its sections, without recording. */
export async function scan(config: ShowsiteConfig): Promise<{ scan: ScanResult; visibleHeight: number }> {
  const layout = computeLayout(config.format, config.frame);
  const session = await openSite(config, layout);
  try {
    await warmUp(session.frame, layout.site.height, config.hide);
    return { scan: await scanPage(session, config.url), visibleHeight: visibleSiteHeight(layout) };
  } finally {
    await session.close();
  }
}
