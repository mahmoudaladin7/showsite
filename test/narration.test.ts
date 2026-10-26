import { describe, expect, it } from "vitest";
import { parseMacVoices, selectVoice, fitNarration, speechDelay } from "../src/narration.js";
import { resolveConfig } from "../src/config.js";
import { planVideo, type Plan, type ScanResult } from "../src/plan.js";
import { projectFromScan } from "../src/project.js";

const voices = [
  { id: "Fred", name: "Fred", language: "en-US" },
  { id: "Samantha", name: "Samantha", language: "en-US" },
  { id: "Majed", name: "Majed", language: "ar-001" },
];
const scan: ScanResult = { url: "http://localhost:3000/", title: "Demo", lang: "en", dir: "ltr", pageHeight: 3000, viewport: { width: 1280, height: 800 }, sections: [0, 1000, 2000].map((top, i) => ({ index: i+1, name: `Scene ${i+1}`, caption: `Caption ${i+1}`, top, height: 900, selector: `#s${i}`, kind: i===0 ? "hero" : "section" })) };
function plan(): Plan { return planVideo({ scan, config: resolveConfig({ url: scan.url }), viewportHeight: 800, visibleHeight: 700 }); }

describe("local voice selection", () => {
  it("parses names with spaces and Arabic's numeric locale", () => {
    expect(parseMacVoices('Eddy (English (US)) en_US # Hello\nMajed               ar_001 # مرحبا\n')).toEqual([
      { id: "Eddy (English (US))", name: "Eddy (English (US))", language: "en-US" }, voices[2],
    ]);
  });
  it("chooses an ordinary English voice instead of a novelty voice", () => expect(selectVoice(voices).id).toBe("Samantha"));
  it("detects Arabic in a mixed caption", () => expect(selectVoice(voices, undefined, undefined, "اصنع فيديو مع Showsite").id).toBe("Majed"));
  it("keeps saved voice names working after macOS expands their display names", () => {
    const expanded=[{id:"Samantha (English (US))",name:"Samantha (English (US))",language:"en-US"}];
    expect(selectVoice(expanded,"Samantha").id).toBe(expanded[0]!.id);
    expect(selectVoice([voices[0]!,...expanded]).id).toBe(expanded[0]!.id);
  });
  it("does not pick an ambiguous short name", () => {
    const alternatives=[{id:"Eddy (English (US))",name:"Eddy",language:"en-US"},{id:"Eddy (French (France))",name:"Eddy",language:"fr-FR"}];
    expect(()=>selectVoice(alternatives,"Eddy")).toThrow();
  });
  it("honors an explicit voice", () => expect(selectVoice(voices, "Fred", "ar").id).toBe("Fred"));
  it("doesn't silently pronounce an unsupported language with the wrong voice", () => expect(() => selectVoice(voices, undefined, "ja")).toThrow("No ja voice"));
  it("rejects an unavailable voice", () => expect(() => selectVoice(voices, "Missing")).toThrow("isn't installed"));
});

describe("narrated scene timing", () => {
  it("keeps speech inside each scene and rebuilds the starts without gaps", () => {
    const p = fitNarration(plan(), [5.21, 7.73, 1.2], 30);
    for (const [i, s] of p.scenes.entries()) {
      expect(s.duration).toBeGreaterThanOrEqual(speechDelay(s.travel) + [5.21,7.73,1.2][i]! + 0.4);
      expect(s.duration * 30).toBeCloseTo(Math.round(s.duration * 30), 6);
      if (i) expect(s.start).toBeCloseTo(p.scenes[i-1]!.start + p.scenes[i-1]!.duration);
    }
    expect(p.total).toBeCloseTo(p.scenes.reduce((n,s)=>n+s.duration,0));
  });
  it("rounds up to the music beat so narration isn't truncated", () => {
    const p=fitNarration(plan(),[8.3,0,0],30,0.5);
    expect(p.scenes[0]!.duration).toBe(9.5);
    expect(p.scenes[1]!.duration).toBe(3);
  });
  it("never shortens a minimum duration when narration and music are combined", () => {
    const p=planVideo({scan,config:resolveConfig({url:scan.url,narration:{enabled:true},scenes:[{section:1,duration:1.5,narration:""}]}),viewportHeight:800,visibleHeight:700,beat:2/3});
    expect(p.scenes[0]!.duration).toBeGreaterThanOrEqual(1.5);
  });
  it("keeps the source plan unchanged", () => { const p=plan(), before=structuredClone(p);fitNarration(p,[20],30);expect(p).toEqual(before); });
  it("keeps spoken text when on-screen captions are hidden", () => {
    const p=planVideo({scan,config:resolveConfig({url:scan.url,captions:{enabled:false},scenes:[{section:1,narration:"A separate script"},{section:2,narration:""}]}),viewportHeight:800,visibleHeight:700});
    expect(p.scenes[0]).toMatchObject({caption:"",narration:"A separate script"});
    expect(p.scenes[1]!.narration).toBe("");
  });
});

describe("narration configuration and project roundtrip", () => {
  it("defaults to voice only when narration is requested, and supports optional music", () => {
    expect(resolveConfig({url:scan.url,narration:{enabled:true}}).music).toBe("none");
    expect(resolveConfig({url:scan.url,narration:{enabled:true},music:"calm"}).music).toBe("calm");
  });
  it("rejects conflicting sound sources and duration modes", () => {
    expect(()=>resolveConfig({url:scan.url,narration:{enabled:true},audio:"track.mp3"})).toThrow("not both");
    expect(()=>resolveConfig({url:scan.url,narration:{enabled:true},fitToAudio:true})).toThrow("fits each scene");
  });
  it.each([NaN,79,301,170.5])("rejects invalid speech rate %s", rate => expect(()=>resolveConfig({url:scan.url,narration:{rate}})).toThrow("words per minute"));
  it("preserves FPS, browser path, narration settings and other custom options in init", () => {
    const config=resolveConfig({url:scan.url,fps:24,chromePath:"/custom/chrome",language:"ar",narration:{enabled:true,voice:"Majed",rate:150},maxScenes:2});
    const project=projectFromScan(config,scan,700);
    expect(resolveConfig(project)).toMatchObject({fps:24,chromePath:"/custom/chrome",narration:config.narration,language:"ar",maxScenes:2});
    expect(project.scenes).toHaveLength(2);
  });
  it.each([{scenes:{}},{hide:"#banner"},{captions:null},{narration:true},{sfx:"false"},{url:1}])("rejects malformed JSON-shaped values", bad => {
    expect(()=>resolveConfig({url:scan.url,...bad} as any)).toThrow();
  });
});
