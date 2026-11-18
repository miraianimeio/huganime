// S-2 lookup: AniList anime + episode number  ->  MegaPlay episode id (Anikoto's "episode_embed_id").
//
// MegaPlay's S-2 player URL is   https://megaplay.buzz/videojs/stream/s-2/{episodeId}/{sub|dub}
// and {episodeId} comes from the Anikoto catalog API:  GET https://anikotoapi.site/series/{seriesId}.
// Nothing documented maps an AniList id to Anikoto's {seriesId}, so this file builds that mapping:
//   1. data/s2-series.json      manual list { "<anilistId>": <anikotoSeriesId> }  (always wins, fixes wrong matches)
//   2. the Anikoto catalog      crawled from /recent-anime in the background, matched by AniList id, MAL id or exact title
// The Anikoto response format is not published, so the parsing below tries the usual field names.
// If a title doesn't resolve, open /s2-debug?animeId=...&title=... to see what was found.
import "./env.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.ANIKOTO_API || "https://anikotoapi.site").replace(/\/+$/, "");
const OVERRIDES_FILE = path.join(ROOT, "data", "s2-series.json");
const CATALOG_FILE = path.join(ROOT, "data", ".anikoto-catalog.json");
const MAX_PAGES = Number(process.env.ANIKOTO_MAX_PAGES) || 400;  // 400 pages x 100 = 40,000 series (the whole catalog is ~9,000)
const PER_PAGE = Number(process.env.ANIKOTO_PER_PAGE) || 100;
const CRAWL_GAP_MS = Number(process.env.ANIKOTO_CRAWL_GAP_MS) || 2300;   // stays under the API's ~55 requests / 2 minutes
const RATE_WAIT_MS = Number(process.env.ANIKOTO_RATE_WAIT_MS) || 30000;  // pause when the API answers 429 (too many requests)
const CATALOG_VERSION = 2;   // bump when the saved catalog format / crawl size changes (old files are re-crawled)
const CATALOG_TTL = 12 * 60 * 60 * 1000;
const EPISODES_TTL = 30 * 60 * 1000;
const UA = "Mozilla/5.0 (compatible; HugAnime/1.0)";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- helpers */

