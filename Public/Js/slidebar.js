(() => {
  "use strict";

  const THEME_KEY = "huganime-theme";
  const LANG_KEY = "huganime-lang";
  const THEMES = ["orange", "blue", "pink", "red", "multi"]; // "multi" = the site's default colours
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

  const state = {
    theme: load(THEME_KEY, THEMES, DEFAULT_THEME),
    language: load(LANG_KEY, LANGS, DEFAULT_LANG),
  };

  const themeButtons = Array.from(document.querySelectorAll("[data-theme-choice]"));
  const langButtons = Array.from(document.querySelectorAll("[data-lang-choice]"));


  function paint(buttons, attr, value) {
    buttons.forEach((b) => {
      const on = b.dataset[attr] === value;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  function apply() {
    root.dataset.theme = state.theme;
    root.dataset.lang = state.language;
    paint(themeButtons, "themeChoice", state.theme);
    paint(langButtons, "langChoice", state.language);
  }

  function changed() {
    document.dispatchEvent(new CustomEvent("huganime:preferences", { detail: { ...state } }));
  }

  function wire(buttons, attr, key, prop) {
    buttons.forEach((button, i) => {
      button.addEventListener("click", () => {
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
        next.click();
      });
    });
  }

  wire(themeButtons, "themeChoice", THEME_KEY, "theme");
  wire(langButtons, "langChoice", LANG_KEY, "language");
  apply();

  window.HugPrefs = { get: () => ({ ...state }) };
})();