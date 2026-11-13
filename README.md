# HugAnime

```
npm install
npm start
```

Then open http://localhost:3000 (Node 18 or newer).

`npm install` has nothing to download right now (no packages are needed) but it is safe to run, and it
will pull in packages if you add any later. Use `npm run dev` to restart automatically when `server.js` changes.
Change the port with `PORT=4000 npm start` (macOS/Linux) or `set PORT=4000 && npm start` (Windows cmd).

## S-2 server
S-2 needs MegaPlay's own episode id, which `npm start` looks up from the Anikoto catalog (`anikoto.js`, routes `/s2-episode` and `/s2-debug`).
- On the first start the server downloads the whole Anikoto list in the background (about 90 requests, 3 to 4 minutes, it respects the API's rate limit)
  and keeps it in `data/.anikoto-catalog.json`. While that runs, S-2 stays visible but may play the trailer; try again after a few minutes.
  An interrupted download continues where it stopped, and the list is refreshed every 12 hours.
- If one anime still shows the trailer, open `/s2-debug?animeId=<anilistId>&title=<title>` to see why.
  To force a match, create `data/s2-series.json` containing `{ "<anilistId>": <anikotoSeriesId> }` (the series id is the number in `https://anikotoapi.site/series/<id>`).

## Auto Skip (HD-1 and S-2)
Turn on **Auto Skip** under the player. It uses the free AniSkip database (the server fetches it through `/skip-times`, see `aniskip.js`)
and the playback time that the MegaPlay player reports to the page (`Public/Js/autoskip.js`).
- **Ending:** when it starts, the next episode plays (if only a short scene follows it).
- **Opening:** the page asks the player to jump to the end of the opening. MegaPlay documents no command for this, so several common
  message formats are tried and the result is checked. If the player never jumps, a short note says so once and the opening is left alone on that server.
- It needs the anime's MAL id and an entry in AniSkip for that episode; episodes without one are simply left alone. HiLegacy is not supported (its player reports nothing).

## Hiding servers that don't have an episode
`npm start` also runs the availability check at `/server-check`. The watch page uses it to hide servers
(or the whole SUB / DUB row) that don't have the episode you're on. If a check can't be made, the server stays visible.
- On a live host, run `npm start` there as well; the page finds `/server-check` on its own address.
- Some embed sites want a referrer when checked: `REFERER=https://your-site npm start`.
- Opened through another static server (e.g. Live Server) there is no `/server-check`, so only Vidplay and BYFMS can be checked.
