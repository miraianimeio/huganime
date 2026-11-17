// Fills every <section class="row" data-row="..."> with anime cards (data from the AniList GraphQL API).
(() => {
  "use strict";

  const API = "https://graphql.anilist.co";
  const PER_ROW = 15;                      // cards in a scrolling row
  const GRID_COUNT = 12;                   // cards in a grid section (2 rows of 6, nothing else)
  const CACHE_MS = 10 * 60 * 1000;          // keep results for 10 minutes
  // Written by the watch page (Js/features/history.js) each time an episode is opened:
  // { id, malId, title, poster, episode, totalEpisodes, updatedAt }
  const HISTORY_KEY = "watchHistory";
  const SMOOTH = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  // One query for every row; each row only changes the variables.
  const QUERY = `
    query (
      $perPage: Int, $sort: [MediaSort], $genre: String, $tag: String,
      $status: MediaStatus, $season: MediaSeason, $seasonYear: Int,
      $minScore: Int, $minPopularity: Int
    ) {
      Page(page: 1, perPage: $perPage) {
        media(
          type: ANIME, isAdult: false, sort: $sort, genre: $genre, tag: $tag,
          status: $status, season: $season, seasonYear: $seasonYear,
          averageScore_greater: $minScore, popularity_greater: $minPopularity
        ) {
          id
          siteUrl
          title { romaji english }
          coverImage { extraLarge large }
          averageScore
          format
          duration
          episodes
          status
          nextAiringEpisode { episode }
        }
      }
    }`;

  function currentSeason() {
    const now = new Date();
    const season = ["WINTER", "SPRING", "SUMMER", "FALL"][Math.floor(now.getMonth() / 3)];
    return { season, seasonYear: now.getFullYear() };
  }

  const genre = (name) => ({
    genre: name, sort: ["SCORE_DESC"], minScore: 70, minPopularity: 20000,
  });

  // data-row name -> GraphQL variables (history comes from this browser instead)
  const ROWS = {
    trending: { sort: ["TRENDING_DESC"], status: "RELEASING" },
    airing: { ...currentSeason(), sort: ["POPULARITY_DESC"] },
    action: genre("Action"),
    romance: genre("Romance"),
  };

  // ---------- small helpers ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function store(kind) {
    try { return window[kind]; } catch { return null; }
  }

  // ---------- data -> card ----------
  const FORMATS = {
    TV: "TV",
    TV_SHORT: "TV Short",
    MOVIE: "Movie",
    SPECIAL: "Special",
    OVA: "OVA",
    ONA: "ONA",
    MUSIC: "Music",
  };

  // AniList gives the duration as a number of minutes
  function shortDuration(mins) {
    if (!mins) return "";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return [h && h + "h", m && m + "m"].filter(Boolean).join(" ");
  }

  // How many episodes are out right now (not the planned total).
  function releasedEpisodes(a) {
    if (a.status === "RELEASING") {
      const next = a.nextAiringEpisode?.episode;
      return next ? next - 1 : null;
    }
    if (a.status === "NOT_YET_RELEASED") return 0;
    return a.episodes || null;
  }

  function toCard(a) {
    return {
      id: a.id,
      title: window.HugTitle.pick(a.title),
      titles: { english: a.title?.english || "", romaji: a.title?.romaji || "" }, // cached too, so EN / JP can switch later
      url: a.siteUrl,
      image: a.coverImage?.large || a.coverImage?.extraLarge || "",
      score: a.averageScore ? a.averageScore / 10 : null, // 0-100 -> 0-10
      type: FORMATS[a.format] || "",
      duration: shortDuration(a.duration),
      episodes: releasedEpisodes(a),
      dub: 0,                                             // AniList has no dub data; set this if you add a source
      airing: a.status === "RELEASING",
    };
  }

  // ---------- fetching (AniList allows ~90 requests/minute, so requests go one at a time) ----------
  let chain = Promise.resolve();
  function queued(task) {
    const run = chain.then(task);
    chain = run.then(() => wait(700), () => wait(700));
    return run;
  }

  async function getJson(variables) {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { perPage: PER_ROW, ...variables } }),
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        await wait((retryAfter > 0 ? retryAfter * 1000 : 1200 * (i + 1)));
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return json;
    }
    throw new Error("Rate limited");
  }

  function readCache(key) {
    try {
      const raw = store("sessionStorage")?.getItem("ha:" + key);
      if (!raw) return null;
      const { t, cards } = JSON.parse(raw);
      return Date.now() - t < CACHE_MS ? cards : null;
    } catch { return null; }
  }

  function writeCache(key, cards) {
    try { store("sessionStorage")?.setItem("ha:" + key, JSON.stringify({ t: Date.now(), cards })); } catch { /* full or blocked */ }
  }

  async function getCards(variables) {
    const key = JSON.stringify(variables);
    const cached = readCache(key);
    if (cached) return cached;
    const json = await queued(() => getJson(variables));
    const seen = new Set();
    const cards = [];
    for (const a of json.data?.Page?.media || []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      cards.push(toCard(a));
    }
    writeCache(key, cards);
    return cards;
  }

  // ---------- history (the episode you last watched, saved by the watch page) ----------
  function readHistory() {
    try {
      const list = JSON.parse(store("localStorage")?.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(list) ? list.filter((e) => e && e.id && Number(e.episode) >= 1) : [];
    } catch { return []; }
  }

  function removeHistory(id) {
    try {
      const rest = readHistory().filter((e) => String(e.id) !== String(id));
      store("localStorage")?.setItem(HISTORY_KEY, JSON.stringify(rest));
    } catch { /* storage blocked */ }
  }

  function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - Number(timestamp)) / 1000);
    if (!Number.isFinite(seconds) || seconds < 0) return "";
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h ago";
    const days = Math.floor(hours / 24);
    if (days < 7) return days + "d ago";
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return weeks + "w ago";
    return Math.floor(days / 30) + "mo ago";
  }

  // ---------- rendering ----------
  const ICON_CC = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm3.027 4.002c-.83 0-1.319.642-1.319 1.753v.743c0 1.107.48 1.727 1.319 1.727.69 0 1.138-.435 1.186-1.05H7.36v.114c-.057 1.147-1.028 1.938-2.342 1.938-1.613 0-2.518-1.028-2.518-2.729v-.747C2.5 6.051 3.414 5 5.018 5c1.318 0 2.29.813 2.342 2.002H6.213c-.048-.615-.496-1.05-1.186-1.05Zm6.5 0c-.83 0-1.319.642-1.319 1.753v.743c0 1.107.48 1.727 1.319 1.727.69 0 1.138-.435 1.186-1.05H13.86v.114c-.057 1.147-1.028 1.938-2.342 1.938-1.613 0-2.518-1.028-2.518-2.729v-.747c0-1.7.914-2.751 2.518-2.751 1.318 0 2.29.813 2.342 2.002h-1.147c-.048-.615-.497-1.05-1.186-1.05Z"/></svg>';

  const ICON_MIC = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/><path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/></svg>';

  const cardTitle = (c) => (c.titles && window.HugTitle.pick(c.titles)) || c.title;

  function makeCard(c) {
    const item = el("div", "anime-card");
    item.setAttribute("role", "listitem");
    // read by modal.js to open the details modal
    item.dataset.animeId = c.id;
    item.dataset.animeTitle = cardTitle(c);
    item.dataset.animeCover = c.image;
    item.dataset.animeFormat = c.type;
    item.dataset.animeEpisodes = c.episodes || "";

    // no href: the card opens the details modal, and a real AniList link makes the browser show its URL bar on hover
    const link = el("a", "anime-card_link");
    link.tabIndex = 0;
    link.setAttribute("role", "button");
    link.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); link.click(); } });

    const poster = el("div", "anime-card_poster");
    const img = el("img");
    img.alt = cardTitle(c);
    img.loading = "lazy";
    img.decoding = "async";
    img.src = c.image;
    poster.appendChild(img);

    // top-left: format (TV, Movie, ONA...)
    if (c.type) poster.appendChild(el("div", "badge-top", c.type));

    // bottom-left: episodes out so far (blue) + dubbed episodes (red)
    if (c.episodes || c.dub) {
      const bottom = el("div", "badge-bottom");
      if (c.episodes) {
        const sub = el("span", "pill pill--sub");
        sub.innerHTML = ICON_CC;
        sub.append(String(c.episodes));
        sub.title = c.episodes + " episodes";
        bottom.appendChild(sub);
      }
      if (c.dub) {
        const dub = el("span", "pill pill--dub");
        dub.innerHTML = ICON_MIC;
        dub.append(String(c.dub));
        dub.title = c.dub + " dubbed";
        bottom.appendChild(dub);
      }
      poster.appendChild(bottom);
    }

    const title = el("h3", "anime-card_title");
    title.appendChild(el("span", "anime-card_name", cardTitle(c)));

    link.append(poster, title);
    item.appendChild(link);
    return item;
  }

  // A History card is a plain link to the watch page at the episode you stopped on.
  // It has no data-anime-id on purpose, so modal.js never opens the details modal for it.
  function makeHistoryCard(entry) {
    const item = el("div", "anime-card anime-card--history");
    item.setAttribute("role", "listitem");
    const title = (entry.titles && window.HugTitle.pick(entry.titles)) || entry.title || "Unknown anime";
    const episode = Math.floor(Number(entry.episode));

    const link = el("a", "anime-card_link");
    link.href = "/watch?id=" + encodeURIComponent(entry.id) + "&ep=" + encodeURIComponent(episode);
    link.title = title + " - continue from episode " + episode;

    const poster = el("div", "anime-card_poster");
    const img = el("img");
    img.alt = title;
    img.loading = "lazy";
    img.decoding = "async";
    if (/^https:\/\//i.test(entry.poster || "")) img.src = entry.poster;
    poster.appendChild(img);
    poster.appendChild(el("div", "badge-top", "EP " + episode));

    const total = Number(entry.totalEpisodes);
    const percent = total ? Math.max(4, Math.min(100, Math.round((episode / total) * 100))) : 6;
    const bar = el("div", "history-progress");
    const fill = el("span");
    fill.style.width = percent + "%";
    bar.appendChild(fill);
    poster.appendChild(bar);

    const name = el("h3", "anime-card_title");
    name.appendChild(el("span", "anime-card_name", title));
    const when = timeAgo(entry.updatedAt);
    if (when) link.title += " (" + when + ")";

    const play = el("span", "history-play");
    play.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/></svg>';
    poster.appendChild(play);

    link.append(poster, name);
    item.appendChild(link);

    const remove = el("button", "history-remove");
    remove.type = "button";
    remove.title = "Remove from history";
    remove.setAttribute("aria-label", "Remove " + title + " from history");
    remove.textContent = "\u00d7";
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeHistory(entry.id);
      reloadHistoryRows();
    });
    item.appendChild(remove);
    return item;
  }

  // The whole History section (title, arrows, cards) only exists while there is something to continue.
  function showHistory(section, container) {
    const list = readHistory();
    section.hidden = list.length === 0;
    if (!list.length) {
      container.replaceChildren();
      return;
    }
    container.replaceChildren(...list.map(makeHistoryCard));
    container.dispatchEvent(new Event("rowchange")); // refresh the arrows
  }

  function reloadHistoryRows() {
    document.querySelectorAll('.row[data-row="history"]').forEach(loadRow);
  }

  function showCards(container, cards, emptyText) {
    if (!cards.length) return showMessage(container, emptyText);
    container.replaceChildren(...cards.map(makeCard));
    container.dispatchEvent(new Event("rowchange"));
  }

  function showMessage(container, text, retry) {
    const p = el("p", "row_message", text);
    if (retry) {
      const b = el("button", "row_retry", "Try again");
      b.type = "button";
      b.addEventListener("click", retry);
      p.append(" ", b);
    }
    container.replaceChildren(p);
    container.dispatchEvent(new Event("rowchange"));
  }

  function showSkeleton(container, count = 6) {
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const s = el("div", "anime-card anime-card--skeleton");
      s.append(el("div", "anime-card_poster"), el("div", "skeleton-line"), el("div", "skeleton-line short"));
      nodes.push(s);
    }
    container.replaceChildren(...nodes);
  }

  let historyBackfilled = false;

  async function loadRow(section) {
    const name = section.dataset.row;
    const container = section.querySelector(".row_items");

    if (name === "history") {
      showHistory(section, container);
      if (!historyBackfilled) {
        // old entries only saved one title: fetch the other once so the EN / JP switch can swap them
        historyBackfilled = true;
        window.HugTitle.fillMissing(HISTORY_KEY).then((changed) => { if (changed) reloadHistoryRows(); });
      }
      return;
    }

    const variables = ROWS[name];
    if (!variables) return;
    const count = section.classList.contains("row--grid") ? GRID_COUNT : PER_ROW;
    showSkeleton(container, section.classList.contains("row--grid") ? GRID_COUNT : 6);
    try {
      showCards(container, (await getCards({ ...variables, perPage: count })).slice(0, count), "Nothing to show right now.");
    } catch (err) {
      console.error("Could not load row:", name, err);
      showMessage(container, "Couldn't load this row.", () => loadRow(section));
    }
  }

  // ---------- left / right arrows ----------
  function setupArrows(section) {
    const items = section.querySelector(".row_items");
    const prev = section.querySelector(".row_btn--left, .row_nav-btn--left");
    const next = section.querySelector(".row_btn--right, .row_nav-btn--right");
    if (!items || !prev || !next) return;

    const update = () => {
      prev.disabled = items.scrollLeft <= 2;
      next.disabled = items.scrollLeft >= items.scrollWidth - items.clientWidth - 2;
    };
    prev.addEventListener("click", () => items.scrollBy({ left: -items.clientWidth * 0.85, behavior: SMOOTH }));
    next.addEventListener("click", () => items.scrollBy({ left: items.clientWidth * 0.85, behavior: SMOOTH }));
    items.addEventListener("scroll", update, { passive: true });
    items.addEventListener("rowchange", update);
    window.addEventListener("resize", update);
    update();
  }

  // ---------- start ----------
  const sections = Array.from(document.querySelectorAll(".row[data-row]"));
  sections.forEach(setupArrows);

  const isHistory = (section) => section.dataset.row === "history";
  sections.filter(isHistory).forEach(loadRow);
  const lazySections = sections.filter((section) => !isHistory(section));

  // load each row when it is close to the screen (saves API requests)
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        loadRow(e.target);
      });
    }, { rootMargin: "300px 0px" });
    lazySections.forEach((s) => io.observe(s));
  } else {
    lazySections.forEach(loadRow);
  }

  // coming back to the home page (back button, other tab) shows the newest history
  window.addEventListener("pageshow", (event) => { if (event.persisted) reloadHistoryRows(); });
  window.addEventListener("storage", (event) => { if (event.key === HISTORY_KEY) reloadHistoryRows(); });
})();