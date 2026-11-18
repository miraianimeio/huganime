// AniList data source used by api-client.js (it imports this file as `anilist`).
// Only anime(id) is needed by the watch page; the other catalog calls in api-client.js are not used here.

const API = "https://graphql.anilist.co";

const QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      idMal
      siteUrl
      title { romaji english native }
      synonyms
      bannerImage
      coverImage { extraLarge large medium }
      description(asHtml: false)
      format
      status
      episodes
      duration
      season
      seasonYear
      startDate { year month day }
      endDate { year month day }
      source
      countryOfOrigin
      averageScore
      genres
      tags { name isMediaSpoiler }
      studios { edges { isMain node { name isAnimationStudio } } }
      nextAiringEpisode { episode airingAt }
      streamingEpisodes { title thumbnail }
      airingSchedule(perPage: 100) { nodes { episode airingAt } }
      trailer { id site }
      relations { edges { relationType(version: 2) node { id type format seasonYear startDate { year } averageScore title { romaji english } coverImage { large medium } } } }
      recommendations(perPage: 8, sort: RATING_DESC) { nodes { mediaRecommendation { id type format seasonYear startDate { year } averageScore title { romaji english } coverImage { large medium } } } }
    }
  }`;

const FORMATS = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanText(text) {
  if (!text) return "";
  const doc = new DOMParser().parseFromString(text.replace(/<br\s*\/?>/gi, "\n"), "text/html");
  return doc.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function query(variables) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables })
    });
    if (response.status === 429) {
      await wait(Math.min(Number(response.headers.get("Retry-After")) || 2, 5) * 1000);
      continue;
    }
    if (!response.ok) throw httpError("Request failed (" + response.status + ")", response.status);
    const json = await response.json();
    if (json.errors?.length) {
      const notFound = json.errors.some((e) => e.status === 404);
      throw httpError(json.errors[0].message, notFound ? 404 : 500);
    }
    if (!json.data?.Media) throw httpError("Not found", 404);
    return json.data.Media;
  }
  throw httpError("Too many requests", 429);
}

// Small card shape used by the Related / Recommended lists on the watch page.
function card(n, relation = "") {
  return {
    id: n.id,
    title: window.HugTitle.pick(n.title),
    cover: n.coverImage?.large || n.coverImage?.medium || "",
    format: FORMATS[n.format] || n.format || "",
    year: n.seasonYear || n.startDate?.year || null,
    score: n.averageScore ? n.averageScore / 10 : null,
    relation: relation ? relation.replace(/_/g, " ").toLowerCase() : ""
  };
}

function normalize(m) {
  const next = m.nextAiringEpisode;
  const studios = (m.studios?.edges || []).filter((e) => e.node);
  const main = studios.filter((e) => e.node.isAnimationStudio);

  return {
    id: m.id,
    malId: m.idMal || null,
    url: m.siteUrl,
    title: m.title,
    displayTitle: window.HugTitle.pick(m.title),
    synonyms: m.synonyms || [],
    cover: m.coverImage?.extraLarge || m.coverImage?.large || "",
    coverMedium: m.coverImage?.medium || m.coverImage?.large || "",
    banner: m.bannerImage || "",
    description: cleanText(m.description),
    format: FORMATS[m.format] || m.format || "",
    status: m.status || "",
    episodes: m.episodes || null,
    // episodes that are out right now (not the planned total)
    availableEpisodes:
      m.status === "RELEASING" ? (next ? next.episode - 1 : null)
        : m.status === "NOT_YET_RELEASED" ? 0
          : m.episodes || null,
    duration: m.duration || null,
    season: m.season || "",
    seasonYear: m.seasonYear || m.startDate?.year || null,
    year: m.startDate?.year || m.seasonYear || null,
    startDate: m.startDate || null,
    endDate: m.endDate || null,
    source: m.source || "",
    country: m.countryOfOrigin || "",
    genres: m.genres || [],
    tags: (m.tags || []).filter((t) => !t.isMediaSpoiler).map((t) => t.name),
    studios: (main.length ? main : studios.filter((e) => e.isMain)).map((e) => e.node.name),
    score: m.averageScore ? m.averageScore / 10 : null,
    scores: { anilist: m.averageScore ? (m.averageScore / 10).toFixed(1) : null, mal: null },
    streamingEpisodes: (m.streamingEpisodes || []).map((e) => ({ title: e.title || "", thumbnail: e.thumbnail || "" })),
    airingSchedule: (m.airingSchedule?.nodes || []).map((e) => ({ episode: e.episode, airingAt: e.airingAt })),
    nextAiring: next ? { episode: next.episode, airingAt: next.airingAt } : null,
    trailer: m.trailer || null,
    characters: [],
    related: (m.relations?.edges || []).filter((e) => e.node?.type === "ANIME").map((e) => card(e.node, e.relationType)),
    recommendations: (m.recommendations?.nodes || []).map((n) => n.mediaRecommendation).filter((n) => n?.type === "ANIME").map((n) => card(n)),
    malStats: null
  };
}

export async function anime(id) {
  return normalize(await query({ id: Number(id) }));
}
