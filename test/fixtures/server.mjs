// A small site that behaves like real ones do: it forbids framing, redirects,
// lazy-loads slow images and shows a cookie banner. Used to test showsite.
//   node test/fixtures/server.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.argv[2] ?? 4321);
const here = new URL("./", import.meta.url);
const colors = ["#ff7a59", "#ffd166", "#06d6a0", "#118ab2", "#8338ec", "#ef476f"];

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const deny = {
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
  };

  if (url.pathname === "/") {
    res.writeHead(302, { location: "/home", ...deny });
    return res.end();
  }
  if (url.pathname === "/home") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...deny });
    return res.end(await readFile(new URL("site/home.html", here)));
  }
  const clip = /^\/clip\.(mp4|webm)$/.exec(url.pathname);
  if (clip) {
    const body = await readFile(new URL(`clip.${clip[1]}`, here));
    res.writeHead(200, { "content-type": `video/${clip[1]}`, "content-length": body.length, "accept-ranges": "bytes" });
    return res.end(body);
  }
  const img = /^\/img\/(\d)\.svg$/.exec(url.pathname);
  if (img) {
    await new Promise((r) => setTimeout(r, 600));
    const c = colors[(Number(img[1]) - 1) % colors.length];
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=3600" });
    return res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${c}"/><text x="200" y="170" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">${img[1]}</text></svg>`,
    );
  }
  res.writeHead(404);
  res.end("not found");
}).listen(port, () => console.log(`fixture site on http://localhost:${port}`));
