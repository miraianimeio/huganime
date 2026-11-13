// servers.js (lives next to watch.js, e.g. Public/Js/servers.js)
// Embed-URL builder for watch.js. Keys match SERVER_LIST in watch.js.
//
// ctx shape (built by startPlayback() in watch.js):
//   { server, language, animeId, malId, episode, autoSkip, autoplay, episodeId }   (episodeId: S-2 only)
//
// Output: `${host}${path}/${id}/${episode}/${language}?${params}`
// An empty string is returned when a URL can't be built (unknown server, missing ID,
// bad episode/language). watch.js treats "" as "no source" and falls back to the trailer.

export const SERVER_PROFILES = {
  datsav: {
    label: "DatSaV",
    host: "https://zokoanime.video",
    path: "/stream/mal",
    idField: "malId",
    probe: { requires: "window.__P=" },   // the embed page contains this when a stream exists
    params: {
      sub: { base: { autostart: "true" }, skip: { autostart: "true" } },
      dub: { base: { autostart: "true" }, skip: { autostart: "true" } }
    }
  },
  // S-2 (MegaPlay's HiAnime library). Its URL has no anime id and no episode number:
  //   https://megaplay.buzz/videojs/stream/s-2/{episodeId}/{sub|dub}
  // {episodeId} is looked up from the AniList anime + episode by the server (anikoto.js, route /s2-episode).
  s2: {
    label: "S-2",
    host: "https://megaplay.buzz",
    path: "/videojs/stream/s-2",
    idField: "episodeId",
    route: "episode-id",
    lookup: true,
    params: {
      sub: { base: {}, skip: {} },
      dub: { base: {}, skip: {} }
    }
  },
  dghg: {
    label: "DGHG",
    host: "https://megaplay.buzz",
    path: "/stream/ani",
    idField: "animeId",
    params: {
      sub: { base: { autostart: "false" }, skip: { autostart: "true" } },
      dub: { base: { autoplay: "0" },      skip: { autoplay: "1" } }
    }
  }
};

export const SERVER_IDS = Object.keys(SERVER_PROFILES);

// Where the "is this server available?" check lives. `npm start` (server.js) serves it from the same
// address as the site, so a relative path is enough. If the page is opened some other way (e.g. Live Server)
// that path doesn't exist, so the servers can't be checked (they stay visible) and S-2 is hidden because it needs the server.
export const PROBE_ENDPOINT = "/server-check";
export const S2_ENDPOINT = "/s2-episode";   // S-2 episode-id lookup (same server)

const isPositiveInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

/**
 * Build a fully qualified embed URL for the given playback context.
 * @param {{server:string, language:"sub"|"dub", animeId?:number, malId?:number|string,
 *          episode:number, autoSkip?:0|1|boolean, autoplay?:0|1|boolean}} ctx
 * @returns {string} https URL, or "" if it can't be built
 */
export function buildEmbedUrl(ctx = {}) {
  const profile = SERVER_PROFILES[ctx.server];
  if (!profile) return "";

  const language = ctx.language === "dub" ? "dub" : ctx.language === "sub" ? "sub" : null;
  if (!language) return "";

  const id = ctx[profile.idField];
  if (!isPositiveInt(id)) return "";

  const rule = profile.params[language];
  const on = (v) => Number(v) === 1 || v === true;
  const chosen = on(ctx.autoSkip) || on(ctx.autoplay) ? rule.skip : rule.base;
  const query = new URLSearchParams(chosen).toString();
  const tail = query ? `?${query}` : "";

  // S-2: .../s-2/{episodeId}/{language}   (the episode is part of the id)
  if (profile.route === "episode-id") return `${profile.host}${profile.path}/${Number(id)}/${language}${tail}`;

  // everything else: .../{animeId or malId}/{episode}/{language}
  if (!isPositiveInt(ctx.episode)) return "";
  return `${profile.host}${profile.path}/${Number(id)}/${Number(ctx.episode)}/${language}${tail}`;
}