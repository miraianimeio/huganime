// Browse / search-results page: filters + paginated grid + "Top rated" sidebar.
// Data comes straight from the AniList GraphQL API (no backend). The page state lives in the URL
// (?keyword=&genre=&country=&season=&year=&type=&status=&rating=&sort=&page=) so results can be shared.
(() => {
"use strict";

const API = "https://graphql.anilist.co";
const PER_PAGE = 24;
const TOP_COUNT = 10;
const VIEW_KEY = "huganime-filter-view";

const FORMATS = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };

/* ---------------------------------------------------------------
   Filter options  ([value, label]; first entry of each = "any")
   --------------------------------------------------------------- */
const thisYear = new Date().getFullYear();

const OPTIONS = {
  genre: [["", "Genre"], ...["Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"].map((g) => [g, g])],
  country: [["", "Country"], ["JP", "Japan"], ["CN", "China"], ["KR", "South Korea"], ["TW", "Taiwan"]],
  season: [["", "Season"], ["WINTER", "Winter"], ["SPRING", "Spring"], ["SUMMER", "Summer"], ["FALL", "Fall"]],
  year: [["", "Year"], ...Array.from({ length: thisYear + 1 - 1969 }, (_, i) => String(thisYear + 1 - i)).map((y) => [y, y])],
  type: [["", "Type"], ...Object.entries(FORMATS)],
  status: [["", "Status"], ["RELEASING", "Airing"], ["FINISHED", "Finished"], ["NOT_YET_RELEASED", "Not yet aired"], ["HIATUS", "On hiatus"], ["CANCELLED", "Cancelled"]],
  rating: [["", "Rating"], ["90", "9+ Masterpiece"], ["80", "8+ Great"], ["70", "7+ Good"], ["60", "6+ Decent"], ["50", "5+ Average"]],
  sort: [["", "Sort by"], ["UPDATED_AT_DESC", "Recently updated"], ["TRENDING_DESC", "Trending"], ["POPULARITY_DESC", "Most popular"], ["SCORE_DESC", "Highest rated"], ["START_DATE_DESC", "Newest"], ["TITLE_ENGLISH", "Title A-Z"]]
};
const FIELDS = ["keyword", ...Object.keys(OPTIONS)];

const $ = (id) => document.getElementById(id);
const form = $("filter-form");
const grid = $("grid");
const message = $("grid-message");
const pager = $("pager");
const topList = $("top-list");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const imgUrl = (value) => (/^https:\/\//i.test(value || "") ? value : "");

/* ---------------------------------------------------------------
   URL <-> form state
   --------------------------------------------------------------- */
function readState() {
  const params = new URLSearchParams(window.location.search);
  const state = { page: Math.max(1, Math.floor(Number(params.get("page"))) || 1) };
  for (const key of FIELDS) {
    const value = (params.get(key) || "").trim();
    // only accept values that exist in the dropdown (keyword is free text)
    state[key] = key === "keyword" ? value.slice(0, 100) : OPTIONS[key].some(([v]) => v === value) ? value : "";
  }
  return state;
}

function writeState(state, { replace = false } = {}) {
  const params = new URLSearchParams();
  for (const key of FIELDS) if (state[key]) params.set(key, state[key]);
  if (state.page > 1) params.set("page", String(state.page));
  const query = params.toString();
  const url = window.location.pathname + (query ? "?" + query : "");
  try {
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  } catch { /* file:// or sandboxed: the search still runs, only the address bar is not updated */ }
}

function fillForm(state) {
  for (const key of FIELDS) $("f-" + key).value = state[key];
}

function formState() {
  const state = { page: 1 };
  for (const key of FIELDS) state[key] = $("f-" + key).value.trim();
  return state;
}

const hasFilters = (state) => FIELDS.some((key) => key !== "sort" && state[key]);

/* ---------------------------------------------------------------
   AniList request
   --------------------------------------------------------------- */
const QUERY = `
  query ($page: Int, $perPage: Int, $search: String, $genre: String, $country: CountryCode,
         $season: MediaSeason, $year: Int, $format: MediaFormat, $status: MediaStatus,
         $minScore: Int, $minPop: Int, $sort: [MediaSort]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total lastPage currentPage }
      media(type: ANIME, isAdult: false, search: $search, genre: $genre, countryOfOrigin: $country,
            season: $season, seasonYear: $year, format: $format, status: $status,
            averageScore_greater: $minScore, popularity_greater: $minPop, sort: $sort) {
        id
        title { romaji english }
        coverImage { large medium }
        format
        status
        episodes
        genres
        averageScore
        seasonYear
        startDate { year }
        nextAiringEpisode { episode }
      }
    }
  }`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(variables, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables }),
        signal
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error("Network error: the browser could not reach graphql.anilist.co (offline, blocked by an extension/firewall, or CORS)");
    }
    if (res.status === 429) {
      await wait(Math.min(Number(res.headers.get("Retry-After")) || 2 * (attempt + 1), 8) * 1000);
      continue;
    }
    // AniList sends the reason for a rejected query in the body, so read it
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    if (json?.errors?.length) throw new Error("AniList: " + json.errors[0].message);
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (!json?.data?.Page) throw new Error("AniList returned no data");
    return json.data.Page;
  }
  throw new Error("AniList rate limit: too many requests, wait a minute and try again");
}

