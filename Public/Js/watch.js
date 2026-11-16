import { safeUrl } from "./core/escape.js";
import { cachedRequest } from "./core/api-client.js";
import { friendlyError, reportUiError } from "./core/errors.js";
import { readJson, writeJson, readString, writeString, persistentCache, STORAGE_KEYS } from "./core/storage.js";
import { saveWatchHistoryEntry, getWatchHistory } from "./features/history.js";
import { checkAvailability, lookupEpisodeId } from "./server-check.js";
import { buildEmbedUrl } from "./servers.js";
import { createAutoSkipper, seekMessages, readPlayerTime } from "./autoskip.js";
import { MERGED_SEASONS, PART_TO_MAIN } from "./merged-seasons.js";

const SERVER_LIST = [
  { id: "s2", label: "VidStream-1" },
  { id: "vs2", label: "VidStream-2" },
  { id: "vidplay", label: "Vidplay" },
  { id: "dghg", label: "HD-1" }
];

// Servers whose URL needs MegaPlay's own episode id (looked up by the server, see anikoto.js)
const LOOKUP_SERVERS = new Set(["s2", "vs2", "vidplay"]);

// Servers whose player reports playback time to this page, so "Auto Skip" can work on them (MegaPlay: HD-1 and S-2)
const SKIP_SERVERS = new Set(["dghg", "s2", "vs2", "vidplay"]);

const SERVER_EMBEDS = {
  datsav: (ctx) => buildEmbedUrl({ ...ctx, server: "datsav" }),
  dghg:   (ctx) => buildEmbedUrl({ ...ctx, server: "dghg" }),
  s2:     (ctx) => buildEmbedUrl({ ...ctx, server: "s2" }),
  vs2:    (ctx) => buildEmbedUrl({ ...ctx, server: "vs2" }),
  vidplay:(ctx) => buildEmbedUrl({ ...ctx, server: "vidplay" })
};

// Wag mong gagalawin 'to Dan!
const JIKAN = "https://api.jikan.moe/v4";
const RANGE_SIZE = 100;
const PREFS_KEY = "huganime_player_prefs";
const LIST_KEY = "huganime-list";

export const state = {
  animeId: 0,
  malId: null,
  currentEpisode: 1,
  totalEpisodes: 0,
  activeServer: SERVER_LIST[0].id,
  language: "sub",
  availability: {},   // "<server>:<sub|dub>" -> true / false / null (unknown) for the current episode
  checked: false,     // true once the availability check for the current episode has finished
  playing: false,
  anime: null,
  mal: null,
  episodeTitles: new Map(),
  episodeDetails: new Map(),   // episode number -> { title, synopsis, thumb, aired }  (from Kitsu, see loadEpisodeDetails)
  rangeStart: 1
};

const prefs = { autoPlay: false, autoNext: true, autoSkip: false, compact: false, ...readJson(PREFS_KEY, {}) };
const savePrefs = () => writeJson(PREFS_KEY, prefs);


const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n, size = 3) => String(n).padStart(size, "0");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ICON_CC = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm3.027 4.002c-.83 0-1.319.642-1.319 1.753v.743c0 1.107.48 1.727 1.319 1.727.69 0 1.138-.435 1.186-1.05H7.36v.114c-.057 1.147-1.028 1.938-2.342 1.938-1.613 0-2.518-1.028-2.518-2.729v-.747C2.5 6.051 3.414 5 5.018 5c1.318 0 2.29.813 2.342 2.002H6.213c-.048-.615-.496-1.05-1.186-1.05Zm6.5 0c-.83 0-1.319.642-1.319 1.753v.743c0 1.107.48 1.727 1.319 1.727.69 0 1.138-.435 1.186-1.05H13.86v.114c-.057 1.147-1.028 1.938-2.342 1.938-1.613 0-2.518-1.028-2.518-2.729v-.747c0-1.7.914-2.751 2.518-2.751 1.318 0 2.29.813 2.342 2.002h-1.147c-.048-.615-.497-1.05-1.186-1.05Z"/></svg>';
const ICON_MIC = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/><path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z"/></svg>';
const ICON_BOOKMARK = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2v13.5a.5.5 0 0 0 .74.439L8 13.069l5.26 2.87A.5.5 0 0 0 14 15.5V2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2"/></svg>';

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS = { RELEASING: "Airing", FINISHED: "Finished airing", NOT_YET_RELEASED: "Not yet aired", CANCELLED: "Cancelled", HIATUS: "On hiatus" };

function formatDate(d) {
  if (!d?.year) return "?";
  return [d.month ? MONTHS[d.month - 1] : "", d.day ? d.day + "," : "", d.year].filter(Boolean).join(" ");
}

function prettyEnum(value) {
  const text = String(value || "").replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function countryName(code) {
  if (!code) return "";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch { return code; }
}


const els = {
  stage: $("player-stage"),
  play: $("player-play"),
  note: $("player-note"),
  expand: $("btn-expand"),
  light: $("btn-light"),
  lights: $("lights"),
  prev: $("btn-prev"),
  next: $("btn-next"),
  list: $("btn-list"),
  listText: $("btn-list-text"),
  watching: $("watching-ep"),
  serverRows: $("server-rows"),
  airing: $("airing-notice"),
  airingText: $("airing-text"),
  airingClose: $("airing-close"),
  formatFilter: $("format-filter"),
  range: $("range-select"),
  find: $("find-number"),
  viewToggle: $("view-toggle"),
  grid: $("ep-grid"),
  empty: $("ep-empty"),
  cover: $("series-cover"),
  title: $("series-title"),
  alt: $("series-alt"),
  flags: $("series-flags"),
  desc: $("series-desc"),
  metaLeft: $("meta-left"),
  metaRight: $("meta-right"),
  error: $("page-error")
};


let currentFrame = null;

function resolveSource(ctx) {
  const entry = SERVER_EMBEDS[ctx.server];
  if (!entry) return "";
  const url = typeof entry === "function"
    ? entry(ctx)
    : String(entry).replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(ctx[key] ?? ""));
  return /^https:\/\//i.test(url || "") ? url : "";
}

