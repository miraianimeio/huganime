// Anime details modal for HugAnime (data from the AniList GraphQL API).
// Click any .anime-card (it needs data-anime-id) to open it.
// From other scripts:  HugModal.open(anilistId, { title, cover, format, episodes })   HugModal.close()
(() => {
  "use strict";

  const API = "https://graphql.anilist.co";
  const LIST_KEY = "huganime-list"; // "Add to List" is saved in this browser
  const PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

  const QUERY = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        siteUrl
        title { romaji english native }
        bannerImage
        coverImage { extraLarge large medium }
        description(asHtml: false)
        format
        status
        episodes
        seasonYear
        startDate { year }
        averageScore
        genres
        trailer { id site }
        nextAiringEpisode { episode }
        characters(role: MAIN, sort: [RELEVANCE], perPage: 6) {
          edges {
            node { id name { full } image { large } }
            voiceActors(language: JAPANESE) { id name { full } image { large } }
          }
        }
        recommendations(sort: RATING_DESC, perPage: 12) {
          nodes {
            mediaRecommendation {
              id
              isAdult
              title { romaji english }
              coverImage { large medium }
            }
          }
        }
      }
    }`;

  const FORMATS = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };

  // ---------- safe HTML helpers (everything from the API is escaped) ----------
  class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Safe(s);
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ESC[ch]);
  const part = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join("") : esc(v));
  const html = (strings, ...values) =>
    new Safe(strings.reduce((out, str, i) => out + str + (i < values.length ? part(values[i]) : ""), ""));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // AniList descriptions contain <br> and <i> tags: turn them into plain text
  function cleanText(text) {
    if (!text) return "";
    const doc = new DOMParser().parseFromString(text.replace(/<br\s*\/?>/gi, "\n"), "text/html");
    return doc.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
  }

  // ---------- "My List" (saved in this browser) ----------
  function store() {
    try { return window.localStorage; } catch { return null; }
  }
  function readList() {
    try { return JSON.parse(store()?.getItem(LIST_KEY) || "[]"); } catch { return []; }
  }
  const isInList = (id) => readList().some((x) => String(x.id) === String(id));
  function addToList(item) {
    try {
      const list = readList().filter((x) => x.id !== item.id);
      list.unshift(item);
      store()?.setItem(LIST_KEY, JSON.stringify(list));
    } catch { /* storage blocked */ }
  }
  function removeFromList(id) {
    try {
      store()?.setItem(LIST_KEY, JSON.stringify(readList().filter((x) => String(x.id) !== String(id))));
    } catch { /* storage blocked */ }
  }

  // ---------- data ----------
  async function fetchMedia(id) {
    for (let i = 0; i < 2; i++) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { id } }),
      });
      if (res.status === 429) {
        const secs = Number(res.headers.get("Retry-After")) || 2;
        await wait(Math.min(secs, 5) * 1000);
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      if (!json.data?.Media) throw new Error("Not found");
      return normalize(json.data.Media);
    }
    throw new Error("Rate limited");
  }

  // AniList -> the shape the modal uses
  function normalize(m) {
    const next = m.nextAiringEpisode?.episode;
    return {
      id: m.id,
      url: m.siteUrl,
      trailer: m.trailer,
      displayTitle: window.HugTitle.pick(m.title),
      native: m.title.native || "",
      cover: m.coverImage?.extraLarge || m.coverImage?.large || "",
      banner: m.bannerImage || "",
      format: FORMATS[m.format] || m.format || "--",
      year: m.startDate?.year || m.seasonYear || null,
      episodes: m.episodes,
      // episodes that are out right now (not the planned total)
      availableEpisodes: m.status === "RELEASING" ? (next ? next - 1 : null) : m.status === "NOT_YET_RELEASED" ? 0 : m.episodes,
      status: m.status ? m.status.replace(/_/g, " ") : "",
      releasing: m.status === "RELEASING",
      description: cleanText(m.description),
      score: m.averageScore ? (m.averageScore / 10).toFixed(1) : "",
      genres: m.genres || [],
      characters: (m.characters?.edges || [])
        .filter((e) => e.node)
        .map((e) => ({
          name: e.node.name?.full || "",
          image: e.node.image?.large || "",
          voiceActor: e.voiceActors?.[0]
            ? { name: e.voiceActors[0].name?.full || "", image: e.voiceActors[0].image?.large || "" }
            : null,
        })),
      recommendations: (m.recommendations?.nodes || [])
        .map((n) => n.mediaRecommendation)
        .filter((r) => r && !r.isAdult)
        .map((r) => ({
          id: r.id,
          displayTitle: window.HugTitle.pick(r.title),
          cover: r.coverImage?.large || r.coverImage?.medium || "",
        })),
    };
  }

  const cache = new Map(); // id -> Promise (also stops duplicate requests)
  function getAnime(id) {
    id = Number(id);
    if (!cache.has(id)) {
      cache.set(id, fetchMedia(id).catch((err) => { cache.delete(id); throw err; }));
    }
    return cache.get(id);
  }

  // "Watch Now" target: our own player page. Relative, so it works from any folder, any server
  // root and file://. watch.html reads ?id= (AniList id) and ?ep=. Override if you need to:
  //   HugModal.watchUrl = (anime) => "watch.html?id=" + anime.id;
  function defaultWatchUrl(a) {
    return "watch.html?id=" + encodeURIComponent(a.id) + "&ep=1";
  }

  // ---------- markup ----------
  const MODAL_MARKUP = `
  <div class="anime-modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
    <span class="anime-modal-close" id="close-expanded-modal" role="button" tabindex="0" aria-label="Close">&times;</span>
    <div class="modal-loading" id="modalLoading"><div class="modal-spinner"></div></div>
    <div class="anime-modal-banner" id="modal-banner"></div>
    <div class="anime-modal-body">
      <img src="" alt="Poster" class="anime-modal-poster" id="modal-poster">
      <div class="anime-modal-details">
        <h2 class="anime-modal-title" id="modal-title">Loading...</h2>
        <span class="anime-modal-native-title" id="modal-native-title"></span>
        <div class="anime-modal-meta">
          <span class="anime-modal-badge" id="modal-format">--</span>
          <span id="modal-year">----</span>
          <span>•</span>
          <span><span id="modal-episodes">--</span> EP</span>
          <span>•</span>
          <span id="modal-status">--</span>
          <span>•</span>
          <span class="anime-modal-score">★ <span id="modal-score">--</span></span>
        </div>
        <div class="anime-modal-genres" id="modal-genres"></div>
        <p class="anime-modal-desc" id="modal-desc">Fetching details...</p>
        <div class="anime-modal-actions">
          <a href="#" class="anime-modal-btn anime-modal-btn-play" id="modal-play-btn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Watch Now
          </a>
          <button class="anime-modal-btn anime-modal-btn-list" id="modal-list-btn" type="button">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            <span id="modal-list-text">Add to List</span>
          </button>
        </div>
      </div>
    </div>
    <div class="anime-modal-va-section">
      <div class="section-header">
        <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
        Main Characters &amp; Voice Actors
      </div>
      <div class="anime-modal-va-grid" id="modal-va-container"></div>
    </div>
    <div class="anime-modal-similar-section">
      <div class="section-header">
        <svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
        You Might Also Like
      </div>
      <div class="anime-modal-similar-grid" id="modal-similar-container"></div>
    </div>
  </div>`;

  function renderCharacterCards(characters) {
    if (!characters || characters.length === 0) {
      return raw('<p class="modal-placeholder">No voice actor details available.</p>');
    }
    return raw(characters.map((c) => html`
      <div class="va-card">
        <div class="va-person">
          <img src="${safeUrl(c.image) || PLACEHOLDER}" alt="${c.name}" loading="lazy">
          <div class="va-info">
            <span class="va-char-name">${c.name}</span>
            <span class="va-actor-name">${c.voiceActor?.name || "N/A"}</span>
          </div>
        </div>
        ${c.voiceActor?.image
          ? html`<div class="va-person"><img src="${safeUrl(c.voiceActor.image)}" alt="${c.voiceActor.name}" loading="lazy"></div>`
          : ""}
      </div>`).join(""));
  }

  // ---------- modal ----------
  function init() {
    let overlay = document.getElementById("anime-expanded-modal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "anime-modal-overlay";
      overlay.id = "anime-expanded-modal";
      overlay.innerHTML = MODAL_MARKUP;
      document.body.appendChild(overlay);
    }

    const byId = (id) => document.getElementById(id);
    const cardEl = overlay.querySelector(".anime-modal-card");
    const closeBtn = byId("close-expanded-modal");
    const listButton = byId("modal-list-btn");
    const listText = byId("modal-list-text");
    let currentAnimeId = null;
    let lastFocus = null;
    let scrollLocked = false;

    function setBanner(url) {
      const u = safeUrl(url);
      byId("modal-banner").style.backgroundImage = u ? "url(" + JSON.stringify(u) + ")" : "none";
    }

    function updateListButton() {
      const saved = isInList(currentAnimeId);
      listText.textContent = saved ? "In My List" : "Add to List";
      listButton.classList.toggle("in-list", saved);
      listButton.setAttribute("aria-pressed", String(saved));
    }

    function lockScroll(on) {
      if (on === scrollLocked) return;
      scrollLocked = on;
      if (on) {
        const bar = window.innerWidth - document.documentElement.clientWidth;
        document.documentElement.style.overflow = "hidden";
        if (bar > 0) document.body.style.paddingRight = bar + "px";
      } else {
        document.documentElement.style.overflow = "";
        document.body.style.paddingRight = "";
      }
    }

    async function open(animeId, initial = {}) {
      animeId = Number(animeId);
      if (!animeId) return;
      currentAnimeId = animeId;
      updateListButton();

      // show what we already know right away, then fill in the rest
      byId("modal-title").textContent = initial.title || "Loading...";
      byId("modal-native-title").textContent = "";
      byId("modal-desc").textContent = "Loading anime details...";
      byId("modal-poster").src = safeUrl(initial.cover) || PLACEHOLDER;
      setBanner(initial.cover);
      byId("modal-format").textContent = initial.format || "--";
      byId("modal-year").textContent = "----";
      byId("modal-episodes").textContent = initial.episodes || "--";
      byId("modal-status").textContent = "--";
      byId("modal-score").textContent = "--";
      byId("modal-play-btn").href = defaultWatchUrl({ id: animeId });

      byId("modal-genres").innerHTML = "";
      byId("modal-va-container").innerHTML = '<p class="modal-placeholder">Loading cast...</p>';
      byId("modal-similar-container").innerHTML = '<p class="modal-placeholder">Loading recommendations...</p>';
      cardEl.scrollTop = 0;

      if (!overlay.classList.contains("active")) {
        lastFocus = document.activeElement;
        lockScroll(true);
        overlay.classList.add("active");
        requestAnimationFrame(() => cardEl.focus({ preventScroll: true }));
      }

      const loadingEl = byId("modalLoading");
      const loadingTimer = setTimeout(() => loadingEl.classList.add("active"), 350);

      try {
        const anime = await getAnime(animeId);
        if (currentAnimeId !== animeId) return;

        byId("modal-title").textContent = anime.displayTitle;
        byId("modal-native-title").textContent = anime.native;
        byId("modal-poster").src = safeUrl(anime.cover) || PLACEHOLDER;
        setBanner(anime.banner || anime.cover);
        byId("modal-format").textContent = anime.format;
        byId("modal-year").textContent = anime.year || "N/A";
        byId("modal-episodes").textContent = anime.releasing
          ? `${anime.availableEpisodes ?? "?"} / ${anime.episodes ?? "?"}`
          : anime.episodes ?? "?";
        byId("modal-status").textContent = (anime.status || "UNKNOWN").toUpperCase();
        byId("modal-desc").textContent = anime.description || "No synopsis provided.";
        byId("modal-score").textContent = anime.score ? `${anime.score} AniList` : "N/A";

        byId("modal-genres").innerHTML = anime.genres
          .map((g) => html`<span class="anime-modal-genre-tag">${g}</span>`).join("");

        const watch = (window.HugModal && window.HugModal.watchUrl) || defaultWatchUrl;
        byId("modal-play-btn").href = watch(anime) || defaultWatchUrl(anime);

        byId("modal-va-container").innerHTML = renderCharacterCards(anime.characters.slice(0, 6));

        const similar = anime.recommendations.slice(0, 6);
        byId("modal-similar-container").innerHTML = similar.length === 0
          ? '<p class="modal-placeholder">No recommendations found.</p>'
          : similar.map((rec) => html`
              <div class="similar-card" role="button" tabindex="0" data-rec-id="${rec.id}" data-rec-title="${rec.displayTitle}" data-rec-cover="${rec.cover}">
                <img src="${safeUrl(rec.cover) || PLACEHOLDER}" alt="${rec.displayTitle}" loading="lazy">
                <div class="similar-card-title">${rec.displayTitle}</div>
              </div>`).join("");

        updateListButton();
      } catch (error) {
        if (currentAnimeId !== animeId) return;
        console.error("Could not load anime:", error);
        byId("modal-title").textContent = "Details temporarily unavailable";
        byId("modal-desc").textContent = "We couldn't load these anime details right now. Please try again in a moment.";
        byId("modal-va-container").innerHTML = "";
        byId("modal-similar-container").innerHTML = "";
      } finally {
        clearTimeout(loadingTimer);
        loadingEl.classList.remove("active");
      }
    }

    function close() {
      if (!overlay.classList.contains("active")) return;
      overlay.classList.remove("active");
      currentAnimeId = null;
      lockScroll(false);
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }

    // open a card, or a "You might also like" card
    function openSimilar(similarCard) {
      if (!similarCard.dataset.recId) return;
      open(similarCard.dataset.recId, {
        title: similarCard.dataset.recTitle,
        cover: similarCard.dataset.recCover,
      });
    }

    document.addEventListener("click", (event) => {
      if (event.target.closest("header, nav, .logo")) return;

      const similarCard = event.target.closest(".similar-card");
      if (similarCard) {
        event.preventDefault();
        openSimilar(similarCard);
        return;
      }

      const card = event.target.closest(".anime-card");
      if (!card || !card.dataset.animeId) return;
      // ctrl / cmd / shift / middle click keeps the normal link behaviour
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      open(card.dataset.animeId, {
        title: card.dataset.animeTitle,
        cover: card.dataset.animeCover,
        format: card.dataset.animeFormat,
        episodes: card.dataset.animeEpisodes,
      });
    });

    // warm the cache when the pointer rests on a card, so the modal opens faster
    let hoverTimer = 0;
    document.addEventListener("pointerover", (event) => {
      const card = event.target.closest?.(".anime-card");
      const id = Number(card?.dataset.animeId);
      clearTimeout(hoverTimer);
      if (id && !cache.has(id)) hoverTimer = setTimeout(() => getAnime(id).catch(() => {}), 250);
    }, { passive: true });

    listButton.addEventListener("click", () => {
      if (isInList(currentAnimeId)) {
        removeFromList(currentAnimeId);
      } else {
        addToList({
          id: Number(currentAnimeId),
          title: byId("modal-title").textContent,
          titles: window.HugTitle.pairFor(byId("modal-title").textContent),
          cover: byId("modal-poster").src,
          format: byId("modal-format").textContent,
          episodes: Number.parseInt(byId("modal-episodes").textContent, 10) || null,
        });
      }
      updateListButton();
    });

    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });

    document.addEventListener("keydown", (event) => {
      if (!overlay.classList.contains("active")) return;

      if (event.key === "Escape") {
        close();
        return;
      }

      // Enter / Space on the close button and the recommendation cards
      if (event.key === "Enter" || event.key === " ") {
        if (document.activeElement === closeBtn) {
          event.preventDefault();
          close();
        } else if (document.activeElement?.classList.contains("similar-card")) {
          event.preventDefault();
          openSimilar(document.activeElement);
        }
        return;
      }

      // keep Tab inside the modal
      if (event.key === "Tab") {
        const items = Array.from(cardEl.querySelectorAll('a[href], button, [tabindex="0"]'));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!cardEl.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });

    window.HugModal.open = open;
    window.HugModal.close = close;
  }

  window.HugModal = { open() {}, close() {}, watchUrl: null };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();