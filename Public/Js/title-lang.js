// Title language, driven by the EN / JP switch (top bar + side menu, saved as "huganime-lang").
//   EN (dub)  -> English title      JP (sub) -> Japanese name (romaji), e.g. "Sousou no Frieren"
// Load this BEFORE the other scripts. Everything that shows an anime title goes through HugTitle.pick(),
// and when the switch changes, titles already on the page are swapped in place.
(() => {
  "use strict";

  const LANG_KEY = "huganime-lang";
  const API = "https://graphql.anilist.co";
  const pairs = new Map(); // any known title string -> { en, jp }

  function current() {
    const fromPage = document.documentElement.dataset.lang;
    if (fromPage === "dub" || fromPage === "sub") return fromPage === "dub" ? "en" : "jp";
    try { return window.localStorage.getItem(LANG_KEY) === "sub" ? "jp" : "en"; } catch { return "en"; }
  }

  function register(en, jp) {
    if (!en || !jp || en === jp) return;
    const pair = { en, jp };
    pairs.set(en, pair);
    pairs.set(jp, pair);
  }

  // title: { english, romaji, native } (AniList shape) or { en, jp } or a plain string
  function pick(title, fallback = "Untitled") {
    if (!title) return fallback;
    if (typeof title === "string") {
      const known = pairs.get(title);
      return known ? known[current()] : title;
    }
    const english = title.english || title.en || "";
    const romaji = title.romaji || title.jp || "";
    const native = title.native || "";
    const en = english || romaji || native;
    const jp = romaji || english || native;
    register(en, jp);
    return (current() === "en" ? en : jp) || fallback;
  }

  // both titles of something that is shown on the page, so it can be saved (history / list)
  function pairFor(text) {
    const known = pairs.get(text);
    return known ? { english: known.en, romaji: known.jp } : null;
  }

  /* ---------- swap titles that are already on screen ---------- */

  function swapAll() {
    if (!document.body || !pairs.size) return;
    const lang = current();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement?.tagName;
        if (!tag || tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "OPTION") return NodeFilter.FILTER_REJECT;
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const key = node.nodeValue.trim();
      const pair = pairs.get(key);
      if (pair && pair[lang] !== key) node.nodeValue = node.nodeValue.replace(key, pair[lang]);
    }

    for (const attr of ["title", "alt", "aria-label"]) {
      document.querySelectorAll(`[${attr}]`).forEach((node) => {
        const pair = pairs.get(node.getAttribute(attr));
        if (pair) node.setAttribute(attr, pair[lang]);
      });
    }
    document.querySelectorAll("[data-anime-title]").forEach((node) => {
      const pair = pairs.get(node.dataset.animeTitle);
      if (pair) node.dataset.animeTitle = pair[lang];
    });
  }

  document.addEventListener("huganime:preferences", swapAll);

  /* ---------- saved entries (history / list) that only have ONE title ---------- */
  // Fetches both titles from AniList once and stores them on the entry as `titles`.
  // Resolves true if anything was saved, so the caller can re-render.
  async function fillMissing(storageKey) {
    let list;
    try { list = JSON.parse(window.localStorage.getItem(storageKey) || "[]"); } catch { return false; }
    if (!Array.isArray(list)) return false;
    const missing = [...new Set(list.filter((e) => e && e.id && !e.titles).map((e) => Number(e.id)).filter(Number.isFinite))];
    if (!missing.length) return false;

    const found = new Map();
    for (let i = 0; i < missing.length; i += 50) {
      const ids = missing.slice(i, i + 50);
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            query: "query ($ids: [Int], $n: Int) { Page(page: 1, perPage: $n) { media(id_in: $ids, type: ANIME) { id title { romaji english } } } }",
            variables: { ids, n: ids.length },
          }),
        });
        if (!res.ok) continue;
        const json = await res.json();
        for (const m of json?.data?.Page?.media || []) found.set(Number(m.id), m.title);
      } catch { /* offline or rate limited: try again next visit */ }
    }
    if (!found.size) return false;

    try {
      // re-read so we never overwrite something saved while we were waiting
      const fresh = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      let changed = false;
      for (const entry of fresh) {
        const t = entry && found.get(Number(entry.id));
        if (t && !entry.titles) {
          entry.titles = { english: t.english || t.romaji || "", romaji: t.romaji || t.english || "" };
          changed = true;
        }
      }
      if (changed) window.localStorage.setItem(storageKey, JSON.stringify(fresh));
      return changed;
    } catch { return false; }
  }

  window.HugTitle = { pick, pairFor, current, swapAll, fillMissing };
})();
