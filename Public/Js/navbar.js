(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const navContainer = $(".nav-container");
  const menu = $("#site-menu");
  const menuToggle = $(".menu-toggle");
  const menuClose = $(".nav-drawer-close", menu);
  const searchBox = $(".nav-search");
  const input = $("#manga-search");
  const results = $("#search-results");
  const mobileToggle = $(".mobile-search-toggle");
  const randomBtn = $(".random-manga");
  const clearBtn = $(".search-clear");

  const MOBILE_QUERY = window.matchMedia("(max-width: 450px)");
  const ANILIST = "https://graphql.anilist.co";
  const RANDOM_PAGES_KEY = "huganime-random-pages";
  const RANDOM_PER_PAGE = 50;

  let lastFocused = null;
  let closeTimer = null;

  function openMenu() {
    if (menu.classList.contains("active")) return;
    clearTimeout(closeTimer);
    lastFocused = document.activeElement;
    menu.hidden = false;
    menu.setAttribute("aria-hidden", "false");
    menuToggle.setAttribute("aria-expanded", "true");
    menuToggle.setAttribute("aria-label", "Close menu");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        menu.classList.add("active");
        menuClose.focus({ preventScroll: true });
      })
    );
  }

  function closeMenu({ restoreFocus = true } = {}) {
    if (menu.hidden) return;
    menu.classList.remove("active");
    menu.setAttribute("aria-hidden", "true");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open menu");
    closeTimer = setTimeout(() => {
      if (!menu.classList.contains("active")) menu.hidden = true;
    }, 280);
    if (restoreFocus && lastFocused) lastFocused.focus({ preventScroll: true });
  }

  menuToggle.addEventListener("click", () =>
    menu.classList.contains("active") ? closeMenu() : openMenu()
  );
  menuClose.addEventListener("click", () => closeMenu());

  menu.addEventListener("click", (e) => {
    if (e.target === menu) closeMenu();
  });

  $$('.nav-drawer a[href^="#"]').forEach((a) =>
    a.addEventListener("click", () => closeMenu({ restoreFocus: false }))
  );

  $$(".nav-drawer-search").forEach((btn) =>
    btn.addEventListener("click", () => {
      closeMenu({ restoreFocus: false });
      focusSearch();
    })
  );

  menu.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = $$("a[href], button", menu).filter((el) => !el.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  function openMobileSearch() {
    navContainer.classList.add("mobile-search-open");
    mobileToggle.setAttribute("aria-expanded", "true");
    input.focus();
  }

  function closeMobileSearch() {
    navContainer.classList.remove("mobile-search-open");
    mobileToggle.setAttribute("aria-expanded", "false");
    closePanel();
  }

  mobileToggle.addEventListener("click", () =>
    navContainer.classList.contains("mobile-search-open")
      ? closeMobileSearch()
      : openMobileSearch()
  );

  function focusSearch() {
    if (MOBILE_QUERY.matches) openMobileSearch();
    else input.focus();
    input.select();
    openPanel();
  }

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      focusSearch();
    } else if (e.key === "Escape") {
      if (menu.classList.contains("active")) closeMenu();
      else if (searchBox.classList.contains("is-open")) closePanel();
      else if (navContainer.classList.contains("mobile-search-open")) closeMobileSearch();
    }
  });

  MOBILE_QUERY.addEventListener("change", (e) => {
    if (!e.matches) navContainer.classList.remove("mobile-search-open");
  });

  // NOTE: the search itself (typing, results, tabs, arrow keys, Enter) lives in search.js (AniList).
  // This file only opens/closes the panel and handles the menu, mobile search toggle and random button.
  // (An older Jikan-based search used to live here too; it ran at the same time as search.js and
  //  overwrote good results with "Couldn't load results" once a Jikan request failed.)

  function openPanel() {
    searchBox.classList.add("is-open");
    input.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    searchBox.classList.remove("is-open");
    input.setAttribute("aria-expanded", "false");
  }

  function showMessage(text) {
    results.replaceChildren();
    const p = document.createElement("p");
    p.className = "search-message";
    p.textContent = text;
    results.appendChild(p);
  }

  // "Clear" on an already empty box just closes the panel (search.js clears the text when there is some)
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!input.value) {
      closePanel();
      if (MOBILE_QUERY.matches) closeMobileSearch();
      input.blur();
    }
  });

  searchBox.addEventListener("focusout", (e) => {
    if (e.relatedTarget && !searchBox.contains(e.relatedTarget)) closePanel();
  });

  document.addEventListener("click", (e) => {
    if (!searchBox.contains(e.target) && !mobileToggle.contains(e.target)) closePanel();
  });

  // Random: pick a popular, already-released anime from AniList and go straight to its watch page.
  // AniList can't sort randomly, so we jump to a random page of the popularity-sorted list and pick a random entry on it.
  const RANDOM_QUERY = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { lastPage }
        media(type: ANIME, isAdult: false, format_in: [TV, MOVIE, ONA], status_not: NOT_YET_RELEASED, popularity_greater: 10000, sort: POPULARITY_DESC) { id }
      }
    }`;

  const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

  async function randomPage(page) {
    const res = await fetch(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: RANDOM_QUERY, variables: { page, perPage: RANDOM_PER_PAGE } }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data.Page;
  }

  async function pickRandomAnimeId() {
    let lastPage = 0;
    try { lastPage = Number(sessionStorage.getItem(RANDOM_PAGES_KEY)) || 0; } catch { /* storage blocked */ }

    let data;
    if (lastPage) {
      data = await randomPage(randomInt(1, lastPage));
    } else {
      data = await randomPage(1);
      lastPage = data.pageInfo.lastPage || 1;
      try { sessionStorage.setItem(RANDOM_PAGES_KEY, String(lastPage)); } catch { /* ignore */ }
      const page = randomInt(1, lastPage);
      if (page !== 1) data = await randomPage(page);
    }

    let list = data.media || [];
    if (!list.length) list = (await randomPage(1)).media || []; // the list shrank since we cached its size
    if (!list.length) throw new Error("No anime found");
    return list[randomInt(0, list.length - 1)].id;
  }

  randomBtn.addEventListener("click", async () => {
    if (randomBtn.disabled) return;
    const icon = randomBtn.querySelector("i");
    randomBtn.disabled = true;
    icon?.classList.add("fa-beat-fade");
    try {
      const id = await pickRandomAnimeId();
      window.location.href = "/watch.html?id=" + encodeURIComponent(id) + "&ep=1";
    } catch {
      randomBtn.disabled = false;
      icon?.classList.remove("fa-beat-fade");
      if (MOBILE_QUERY.matches) openMobileSearch();
      showMessage("Couldn't pick a random anime. Please try again.");
      openPanel();
    }
  });

  // coming back with the browser's Back button: make the button usable again
  window.addEventListener("pageshow", () => {
    randomBtn.disabled = false;
    randomBtn.querySelector("i")?.classList.remove("fa-beat-fade");
  });
})();