function toVariables(state, extra = {}) {
  const defaultSort = state.keyword ? "SEARCH_MATCH" : "POPULARITY_DESC";
  const all = {
    search: state.keyword,
    genre: state.genre,
    country: state.country,
    season: state.season,
    year: state.year ? Number(state.year) : undefined,
    format: state.type,
    status: state.status,
    // "9+" means 90 and up; AniList's filter is "greater than", so subtract one
    minScore: state.rating ? Number(state.rating) - 1 : undefined,
    sort: [state.sort || defaultSort],
    ...extra
  };
  // leave out empty values instead of sending null
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

/* ---------------------------------------------------------------
   Card pieces
   --------------------------------------------------------------- */
const titleOf = (m) => window.HugTitle.pick(m.title);

function releasedEpisodes(m) {
  if (m.status === "RELEASING") return m.nextAiringEpisode?.episode ? m.nextAiringEpisode.episode - 1 : null;
  if (m.status === "NOT_YET_RELEASED") return 0;
  return m.episodes || null;
}

const watchUrl = (id) => `/watch?id=${encodeURIComponent(id)}&ep=1`;

function poster(m) {
  const img = el("img", "card_img");
  img.alt = "";
  img.loading = "lazy";
  const src = imgUrl(m.coverImage?.large || m.coverImage?.medium);
  if (src) img.src = src;
  return img;
}

function modalData(node, m) {
  node.dataset.animeId = m.id;
  node.dataset.animeTitle = titleOf(m);
  node.dataset.animeCover = m.coverImage?.large || m.coverImage?.medium || "";
  node.dataset.animeFormat = FORMATS[m.format] || "";
  node.dataset.animeEpisodes = releasedEpisodes(m) || "";
}

// Same markup as the cards on /home (rows.js makeCard): poster, format badge, CC / dub pills, title.
const ICON_CC = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm3.027 4.002c-.83 0-1.319.642-1.319 1.753v.743c0 1.107.48 1.727 1.319 1.727.69 0 1.138-.435 1.186-1.05H7.36v.114c-.057 1.147-1.028 1.938-2.342 1.938-1.613 0-2.518-1.028-2.518-2.729v-.747C2.5 6.051 3.414 5 5.018 5c1.318 0 2.29.813 2.342 2.002H6.213c-.048-.615-.496-1.05-1.186-1.05Zm6.5 0c-.83 0-1.319.642-1.319 1.753v.743c0 1.107.48 1.727 1.319 1.727.69 0 1.138-.435 1.186-1.05H13.86v.114c-.057 1.147-1.028 1.938-2.342 1.938-1.613 0-2.518-1.028-2.518-2.729v-.747c0-1.7.914-2.751 2.518-2.751 1.318 0 2.29.813 2.342 2.002h-1.147c-.048-.615-.497-1.05-1.186-1.05Z"/></svg>';

const ICON_MIC = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/><path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/></svg>';

function animeCard(m) {
  const cover = m.coverImage?.large || m.coverImage?.medium || "";
  const type = FORMATS[m.format] || "";
  const episodes = releasedEpisodes(m);
  const dub = 0; // AniList has no dub data

  const item = el("div", "anime-card");
  item.setAttribute("role", "listitem");
  // read by modal.js to open the details modal (same as home)
  item.dataset.animeId = m.id;
  item.dataset.animeTitle = titleOf(m);
  item.dataset.animeCover = cover;
  item.dataset.animeFormat = type;
  item.dataset.animeEpisodes = episodes || "";

  // no href: the card opens the details modal, and a real AniList link makes the browser show its URL bar on hover
  const link = el("a", "anime-card_link");
  link.tabIndex = 0;
  link.setAttribute("role", "button");
  link.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); link.click(); } });

  const poster = el("div", "anime-card_poster");
  const img = el("img");
  img.alt = titleOf(m);
  img.loading = "lazy";
  img.decoding = "async";
  const src = imgUrl(cover);
  if (src) img.src = src;
  poster.appendChild(img);

  // top-left: format (TV, Movie, ONA...)
  if (type) poster.appendChild(el("div", "badge-top", type));

  // bottom-left: episodes out so far + dubbed episodes
  if (episodes || dub) {
    const bottom = el("div", "badge-bottom");
    if (episodes) {
      const sub = el("span", "pill pill--sub");
      sub.innerHTML = ICON_CC;
      sub.append(String(episodes));
      sub.title = episodes + " episodes";
      bottom.appendChild(sub);
    }
    if (dub) {
      const dubPill = el("span", "pill pill--dub");
      dubPill.innerHTML = ICON_MIC;
      dubPill.append(String(dub));
      dubPill.title = dub + " dubbed";
      bottom.appendChild(dubPill);
    }
    poster.appendChild(bottom);
  }

  const title = el("h3", "anime-card_title");
  title.appendChild(el("span", "anime-card_name", titleOf(m)));

  link.append(poster, title);
  item.appendChild(link);
  return item;
}

