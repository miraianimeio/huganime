// YouTube search for the Anime Music page (route /yt-search, see server.js).
// Uses the official YouTube Data API v3, so it needs a free API key:  YOUTUBE_API_KEY=...  in .env
// (Google Cloud Console > create a project > enable "YouTube Data API v3" > Credentials > API key).
// One search costs 100 of the 10,000 free units per day, so answers are cached for a week (and kept in
// data/.yt-cache.json), and only videos that are allowed to be embedded on other sites are returned.
import "./env.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(ROOT, "data", ".yt-cache.json");
const TTL = 7 * 24 * 60 * 60 * 1000;
const cache = new Map();   // "q" -> { at, results }
let loaded = false;
let saveTimer = 0;

async function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    for (const [key, value] of Object.entries(saved)) if (value && Date.now() - value.at < TTL) cache.set(key, value);
  } catch { /* first run */ }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
    } catch { /* caching is optional */ }
  }, 2000);
  saveTimer.unref?.();
}

const decode = (text) => String(text || "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;|&#x27;/g, "'");

/** @returns {Promise<{results: {id,title,channel,thumb}[]} | {error: "no-key"|"quota"|"failed", message?: string}>} */
export async function searchYouTube(query, { limit = 10 } = {}) {
  const q = String(query || "").trim().slice(0, 120);
  if (q.length < 2) return { results: [] };
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { error: "no-key" };

  await loadCache();
  const cacheKey = `${limit}:${q.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL) return { results: hit.results };

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet", type: "video", videoEmbeddable: "true", videoSyndicated: "true", safeSearch: "none",
    maxResults: String(limit), q, key
  }).toString();

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = json?.error?.errors?.[0]?.reason || "";
      if (response.status === 403 && /quota|rateLimit/i.test(reason)) return { error: "quota" };
      return { error: "failed", message: json?.error?.message || `HTTP ${response.status}` };
    }
    const results = (json.items || [])
      .filter((item) => item?.id?.videoId)
      .map((item) => ({
        id: item.id.videoId,
        title: decode(item.snippet?.title),
        channel: decode(item.snippet?.channelTitle),
        thumb: item.snippet?.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`
      }));
    cache.set(cacheKey, { at: Date.now(), results });
    saveSoon();
    return { results };
  } catch (error) {
    return { error: "failed", message: String(error.message || error) };
  }
}
