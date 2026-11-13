// Weekly schedule: episodes airing Mon-Sun in the visitor's own timezone (data from the AniList GraphQL API).
(() => {
  "use strict";

  const API = "https://graphql.anilist.co";
  const PER_PAGE = 50;
  const MAX_PAGES = 12;
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const CACHE_PREFIX = "huganime-schedule:";

  const QUERY = `
    query ($from: Int, $to: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          airingAt
          episode
          media {
            id
            isAdult
            format
            genres
            description(asHtml: false)
            title { romaji english }
            coverImage { large medium }
          }
        }
      }
    }`;

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "tv", label: "TV" },
    { id: "movie", label: "Movie" },
    { id: "other", label: "OVA / ONA" },
  ];

  const root = document.getElementById("schedule");
  if (!root) return;

  const rangeEl = document.getElementById("sch-range");
  const clockEl = document.getElementById("sch-clock");
  const daysEl = document.getElementById("sch-days");
  const filtersEl = document.getElementById("sch-filters");
  const summaryEl = document.getElementById("sch-summary");
  const timelineEl = document.getElementById("sch-timeline");
  const prevBtn = document.getElementById("sch-prev");
  const nextBtn = document.getElementById("sch-next");
  const todayBtn = document.getElementById("sch-today");

  const timeFmt = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
  const clockFmt = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const timezone = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "your timezone"; } catch { return "your timezone"; }
  })();

  const state = {
    weekStart: startOfWeek(new Date()),
    items: [],
    dayIndex: 0,
    filter: "all",
    loading: true,
    token: 0,
    partition: -1,
    showAired: false,
  };

  /* ---------- small helpers ---------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const shortDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

  function cleanText(text) {
    if (!text) return "";
    const doc = new DOMParser().parseFromString(String(text).replace(/<br\s*\/?>/gi, " "), "text/html");
    return doc.body.textContent.replace(/\s+/g, " ").trim();
  }

  function formatGroup(format) {
    if (format === "MOVIE") return "movie";
    if (format === "TV" || format === "TV_SHORT") return "tv";
    return "other";
  }

  function timeParts(ms) {
    const parts = timeFmt.formatToParts(new Date(ms));
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const hour = get("hour");
    const minute = get("minute");
    return { main: `${hour}:${minute}`, period: get("dayPeriod").toUpperCase() };
  }

  function countdown(ms, now) {
    const diff = ms - now;
    if (diff <= 0) return { text: "Aired", past: true };
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return { text: "Airing now", past: false };
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    if (d) return { text: `In ${d}d ${h}h`, past: false };
    if (h) return { text: `In ${h}h ${m}m`, past: false };
    return { text: `In ${m}m`, past: false };
  }

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

  function normalise(row) {
    const m = row.media;
    if (!m || m.isAdult) return null;
    return {
      key: `${m.id}-${row.episode}`,
      at: row.airingAt * 1000,
      episode: row.episode,
      id: m.id,
      title: window.HugTitle.pick(m.title),
      titles: { english: m.title?.english || "", romaji: m.title?.romaji || "" },
      cover: m.coverImage?.large || m.coverImage?.medium || "",
      desc: cleanText(m.description),
      genres: (m.genres || []).slice(0, 3),
      group: formatGroup(m.format),
    };
  }

  async function fetchWeek(weekStart) {
    const cacheKey = CACHE_PREFIX + dayKey(weekStart);
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.items;
    } catch { /* storage blocked or bad JSON */ }

    const from = Math.floor(weekStart.getTime() / 1000) - 1;
    const to = Math.floor(addDays(weekStart, 7).getTime() / 1000);
    const seen = new Set();
    const items = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await post({ from, to, page, perPage: PER_PAGE });
      for (const row of data.airingSchedules) {
        const item = normalise(row);
        if (item && !seen.has(item.key)) {
          seen.add(item.key);
          items.push(item);
        }
      }
      if (!data.pageInfo.hasNextPage) break;
      await wait(350); // stay friendly with AniList's rate limit
    }

    items.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), items })); } catch { /* ignore */ }
    return items;
  }

  async function load() {
    const token = ++state.token;
    state.loading = true;
    state.partition = -1;
    renderHead();
    renderDays();
    renderSummary();
    renderLoading();

    try {
      const items = await fetchWeek(state.weekStart);
      if (token !== state.token) return;
      state.items = items;
      state.loading = false;
      renderAll();
    } catch (error) {
      if (token !== state.token) return;
      state.items = [];
      state.loading = false;
      renderError(error.message);
    }
  }

  /* ---------- derived data ---------- */

  const visible = () => state.items.filter((i) => state.filter === "all" || i.group === state.filter);

  function itemsForDay(index) {
    const day = addDays(state.weekStart, index);
    return visible().filter((i) => sameDay(new Date(i.at), day));
  }

  function defaultDayIndex() {
    const today = new Date();
    for (let i = 0; i < 7; i++) if (sameDay(addDays(state.weekStart, i), today)) return i;
    return 0;
  }

  /* ---------- rendering ---------- */

  function renderHead() {
    const first = state.weekStart;
    const last = addDays(first, 6);
    rangeEl.textContent = `${DAYS[first.getDay()]} ${shortDate(first)} \u2013 ${DAYS[last.getDay()]} ${shortDate(last)} \u00b7 ${timezone}`;
    todayBtn.hidden = sameDay(state.weekStart, startOfWeek(new Date()));
  }

  function renderFilters() {
    filtersEl.replaceChildren();
    for (const f of FILTERS) {
      const b = el("button", "sch_pill" + (f.id === state.filter ? " is-active" : ""), f.label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(f.id === state.filter));
      b.addEventListener("click", () => {
        state.filter = f.id;
        state.partition = -1;
        renderAll();
      });
      filtersEl.append(b);
    }
  }

  function renderDays() {
    daysEl.replaceChildren();
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = addDays(state.weekStart, i);
      const isToday = sameDay(d, today);
      const count = state.loading ? null : itemsForDay(i).length;

      const b = el("button", "sch_day" + (i === state.dayIndex ? " is-active" : ""));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === state.dayIndex));

      const date = el("span", "sch_day-date", shortDate(d).toUpperCase());
      if (isToday) {
        const tag = el("span", "sch_today-tag", " \u00b7 TODAY");
        date.append(tag);
      }
      b.append(
        date,
        el("span", "sch_day-name", DAYS[d.getDay()].toUpperCase()),
        el("span", "sch_day-count", count === null ? "\u00a0" : `${count} ${count === 1 ? "ep" : "eps"}`)
      );
      b.addEventListener("click", () => {
        state.dayIndex = i;
        state.showAired = false;
        state.partition = -1;
        renderDays();
        renderSummary();
        renderTimeline();
      });
      daysEl.append(b);
    }
  }

  function renderSummary() {
    const d = addDays(state.weekStart, state.dayIndex);
    summaryEl.replaceChildren(`${DAYS[d.getDay()]} ${shortDate(d)}`);
    if (!state.loading) {
      const n = itemsForDay(state.dayIndex).length;
      summaryEl.append(el("span", "", ` \u00b7 ${n} ${n === 1 ? "episode" : "episodes"}`));
    }
  }

  function renderLoading() {
    timelineEl.setAttribute("aria-busy", "true");
    timelineEl.replaceChildren();
    for (let i = 0; i < 3; i++) timelineEl.append(el("div", "sch_skel"));
  }

  function renderError(message) {
    timelineEl.setAttribute("aria-busy", "false");
    timelineEl.replaceChildren();
    const box = el("div", "sch_message");
    box.append(el("p", "", message || "Couldn't load the schedule."));
    const retry = el("button", "sch_retry", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => {
      try { sessionStorage.removeItem(CACHE_PREFIX + dayKey(state.weekStart)); } catch { /* ignore */ }
      load();
    });
    box.append(retry);
    timelineEl.append(box);
    renderDays();
    renderSummary();
  }

  function buildCard(item, now) {
    const card = el("article", "sch_card");

    const img = el("img", "sch_cover");
    img.src = item.cover;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    card.append(img);

    const info = el("div", "sch_info");

    const row = el("div", "sch_row");
    const name = el("h2", "sch_name");
    const link = el("a", "", (item.titles && window.HugTitle.pick(item.titles)) || item.title);
    link.href = `watch.html?id=${encodeURIComponent(item.id)}&ep=${encodeURIComponent(item.episode)}`;
    name.append(link);

    const cd = countdown(item.at, now);
    const eta = el("span", "sch_eta" + (cd.past ? " is-aired" : ""), cd.text);
    eta.dataset.at = String(item.at);
    row.append(name, eta);

    const meta = el("div", "sch_meta");
    meta.append(el("span", "sch_badge", "SUB"), el("span", "sch_ep", `Episode ${item.episode}`));

    info.append(row, meta);
    if (item.desc) info.append(el("p", "sch_desc", item.desc));
    if (item.genres.length) {
      const genres = el("div", "sch_genres");
      for (const g of item.genres) genres.append(el("span", "sch_genre", g));
      info.append(genres);
    }
    card.append(info);
    return card;
  }

  function buildNow(now) {
    const t = timeParts(now);
    const wrap = el("div", "sch_now");
    const time = el("div", "sch_now-time");
    time.append(el("b", "", t.main));
    if (t.period) time.append(el("small", "", t.period));
    wrap.append(time, el("div", "sch_now-line", "NOW"));
    return wrap;
  }

  function renderTimeline() {
    if (state.loading) return;
    timelineEl.setAttribute("aria-busy", "false");
    timelineEl.replaceChildren();

    const now = Date.now();
    const dayItems = itemsForDay(state.dayIndex);
    const isToday = sameDay(addDays(state.weekStart, state.dayIndex), new Date());
    state.partition = isToday ? dayItems.filter((i) => i.at <= now).length : -1;

    if (!dayItems.length) {
      const box = el("div", "sch_message");
      box.append(el("p", "", "No episodes scheduled for this day."));
      timelineEl.append(box);
      return;
    }

    // group episodes that air at the same minute under one time label
    const groups = [];
    for (const item of dayItems) {
      const minute = Math.floor(item.at / 60000);
      const last = groups[groups.length - 1];
      if (last && last.minute === minute) last.items.push(item);
      else groups.push({ minute, at: item.at, items: [item] });
    }

    // on today's tab the episodes that already aired are folded away, so NOW sits near the top
    const airedGroups = isToday ? groups.filter((g) => g.at <= now) : [];
    if (airedGroups.length) {
      const count = airedGroups.reduce((n, g) => n + g.items.length, 0);
      const toggle = el("button", "sch_aired-toggle", state.showAired ? "Hide aired episodes" : `Show ${count} aired ${count === 1 ? "episode" : "episodes"}`);
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", String(state.showAired));
      toggle.addEventListener("click", () => {
        state.showAired = !state.showAired;
        renderTimeline();
      });
      timelineEl.append(toggle);
    }

    let nowPlaced = !isToday;
    groups.forEach((g, i) => {
      // only fold aired episodes on today's tab; past days show everything
      if (isToday && g.at <= now && !state.showAired) return;
      if (!nowPlaced && g.at > now) {
        timelineEl.append(buildNow(now));
        nowPlaced = true;
      }
      const group = el("div", "sch_group");
      if (i === 0) group.classList.add("is-first");
      if (i === groups.length - 1) group.classList.add("is-last");
      if (g.at <= now) group.classList.add("is-past");

      const t = timeParts(g.at);
      const time = el("div", "sch_time");
      time.append(el("span", "sch_time-main", t.main));
      if (t.period) time.append(el("span", "sch_time-period", t.period));

      const cards = el("div", "sch_cards");
      for (const item of g.items) cards.append(buildCard(item, now));

      group.append(time, el("span", "sch_dot"), cards);
      timelineEl.append(group);
    });
    if (!nowPlaced) timelineEl.append(buildNow(now));
  }

  function renderAll() {
    renderHead();
    renderFilters();
    renderDays();
    renderSummary();
    renderTimeline();
  }

  /* ---------- clock + countdown ticks ---------- */

  function tickClock() {
    clockEl.textContent = clockFmt.format(new Date());
  }

  function tickCountdowns() {
    if (state.loading) return;
    const now = Date.now();
    timelineEl.querySelectorAll(".sch_eta").forEach((node) => {
      const cd = countdown(Number(node.dataset.at), now);
      node.textContent = cd.text;
      node.classList.toggle("is-aired", cd.past);
    });
    // an episode just aired: move the NOW marker
    if (state.partition >= 0) {
      const aired = itemsForDay(state.dayIndex).filter((i) => i.at <= now).length;
      if (aired !== state.partition) renderTimeline();
    }
  }

  /* ---------- week navigation ---------- */

  function goToWeek(date) {
    state.weekStart = date;
    state.showAired = false;
    state.dayIndex = sameDay(date, startOfWeek(new Date())) ? defaultDayIndex() : 0;
    load();
  }

  prevBtn.addEventListener("click", () => goToWeek(addDays(state.weekStart, -7)));
  nextBtn.addEventListener("click", () => goToWeek(addDays(state.weekStart, 7)));
  todayBtn.addEventListener("click", () => goToWeek(startOfWeek(new Date())));

  tickClock();
  setInterval(tickClock, 1000);
  setInterval(tickCountdowns, 30000);

  state.dayIndex = defaultDayIndex();
  renderFilters();
  load();
})();