function topCard(m, rank) {
  const link = el("a", "top_card anime-card");
  link.href = watchUrl(m.id);
  modalData(link, m);

  const img = poster(m);
  img.className = "top_img";
  const body = el("div", "top_body");
  body.append(el("h3", "top_name", titleOf(m)));

  const meta = el("p", "top_meta");
  if (m.averageScore) meta.append(el("span", "top_score", "\u2605 " + (m.averageScore / 10).toFixed(1)));
  if (FORMATS[m.format]) meta.append(el("span", "", FORMATS[m.format]));
  const year = m.seasonYear || m.startDate?.year;
  if (year) meta.append(el("span", "", String(year)));
  body.append(meta);

  link.append(img, body);
  link.setAttribute("aria-label", `#${rank} ${titleOf(m)}`);
  return link;
}

function skeletons(count, className) {
  return Array.from({ length: count }, () => el("div", className));
}

// loading placeholder that matches home's skeleton card
function skeletonCards(count) {
  return Array.from({ length: count }, () => {
    const s = el("div", "anime-card anime-card--skeleton");
    s.append(el("div", "anime-card_poster"), el("div", "skeleton-line"), el("div", "skeleton-line short"));
    return s;
  });
}

/* ---------------------------------------------------------------
   Pagination
   --------------------------------------------------------------- */