function trailerSource() {
  const t = state.anime?.trailer;
  if (!t?.id) return "";
  if (t.site === "youtube") return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(t.id) + "?rel=0";
  if (t.site === "dailymotion") return "https://www.dailymotion.com/embed/video/" + encodeURIComponent(t.id);
  return "";
}

function showNote(text, href) {
  els.note.textContent = text || "";
  if (text && href) {
    // a small "Why?" link that opens the S-2 diagnosis page for this exact anime + episode
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Why?";
    link.style.cssText = "margin-left:6px;color:inherit;text-decoration:underline";
    els.note.append(" ", link);
  }
  els.note.hidden = !text;
}

// ---- merged seasons (see merged-seasons.js): one page, one episode list, several AniList entries behind it ----
const mergedParts = () => MERGED_SEASONS[state.animeId]?.parts || null;

// Which AniList / MAL entry an episode of this page belongs to, and its number inside that entry.
function partFor(episode) {
  const parts = mergedParts();
  if (!parts) return { animeId: state.animeId, malId: state.malId, episode, offset: 0 };
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (episode <= offset + part.episodes || i === parts.length - 1) return { animeId: part.id, malId: part.malId, episode: episode - offset, offset };
    offset += part.episodes;
  }
}

// /s2-debug page for the current anime + episode (shows how the server matched, or failed to match, it on Anikoto)
function s2DebugUrl() {
  const a = state.anime;
  const part = partFor(state.currentEpisode);
  const query = new URLSearchParams({ animeId: part.animeId, episode: part.episode });
  if (part.malId) query.set("malId", part.malId);
  for (const title of [a?.title?.english, a?.title?.romaji, a?.title?.native, ...(a?.synonyms || [])]) {
    if (title) query.append("title", title);
  }
  return `/s2-debug?${query}`;
}

function teardownPlayer() {
  playbackRun++; // a start that is still waiting for its episode id must not appear afterwards
  autoSkipper.stop();
  currentFrame?.remove();
  currentFrame = null;
  state.playing = false;
  els.play.hidden = false;
  showNote("");
}

let playbackRun = 0;

// MegaPlay's episode id for the current anime + episode (null = the lookup service isn't reachable)
async function episodeInfo() {
  const a = state.anime;
  const titles = [a?.title?.english, a?.title?.romaji, a?.title?.native, ...(a?.synonyms || [])];
  const current = state.currentEpisode;
  const part = partFor(current);
  const ask = (animeId, malId, episode) => lookupEpisodeId({ animeId, malId, episode, titles });
  if (!part.offset) return ask(part.animeId, part.malId, part.episode);

  // A later part of a merged season. Anikoto may list it as its own series (episode 1-10) OR as one series for the
  // whole season (episode 1-22), so try the season-wide number first: asking for "episode 1" of a whole-season
  // series would play the season's first episode instead of this part's first.
  const tries = [
    [part.animeId, part.malId, current],
    [part.animeId, part.malId, part.episode],
    [state.animeId, state.malId, current]
  ];
  let first = null;
  for (const [animeId, malId, episode] of tries) {
    const info = await ask(animeId, malId, episode).catch(() => null);
    first = first || info;
    if (info?.episodeId) return info;
  }
  return first;
}

async function startPlayback() {
  const run = ++playbackRun;
  const a = state.anime;
  const part = partFor(state.currentEpisode);
  const ctx = {
    server: state.activeServer,
    language: state.language,
    animeId: part.animeId,
    malId: part.malId || "",
    episode: part.episode,
    autoSkip: prefs.autoSkip ? 1 : 0,
    autoplay: 1
  };

  let lookupNote = "";
  let lookupHref = "";
  if (LOOKUP_SERVERS.has(ctx.server)) {
    showNote("Finding the stream...");
    const info = await episodeInfo().catch(() => null);
    if (run !== playbackRun) return; // the viewer changed episode / server while we were looking
    showNote("");
    ctx.episodeId = info?.episodeId || "";
    if (!ctx.episodeId) {
      if (info) lookupHref = s2DebugUrl();
      const name = SERVER_LIST.find((s) => s.id === ctx.server)?.label || "This server";
      lookupNote = !info
        ? `${name} could not be reached (is the HugAnime server running with npm start?), so the official trailer is playing.`
        : info.transient
          ? (info.lastError
              ? `${name} is having trouble downloading its episode list (${info.lastError}), so the official trailer is playing for now.`
              : `${name} is still downloading its episode list${info.progress?.series ? ` (${info.progress.series} anime so far)` : ""}, so the official trailer is playing. Try again in a few minutes.`)
          : `${name} does not have this episode, so the official trailer is playing.`;
    }
  }

  let src = resolveSource(ctx);
  const playingTrailer = !src;
  let note = "";
  if (!src) {
    src = trailerSource();
    note = src
      ? (lookupNote || "No stream is set up for this server yet, so the official trailer is playing.")
      : "No video source is available for this episode yet.";
  }
  if (!src) {
    showNote(note, lookupHref);
    return;
  }

  const frame = document.createElement("iframe");
  // every server's player uses the same embed:
  //   <iframe src="" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen></iframe>
  frame.src = src;
  frame.setAttribute("width", "100%");
  frame.setAttribute("height", "100%");
  frame.setAttribute("frameborder", "0");
  frame.setAttribute("scrolling", "no");
  frame.title = `${a?.displayTitle || "Anime"} - Episode ${state.currentEpisode}`;
  // For gosh sake wag mong galawin 'to Rai
  frame.referrerPolicy = "origin";
  frame.allow = "autoplay *; encrypted-media *; fullscreen *; picture-in-picture *";
  frame.allowFullscreen = true;
  els.stage.appendChild(frame);
  currentFrame = frame;

  els.play.hidden = true;
  state.playing = true;
  showNote(note, note === lookupNote ? lookupHref : "");
  if (playingTrailer) autoSkipper.stop(); else armAutoSkip(ctx.server);
  recordProgress();
}

