import { persistentCache, session } from "./storage.js";
import * as anilist from "./anilist-client.js";

 







const API_BASE = "/api";
const CACHE_TTL_MS = 5 * 60 * 1000;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, { searchParams } = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await fetch(url, { headers: { Accept: "application/json" } });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
       
    }
    throw new ApiError(message, response.status);
  }

  return response.json();
}

async function catalogRequest(path, options = {}) {
  const params = options.searchParams || {};
  let direct = null;
  if (path === "/catalog/home") direct = () => anilist.home();
  if (path === "/catalog/spotlight") direct = () => anilist.spotlight();
  if (path === "/catalog/search") direct = () => anilist.search(params.q);
  if (path === "/catalog/browse") direct = () => anilist.browse(params);
  if (path === "/catalog/airing") direct = () => anilist.airing();
  if (path === "/catalog/ranking" && params.source !== "mal") direct = () => anilist.ranking(params.period);

  const animeMatch = path.match(/^\/catalog\/anime\/(\d+)$/);
  if (animeMatch) direct = () => anilist.anime(animeMatch[1]);
  const charactersMatch = path.match(/^\/catalog\/anime\/(\d+)\/characters$/);
  if (charactersMatch) direct = () => anilist.characters(charactersMatch[1]);

  if (direct) {
    try {
      return await direct();
    } catch (directError) {
      try {
        return await request(path, options);
      } catch {
        throw directError;
      }
    }
  }
  return request(path, options);
}

 
const CACHE_VERSION = "mirai_v6_browser_anilist_";

function isNonEmptyData(data) {
  if (!data) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (Array.isArray(data.results)) return data.results.length > 0;
  if (Array.isArray(data.trending)) return data.trending.length > 0;
  if (Array.isArray(data.recommended)) return data.recommended.length > 0;
  if (Array.isArray(data.spotlight)) return data.spotlight.length > 0;
  return true;
}

 






export async function cachedRequest(rawCacheKey, path, options, onData) {
  const cacheKey = rawCacheKey.startsWith(CACHE_VERSION) ? rawCacheKey : `${CACHE_VERSION}${rawCacheKey}`;
  const cached = session.get(cacheKey) || persistentCache.get(cacheKey);
  let servedFromCache = false;

  if (cached?.data && isNonEmptyData(cached.data)) {
    onData(cached.data);
    servedFromCache = true;
    if (Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.data;
  }

  try {
    const fresh = await catalogRequest(path, options);
    if (isNonEmptyData(fresh)) {
      session.set(cacheKey, fresh);
      persistentCache.set(cacheKey, fresh);
      if (!servedFromCache || JSON.stringify(fresh) !== JSON.stringify(cached?.data)) {
        onData(fresh);
      }
    } else if (!servedFromCache) {
      onData(fresh);
    }
    return fresh;
  } catch (error) {
    if (!servedFromCache || !isNonEmptyData(cached?.data)) throw error;
    return cached.data;  
  }
}

 

const animeDetailsCache = new Map();

export const catalog = {
  home: () => catalogRequest("/catalog/home"),
  search: term => catalogRequest("/catalog/search", { searchParams: { q: term } }),
  browse: params => catalogRequest("/catalog/browse", { searchParams: params }),
  airing: () => catalogRequest("/catalog/airing"),
  ranking: (period, source) => catalogRequest("/catalog/ranking", { searchParams: { period, source } }),
  anime: async id => {
    const numericId = Number(id);
    if (animeDetailsCache.has(numericId)) {
      return animeDetailsCache.get(numericId);
    }
    const sessionKey = `anime_details_browser_anilist_v2_${numericId}`;
    const cached = session.get(sessionKey) || persistentCache.get(sessionKey);
    if (cached?.data) {
      animeDetailsCache.set(numericId, cached.data);
      return cached.data;
    }
    const data = await catalogRequest(`/catalog/anime/${encodeURIComponent(id)}`);
    animeDetailsCache.set(numericId, data);
    session.set(sessionKey, data);
    persistentCache.set(sessionKey, data);
    return data;
  },
  characters: id => catalogRequest(`/catalog/anime/${encodeURIComponent(id)}/characters`),
  malRanking: (type, limit) => request("/catalog/mal/ranking", { searchParams: { type, limit } }),
  status: () => request("/catalog/status")
};

 

export const stream = {
   





  checkAll: (animeId, episode, malId) =>
    request("/server-check-all", { searchParams: { animeId, episode, malId } }),
  check: (server, animeId, episode, malId) =>
    request("/server-check", { searchParams: { server, animeId, episode, malId } }),
  episodeCount: (lang, animeId, max, malId) =>
    request("/episode-count", { searchParams: { lang, animeId, max, malId } }),
  servers: () => request("/servers")
};

export { request };
