import { fork, execFile, type ChildProcess } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveConfig, ConfigError, type PartialConfig } from "./config.js";
import { findFfmpeg } from "./ffmpeg.js";
import { listVoices, selectVoice, synthesizeSpeech } from "./narration.js";
import { projectFromScan } from "./project.js";
import { previewTourStop } from "./tour.js";
import { scan } from "./render.js";

const exec = promisify(execFile);
const assets = new URL("../assets/studio/", import.meta.url);
interface Job {
  id: string; state: "running" | "cancelling" | "done" | "error" | "cancelled";
  phase: string; percent: number; file: string; filename: string; error?: string; duration?: number;
  scenes?: { start: number; duration: number }[]; child?: ChildProcess;
}

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage): Promise<any> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new ConfigError("Send application/json.");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 262144) throw new ConfigError("The project is too large (maximum 256 KB).");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ConfigError("The project is not valid JSON."); }
}

/** Browser requests never select arbitrary files or executables on the host. */
export function studioConfig(value: PartialConfig) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError("Choose a website and settings first.");
  if (value.audio || value.chromePath || value.out) throw new ConfigError("Studio manages output files. Custom audio files and browser paths are available through the CLI.");
  return resolveConfig(value);
}

export async function serveFile(req: IncomingMessage, res: ServerResponse, file: string, type: string, download?: string) {
  const size = (await stat(file)).size;
  let start = 0, end = size - 1, status = 200;
  const headers: Record<string, string | number> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store" };
  if (download) headers["content-disposition"] = `attachment; filename="${download}"`;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
    if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
    else start = Math.max(0, size - Number(match[2]));
    if (start > end || start >= size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["content-length"] = Math.max(0, end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

export async function startStudio(options: { port?: number; open?: boolean; url?: string; outputDirectory?: string } = {}) {
  const token = randomBytes(24).toString("hex");
  const jobs = new Map<string, Job>();
  const previews = new Map<string, string>();
  const projects = new Map<string, { file: string; filename: string }>();
  const temp = await mkdtemp(path.join(os.tmpdir(), "showsite-studio-"));
  const output = path.resolve(options.outputDirectory ?? "showsite-output");
  const speech = await listVoices().then(voices => ({ voices, voiceError: "" })).catch(error => ({ voices: [], voiceError: error.message as string }));
  let busy = false;
  let origin = "";
  const server = createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const port = new URL(origin).port;
    const demoRequest = req.url === "/demo" && ["GET", "HEAD"].includes(req.method ?? "");
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host ?? "") ||
        (!demoRequest && ((req.headers.origin && ![origin, `http://localhost:${port}`].includes(req.headers.origin)) ||
        req.headers["sec-fetch-site"] === "cross-site"))) return json(res, { error: "Studio accepts requests from its local browser page only." }, 403);
    const url = new URL(req.url ?? "/", origin);
    try {
      if (req.method === "GET" && url.pathname === "/api/bootstrap") {
        return json(res, { token, ...speech, initialUrl: options.url ?? "", demoUrl: `${origin}/demo`, outputDirectory: output });
      }
      const assetFiles: Record<string, [string, string]> = {
        "/": ["index.html", "text/html; charset=utf-8"], "/studio.js": ["studio.js", "text/javascript; charset=utf-8"],
        "/studio.css": ["studio.css", "text/css; charset=utf-8"], "/demo": ["demo.html", "text/html; charset=utf-8"],
      };
      if ((req.method === "GET" || req.method === "HEAD") && assetFiles[url.pathname]) {
        const [file, type] = assetFiles[url.pathname]!;
        return await serveFile(req, res, fileURLToPath(new URL(file, assets)), type);
      }
      if (req.method === "GET" && url.pathname === "/font.woff2") return await serveFile(req, res, fileURLToPath(new URL("../fonts/ibm-plex-sans-latin.woff2", assets)), "font/woff2");
      const media = /^\/api\/(video|voice|project)\/([a-f0-9-]+)$/.exec(url.pathname);
      if (media && ["GET", "HEAD"].includes(req.method ?? "")) {
        if (media[1] === "project") {
          const project = projects.get(media[2]!);
          if (!project) return json(res, { error: "Project download not found. Your saved file is still in showsite-output." }, 404);
          return await serveFile(req, res, project.file, "application/json; charset=utf-8", project.filename);
        }
        const job = jobs.get(media[2]!);
        const file = media[1] === "voice" ? previews.get(media[2]!) : job?.state === "done" ? job.file : undefined;
        if (!file) return json(res, { error: "This preview is no longer available. Render it again." }, 404);
        return await serveFile(req, res, file, media[1] === "voice" ? "audio/wav" : "video/mp4", url.searchParams.has("download") ? job?.filename : undefined);
      }
      if (!url.pathname.startsWith("/api/")) return json(res, { error: "Not found" }, 404);
      if (req.headers["x-showsite-token"] !== token) return json(res, { error: "Reload Studio to reconnect." }, 403);
      const jobMatch = /^\/api\/jobs\/([a-f0-9-]+)$/.exec(url.pathname);
      if (jobMatch) {
        const job = jobs.get(jobMatch[1]!);
        if (!job) return json(res, { error: "Render not found. Start a new render." }, 404);
        if (req.method === "DELETE") {
          if (job.state === "running") { job.state = "cancelling"; job.phase = "Cancelling"; job.child?.send({ type: "cancel" }); }
          return json(res, { state: job.state });
        }
        if (req.method === "GET") {
          const { child: _child, file: _file, ...publicJob } = job;
          return json(res, { ...publicJob, videoUrl: job.state === "done" ? `/api/video/${job.id}` : undefined });
        }
      }
      if (req.method !== "POST") return json(res, { error: "Not found" }, 404);
      if (busy) return json(res, { error: "Another operation is running. Wait for it to finish or cancel the render." }, 409);
      const input = await body(req);
      // Claim the slot after reading the body too: another request may have won while it streamed.
      if (busy) return json(res, { error: "Another operation is running." }, 409);
      if (url.pathname === "/api/validate") return json(res, studioConfig(input));
      if (url.pathname === "/api/projects") {
        const config = studioConfig(input);
        const id = randomUUID();
        const host = new URL(config.url).hostname.replace(/[^a-z0-9.-]/gi, "_");
        const filename = `${host}-${id.slice(0, 8)}.showsite.json`;
        await mkdir(output, { recursive: true });
        const file = path.join(output, filename);
        await writeFile(file, JSON.stringify({ $schema: "https://unpkg.com/showsite/schema.json", ...config }, null, 2) + "\n", { flag: "wx" });
        projects.set(id, { file, filename });
        return json(res, { filename, url: `/api/project/${id}`, file }, 201);
      }
      if (url.pathname === "/api/scan") {
        const config = studioConfig(input);
        busy = true;
        try {
          const result = await scan(config, true);
          return json(res, { ...result, project: projectFromScan(config, result.scan, result.visibleHeight) });
        } finally { busy = false; }
      }
      if (url.pathname === "/api/tour-preview") {
        const config = studioConfig(input.config);
        busy = true;
        try { return json(res, await previewTourStop(config, input.y)); }
        finally { busy = false; }
      }
      if (url.pathname === "/api/voice-preview") {
        const config = studioConfig(input.config);
        if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 2000) throw new ConfigError("Add a spoken line up to 2000 characters.");
        const voice = selectVoice(speech.voices, config.narration.voice, config.language, input.text);
        busy = true;
        const id = randomUUID();
        const directory = path.join(temp, id);
        try {
          await mkdir(directory);
          const clip = await synthesizeSpeech(input.text, voice, config.narration.rate, directory, "sample");
          const wav = path.join(directory, "preview.wav");
          await exec(findFfmpeg(), ["-hide_banner", "-loglevel", "error", "-y", "-i", clip.file, "-af", "loudnorm=I=-18:TP=-3:LRA=7", "-ar", "48000", wav], { timeout: 30000 });
          previews.set(id, wav);
          if (previews.size > 20) { const oldest = previews.keys().next().value!; const old = previews.get(oldest)!; previews.delete(oldest); await rm(path.dirname(old), { recursive: true, force: true }); }
          return json(res, { url: `/api/voice/${id}`, duration: clip.duration, voice: voice.name });
        } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
        finally { busy = false; }
      }
      if (url.pathname === "/api/render") {
        const config = studioConfig(input);
        if (config.mode !== "tour" && !config.scenes.length) throw new ConfigError("Scan a website or import a project with scenes first.");
        busy = true;
        try { await mkdir(output, { recursive: true }); } catch (error) { busy = false; throw error; }
        const id = randomUUID();
        const host = new URL(config.url).hostname.replace(/[^a-z0-9.-]/gi, "_");
        const filename = `${host}-${config.format.replace(":", "x")}-${id.slice(0, 8)}.mp4`;
        const job: Job = { id, state: "running", phase: "Starting", percent: 0, file: path.join(output, filename), filename };
        busy = true;
        jobs.set(id, job);
        const child = fork(fileURLToPath(new URL("./studio-worker.js", import.meta.url)), [], { execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"] });
        job.child = child;
        let diagnostic = "";
        child.stderr?.on("data", chunk => { diagnostic = (diagnostic + String(chunk)).slice(-3000); });
        child.on("message", (message: any) => {
          if (message.type === "progress" && job.state === "running") { job.phase = message.phase; job.percent = message.percent; }
          else if (message.type === "done" && job.state === "running") { job.state = "done"; job.percent = 100; job.phase = "Ready"; job.duration = message.duration; job.scenes = message.scenes; }
          else if (message.type === "error") { job.state = "error"; job.error = message.error; }
          else if (message.type === "cancelled" || (message.type === "done" && job.state === "cancelling")) job.state = "cancelled";
        });
        child.on("error", error => { job.state = "error"; job.error = error.message; });
        child.on("close", () => {
          if (job.state === "running") { job.state = "error"; job.error = diagnostic.trim() || "The renderer stopped unexpectedly. Try again."; }
          if (job.state === "cancelling") job.state = "cancelled";
          if (job.state !== "done") void rm(job.file, { force: true }).catch(() => {});
          delete job.child;
          busy = false;
        });
        child.send({ type: "render", config: { ...config, out: job.file } });
        return json(res, { id }, 202);
      }
      return json(res, { error: "Not found" }, 404);
    } catch (error) {
      if (!res.headersSent) json(res, { error: error instanceof Error ? error.message : String(error) }, 400);
      else res.destroy();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 4310, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
  } catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const close = async () => {
    for (const job of jobs.values()) if (job.child?.connected) job.child.send({ type: "cancel" });
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  };
  if (options.open !== false) {
    const [command, args] = process.platform === "darwin" ? ["open", [origin]] : process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", origin]] : ["xdg-open", [origin]];
    void exec(command!, args as string[]).catch(() => {});
  }
  return { server, url: origin, close };
}
