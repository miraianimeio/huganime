// Recent (watch history) and My List pages. Both read what the site already saves in this browser:
//   "watchHistory"   -> written by the watch page   { id, title, poster, episode, totalEpisodes, updatedAt }
//   "huganime-list"  -> written by "Add to list"    { id, title, cover, format, episodes }
(() => {
  "use strict";

  const root = document.getElementById("library");
  if (!root) return;

  const mode = root.dataset.lib === "list" ? "list" : "recent";
  const HISTORY_KEY = "watchHistory";
  const LIST_KEY = "huganime-list";
  const KEY = mode === "list" ? LIST_KEY : HISTORY_KEY;

  const subEl = document.getElementById("lib-sub");
  const searchWrap = document.getElementById("lib-search-wrap");
  const searchInput = document.getElementById("lib-search");
  const clearBtn = document.getElementById("lib-clear");
  const barEl = document.getElementById("lib-bar");
  const filtersEl = document.getElementById("lib-filters");
  const sortEl = document.getElementById("lib-sort");
  const contentEl = document.getElementById("lib-content");
  const emptyEl = document.getElementById("lib-empty");

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "tv", label: "TV" },
    { id: "movie", label: "Movie" },
    { id: "other", label: "OVA / ONA" },
  ];

  const state = { query: "", filter: "all", sort: "added" };

  /* ---------- storage ---------- */

  function read(key) {
    try {
      const list = JSON.parse(window.localStorage.getItem(key) || "[]");
      return Array.isArray(list) ? list.filter((e) => e && e.id) : [];
    } catch {
      return [];
    }
  }

  function write(key, list) {
    try { window.localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage blocked */ }
  }

  const readHistory = () => read(HISTORY_KEY).filter((e) => Number(e.episode) >= 1);

  /* ---------- helpers ---------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const httpsOnly = (url) => (/^https:\/\//i.test(url || "") ? url : "");

  function formatGroup(format) {
    const f = String(format || "").toLowerCase();
    if (f.includes("movie")) return "movie";
    if (f.startsWith("tv")) return "tv";
    return "other";
  }

  function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - Number(timestamp)) / 1000);
    if (!Number.isFinite(seconds) || seconds < 0) return "";
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  function dayGroup(timestamp) {
    const t = Number(timestamp);
    if (!Number.isFinite(t) || t <= 0) return "Earlier";
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 86400000;
    if (t >= startToday) return "Today";
    if (t >= startToday - day) return "Yesterday";
    if (t >= startToday - 6 * day) return "This week";
    return "Earlier";
  }

  const GROUP_ORDER = ["Today", "Yesterday", "This week", "Earlier"];

  // title in the language chosen with the EN / JP switch
  const titleOf = (entry) => (entry.titles && window.HugTitle.pick(entry.titles)) || entry.title || "Unknown anime";

  const watchHref = (id, ep) => `/watch?id=${encodeURIComponent(id)}&ep=${encodeURIComponent(ep)}`;

  /* ---------- cards ---------- */

  function buildCard({ href, cover, title, badge, badgeAccent, progress, meta, id, playLabel }) {
    const card = el("article", "lib_card");

    const link = el("a", "lib_link");
    link.href = href;
    link.title = playLabel || title;

    const poster = el("div", "lib_poster");
    const src = httpsOnly(cover);
    if (src) {
      const img = el("img");
      img.src = src;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      poster.append(img);
    }
    if (badge) poster.append(el("span", "lib_badge" + (badgeAccent ? " lib_badge--accent" : ""), badge));

    const play = el("span", "lib_play");
    play.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    poster.append(play);

    if (progress != null) {
      const bar = el("div", "lib_progress");
      const fill = el("span");
      fill.style.width = progress + "%";
      bar.append(fill);
      poster.append(bar);
    }

    link.append(poster, el("h3", "lib_name", title));
    if (meta) link.append(el("p", "lib_meta", meta));

    const remove = el("button", "lib_remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${title}`);
    remove.title = mode === "list" ? "Remove from list" : "Remove from history";
    remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    remove.addEventListener("click", () => {
      write(KEY, read(KEY).filter((e) => String(e.id) !== String(id)));
      render();
    });

    card.append(link, remove);
    return card;
  }

  function recentCard(entry) {
    const ep = Math.floor(Number(entry.episode));
    const total = Number(entry.totalEpisodes);
    const progress = total ? Math.max(4, Math.min(100, Math.round((ep / total) * 100))) : 6;
    const when = timeAgo(entry.updatedAt);
    return buildCard({
      id: entry.id,
      href: watchHref(entry.id, ep),
      cover: entry.poster,
      title: titleOf(entry),
      badge: `EP ${ep}`,
      progress,
      meta: [total ? `Episode ${ep} of ${total}` : `Episode ${ep}`, when].filter(Boolean).join(" \u00b7 "),
      playLabel: `${titleOf(entry)} - continue from episode ${ep}`,
    });
  }

  function listCard(entry, history) {
    const seen = history.get(String(entry.id));
    const ep = seen ? Math.floor(Number(seen.episode)) : 1;
    const eps = Number(entry.episodes);
    const meta = [entry.format, eps ? `${eps} eps` : ""].filter(Boolean).join(" \u00b7 ");
    return buildCard({
      id: entry.id,
      href: watchHref(entry.id, ep),
      cover: entry.cover,
      title: titleOf(entry),
      badge: seen ? `Continue EP ${ep}` : "",
      badgeAccent: true,
      meta,
      playLabel: seen ? `${titleOf(entry)} - continue from episode ${ep}` : titleOf(entry),
    });
  }

  /* ---------- rendering ---------- */

  function visibleItems(all) {
    const q = state.query.trim().toLowerCase();
    let items = all.filter((e) => !q || [e.title, e.titles?.english, e.titles?.romaji].some((t) => String(t || "").toLowerCase().includes(q)));
    if (mode === "list" && state.filter !== "all") items = items.filter((e) => formatGroup(e.format) === state.filter);

    if (mode === "recent") {
      items = items.slice().sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    } else if (state.sort === "az") {
      items = items.slice().sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    } else if (state.sort === "za") {
      items = items.slice().sort((a, b) => titleOf(b).localeCompare(titleOf(a)));
    } // "added": saved order, newest first
    return items;
  }

  function showEmpty(title, text, withCta) {
    contentEl.replaceChildren();
    emptyEl.hidden = false;
    emptyEl.querySelector("h2").textContent = title;
    emptyEl.querySelector("p").textContent = text;
    emptyEl.querySelector(".lib_cta").hidden = !withCta;
  }

  function render() {
    const all = mode === "list" ? read(LIST_KEY) : readHistory();
    const hasAny = all.length > 0;

    subEl.textContent = hasAny
      ? mode === "list"
        ? `${all.length} saved`
        : `${all.length} in your history`
      : mode === "list" ? "Anime you saved to watch later" : "Pick up where you left off";

    searchWrap.hidden = !hasAny;
    clearBtn.hidden = !hasAny;
    if (barEl) barEl.hidden = !hasAny;

    if (!hasAny) {
      if (mode === "list") {
        showEmpty("Your list is empty", "Open any anime and press \u201cAdd to list\u201d to keep it here for later.", true);
      } else {
        showEmpty("Nothing watched yet", "Episodes you watch will show up here so you can jump back in where you stopped.", true);
      }
      return;
    }

    const items = visibleItems(all);
    if (!items.length) {
      showEmpty("No matches", state.query ? `Nothing in your ${mode === "list" ? "list" : "history"} matches \u201c${state.query.trim()}\u201d.` : "Nothing here for this filter.", false);
      return;
    }
    emptyEl.hidden = true;
    contentEl.replaceChildren();

    if (mode === "list") {
      const history = new Map(readHistory().map((e) => [String(e.id), e]));
      const grid = el("div", "lib_grid");
      for (const item of items) grid.append(listCard(item, history));
      contentEl.append(grid);
      return;
    }

    const groups = new Map();
    for (const item of items) {
      const name = dayGroup(item.updatedAt);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    }
    for (const name of GROUP_ORDER) {
      const entries = groups.get(name);
      if (!entries) continue;
      const section = el("section", "lib_group");
      const heading = el("h2", "lib_group-title", name);
      heading.append(el("span", "", String(entries.length)));
      const grid = el("div", "lib_grid");
      for (const entry of entries) grid.append(recentCard(entry));
      section.append(heading, grid);
      contentEl.append(section);
    }
  }

  function renderFilters() {
    if (!filtersEl) return;
    filtersEl.replaceChildren();
    for (const f of FILTERS) {
      const b = el("button", "lib_pill" + (f.id === state.filter ? " is-active" : ""), f.label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(f.id === state.filter));
      b.addEventListener("click", () => {
        state.filter = f.id;
        renderFilters();
        render();
      });
      filtersEl.append(b);
    }
  }

  /* ---------- events ---------- */

  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    render();
  });

  sortEl?.addEventListener("change", () => {
    state.sort = sortEl.value;
    render();
  });

  clearBtn.addEventListener("click", () => {
    const ok = window.confirm(
      mode === "list" ? "Remove everything from your list? This can't be undone." : "Clear your entire watch history? This can't be undone."
    );
    if (!ok) return;
    write(KEY, []);
    render();
  });

  // changes made in another tab (or by the watch page) show up here too
  window.addEventListener("storage", (e) => {
    if (e.key === HISTORY_KEY || e.key === LIST_KEY || e.key === null) render();
  });

  window.addEventListener("pageshow", render);

  // EN / JP switch: show the other title language right away
  document.addEventListener("huganime:preferences", render);

  renderFilters();
  render();

  // entries saved before both titles were stored: fetch them once, then re-render
  window.HugTitle.fillMissing(KEY).then((changed) => { if (changed) render(); });
})();
