import { describe, expect, it } from "vitest";
import { captionColorFor, ConfigError, defaultOutFile, normalizeUrl, resolveBackground, resolveConfig } from "../src/config.js";

describe("normalizeUrl", () => {
  it("adds https to public addresses", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
    expect(normalizeUrl("  https://example.com/pricing ")).toBe("https://example.com/pricing");
  });

  it("uses http for local dev servers", () => {
    expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(normalizeUrl("127.0.0.1:8080/ar")).toBe("http://127.0.0.1:8080/ar");
    expect(normalizeUrl("my-app.local")).toBe("http://my-app.local/");
    expect(normalizeUrl("localhost.example.com")).toBe("https://localhost.example.com/");
  });

  it("keeps an explicit protocol", () => {
    expect(normalizeUrl("https://localhost:3000")).toBe("https://localhost:3000/");
  });

  it("rejects things that aren't addresses", () => {
    expect(() => normalizeUrl("not a url")).toThrow(ConfigError);
  });
});

describe("resolveConfig", () => {
  it("fills in defaults", () => {
    const config = resolveConfig({ url: "example.com" });
    expect(config).toMatchObject({
      url: "https://example.com/",
      format: "16:9",
      frame: "browser",
      fps: 30,
      theme: "light",
      captions: { enabled: true, animation: "words" },
      scenes: [],
      maxScenes: 6,
    });
  });

  it("puts vertical videos in a phone", () => {
    expect(resolveConfig({ url: "example.com", format: "9:16" }).frame).toBe("phone");
    expect(resolveConfig({ url: "example.com", format: "9:16", frame: "none" }).frame).toBe("none");
  });

  it("explains what is wrong", () => {
    expect(() => resolveConfig({})).toThrow(/website address/);
    expect(() => resolveConfig({ url: "example.com", format: "4:3" as never })).toThrow(/"format" must be one of/);
    expect(() => resolveConfig({ url: "example.com", fps: 120 })).toThrow(/12 to 60/);
    expect(() => resolveConfig({ url: "example.com", theme: "sepia" as never })).toThrow(/"theme"/);
    expect(() => resolveConfig({ url: "example.com", scenes: [{ section: 0 }] })).toThrow(/scenes\[0\]\.section/);
    expect(() => resolveConfig({ url: "example.com", scenes: [{ section: 1, duration: 0.1 }] })).toThrow(/duration/);
    expect(() => resolveConfig({ url: "example.com", scenes: [{ section: 1, camera: "spin" as never }] })).toThrow(/camera/);
  });

  it("accepts section numbers and selectors", () => {
    const config = resolveConfig({ url: "example.com", scenes: [{ section: 2 }, { section: "#pricing", caption: "" }] });
    expect(config.scenes).toHaveLength(2);
  });
});

describe("colors and names", () => {
  it("resolves named backgrounds", () => {
    expect(resolveBackground("coral")).toBe("#C9401C");
    expect(resolveBackground("#123456")).toBe("#123456");
  });

  it("picks readable caption colors", () => {
    expect(captionColorFor("ink")).toBe("#FFFFFF");
    expect(captionColorFor("mist")).toBe("#14161D");
    expect(captionColorFor("white")).toBe("#14161D");
    expect(captionColorFor("linear-gradient(red, blue)")).toBe("#FFFFFF");
  });

  it("names the output after the site", () => {
    expect(defaultOutFile("https://www.example.com/pricing", "9:16")).toBe("example.com-9x16.mp4");
  });
});

describe("schema.json", () => {
  it("describes every setting", async () => {
    const { readFile } = await import("node:fs/promises");
    const schema = JSON.parse(await readFile(new URL("../schema.json", import.meta.url), "utf8"));
    const config = resolveConfig({ url: "example.com", audio: "a.mp3", language: "ar", out: "x.mp4", chromePath: "/c" });
    for (const key of Object.keys(config)) expect(schema.properties).toHaveProperty(key);
    expect(schema.properties.format.enum).toEqual(["16:9", "1:1", "9:16"]);
  });

  it("matches the example config", async () => {
    const { readFile } = await import("node:fs/promises");
    const schema = JSON.parse(await readFile(new URL("../schema.json", import.meta.url), "utf8"));
    const example = JSON.parse(await readFile(new URL("../examples/showsite.json", import.meta.url), "utf8"));
    for (const key of Object.keys(example)) expect(schema.properties).toHaveProperty(key);
    expect(() => resolveConfig(example)).not.toThrow();
  });
});
