/**
 * Code that runs inside the website being recorded.
 *
 * Kept as plain strings (not bundled functions) so what runs in the page is
 * exactly what is written here.
 */

/** Installed in every frame before any of the site's own scripts run. */
export const INIT_SCRIPT = String.raw`(() => {
  if (window.__showsite) return;
  const tracked = new WeakMap();

  const BUILTIN_HIDE = [
    // Cookie and consent banners
    "#onetrust-consent-sdk", "#onetrust-banner-sdk", "#CybotCookiebotDialog", "#cookiebanner", "#cookie-banner",
    "#cookie-notice", "#cookie-law-info-bar", ".cky-consent-container", ".cc-window", ".cc-banner", "#usercentrics-root",
    ".osano-cm-window", "#truste-consent-track", ".qc-cmp2-container", "#didomi-host", "#axeptio_overlay",
    "[aria-label='cookieconsent']", ".cookie-consent", ".cookieConsent",
    // Chat widgets
    "#intercom-container", ".intercom-lightweight-app", ".intercom-launcher", "#hubspot-messages-iframe-container",
    ".crisp-client", "#crisp-chatbox", "#tidio-chat", "#tidio-chat-iframe", "#drift-widget", "#drift-frame-controller",
    "#launcher", "#chat-widget-container", ".tawk-min-container", "iframe[title*='chat' i]", ".fb_dialog",
    "#zsiq_float", ".zsiq_floatmain", "#fc_frame", "#freshworks-container", "#gorgias-chat-container"
  ];

  const CONSENT_TEXT = /cookie|consent|gdpr|privacy preferences|ملفات تعريف الارتباط|الكوكيز|ملفات الارتباط/i;

  function prepare(extraHide) {
    const style = document.getElementById("__showsite_style") || document.createElement("style");
    style.id = "__showsite_style";
    const hidden = BUILTIN_HIDE.concat(extraHide || []);
    style.textContent =
      hidden.join(",") + "{display:none!important;visibility:hidden!important}" +
      "html,body{scroll-behavior:auto!important;scrollbar-width:none!important}" +
      "html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}" +
      "*{caret-color:transparent!important}";
    (document.head || document.documentElement).appendChild(style);

    // Fixed banners that talk about cookies or consent.
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      if (el.offsetHeight > vh * 0.7) continue;
      const text = (el.innerText || "").slice(0, 600);
      if (CONSENT_TEXT.test(text)) el.style.setProperty("display", "none", "important");
    }

    // Lazy images below the fold: load them now (from cache), so nothing pops in on camera.
    for (const img of document.querySelectorAll("img[loading='lazy']")) img.loading = "eager";
  }

  function waitForImagesInView() {
    const vh = window.innerHeight;
    const waits = [];
    for (const img of document.images) {
      if (img.complete) continue;
      const r = img.getBoundingClientRect();
      if (r.bottom < -vh * 0.25 || r.top > vh * 1.25) continue;
      waits.push(new Promise((done) => {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        setTimeout(done, 1500);
      }));
    }
    return Promise.all(waits);
  }

  /**
   * Move every CSS animation, transition and video to virtual time "vt" (ms).
   * The recording is captured frame by frame, so animations follow the video's
   * clock instead of the wall clock: smooth, and the same on every render.
   */
  async function tick(vt) {
    for (const a of document.getAnimations()) {
      let start = tracked.get(a);
      if (start === undefined) {
        const ct = typeof a.currentTime === "number" ? a.currentTime : 0;
        start = vt - ct;
        tracked.set(a, start);
        try { a.pause(); } catch {}
      }
      try { a.currentTime = Math.max(0, vt - start); } catch {}
    }

    const waits = [];
    for (const v of document.querySelectorAll("video")) {
      if (v.__showsiteStart === undefined) {
        if (v.paused && !v.autoplay) continue;
        v.__showsiteStart = vt - (v.currentTime || 0) * 1000;
        try { v.pause(); } catch {}
      }
      if (v.readyState < 1) continue;
      let ct = (vt - v.__showsiteStart) / 1000;
      const d = v.duration;
      if (isFinite(d) && d > 0) ct = v.loop ? ct % d : Math.min(ct, d - 0.04);
      if (Math.abs(v.currentTime - ct) > 0.001) {
        waits.push(new Promise((done) => {
          v.addEventListener("seeked", done, { once: true });
          setTimeout(done, 300);
        }));
        v.currentTime = ct;
      }
    }

    waits.push(waitForImagesInView());
    await Promise.all(waits);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return topColor();
  }

  // The colour at the very top of the page, for the phone's status bar. Any CSS colour
  // (oklch, color-mix…) is turned into rgb by painting it on a 1x1 canvas.
  let swatch = null;
  function toRgb(color) {
    if (!swatch) {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      swatch = c.getContext("2d", { willReadFrequently: true });
    }
    swatch.clearRect(0, 0, 1, 1);
    swatch.fillStyle = "rgba(0,0,0,0)";
    swatch.fillStyle = color;
    swatch.fillRect(0, 0, 1, 1);
    const d = swatch.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }
  function topColor() {
    try {
      for (let el = document.elementFromPoint(2, 1); el; el = el.parentElement) {
        const c = toRgb(getComputedStyle(el).backgroundColor);
        if (c.a > 128) return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
      }
      for (const el of [document.body, document.documentElement]) {
        if (!el) continue;
        const c = toRgb(getComputedStyle(el).backgroundColor);
        if (c.a > 128) return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
      }
    } catch {}
    return "rgb(255,255,255)";
  }

  function scrollToY(y) {
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
  }

  window.__showsite = { prepare, tick, scrollToY, waitForImagesInView };
})();`;

