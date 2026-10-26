import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ShowsiteConfig } from "./config.js";
import { probeDuration } from "./ffmpeg.js";
import type { Plan } from "./plan.js";

const exec = promisify(execFile);
export interface Voice { id: string; name: string; language: string }
export class NarrationError extends Error {}

const WINDOWS_INIT = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ";

export function parseMacVoices(text: string): Voice[] {
  const voices = text.split(/\r?\n/).flatMap(line => {
    const match = /^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9_]+)\s+#/.exec(line);
    return match ? [{ id: match[1]!.trim(), name: match[1]!.trim(), language: match[2]!.replaceAll("_", "-") }] : [];
  });
  return [...new Map(voices.map(voice => [voice.id + voice.language, voice])).values()];
}

/** Uses installed speech engines only. No captions are sent to a hosted TTS service. */
export async function listVoices(): Promise<Voice[]> {
  try {
    if (process.platform === "darwin") return parseMacVoices((await exec("say", ["-v", "?"], { timeout: 15000 })).stdout);
    if (process.platform === "win32") {
      const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " + WINDOWS_INIT +
        "try { @($s.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { @{ id=$_.VoiceInfo.Name; name=$_.VoiceInfo.Name; language=$_.VoiceInfo.Culture.Name } }) | ConvertTo-Json -Compress } finally { $s.Dispose() }"], { timeout: 15000 });
      const data = JSON.parse(stdout.replace(/^\uFEFF/, ""));
      return Array.isArray(data) ? data : data ? [data] : [];
    }
    const { stdout } = await exec("espeak-ng", ["--voices"], { timeout: 15000 });
    return stdout.split(/\r?\n/).slice(1).flatMap(line => {
      const cols = line.trim().split(/\s+/);
      return cols.length >= 5 ? [{ id: cols[1]!, name: cols[3]!.replaceAll("_", " "), language: cols[1]! }] : [];
    });
  } catch {
    throw new NarrationError(process.platform === "linux"
      ? "Install eSpeak NG for free local narration (Ubuntu/Debian: sudo apt install espeak-ng), then restart Studio."
      : "No speech engine is available. Install a system voice in your operating system's speech settings, then restart Studio.");
  }
}

export function selectVoice(voices: Voice[], explicit?: string, language?: string, text = ""): Voice {
  if (explicit) {
    const exact = voices.find(v => v.id === explicit);
    // macOS can expand "Samantha" to "Samantha (English (US))" after first use.
    const aliases = [...new Map(voices.filter(v => v.id.startsWith(explicit + " (")).map(v => [v.id, v])).values()];
    const voice = exact ?? (aliases.length === 1 ? aliases[0] : undefined);
    if (!voice) throw new NarrationError(`Voice "${explicit}" isn't installed. Run "showsite voices" to see available voices.`);
    return voice;
  }
  const lang = (language || (/[\u0600-\u06ff]/u.test(text) ? "ar" : "en")).toLowerCase().split(/[-_]/)[0]!;
  const candidates = voices.filter(v => v.language.toLowerCase().split(/[-_]/)[0] === lang);
  const preferred = ["Samantha", "Majed", "Maged", "Daniel", "Microsoft Zira Desktop", "Microsoft David Desktop"];
  const voice = preferred.map(id => candidates.find(v => v.id === id || v.id.startsWith(id + " ("))).find(Boolean) ?? candidates[0];
  if (!voice) throw new NarrationError(`No ${lang} voice is installed. Add one in your system's speech settings, or choose an installed voice with --voice.`);
  return voice;
}

export async function synthesizeSpeech(text: string, voice: Voice, rate: number, directory: string, name: string, signal?: AbortSignal): Promise<{ file: string; duration: number }> {
  if (!text.trim() || text.length > 2000) throw new NarrationError("Speech text must contain 1 to 2000 characters.");
  signal?.throwIfAborted();
  const input = path.join(directory, `${name}.txt`);
  const file = path.join(directory, `${name}.${process.platform === "darwin" ? "aiff" : "wav"}`);
  await writeFile(input, text, "utf8");
  const options = { timeout: 120000, signal, maxBuffer: 1024 * 1024 };
  try {
    if (process.platform === "darwin") {
      await exec("say", ["-v", voice.id, "-r", String(rate), "-o", file, "-f", input], options);
    } else if (process.platform === "win32") {
      // Values travel in the environment; none are interpolated into executable PowerShell.
      await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_INIT +
        "try { $s.SelectVoice($env:SHOWSITE_VOICE); $s.Rate = [int]$env:SHOWSITE_RATE; $s.SetOutputToWaveFile($env:SHOWSITE_SPEECH_OUT); $s.Speak([System.IO.File]::ReadAllText($env:SHOWSITE_SPEECH_IN, [System.Text.Encoding]::UTF8)) } finally { $s.Dispose() }"], {
        ...options, env: { ...process.env, SHOWSITE_VOICE: voice.id, SHOWSITE_RATE: String(Math.max(-10, Math.min(10, Math.round(10 * Math.log2(rate / 175))))), SHOWSITE_SPEECH_IN: input, SHOWSITE_SPEECH_OUT: file },
      });
    } else {
      await exec("espeak-ng", ["-v", voice.id, "-s", String(rate), "-w", file, "-f", input], options);
    }
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    throw new NarrationError(`Couldn't generate speech with ${voice.name}. ${error instanceof Error ? error.message : String(error)}`);
  }
  const duration = probeDuration(file);
  if (!(duration > 0) || duration > 120) throw new NarrationError("This spoken line is too long. Shorten the script to less than two minutes per scene.");
  return { file, duration };
}

export const speechDelay = (travel: number) => Math.max(0.35, travel * 0.6);

/** Keeps every spoken line inside its scene; preserves longer, explicitly requested holds. */
export function fitNarration(plan: Plan, durations: number[], fps: number, beat?: number): Plan {
  let start = 0;
  const scenes = plan.scenes.map((scene, index) => {
    const spoken = durations[index] ?? 0;
    const minimum = spoken ? speechDelay(scene.travel) + spoken + 0.4 : scene.duration;
    const step = beat ?? 1 / fps;
    const duration = Math.ceil((Math.max(scene.duration, minimum) - 1e-8) / step) * step;
    const result = { ...scene, start, duration };
    start += duration;
    return result;
  });
  return { ...plan, scenes, total: start };
}

export async function narratePlan(plan: Plan, config: ShowsiteConfig, directory: string, signal?: AbortSignal) {
  const voices = await listVoices();
  const clips: ({ file: string; duration: number } | undefined)[] = [];
  for (const [index, scene] of plan.scenes.entries()) {
    const text = scene.narration?.trim() ?? scene.caption.trim();
    if (!text) { clips.push(undefined); continue; }
    // An explicit language selects the spoken language; otherwise detect each line independently.
    const voice = selectVoice(voices, config.narration.voice, config.language, text);
    clips.push(await synthesizeSpeech(text, voice, config.narration.rate, directory, `scene-${index}`, signal));
  }
  if (!clips.some(Boolean)) throw new NarrationError("There is no text to narrate. Add a caption or narration script to at least one scene.");
  return clips;
}
