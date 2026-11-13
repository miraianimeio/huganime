// Comments block for watch.html (Anime / Episode tabs + "Load comments").
// Comments are saved in this browser only (localStorage). To make them public later,
// replace load()/save() with calls to your own backend.
const KEY = "huganime-comments";
const $ = (id) => document.getElementById(id);
const root = $("comments");
let scope = "anime";

const watching = () => window.HugWatch?.state || {};
const bucket = () => {
  const { animeId, currentEpisode } = watching();
  return scope === "episode" ? `${animeId}:${currentEpisode}` : String(animeId);
};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
}

function render() {
  const items = load()[bucket()] || [];
  const list = $("comments-list");
  list.replaceChildren(...items.map((c, index) => {
    const li = document.createElement("li");
    li.className = "comment";
    const head = document.createElement("div");
    head.className = "comment_head";
    const who = document.createElement("b");
    who.textContent = "You";
    const when = document.createElement("time");
    when.textContent = new Date(c.at).toLocaleString();
    const del = document.createElement("button");
    del.type = "button";
    del.className = "linklike";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      const data = load();
      data[bucket()] = (data[bucket()] || []).filter((_, i) => i !== index);
      save(data);
      render();
    });
    head.append(who, when, del);
    const text = document.createElement("p");
    text.textContent = c.text; // textContent: never interpreted as HTML
    li.append(head, text);
    return li;
  }));
  $("comments-empty").hidden = items.length > 0;
}

if (root) {
  $("comments-load").addEventListener("click", () => {
    $("comments-load").hidden = true;
    $("comments-body").hidden = false;
    render();
  });

  root.querySelectorAll(".comments_tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      scope = tab.dataset.scope;
      root.querySelectorAll(".comments_tab").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      if (!$("comments-body").hidden) render();
    });
  });

  $("comments-post").addEventListener("click", () => {
    const field = $("comments-text");
    const text = field.value.trim();
    if (!text || !watching().animeId) return;
    const data = load();
    (data[bucket()] ||= []).unshift({ text, at: Date.now() });
    save(data);
    field.value = "";
    render();
  });

  // The Episode tab follows the episode being watched.
  const label = $("watching-ep");
  if (label) {
    new MutationObserver(() => { if (scope === "episode" && !$("comments-body").hidden) render(); })
      .observe(label, { childList: true, characterData: true, subtree: true });
  }
}