export function refreshPlayer({ autostart = false } = {}) {
  teardownPlayer();
  if (autostart || prefs.autoPlay) startPlayback();
}

export function recordProgress() {
  const a = state.anime;
  if (!a) return;
  saveWatchHistoryEntry({
    id: state.animeId,
    malId: state.malId,
    title: a.displayTitle,
    titles: window.HugTitle.pairFor(a.displayTitle),
    poster: a.cover,
    episode: state.currentEpisode,
    totalEpisodes: state.totalEpisodes || null,
    server: state.activeServer,   // last server used for THIS anime (e.g. "byfms")
    language: state.language,     // and sub / dub
    updatedAt: Date.now()
  });
}

// Address of an anime: /watch.html/love-chunibyo-and-other-delusions-take-on-me/ep-1   (no id in it; server.js serves the page for it).
// The title words are turned back into the anime by searching AniList; the answer is remembered in this browser
// (SLUG_KEY) so the same address opens instantly and always lands on the same anime.
const SLUG_KEY = "huganime_slug_ids";

function slugify(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
const slugOf = (anime) => slugify(anime?.title?.english || anime?.title?.romaji);

function rememberSlug(slug, id) {
  if (!slug || !id) return;
  const map = readJson(SLUG_KEY, {});
  if (map[slug] === id) return;
  map[slug] = id;
  const keys = Object.keys(map);
  for (const key of keys.slice(0, Math.max(0, keys.length - 500))) delete map[key];   // keep the list small
  writeJson(SLUG_KEY, map);
}

// title words -> AniList id (0 = not found)
async function resolveSlug(slug) {
  const known = Number(readJson(SLUG_KEY, {})[slug]);
  if (known) return known;
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: "query ($s: String) { Page(perPage: 15) { media(search: $s, type: ANIME, sort: SEARCH_MATCH) { id title { romaji english } synonyms } } }",
      variables: { s: slug.replace(/-/g, " ") }
    })
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const list = (await response.json())?.data?.Page?.media || [];
  const exact = list.find((m) => slugify(m.title?.english) === slug || slugify(m.title?.romaji) === slug)
    || list.find((m) => (m.synonyms || []).some((name) => slugify(name) === slug));
  const hit = exact || list[0];
  if (hit) rememberSlug(slug, hit.id);
  return hit ? hit.id : 0;
}

export function goToEpisode(n, { autostart = false } = {}) {
  let ep = Math.floor(Number(n));
  if (!Number.isFinite(ep) || ep < 1) ep = 1;
  if (state.totalEpisodes && ep > state.totalEpisodes) ep = state.totalEpisodes;
  state.currentEpisode = ep;
  // the old episode's answers don't apply any more: hide every server until this episode has been checked
  state.availability = {};
  state.checked = false;
  renderServers();

  const url = new URL(window.location.href);
  const slug = slugOf(state.anime);
  if (slug) {
    rememberSlug(slug, state.animeId);
    url.pathname = `/watch.html/${slug}/ep-${ep}`;
    url.search = "";
  } else {                       // no usable title yet: fall back to the id
    url.pathname = "/watch.html";
    url.searchParams.set("id", state.animeId);
    url.searchParams.set("ep", ep);
  }
  window.history.replaceState(null, "", url);

  syncEpisodeUI();
  refreshPlayer({ autostart });
  recordProgress();
  refreshAvailability();
}

// "Auto Skip" (HD-1 and S-2): skips the opening / ending using AniSkip's times, see autoskip.js
const skipTimesCache = new Map();

async function fetchSkipTimes(malId, episode) {
  const key = `${malId}:${episode}`;
  if (!skipTimesCache.has(key)) {
    skipTimesCache.set(key, fetch(`/skip-times?malId=${encodeURIComponent(malId)}&episode=${encodeURIComponent(episode)}`, { signal: AbortSignal.timeout(12000) })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null));
  }
  const value = await skipTimesCache.get(key);
  if (!value || value.error) skipTimesCache.delete(key); // try again next time
  return value;
}

// asks the MegaPlay player to jump to `time` (it is checked afterwards, see autoskip.js)
function postSeek(time) {
  const frame = currentFrame;
  if (!frame?.contentWindow) return;
  let origin;
  try { origin = new URL(frame.src).origin; } catch { return; }
  for (const message of seekMessages(time)) {
    frame.contentWindow.postMessage(message, origin);
    frame.contentWindow.postMessage(JSON.stringify(message), origin);
  }
}

let flashTimer = 0;
function flashNote(text) {
  showNote(text);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (els.note.textContent === text) showNote(""); }, 6000);
}

const autoSkipper = createAutoSkipper({
  sendSeek: postSeek,
  goNext: () => goToEpisode(state.currentEpisode + 1, { autostart: true }),
  hasNext: () => state.currentEpisode < state.totalEpisodes,
  notify: flashNote
});

function armAutoSkip(server) {
  const part = partFor(state.currentEpisode);
  if (!prefs.autoSkip || !SKIP_SERVERS.has(server) || !part.malId) { autoSkipper.stop(); return; }
  const malId = part.malId;
  const episode = part.episode;
  autoSkipper.start(server, () => fetchSkipTimes(malId, episode));
}

// "Auto Next": players that post an "ended" message let us move on by themselves
window.addEventListener("message", (event) => {
  if (!currentFrame || event.source !== currentFrame.contentWindow) return;
  let data = event.data;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return; } }
  const tick = readPlayerTime(data);
  if (tick && prefs.autoSkip) autoSkipper.onTime(tick.time, tick.duration);
  const ended = data && (data.event === "ended" || data.type === "ended" || data.event === "complete");
  if (ended && prefs.autoNext && state.currentEpisode < state.totalEpisodes) {
    goToEpisode(state.currentEpisode + 1, { autostart: true });
  }
});


