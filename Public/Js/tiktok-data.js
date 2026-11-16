/* ==========================================================================
   TikTok Mode: the list of videos.
   Add / remove / reorder entries here, nothing else needs to change.

   Every entry:
     id        unique text, e.g. "clip-001"         (used to remember likes, saves, comments)
     src       video file or URL (.mp4 / .webm). Leave "" and a placeholder card shows instead.
     poster    optional image shown before the video starts
     user      creator name, shown as @user
     avatar    optional image URL for the creator's round picture (a coloured letter shows if empty)
     caption   the text under the name
     tags      list of hashtags without the #
     sound     the "sound" line at the bottom (song / original sound)
     likes, comments, shares   starting numbers
     anime     { id: <AniList id>, title: "..." }  - when id is set a "Watch full anime" button appears
     hue       placeholder colour (0-360), only used while there is no video

   The sample entries below are placeholders so the page has something to show.
   ========================================================================== */
window.TIKTOK_VIDEOS = [
  {
    id: "clip-001",
    src: "",
    poster: "",
    user: "hug.clips",
    avatar: "",
    caption: "Best opening of the season? Tell me I'm wrong.",
    tags: ["anime", "opening", "fyp"],
    sound: "Original sound - hug.clips",
    likes: 12400, comments: 342, shares: 98,
    anime: { id: 21, title: "One Piece" },
    hue: 195
  },
  {
    id: "clip-002",
    src: "",
    poster: "",
    user: "senpai.daily",
    avatar: "",
    caption: "That fight scene was unreal.",
    tags: ["anime", "fight", "amv"],
    sound: "Epic Battle Theme - senpai.daily",
    likes: 8800, comments: 210, shares: 64,
    anime: { id: null, title: "Action Pick" },
    hue: 345
  },
  {
    id: "clip-003",
    src: "",
    poster: "",
    user: "cozy.anime",
    avatar: "",
    caption: "Comfort anime for a rainy day.",
    tags: ["cozy", "slice of life"],
    sound: "Lo-fi Rain - cozy.anime",
    likes: 5200, comments: 120, shares: 40,
    anime: { id: null, title: "Slice of Life Pick" },
    hue: 150
  },
  {
    id: "clip-004",
    src: "",
    poster: "",
    user: "isekai.hub",
    avatar: "",
    caption: "POV: you just got summoned to another world.",
    tags: ["isekai", "pov"],
    sound: "Original sound - isekai.hub",
    likes: 20100, comments: 780, shares: 310,
    anime: { id: null, title: "Isekai Pick" },
    hue: 265
  },
  {
    id: "clip-005",
    src: "",
    poster: "",
    user: "romcom.vibes",
    avatar: "",
    caption: "The confession scene we all waited for.",
    tags: ["romance", "anime", "edit"],
    sound: "Heartbeat Remix - romcom.vibes",
    likes: 15600, comments: 540, shares: 150,
    anime: { id: null, title: "Romance Pick" },
    hue: 20
  }
];
