import { html, safeUrl } from "../core/escape.js";
import { readJson, writeJson, STORAGE_KEYS } from "../core/storage.js";

 

const HISTORY_LIMIT = 60;

export function getWatchHistory() {
  const history = readJson(STORAGE_KEYS.watchHistory, []);
  return Array.isArray(history) ? history : [];
}

export function setWatchHistory(history) {
  writeJson(STORAGE_KEYS.watchHistory, history);
}

export function saveWatchHistoryEntry(entry) {
  if (!entry?.id) return;
  let history = getWatchHistory().filter(item => String(item.id) !== String(entry.id));
  history.unshift(entry);
  if (history.length > HISTORY_LIMIT) history = history.slice(0, HISTORY_LIMIT);
  setWatchHistory(history);
}

function formatRelativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function progressPercent(entry) {
  return entry.totalEpisodes
    ? Math.max(4, Math.min(100, Math.round((entry.episode / entry.totalEpisodes) * 100)))
    : 6;
}

function renderHistoryRow(entry) {
  const poster = safeUrl(entry.poster) || "assets/logo.png";
  const title = entry.title || "Unknown Anime";
  const href = `watch.html?id=${encodeURIComponent(entry.id)}&ep=${encodeURIComponent(entry.episode)}`;

  return html`
    <div class="history-row" data-history-id="${entry.id}">
      <a href="${href}" class="history-row-thumb">
        <img src="${poster}" alt="${title}">
        <span class="history-row-play"><i class="fas fa-play"></i></span>
      </a>
      <div class="history-row-info">
        <a href="${href}" class="history-row-title" title="${title}">${title}</a>
        <div class="history-row-meta">
          <span class="history-row-episode">EPISODE <b>${entry.episode}</b></span>
          <span class="history-row-time">${formatRelativeTime(entry.updatedAt)}</span>
        </div>
        <div class="history-row-progress">
          <div class="history-row-progress-fill" style="width:${progressPercent(entry)}%"></div>
        </div>
      </div>
      <button type="button" class="history-row-remove" data-remove-id="${entry.id}" title="Remove from history">
        <i class="fas fa-xmark"></i>
      </button>
    </div>`;
}

function renderContinueWatchingCard(entry) {
  const poster = safeUrl(entry.poster) || "assets/logo.png";
  const title = entry.title || "Unknown Anime";
  const href = `watch.html?id=${encodeURIComponent(entry.id)}&ep=${encodeURIComponent(entry.episode)}`;

  return html`
    <div class="anime-card cw-card" data-history-id="${entry.id}">
      <div class="poster-container">
        <a href="${href}" class="poster-link">
          <img src="${poster}" alt="${title}" class="poster-image">
          <span class="cw-play-overlay"><i class="fas fa-play"></i></span>
        </a>
        <span class="format-badge">EP ${entry.episode}</span>
        <button type="button" class="cw-remove-btn" data-remove-id="${entry.id}" title="Remove from history">
          <i class="fas fa-xmark"></i>
        </button>
        <div class="cw-progress-track">
          <div class="cw-progress-fill" style="width:${progressPercent(entry)}%"></div>
        </div>
      </div>
      <h4 class="card-title"><a href="${href}" title="${title}">${title}</a></h4>
    </div>`;
}

function removeEntry(id, rerender) {
  setWatchHistory(getWatchHistory().filter(item => String(item.id) !== String(id)));
  rerender();
}

