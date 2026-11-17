(() => {
  "use strict";

  const THEME_KEY = "huganime-theme";
  const LANG_KEY = "huganime-lang";
  const CUSTOM_KEY = "huganime-custom-theme";
  const SCRIPT_SRC = document.currentScript && document.currentScript.src;
  const THEMES = ["orange", "blue", "pink", "red", "multi", "custom"]; // "multi" = the site's default colours; "custom" = the Custom Theme panel
  const CUSTOM_VARS = [
    "--ct-bg", "--ct-bg-rgb", "--ct-card", "--ct-accent", "--ct-text", "--ct-hover", "--ct-border",
    "--ct-accent-hover", "--ct-muted", "--ct-nav", "--ct-trend", "--ct-on-accent", "--ct-font", "--accent", "--accent-rgb",
  ];
  const CUSTOM_ATTRS = ["data-ct-glass", "data-ct-font", "data-ct-panel", "data-ct-light"];
  const LANGS = ["sub", "dub"];
  const DEFAULT_THEME = "multi";
  const DEFAULT_LANG = "dub";

  const root = document.documentElement;

  function load(key, allowed, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* storage blocked */ }
  }

  function hasCustomTheme() {
    try { return Boolean(window.localStorage.getItem(CUSTOM_KEY)); } catch { return false; }
  }

  // "custom" only counts when a saved custom theme exists to go with it
  let startTheme = load(THEME_KEY, THEMES, DEFAULT_THEME);
  if (startTheme === "custom" && !hasCustomTheme()) startTheme = DEFAULT_THEME;

  const state = {
    theme: startTheme,
    language: load(LANG_KEY, LANGS, DEFAULT_LANG),
  };

  const themeButtons = Array.from(document.querySelectorAll("[data-theme-choice]"));
  const langButtons = Array.from(document.querySelectorAll("[data-lang-choice]"));


  function clearCustom() {
    CUSTOM_VARS.forEach((k) => root.style.removeProperty(k));
    CUSTOM_ATTRS.forEach((k) => root.removeAttribute(k));
    const font = document.getElementById("ct-font");
    if (font) font.remove();
  }

  function paint(buttons, attr, value) {
    buttons.forEach((b) => {
      // the rainbow swatch stands for both the default colours and a custom theme
      const on = b.dataset[attr] === value || (attr === "themeChoice" && value === "custom" && b.dataset[attr] === "multi");
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  function apply() {
    if (state.theme !== "custom") clearCustom();
    root.dataset.theme = state.theme;
    root.dataset.lang = state.language;
    paint(themeButtons, "themeChoice", state.theme);
    paint(langButtons, "langChoice", state.language);
  }

  function changed() {
    document.dispatchEvent(new CustomEvent("huganime:preferences", { detail: { ...state } }));
  }

  // the rainbow swatch opens the Custom Theme panel (loaded the first time it is needed)
  let customLoading = null;
  function openCustomPanel(trigger) {
    const ready = () => window.HugCustomTheme && window.HugCustomTheme.open(trigger);
    if (window.HugCustomTheme) return ready();
    if (!SCRIPT_SRC) return;
    if (!customLoading) {
      customLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL("custom-theme.js", SCRIPT_SRC).href;
        script.onload = resolve;
        script.onerror = () => { customLoading = null; reject(new Error("custom-theme.js did not load")); };
        document.head.appendChild(script);
      });
    }
    customLoading.then(ready).catch((err) => console.error(err));
  }

  const isCustomButton = (b) => b.dataset.themeChoice === "multi";

  function wire(buttons, attr, key, prop) {
    buttons.forEach((button, i) => {
      button.addEventListener("click", () => {
        if (attr === "themeChoice" && isCustomButton(button)) return openCustomPanel(button);
        state[prop] = button.dataset[attr];
        save(key, state[prop]);
        apply();
        changed();
      });

      button.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = buttons[(i + step + buttons.length) % buttons.length];
        next.focus();
        if (!(attr === "themeChoice" && isCustomButton(next))) next.click(); // arrowing onto the rainbow swatch must not pop the panel open
      });
    });
  }

  wire(themeButtons, "themeChoice", THEME_KEY, "theme");
  wire(langButtons, "langChoice", LANG_KEY, "language");
  apply();

  window.HugPrefs = {
    get: () => ({ ...state }),
    // used by the Custom Theme panel to switch the site theme without going through a swatch click
    setTheme(name) {
      if (!THEMES.includes(name)) return;
      state.theme = name;
      save(THEME_KEY, name);
      apply();
      changed();
    },
  };
})();