import type { Layout } from "./layout.js";

/**
 * Origin the compositor page is served from. Requests to it never leave the machine.
 * Plain http, so local http sites (localhost dev servers) load without mixed-content blocking.
 */
export const COMPOSITOR_ORIGIN = "http://showsite.local";

export interface CompositorOptions {
  layout: Layout;
  background: string;
  captionColor: string;
  host: string;
  dark: boolean;
}

/** Per-frame state handed to the compositor page. */
export interface ComposeState {
  key: string;
  text: string;
  /** Seconds since this scene started. */
  local: number;
  /** Scene length in seconds. */
  duration: number;
  animation: "words" | "fade" | "none";
  zoom: number;
  /** 0 = fully visible, 1 = covered by the background (fade in / out at the ends). */
  cover: number;
  /** Colour at the top of the site, used behind the phone's status bar. */
  statusColor?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export function compositorHtml(opts: CompositorOptions): string {
  const { layout: L, background, captionColor, host, dark } = opts;
  const f = L.frame;
  const s = L.screen;
  const barBg = dark ? "#2A2E39" : "#EEF0F3";
  const barFg = dark ? "#9AA1B0" : "#6B7280";
  const pillBg = dark ? "#1D2029" : "#FFFFFF";

  const frameHtml =
    f.kind === "phone"
      ? `<div id="frame" style="left:${f.x}px;top:${f.y}px;width:${f.width}px;height:${f.height}px;border-radius:${f.radius}px;background:#0B0C10;box-shadow:0 0 0 1.5px #3A3D46, 0 30px 60px rgba(0,0,0,.35)"></div>`
      : `<div id="frame" style="left:${f.x}px;top:${f.y}px;width:${f.width}px;height:${f.height}px;border-radius:${f.radius}px;background:${barBg};box-shadow:0 24px 60px rgba(0,0,0,.32)">
           ${
             f.bar
               ? `<div id="bar" style="height:${f.bar}px;background:${barBg}">
                    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                    <span id="url" style="background:${pillBg};color:${barFg}">${esc(host)}</span>
                  </div>`
               : ""
           }
         </div>`;

  const k = s.statusBar / 47;
  const px = (n: number) => `${(n * k).toFixed(2)}px`;
  const statusHtml = s.statusBar
    ? `<div id="status" style="height:${s.statusBar}px;padding:${px(3)} ${px(30)} 0 ${px(44)};font-size:${px(15.5)}">
         <span id="clock">9:41</span>
         <span id="icons" style="gap:${px(5)}">
           <svg width="${px(17)}" height="${px(11)}" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.6" y="5" width="3" height="6" rx="1"/><rect x="9.2" y="2.6" width="3" height="8.4" rx="1"/><rect x="13.8" y="0" width="3" height="11" rx="1"/></svg>
           <svg width="${px(15)}" height="${px(11)}" viewBox="0 0 15 11" fill="currentColor"><path d="M7.5 2.3c2.1 0 4 .8 5.4 2.1l1.1-1.1A9.2 9.2 0 0 0 7.5.7 9.2 9.2 0 0 0 1 3.3l1.1 1.1A7.7 7.7 0 0 1 7.5 2.3Zm0 3.2c1.2 0 2.3.4 3.2 1.2l1.1-1.1a6.1 6.1 0 0 0-8.6 0l1.1 1.1c.9-.8 2-1.2 3.2-1.2Zm0 3.1c-.5 0-.9.2-1.2.5l1.2 1.2 1.2-1.2c-.3-.3-.7-.5-1.2-.5Z"/></svg>
           <svg width="${px(26)}" height="${px(12)}" viewBox="0 0 26 12" fill="none"><rect x=".5" y=".5" width="22" height="11" rx="3.2" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="19" height="8" rx="2" fill="currentColor"/><path d="M24 4v4c.8-.3 1.3-1 1.3-2S24.8 4.3 24 4Z" fill="currentColor" opacity=".45"/></svg>
         </span>
       </div>
       <div id="island" style="left:calc(50% - ${px(60)});top:${px(10)};width:${px(120)};height:${px(31)};border-radius:${px(16)}"></div>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face { font-family: "Showsite Sans"; src: url(/fonts/ibm-plex-sans-latin.woff2) format("woff2"); font-weight: 100 700; }
@font-face { font-family: "Showsite Arabic"; src: url(/fonts/ibm-plex-sans-arabic-600.woff2) format("woff2"); font-weight: 400 700;
  unicode-range: U+0600-06FF, U+0750-077F, U+0870-08FF, U+200C-200E, U+FB50-FDFF, U+FE70-FEFC; }
html, body { margin: 0; width: ${L.css.width}px; height: ${L.css.height}px; overflow: hidden; background: ${background}; }
#stage { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${background}; }
#caption { position: absolute; left: ${L.caption.left}px; top: ${L.caption.top}px; width: ${L.caption.width}px; height: ${L.caption.height}px;
  display: flex; align-items: center; justify-content: center; }
#caption-text { margin: 0; max-width: 100%; text-align: center; color: ${captionColor};
  font-family: "Showsite Sans", "Showsite Arabic", system-ui, sans-serif; font-weight: 600; line-height: 1.18;
  font-size: ${L.caption.fontSize}px; text-wrap: balance; -webkit-font-smoothing: antialiased; }
/* Inline spans keep the browser's own bidi ordering, so mixed Arabic and English captions read correctly. */
#caption-text .w { position: relative; }
#frame { position: absolute; overflow: hidden; }
#bar { display: flex; align-items: center; gap: 6px; padding: 0 12px; box-sizing: border-box; position: relative; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: ${dark ? "#4A4F5C" : "#D3D7DE"}; flex: none; }
#url { position: absolute; left: 50%; transform: translateX(-50%); padding: 2px 18px; border-radius: 999px;
  font: 500 10px/1.4 "Showsite Sans", system-ui, sans-serif; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#status { position: absolute; left: 0; right: 0; top: 0; z-index: 3; box-sizing: border-box; display: flex; align-items: center;
  justify-content: space-between; background: #FFFFFF; color: #000000; font-family: "Showsite Sans", system-ui, sans-serif; font-weight: 600;
  letter-spacing: -0.01em; -webkit-font-smoothing: antialiased; }
#icons { display: inline-flex; align-items: center; }
#island { position: absolute; background: #0B0C10; z-index: 4; }
#screen { position: absolute; left: ${s.x}px; top: ${s.y}px; width: ${s.width}px; height: ${s.height}px; overflow: hidden;
  border-radius: ${s.radius}px; background: #FFFFFF; z-index: 2; ${f.kind === "none" ? "box-shadow: 0 24px 60px rgba(0,0,0,.32);" : ""} }
#camera { position: absolute; left: 0; right: 0; bottom: 0; top: ${s.statusBar}px; transform-origin: 50% 38%; will-change: transform; }
#site { display: block; border: 0; width: ${L.site.width}px; height: ${L.site.height}px; transform: scale(${L.site.scale}); transform-origin: 0 0; background: #FFFFFF; }
#cover { position: absolute; inset: 0; background: ${background}; opacity: 0; z-index: 5; pointer-events: none; }
</style>
</head>
<body>
<div id="stage">
  <div id="caption"><p id="caption-text"></p></div>
  ${frameHtml}
  <div id="screen">${statusHtml}<div id="camera"><iframe id="site" title="Website" allow="autoplay; fullscreen"
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"></iframe></div></div>
  <div id="cover"></div>
</div>
<script>
(() => {
  const text = document.getElementById("caption-text");
  const zone = document.getElementById("caption");
  const camera = document.getElementById("camera");
  const cover = document.getElementById("cover");
  const status = document.getElementById("status");
  let statusColor = "";
  const baseSize = ${L.caption.fontSize};
  const ARABIC = /[\\u0590-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]/;
  let currentKey = null;
  let words = [];

  function build(value) {
    text.textContent = "";
    const rtl = ARABIC.test(value);
    text.dir = rtl ? "rtl" : "ltr";
    text.style.letterSpacing = rtl ? "0" : "-0.012em";
    const parts = value.trim() ? value.trim().split(/\\s+/) : [];
    words = parts.map((part, i) => {
      const span = document.createElement("span");
      span.className = "w";
      span.textContent = part;
      text.appendChild(span);
      if (i < parts.length - 1) text.appendChild(document.createTextNode(" "));
      return span;
    });
    // Shrink long captions until they fit the caption zone.
    let size = baseSize;
    text.style.fontSize = size + "px";
    while (size > 12 && (text.scrollHeight > zone.clientHeight || text.scrollWidth > zone.clientWidth)) {
      size -= 1;
      text.style.fontSize = size + "px";
    }
  }

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);

  window.__compose = (s) => {
    if (s.key !== currentKey) {
      currentKey = s.key;
      build(s.text || "");
    }
    const out = clamp((s.duration - s.local) / 0.3);
    if (s.animation === "words") {
      const step = Math.min(0.07, 0.55 / Math.max(1, words.length));
      words.forEach((w, i) => {
        const p = easeOut(clamp((s.local - 0.08 - i * step) / 0.42));
        w.style.opacity = String(p * out);
        w.style.top = ((1 - p) * 0.38).toFixed(3) + "em";
      });
    } else {
      const p = s.animation === "fade" ? easeOut(clamp((s.local - 0.05) / 0.45)) : 1;
      words.forEach((w) => { w.style.opacity = String(p * out); w.style.top = "0"; });
    }
    camera.style.transform = "scale(" + s.zoom.toFixed(5) + ")";
    if (status && s.statusColor && s.statusColor !== statusColor) {
      statusColor = s.statusColor;
      const m = statusColor.match(/\\d+/g) || [255, 255, 255];
      const lum = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
      status.style.background = statusColor;
      status.style.color = lum > 0.6 ? "#000000" : "#FFFFFF";
    }
    cover.style.opacity = String(s.cover);
  };
})();
</script>
</body>
</html>`;
}
