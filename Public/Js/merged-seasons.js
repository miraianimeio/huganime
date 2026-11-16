// merged-seasons.js: anime that AniList splits into several entries but HugAnime shows as ONE (one episode list).
//
//   "<main AniList id>": { parts: [ { id: <AniList id>, malId: <MAL id>, episodes: <how many episodes this part has> }, ... ] }
//
// The first part is the main entry (its page and title are used). Episodes are numbered straight through:
// Season 3 (12) + Season 3 Part 2 (10) = episodes 1-22. Each episode is looked up on the servers with its own part's
// ids and its number inside that part (e.g. episode 14 = Part 2, episode 2). Opening a later part's old address
// (e.g. /watch?id=104578&ep=2) goes to the merged page (episode 14).
export const MERGED_SEASONS = {
  99147: {   // Attack on Titan Season 3  +  Season 3 Part 2
    parts: [
      { id: 99147, malId: 35760, episodes: 12 },
      { id: 104578, malId: 38524, episodes: 10 }
    ]
  }
};

// later part id -> the main id that now shows it
export const PART_TO_MAIN = {};
for (const [mainId, { parts }] of Object.entries(MERGED_SEASONS)) {
  for (const part of parts.slice(1)) PART_TO_MAIN[part.id] = Number(mainId);
}
