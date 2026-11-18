// Dub badge on the home page cards: a mic + the number of episodes that have an English dub.
// The badge only appears when the anime has a dub; no dub = nothing is shown.
//
// How it works: every card carries data-anime-id (see rows.js). New cards are collected, sent to our own server
// (POST /dub-counts, see dubcount.js) in small batches, and the answer is cached in the browser for a few hours.
// The server may answer "pending" while it looks a title up (it is rate limited), so those are asked again a little later.
(() => {
  "use strict";

  const ENDPOINT = "/dub-counts";
  const CACHE_KEY = "huganime-dub-v1";
  const CACHE_MS = 3 * 60 * 60 * 1000;     // a known count is reused for 3 hours
  const MAX_BATCH = 30;
  const RETRY_MS = 6000;                    // pending answers are asked again after this
  const MAX_TRIES = 30;                     // ... for about 3 minutes, then we give up until the next visit
  const CARD = ".anime-card[data-anime-id]";

  const ICON_MIC = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/><path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5z"/></svg>';

  /* ---------- small browser cache: { "<anilist id>": { dub, at } } ---------- */
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch { cache = {}; }
  const fresh = (id) => cache[id] && Date.now() - cache[id].at < CACHE_MS;
  let saveTimer = 0;
  function remember(id, dub) {
    cache[id] = { dub, at: Date.now() };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const entries = Object.entries(cache).filter(([, v]) => Date.now() - v.at < CACHE_MS).slice(-600);
        cache = Object.fromEntries(entries);
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch { /* storage full or blocked */ }
    }, 800);
  }

  /* ---------- the badge ---------- */
  function showBadge(id, dub) {
    if (!(dub > 0)) return;
    document.querySelectorAll(`${CARD}[data-anime-id="${CSS.escape(String(id))}"]`).forEach((card) => {
      const poster = card.querySelector(".anime-card_poster");
      if (!poster || poster.querySelector(".pill--dub")) return;
      let bar = poster.querySelector(".badge-bottom");
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "badge-bottom";
        poster.appendChild(bar);
      }
      const pill = document.createElement("span");
      pill.className = dub <= 9 ? "pill pill--dub pill--dub-few" : "pill pill--dub";   // 1-9 dubbed episodes: pushed a little further right
      pill.title = `${dub} dubbed ${dub === 1 ? "episode" : "episodes"}`;
      pill.setAttribute("aria-label", pill.title);
      pill.innerHTML = ICON_MIC;
      pill.append(String(dub));
      bar.appendChild(pill);
    });
  }

  /* ---------- asking the server ---------- */
  const waiting = new Map();   // id -> { id, malId, titles }
  const tries = new Map();     // id -> how many times the server said "pending"
  const inFlight = new Set();
  let flushTimer = 0;

  function infoOf(card) {
    let titles = [];
    try { titles = JSON.parse(card.dataset.animeTitles || "[]"); } catch { /* ignore */ }
    if (!titles.length && card.dataset.animeTitle) titles = [card.dataset.animeTitle];
    return { id: card.dataset.animeId, malId: card.dataset.animeMal || "", titles };
  }

  function queueCard(card) {
    const id = card.dataset.animeId;
    if (!id || inFlight.has(id)) return;
    if (fresh(id)) { showBadge(id, cache[id].dub); return; }
    if ((tries.get(id) || 0) >= MAX_TRIES || waiting.has(id)) return;
    waiting.set(id, infoOf(card));
  }

  function scan(root = document) {
    root.querySelectorAll(CARD).forEach(queueCard);
    if (waiting.size) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 300); }
  }

  function retryLater(id) {
    inFlight.delete(id);
    tries.set(id, (tries.get(id) || 0) + 1);
    setTimeout(() => {
      const card = document.querySelector(`${CARD}[data-anime-id="${CSS.escape(String(id))}"]`);
      if (card) { queueCard(card); if (waiting.size) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 300); } }
    }, RETRY_MS);
  }

  async function flush() {
    if (document.hidden) { flushTimer = setTimeout(flush, RETRY_MS); return; }   // no polling in a background tab
    const batch = [...waiting.values()].slice(0, MAX_BATCH);
    if (!batch.length) return;
    batch.forEach((item) => { waiting.delete(item.id); inFlight.add(item.id); });
    if (waiting.size) flushTimer = setTimeout(flush, 300);                       // more are waiting: next batch

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { counts = {} } = await res.json();
      for (const item of batch) {
        const answer = counts[item.id];
        if (answer && answer.state === "ready") {
          inFlight.delete(item.id);
          remember(item.id, Number(answer.dub) || 0);
          showBadge(item.id, Number(answer.dub) || 0);
        } else if (answer && answer.state === "none") {
          inFlight.delete(item.id);
          remember(item.id, 0);                                                  // not in the list / no dub info: no badge
        } else {
          retryLater(item.id);                                                   // pending (or no answer): ask again soon
        }
      }
    } catch {
      batch.forEach((item) => retryLater(item.id));                              // server down or offline: try again later
    }
  }

  /* ---------- start: cards that exist now + cards the rows add later while scrolling ---------- */
  scan();
  let scanTimer = 0;
  const addsCards = (node) => node.nodeType === 1 && (node.matches(CARD) || node.querySelector(CARD));
  new MutationObserver((mutations) => {
    // only react to new cards (not to the schedule clock ticking, search results, etc.)
    if (!mutations.some((m) => Array.from(m.addedNodes).some(addsCards))) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }).observe(document.body, { childList: true, subtree: true });
})();
