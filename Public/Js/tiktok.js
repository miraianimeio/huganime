/* ==========================================================================
   HugAnime - TikTok Mode
   - swipe / scroll / arrow keys to change video, the visible one plays, the others pause
   - tap = play / pause, double tap = like, drag the bottom bar to seek
   - like, follow, save, comments and mute are remembered in this browser (localStorage)
   The video list lives in Js/tiktok-data.js
   ========================================================================== */
(() => {
  "use strict";

  const VIDEOS = Array.isArray(window.TIKTOK_VIDEOS) ? window.TIKTOK_VIDEOS : [];
  const SIM_LENGTH_MS = 12000;           // length of the fake "playback" for placeholder cards
  const DOUBLE_TAP_MS = 280;

  const KEYS = {
    likes: "huganime-tt-likes",
    saves: "huganime-tt-saves",
    follows: "huganime-tt-follows",
    comments: "huganime-tt-comments",
    muted: "huganime-tt-muted",
  };

  // ---------------------------------------------------------------- tiny helpers
  const $ = (id) => document.getElementById(id);
  const feed = $("tt-feed");
  const toastEl = $("tt-toast");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^(https?:\/\/|\.{0,2}\/)/i.test(String(u || "")) ? String(u) : "");
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

  function fmt(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function load(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked or full */ }
  }

  const likes = new Set(load(KEYS.likes, []));
  const saves = new Set(load(KEYS.saves, []));
  const follows = new Set(load(KEYS.follows, []));
  const myComments = load(KEYS.comments, {});     // { videoId: [{name, text}] }

  const state = { tab: "foryou", muted: load(KEYS.muted, false) === true, active: -1 };
  let items = [];                  // [{ el, data, video, userPaused, sim }]
  let observer = null;
  let toastTimer = 0;

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2200);
  }

  // ---------------------------------------------------------------- icons
  const I = {
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    plus: '<svg class="tt-ico-plus" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>',
    check: '<svg class="tt-ico-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  };

  // ---------------------------------------------------------------- building the feed
  function buildItem(v, index) {
    const hue = Number.isFinite(v.hue) ? v.hue : hash(v.id) % 360;
    const el = document.createElement("article");
    el.className = "tt-item";
    el.dataset.i = String(index);
    el.dataset.id = v.id;
    el.style.setProperty("--hue", hue);
    el.setAttribute("aria-label", `Video by ${v.user}`);

    const poster = safeUrl(v.poster);
    const media = v.src
      ? `<video playsinline loop preload="none" ${poster ? `poster="${esc(poster)}"` : ""} data-src="${esc(safeUrl(v.src))}"></video>`
      : `<div class="tt-placeholder"><div class="tt-ph-title">${esc(v.anime?.title || v.user)}</div><span class="tt-ph-note">Clip coming soon</span></div>`;

    const tags = (v.tags || []).map((t) => `<span class="tt-tag">#${esc(t)}</span>`).join(" ");
    const avatarUrl = safeUrl(v.avatar);
    const avatar = avatarUrl ? `<img src="${esc(avatarUrl)}" alt="" loading="lazy" decoding="async">` : esc((v.user || "?").charAt(0));
    const watch = v.anime?.id
      ? `<a class="tt-watch" href="watch.html?id=${encodeURIComponent(v.anime.id)}&amp;ep=1">${I.play} Watch full anime</a>`
      : "";

    el.innerHTML = `
      <div class="tt-media">${media}</div>
      <div class="tt-shade"></div>
      <button class="tt-tap" type="button" aria-label="Play or pause"></button>
      <div class="tt-flash">${I.play}</div>
      <div class="tt-hearts"></div>

      <div class="tt-rail">
        <div class="tt-avatar-wrap">
          <div class="tt-avatar">${avatar}</div>
          <button class="tt-follow" type="button" aria-pressed="false" aria-label="Follow @${esc(v.user)}">${I.plus}${I.check}</button>
        </div>
        <button class="tt-action tt-like" type="button" aria-pressed="false" aria-label="Like">${I.heart}<span class="tt-like-count"></span></button>
        <button class="tt-action tt-comment-btn" type="button" aria-label="Open comments">${I.comment}<span class="tt-comment-count"></span></button>
        <button class="tt-action tt-save" type="button" aria-pressed="false" aria-label="Save">${I.bookmark}<span>Save</span></button>
        <button class="tt-action tt-share-open" type="button" aria-label="Share">${I.share}<span>${esc(fmt(v.shares))}</span></button>
        <div class="tt-disc" aria-hidden="true">${I.note}</div>
      </div>

      <div class="tt-info">
        <p class="tt-user">@${esc(v.user)}</p>
        <p class="tt-caption">${esc(v.caption)} ${tags}</p>
        ${watch}
        <div class="tt-sound">${I.note}<span>${esc(v.sound || "Original sound")}</span></div>
      </div>

      <div class="tt-progress" role="slider" aria-label="Video position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="-1">
        <div class="tt-track"><div class="tt-bar"></div></div>
      </div>`;

    const item = { el, data: v, video: el.querySelector("video"), userPaused: false, playing: false, sim: { t: 0 } };
    refreshLike(item);
    refreshSave(item);
    refreshFollow(item);
    refreshComments(item);
    return item;
  }

  function render() {
    if (observer) observer.disconnect();
    items.forEach((it) => { it.video?.pause(); });
    items = [];
    state.active = -1;
    feed.replaceChildren();
    feed.scrollTop = 0;

    const list = state.tab === "following" ? VIDEOS.filter((v) => follows.has(v.user)) : VIDEOS;
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "tt-empty";
      empty.innerHTML = state.tab === "following"
        ? "<h2>Nobody followed yet</h2><p>Tap the + under a creator's picture on For You, and their videos will show up here.</p><button type=\"button\" data-go=\"foryou\">Go to For You</button>"
        : "<h2>No videos yet</h2><p>Add some in Public/Js/tiktok-data.js.</p>";
      feed.append(empty);
      updateDeskNav();
      return;
    }

    items = list.map(buildItem);
    feed.append(...items.map((it) => it.el));

    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number(e.target.dataset.i));
      }
    }, { root: feed, threshold: [0.6] });
    items.forEach((it) => observer.observe(it.el));

    // opened from a shared link (tiktok.html#clip-003)?
    const wanted = decodeURIComponent(location.hash.slice(1));
    const at = items.findIndex((it) => it.data.id === wanted);
    if (at > 0) feed.scrollTop = at * feed.clientHeight;
  }

  // ---------------------------------------------------------------- state -> screen
  function refreshLike(it) {
    const on = likes.has(it.data.id);
    const btn = it.el.querySelector(".tt-like");
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Unlike" : "Like");
    btn.querySelector(".tt-like-count").textContent = fmt((it.data.likes || 0) + (on ? 1 : 0));
  }
  function refreshSave(it) {
    const on = saves.has(it.data.id);
    const btn = it.el.querySelector(".tt-save");
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Remove from saved" : "Save");
    btn.querySelector("span").textContent = on ? "Saved" : "Save";
  }
  function refreshFollow(it) {
    const on = follows.has(it.data.user);
    const btn = it.el.querySelector(".tt-follow");
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", (on ? "Unfollow @" : "Follow @") + it.data.user);
  }
  function refreshComments(it) {
    const extra = (myComments[it.data.id] || []).length;
    it.el.querySelector(".tt-comment-count").textContent = fmt((it.data.comments || 0) + extra);
  }

  // ---------------------------------------------------------------- playback
  function ensureSrc(it) {
    const v = it.video;
    if (v && !v.getAttribute("src") && v.dataset.src) { v.src = v.dataset.src; v.preload = "metadata"; }
  }

  function setPlayingUI(it, playing) {
    it.playing = playing;
    it.el.classList.toggle("is-playing", playing);
    it.el.classList.toggle("is-paused", !playing && it.userPaused);
  }

  function playItem(it) {
    const v = it.video;
    if (!v) { setPlayingUI(it, true); startTick(); return; }      // placeholder card: fake playback
    ensureSrc(it);
    v.muted = state.muted;
    const p = v.play();
    setPlayingUI(it, true);
    startTick();
    if (p && p.catch) {
      p.catch((err) => {
        if (err && err.name === "NotAllowedError" && !v.muted) {
          // the browser only allows silent autoplay here: start muted, tell the person how to get sound
          v.muted = true;
          v.play().catch(() => setPlayingUI(it, false));
          toast("Tap the speaker to turn sound on");
        } else if (err && err.name !== "AbortError") {
          setPlayingUI(it, false);
        }
      });
    }
  }

  function pauseItem(it) {
    it.video?.pause();
    setPlayingUI(it, false);
  }

  function setActive(index) {
    if (index === state.active || !items[index]) return;
    const prev = items[state.active];
    if (prev) { pauseItem(prev); prev.userPaused = false; prev.el.classList.remove("is-paused"); }
    state.active = index;
    const it = items[index];
    it.userPaused = false;
    // only the neighbours get their video file fetched
    [index - 1, index, index + 1].forEach((n) => items[n] && ensureSrc(items[n]));
    if (!document.hidden) playItem(it);
    updateDeskNav();
  }

  function togglePlay(it) {
    if (it.playing) { it.userPaused = true; pauseItem(it); }
    else { it.userPaused = false; it.el.classList.remove("is-paused"); playItem(it); }
  }

  // one animation loop: moves the progress bar of the active card
  let raf = 0, last = 0;
  function startTick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function tick(now) {
    raf = 0;
    const it = items[state.active];
    if (!it || !it.playing) return;
    const dt = now - last; last = now;
    let ratio = 0;
    if (it.video) {
      ratio = it.video.duration ? it.video.currentTime / it.video.duration : 0;
    } else {
      it.sim.t = (it.sim.t + dt) % SIM_LENGTH_MS;
      ratio = it.sim.t / SIM_LENGTH_MS;
    }
    setProgress(it, ratio);
    raf = requestAnimationFrame(tick);
  }
  function setProgress(it, ratio) {
    const r = Math.min(1, Math.max(0, ratio || 0));
    it.el.querySelector(".tt-bar").style.width = (r * 100).toFixed(2) + "%";
    it.el.querySelector(".tt-progress").setAttribute("aria-valuenow", String(Math.round(r * 100)));
  }

  function seekTo(it, ratio) {
    ratio = Math.min(1, Math.max(0, ratio));
    if (it.video && it.video.duration) it.video.currentTime = ratio * it.video.duration;
    else it.sim.t = ratio * SIM_LENGTH_MS;
    setProgress(it, ratio);
  }

  // ---------------------------------------------------------------- actions
  function toggleLike(it, forceOn) {
    const id = it.data.id;
    const on = forceOn === true ? true : !likes.has(id);
    if (on) likes.add(id); else likes.delete(id);
    save(KEYS.likes, [...likes]);
    refreshLike(it);
  }

  function burst(it, x, y) {
    const layer = it.el.querySelector(".tt-hearts");
    const box = layer.getBoundingClientRect();
    const h = document.createElement("div");
    h.innerHTML = I.heart.replace("<svg", '<svg class="tt-burst"');
    const svg = h.firstChild;
    svg.style.left = (x - box.left) + "px";
    svg.style.top = (y - box.top) + "px";
    svg.style.setProperty("--r", (Math.random() * 30 - 15).toFixed(0) + "deg");
    layer.append(svg);
    setTimeout(() => svg.remove(), 900);
  }

  function toggleFollow(it) {
    const user = it.data.user;
    if (follows.has(user)) { follows.delete(user); toast("Unfollowed @" + user); }
    else { follows.add(user); toast("Following @" + user); }
    save(KEYS.follows, [...follows]);
    items.forEach((o) => { if (o.data.user === user) refreshFollow(o); });
  }

  function toggleSave(it) {
    const id = it.data.id;
    if (saves.has(id)) { saves.delete(id); toast("Removed from saved"); }
    else { saves.add(id); toast("Saved"); }
    save(KEYS.saves, [...saves]);
    refreshSave(it);
  }

  // ---------------------------------------------------------------- sheets (comments / share)
  let openSheetEl = null, sheetTrigger = null, sheetItem = null;

  function openSheet(sheet, trigger) {
    if (openSheetEl) closeSheet(true);
    openSheetEl = sheet;
    sheetTrigger = trigger || null;
    sheet.hidden = false;
    void sheet.offsetWidth;                                   // let the browser see the start position
    sheet.classList.add("is-open");
    (sheet.querySelector("input, button:not([data-close]), .tt-sheet-close"))?.focus({ preventScroll: true });
  }

  function closeSheet(immediate) {
    const sheet = openSheetEl;
    if (!sheet) return;
    openSheetEl = null;
    sheet.classList.remove("is-open");
    const done = () => { sheet.hidden = true; };
    if (immediate) done(); else setTimeout(done, 420);
    sheetTrigger?.focus({ preventScroll: true });
  }

  const SAMPLE_COMMENTS = [
    { name: "mika_chan", text: "This is so good, I watched it three times." },
    { name: "ren.k", text: "Wait, what anime is this?" },
    { name: "sora", text: "The music is perfect for this scene." },
    { name: "yuki_fan", text: "Adding this to my watch list right now." },
  ];

  function commentHtml(c) {
    const hue = hash(c.name) % 360;
    return `<li class="tt-comment"><div class="tt-comment-avatar" style="--hue:${hue}">${esc(c.name.charAt(0))}</div>` +
      `<div class="tt-comment-body"><p class="tt-comment-name">${esc(c.name)}</p><p class="tt-comment-text">${esc(c.text)}</p></div></li>`;
  }

  function renderComments(it) {
    const all = [...(myComments[it.data.id] || []).slice().reverse(), ...SAMPLE_COMMENTS];
    $("tt-comment-list").innerHTML = all.length ? all.map(commentHtml).join("") : '<li class="tt-comment-empty">No comments yet.</li>';
  }

  function openComments(it, trigger) {
    sheetItem = it;
    renderComments(it);
    openSheet($("tt-comments"), trigger);
  }

  $("tt-comment-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("tt-comment-input");
    const text = input.value.trim();
    if (!text || !sheetItem) return;
    const id = sheetItem.data.id;
    (myComments[id] = myComments[id] || []).push({ name: "You", text: text.slice(0, 200) });
    save(KEYS.comments, myComments);
    input.value = "";
    refreshComments(sheetItem);
    renderComments(sheetItem);
    $("tt-comment-list").scrollTop = 0;
  });

  function shareUrl(it) { return location.origin + location.pathname + "#" + encodeURIComponent(it.data.id); }

  function openShare(it, trigger) {
    sheetItem = it;
    $("tt-native").hidden = !navigator.share;
    openSheet($("tt-share"), trigger);
  }

  $("tt-copy").addEventListener("click", async () => {
    const url = shareUrl(sheetItem);
    try { await navigator.clipboard.writeText(url); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.append(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* nothing more we can do */ }
      ta.remove();
    }
    closeSheet();
    toast("Link copied");
  });

  $("tt-native").addEventListener("click", async () => {
    try { await navigator.share({ title: "HugAnime TikTok Mode", text: sheetItem.data.caption, url: shareUrl(sheetItem) }); closeSheet(); }
    catch { /* cancelled */ }
  });

  document.querySelectorAll(".tt-sheet").forEach((sheet) => {
    sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
  });

  // ---------------------------------------------------------------- feed events (one listener for every card)
  let lastTap = { at: 0, i: -1 }, tapTimer = 0;

  feed.addEventListener("click", (e) => {
    const card = e.target.closest(".tt-item");
    const go = e.target.closest("[data-go]");
    if (go) { setTab(go.dataset.go); return; }
    if (!card) return;
    const it = items[Number(card.dataset.i)];
    if (!it) return;

    if (e.target.closest(".tt-follow")) return toggleFollow(it);
    if (e.target.closest(".tt-like")) { toggleLike(it); return; }
    if (e.target.closest(".tt-save")) return toggleSave(it);
    const cBtn = e.target.closest(".tt-comment-btn");
    if (cBtn) return openComments(it, cBtn);
    const sBtn = e.target.closest(".tt-share-open");
    if (sBtn) return openShare(it, sBtn);
    const cap = e.target.closest(".tt-caption");
    if (cap) { cap.classList.toggle("is-open"); return; }

    if (e.target.closest(".tt-tap")) {
      const now = Date.now();
      if (lastTap.i === it.el.dataset.i && now - lastTap.at < DOUBLE_TAP_MS) {
        clearTimeout(tapTimer);
        lastTap = { at: 0, i: -1 };
        burst(it, e.clientX, e.clientY);
        toggleLike(it, true);
      } else {
        lastTap = { at: now, i: it.el.dataset.i };
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => togglePlay(it), DOUBLE_TAP_MS);
      }
    }
  });

  // drag / tap on the bottom bar to seek
  let dragging = null;
  function ratioFrom(e, bar) { const r = bar.getBoundingClientRect(); return (e.clientX - r.left) / r.width; }
  feed.addEventListener("pointerdown", (e) => {
    const bar = e.target.closest(".tt-progress");
    if (!bar) return;
    const it = items[Number(bar.closest(".tt-item").dataset.i)];
    if (!it) return;
    dragging = { it, bar };
    bar.classList.add("is-drag");
    bar.setPointerCapture(e.pointerId);
    seekTo(it, ratioFrom(e, bar));
  });
  feed.addEventListener("pointermove", (e) => { if (dragging) seekTo(dragging.it, ratioFrom(e, dragging.bar)); });
  const endDrag = () => { if (dragging) { dragging.bar.classList.remove("is-drag"); dragging = null; } };
  feed.addEventListener("pointerup", endDrag);
  feed.addEventListener("pointercancel", endDrag);

  // ---------------------------------------------------------------- top bar, tabs, mute, keyboard
  function setTab(tab) {
    if (state.tab === tab) return;
    state.tab = tab;
    document.querySelectorAll(".tt-tab").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });
    render();
  }
  document.querySelectorAll(".tt-tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  const muteBtn = $("tt-mute");
  function applyMute() {
    muteBtn.setAttribute("aria-pressed", String(state.muted));
    muteBtn.setAttribute("aria-label", state.muted ? "Sound is off. Press to turn it on" : "Sound is on. Press to mute");
    const it = items[state.active];
    if (it?.video) it.video.muted = state.muted;
  }
  muteBtn.addEventListener("click", () => {
    state.muted = !state.muted;
    save(KEYS.muted, state.muted);
    applyMute();
    toast(state.muted ? "Sound off" : "Sound on");
  });

  function goTo(index) {
    index = Math.min(items.length - 1, Math.max(0, index));
    feed.scrollTo({ top: index * feed.clientHeight, behavior: "smooth" });
  }
  function updateDeskNav() {
    $("tt-prev").disabled = state.active <= 0;
    $("tt-next").disabled = state.active < 0 || state.active >= items.length - 1;
  }
  $("tt-prev").addEventListener("click", () => goTo(state.active - 1));
  $("tt-next").addEventListener("click", () => goTo(state.active + 1));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openSheetEl) { closeSheet(); return; }
    if (openSheetEl || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const it = items[state.active];
    switch (e.key) {
      case "ArrowDown": case "j": case "J": e.preventDefault(); goTo(state.active + 1); break;
      case "ArrowUp": case "k": case "K": e.preventDefault(); goTo(state.active - 1); break;
      case " ": if (e.target.closest("button, a")) return; e.preventDefault(); if (it) togglePlay(it); break;
      case "m": case "M": muteBtn.click(); break;
      case "l": case "L": if (it) toggleLike(it); break;
    }
  });

  // pause when the tab is hidden, carry on when it is back
  document.addEventListener("visibilitychange", () => {
    const it = items[state.active];
    if (!it) return;
    if (document.hidden) pauseItem(it);
    else if (!it.userPaused) playItem(it);
  });

  // ---------------------------------------------------------------- go
  applyMute();
  render();
})();
