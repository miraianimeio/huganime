// aniskip.js: opening / ending times for the watch page's "Auto Skip", from the free AniSkip database (https://api.aniskip.com).
// Route (see server.js):   GET /skip-times?malId=21&episode=5
//   -> { found: true, intro: { start, end } | null, outro: { start, end } | null }      (seconds)
// Results are cached for 12 hours. Set ANISKIP_API=... to point at a different server (used for tests).

import "./env.js";

const API = (process.env.ANISKIP_API || "https://api.aniskip.com").replace(/\/+$/, "");
const TTL_MS = 12 * 60 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;   // a failed lookup is retried after a minute
const cache = new Map();

function interval(result) {
  const start = Number(result?.interval?.startTime);
  const end = Number(result?.interval?.endTime);
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start ? { start, end } : null;
}

export async function getSkipTimes({ malId, episode }) {
  const key = `${malId}:${episode}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.until) return hit.value;

  let value;
  let ttl = TTL_MS;
  try {
    const url = `${API}/v2/skip-times/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}` +
      "?types[]=op&types[]=mixed-op&types[]=ed&types[]=mixed-ed&episodeLength=0";
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.status === 404) {
      value = { found: false, intro: null, outro: null };   // nobody has submitted times for this episode
    } else if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    } else {
      const json = await res.json();
      const results = Array.isArray(json?.results) ? json.results : [];
      const pick = (...types) => interval(results.find((r) => types.includes(r?.skipType)));
      const intro = pick("op", "mixed-op");
      const outro = pick("ed", "mixed-ed");
      value = { found: Boolean(intro || outro), intro, outro };
    }
  } catch (error) {
    value = { found: false, intro: null, outro: null, error: String(error.message || error) };
    ttl = ERROR_TTL_MS;
  }
  cache.set(key, { value, until: Date.now() + ttl });
  return value;
}