async function getJson(url, timeoutMs = 12000) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status} for ${url}`);
    error.status = res.status;
    error.retryAfter = Number(res.headers.get("retry-after")) || 0;
    throw error;
  }
  return res.json();
}

// the first array of objects found anywhere in a response (APIs wrap lists as data / results / items ...)
function findObjectArray(value, depth = 0) {
  if (Array.isArray(value)) return value.length && typeof value[0] === "object" ? value : value.length ? null : value;
  if (!value || typeof value !== "object" || depth > 4) return null;
  for (const key of ["data", "results", "items", "episodes", "series", "anime", "list", "result"]) {
    if (key in value) {
      const found = findObjectArray(value[key], depth + 1);
      if (found) return found;
    }
  }
  for (const inner of Object.values(value)) {
    const found = findObjectArray(inner, depth + 1);
    if (found && found.length) return found;
  }
  return null;
}

const pick = (obj, keys) => {
  for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  return undefined;
};

const asId = (v) => (v === undefined || v === null || v === "" ? "" : String(v).trim());

export function normalizeTitle(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .trim();
}

function titlesOf(item) {
  const out = [];
  const add = (v) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") Object.values(v).forEach(add);
  };
  for (const key of ["title", "name", "english", "title_english", "romaji", "title_romaji", "japanese", "jp_title", "native", "alt_title", "alternative_titles", "synonyms", "other_names"]) add(item[key]);
  return out.map(normalizeTitle).filter(Boolean);
}

/* ---------------------------------------------------------------- catalog index */

const catalog = {
  byTitle: new Map(),      // normalized title -> anikoto series id
  byMal: new Map(),
  byAnilist: new Map(),
  ids: new Set(),          // every anikoto series id indexed so far
  pages: 0,
  series: 0,
  updatedAt: 0,
  complete: false,         // true once a crawl reached the end of the list
  resumePage: 0,           // where an interrupted crawl continues (0 = start from page 1)
  crawling: false,
  lastError: "",
  sampleKeys: []
};

function indexItem(item) {
  const id = asId(pick(item, ["id", "series_id", "seriesId", "anime_id", "animeId"]));
  if (!id) return "";
  catalog.ids.add(id);
  for (const title of titlesOf(item)) if (!catalog.byTitle.has(title)) catalog.byTitle.set(title, id);
  const mal = asId(pick(item, ["mal_id", "malId", "mal"]));
  const ani = asId(pick(item, ["anilist_id", "anilistId", "al_id", "ani_id", "anilist"]));
  if (mal) catalog.byMal.set(mal, id);
  if (ani) catalog.byAnilist.set(ani, id);
  return id;
}

async function saveCatalog() {
  try {
    await mkdir(path.dirname(CATALOG_FILE), { recursive: true });
    await writeFile(CATALOG_FILE, JSON.stringify({
      version: CATALOG_VERSION,
      perPage: PER_PAGE,
      complete: catalog.complete,
      resumePage: catalog.resumePage,
      updatedAt: catalog.updatedAt,
      pages: catalog.pages,
      byTitle: [...catalog.byTitle],
      byMal: [...catalog.byMal],
      byAnilist: [...catalog.byAnilist]
    }));
  } catch { /* caching is optional */ }
}

async function loadCatalogFile() {
  try {
    const saved = JSON.parse(await readFile(CATALOG_FILE, "utf8"));
    catalog.byTitle = new Map(saved.byTitle);
    catalog.byMal = new Map(saved.byMal);
    catalog.byAnilist = new Map(saved.byAnilist);
    catalog.ids = new Set([...catalog.byTitle.values(), ...catalog.byMal.values(), ...catalog.byAnilist.values()]);
    catalog.pages = saved.pages || 0;
    catalog.series = catalog.ids.size;
    // Only trust "complete" / the resume point when the file was written by this crawl format.
    // An older file (e.g. the 3,200-series one) still helps as a head start but is re-crawled from page 1.
    const current = saved.version === CATALOG_VERSION && saved.perPage === PER_PAGE;
    catalog.complete = current && saved.complete === true;
    catalog.resumePage = current && !catalog.complete ? Number(saved.resumePage) || 0 : 0;
    catalog.updatedAt = current ? saved.updatedAt || 0 : 0;
  } catch { /* first run */ }
}

// One page of the list. A 429 (rate limit), a 5xx or a network hiccup is retried a few times instead of ending the crawl.
async function fetchCatalogPage(page) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJson(`${API}/recent-anime?page=${page}&per_page=${PER_PAGE}`);
    } catch (error) {
      const retryable = error.status === 429 || error.status >= 500 || !error.status;
      if (!retryable || attempt >= 4) throw error;
      catalog.lastError = String(error.message || error);   // visible on /s2-debug and in the player while we retry
      await wait(error.status === 429 ? Math.max(error.retryAfter * 1000, RATE_WAIT_MS) : 5000 * (attempt + 1));
    }
  }
}

export async function crawlCatalog() {
  if (catalog.crawling) return;
  catalog.crawling = true;
  catalog.lastError = "";
  let page = catalog.resumePage > 0 ? catalog.resumePage : 1;
  let finished = false;
  try {
    const seen = new Set();   // series seen during THIS crawl (a page that adds none means the list has ended)
    let pageSize = 0;         // the API may serve fewer per page than we asked for
    for (; page <= MAX_PAGES; page++) {
      const json = await fetchCatalogPage(page);
      // the API says whether a reply worked ("ok"); an error body must never be mistaken for "end of list"
      catalog.lastError = "";   // that page worked
      if (json && json.ok === false) throw new Error(String(json.error || json.message || "the catalog API answered ok: false"));
      const list = findObjectArray(json) || [];
      if (!list.length && page === 1 && !seen.size && !catalog.ids.size) throw new Error("the catalog API returned no anime on page 1");
      if (!list.length) { finished = true; break; }
      if (!pageSize) pageSize = list.length;
      if (!catalog.sampleKeys.length) catalog.sampleKeys = Object.keys(list[0] || {});

      const before = seen.size;
      for (const item of list) {
        const id = indexItem(item);
        if (id) seen.add(id);
      }
      catalog.pages = page;
      catalog.series = catalog.ids.size;
      if (seen.size === before) { finished = true; break; }          // nothing new: the API repeated a page
      if (list.length < pageSize) { finished = true; break; }        // short page: that was the last one
      catalog.resumePage = page + 1;
      if (page % 10 === 0) {                                          // keep progress if the server is stopped mid-crawl
        console.log(`[s-2] downloading the Anikoto list: page ${page}, ${catalog.series} anime so far`);
        await saveCatalog();
      }
      await wait(CRAWL_GAP_MS);
    }
    if (page > MAX_PAGES) finished = true;                            // reached the configured limit
  } catch (error) {
    catalog.lastError = String(error.message || error);
    catalog.resumePage = page;                                        // try this page again next time
    console.warn("[s-2] catalog crawl stopped:", catalog.lastError);
  } finally {
    if (finished) {
      catalog.complete = true;
      catalog.resumePage = 0;
      catalog.updatedAt = Date.now();
      console.log(`[s-2] Anikoto list ready: ${catalog.series} anime`);
    }
    catalog.crawling = false;
    await saveCatalog();
  }
}

/** Call once when the server starts: loads the saved index, then refreshes it in the background. */
export async function startCatalog() {
  await loadCatalogFile();
  const stale = !catalog.complete || Date.now() - catalog.updatedAt > CATALOG_TTL;
  if (stale) crawlCatalog();   // an unfinished crawl continues where it stopped
  // retry an unfinished crawl every 10 minutes (e.g. after a rate limit); a finished one is refreshed every 12 hours
  setInterval(() => {
    if (!catalog.complete || Date.now() - catalog.updatedAt > CATALOG_TTL) crawlCatalog();
  }, 10 * 60 * 1000).unref();
}

/* ---------------------------------------------------------------- series + episodes */

async function readOverrides() {
  try { return JSON.parse(await readFile(OVERRIDES_FILE, "utf8")) || {}; } catch { return {}; }
}

export async function findSeries({ animeId, malId, titles = [] }) {
  const overrides = await readOverrides();
  const manual = asId(overrides[animeId]);
  if (manual) return { seriesId: manual, matchedBy: "data/s2-series.json" };

  const byAnilist = catalog.byAnilist.get(asId(animeId));
  if (byAnilist) return { seriesId: byAnilist, matchedBy: "anilist id" };
  const byMal = malId ? catalog.byMal.get(asId(malId)) : "";
  if (byMal) return { seriesId: byMal, matchedBy: "mal id" };

  for (const title of titles) {
    const hit = catalog.byTitle.get(normalizeTitle(title));
    if (hit) return { seriesId: hit, matchedBy: `title "${title}"` };
  }
  return { seriesId: "", matchedBy: "" };
}

const episodeCache = new Map();

const truthy = (v) => v === true || v === 1 || v === "1" || v === "true" || (typeof v === "string" && /^(yes|sub|dub)$/i.test(v)) || (Number(v) > 0);
const falsy = (v) => v === false || v === 0 || v === "0" || v === "false" || v === null;

// Does this episode have <lang> ("sub" / "dub")? true / false, or null when the response says nothing about it.
// Anikoto lists each episode with  embed_url: { sub, dub }  (a language that is missing or empty = not available),
// older shapes use plain  sub / dub / has_dub  fields. Any field whose name mentions the language counts.
const nonEmpty = (v) => {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") return v.trim() !== "" && !/^(0|false|null|none|no)$/i.test(v.trim());
  if (Array.isArray(v)) return v.some(nonEmpty);
  if (typeof v === "object") return Object.values(v).some(nonEmpty);
  return false;
};
export function languageFlag(item, lang) {
  const found = [];
  const scan = (obj, depth) => {
    if (!obj || typeof obj !== "object" || depth > 2) return;
    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes(lang)) found.push(nonEmpty(value));
      else if (value && typeof value === "object" && !Array.isArray(value)) scan(value, depth + 1);
    }
  };
  scan(item, 0);
  if (found.length) return found.some(Boolean);
  // "embed_url" lists only the languages that exist: present for other languages but absent for this one = not available
  const listsLanguages = Object.entries(item || {}).some(([key, value]) => /embed/i.test(key) && value && typeof value === "object" && Object.keys(value).length > 0);
  return listsLanguages ? false : null;
}

export async function loadEpisodes(seriesId) {
  const hit = episodeCache.get(seriesId);
  if (hit && Date.now() - hit.at < EPISODES_TTL) return hit.value;

  const json = await getJson(`${API}/series/${encodeURIComponent(seriesId)}`);
  const list = findObjectArray(json?.data?.episodes) || findObjectArray(json?.episodes) || findObjectArray(json) || [];
  const episodes = list
    .map((item) => {
      const number = Number(pick(item, ["number", "episode", "episode_no", "episodeNo", "ep", "num", "episode_number"]));
      const embed = asId(pick(item, ["episode_embed_id", "embed_id", "embedId", "episodeEmbedId"]));
      return { number, embed, hasSub: languageFlag(item, "sub"), hasDub: languageFlag(item, "dub") };
    })
    .filter((e) => Number.isFinite(e.number) && e.embed);

  const value = { episodes, sampleKeys: Object.keys(list[0] || {}), count: list.length };
  episodeCache.set(seriesId, { at: Date.now(), value });
  return value;
}

/**
 * @returns {Promise<{episodeId: string|null, hasSub: boolean|null, hasDub: boolean|null, seriesId?: string, matchedBy?: string, reason?: string, transient?: boolean}>}
 * transient = true means "could not tell right now" (catalog still loading / incomplete, or the API failed), so the page must not hide S-2 for it
 */
export async function resolveEpisode({ animeId, malId, titles, episode }) {
  const { seriesId, matchedBy } = await findSeries({ animeId, malId, titles });
  if (!seriesId) {
    const note = catalog.crawling ? " (the catalog is still loading, try again in a minute)" : catalog.series ? "" : " (the catalog is empty)";
    return {
      episodeId: null, hasSub: null, hasDub: null,
      reason: "this anime was not found in the Anikoto catalog" + note,
      transient: Boolean(catalog.crawling || !catalog.complete || !catalog.series || catalog.lastError),
      lastError: catalog.lastError || "",
      progress: { series: catalog.series, pages: catalog.pages, crawling: catalog.crawling, complete: catalog.complete }
    };
  }
  try {
    const { episodes } = await loadEpisodes(seriesId);
    const match = episodes.find((e) => e.number === Number(episode));
    if (!match) return { episodeId: null, hasSub: null, hasDub: null, seriesId, matchedBy, reason: `episode ${episode} is not listed for series ${seriesId}` };
    return { episodeId: match.embed, hasSub: match.hasSub, hasDub: match.hasDub, seriesId, matchedBy };
  } catch (error) {
    return { episodeId: null, hasSub: null, hasDub: null, seriesId, matchedBy, reason: String(error.message || error), transient: true };
  }
}

/** What the /s2-debug page shows, to see why a title did or didn't resolve. */
export async function debugInfo({ animeId, malId, titles, episode }) {
  const result = await resolveEpisode({ animeId, malId, titles, episode: episode || 1 });
  let sample = null;
  if (result.seriesId) {
    try {
      const { sampleKeys, count, episodes } = await loadEpisodes(result.seriesId);
      sample = {
        episodeFieldNames: sampleKeys, episodesInResponse: count, episodeNumbers: episodes.map((e) => e.number).slice(0, 60),
        languages: episodes.slice(0, 5).map((e) => ({ episode: e.number, hasSub: e.hasSub, hasDub: e.hasDub }))
      };
    } catch { /* shown in result.reason */ }
  }
  // catalog entries whose title shares words with the asked anime: shows whether Anikoto lists it under another name
  const asked = (titles || []).find(Boolean) || "";
  const words = [...new Set(normalizeTitle(asked).split(" "))].filter((w) => w.length > 2);
  const closestTitles = words.length
    ? [...catalog.byTitle]
        .map(([title, id]) => ({ title, seriesId: id, score: words.filter((w) => title.includes(w)).length }))
        .filter((c) => c.score >= Math.min(2, words.length))
        .sort((x, y) => y.score - x.score || x.title.length - y.title.length)
        .slice(0, 12)
        .map(({ title, seriesId }) => ({ title, seriesId }))
    : [];
  return {
    result,
    catalog: { api: API, series: catalog.series, pagesCrawled: catalog.pages, complete: catalog.complete, resumePage: catalog.resumePage, crawling: catalog.crawling, updatedAt: catalog.updatedAt ? new Date(catalog.updatedAt).toISOString() : null, lastError: catalog.lastError, catalogFieldNames: catalog.sampleKeys },
    sample,
    closestTitles,
    howToFix: "If the anime is missing or mismatched, add  \"<anilistId>\": <anikotoSeriesId>  to data/s2-series.json (the series id is the number in  " + API + "/series/<id>)."
  };
}

/** Is the Anikoto list fully downloaded? (a title that is missing from a finished list is simply not there) */
export function catalogStatus() {
  return { complete: catalog.complete, crawling: catalog.crawling, series: catalog.series, lastError: catalog.lastError };
}
