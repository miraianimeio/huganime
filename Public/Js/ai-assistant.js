/* ==========================================================================
   HugAnime AI assistant (home page)
   - A glass orb waits in the bottom-right corner.
   - Click / tap it: it glides to the centre, "Is there something you'd like to know?" plays.
   - Click / tap a question: its voice clip plays and the English caption types out in sync.

   Voice clips live in /Assets/Voice/. To add or change a question, edit ITEMS below.
   A question whose clip is missing still works: the caption just types out silently.
   ========================================================================== */
(function () {
  "use strict";

  var VOICE_BASE = new URL("../Assets/Voice/", document.baseURI).href;

  var INTRO = {
    text: "Is there something you\u2019d like to know?",
    src: "intro.mp3",
    t: { start: 0, end: 2.895, gaps: [] }
  };

  // Order = order of the buttons. "src" is the file inside Assets/Voice/.
  var ITEMS = [
    {
      q: "Is HugAnime free?",
      text: "Is HugAnime free? Yes. You can watch without paying or signing up for anything.",
      src: "is-huganime-free.mp3",
      t: { start: 0.415, end: 7.662, gaps: [[2.159,.698],[3.126,.417],[4.941,.19],[6.609,.189]] }
    },
    {
      q: "What\u2019s the difference between SUB and DUB?",
      text: "What\u2019s the difference between SUB and DUB? SUB plays the original Japanese audio with English subtitles. DUB plays the English-dubbed version. Not every anime has a dub.",
      src: "sub-vs-dub.mp3",
      t: { start: 0.187, end: 16.952, gaps: [[2.934,.505],[5.039,.35],[7.319,.348],[9.443,.479],[11.414,.257],[13.041,.347],[14.649,.225]] }
    },
    {
      q: "The video won\u2019t play. What should I do?",
      text: "The video won\u2019t play. What should I do? Try another server under the player (HD-1, S-2, Vidplay, etc.). Servers that don\u2019t have your episode are hidden automatically, so any server you can see should work. If S-2 shows a trailer, give it a few minutes and try again.",
      src: "video-wont-play.mp3",
      t: { start: 0.187, end: 25.484, gaps: [[1.823,.593],[3.602,.591],[6.281,.337],[7.576,.284],[8.325,.31],[9.513,.279],[10.84,.687],[13.441,.334],[15.573,.608],[17.835,.25],[19.787,.418],[22.605,.408]] }
    },
    {
      q: "What does Auto Skip do?",
      text: "What does Auto Skip do? It skips the opening and jumps to the next episode when the ending starts. Turn it on under the player. It only works on episodes that have skip data, and some servers don\u2019t support it.",
      src: "auto-skip.mp3"            // no clip yet -> caption types out silently until the file is added
    },
    {
      q: "What is HugAnime?",
      text: "What is HugAnime? HugAnime is a free anime streaming site where you can find, watch and keep track of your favorite shows, all in one place.",
      src: "what-is-huganime.mp3",
      t: { start: 0.19, end: 10.949, gaps: [[1.77,.387],[3.11,.361],[5.984,.351],[9.325,.329]] }
    }
  ];

  var BAR_COUNT = 30;
    var SILENT_CPS = 20;               // characters per second when a clip is missing
  var CORNER_GAP = 20;               // distance of the corner orb from the screen edges

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- build DOM
  var root = document.createElement("div");
  root.className = "ha-ai-root";
  root.innerHTML =
    '<div class="ha-ai__scrim" data-ai="scrim"></div>' +
    '<div class="ha-ai__hint" data-ai="hint" aria-hidden="true">Ask me anything</div>' +
    '<section class="ha-ai__stage" data-ai="stage" role="dialog" aria-modal="true" aria-label="HugAnime assistant" tabindex="-1">' +
      '<button type="button" class="ha-ai__close" data-ai="close" aria-label="Close assistant">&times;</button>' +
      '<p class="ha-ai__caption" data-ai="caption" aria-live="polite">' +
        '<span class="ha-ai__ghost" data-ai="ghost" aria-hidden="true"></span>' +
        '<span class="ha-ai__typed" data-ai="typed" aria-hidden="true"></span>' +
      '</p>' +
      '<div class="ha-ai__player">' +
        '<button type="button" class="ha-ai__play" data-ai="play" aria-label="Play">&#9654;</button>' +
        '<div class="ha-ai__wave" data-ai="wave" aria-hidden="true"></div>' +
      '</div>' +
      '<ul class="ha-ai__list" data-ai="list"></ul>' +
    '</section>' +
    '<button type="button" class="ha-ai__orb no-anim" data-ai="orb" aria-label="Ask the HugAnime assistant" aria-expanded="false">' +
      '<span class="ha-ai__orb-body"></span>' +
      '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true">' +
        '<path d="M10 2.5c.4 3.9 1.9 6.1 5.8 6.5-3.9.4-5.4 2.6-5.8 6.5-.4-3.9-1.9-6.1-5.8-6.5C8.1 8.6 9.6 6.4 10 2.5z"/>' +
        '<path d="M18 13c.3 2.2 1.2 3.1 3.4 3.4-2.2.3-3.1 1.2-3.4 3.4-.3-2.2-1.2-3.1-3.4-3.4 2.2-.3 3.1-1.2 3.4-3.4z" opacity=".9"/>' +
      '</svg>' +
    '</button>';
  document.body.appendChild(root);

  function $(name) { return root.querySelector('[data-ai="' + name + '"]'); }
  var stage = $("stage"), orb = $("orb"), hint = $("hint"), closeBtn = $("close");
  var typedEl = $("typed"), ghostEl = $("ghost"), playBtn = $("play"), waveEl = $("wave"), listEl = $("list");

  // wave bars (taller in the middle, varied speeds)
  for (var i = 0; i < BAR_COUNT; i++) {
    var bar = document.createElement("span");
    bar.className = "ha-ai__bar";
    var env = Math.sin(Math.PI * (i + 0.5) / BAR_COUNT);
    var h = 0.22 + 0.78 * env * (0.55 + 0.45 * Math.abs(Math.sin(i * 12.9898)));
    bar.style.setProperty("--h", h.toFixed(2));
    bar.style.setProperty("--d", (0.55 + 0.5 * Math.abs(Math.sin(i * 7.31))).toFixed(2) + "s");
    bar.style.setProperty("--dl", (-0.9 * Math.abs(Math.sin(i * 3.17))).toFixed(2) + "s");
    waveEl.appendChild(bar);
  }

  // question buttons
  var chips = ITEMS.map(function (item, idx) {
    var li = document.createElement("li");
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ha-ai__chip";
    b.style.setProperty("--i", idx);
    b.textContent = item.q;
    b.addEventListener("click", function () { speak(item, b); });
    li.appendChild(b);
    listEl.appendChild(li);
    return b;
  });

  // ---------------------------------------------------------------- orb placement
  var isOpen = false;

  function px(varName, fallback) {
    var v = parseFloat(getComputedStyle(root).getPropertyValue(varName));
    return isFinite(v) ? v : fallback;
  }

  function place(open, animate) {
    var orbSize = px("--ai-orb", 96);
    var cornerSize = px("--ai-orb-corner", 62);
    var vw = document.documentElement.clientWidth;
    var vh = window.innerHeight;
    var x, y, s;

    if (open) {
      var hh = stage.offsetHeight;
      x = (vw - orbSize) / 2;
      y = (vh - hh) / 2 + 18;
      s = 1;
    } else {
      s = cornerSize / orbSize;
      x = vw - cornerSize - CORNER_GAP;
      y = vh - cornerSize - CORNER_GAP - 4;
      // hint sits to the left of the corner orb
      hint.style.right = (CORNER_GAP + cornerSize + 10) + "px";
      hint.style.bottom = (CORNER_GAP + 4 + (cornerSize - 36) / 2) + "px";
    }
    orb.classList.toggle("no-anim", !animate);
    orb.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px) scale(" + s + ")";
  }

  place(false, false);
  var resizeRaf = 0;
  window.addEventListener("resize", function () {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () { resizeRaf = 0; place(isOpen, false); });
  }, { passive: true });

  // ---------------------------------------------------------------- audio + caption
  var audio = new Audio();
  audio.preload = "auto";
  var current = null;          // {text, src} being played
  var raf = 0, silentTimer = 0, silentStart = 0, silentMode = false;
  var token = 0;

  function setState(speaking, done) {
    root.classList.toggle("is-speaking", !!speaking);
    root.classList.toggle("is-done", !!done);
    playBtn.innerHTML = speaking ? "&#10074;&#10074;" : "&#9654;";
    playBtn.setAttribute("aria-label", speaking ? "Pause" : "Play");
  }

  function showText(p) {
    var t = current ? current.text : "";
    var n = Math.ceil(Math.min(1, Math.max(0, p)) * t.length);
    if (n === lastShown) return;                 // nothing new to draw this frame
    lastShown = n;
    typedEl.textContent = t.slice(0, n);
  }

  // How much of the caption has been spoken at time t (0..1).
  // Pauses in the voice are cut out, so the text waits when the voice waits,
  // and the caption only reaches 100% when the voice is really finished.
  function spokenAt(t, timing) {
    if (!timing) {
      var d = audio.duration;
      return (isFinite(d) && d > 0) ? t / d : 0;
    }
    var total = timing.end - timing.start, now = Math.min(Math.max(t, timing.start), timing.end) - timing.start;
    for (var i = 0; i < timing.gaps.length; i++) {
      var gs = timing.gaps[i][0], ge = gs + timing.gaps[i][1];
      total -= timing.gaps[i][1];
      if (t > ge) now -= timing.gaps[i][1];
      else if (t > gs) now -= (t - gs);
    }
    return total > 0 ? Math.max(0, now) / total : 1;
  }

  var lastShown = -1;
  function loopAudioTyping() {
    cancelAnimationFrame(raf);
    showText(reduceMotion ? 1 : spokenAt(audio.currentTime, current && current.t));
    if (!audio.paused && !audio.ended) raf = requestAnimationFrame(loopAudioTyping);
  }

  function loopSilentTyping() {
    cancelAnimationFrame(raf);
    var secs = (performance.now() - silentStart) / 1000;
    var total = Math.max(2.5, current.text.length / SILENT_CPS);
    var p = reduceMotion ? 1 : secs / total;
    showText(p);
    if (p < 1) { raf = requestAnimationFrame(loopSilentTyping); }
    else { setState(false, true); }
  }

  function startSilent() {
    silentMode = true;
    lastShown = -1;
    silentStart = performance.now();
    setState(false, false);
    loopSilentTyping();
  }

  function stopAll() {
    token++;
    cancelAnimationFrame(raf);
    audio.pause();
    silentMode = false;
  }

  audio.addEventListener("playing", function () {
    silentMode = false;
    setState(true, false);
    loopAudioTyping();
  });
  audio.addEventListener("pause", function () {
    if (!audio.ended) setState(false, false);
  });
  audio.addEventListener("seeked", loopAudioTyping);
  audio.addEventListener("ended", function () {
    cancelAnimationFrame(raf);
    lastShown = -1;
    showText(1);
    setState(false, true);
  });
  audio.addEventListener("error", function () {
    if (!current || !audio.getAttribute("src")) return;
    // clip missing or unplayable -> keep the experience going with a silent, typed caption
    console.info("[assistant] voice clip not available:", current.src);
    startSilent();
  });

  function speak(item, chip) {
    stopAll();
    current = item;
    chips.forEach(function (c) { c.removeAttribute("aria-current"); });
    if (chip) chip.setAttribute("aria-current", "true");

    lastShown = -1;
    ghostEl.textContent = item.text;
    typedEl.textContent = "";
    setState(false, false);
    if (reduceMotion) { typedEl.textContent = item.text; }

    audio.src = VOICE_BASE + item.src;
    var p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(function (err) {
        if (err && err.name === "NotAllowedError") {   // browser blocked sound: show the text, play button still works
          typedEl.textContent = item.text;
          setState(false, true);
        }
      });
    }
  }

  playBtn.addEventListener("click", function () {
    if (!current) return;
    if (silentMode) { startSilent(); return; }
    if (!audio.paused) { audio.pause(); return; }
    if (audio.ended || (audio.duration && audio.currentTime >= audio.duration - 0.05)) audio.currentTime = 0;
    var p = audio.play();
    if (p && typeof p.catch === "function") p.catch(function () {});
  });

  // ---------------------------------------------------------------- open / close
  function stopWelcomeWidget() {
    var w = document.getElementById("haWelcome");
    var c = document.getElementById("haWelcomeClose");
    if (w && !w.hidden && c) c.click();
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    stopWelcomeWidget();
    root.classList.remove("show-hint");
    root.classList.add("is-open");
    orb.setAttribute("aria-expanded", "true");
    try { sessionStorage.setItem("huganime-ai-used", "1"); } catch (e) {}
    place(true, true);
    speak(INTRO, null);
    setTimeout(function () { if (isOpen) stage.focus({ preventScroll: true }); }, 450);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    stopAll();
    current = null;
    typedEl.textContent = "";
    ghostEl.textContent = "";
    chips.forEach(function (c) { c.removeAttribute("aria-current"); });
    setState(false, false);
    root.classList.remove("is-open");
    orb.setAttribute("aria-expanded", "false");
    place(false, true);
    orb.focus({ preventScroll: true });
  }

  orb.addEventListener("click", function () {
    if (!isOpen) open();
    else speak(INTRO, null);              // tapping the centred orb says the greeting again
  });
  closeBtn.addEventListener("click", close);
  $("scrim").addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) close();
  });

  // ---------------------------------------------------------------- gentle hint
  var seen = false;
  try { seen = sessionStorage.getItem("huganime-ai-used") === "1"; } catch (e) {}
  if (!seen) {
    setTimeout(function () {
      if (isOpen) return;
      root.classList.add("show-hint");
      setTimeout(function () { root.classList.remove("show-hint"); }, 6000);
    }, 2500);
  }
})();
