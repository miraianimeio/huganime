// Custom Theme: the panel that opens from the rainbow swatch in the side menu.
// It builds a palette from a few colours, writes it onto <html> as --ct-* variables (see Css/custom-theme.css)
// and saves it, so every page can restore it. Loaded on demand by slidebar.js.
(() => {
  "use strict";
  if (window.HugCustomTheme) return;

  const SCRIPT_SRC = document.currentScript && document.currentScript.src;
  const STORE = "huganime-custom-theme";
  const THEME_KEY = "huganime-theme";
  const DEFAULT_ACCENT = "#4ed9ff";
  const root = document.documentElement;

  const VAR_KEYS = [
    "--ct-bg", "--ct-bg-rgb", "--ct-card", "--ct-accent", "--ct-text", "--ct-hover", "--ct-border",
    "--ct-accent-hover", "--ct-muted", "--ct-nav", "--ct-trend", "--ct-on-accent", "--ct-font",
    "--accent", "--accent-rgb",
  ];
  const ATTR_KEYS = ["data-ct-glass", "data-ct-font", "data-ct-panel", "data-ct-light"];

  /* ---------- colour helpers ---------- */
  const HEX = /^#[0-9a-f]{6}$/i;
  const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = toRgb(a), y = toRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
  const luminance = (hex) => {
    const [r, g, b] = toRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const onColor = (hex) => (contrast(hex, "#0b0b0d") >= contrast(hex, "#ffffff") ? "#0b0b0d" : "#ffffff");
  const rgbTriple = (hex) => toRgb(hex).join(" ");

  /* ---------- presets, fonts, rows ---------- */
  const PRESETS = [
    { id: "glass", name: "Glass", bg: "#0b1016", card: "#141b24", accent: "#4ed9ff", text: "#f4f7fa", glass: true },
    { id: "grape", name: "Grape", bg: "#0f0a1f", card: "#1a1330", accent: "#a855f7", text: "#f5f3ff" },
    { id: "midnight", name: "Midnight", bg: "#0a0f1e", card: "#121a30", accent: "#7aa2ff", text: "#eef2ff" },
    { id: "forest", name: "Forest", bg: "#07130e", card: "#0e2118", accent: "#34d399", text: "#ecfdf5" },
    { id: "rose", name: "Rose", bg: "#14080d", card: "#24101a", accent: "#fb7185", text: "#fff1f2" },
    { id: "sunset", name: "Sunset", bg: "#150b07", card: "#251510", accent: "#fb923c", text: "#fff7ed" },
    { id: "mono", name: "Mono", bg: "#0a0a0a", card: "#171717", accent: "#d4d4d8", text: "#fafafa" },
    { id: "ocean", name: "Ocean", bg: "#051520", card: "#0c2536", accent: "#38bdf8", text: "#ecfeff" },
    { id: "light", name: "Light", bg: "#f4f4f5", card: "#ffffff", accent: "#7c3aed", text: "#18181b" },
  ];

  // Only fonts that are already installed on the visitor's device: nothing is downloaded from any font service
  const FONTS = [
    { id: "default", name: "Default", stack: "" },
    { id: "system", name: "System UI", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
    { id: "helvetica", name: "Helvetica / Arial", stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
    { id: "trebuchet", name: "Trebuchet", stack: '"Trebuchet MS", "Segoe UI", sans-serif' },
    { id: "verdana", name: "Verdana", stack: 'Verdana, Geneva, sans-serif' },
    { id: "georgia", name: "Georgia (serif)", stack: 'Georgia, "Times New Roman", serif' },
    { id: "mono", name: "Monospace", stack: 'ui-monospace, "Cascadia Code", Consolas, "Courier New", monospace' },
  ];

  const MAIN_ROWS = [
    ["bg", "Background", "Page backdrop"],
    ["card", "Cards", "Card & panel surface"],
    ["accent", "Accent", "Buttons, links, highlights"],
    ["text", "Text", "Main text color"],
  ];
  const ADV_ROWS = [
    ["hover", "Hover / rows", "Subtle raised surface"],
    ["border", "Borders", "Card & divider lines"],
    ["accentHover", "Accent hover", "Brighter accent on hover"],
    ["muted", "Muted text", "Secondary / meta text"],
    ["nav", "Navbar", "Top bar & dropdowns"],
    ["trend", "Trending bar", "Top Trending sidebar"],
  ];

  /* ---------- state ---------- */
  const emptyAdv = () => ({ hover: null, border: null, accentHover: null, muted: null, nav: null, trend: null });

  function currentAccent() {
    if (root.dataset.theme === "custom") return DEFAULT_ACCENT;
    const v = getComputedStyle(root).getPropertyValue("--accent").trim();
    return HEX.test(v) ? v : DEFAULT_ACCENT;
  }

  function fresh() {
    // starts from the site's normal look, so opening the panel changes nothing until something is edited
    return { preset: "", bg: "#000000", card: "#121314", accent: currentAccent(), text: "#f4f4f5", adv: emptyAdv(), font: "default", glass: false };
  }

  function loadSaved() {
    try {
      const o = JSON.parse(localStorage.getItem(STORE) || "null");
      const d = o && o.draft;
      if (!d || !["bg", "card", "accent", "text"].every((k) => HEX.test(d[k]))) return null;
      return { ...fresh(), ...d, adv: { ...emptyAdv(), ...(d.adv || {}) } };
    } catch { return null; }
  }

  const saved = loadSaved();
  let draft = saved || fresh();
  let active = Boolean(saved);

  function resolve(d) {
    const light = luminance(d.bg) > 0.5;
    const a = d.adv;
    const pick = (v) => (v && HEX.test(v) ? v : null);
    return {
      bg: d.bg, card: d.card, accent: d.accent, text: d.text,
      hover: pick(a.hover) || mix(d.card, d.text, 0.08),
      border: pick(a.border) || mix(d.card, d.text, 0.14),
      accentHover: pick(a.accentHover) || mix(d.accent, "#ffffff", 0.2),
      muted: pick(a.muted) || mix(d.text, d.bg, 0.34),
      nav: pick(a.nav) || (light ? d.card : mix(d.bg, d.text, 0.09)),
      trend: pick(a.trend) || d.card,
      light,
    };
  }

  const fontOf = (d) => FONTS.find((f) => f.id === d.font) || FONTS[0];

  function build(d) {
    const p = resolve(d);
    const f = fontOf(d);
    const vars = {
      "--ct-bg": p.bg, "--ct-bg-rgb": rgbTriple(p.bg), "--ct-card": p.card, "--ct-accent": p.accent, "--ct-text": p.text,
      "--ct-hover": p.hover, "--ct-border": p.border, "--ct-accent-hover": p.accentHover, "--ct-muted": p.muted,
      "--ct-nav": p.nav, "--ct-trend": p.trend, "--ct-on-accent": onColor(p.accent),
      "--accent": p.accent, "--accent-rgb": rgbTriple(p.accent),
    };
    if (f.stack) vars["--ct-font"] = f.stack;
    const attrs = {};
    if (d.glass) attrs["data-ct-glass"] = "1";
    if (f.stack) attrs["data-ct-font"] = "1";
    if (d.adv.trend) attrs["data-ct-panel"] = "1";
    if (p.light) attrs["data-ct-light"] = "1";
    return { vars, attrs };
  }

  /* ---------- applying + saving ---------- */
  function clearInline() {
    VAR_KEYS.forEach((k) => root.style.removeProperty(k));
    ATTR_KEYS.forEach((k) => root.removeAttribute(k));
  }

  function setSiteTheme(name) {
    if (window.HugPrefs && window.HugPrefs.setTheme) return window.HugPrefs.setTheme(name);
    try { localStorage.setItem(THEME_KEY, name); } catch { /* storage blocked */ }
    root.dataset.theme = name;
  }

  function applyDraft() {
    const out = build(draft);
    clearInline();
    Object.entries(out.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    Object.entries(out.attrs).forEach(([k, v]) => root.setAttribute(k, v));
    try { localStorage.setItem(STORE, JSON.stringify({ draft, ...out })); } catch { /* storage blocked */ }
    if (root.dataset.theme !== "custom") setSiteTheme("custom");
    active = true;
  }

  function resetAll() {
    draft = fresh();
    active = false;
    try { localStorage.removeItem(STORE); } catch { /* storage blocked */ }
    clearInline();
    setSiteTheme("multi");
    draft.accent = currentAccent();
  }

  function ensureCss() {
    if (document.getElementById("ct-css") || !SCRIPT_SRC) return;
    const existing = Array.from(document.styleSheets).some((s) => s.href && s.href.endsWith("custom-theme.css"));
    if (existing) return;
    const link = document.createElement("link");
    link.id = "ct-css";
    link.rel = "stylesheet";
    link.href = new URL("../Css/custom-theme.css", SCRIPT_SRC).href;
    document.head.appendChild(link);
  }

  /* ---------- the panel ---------- */
  const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>';

  let ui = null;
  let lastFocus = null;

  function rowHtml([key, name, desc]) {
    return `<div class="ctm_row"><span><span class="ctm_row-name">${name}</span><span class="ctm_row-desc">${desc}</span></span>` +
      `<label class="ctm_swatch" title="${name}"><i data-sw="${key}"></i><input type="color" data-key="${key}" aria-label="${name}"></label></div>`;
  }

  function buildPanel() {
    const el = document.createElement("div");
    el.className = "ctm";
    el.hidden = true;
    el.innerHTML = `
      <div class="ctm_card" role="dialog" aria-modal="true" aria-labelledby="ctm-title">
        <div class="ctm_head">
          <div>
            <h2 class="ctm_title" id="ctm-title">Custom Theme</h2>
            <p class="ctm_sub">Full control over colors &amp; font</p>
          </div>
          <button class="ctm_x" type="button" aria-label="Close">${X_ICON}</button>
        </div>
        <div class="ctm_body">
          <div class="ctm_label">Start from a preset</div>
          <div class="ctm_presets" role="group" aria-label="Presets">${PRESETS.map((p) =>
            `<button class="ctm_chip" type="button" data-preset="${p.id}"><span class="ctm_dot" style="--dot:${p.accent}"></span>${p.name}</button>`).join("")}</div>

          <div class="ctm_label">Live preview</div>
          <div class="ctm_preview" aria-hidden="true">
            <div class="ctm_pv-bar"><span class="ctm_pv-dot"></span>HugAnime</div>
            <div class="ctm_pv-grid">
              <div class="ctm_pv-card"><h4>Anime Title</h4><p>Sample description text goes here.</p><span class="ctm_pv-btn">${PLAY_ICON}Play</span></div>
              <div class="ctm_pv-card"><h4>Trending</h4><ol><li><b>1</b>Title one</li><li><b>2</b>Title two</li></ol></div>
            </div>
          </div>
          <div class="ctm_contrast" role="status"></div>

          <div class="ctm_label">Colors</div>
          <div>${MAIN_ROWS.map(rowHtml).join("")}
            <div class="ctm_row"><span><span class="ctm_row-name">Font</span><span class="ctm_row-desc">All site text</span></span>
              <select class="ctm_select" aria-label="Font">${FONTS.map((f) => `<option value="${f.id}">${f.name}</option>`).join("")}</select></div>
            <div class="ctm_row"><span><span class="ctm_row-name">Transparent</span><span class="ctm_row-desc">Frosted-glass surfaces</span></span>
              <button class="ctm_switch" type="button" role="switch" aria-checked="false" aria-label="Transparent"></button></div>
          </div>

          <button class="ctm_adv-btn" type="button" aria-expanded="false" aria-controls="ctm-adv">⚙ Advanced options</button>
          <div class="ctm_adv" id="ctm-adv" hidden>${ADV_ROWS.map(rowHtml).join("")}</div>
        </div>
        <div class="ctm_foot">
          <button class="ctm_btn ctm_btn--ghost" type="button" data-act="reset">Reset to default</button>
          <button class="ctm_btn ctm_btn--main" type="button" data-act="done">Done</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    ui = {
      el,
      card: el.querySelector(".ctm_card"),
      preview: el.querySelector(".ctm_preview"),
      contrast: el.querySelector(".ctm_contrast"),
      inputs: Object.fromEntries(Array.from(el.querySelectorAll("input[type=color]")).map((i) => [i.dataset.key, i])),
      chips: Array.from(el.querySelectorAll(".ctm_chip")),
      font: el.querySelector(".ctm_select"),
      glass: el.querySelector(".ctm_switch"),
      advBtn: el.querySelector(".ctm_adv-btn"),
      adv: el.querySelector(".ctm_adv"),
    };

    // colour pickers
    Object.entries(ui.inputs).forEach(([key, input]) => {
      input.addEventListener("input", () => {
        if (ADV_ROWS.some((r) => r[0] === key)) draft.adv[key] = input.value; else draft[key] = input.value;
        draft.preset = "";
        commit();
      });
    });

    // presets
    ui.chips.forEach((chip) => chip.addEventListener("click", () => {
      const p = PRESETS.find((x) => x.id === chip.dataset.preset);
      if (!p) return;
      draft = { ...draft, preset: p.id, bg: p.bg, card: p.card, accent: p.accent, text: p.text, glass: Boolean(p.glass), adv: emptyAdv() };
      commit();
    }));

    ui.font.addEventListener("change", () => { draft.font = ui.font.value; commit(); });
    ui.glass.addEventListener("click", () => { draft.glass = !draft.glass; commit(); });

    ui.advBtn.addEventListener("click", () => {
      const open = ui.adv.hidden;
      ui.adv.hidden = !open;
      ui.advBtn.setAttribute("aria-expanded", String(open));
      if (open) ui.adv.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    el.querySelector(".ctm_x").addEventListener("click", close);
    el.querySelector('[data-act="done"]').addEventListener("click", close);
    el.querySelector('[data-act="reset"]').addEventListener("click", () => { resetAll(); sync(); });
    el.addEventListener("mousedown", (e) => { if (e.target === el) close(); });
    el.addEventListener("keydown", onKey);
  }

  function ratingOf(r) { return r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA Large" : "Fail"; }

  function sync() {
    const p = resolve(draft);
    const f = fontOf(draft);

    Object.entries(ui.inputs).forEach(([key, input]) => {
      const value = p[key];
      if (input.value.toLowerCase() !== value.toLowerCase()) input.value = value;
      input.previousElementSibling.style.setProperty("--c", value);
    });
    ui.chips.forEach((c) => c.classList.toggle("is-active", c.dataset.preset === draft.preset));
    ui.font.value = f.id;
    ui.glass.setAttribute("aria-checked", String(Boolean(draft.glass)));

    const pv = ui.preview.style;
    pv.setProperty("--pv-bg", p.bg); pv.setProperty("--pv-card", p.card); pv.setProperty("--pv-accent", p.accent);
    pv.setProperty("--pv-text", p.text); pv.setProperty("--pv-muted", p.muted); pv.setProperty("--pv-border", p.border);
    pv.setProperty("--pv-nav", p.nav); pv.setProperty("--pv-on", onColor(p.accent));
    ui.preview.style.fontFamily = f.stack || "";

    const rBg = contrast(p.text, p.bg);
    const rCard = contrast(p.text, p.card);
    const worst = Math.min(rBg, rCard);
    ui.contrast.className = "ctm_contrast " + (worst >= 4.5 ? "is-ok" : worst >= 3 ? "is-warn" : "is-bad");
    ui.contrast.innerHTML =
      `<span>Text on background <b>${rBg.toFixed(1)}:1 · ${ratingOf(rBg)}</b></span>` +
      `<span>Text on cards <b>${rCard.toFixed(1)}:1 · ${ratingOf(rCard)}</b></span>`;

    ui.el.style.setProperty("--ctm-accent", p.accent);
    ui.el.style.setProperty("--ctm-on", onColor(p.accent));
  }

  function commit() {
    applyDraft();
    sync();
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const items = Array.from(ui.card.querySelectorAll("button, select, input, [tabindex]:not([tabindex='-1'])"))
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open(trigger) {
    ensureCss();
    lastFocus = trigger || document.activeElement;
    if (!ui) buildPanel();
    if (active && root.dataset.theme !== "custom") applyDraft(); // saved custom theme comes back when the swatch is used
    sync();
    ui.el.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      ui.el.classList.add("is-open");
      ui.card.querySelector(".ctm_x").focus({ preventScroll: true });
    });
  }

  function close() {
    if (!ui || ui.el.hidden) return;
    ui.el.classList.remove("is-open");
    document.body.style.overflow = "";
    setTimeout(() => { ui.el.hidden = true; }, 180);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  window.HugCustomTheme = { open, close };
})();
