// Availability checks for the player servers.
//
// Result for every "<server>:<sub|dub>" key:  true = has the episode,  false = does not,  null = couldn't tell.
// The page only hides a server when the answer is exactly false, so a failed check never removes a working server.
//
// Used in two places:
//  - the browser (watch.js) -> checkAvailability()
//  - the optional Node backend (server-check/server.js) -> probeServer()
import { SERVER_PROFILES, SERVER_IDS, PROBE_ENDPOINT, S2_ENDPOINT, buildEmbedUrl } from "./servers.js";

const LANGUAGES = ["sub", "dub"];

const keyOf = (server, language) => `${server}:${language}`;

function looksLikeErrorPage(body) {
  const title = (body.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || "").trim();
  if (/^Error\b/i.test(title)) return true;
  return /Error:\s*Failed to fetch|>\s*404\s*</i.test(body);
}

/**
 * Ask one server about one episode.
 * @param {{pages?: boolean, referer?: string, timeoutMs?: number}} options
 *   pages: also fetch the embed page itself (only possible from Node; browsers are blocked by CORS)
 * @returns {Promise<boolean|null>}
 */
export async function probeServer(server, language, ids, episode, { pages = false, referer = "", timeoutMs = 7000 } = {}) {
  const profile = SERVER_PROFILES[server];
  if (!profile) return false;

  if (profile.lookup) return null; // S-2: its availability comes from the episode-id lookup (watch.js), not from a probe

  const id = ids[profile.idField];
  if (!id) return false; // e.g. no MyAnimeList id, so this server has nothing to play

  // 1. servers with a JSON API: the quickest and most reliable check
  if (profile.probe?.apiUrl) {
    try {
      const response = await fetch(`${profile.probe.apiUrl}/${id}/${episode}/${language}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 200) {
        const data = await response.json().catch(() => null);
        return Boolean(data?.data);
      }
      if ([400, 404, 502].includes(response.status)) return false;
      return null;
    } catch {
      return null;
    }
  }

  // 2. everything else: load the embed page and look at what came back (Node only)
  if (!pages) return null;
  const url = buildEmbedUrl({ server, language, animeId: ids.animeId, malId: ids.malId, episode });
  if (!url) return false;
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0", ...(referer ? { Referer: referer } : {}) },
      signal: AbortSignal.timeout(timeoutMs + 1000)
    });
    const body = (await response.text()).slice(0, 50000);
    // 401/403/429 usually mean "this check was blocked", not "no episode": don't hide the server for that
    if ([401, 403, 429].includes(response.status) || response.status >= 500) return null;

    // A server that has an explicit marker on working pages can be trusted both ways.
    if (profile.probe?.requires) {
      if (!response.ok) return false;
      return body.includes(profile.probe.requires);
    }

    // No marker (e.g. HD-1): a plain "not found" means the server has no such episode / language.
    if ([400, 404, 410].includes(response.status)) return false;
    // Otherwise reading a page is only a guess: a good page confirms the server, anything else stays "unknown".
    // (Embed pages often look like errors to a script even when they play fine in a browser, and the watch page
    // only shows servers that were confirmed, so an unclear page is hidden rather than shown.)
    return response.ok && !looksLikeErrorPage(body) ? true : null;  } catch {
    return null;
  }
}

/** All servers x languages for one episode (what the backend returns). */
export async function probeAll(ids, episode, options) {
  const jobs = SERVER_IDS.flatMap((server) => LANGUAGES.map((language) => [server, language]));
  const results = await Promise.all(jobs.map(([server, language]) => probeServer(server, language, ids, episode, options)));
  return Object.fromEntries(jobs.map(([server, language], i) => [keyOf(server, language), results[i]]));
}

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

/**
 * S-2 needs MegaPlay's own episode id. The Node server (anikoto.js) finds it from the AniList anime + episode.
 * @returns {Promise<{episodeId: string|null, hasSub: boolean|null, hasDub: boolean|null, reason?: string}|null>}
 *          null = the lookup service could not be reached (e.g. the page isn't served by `npm start`)
 */
const episodeIdCache = new Map();

export function lookupEpisodeId({ animeId, malId, episode, titles = [] }) {
  const key = `${animeId}:${episode}`;
  const hit = episodeIdCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;

  const query = new URLSearchParams({ animeId, malId: malId || "", episode });
  for (const title of titles.filter(Boolean).slice(0, 8)) query.append("title", title);

  const promise = fetch(`${S2_ENDPOINT}?${query}`, { signal: AbortSignal.timeout(15000) })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((info) => {
      // don't keep failures: the next try may work
      if (!info || (!info.episodeId && (info.transient || (info.reason && /still loading|HTTP|fetch|network|timeout/i.test(info.reason))))) episodeIdCache.delete(key);
      return info;
    });
  episodeIdCache.set(key, { at: Date.now(), promise });
  return promise;
}

/**
 * Browser entry point: availability of every server for one episode.
 * Tries the backend first (if PROBE_ENDPOINT is set), then asks the JSON-API servers directly.
 */
export async function checkAvailability({ animeId, malId, episode }) {
  const cacheKey = `${animeId}:${malId || ""}:${episode}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const ids = { animeId, malId: malId || "" };
  let result = null;

  if (PROBE_ENDPOINT) {
    try {
      const query = new URLSearchParams({ animeId, malId: ids.malId, episode });
      const response = await fetch(`${PROBE_ENDPOINT}?${query}`, { signal: AbortSignal.timeout(9000) });
      if (response.ok) result = (await response.json())?.availability || null;
    } catch {
      result = null; // backend not running: fall back below
    }
  }

  if (!result) result = await probeAll(ids, episode, { pages: false });

  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}