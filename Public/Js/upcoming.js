// "Upcoming Anime": the six most anticipated anime that haven't aired yet (data from the AniList GraphQL API).
(() => {
  "use strict";

  const API = "https://graphql.anilist.co";
  const COUNT = 6;

  const root = document.getElementById("upcoming");
  if (!root) return;
  const body = root.querySelector(".upcoming_body");
  if (!body) return;

  const QUERY = `
    query ($perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(type: ANIME, isAdult: false, status: NOT_YET_RELEASED, sort: [POPULARITY_DESC]) {
          id
          siteUrl
          title { romaji english }
          coverImage { extraLarge large }
          format
          season
          seasonYear
          startDate { year month day }
        }
      }
    }`;

  const FORMATS = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SEASONS = { WINTER: "Winter", SPRING: "Spring", SUMMER: "Summer", FALL: "Fall" };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // "Dec 5, 2026" when the whole date is known, otherwise as much as AniList has
  function releaseText(a) {
    const { year, month, day } = a.startDate || {};
    if (year && month && day) return `${MONTHS[month - 1]} ${day}, ${year}`;
    if (year && month) return `${MONTHS[month - 1]} ${year}`;
    if (a.season && a.seasonYear) return `${SEASONS[a.season] || ""} ${a.seasonYear}`.trim();
    if (year || a.seasonYear) return String(year || a.seasonYear);
    return "TBA";
  }

  function toItem(a) {
    return {
      id: a.id,
      url: a.siteUrl,
      title: window.HugTitle.pick(a.title),
      cover: a.coverImage?.extraLarge || a.coverImage?.large || "",
      thumb: a.coverImage?.large || a.coverImage?.extraLarge || "",
      type: FORMATS[a.format] || "",
      date: releaseText(a),
    };
  }

  async function fetchUpcoming() {
    for (let i = 0; i < 2; i++) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { perPage: COUNT } }),
      });
      if (res.status === 429) {
        await wait(Math.min(Number(res.headers.get("Retry-After")) || 2, 5) * 1000);
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return (json.data?.Page?.media || []).map(toItem).slice(0, COUNT);
    }
    throw new Error("Rate limited");
  }

  // same behaviour as every other anime link on the home page: the details modal (a new tab if it isn't there)
  function openDetails(item, event) {
    if (!window.HugModal) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.HugModal.open(item.id, { title: item.title, cover: item.cover, format: item.type, episodes: 0 });
  }

  function row(item) {
    const li = el("li", "top-anime_row");
    // no href: opens the details modal, and a real AniList link makes the browser show its URL bar on hover
    const a = el("a", "top-anime_item");
    a.tabIndex = 0;
    a.setAttribute("role", "button");
    a.addEventListener("click", (e) => openDetails(item, e));
    a.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); a.click(); } });

    const img = el("img", "top-anime_poster");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    if (/^https:\/\//i.test(item.thumb)) img.src = item.thumb;

    const text = el("div", "top-anime_text");
    const meta = el("div", "upcoming_meta");
    meta.appendChild(el("span", "upcoming_date", item.date));
    if (item.type) meta.appendChild(el("span", "top-anime_type", item.type));
    text.append(el("h3", "top-anime_title", item.title), meta);

    a.append(img, text);
    li.appendChild(a);
    return li;
  }

  function showSkeleton() {
    const list = el("ol", "top-anime_list");
    for (let i = 0; i < COUNT; i++) list.appendChild(el("li", "top-anime_row top-anime_skeleton-row"));
    body.replaceChildren(list);
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

  async function load() {
    showSkeleton();
    body.setAttribute("aria-busy", "true");
    try {
      const items = await fetchUpcoming();
      if (!items.length) return showMessage("Nothing announced yet.");
      const list = el("ol", "top-anime_list");
      items.forEach((item) => list.appendChild(row(item)));
      body.replaceChildren(list);
    } catch (error) {
      console.error("Could not load upcoming anime:", error);
      showMessage("Couldn't load upcoming anime.", load);
    } finally {
      body.setAttribute("aria-busy", "false");
    }
  }

  // load when it is close to the screen (saves an API request for people who never scroll that far)
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        load();
      }
    }, { rootMargin: "400px 0px" });
    io.observe(root);
  } else {
    load();
  }
})();
