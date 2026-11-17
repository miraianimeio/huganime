/* ==========================================================================
   Anime Music: the starter song list. Every song is a YouTube video.
   Add / remove / reorder entries here, nothing else needs to change.
   (People can also add their own songs on the page with a YouTube link; those are kept in their browser.)

   Every entry:
     id      the 11-character YouTube video id  (the part after  watch?v=  in the link)
     title   song name
     artist  who sings it
     anime   which anime it is from
     type    "op" (opening) | "ed" (ending) | "ost" (soundtrack / insert song)

   Some uploads block embedding on other sites. The page skips a song like that by itself,
   so if one never plays, replace its id with another upload of the same song.
   ========================================================================== */
window.MUSIC_TRACKS = [
  { id: "b_QlWCXBDik", title: "Gurenge",          artist: "LiSA",            anime: "Demon Slayer",      type: "op" },
  { id: "i1P-9IspBus", title: "Kaikai Kitan",     artist: "Eve",             anime: "Jujutsu Kaisen",    type: "op" },
  { id: "4MNbX4MRIFQ", title: "KICK BACK",        artist: "Kenshi Yonezu",   anime: "Chainsaw Man",      type: "op" },
  { id: "bHUcvHx9zlA", title: "Guren no Yumiya",  artist: "Linked Horizon",  anime: "Attack on Titan",   type: "op" },
  { id: "K0GbHoMHXUw", title: "again",            artist: "YUI",             anime: "Fullmetal Alchemist: Brotherhood", type: "op" }
];