export function renderWatchHistory() {
  const container = document.getElementById("history-container");
  if (!container) return;

  const emptyState = document.getElementById("history-empty-state");
  const clearButton = document.getElementById("clear-history-btn");
  const history = getWatchHistory();

  if (history.length === 0) {
    container.innerHTML = "";
    if (emptyState) emptyState.style.display = "flex";
    if (clearButton) clearButton.style.display = "none";
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  if (clearButton) clearButton.style.display = "inline-flex";
  container.innerHTML = history.map(renderHistoryRow).join("");
}

export function renderContinueWatchingHome() {
  const section = document.getElementById("continue-watching-section");
  const container = document.getElementById("continue-watching-container");
  if (!section || !container) return;

  const history = getWatchHistory();
  if (history.length === 0) {
    section.style.display = "none";
    container.innerHTML = "";
    return;
  }

  section.style.display = "block";
  container.innerHTML = history.map(renderContinueWatchingCard).join("");
}

function downloadHistory() {
  const history = getWatchHistory();
  if (history.length === 0) return;

  const data = {
    exportedAt: new Date().toISOString(),
    totalEntries: history.length,
    watchHistory: history.map(entry => ({
      title: entry.title,
      anilistId: entry.id,
      malId: entry.malId ?? null,
      lastEpisodeWatched: entry.episode,
      totalEpisodes: entry.totalEpisodes,
      poster: entry.poster,
      lastWatchedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : null
    }))
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mirai-watch-history-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function importHistory(file) {
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const data = JSON.parse(event.target.result);
      const imported = data.watchHistory || data.animeList || [];

      if (!Array.isArray(imported) || imported.length === 0) {
        alert("No history found in this file.");
        return;
      }

      const current = getWatchHistory();
      const existingIds = new Set(current.map(item => Number(item.id)));
      let addedCount = 0;

      for (const entry of imported) {
        const id = Number.parseInt(entry.anilistId ?? entry.id, 10);
        if (!Number.isFinite(id) || existingIds.has(id)) continue;

        current.push({
          id,
          malId: entry.malId ?? null,
          title: entry.title || "Unknown",
          poster: entry.poster || entry.cover || "",
          episode: entry.lastEpisodeWatched || 1,
          totalEpisodes: entry.totalEpisodes || entry.episodes || null,
          updatedAt: Date.now()
        });
        existingIds.add(id);
        addedCount += 1;
      }

      setWatchHistory(current);
      renderWatchHistory();
      alert(addedCount > 0
        ? `Successfully imported ${addedCount} entries to your history!`
        : "All entries in this file are already in your history.");
    } catch {
      alert("Invalid file. Please upload a valid Mirai history file.");
    }
  };
  reader.readAsText(file);
}

export function initHistory() {
  renderWatchHistory();
  renderContinueWatchingHome();

   
  document.addEventListener("click", event => {
    const historyRemove = event.target.closest(".history-row-remove");
    if (historyRemove) {
      event.preventDefault();
      event.stopPropagation();
      removeEntry(historyRemove.dataset.removeId, renderWatchHistory);
      return;
    }
    const cwRemove = event.target.closest(".cw-remove-btn");
    if (cwRemove) {
      event.preventDefault();
      event.stopPropagation();
      removeEntry(cwRemove.dataset.removeId, renderContinueWatchingHome);
    }
  });

  document.getElementById("clear-history-btn")?.addEventListener("click", () => {
    if (confirm("Clear your entire watch history? This can't be undone.")) {
      setWatchHistory([]);
      renderWatchHistory();
    }
  });

  document.getElementById("download-history-btn")?.addEventListener("click", downloadHistory);

  const uploadButton = document.getElementById("upload-history-btn");
  const uploadInput = document.getElementById("history-upload-input");
  if (uploadButton && uploadInput) {
    uploadButton.addEventListener("click", () => uploadInput.click());
    uploadInput.addEventListener("change", event => {
      if (event.target.files.length > 0) importHistory(event.target.files[0]);
      event.target.value = "";
    });
  }

  const track = document.getElementById("continue-watching-container");
  const prevButton = document.getElementById("cw-prev-btn");
  const nextButton = document.getElementById("cw-next-btn");
  if (track && prevButton && nextButton) {
    const amount = () => Math.round(track.clientWidth * 0.8);
    prevButton.addEventListener("click", () => track.scrollBy({ left: -amount(), behavior: "smooth" }));
    nextButton.addEventListener("click", () => track.scrollBy({ left: amount(), behavior: "smooth" }));
  }
}
