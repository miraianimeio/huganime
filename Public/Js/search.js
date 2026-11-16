(() => {
  "use strict";

  const API = "https://graphql.anilist.co";
  const MAX_RESULTS = 8;
  const DEBOUNCE_MS = 350;
  const HISTORY_KEY = "huganime-history";
  const HISTORY_MAX = 20;

  const QUERY = `
    query ($q: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
          id
          siteUrl
          title { romaji english }
          coverImage { large medium }
          averageScore
          format
          seasonYear
          duration
          episodes
          status
          nextAiringEpisode { episode }
        }
      }
    }`;

  const FORMATS = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };

  const box = document.querySelector(".nav-search");
  const input = document.getElementById("manga-search");
  const results = document.getElementById("search-results");
  if (!box || !input || !results) return;

  const clearBtn = box.querySelector(".search-clear");
  const tabs = Array.from(box.querySelectorAll(".search-tab"));

  let activeType = "anime";
  let timer = 0;
  let controller = null;
  let requestId = 0;
  const cache = new Map();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function store() {
    try { return window.localStorage; } catch { return null; }
  }

  function shortDuration(mins) {
    if (!mins) return "";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return [h && h + "h", m && m + "m"].filter(Boolean).join(" ");
  }

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
      title: a.title?.english || a.title?.romaji || "Untitled",
      url: a.siteUrl,
      image: a.coverImage?.large || a.coverImage?.medium || "",
      score: a.averageScore ? a.averageScore / 10 : null,
      type: FORMATS[a.format] || "",
      duration: shortDuration(a.duration),
      episodes: releasedEpisodes(a),
      dub: 0,
      airing: a.status === "RELEASING",
    };
  }

  function addHistory(card) {
    try {
      const ls = store();
      if (!ls) return;
      const list = JSON.parse(ls.getItem(HISTORY_KEY) || "[]").filter((c) => c.id !== card.id);
      list.unshift(card);
      ls.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    } catch { /* storage blocked */ }
  }

  function openPanel() {
    box.classList.add("is-open");
    input.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    box.classList.remove("is-open");
    input.setAttribute("aria-expanded", "false");
  }

  function updateHasText() {
    box.classList.toggle("has-text", input.value.length > 0);
  }

  function showMessage(text) {
    results.replaceChildren(el("p", "search-message", text));
  }

  function makeResult(card) {
    const item = el("button", "search-result");
    item.type = "button";
    item.setAttribute("role", "option");

    const img = el("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = card.image;

    const copy = el("span", "search-result-copy");
    copy.append(
      el("span", "search-result-title", card.title),
      el("span", "search-result-meta", card.meta)
    );

    item.append(img, copy);
    item.addEventListener("click", () => choose(card));
    return item;
  }

  function showResults(cards) {
    if (!cards.length) return showMessage("No anime found.");
    results.replaceChildren(...cards.map(makeResult));
  }

  // A result opens HugAnime's own watch page (watch.html reads ?id= = the AniList id, and ?ep=), not AniList.
  const watchUrl = (card) => `/watch.html?id=${encodeURIComponent(card.id)}&ep=1`;

  function choose(card) {
    const url = watchUrl(card);
    addHistory({ ...card, url });
    closePanel();
    window.location.href = url;
  }

  async function fetchResults(q, signal) {
    for (let i = 0; i < 2; i++) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { q, perPage: MAX_RESULTS } }),
        signal,
      });
      if (res.status === 429) {
        const retry = Number(res.headers.get("Retry-After")) || 2;
        await new Promise((r) => setTimeout(r, Math.min(retry, 5) * 1000));
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return (json.data?.Page?.media || []).map((a) => {
        const card = toCard(a);
        card.meta = [
          card.type,
          a.seasonYear,
          card.score ? "★ " + card.score.toFixed(1) : "",
        ].filter(Boolean).join(" · ");
        return card;
      });
    }
    throw new Error("Rate limited");
  }

  async function runSearch() {
    const q = input.value.trim();

    if (activeType !== "anime") {
      showMessage("User search isn't available yet.");
      return;
    }
    if (q.length < 2) {
      results.replaceChildren();
      return;
    }

    const key = q.toLowerCase();
    if (cache.has(key)) return showResults(cache.get(key));

    if (controller) controller.abort();
    controller = new AbortController();
    const myId = ++requestId;
    showMessage("Searching…");

    try {
      const cards = await fetchResults(q, controller.signal);
      if (myId !== requestId) return;
      cache.set(key, cards);
      showResults(cards);
    } catch (err) {
      if (err.name === "AbortError" || myId !== requestId) return;
      console.error("Search failed:", err);
      showMessage("Couldn't search right now. Please try again.");
    }
  }

  function scheduleSearch() {
    clearTimeout(timer);
    timer = setTimeout(runSearch, DEBOUNCE_MS);
  }

  input.addEventListener("focus", openPanel);
  input.addEventListener("click", openPanel);

  input.addEventListener("input", () => {
    updateHasText();
    openPanel();
    scheduleSearch();
  });

  clearBtn?.addEventListener("click", () => {
    clearTimeout(timer);
    if (controller) controller.abort();
    requestId++;
    input.value = "";
    updateHasText();
    results.replaceChildren();
    input.focus();
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeType = tab.dataset.type || "anime";
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", String(on));
      });
      runSearch();
      input.focus();
    });
  });

  function options() {
    return Array.from(results.querySelectorAll(".search-result"));
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      const list = options();
      if (list.length) { e.preventDefault(); list[0].focus(); }
    } else if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timer);
      const q = input.value.trim();
      if (q) window.location.href = "/all-anime-index.html?keyword=" + encodeURIComponent(q);
    } else if (e.key === "Escape") {
      closePanel();
      input.blur();
    }
  });

  results.addEventListener("keydown", (e) => {
    const list = options();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[Math.min(i + 1, list.length - 1)].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i === 0) input.focus(); else list[i - 1].focus();
    } else if (e.key === "Escape") {
      closePanel();
      input.blur();
    }
  });

  document.addEventListener("click", (e) => {
    if (!box.contains(e.target)) closePanel();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      input.focus();
      input.select();
      openPanel();
    }
  });
})();