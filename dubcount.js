// Dub badges on the home cards: how many episodes of an anime have an English dub.
//
// The number comes from the same Anikoto episode list the watch page already uses (each episode says whether a
// "dub" exists, see languageFlag() in anikoto.js), so the home page and the watch page always agree.
//
// Anikoto's API only allows ~55 requests / 2 minutes and the catalog crawl shares that limit, so this file:
//   - answers from a cache whenever it can (kept on disk in data/.dub-counts.json, refreshed after a few hours),
//   - puts everything else in ONE queue that makes at most one Anikoto request every few seconds,
//   - never makes the page wait: it answers "pending" and the page asks again a few seconds later.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSeries, loadEpisodes, catalogStatus } from "./anikoto.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(ROOT, "data", ".dub-counts.json");
const FRESH_MS = (Number(process.env.DUB_CACHE_HOURS) || 6) * 60 * 60 * 1000;   // a known count is reused this long
const FAILED_MS = 10 * 60 * 1000;                                                // a failed lookup is retried after this
const GAP_MS = Number(process.env.DUB_QUEUE_GAP_MS) || 3000;                     // pause between two Anikoto requests
const RATE_WAIT_MS = Number(process.env.ANIKOTO_RATE_WAIT_MS) || 30000;          // pause after a 429 (too many requests)
const MAX_QUEUE = 400;
const MAX_ITEMS = 40;                                                            // anime per request from the page

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isId = (v) => /^\d{1,9}$/.test(String(v ?? ""));

const counts = new Map();     // anikoto series id -> { dub, total, at, failed }
const queue = new Set();      // series ids waiting for a lookup
let working = false;
let loaded = false;
let saveTimer = null;

async function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    for (const [id, entry] of Object.entries(saved || {})) counts.set(id, entry);
  } catch { /* first run */ }
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(counts)));
    } catch { /* caching is optional */ }
  }, 1500);
  saveTimer.unref?.();
}

const isFresh = (entry) => Boolean(entry) && Date.now() - entry.at < (entry.failed ? FAILED_MS : FRESH_MS);

async function pump() {
  if (working) return;
  working = true;
  try {
    while (queue.size) {
      const seriesId = queue.values().next().value;
      queue.delete(seriesId);
      if (isFresh(counts.get(seriesId))) continue;
      try {
        const { episodes } = await loadEpisodes(seriesId);
        const known = episodes.filter((e) => e.hasDub !== null);
        // when the response says nothing about dubs at all we cannot tell: that is "unknown", never "0"
        const entry = known.length
          ? { dub: episodes.filter((e) => e.hasDub === true).length, total: episodes.length, at: Date.now() }
          : { dub: null, total: episodes.length, at: Date.now(), failed: true };
        counts.set(seriesId, entry);
        saveSoon();
      } catch (error) {
        if (error?.status === 429) {                       // too many requests: try this one again after a pause
          queue.add(seriesId);
          await wait(Math.max((error.retryAfter || 0) * 1000, RATE_WAIT_MS));
          continue;
        }
        counts.set(seriesId, { dub: null, total: 0, at: Date.now(), failed: true });
      }
      await wait(GAP_MS);
    }
  } finally {
    working = false;
  }
}

function enqueue(seriesId) {
  if (queue.size >= MAX_QUEUE) return;
  queue.add(seriesId);
  pump();
}

/**
 * items: [{ id (AniList id), malId, titles: [..] }]
 * returns { "<anilist id>": { state: "ready" | "pending" | "none", dub: number | null } }
 *   ready   = the count is known (0 = no dub, so no badge)
 *   pending = being looked up, ask again in a few seconds
 *   none    = this anime is not in the Anikoto catalog (or its dub status is unknown): no badge
 */
export async function dubCounts(items) {
  await loadCache();
  const result = {};
  for (const raw of (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS)) {
    const id = String(raw?.id ?? "");
    if (!isId(id) || result[id]) continue;
    const titles = (Array.isArray(raw.titles) ? raw.titles : []).filter((t) => typeof t === "string").slice(0, 4);
    const malId = isId(raw.malId) ? String(raw.malId) : "";

    const { seriesId } = await findSeries({ animeId: id, malId, titles });
    if (!seriesId) {
      // an unfinished catalog may simply not have reached this anime yet: ask again later instead of saying "none"
      const status = catalogStatus();
      result[id] = { state: status.complete && status.series ? "none" : "pending", dub: null };
      continue;
    }
    const entry = counts.get(seriesId);
    if (isFresh(entry)) {
      result[id] = entry.dub === null ? { state: "none", dub: null } : { state: "ready", dub: entry.dub };
      continue;
    }
    enqueue(seriesId);
    result[id] = { state: "pending", dub: null };
  }
  return result;
}

export function dubQueueInfo() {
  return { queued: queue.size, cached: counts.size, working };
}
