/* ==========================================================================
   HugAnime - Anime Music
   YouTube songs played with YouTube's own embedded player (IFrame API), our own controls on top.
   Three ways to find songs:
     My library    the starter list (Js/music-data.js) + songs added with a YouTube link (kept in this browser)
     Search YouTube any song (server route /yt-search, needs YOUTUBE_API_KEY, see youtube.js)
     Anime songs   pick an anime (AniList) -> its openings / endings (MyAnimeList via Jikan) -> found on YouTube when played
   Also: shuffle, repeat (off / all / one), volume, seek, "Audio only". A song that can't be embedded is skipped.
   ========================================================================== */
(() => {
  "use strict";

  const KEYS = { mine: "huganime-music-mine", prefs: "huganime-music-prefs", broken: "huganime-music-broken" };
  const TYPE_NAMES = { op: "Opening", ed: "Ending", ost: "Soundtrack" };
  const ID_RE = /^[\w-]{11}$/;
  const JIKAN = "https://api.jikan.moe/v4";
  const ANILIST = "https://graphql.anilist.co";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function load(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked or full */ }
  }

  // ---------------------------------------------------------------- songs
  // A track: { key, id (YouTube id, "" until found), title, artist, anime, type, thumb?, mine?, query? }
  const makeTrack = (t) => ({ key: t.id || t.key, id: t.id || "", title: t.title, artist: t.artist || "", anime: t.anime || "", type: t.type || "ost", thumb: t.thumb || "", mine: !!t.mine, query: t.query || "" });

  const starter = (Array.isArray(window.MUSIC_TRACKS) ? window.MUSIC_TRACKS : []).filter((t) => ID_RE.test(t.id || "")).map(makeTrack);
  let mine = load(KEYS.mine, []).filter((t) => ID_RE.test(t.id || "")).map((t) => makeTrack({ ...t, mine: true }));
  const broken = new Set(load(KEYS.broken, []));          // ids that refused to play here (embedding disabled / removed)

  const prefs = { volume: 80, shuffle: false, repeat: "off", audioOnly: false, ...load(KEYS.prefs, {}) };
  const savePrefs = () => save(KEYS.prefs, prefs);

  const state = {
    mode: "library", type: "all", query: "",
    current: null,            // the track that is loaded
    source: "library",        // which list it was started from (next / previous follow that list)
    playing: false, ready: false, wantPlay: false, errors: 0, token: 0,
  };
  const lists = { library: [], youtube: [], anime: [] };
  let shuffled = [];
  let player = null;
  let ticker = 0;
  let toastTimer = 0;
  let dragging = false;
  let animeTitle = "";        // the anime whose songs are listed in the "Anime songs" tab

  const els = { library: $("mu-list"), youtube: $("mu-yt-list"), anime: $("mu-an-list") };

  function toast(text) {
    const el = $("mu-toast");
    el.textContent = text;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), 2600);
  }

  const fmt = (s) => {
    s = Math.max(0, Math.floor(Number(s) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const thumbOf = (t) => t.thumb || (t.id ? `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg` : "");
  const libraryTracks = () => {
    const seen = new Set();
    return [...starter, ...mine].filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
  };
  const inLibrary = (id) => libraryTracks().some((t) => t.id === id);
  const sameTrack = (a, b) => !!a && !!b && a.key === b.key;

  // ---------------------------------------------------------------- lists
  function computeLibrary() {
    const q = state.query.trim().toLowerCase();
    lists.library = libraryTracks().filter((t) => {
      if (state.type === "mine") { if (!t.mine) return false; }
      else if (state.type !== "all" && t.type !== state.type) return false;
      if (!q) return true;
      return [t.title, t.artist, t.anime, TYPE_NAMES[t.type]].join(" ").toLowerCase().includes(q);
    });
    shuffled = [];
  }

  function itemHtml(t, i, source) {
    const img = thumbOf(t);
    let action = "";
    if (source === "library" && t.mine) action = `<button class="mu-item-act" type="button" data-del="${esc(t.key)}" aria-label="Remove ${esc(t.title)}" title="Remove">&times;</button>`;
    else if (source !== "library" && !(t.id && inLibrary(t.id))) action = `<button class="mu-item-act" type="button" data-add="${esc(t.key)}" aria-label="Add ${esc(t.title)} to My songs" title="Add to My songs">+</button>`;
    else if (source !== "library") action = `<span class="mu-item-saved" title="In your library">&#10003;</span>`;
    const typeLabel = TYPE_NAMES[t.type] && source !== "youtube" ? TYPE_NAMES[t.type] : "";
    return `
      <li class="mu-item${sameTrack(t, state.current) ? " is-current" : ""}${t.id && broken.has(t.id) ? " is-broken" : ""}" data-key="${esc(t.key)}">
        <button class="mu-item-main" type="button" data-play="${esc(t.key)}" aria-label="Play ${esc(t.title)}">
          <span class="mu-item-no">${i + 1}</span>
          <span class="mu-item-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ""}<span class="mu-eq" aria-hidden="true"><i></i><i></i><i></i></span></span>
          <span class="mu-item-text">
            <span class="mu-item-title">${esc(t.title)}</span>
            <span class="mu-item-sub">${esc([t.artist, t.anime].filter(Boolean).join(" · ") || "YouTube")}</span>
          </span>
          <span class="mu-item-type">${esc(typeLabel)}</span>
        </button>
        ${action}
      </li>`;
  }

  function renderList(source) {
    els[source].innerHTML = lists[source].map((t, i) => itemHtml(t, i, source)).join("");
  }

  function render() {
    computeLibrary();
    renderList("library");
    $("mu-empty").hidden = lists.library.length > 0;
    $("mu-empty").textContent = state.type === "mine" && !state.query ? "You haven't added any songs yet. Paste a YouTube link below, or add songs from the other tabs." : "No songs match.";
    paintNow();
  }

  function paintCurrent() {
    for (const source of Object.keys(els)) {
      els[source].querySelectorAll(".mu-item").forEach((li) => {
        const on = !!state.current && li.dataset.key === state.current.key;
        li.classList.toggle("is-current", on);
        li.classList.toggle("is-playing", on && state.playing);
      });
    }
  }

  function paintNow() {
    const t = state.current;
    $("mu-title").textContent = t ? t.title : "Pick a song";
    $("mu-sub").textContent = t ? ([t.artist, t.anime].filter(Boolean).join(" · ") || "YouTube") : "Choose something from the list to start.";
    document.title = t ? `${t.title} | Anime Music | HugAnime` : "Anime Music | HugAnime";
    const play = $("mu-play");
    play.classList.toggle("is-playing", state.playing);
    play.setAttribute("aria-label", state.playing ? "Pause" : "Play");
    paintCurrent();
  }

  // ---------------------------------------------------------------- order (next / previous)
  function order() {
    const list = lists[state.source] || [];
    if (!prefs.shuffle) return list;
    const keys = new Set(list.map((t) => t.key));
    if (shuffled.length !== list.length || shuffled.some((t) => !keys.has(t.key))) {
      shuffled = list.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
    }
    return shuffled;
  }

  function step(direction, { auto = false } = {}) {
    const list = order().filter((t) => !(t.id && broken.has(t.id)) && !t.failed);
    if (!list.length) { toast("No playable songs in this list."); return; }
    const at = list.findIndex((t) => sameTrack(t, state.current));
    let next;
    if (at < 0) next = list[direction > 0 ? 0 : list.length - 1];
    else {
      const to = at + direction;
      if (to >= list.length || to < 0) {
        if (auto && prefs.repeat === "off") { state.playing = false; paintNow(); return; }   // end of the list
        next = list[(to + list.length) % list.length];
      } else next = list[to];
    }
    playTrack(next, state.source);
  }

  // ---------------------------------------------------------------- finding a song on YouTube (for anime songs)
  async function ytSearch(q, limit = 10) {
    const res = await fetch(`/yt-search?q=${encodeURIComponent(q)}&limit=${limit}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error("search failed");
    return res.json();
  }

  function ytProblem(info) {
    if (info?.error === "no-key") return "YouTube search isn't set up yet. Add YOUTUBE_API_KEY to the .env file and restart (see the README).";
    if (info?.error === "quota") return "YouTube search is used up for today. Try again tomorrow, or paste a YouTube link instead.";
    return "YouTube search didn't work right now" + (info?.message ? ` (${info.message})` : "") + ".";
  }

  // gives a theme song (no video yet) its YouTube video; returns true when it has one
  async function resolveTrack(track) {
    if (track.id) return true;
    const kind = track.type === "ed" ? "ending" : "opening";
    const q = [track.title, track.artist, track.anime, kind].filter(Boolean).join(" ");
    const info = await ytSearch(q, 5);
    if (info.error) { toast(ytProblem(info)); return false; }
    const hit = (info.results || []).find((r) => !broken.has(r.id));
    if (!hit) { track.failed = true; toast(`Couldn't find "${track.title}" on YouTube.`); return false; }
    track.id = hit.id;
    track.thumb = hit.thumb || "";
    return true;
  }

  // ---------------------------------------------------------------- player
  async function playTrack(track, source) {
    if (!track) return;
    const token = ++state.token;
    state.current = track;
    state.source = source || state.source;
    state.wantPlay = true;
    $("mu-seek").value = 0;
    $("mu-time").textContent = "0:00";
    $("mu-dur").textContent = "0:00";
    paintNow();

    if (!track.id) {
      showNote("Finding it on YouTube...");
      let found = false;
      try { found = await resolveTrack(track); } catch { toast("YouTube search didn't work right now."); }
      if (token !== state.token) return;           // the viewer picked something else meanwhile
      showNote("");
      if (!found) {
        state.errors++;
        if (track.failed && state.source === "anime" && state.errors < 4) setTimeout(() => step(1), 500);   // not on YouTube: try the next song
        return;
      }
      renderList(state.source);
      paintNow();
    }
    if (player && state.ready) player.loadVideoById(track.id);
    else showNote("The player is still loading...");
  }

  function showNote(text) {
    const note = $("mu-video-note");
    note.textContent = text || "";
    note.hidden = !text;
  }

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player("mu-player", {
      width: "100%",
      height: "100%",
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, iv_load_policy: 3 },
      events: {
        onReady: () => {
          state.ready = true;
          player.setVolume(prefs.volume);
          showNote("");
          if (state.current?.id) {
            if (state.wantPlay) player.loadVideoById(state.current.id);
            else player.cueVideoById(state.current.id);
          }
        },
        onStateChange: (e) => {
          const S = YT.PlayerState;
          if (e.data === S.PLAYING) { state.playing = true; state.errors = 0; startTicker(); }
          else if (e.data === S.PAUSED) { state.playing = false; }
          else if (e.data === S.ENDED) {
            state.playing = false;
            if (prefs.repeat === "one") { player.seekTo(0); player.playVideo(); }
            else step(1, { auto: true });
          }
          paintNow();
        },
        onError: () => {
          // 2 bad id, 5 html5 error, 100 removed / private, 101 + 150 embedding not allowed
          const t = state.current;
          if (t?.id) { broken.add(t.id); save(KEYS.broken, [...broken]); }
          state.errors++;
          toast(`"${t ? t.title : "That song"}" can't be played here, skipping.`);
          for (const source of Object.keys(els)) renderList(source);
          paintNow();
          if (state.errors < 5) setTimeout(() => step(1), 600);
          else { state.playing = false; paintNow(); showNote("Several songs in a row failed. Check your connection or try another song."); }
        },
      },
    });
  }

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(() => {
      if (!player || !state.ready || typeof player.getCurrentTime !== "function") return;
      const dur = player.getDuration() || 0;
      const cur = player.getCurrentTime() || 0;
      $("mu-dur").textContent = fmt(dur);
      if (!dragging) {
        $("mu-time").textContent = fmt(cur);
        $("mu-seek").value = dur ? Math.round((cur / dur) * 1000) : 0;
        $("mu-seek").style.setProperty("--p", dur ? (cur / dur) * 100 + "%" : "0%");
      }
      if (!state.playing) { clearInterval(ticker); ticker = 0; }
    }, 400);
  }

  function togglePlay() {
    if (!state.current) { const first = order().find((t) => !(t.id && broken.has(t.id))); if (first) playTrack(first, state.source); return; }
    if (!player || !state.ready || !state.current.id) return;
    if (state.playing) player.pauseVideo(); else player.playVideo();
  }

  // ---------------------------------------------------------------- list clicks (play / add / remove)
  function addToLibrary(track) {
    if (!track?.id) return false;
    if (inLibrary(track.id)) return true;
    mine.unshift(makeTrack({ ...track, mine: true, type: track.type === "op" || track.type === "ed" ? track.type : "ost" }));
    save(KEYS.mine, mine.map(({ id, title, artist, anime, type }) => ({ id, title, artist, anime, type })));
    broken.delete(track.id);
    save(KEYS.broken, [...broken]);
    return true;
  }

  function onListClick(source) {
    return async (e) => {
      const list = lists[source];
      const del = e.target.closest("[data-del]");
      if (del) {
        mine = mine.filter((t) => t.key !== del.dataset.del);
        save(KEYS.mine, mine.map(({ id, title, artist, anime, type }) => ({ id, title, artist, anime, type })));
        render();
        toast("Song removed");
        return;
      }
      const add = e.target.closest("[data-add]");
      if (add) {
        const track = list.find((t) => t.key === add.dataset.add);
        if (!track) return;
        add.disabled = true;
        let ok = false;
        try { ok = await resolveTrack(track); } catch { toast("YouTube search didn't work right now."); }
        if (ok && addToLibrary(track)) { toast("Added to My songs"); render(); renderList(source); }
        else add.disabled = false;
        return;
      }
      const play = e.target.closest("[data-play]");
      if (!play) return;
      const track = list.find((t) => t.key === play.dataset.play);
      if (!track) return;
      if (sameTrack(track, state.current) && state.ready && track.id) togglePlay(); else playTrack(track, source);
    };
  }
  for (const source of Object.keys(els)) els[source].addEventListener("click", onListClick(source));

  $("mu-play").addEventListener("click", togglePlay);
  $("mu-next").addEventListener("click", () => step(1));
  $("mu-prev").addEventListener("click", () => {
    if (player && state.ready && player.getCurrentTime() > 4) player.seekTo(0, true);   // like most players: first go back to the start
    else step(-1);
  });

  const seek = $("mu-seek");
  seek.addEventListener("input", () => {
    dragging = true;
    const dur = player && state.ready ? player.getDuration() : 0;
    $("mu-time").textContent = fmt((seek.value / 1000) * dur);
    seek.style.setProperty("--p", seek.value / 10 + "%");
  });
  seek.addEventListener("change", () => {
    if (player && state.ready) player.seekTo((seek.value / 1000) * player.getDuration(), true);
    dragging = false;
  });

  const vol = $("mu-vol");
  vol.value = prefs.volume;
  vol.style.setProperty("--p", prefs.volume + "%");
  vol.addEventListener("input", () => {
    prefs.volume = Number(vol.value);
    vol.style.setProperty("--p", prefs.volume + "%");
    if (player && state.ready) { player.setVolume(prefs.volume); if (prefs.volume > 0) player.unMute(); }
    savePrefs();
  });

  const shuffleBtn = $("mu-shuffle");
  const repeatBtn = $("mu-repeat");
  function paintToggles() {
    shuffleBtn.setAttribute("aria-pressed", String(prefs.shuffle));
    repeatBtn.setAttribute("aria-pressed", String(prefs.repeat !== "off"));
    repeatBtn.dataset.mode = prefs.repeat;
    repeatBtn.setAttribute("aria-label", "Repeat: " + prefs.repeat);
    $("mu-hide-video").setAttribute("aria-pressed", String(prefs.audioOnly));
    $("mu-video-box").classList.toggle("is-hidden", prefs.audioOnly);
  }
  shuffleBtn.addEventListener("click", () => { prefs.shuffle = !prefs.shuffle; shuffled = []; savePrefs(); paintToggles(); toast(prefs.shuffle ? "Shuffle on" : "Shuffle off"); });
  repeatBtn.addEventListener("click", () => {
    prefs.repeat = prefs.repeat === "off" ? "all" : prefs.repeat === "all" ? "one" : "off";
    savePrefs(); paintToggles();
    toast({ off: "Repeat off", all: "Repeat all", one: "Repeat this song" }[prefs.repeat]);
  });
  $("mu-hide-video").addEventListener("click", () => { prefs.audioOnly = !prefs.audioOnly; savePrefs(); paintToggles(); });

  // ---------------------------------------------------------------- tabs: library / youtube / anime
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".mu-mode").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });
    for (const name of ["library", "youtube", "anime"]) $("mu-panel-" + name).hidden = name !== mode;
  }
  document.querySelectorAll(".mu-mode").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  document.querySelectorAll(".mu-tab").forEach((tab) => tab.addEventListener("click", () => {
    state.type = tab.dataset.type;
    document.querySelectorAll(".mu-tab").forEach((b) => {
      const on = b === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });
    render();
  }));

  // header search: filters the library while typing; Enter searches YouTube
  let searchTimer = 0;
  $("mu-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; setMode("library"); render(); }, 180);
  });
  $("mu-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    clearTimeout(searchTimer);                 // a filter that was about to run must not switch the tab back
    const q = e.target.value.trim();
    if (q.length < 2) return;
    $("mu-yt-q").value = q;
    setMode("youtube");
    runYouTubeSearch(q);
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
  });

  // ---------------------------------------------------------------- Search YouTube
  async function runYouTubeSearch(q) {
    const status = $("mu-yt-status");
    status.textContent = "Searching...";
    lists.youtube = [];
    renderList("youtube");
    try {
      const info = await ytSearch(q, 12);
      if (info.error) { status.textContent = ytProblem(info); return; }
      lists.youtube = (info.results || []).map((r) => makeTrack({ id: r.id, title: r.title, artist: r.channel, type: "ost", thumb: r.thumb }));
      status.textContent = lists.youtube.length ? `${lists.youtube.length} results. Click one to play, + to keep it in My songs.` : "Nothing found. Try other words.";
      renderList("youtube");
      paintCurrent();
    } catch {
      status.textContent = "Search didn't work right now. Is the HugAnime server running (npm start)?";
    }
  }
  $("mu-yt-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("mu-yt-q").value.trim();
    if (q.length >= 2) runYouTubeSearch(q);
  });

  // ---------------------------------------------------------------- Anime songs (AniList -> MyAnimeList themes -> YouTube)
  async function anilist(query, variables) {
    const res = await fetch(ANILIST, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query, variables }) });
    if (!res.ok) throw new Error("AniList " + res.status);
    return (await res.json())?.data;
  }

  // Jikan lists each theme as one line:  1: "Song (日本語)" by Artist (eps 1-13)
  function parseTheme(line, type, anime) {
    let text = String(line || "").trim().replace(/^#?\d+\s*:\s*/, "").replace(/\s*\(eps?\b[^)]*\)\s*$/i, "").trim();
    const m = /^["“](.+?)["”](?:\s+by\s+(.+))?$/.exec(text);
    let title = m ? m[1] : text;
    const artist = (m?.[2] || "").trim();
    title = title.replace(/\s*\([^)]*[　-鿿＀-￯][^)]*\)\s*$/, "").trim() || title;
    return makeTrack({ key: `t:${type}:${title}:${artist}`.toLowerCase(), title, artist, anime, type });
  }

  async function showAnimeSongs(media) {
    const name = media.title?.english || media.title?.romaji || "this anime";
    const status = $("mu-an-status");
    animeTitle = name;
    lists.anime = [];
    renderList("anime");
    if (!media.idMal) { status.textContent = `${name} has no MyAnimeList entry, so its songs aren't listed.`; return; }
    status.textContent = `Loading the songs of ${name}...`;
    try {
      let json = null;
      for (let attempt = 0; attempt < 3 && !json; attempt++) {
        const res = await fetch(`${JIKAN}/anime/${media.idMal}/themes`);
        if (res.status === 429) { await wait(1200 * (attempt + 1)); continue; }
        if (!res.ok) throw new Error("Jikan " + res.status);
        json = await res.json();
      }
      if (!json) throw new Error("rate limited");
      const tracks = [
        ...(json.data?.openings || []).map((t) => parseTheme(t, "op", name)),
        ...(json.data?.endings || []).map((t) => parseTheme(t, "ed", name)),
      ];
      lists.anime = tracks;
      status.textContent = tracks.length
        ? `${tracks.length} songs from ${name}. Click one and it's found on YouTube.`
        : `${name} has no openings or endings listed yet.`;
      renderList("anime");
      paintCurrent();
    } catch {
      status.textContent = "Couldn't load the songs right now. Try again in a moment.";
    }
  }

  async function findAnime(q) {
    const picks = $("mu-an-picks");
    const status = $("mu-an-status");
    status.textContent = "Searching...";
    picks.innerHTML = "";
    try {
      const data = await anilist(
        "query ($s: String) { Page(perPage: 8) { media(search: $s, type: ANIME, sort: SEARCH_MATCH) { id idMal title { romaji english } coverImage { medium } seasonYear format } } }",
        { s: q });
      const found = data?.Page?.media || [];
      if (!found.length) { status.textContent = "No anime found. Try another name."; return; }
      status.textContent = "Pick one:";
      picks.innerHTML = found.map((m, i) => `
        <button class="mu-pick" type="button" data-i="${i}">
          <img src="${esc(m.coverImage?.medium || "")}" alt="" loading="lazy" decoding="async">
          <span><b>${esc(m.title?.english || m.title?.romaji)}</b><small>${esc([m.format, m.seasonYear].filter(Boolean).join(" · "))}</small></span>
        </button>`).join("");
      picks._found = found;
    } catch {
      status.textContent = "Couldn't search anime right now.";
    }
  }
  $("mu-an-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("mu-an-q").value.trim();
    if (q.length >= 2) findAnime(q);
  });
  $("mu-an-picks").addEventListener("click", (e) => {
    const pick = e.target.closest(".mu-pick");
    const found = $("mu-an-picks")._found;
    if (!pick || !found) return;
    $("mu-an-picks").innerHTML = "";
    showAnimeSongs(found[Number(pick.dataset.i)]);
  });

  // music.html?anime=<AniList id>  (e.g. a link from the watch page)
  async function openFromAddress() {
    const id = Number(new URLSearchParams(location.search).get("anime"));
    if (!id) return;
    setMode("anime");
    $("mu-an-status").textContent = "Loading...";
    try {
      const data = await anilist("query ($id: Int) { Media(id: $id, type: ANIME) { id idMal title { romaji english } } }", { id });
      if (data?.Media) showAnimeSongs(data.Media);
    } catch { $("mu-an-status").textContent = "Couldn't load that anime."; }
  }

  // ---------------------------------------------------------------- add a song by YouTube link
  function videoIdFrom(text) {
    const value = String(text || "").trim();
    if (ID_RE.test(value)) return value;
    let url;
    try { url = new URL(value); } catch { return ""; }
    const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/")[1] || "";
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
      else { const m = /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(url.pathname); id = m ? m[1] : ""; }
    }
    return ID_RE.test(id) ? id : "";
  }

  $("mu-add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = $("mu-add-note");
    const id = videoIdFrom($("mu-add-url").value);
    if (!id) { note.textContent = "That doesn't look like a YouTube video link."; return; }
    if (inLibrary(id)) { note.textContent = "That song is already in the list."; return; }
    note.textContent = "Adding...";
    let title = "YouTube video";
    let artist = "";
    try {
      const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`);
      if (res.ok) { const info = await res.json(); title = info.title || title; artist = info.author_name || ""; }
      else if (res.status === 401 || res.status === 403) { note.textContent = "That video can't be played on other sites."; return; }
      else if (res.status === 404) { note.textContent = "That video wasn't found."; return; }
    } catch { /* offline or blocked: add it with a generic title */ }
    addToLibrary(makeTrack({ id, title: title.slice(0, 120), artist: artist.slice(0, 80), type: $("mu-add-type").value }));
    $("mu-add-url").value = "";
    note.textContent = "Added to My songs.";
    render();
    toast("Song added");
  });

  // ---------------------------------------------------------------- go
  paintToggles();
  render();
  showNote("Loading the player...");
  setTimeout(() => { if (!state.ready) showNote("The player is taking a while. Is YouTube blocked on this network?"); }, 8000);
  openFromAddress();
})();
