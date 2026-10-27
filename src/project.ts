import path from "node:path";
import type { ShowsiteConfig } from "./config.js";
import { autoTourStops } from "./tour-plan.js";
import { autoScenes, type ScanResult } from "./plan.js";

export function projectFromScan(config: ShowsiteConfig, scan: ScanResult, visibleHeight: number, directory = process.cwd()) {
  const picked = autoScenes(scan, config.maxScenes, visibleHeight);
  const { out: _out, audio, ...settings } = config;
  return {
    $schema: "https://unpkg.com/showsite/schema.json",
    ...settings,
    ...(audio ? { audio: path.relative(directory, audio) } : {}),
    ...(config.mode === "tour" ? { tour: { ...config.tour, stops: autoTourStops(Math.max(0, scan.pageHeight - scan.viewport.height), scan.viewport.height, scan.sections) } } : {}),
    scenes: (config.mode === "tour" ? [] : picked).map((scene, i) => ({
      ...scene,
      caption: scan.sections.find(s => s.index === scene.section)?.caption ?? "",
      duration: i === 0 ? 3.4 : 3,
      camera: i === 0 ? "zoom" as const : "scroll" as const,
    })),
    availableSections: scan.sections.map(s => `${s.index}. ${s.name}${s.kind === "footer" ? " (footer)" : ""}`),
  };
}