// A server is shown when its check CONFIRMED it has this episode (true); servers that answered "no" (false) are hidden,
// and so are servers that could not be checked (null) -- as long as at least one server is confirmed.
// If NOTHING could be confirmed (e.g. HD-1 can't be probed and the Anikoto list doesn't have this anime), every server
// that is not known to be missing stays visible, so the viewer can still try them instead of seeing an empty list.
function serverUsable(serverId, language) {
  if (!state.checked) return false;
  const values = Object.values(state.availability);
  const answer = state.availability[`${serverId}:${language}`];
  if (!values.some((v) => v === true)) return answer !== false;
  return answer === true;
}

function renderServers() {
  const filter = els.formatFilter.value;
  const rows = [];

  for (const language of ["sub", "dub"]) {
    if (filter !== "both" && filter !== language) continue;

    const servers = SERVER_LIST.filter((server) => serverUsable(server.id, language));
    if (!servers.length) continue; // e.g. no dub for this episode: the whole DUB row disappears

    const row = el("div", "server-row");
    const label = el("span", "server-label");
    label.innerHTML = language === "sub" ? ICON_CC : ICON_MIC;
    label.append(language.toUpperCase());

    const pills = el("div", "server-pills");
    for (const server of servers) {
      const btn = el("button", "server-btn");
      btn.type = "button";
      btn.dataset.language = language;
      btn.dataset.server = server.id;
      btn.innerHTML = ICON_PLAY;
      btn.append(server.label);
      pills.appendChild(btn);
    }
    row.append(label, pills);
    rows.push(row);
  }

  if (!rows.length) {
    const note = el("div", "server-row");
    note.textContent = state.checked ? "No server has this episode yet." : "Checking servers…";
    rows.push(note);
  }

  els.serverRows.replaceChildren(...rows);
  paintServers();
}

// Ask which servers have the current episode, hide the ones that don't,
// and move off the selected server if it turned out not to have this episode.
let availabilityRun = 0;

async function refreshAvailability() {
  if (!state.animeId) return;
  const run = ++availabilityRun;
  const episode = state.currentEpisode;

  const [checked, info] = await Promise.all([
    (() => { const part = partFor(episode); return checkAvailability({ animeId: part.animeId, malId: part.malId, episode: part.episode }); })().catch(() => null),
    episodeInfo().catch(() => null)
  ]);
  if (run !== availabilityRun || episode !== state.currentEpisode) return; // user moved on

  const result = { ...(checked || {}) };
  // S-2 is hidden only when the lookup gave a final "no". If the lookup could not answer (service unreachable,
  // catalog still loading, API error) S-2 stays visible instead of flashing in and vanishing.
  // VidStream-1, VidStream-2 and Vidplay all use the same Anikoto episode id, so they share this answer.
  for (const id of LOOKUP_SERVERS) {
    if (!info || (!info.episodeId && info.transient)) {
      result[`${id}:sub`] = null;
      result[`${id}:dub`] = null;
    } else if (!info.episodeId) {
      result[`${id}:sub`] = false;
      result[`${id}:dub`] = false;
    } else {
      result[`${id}:sub`] = info.hasSub === false ? false : true;
      result[`${id}:dub`] = info.hasDub === false ? false : info.hasDub === true ? true : null;
    }
  }

  state.availability = result;
  state.checked = true;
  renderServers();

  if (serverUsable(state.activeServer, state.language)) return;

  // Like Mirai: prefer a server that CONFIRMED it has the episode (same language first, then the other),
  // and only fall back to one we merely couldn't check.
  const order = [state.language, state.language === "sub" ? "dub" : "sub"];
  const confirmed = (id, language) => state.availability[`${id}:${language}`] === true;
  for (const strict of [true, false]) {
    for (const language of order) {
      const next = SERVER_LIST.find((server) => serverUsable(server.id, language) && (!strict || confirmed(server.id, language)));
      if (next) {
        state.language = language;
        state.activeServer = next.id;
        paintServers();
        refreshPlayer({ autostart: state.playing });
        recordProgress();
        return;
      }
    }
  }
}

function paintServers() {
  els.serverRows.querySelectorAll(".server-btn").forEach((btn) => {
    const on = btn.dataset.language === state.language && btn.dataset.server === state.activeServer;
    btn.setAttribute("aria-pressed", String(on));
  });
}

function setServer(language, id) {
  state.language = language;
  state.activeServer = id;
  writeString(STORAGE_KEYS.selectedServer, `${language}:${id}`); // fallback for anime with no history yet
  recordProgress();                          // remember it for this anime
  paintServers();                            // the green highlight moves right away
  refreshPlayer({ autostart: state.playing }); // and the player reloads if it was playing
}

const validServer = (language, id) =>
  (language === "sub" || language === "dub") && SERVER_LIST.some((srv) => srv.id === id);

// Server for the page that is opening:
//  1. the server this anime was last watched on (saved in its history entry), else
//  2. the last server picked on any anime, else the default.
function restoreServer() {
  const saved = getWatchHistory().find((item) => String(item.id) === String(state.animeId));
  if (saved && validServer(saved.language, saved.server)) {
    state.language = saved.language;
    state.activeServer = saved.server;
    return;
  }
  const [language, id] = String(readString(STORAGE_KEYS.selectedServer, "") || "").split(":");
  if (validServer(language, id)) {
    state.language = language;
    state.activeServer = id;
  }
}

function renderRangeOptions() {
  const total = Math.max(state.totalEpisodes, 1);
  const chunks = Math.ceil(total / RANGE_SIZE);
  const options = [];
  for (let i = 0; i < chunks; i++) {
    const start = i * RANGE_SIZE + 1;
    const end = Math.min(total, start + RANGE_SIZE - 1);
    const opt = el("option", "", `${pad(start)}-${pad(end)}`);
    opt.value = String(start);
    options.push(opt);
  }
  els.range.replaceChildren(...options);
  els.range.value = String(state.rangeStart);
}