function pageList(current, last) {
  const pages = new Set([1, last, current - 2, current - 1, current, current + 1, current + 2]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

function renderPager(info, state) {
  pager.replaceChildren();
  const last = Math.min(info.lastPage || 1, 500);
  if (last <= 1) {
    pager.hidden = true;
    return;
  }
  pager.hidden = false;

  const go = (page) => {
    state.page = page;
    writeState(state);
    load(state);
    document.querySelector(".browse_head").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const button = (label, page, { current = false, disabled = false, aria } = {}) => {
    const b = el("button", "pager_btn", label);
    b.type = "button";
    if (aria) b.setAttribute("aria-label", aria);
    if (current) b.setAttribute("aria-current", "page");
    b.disabled = disabled;
    if (!current && !disabled) b.addEventListener("click", () => go(page));
    return b;
  };

  pager.append(button("\u2039", state.page - 1, { disabled: state.page <= 1, aria: "Previous page" }));
  for (const p of pageList(state.page, last)) {
    pager.append(p === "gap" ? el("span", "pager_gap", "\u2026") : button(String(p), p, { current: p === state.page, aria: "Page " + p }));
  }
  pager.append(button("\u203a", state.page + 1, { disabled: state.page >= last, aria: "Next page" }));
}

/* ---------------------------------------------------------------
   Loading
   --------------------------------------------------------------- */
let controller = null;
let requestId = 0;
let topKey = "";

function showMessage(text, retry) {
  message.hidden = false;
  message.replaceChildren(document.createTextNode(text));
  if (retry) {
    const btn = el("button", "btn-filter btn-filter--small", "Try again");
    btn.type = "button";
    btn.addEventListener("click", retry);
    message.append(" ", btn);
  }
}

function updateTitle(state) {
  const title = $("browse-title");
  if (state.keyword) title.textContent = `Results for \u201c${state.keyword}\u201d`;
  else title.textContent = hasFilters(state) ? "Advanced Anime Filter" : "All Anime";
  document.title = (state.keyword ? `${state.keyword} \u2013 ` : "") + "Browse Anime | HugAnime";
  $("side-sub").textContent = hasFilters(state) ? "Based on your filters" : "Most loved by viewers";
}

async function load(state) {
  if (controller) controller.abort();
  controller = new AbortController();
  const mine = ++requestId;

  updateTitle(state);
  message.hidden = true;
  pager.hidden = true;
  grid.setAttribute("aria-busy", "true");
  grid.replaceChildren(...skeletonCards(12));
  $("results-count").textContent = "Loading\u2026";

  try {
    const page = await request(toVariables(state, { page: state.page, perPage: PER_PAGE }), controller.signal);
    if (mine !== requestId) return;

    const items = page.media || [];
    const total = page.pageInfo?.total ?? items.length;
    $("results-count").textContent = total >= 5000 ? "5000+ Items" : `${total.toLocaleString()} ${total === 1 ? "Item" : "Items"}`;
    grid.replaceChildren(...items.map(animeCard));
    grid.setAttribute("aria-busy", "false");
    const capNote = $("results-note");
    if (capNote) capNote.hidden = total < 5000;
    loadTop(state);

    if (!items.length) {
      showMessage("No anime match these filters. Try removing one or two.");
      return;
    }
    renderPager({ lastPage: page.pageInfo?.lastPage }, state);
  } catch (error) {
    if (error.name === "AbortError" || mine !== requestId) return;
    console.error("Browse failed:", error);
    grid.replaceChildren();
    grid.setAttribute("aria-busy", "false");
    $("results-count").textContent = "";
    showMessage("Couldn't load anime right now (" + error.message + ").", () => load(state));
    loadTop(state);
  }
}

// "Top rated" follows the active filters (but ignores the chosen sort and the page number)
async function loadTop(state) {
  const key = JSON.stringify(FIELDS.filter((f) => f !== "sort").map((f) => state[f]));
  if (key === topKey) return;
  topKey = key;

  topList.replaceChildren(...skeletons(6, "top_card top_card--skeleton"));
  try {
    const filtered = hasFilters({ ...state, sort: "" });
    const page = await request(
      toVariables({ ...state, sort: "SCORE_DESC" }, { page: 1, perPage: TOP_COUNT, minPop: filtered ? null : 30000 })
    );
    if (key !== topKey) return;
    const items = page.media || [];
    topList.replaceChildren(...(items.length ? items.map((m, i) => topCard(m, i + 1)) : [el("p", "grid_message", "Nothing to rank for these filters.")]));
  } catch (error) {
    if (key !== topKey) return;
    topKey = "";
    console.error("Top rated failed:", error);
    topList.replaceChildren(el("p", "grid_message", "Couldn't load the ranking (" + error.message + ")."));
  }
}

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
function buildSelects() {
  for (const [key, options] of Object.entries(OPTIONS)) {
    $("f-" + key).replaceChildren(...options.map(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      return option;
    }));
  }
}

function setView(view) {
  const valid = ["cards", "small", "list"].includes(view) ? view : "cards";
  grid.className = "grid grid--" + valid;
  document.querySelectorAll(".view_btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === valid)));
  try { localStorage.setItem(VIEW_KEY, valid); } catch { /* storage blocked */ }
}

// Apply the fields as soon as they change, so they work without pressing "Filter":
//  - a dropdown applies the moment you pick a value
//  - the keyword applies a moment after you stop typing (or on Enter)
// The Filter button still works too.
let keywordTimer = 0;

function applyFilters({ replace = false } = {}) {
  clearTimeout(keywordTimer);
  const state = formState();
  writeState(state, { replace });
  load(state);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  applyFilters();
});

FIELDS.filter((key) => key !== "keyword").forEach((key) => {
  $("f-" + key).addEventListener("change", () => applyFilters());
});

$("f-keyword").addEventListener("input", () => {
  clearTimeout(keywordTimer);
  keywordTimer = setTimeout(() => applyFilters({ replace: true }), 500);
});

$("filter-reset").addEventListener("click", () => {
  clearTimeout(keywordTimer);
  const state = { page: 1, ...Object.fromEntries(FIELDS.map((f) => [f, ""])) };
  fillForm(state);
  writeState(state);
  load(state);
});

document.querySelectorAll(".view_btn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

window.addEventListener("popstate", () => {
  const state = readState();
  fillForm(state);
  load(state);
});

buildSelects();
let savedView = "cards";
try { savedView = localStorage.getItem(VIEW_KEY) || "cards"; } catch { /* storage blocked */ }
setView(savedView);

const initial = readState();
fillForm(initial);
load(initial);
})();
