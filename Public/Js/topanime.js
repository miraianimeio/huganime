(() => {
  "use strict";

  const API = "https://graphql.anilist.co";
  const COUNT = 10;

  const root = document.getElementById("top-anime");
  if (!root) return;
  const body = root.querySelector(".top-anime_body");
  const tabs = Array.from(root.querySelectorAll("[data-period]"));
  if (!body || !tabs.length) return;

  const QUERY = `
    query ($perPage: Int, $sort: [MediaSort], $status: MediaStatus, $season: MediaSeason, $seasonYear: Int) {
      Page(page: 1, perPage: $perPage) {
        media(type: ANIME, isAdult: false, sort: $sort, status: $status, season: $season, seasonYear: $seasonYear) {
          id
          siteUrl
          title { romaji english }
          coverImage { extraLarge large }
          bannerImage
          format
          status
          episodes
          nextAiringEpisode { episode }
        }
      }
    }`;

  function currentSeason() {
    const now = new Date();
    return { season: ["WINTER", "SPRING", "SUMMER", "FALL"][Math.floor(now.getMonth() / 3)], seasonYear: now.getFullYear() };
  }

  const PERIODS = {
    day: { label: "#1 Trending", vars: { sort: ["TRENDING_DESC"] } },
    week: { label: "#1 Popular airing", vars: { sort: ["POPULARITY_DESC"], status: "RELEASING" } },
    month: { label: "#1 This season", vars: { sort: ["POPULARITY_DESC"], ...currentSeason() } },
  };

  const FORMATS = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };

  // Bootstrap Icons (16x16)
  const CC = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm3.027 4.002c-.83 0-1.319.642-1.319 1.753v.743c0 1.107.48 1.727 1.319 1.727.69 0 1.138-.435 1.186-1.05H7.36v.114c-.057 1.147-1.028 1.938-2.342 1.938-1.613 0-2.518-1.028-2.518-2.729v-.747C2.5 6.051 3.414 5 5.018 5c1.318 0 2.29.813 2.342 2.002H6.213c-.048-.615-.496-1.05-1.186-1.05Zm6.5 0c-.83 0-1.319.642-1.319 1.753v.743c0 1.107.48 1.727 1.319 1.727.69 0 1.138-.435 1.186-1.05H13.86v.114c-.057 1.147-1.028 1.938-2.342 1.938-1.613 0-2.518-1.028-2.518-2.729v-.747c0-1.7.914-2.751 2.518-2.751 1.318 0 2.29.813 2.342 2.002h-1.147c-.048-.615-.497-1.05-1.186-1.05Z"/></svg>';
  const MIC = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/><path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/></svg>';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function releasedEpisodes(a) {
    if (a.status === "RELEASING") {
      const next = a.nextAiringEpisode?.episode;
      return next ? next - 1 : null;
    }
    if (a.status === "NOT_YET_RELEASED") return 0;
    return a.episodes || null;
  }

  function toItem(a) {
    return {
      id: a.id,
      url: a.siteUrl,
      title: window.HugTitle.pick(a.title),
      cover: a.coverImage?.extraLarge || a.coverImage?.large || "",
      thumb: a.coverImage?.large || a.coverImage?.extraLarge || "",
      banner: a.bannerImage || a.coverImage?.extraLarge || "",
      type: FORMATS[a.format] || "",
      episodes: releasedEpisodes(a),
      dub: 0,
    };
  }

  async function fetchPeriod(period) {
    const vars = { perPage: COUNT, ...PERIODS[period].vars };
    for (let i = 0; i < 2; i++) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: vars }),
      });
      if (res.status === 429) {
        await wait(Math.min(Number(res.headers.get("Retry-After")) || 2, 5) * 1000);
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return (json.data?.Page?.media || []).map(toItem);
    }
    throw new Error("Rate limited");
  }

  const cache = new Map(); 
  async function getPeriod(period) {
    if (!cache.has(period)) cache.set(period, await fetchPeriod(period));
    return cache.get(period);
  }

  
  function openDetails(item, event) {
    if (!window.HugModal) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.HugModal.open(item.id, { title: item.title, cover: item.cover, format: item.type, episodes: item.episodes });
  }

  function badges(item) {
    const row = el("div", "top-anime_badges");
    if (item.episodes) {
      const cc = el("span", "top-anime_badge");
      cc.innerHTML = CC;
      cc.append(String(item.episodes));
      cc.title = item.episodes + " episodes";
      row.appendChild(cc);
    }
    if (item.dub) {
      const dub = el("span", "top-anime_badge top-anime_badge--dub");
      dub.innerHTML = MIC;
      dub.append(String(item.dub));
      dub.title = item.dub + " dubbed";
      row.appendChild(dub);
    }
    if (item.type) row.appendChild(el("span", "top-anime_type", item.type));
    return row;
  }

  function link(className, item) {
    // no href: opens the details modal, and a real AniList link makes the browser show its URL bar on hover
    const a = el("a", className);
    a.tabIndex = 0;
    a.setAttribute("role", "button");
    a.addEventListener("click", (e) => openDetails(item, e));
    a.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); a.click(); } });
    return a;
  }

  function poster(item, className) {
    const img = el("img", className);
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = item.thumb;
    return img;
  }

  function featureCard(item, label) {
    const a = link("top-anime_feature", item);
    if (/^https?:\/\//i.test(item.banner)) a.style.setProperty("--feature-bg", "url(" + JSON.stringify(item.banner) + ")");

    const img = poster(item, "top-anime_feature-poster");
    img.src = item.cover;

    const text = el("div", "top-anime_feature-text");
    text.append(el("p", "top-anime_feature-label", label), el("h3", "top-anime_feature-title", item.title), badges(item));

    a.append(img, text);
    return a;
  }

  function listRow(item, rank) {
    const li = el("li", "top-anime_row");
    const a = link("top-anime_item", item);
    const num = el("span", "top-anime_rank top-anime_rank--" + (rank <= 3 ? rank : "n"), String(rank));
    const text = el("div", "top-anime_text");
    text.append(el("h3", "top-anime_title", item.title), badges(item));
    a.append(num, poster(item, "top-anime_poster"), text);
    li.appendChild(a);
    return li;
  }

  function showSkeleton() {
    const nodes = [el("div", "top-anime_feature top-anime_skeleton")];
    const list = el("ol", "top-anime_list");
    for (let i = 0; i < 6; i++) list.appendChild(el("li", "top-anime_row top-anime_skeleton-row"));
    nodes.push(list);
    body.replaceChildren(...nodes);
  }

  function showMessage(text, retry) {
    const p = el("p", "top-anime_message", text);
    if (retry) {
      const b = el("button", "top-anime_retry", "Try again");
      b.type = "button";
      b.addEventListener("click", retry);
      p.append(" ", b);
    }
    body.replaceChildren(p);
  }

  function render(period, items) {
    if (!items.length) return showMessage("Nothing to show right now.");
    const [first, ...rest] = items;
    const list = el("ol", "top-anime_list");
    list.start = 2;
    rest.forEach((item, i) => list.appendChild(listRow(item, i + 2)));
    body.replaceChildren(featureCard(first, PERIODS[period].label), list);
  }

  // ---------- tabs ----------
  let token = 0;

  async function select(period) {
    const mine = ++token;
    tabs.forEach((t) => {
      const on = t.dataset.period === period;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    body.setAttribute("aria-busy", "true");
    if (!cache.has(period)) showSkeleton();
    try {
      const items = await getPeriod(period);
      if (mine !== token) return;
      render(period, items);
    } catch (err) {
      if (mine !== token) return;
      console.error("Could not load top anime:", err);
      showMessage("Couldn't load this list.", () => select(period));
    } finally {
      if (mine === token) body.setAttribute("aria-busy", "false");
    }
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab.dataset.period));
    tab.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      select(next.dataset.period);
    });
  });

  select("day");
})();