function formatAired(value) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function episodeButton(n) {
  const detail = state.episodeDetails.get(n) || {};
  const title = detail.title || state.episodeTitles.get(n);
  const btn = el("button", "ep");
  btn.type = "button";
  btn.dataset.ep = String(n);

  if (prefs.compact) {
    btn.append(el("span", "ep_num", String(n)));            // numbers-only view
  } else {
    // card: picture + "EP n" badge, title, short description, air date
    btn.classList.add("ep--rich");
    const thumb = el("span", "ep_thumb");
    const picture = safeUrl(detail.thumb) || safeUrl(state.anime?.coverMedium || state.anime?.cover);
    if (picture) {
      const img = el("img");
      img.src = picture;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      if (!detail.thumb) thumb.classList.add("ep_thumb--cover");   // no episode picture: the anime's cover stands in
      thumb.append(img);
    }
    thumb.append(el("span", "ep_badge", `EP ${n}`));
    const body = el("span", "ep_body");
    body.append(el("span", "ep_name", title || `Episode ${n}`));
    if (detail.synopsis) body.append(el("span", "ep_desc", detail.synopsis));
    const aired = formatAired(detail.aired);
    if (aired) body.append(el("span", "ep_date", aired));
    btn.append(thumb, body);
  }
  const label = title ? `Episode ${n} - ${title}` : `Episode ${n}`;
  btn.title = label;
  btn.setAttribute("aria-label", label);
  if (n === state.currentEpisode) btn.setAttribute("aria-current", "true");
  return btn;
}

function renderEpisodes() {
  const total = state.totalEpisodes;
  const query = els.find.value.trim();
  const numbers = [];

  if (query) {
    for (let n = 1; n <= total && numbers.length < 300; n++) {
      if (String(n).includes(query)) numbers.push(n);
    }
  } else {
    const end = Math.min(total, state.rangeStart + RANGE_SIZE - 1);
    for (let n = state.rangeStart; n <= end; n++) numbers.push(n);
  }

  els.grid.classList.toggle("ep-grid--compact", prefs.compact);
  els.grid.replaceChildren(...numbers.map(episodeButton));
  if (!prefs.compact) loadEpisodeDetails(numbers);

  els.empty.hidden = numbers.length > 0;
  els.empty.textContent = total ? "No episodes match." : "Episodes aren't available yet.";
}

function syncEpisodeUI() {
  const n = state.currentEpisode;
  els.watching.textContent = `Episode ${n}`;
  els.prev.disabled = n <= 1;
  els.next.disabled = !!state.totalEpisodes && n >= state.totalEpisodes;

  if (state.anime) document.title = `${state.anime.displayTitle} - Episode ${n} | HugAnime`;

  // keep the highlighted episode inside the visible range
  const chunkStart = Math.floor((n - 1) / RANGE_SIZE) * RANGE_SIZE + 1;
  if (!els.find.value.trim() && chunkStart !== state.rangeStart) {
    state.rangeStart = chunkStart;
    els.range.value = String(chunkStart);
    renderEpisodes();
    return;
  }
  els.grid.querySelectorAll(".ep").forEach((btn) => {
    if (Number(btn.dataset.ep) === n) btn.setAttribute("aria-current", "true");
    else btn.removeAttribute("aria-current");
  });
}

let jikanChain = Promise.resolve();
function jikanGet(path) {
  const run = jikanChain.then(() => fetchJikan(path));
  jikanChain = run.then(() => wait(400), () => wait(400));
  return run;
}

async function fetchJikan(path) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(JIKAN + path, { headers: { Accept: "application/json" } });
    if (res.status === 429) { await wait(1200 * (i + 1)); continue; }
    if (!res.ok) throw new Error("Jikan HTTP " + res.status);
    return res.json();
  }
  throw new Error("Jikan rate limited");
}

function applyTitles(entries, offset = 0) {
  for (const [ep, title] of entries) state.episodeTitles.set(Number(ep) + offset, title);
  renderEpisodes();
}

// ---- episode pictures, titles and descriptions (Kitsu: free, no key). MAL id -> Kitsu anime -> its episodes, 20 per page.
// Only the pages for the episodes on screen are fetched; every page is fetched once.
const KITSU = "https://kitsu.io/api/edge";
const kitsuIds = new Map();          // malId -> Promise<kitsu id>
const kitsuPagesDone = new Set();    // "<kitsuId>:<page>"

function kitsuId(malId) {
  if (kitsuIds.has(malId)) return kitsuIds.get(malId);
  const cacheKey = `kitsu_id_${malId}`;
  const cached = persistentCache.get(cacheKey);
  const promise = cached?.data
    ? Promise.resolve(String(cached.data))
    : fetch(`${KITSU}/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${encodeURIComponent(malId)}&include=item`, { headers: { Accept: "application/vnd.api+json" } })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          const id = json?.included?.[0]?.id || json?.data?.[0]?.relationships?.item?.data?.id || "";
          if (id) persistentCache.set(cacheKey, String(id));
          else kitsuIds.delete(malId);                   // no answer: ask again next time
          return String(id || "");
        })
        .catch(() => { kitsuIds.delete(malId); return ""; });
  kitsuIds.set(malId, promise);
  return promise;
}

// numbers = episode numbers on this page; a merged season is split into its parts, each asked about with its own MAL id
async function loadEpisodeDetails(numbers) {
  if (!state.malId || !numbers.length) return;
  const groups = new Map();
  for (const n of numbers) {
    const part = partFor(n);
    if (!part.malId) continue;
    if (!groups.has(part.malId)) groups.set(part.malId, { part, locals: [] });
    groups.get(part.malId).locals.push(part.episode);
  }
  for (const { part, locals } of groups.values()) await loadPartDetails(part, locals);
}

