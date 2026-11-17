// "Estimated Schedule" block on the home page: one week (Mon-Sun) of airing episodes in the visitor's own
// timezone, one day at a time (data from the AniList GraphQL API, same source as the Schedule page).
(() => {
  "use strict";

  const root = document.getElementById("home-schedule");
  if (!root) return;

  const API = "https://graphql.anilist.co";
  const PER_PAGE = 50;
  const MAX_PAGES = 8;
  const CACHE_MS = 10 * 60 * 1000;
  const CACHE_PREFIX = "huganime-home-schedule:";
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  const QUERY = `
    query ($from: Int, $to: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          airingAt
          episode
          media { id isAdult title { romaji english } }
        }
      }
    }`;

  const daysEl = root.querySelector("#hs-days");
  const listEl = root.querySelector("#hs-list");
  const nowEl = root.querySelector("#hs-now");
  const prevBtn = root.querySelector(".hs_arrow--prev");
  const nextBtn = root.querySelector(".hs_arrow--next");

  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  const state = { weekStart: startOfWeek(new Date()), dayIndex: 0, items: new Map(), token: 0 };

  /* ---------- helpers ---------- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function startOfWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }

  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const sameDay = (a, b) => dayKey(a) === dayKey(b);

  /* ---------- data ---------- */
  async function post(variables) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables }),
      });
      if (res.status === 429) {
        await wait(Math.min(Number(res.headers.get("Retry-After")) || 2, 6) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return json.data.Page;
    }
    throw new Error("Too many requests, try again in a moment.");
  }

  async function fetchDay(day) {
    const key = CACHE_PREFIX + dayKey(day);
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || "null");
      if (cached && Date.now() - cached.time < CACHE_MS) return cached.items;
    } catch { /* storage blocked or bad JSON */ }

    const from = Math.floor(day.getTime() / 1000) - 1;
    const to = Math.floor(addDays(day, 1).getTime() / 1000);
    const seen = new Set();
    const items = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await post({ from, to, page, perPage: PER_PAGE });
      for (const row of data.airingSchedules) {
        const m = row.media;
        if (!m || m.isAdult) continue;
        const id = `${m.id}-${row.episode}`;
        if (seen.has(id)) continue;
        seen.add(id);
        items.push({
          id: m.id,
          episode: row.episode,
          at: row.airingAt * 1000,
          titles: { english: m.title?.english || "", romaji: m.title?.romaji || "" },
        });
      }
      if (!data.pageInfo.hasNextPage) break;
      await wait(350); // stay friendly with AniList's rate limit
    }

    items.sort((a, b) => a.at - b.at);
    try { sessionStorage.setItem(key, JSON.stringify({ time: Date.now(), items })); } catch { /* ignore */ }
    return items;
  }

  /* ---------- rendering ---------- */
  function renderDays() {
    daysEl.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const d = addDays(state.weekStart, i);
      const b = el("button", "hs_day" + (i === state.dayIndex ? " is-active" : ""));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === state.dayIndex));
      b.append(
        el("span", "hs_day-date", `${MONTHS[d.getMonth()]} ${d.getDate()}`),
        el("span", "hs_day-name", DAYS[d.getDay()])
      );
      b.addEventListener("click", () => {
        if (state.dayIndex === i) return;
        state.dayIndex = i;
        renderDays();
        loadDay();
      });
      daysEl.append(b);
    }
  }

  function renderSkeleton() {
    listEl.setAttribute("aria-busy", "true");
    listEl.replaceChildren();
    for (let i = 0; i < 5; i++) listEl.append(el("div", "hs_skel"));
  }

  function renderMessage(text, retry) {
    listEl.setAttribute("aria-busy", "false");
    listEl.replaceChildren();
    const box = el("div", "hs_message");
    box.append(el("p", "", text));
    if (retry) {
      const btn = el("button", "hs_retry", "Try again");
      btn.type = "button";
      btn.addEventListener("click", retry);
      box.append(btn);
    }
    listEl.append(box);
  }

  function renderList(items) {
    listEl.setAttribute("aria-busy", "false");
    listEl.replaceChildren();
    listEl.scrollTop = 0;
    if (!items.length) return renderMessage("No episodes scheduled for this day.");

    for (const item of items) {
      const link = el("a", "hs_item");
      link.href = `/watch?id=${encodeURIComponent(item.id)}&ep=${encodeURIComponent(item.episode)}`;

      const title = (window.HugTitle && window.HugTitle.pick(item.titles)) || item.titles.english || item.titles.romaji || "Untitled";
      const pill = el("span", "hs_ep");
      pill.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>';
      pill.append(`Episode ${item.episode}`);

      link.append(el("span", "hs_time", timeFmt.format(new Date(item.at))), el("span", "hs_name", title), pill);
      listEl.append(link);
    }
  }

  async function loadDay() {
    const token = ++state.token;
    const day = addDays(state.weekStart, state.dayIndex);
    const key = dayKey(day);
    if (state.items.has(key)) return renderList(state.items.get(key));

    renderSkeleton();
    try {
      const items = await fetchDay(day);
      if (token !== state.token) return;
      state.items.set(key, items);
      renderList(items);
    } catch (err) {
      if (token !== state.token) return;
      console.error("Could not load the schedule:", err);
      renderMessage(err.message || "Couldn't load the schedule.", () => {
        try { sessionStorage.removeItem(CACHE_PREFIX + key); } catch { /* ignore */ }
        loadDay();
      });
    }
  }

  /* ---------- week arrows + clock ---------- */
  function goToWeek(date) {
    state.weekStart = date;
    const today = new Date();
    state.dayIndex = 0;
    for (let i = 0; i < 7; i++) if (sameDay(addDays(date, i), today)) state.dayIndex = i;
    renderDays();
    loadDay();
  }

  prevBtn.addEventListener("click", () => goToWeek(addDays(state.weekStart, -7)));
  nextBtn.addEventListener("click", () => goToWeek(addDays(state.weekStart, 7)));

  function tick() { if (!document.hidden) nowEl.textContent = `- Now: ${new Date().toLocaleString()}`; }
  tick();
  setInterval(tick, 1000);
  document.addEventListener("visibilitychange", tick);

  /* ---------- start: today's tab, loaded when the block is near the screen (saves API requests) ---------- */
  const todayIndex = Math.round((new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - state.weekStart) / 864e5);
  state.dayIndex = todayIndex >= 0 && todayIndex < 7 ? todayIndex : 0;
  renderDays();
  renderSkeleton();

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      loadDay();
    }, { rootMargin: "300px 0px" });
    io.observe(root);
  } else {
    loadDay();
  }
})();
