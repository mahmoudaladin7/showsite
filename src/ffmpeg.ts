import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** The bundled ffmpeg binary, or one on the PATH. */
export function findFfmpeg(): string {
  if (process.env.SHOWSITE_FFMPEG && existsSync(process.env.SHOWSITE_FFMPEG)) return process.env.SHOWSITE_FFMPEG;
  try {
    const bundled = require("ffmpeg-static") as string | null;
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // Not installed for this platform; fall back to the PATH.
  }
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.status === 0) return "ffmpeg";
  throw new Error("ffmpeg wasn't found. Reinstall showsite, or install ffmpeg and make sure it's on your PATH.");
}

/** Length of an audio file in seconds. */
export function probeDuration(file: string): number {
  if (!existsSync(file)) throw new Error(`Audio file not found: ${file}`);
  const result = spawnSync(findFfmpeg(), ["-hide_banner", "-i", file], { encoding: "utf8" });
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(result.stderr ?? "");
  if (!match) throw new Error(`Couldn't read the length of ${file}. Is it an audio file?`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export interface AudioTrack { file: string; fade: boolean; delay?: number; gain?: number; speech?: boolean }

export interface EncoderOptions {
  out: string;
  fps: number;
  width: number;
  height: number;
  duration: number;
  /** Audio tracks, mixed together. `fade` adds a fade-out at the end (for tracks that would otherwise be cut off). */
  audio?: AudioTrack[];
}

export interface Encoder {
  write(frame: Buffer): Promise<void>;
  finish(): Promise<void>;
  abort(): void;
}

/** H.264 MP4 encoder fed with JPEG frames on stdin. */
export function startEncoder(opts: EncoderOptions): Encoder {
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(opts.fps), "-c:v", "mjpeg", "-i", "pipe:0",
  ];
  const audio = opts.audio ?? [];
  for (const track of audio) args.push("-i", track.file);
  args.push(
    "-map", "0:v",
    "-vf", `scale=${opts.width}:${opts.height}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high",
    "-r", String(opts.fps), "-movflags", "+faststart",
  );
  if (audio.length) {
    const fadeStart = Math.max(0, opts.duration - 1.2).toFixed(2);
    const chains = audio.map(
      (track, i) => `[${i + 1}:a]aresample=48000${track.speech ? ",loudnorm=I=-18:TP=-3:LRA=7,aresample=48000" : ""},volume=${track.gain ?? 1}${track.delay ? `,adelay=${Math.round(track.delay * 1000)}:all=1` : ""},apad${track.fade ? `,afade=t=out:st=${fadeStart}:d=1.2` : ""}[a${i}]`,
    );
    const mix =
      audio.length > 1
        ? `${audio.map((_, i) => `[a${i}]`).join("")}amix=inputs=${audio.length}:normalize=0:duration=longest[aout]`
        : "[a0]anull[aout]";
    args.push(
      "-filter_complex", [...chains, mix].join(";"),
      "-map", "[aout]",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    );
  }
  args.push("-t", opts.duration.toFixed(3), opts.out);

  const proc = spawn(findFfmpeg(), args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`))));
  });
  // A failed encoder can exit while the browser is still producing frames.
  // Keep the original promise rejectable by finish without an unhandled rejection.
  void exited.catch(() => {});
  // Surface write errors through `exited` instead of crashing the process.
  proc.stdin.on("error", () => {});

  return {
    write(frame) {
      return new Promise((resolve, reject) => {
        if (!proc.stdin.writable) return reject(new Error(`ffmpeg stopped early: ${stderr.trim()}`));
        proc.stdin.write(frame, (error) => (error ? reject(error) : resolve()));
      });
    },
    async finish() {
      proc.stdin.end();
      await exited;
    },
    abort() {
      proc.kill("SIGKILL");
    },
  };
}