async function loadPartDetails(part, locals) {
  const animeId = state.animeId;
  const id = await kitsuId(part.malId);
  if (!id || animeId !== state.animeId) return;

  const first = Math.floor((Math.min(...locals) - 1) / 20);
  const last = Math.floor((Math.max(...locals) - 1) / 20);
  let changed = false;
  for (let page = first; page <= last; page++) {
    const key = `${id}:${page}`;
    if (kitsuPagesDone.has(key)) continue;
    kitsuPagesDone.add(key);                           // marked first, so renderEpisodes() below can't start it twice
    try {
      const res = await fetch(`${KITSU}/anime/${id}/episodes?page[limit]=20&page[offset]=${page * 20}&sort=number`, { headers: { Accept: "application/vnd.api+json" } });
      if (!res.ok) throw new Error("Kitsu HTTP " + res.status);
      const json = await res.json();
      for (const item of json.data || []) {
        const a = item.attributes || {};
        const n = Number(a.number);
        if (!n) continue;
        const thumb = a.thumbnail?.large || a.thumbnail?.original || a.thumbnail?.medium || "";
        const synopsis = String(a.synopsis || "").replace(/\s*\(Source:[^)]*\)\s*$/i, "").replace(/\s+/g, " ").trim();
        state.episodeDetails.set(n + part.offset, { title: a.titles?.en_us || a.titles?.en_jp || a.canonicalTitle || "", synopsis, thumb, aired: a.airdate || "" });
        changed = true;
      }
    } catch (error) {
      kitsuPagesDone.delete(key);                      // try again the next time this part of the list is shown
      console.warn("Could not load episode details:", error);
      break;
    }
  }
  if (changed && animeId === state.animeId) {
    // refresh the cards without restarting the loader
    els.grid.replaceChildren(...[...els.grid.children].map((node) => episodeButton(Number(node.dataset.ep))));
  }
}

async function loadEpisodeTitles(malId, offset = 0) {   // offset = episodes of the earlier parts of a merged season
  const key = `jikan_episodes_${malId}`;
  const cached = persistentCache.get(key);
  if (cached?.data) {
    applyTitles(Object.entries(cached.data), offset);
    if (Date.now() - cached.savedAt < 6 * 3600 * 1000) return;
  }

  const collected = {};
  try {
    for (let page = 1; page <= 15; page++) {
      const json = await jikanGet(`/anime/${malId}/episodes?page=${page}`);
      for (const ep of json.data || []) {
        const n = Number(ep.mal_id);
        if (n && ep.title) collected[n] = ep.title;
      }
      applyTitles(Object.entries(collected), offset);
      if (!json.pagination?.has_next_page) break;
    }
    if (Object.keys(collected).length) persistentCache.set(key, collected);
  } catch (error) {
    console.warn("Could not load episode titles:", error); 
  }
}

async function loadMalDetails(malId) {
  const key = `jikan_anime_${malId}`;
  const cached = persistentCache.get(key);
  if (cached?.data) {
    state.mal = cached.data;
    renderSeries();
    if (Date.now() - cached.savedAt < 12 * 3600 * 1000) return;
  }
  try {
    const json = await jikanGet(`/anime/${malId}`);
    const d = json.data || {};
    state.mal = {
      rating: d.rating || "",
      broadcast: d.broadcast?.string || "",
      producers: (d.producers || []).map((p) => p.name),
      score: d.score || null,
      scoredBy: d.scored_by || null
    };
    persistentCache.set(key, state.mal);
    renderSeries();
  } catch (error) {
    console.warn("Could not load MyAnimeList details:", error);
  }
}

let descOpen = false;

function metaRow(label, value, cls = "v") {
  if (value === null || value === undefined || value === "") return null;
  const li = el("li");
  li.append(label + ": ");
  const span = el("span", cls);
  if (value instanceof Node) span.append(value);
  else span.textContent = value;
  li.append(span);
  return li;
}

function shortRating(r) {
  if (!r) return "";
  if (r.startsWith("R - 17+")) return "R-17+";
  if (r.startsWith("R+")) return "R+";
  if (r.startsWith("PG-13")) return "PG-13";
  if (r.startsWith("PG")) return "PG";
  if (r.startsWith("G")) return "G";
  return "";
}

function renderDescription() {
  const full = state.anime?.description || "No synopsis available.";
  const short = full.length > 260 ? full.slice(0, 260).replace(/\s+\S*$/, "") + "…" : full;
  els.desc.replaceChildren(descOpen || full === short ? full : short);
  if (full !== short) {
    const toggle = el("button", "linklike", descOpen ? " [less]" : " [more]");
    toggle.type = "button";
    toggle.addEventListener("click", () => { descOpen = !descOpen; renderDescription(); });
    els.desc.append(toggle);
  }
}

function renderSeries() {
  const a = state.anime;
  if (!a) return;

  els.cover.src = safeUrl(a.cover);
  els.cover.alt = a.displayTitle + " cover";
  els.title.textContent = a.displayTitle;

  const alt = [...new Set([a.title?.romaji, a.title?.native, ...(a.synonyms || [])].filter(Boolean))]
    .filter((t) => t !== a.displayTitle);
  els.alt.textContent = alt.join(", ");

  const flags = [shortRating(state.mal?.rating)].filter(Boolean);
  els.flags.replaceChildren(...flags.map((f) => el("span", "flag", f)));

  renderDescription();

  const score = document.createDocumentFragment();
  if (a.score) {
    score.append(a.score.toFixed(1) + " AniList");
    if (state.mal?.score) {
      const mal = el("span", "dim", ` / ${state.mal.score} MAL` + (state.mal.scoredBy ? ` (${state.mal.scoredBy.toLocaleString()} ratings)` : ""));
      score.append(mal);
    }
  }

  const premiered = a.season && a.seasonYear ? `${prettyEnum(a.season)} ${a.seasonYear}` : "";
  const end = a.status === "RELEASING" || !a.endDate?.year ? "?" : formatDate(a.endDate);

  const left = [
    metaRow("Type", a.format, "hl"),
    metaRow("Country", countryName(a.country), "hl"),
    metaRow("Premiered", premiered),
    metaRow("Date aired", a.startDate?.year ? `${formatDate(a.startDate)} to ${end}` : ""),
    metaRow("Broadcast", state.mal?.broadcast),
    metaRow("Status", STATUS[a.status] || prettyEnum(a.status), "hl"),
    metaRow("Source", prettyEnum(a.source)),
    metaRow("Genres", (a.genres || []).join(", "), "hl")
  ].filter(Boolean);

  const right = [
    metaRow("Scores", score.childNodes.length ? score : ""),
    metaRow("Duration", a.duration ? a.duration + " min" : ""),
    metaRow("Episodes", `${a.availableEpisodes ?? "?"} / ${a.episodes ?? "?"}`),
    metaRow("Studios", (a.studios || []).join(", "), "hl"),
    metaRow("Producers", (state.mal?.producers || []).join(", "), "hl")
  ].filter(Boolean);

  els.metaLeft.replaceChildren(...left);
  els.metaRight.replaceChildren(...right);
}

