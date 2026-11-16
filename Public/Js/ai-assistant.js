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

  // Loads its own stylesheet (so the home page does not have to wait for it) and builds the
  // assistant only once the styles are there - no unstyled flash, no layout jump.
  var cssLink = document.createElement("link");
  cssLink.rel = "stylesheet";
  cssLink.href = new URL("../Css/ai-assistant.css", (document.currentScript && document.currentScript.src) || document.baseURI).href;
  var booted = false;
  function boot() { if (booted) return; booted = true; main(); }
  cssLink.addEventListener("load", boot);
  cssLink.addEventListener("error", boot);
  document.head.appendChild(cssLink);

  function main() {

  var VOICE_BASE = new URL("../Assets/Voice/", document.baseURI).href;

  var INTRO = {
    text: "Is there something you\u2019d like to know?",
    src: "intro.mp3",
      w: [[0.17,0.51],[0.51,0.85],[0.85,1.53],[1.53,1.87],[1.87,2.21],[2.21,2.55],[2.55,2.89]],
  };

  // Order = order of the buttons. "src" is the file inside Assets/Voice/.
  var ITEMS = [
    {
      q: "Is HugAnime free?",
      text: "Is HugAnime free? Yes. You can watch without paying or signing up for anything.",
      src: "is-huganime-free.mp3",
      w: [[0.42,0.71],[0.71,1.87],[1.87,2.16],[2.86,3.13],[3.54,3.82],[3.82,4.09],[4.09,4.37],[4.37,4.92],[4.92,5.46],[5.46,5.74],[5.74,6.29],[6.29,6.56],[6.56,6.84],[6.84,7.66]],
    },
    {
      q: "What\u2019s the difference between SUB and DUB?",
      text: "What\u2019s the difference between SUB and DUB? SUB plays the original Japanese audio with English subtitles. DUB plays the English-dubbed version. Not every anime has a dub.",
      src: "sub-vs-dub.mp3",
      w: [[0.19,0.46],[0.46,0.74],[0.74,1.56],[1.56,2.11],[2.11,2.38],[2.38,2.66],[2.66,2.93],[3.44,3.67],[3.67,3.9],[3.9,4.12],[4.12,5.04],[5.39,6.35],[6.35,7.32],[7.67,7.96],[7.96,8.55],[8.55,9.44],[9.92,10.42],[10.42,10.92],[10.92,11.41],[11.67,13.04],[13.39,14.04],[14.04,14.36],[14.36,15.01],[15.01,15.98],[15.98,16.3],[16.3,16.63],[16.63,16.95]],
    },
    {
      q: "The video won\u2019t play. What should I do?",
      text: "The video won\u2019t play. What should I do? Try another server under the player (HD-1, S-2, Vidplay, etc.). Servers that don\u2019t have your episode are hidden automatically, so any server you can see should work. If S-2 shows a trailer, give it a few minutes and try again.",
      src: "video-wont-play.mp3",
      w: [[0.19,0.51],[0.51,1.17],[1.17,1.5],[1.5,1.82],[2.42,2.71],[2.71,3.01],[3.01,3.31],[3.31,3.6],[4.19,4.54],[4.54,5.58],[5.58,6.28],[6.62,7.26],[7.26,7.58],[7.86,8.33],[8.64,9.51],[9.79,10.21],[10.21,10.63],[10.63,10.84],[11.53,11.91],[11.91,12.1],[12.1,12.29],[12.29,12.48],[12.48,12.68],[12.68,13.44],[13.78,14.0],[14.0,14.45],[14.45,15.57],[16.18,16.51],[16.51,17.16],[17.16,17.82],[17.82,18.15],[18.15,18.48],[18.48,18.8],[18.8,19.13],[19.13,19.46],[19.46,19.79],[20.2,20.8],[20.8,21.1],[21.1,21.4],[21.4,22.0],[22.0,22.3],[22.3,22.6],[23.01,23.32],[23.32,23.63],[23.63,24.25],[24.25,24.56],[24.56,24.87],[24.87,25.48]],
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
      w: [[0.19,0.45],[0.45,0.72],[0.72,1.77],[2.16,3.11],[3.47,3.72],[3.72,3.97],[3.97,4.23],[4.23,4.98],[4.98,5.48],[5.48,5.73],[5.73,5.98],[6.33,6.58],[6.58,6.83],[6.83,7.08],[7.08,7.33],[7.33,7.58],[7.58,7.83],[7.83,8.08],[8.08,8.33],[8.33,8.58],[8.58,9.32],[9.65,9.91],[9.91,10.17],[10.17,10.43],[10.43,10.69],[10.69,10.95]],
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
    var n = Math.ceil(Math.min(1, Math.max(0, p)) * t.length - 1e-6);
    if (n === lastShown) return;                 // nothing new to draw this frame
    lastShown = n;
    typedEl.textContent = t.slice(0, n);
  }

  // Word-by-word sync. Each caption word has [start, end] seconds in its clip
  // (measured from the real audio: the pauses in the voice are used as anchors),
  // so the text shows each word while it is being spoken - not before.
  function charsAt(t, item) {
    var words = item.text.split(" "), w = item.w;
    if (!w || w.length !== words.length) {          // no timing data: fall back to an even spread
      var d = audio.duration;
      return (isFinite(d) && d > 0) ? Math.ceil(Math.min(1, t / d) * item.text.length) : 0;
    }
    var n = 0, off = 0;
    for (var i = 0; i < words.length; i++) {
      var len = words[i].length, a = w[i][0], b = w[i][1];
      if (t >= b) n = off + len;
      else {
        if (t > a) n = off + Math.ceil(len * (t - a) / (b - a));
        break;
      }
      off += len + 1;
    }
    return n;
  }

  var lastShown = -1;
  function loopAudioTyping() {
    cancelAnimationFrame(raf);
    showText(reduceMotion || !current ? 1 : charsAt(audio.currentTime, current) / current.text.length);
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
  } // end main
})();