/**
 * Finds the sections of a page and a caption for each one.
 * Returns plain data, evaluated inside the site's frame.
 */
export const SCAN_SCRIPT = String.raw`(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const se = document.scrollingElement || document.documentElement;
  const pageHeight = Math.max(se.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const absTop = (el) => el.getBoundingClientRect().top + window.scrollY;

  const isCandidate = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return false;
    const r = el.getBoundingClientRect();
    return r.width >= vw * 0.55 && r.height >= Math.min(180, vh * 0.25) && r.height < pageHeight * 0.85;
  };

  let cands = Array.from(document.querySelectorAll(
    "header, section, footer, article, main > *, [role='region'], [role='banner'], [role='contentinfo'], [id], [class*='section' i]"
  )).filter(isCandidate);

  // Drop wrappers: an element holding two or more other candidates is a container, not a section.
  let changed = true;
  while (changed) {
    changed = false;
    const set = new Set(cands);
    cands = cands.filter((el) => {
      let inner = 0;
      for (const other of set) if (other !== el && el.contains(other)) inner++;
      if (inner >= 2) { changed = true; return false; }
      return true;
    });
  }
  // Keep the outermost of what remains.
  const keep = new Set(cands);
  cands = cands.filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (keep.has(p)) return false;
    return true;
  });
  cands.sort((a, b) => absTop(a) - absTop(b));

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const shorten = (s, max) => {
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const space = cut.lastIndexOf(" ");
    return (space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[,;:\-–—]+$/, "") + "…";
  };
  const headingIn = (el) => {
    for (const h of el.querySelectorAll("h1, h2, h3, [role='heading']")) {
      const r = h.getBoundingClientRect();
      const text = clean(h.innerText);
      if (r.width > 0 && r.height > 0 && text) return text;
    }
    return "";
  };
  const humanize = (id) => clean(id.replace(/[-_]+/g, " ")).replace(/^\w/, (c) => c.toUpperCase());
  const validId = (id) => /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll("#" + id).length === 1;
  const cssPath = (el) => {
    if (el.id && validId(el.id)) return "#" + el.id;
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (e.id && validId(e.id)) { parts.unshift("#" + e.id); return parts.join(" > "); }
      let part = e.tagName.toLowerCase();
      const parent = e.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((x) => x.tagName === e.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(e) + 1) + ")";
      }
      parts.unshift(part);
    }
    return "body > " + parts.join(" > ");
  };

  let sections = cands.map((el, i) => {
    const heading = headingIn(el);
    const tag = el.tagName.toLowerCase();
    const isFooter = tag === "footer" || el.getAttribute("role") === "contentinfo";
    return {
      name: shorten(heading || (el.id ? humanize(el.id) : "") || el.getAttribute("aria-label") || (isFooter ? "Footer" : "Section " + (i + 1)), 48),
      caption: shorten(heading, 64),
      top: Math.round(absTop(el)),
      height: Math.round(el.getBoundingClientRect().height),
      selector: cssPath(el),
      kind: isFooter ? "footer" : "section",
    };
  });

  const covered = sections.reduce((sum, s) => sum + s.height, 0);
  if (sections.length < 2 || covered < pageHeight * 0.4) {
    // No clear sections: split the page into screen-sized chunks.
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .map((h) => ({ top: absTop(h), text: clean(h.innerText) }))
      .filter((h) => h.text);
    const count = Math.max(1, Math.min(8, Math.ceil(pageHeight / vh)));
    sections = [];
    for (let i = 0; i < count; i++) {
      const top = Math.round(i * vh);
      if (top >= pageHeight) break;
      const h = headings.find((x) => x.top >= top && x.top < top + vh);
      sections.push({
        name: h ? shorten(h.text, 48) : "Part " + (i + 1),
        caption: h ? shorten(h.text, 64) : "",
        top,
        height: Math.min(vh, pageHeight - top),
        selector: "",
        kind: "section",
      });
    }
  }

  if (sections[0]) {
    sections[0].kind = "hero";
    const h1 = document.querySelector("h1");
    const h1Text = h1 ? clean(h1.innerText) : "";
    if (!sections[0].caption && h1Text) sections[0].caption = shorten(h1Text, 64);
  }

  // A header that stays on screen while scrolling covers the top of every section.
  let stickyTop = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.top) > 4 || r.width < vw * 0.8 || r.height < 20 || r.height > vh * 0.25) continue;
    stickyTop = Math.max(stickyTop, Math.round(r.bottom));
  }

  // Videos the browser can't decode (MP4/H.264 in Playwright's Chromium) show up as empty boxes.
  const brokenVideos = Array.from(document.querySelectorAll("video"))
    .filter((v) => (v.error && v.error.code === 4) || v.networkState === 3).length;

  return {
    title: clean(document.title),
    brokenVideos,
    stickyTop,
    lang: document.documentElement.lang || "",
    dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction || "ltr",
    pageHeight,
    viewport: { width: vw, height: vh },
    sections: sections.map((s, i) => Object.assign({ index: i + 1 }, s)),
  };
})()`;

/** Top of the element matching a selector, in page coordinates, or null. */
export const LOCATE_SCRIPT = (selector: string) => String.raw`(() => {
  let el = null;
  try { el = document.querySelector(${JSON.stringify(selector)}); } catch { return { error: "invalid" }; }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const h = el.querySelector("h1, h2, h3, [role='heading']");
  return { top: Math.round(r.top + window.scrollY), height: Math.round(r.height), caption: h ? (h.innerText || "").replace(/\s+/g, " ").trim() : "" };
})()`;
