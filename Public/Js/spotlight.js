(() => {
  "use strict";

  const API = "https://graphql.anilist.co";
  const MAX_SLIDES = 6;
  const INTERVAL_MS = 7000;
  const SWIPE_PX = 50;
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // trailer preview on hover: only for devices that can really hover (not phones / tablets), and not with reduced motion
  const CAN_HOVER = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const TRAILER_DELAY_MS = 700;   // how long the mouse must rest on the spotlight before the trailer starts

  const section = document.getElementById("spotlight");
  if (!section) return;

  // The page <head> already sent this request (window.__spotlightData) so the hero shows sooner.
  // This copy is only the fallback (retry / 429); keep both in sync.
  const QUERY = window.__spotlightQuery || `
    query {
      Page(page: 1, perPage: 14) {
        media(type: ANIME, isAdult: false, status: RELEASING, sort: TRENDING_DESC) {
          id
          siteUrl
          title { romaji english }
          bannerImage
          coverImage { extraLarge large }
          description(asHtml: false)
          format
          status
          episodes
          averageScore
          startDate { year month day }
          endDate { year month day }
          nextAiringEpisode { episode }
          trailer { id site }
        }
      }
    }`;

  const FORMATS = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const ICONS = {
    format: '<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z"/>',
    calendar: '<path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M16 14V5H0v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1"/>',
    star: '<path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>',
    film: '<path d="M0 1a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1zm4 0v6h8V1zm8 8H4v6h8zM1 1v2h2V1zm2 3H1v2h2zM1 7v2h2V7zm2 3H1v2h2zm-2 3v2h2v-2zM15 1h-2v2h2zm-2 3v2h2V4zm2 3h-2v2h2zm-2 3v2h2v-2zm2 3h-2v2h2z"/>',
    play: '<path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>',
    prev: '<path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"/>',
    next: '<path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${ICONS[name]}</svg>`;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function cleanText(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, " "), "text/html");
    return doc.body.textContent.replace(/\s+/g, " ").trim();
  }

  function formatDate(d) {
    if (!d?.year) return "?";
    const parts = [d.month ? MONTHS[d.month - 1] : "", d.day ? d.day + "," : "", d.year];
    return parts.filter(Boolean).join(" ");
  }

  function episodesText(a) {
    const total = a.episodes || "?";
    if (a.status === "RELEASING") {
      const next = a.nextAiringEpisode?.episode;
      return (next ? next - 1 : "?") + " / " + total + " eps";
    }
    return total + " eps";
  }

  // wide banners look best; fall back to covers only if there are too few
  function pickSlides(json) {
    const media = json?.data?.Page?.media || [];
    const withBanner = media.filter((m) => m.bannerImage);
    const list = withBanner.length >= 3 ? withBanner : media;
    return list.slice(0, MAX_SLIDES);
  }

  async function fetchSlides() {
    // 1) the request that was already started in <head>
    if (window.__spotlightData) {
      try {
        const early = pickSlides(await window.__spotlightData);
        if (early.length) return early;
      } catch { /* fall through to a normal request */ }
      window.__spotlightData = null;
    }
    // 2) normal request (with a retry when AniList says "slow down")
    for (let i = 0; i < 2; i++) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY }),
      });
      if (res.status === 429) {
        await wait(Math.min(Number(res.headers.get("Retry-After")) || 2, 5) * 1000);
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return pickSlides(json);
    }
    throw new Error("Rate limited");
  }

  function metaItem(iconName, text) {
    const li = el("li", "spotlight_meta-item");
    li.innerHTML = icon(iconName);
    li.append(el("span", "", text));
    return li;
  }

  function buildSlide(a, index, total) {
    const title = window.HugTitle.pick(a.title);
    const hasBanner = Boolean(a.bannerImage);
    const image = a.bannerImage || a.coverImage?.extraLarge || a.coverImage?.large || "";

    const slide = el("div", "spotlight_slide");
    if (a.trailer?.id && /^[\w-]{3,40}$/.test(a.trailer.id) && (a.trailer.site === "youtube" || a.trailer.site === "dailymotion")) {
      slide.dataset.trailerSite = a.trailer.site;
      slide.dataset.trailerId = a.trailer.id;
    }
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "slide");
    slide.setAttribute("aria-label", `${index + 1} of ${total}`);

    const bg = el("div", "spotlight_bg" + (hasBanner ? "" : " spotlight_bg--cover"));
    if (/^https?:\/\//i.test(image)) bg.style.backgroundImage = "url(" + JSON.stringify(image) + ")";
    slide.appendChild(bg);

    const content = el("div", "spotlight_content");
    content.appendChild(el("p", "spotlight_rank", `#${index + 1} Spotlight`));
    content.appendChild(el("h2", "spotlight_title", title));

    const meta = el("ul", "spotlight_meta");
    if (FORMATS[a.format]) meta.appendChild(metaItem("format", FORMATS[a.format]));
    const end = a.status === "RELEASING" || !a.endDate?.year ? "?" : formatDate(a.endDate);
    meta.appendChild(metaItem("calendar", `${formatDate(a.startDate)} to ${end}`));
    if (a.averageScore) meta.appendChild(metaItem("star", (a.averageScore / 10).toFixed(1)));
    meta.appendChild(metaItem("film", episodesText(a)));
    content.appendChild(meta);

    const desc = cleanText(a.description);
    if (desc) content.appendChild(el("p", "spotlight_desc", desc));

    const watch = el("a", "spotlight_btn");
    // Spotlight goes straight to the watch page (same tab), episode 1. No details modal here.
    watch.href = `watch.html?id=${encodeURIComponent(a.id)}&ep=1`;
    watch.innerHTML = icon("play");
    watch.append("Watch now");
    content.appendChild(watch);

    slide.appendChild(content);
    return slide;
  }

  function start(items) {
    const track = el("div", "spotlight_track");
    const slides = items.map((a, i) => buildSlide(a, i, items.length));
    track.append(...slides);

    const nav = el("div", "spotlight_nav");
    const prev = el("button", "spotlight_arrow");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous slide");
    prev.innerHTML = icon("prev");
    const next = el("button", "spotlight_arrow");
    next.type = "button";
    next.setAttribute("aria-label", "Next slide");
    next.innerHTML = icon("next");
    nav.append(prev, next);

    section.replaceChildren(track, nav);
    section.classList.add("is-ready");
    section.setAttribute("aria-roledescription", "carousel");

    let current = 0;
    let timer = 0;

    function show(i) {
      stopTrailer();
      current = (i + slides.length) % slides.length;
      slides.forEach((s, n) => {
        const on = n === current;
        s.classList.toggle("is-active", on);
        s.toggleAttribute("inert", !on);
        s.setAttribute("aria-hidden", String(!on));
      });
    }

    function stop() {
      clearInterval(timer);
      timer = 0;
    }

    function play() {
      stop();
      if (REDUCED || slides.length < 2 || document.hidden) return;
      timer = setInterval(() => show(current + 1), INTERVAL_MS);
    }

    // ---- trailer preview: the mouse rests on the spotlight -> the active slide plays its trailer (muted, looping) ----
    let trailerTimer = 0;
    let trailerBox = null;

    function trailerUrl(site, id) {
      if (site === "youtube") {
        return "https://www.youtube-nocookie.com/embed/" + id +
          "?autoplay=1&mute=1&controls=0&loop=1&playlist=" + id +
          "&modestbranding=1&rel=0&playsinline=1&disablekb=1&iv_load_policy=3&fs=0";
      }
      return "https://www.dailymotion.com/embed/video/" + id +
        "?autoplay=1&mute=1&controls=0&queue-enable=false&ui-logo=0&sharing-enable=false";
    }

    function stopTrailer() {
      clearTimeout(trailerTimer);
      trailerTimer = 0;
      if (!trailerBox) return;
      const box = trailerBox;
      trailerBox = null;
      box.classList.remove("is-playing");
      box.closest(".spotlight_slide")?.classList.remove("has-trailer");
      setTimeout(() => box.remove(), 350);   // let the fade-out finish
    }

    function startTrailer() {
      if (!CAN_HOVER || REDUCED || trailerBox || document.hidden) return;
      const slide = slides[current];
      const { trailerSite, trailerId } = slide.dataset;
      if (!trailerId) return;

      const box = el("div", "spotlight_trailer");
      box.setAttribute("aria-hidden", "true");
      const frame = document.createElement("iframe");
      frame.src = trailerUrl(trailerSite, trailerId);
      frame.title = "Trailer preview";
      frame.tabIndex = -1;
      frame.allow = "autoplay; encrypted-media";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.loading = "eager";
      // fade the video in only once it has loaded, so the banner never flashes black
      frame.addEventListener("load", () => {
        if (trailerBox !== box) return;
        setTimeout(() => {
          if (trailerBox !== box) return;
          box.classList.add("is-playing");
          slide.classList.add("has-trailer");
        }, 900);   // small buffer so the embed's own loading screen is not visible
      });
      box.appendChild(frame);
      slide.querySelector(".spotlight_bg")?.after(box);
      trailerBox = box;
    }

    function scheduleTrailer() {
      clearTimeout(trailerTimer);
      if (!CAN_HOVER || REDUCED) return;
      trailerTimer = setTimeout(startTrailer, TRAILER_DELAY_MS);
    }

    section.addEventListener("mouseenter", scheduleTrailer);
    section.addEventListener("mouseleave", stopTrailer);
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopTrailer(); });

    // after using an arrow while the mouse is still over the spotlight, play the new slide's trailer too
    const go = (i) => { show(i); play(); if (section.matches(":hover")) scheduleTrailer(); };
    prev.addEventListener("click", () => go(current - 1));
    next.addEventListener("click", () => go(current + 1));

    section.addEventListener("mouseenter", stop);
    section.addEventListener("mouseleave", play);
    section.addEventListener("focusin", stop);
    section.addEventListener("focusout", play);
    document.addEventListener("visibilitychange", play);

    let startX = null;
    section.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") startX = e.clientX; });
    section.addEventListener("pointerup", (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > SWIPE_PX) go(current + (dx < 0 ? 1 : -1));
    });
    section.addEventListener("pointercancel", () => { startX = null; });

    show(0);
    play();
  }

  fetchSlides()
    .then((items) => {
      if (!items.length) throw new Error("No spotlight items");
      start(items);
    })
    .catch((err) => {
      console.error("Could not load the spotlight:", err);
      section.hidden = true;
    });
})();