// HugAnime local server: `npm start` serves the site AND the "is this server available?" check.
//   site:   http://localhost:3000/            (redirects to /home.html)
//   S-2:    GET /s2-episode?animeId=21&malId=21&episode=5&title=One+Piece   -> MegaPlay episode id (see anikoto.js)
//           GET /s2-debug?animeId=...&title=...                            -> why a title did / didn't resolve
//   skip:   GET /skip-times?malId=21&episode=5                             -> opening / ending times for Auto Skip (see aniskip.js)
//   check:  GET /server-check?animeId=21&malId=21&episode=5
//           -> { "availability": { "datsav:sub": true, "datsav:dub": false, ... } }
// No packages needed (Node 18+). Settings are read from ./.env (see .env.example) or the real environment:
//   PORT=3000   REFERER=https://your-site (some embed hosts want a referrer when we check them)
import "./env.js";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeAll } from "./Public/Js/server-check.js";
import { resolveEpisode, debugInfo, startCatalog } from "./anikoto.js";
import { getSkipTimes } from "./aniskip.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const REFERER = process.env.REFERER || "";
const CHECK_TTL = 5 * 60 * 1000;
const checkCache = new Map();

// only these folders are public; server.js, package.json etc. are never served
const PUBLIC_DIRS = ["Public", "Assets"];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8"
};

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
// text files are compressed once and kept in memory (re-done only when the file changes)
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".txt", ".ico"]);
const packed = new Map();
// images, fonts and audio rarely change -> the browser may keep them for a day; code files always revalidate (edits show up at once)
const LONG_CACHE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".woff", ".woff2", ".mp3", ".svg", ".ico"]);

const isId = (value) => /^\d{1,9}$/.test(String(value ?? ""));

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

// Check with the same referrer the real player will send (your site's address), unless REFERER is set
function refererFor(req) {
  if (REFERER) return REFERER;
  try {
    return new URL(req.headers.referer || req.headers.origin || "").origin + "/";
  } catch {
    return "";
  }
}

async function serverCheck(url, req, res) {
  const animeId = url.searchParams.get("animeId");
  const malId = url.searchParams.get("malId");
  const episode = url.searchParams.get("episode");
  if (!isId(animeId) || !isId(episode)) return sendJson(res, 400, { error: "animeId and episode are required" });

  const key = `${animeId}:${malId}:${episode}`;
  const hit = checkCache.get(key);
  if (hit && Date.now() - hit.at < CHECK_TTL) return sendJson(res, 200, { availability: hit.value });

  const availability = await probeAll({ animeId, malId: isId(malId) ? malId : "" }, episode, { pages: true, referer: refererFor(req) });
  checkCache.set(key, { at: Date.now(), value: availability });
  sendJson(res, 200, { availability });
}

// S-2 needs MegaPlay's own episode id (not the AniList / MAL id); anikoto.js looks it up
function s2Params(url) {
  const animeId = url.searchParams.get("animeId");
  const malId = url.searchParams.get("malId");
  const episode = url.searchParams.get("episode");
  if (!isId(animeId) || !isId(episode)) return null;
  const titles = url.searchParams.getAll("title").slice(0, 8).map((t) => t.slice(0, 160)).filter(Boolean);
  return { animeId, malId: isId(malId) ? malId : "", episode, titles };
}

async function s2Episode(url, res, debug) {
  const params = s2Params(url);
  if (!params) return sendJson(res, 400, { error: "animeId and episode are required" });
  sendJson(res, 200, debug ? await debugInfo(params) : await resolveEpisode(params));
}

async function skipTimes(url, res) {
  const malId = url.searchParams.get("malId");
  const episode = url.searchParams.get("episode");
  if (!isId(malId) || !isId(episode)) return sendJson(res, 400, { error: "malId and episode are required" });
  sendJson(res, 200, await getSkipTimes({ malId, episode }));
}

async function serveFile(pathname, req, res) {
  let relative;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }

  // URLs map like this:  /home.html -> Public/home.html,  /Css/x.css -> Public/Css/x.css,
  //                      /Assets/x.png -> Assets/x.png   (old /Public/... URLs still work)
  if (/^Public(\/|$)/.test(relative)) relative = relative.replace(/^Public\/?/, "");
  const base = /^Assets(\/|$)/.test(relative) ? ROOT : path.join(ROOT, "Public");
  const file = path.resolve(base, relative);
  const top = path.relative(ROOT, file).split(path.sep)[0];
  // stay inside Public/ or Assets/ (also blocks ../ tricks)
  if (!PUBLIC_DIRS.includes(top) || path.relative(ROOT, file).startsWith("..")) {
    res.writeHead(404);
    return res.end("Not found");
  }

  try {
    let target = file;
    let info = await stat(target);
    if (info.isDirectory()) { target = path.join(target, "index.html"); info = await stat(target); }
    const ext = path.extname(target).toLowerCase();
    const type = TYPES[ext] || "application/octet-stream";
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const headers = {
      "Content-Type": type,
      "Cache-Control": ext === ".mp3" ? "public, max-age=3600" : LONG_CACHE.has(ext) ? "public, max-age=86400" : "no-cache",
      ETag: etag,
      "Last-Modified": info.mtime.toUTCString(),
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes"
    };

    // nothing changed since the browser's copy -> tiny 304 answer
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    // audio / video: support Range requests so seeking and replaying work smoothly
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && (ext === ".mp3" || ext === ".mp4" || ext === ".webm")) {
      let start = range[1] === "" ? Math.max(0, info.size - Number(range[2])) : Number(range[1]);
      let end = range[1] === "" || range[2] === "" ? info.size - 1 : Math.min(Number(range[2]), info.size - 1);
      if (start > end || start >= info.size) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` });
        return res.end();
      }
      const data = await readFile(target);
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": end - start + 1 });
      return res.end(req.method === "HEAD" ? undefined : data.subarray(start, end + 1));
    }

    let body;
    let encoding = "";
    if (COMPRESSIBLE.has(ext)) {
      const accept = String(req.headers["accept-encoding"] || "");
      encoding = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : "";
      const key = `${target}|${encoding}`;
      const hit = packed.get(key);
      if (hit && hit.etag === etag) body = hit.body;
      else {
        const raw = await readFile(target);
        body = encoding === "br" ? await brotli(raw) : encoding === "gzip" ? await gzipAsync(raw, { level: 9 }) : raw;
        packed.set(key, { etag, body });
      }
      headers.Vary = "Accept-Encoding";
      if (encoding) headers["Content-Encoding"] = encoding;
    } else {
      body = await readFile(target);
    }
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/server-check") return await serverCheck(url, req, res);
    if (url.pathname === "/s2-episode") return await s2Episode(url, res, false);
    if (url.pathname === "/s2-debug") return await s2Episode(url, res, true);
    if (url.pathname === "/skip-times") return await skipTimes(url, res);
    if (url.pathname === "/") {
      res.writeHead(302, { Location: "/home.html" });
      return res.end();
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end("Method not allowed");
    }
    // /watch.html/the-anime-title/ep-1 is the watch page (watch.js reads the title and episode from the address)
    await serveFile(/^\/watch\.html\/.+/.test(url.pathname) ? "/watch.html" : url.pathname, req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`HugAnime is running:  http://localhost:${PORT}`);
  startCatalog().catch((error) => console.warn("[s-2] catalog not started:", error.message));
});