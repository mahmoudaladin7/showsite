import { render } from "./render.js";
import { resolveConfig } from "./config.js";
import { log } from "./log.js";

const controller = new AbortController();
let started = false;
log.setQuiet(true);
process.on("message", async (message: any) => {
  if (message.type === "cancel") { controller.abort(); return; }
  if (message.type !== "render" || started) return;
  started = true;
  try {
    const result = await render(resolveConfig(message.config), {
      signal: controller.signal,
      onProgress: progress => process.send?.({ type: "progress", ...progress }),
    });
    process.send?.({ type: "done", duration: result.duration, scenes: result.plan.scenes.map(s => ({ start: s.start, duration: s.duration })) });
  } catch (error) {
    process.send?.({ type: controller.signal.aborted ? "cancelled" : "error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    process.disconnect();
  }
});
process.on("disconnect", () => controller.abort());