//next episode dito

let airingTimer = 0;
let airingDismissed = false;

function formatUtc(ts) {
  const d = new Date(ts * 1000);
  const hours = d.getUTCHours();
  const clock = `${pad(hours % 12 || 12, 2)}:${pad(d.getUTCMinutes(), 2)} ${hours >= 12 ? "PM" : "AM"}`;
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1, 2)}/${pad(d.getUTCDate(), 2)} ${clock} GMT`;
}

function renderAiring() {
  clearInterval(airingTimer);
  const next = state.anime?.nextAiring;
  if (!next || airingDismissed) { els.airing.hidden = true; return; }

  const tick = () => {
    let left = next.airingAt - Math.floor(Date.now() / 1000);
    if (left <= 0) { els.airing.hidden = true; clearInterval(airingTimer); return; }
    const days = Math.floor(left / 86400); left %= 86400;
    const hours = Math.floor(left / 3600); left %= 3600;
    const minutes = Math.floor(left / 60);
    const seconds = left % 60;
    els.airingText.textContent =
      `Episode ${next.episode} [SUB] is predicted to arrive on: ${formatUtc(next.airingAt)} ` +
      `(${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds)`;
    els.airing.hidden = false;
  };
  tick();
  airingTimer = setInterval(tick, 1000);
}

function paintToggles() {
  document.querySelectorAll("[data-pref]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(!!prefs[btn.dataset.pref]));
  });
  els.viewToggle.setAttribute("aria-pressed", String(prefs.compact));
}

function inList() {
  return readJson(LIST_KEY, []).some((x) => String(x.id) === String(state.animeId));
}

function paintListButton() {
  const on = inList();
  els.list.setAttribute("aria-pressed", String(on));
  els.listText.textContent = on ? "In list" : "Add to list";
}

function toggleList() {
  const a = state.anime;
  if (!a) return;
  let list = readJson(LIST_KEY, []);
  if (inList()) {
    list = list.filter((x) => String(x.id) !== String(state.animeId));
  } else {
    list.unshift({ id: state.animeId, title: a.displayTitle, titles: window.HugTitle.pairFor(a.displayTitle), cover: a.cover, format: a.format, episodes: state.totalEpisodes || null });
  }
  writeJson(LIST_KEY, list);
  paintListButton();
}

function setLights(off) {
  document.body.classList.toggle("lights-off", off);
  els.lights.hidden = !off;
  els.light.setAttribute("aria-pressed", String(off));
}

function bindControls() {
  els.play.addEventListener("click", () => { teardownPlayer(); startPlayback(); });

  document.querySelectorAll("[data-pref]").forEach((btn) => {
    btn.addEventListener("click", () => {
      prefs[btn.dataset.pref] = !prefs[btn.dataset.pref];
      savePrefs();
      paintToggles();
      if (btn.dataset.pref === "autoSkip") {
        if (prefs.autoSkip && state.playing && currentFrame) armAutoSkip(state.activeServer); else autoSkipper.stop();
      }
    });
  });

  els.expand.addEventListener("click", () => {
    const on = document.body.classList.toggle("theater");
    els.expand.setAttribute("aria-pressed", String(on));
  });

  els.light.addEventListener("click", () => setLights(!document.body.classList.contains("lights-off")));
  els.lights.addEventListener("click", () => setLights(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setLights(false); });

  els.prev.addEventListener("click", () => goToEpisode(state.currentEpisode - 1, { autostart: state.playing }));
  els.next.addEventListener("click", () => goToEpisode(state.currentEpisode + 1, { autostart: state.playing }));
  els.list.addEventListener("click", toggleList);

  els.serverRows.addEventListener("click", (e) => {
    const btn = e.target.closest(".server-btn");
    if (btn) setServer(btn.dataset.language, btn.dataset.server);
  });

  els.formatFilter.addEventListener("change", () => {
    const value = els.formatFilter.value;
    if (value === "sub" || value === "dub") {
      state.language = value;
      recordProgress();
    }
    renderServers();
    refreshPlayer({ autostart: state.playing });
  });

  els.range.addEventListener("change", () => {
    state.rangeStart = Number(els.range.value) || 1;
    renderEpisodes();
  });

  els.find.addEventListener("input", renderEpisodes);
  els.find.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const n = Number(els.find.value);
    if (n >= 1 && (!state.totalEpisodes || n <= state.totalEpisodes)) {
      els.find.value = "";
      goToEpisode(n, { autostart: true });
    }
  });

  els.viewToggle.addEventListener("click", () => {
    prefs.compact = !prefs.compact;
    savePrefs();
    paintToggles();
    renderEpisodes();
  });

  els.grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".ep");
    if (btn) goToEpisode(Number(btn.dataset.ep), { autostart: true });
  });

  els.airingClose.addEventListener("click", () => {
    airingDismissed = true;
    renderAiring();
  });
}

const SIDE_PREVIEW = 5;

function sideCard(item, showRelation) {
  const link = el("a", "rel-card");
  link.href = `/watch.html?id=${encodeURIComponent(item.id)}&ep=1`;

  const img = el("img", "rel-card_img");
  img.alt = "";
  img.loading = "lazy";
  const src = safeUrl(item.cover);
  if (src) img.src = src;

  const body = el("div", "rel-card_body");
  if (showRelation && item.relation) body.append(el("span", "rel-card_tag", item.relation));
  body.append(el("h3", "rel-card_title", item.title));

  const meta = el("p", "rel-card_meta");
  if (item.score) meta.append(el("span", "rel-card_score", "\u2605 " + item.score.toFixed(1)));
  if (item.format) meta.append(el("span", "", item.format));
  if (item.year) meta.append(el("span", "", String(item.year)));
  body.append(meta);

  link.append(img, body);
  return link;
}

function renderSide(anime) {
  const list = $("related-list");
  const more = $("related-more");
  const related = anime.related || [];
  if (list) {
    list.replaceChildren(...related.map((item) => sideCard(item, true)));
    const collapsible = related.length > SIDE_PREVIEW;
    list.classList.toggle("is-collapsed", collapsible);
    if (more) {
      more.hidden = !collapsible;
      more.setAttribute("aria-expanded", "false");
      more.firstElementChild.textContent = "More";
      more.onclick = () => {
        const open = list.classList.toggle("is-collapsed") === false;
        more.setAttribute("aria-expanded", String(open));
        more.firstElementChild.textContent = open ? "Less" : "More";
      };
    }
    $("related-empty").hidden = related.length > 0;
  }

  const recs = anime.recommendations || [];
  const recGrid = $("recommended-grid");
  if (recGrid) {
    recGrid.replaceChildren(...recs.map((item) => sideCard(item, false)));
    $("recommended").hidden = recs.length === 0;
  }
}

function onAnime(anime) {
  const first = !state.anime;
  const previousTotal = state.totalEpisodes;

  // a merged season (merged-seasons.js): all parts count as one anime with one episode list
  if (MERGED_SEASONS[anime.id]) {
    const parts = MERGED_SEASONS[anime.id].parts;
    const total = parts.reduce((sum, part) => sum + part.episodes, 0);
    anime = {
      ...anime,
      episodes: total,
      availableEpisodes: total,
      related: (anime.related || []).filter((item) => !parts.some((part) => part.id === item.id)),
      recommendations: (anime.recommendations || []).filter((item) => !PART_TO_MAIN[item.id])
    };
  }

  // details can come from cache: always pick the title in the language chosen right now
  for (const item of [anime, ...(anime.recommendations || []), ...(anime.relations || []), ...(anime.related || [])]) {
    if (item && item.title && typeof item.title === "object") item.displayTitle = window.HugTitle.pick(item.title);
  }

  state.anime = anime;
  renderSide(anime);
  state.malId = anime.malId;
  state.totalEpisodes = anime.availableEpisodes ?? anime.episodes ?? state.totalEpisodes ?? 0;

  renderSeries();
  renderRangeOptions();
  renderEpisodes();
  paintListButton();
  renderAiring();

  if (first) {
    goToEpisode(state.currentEpisode);
    if (state.malId) {
      let offset = 0;
      for (const part of mergedParts() || [{ malId: state.malId, episodes: 0 }]) {
        if (part.malId) loadEpisodeTitles(part.malId, offset);
        offset += part.episodes;
      }
      loadMalDetails(state.malId);
    }
  } else if (state.totalEpisodes !== previousTotal) {
    syncEpisodeUI();
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  // /watch.html/some-title/ep-3   (or the old watch.html?id=98762&ep=3, which is rewritten to the title form once loaded)
  const wanted = /\/watch\.html\/([^/]+)(?:\/ep-(\d+))?\/?$/.exec(window.location.pathname);
  let slug = "";
  try { slug = slugify(decodeURIComponent(wanted?.[1] || "")); } catch { /* bad address: treated as no anime */ }
  state.animeId = Number(params.get("id")) || 0;
  state.currentEpisode = Math.max(1, Math.floor(Number(wanted?.[2] || params.get("ep"))) || 1);
  state.rangeStart = Math.floor((state.currentEpisode - 1) / RANGE_SIZE) * RANGE_SIZE + 1;

  restoreServer();
  els.formatFilter.value = "both";
  renderServers();
  renderRangeOptions();
  paintToggles();
  bindControls();

  if (!state.animeId && slug) {
    els.title.textContent = "Finding the anime...";
    try { state.animeId = await resolveSlug(slug); } catch (error) { reportUiError("watch", error); }
  }

  // the address names a later part of a merged season: show the merged page at that part's episode
  const mainId = PART_TO_MAIN[state.animeId];
  if (mainId) {
    let offset = 0;
    for (const part of MERGED_SEASONS[mainId].parts) {
      if (part.id === state.animeId) break;
      offset += part.episodes;
    }
    state.animeId = mainId;
    state.currentEpisode += offset;
    state.rangeStart = Math.floor((state.currentEpisode - 1) / RANGE_SIZE) * RANGE_SIZE + 1;
  }

  if (!state.animeId) {
    els.title.textContent = "";
    els.error.textContent = slug ? "Couldn't find that anime. Search for it on the home page." : "No anime selected. Open one from the home page.";
    els.error.hidden = false;
    return;
  }

  try {
    await cachedRequest(`watch_anime_${state.animeId}`, `/catalog/anime/${state.animeId}`, {}, onAnime);
  } catch (error) {
    reportUiError("watch", error);
    els.title.textContent = "Couldn't load this anime";
    els.error.textContent = friendlyError(error, "load this anime");
    els.error.hidden = false;
  }
}

window.HugWatch = { state, goToEpisode, refreshPlayer, recordProgress };
init();