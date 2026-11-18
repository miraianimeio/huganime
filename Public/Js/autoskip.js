// autoskip.js: the "Auto Skip" logic for the watch page. It has no DOM code so it can be tested on its own.
//
// Works for MegaPlay players (HD-1 and S-2). They report the playback time to the page with "time" /
// "watching-log" messages (see megaplay.buzz/api). Opening / ending times come from AniSkip (server route /skip-times).
//   - Ending:  when it starts, go to the next episode (when little video is left after it), otherwise ask the
//              player to seek past it.
//   - Opening: ask the player to seek to the end of the opening. MegaPlay documents no command for this, so
//              several common message formats are sent and the result is checked from the time messages that follow.
//              If the player never jumps, Auto Skip tells the viewer once and stops trying on that server.

export const OUTRO_TAIL_LIMIT = 120;   // seconds of video after the ending below which "skip the ending" = next episode
export const VERIFY_MS = 3500;         // how long to wait for the player to jump after a seek command
const INTRO_MARGIN = 10;               // an opening with less than this left is not worth skipping
const MAX_ATTEMPTS = 2;

/** The seek commands that are sent to the player (it accepts at most one of these formats). */
export function seekMessages(time) {
  return [
    { event: "seek", time },
    { type: "seek", time },
    { command: "seek", time },
    { action: "seek", time },
    { method: "seek", value: time },
    { event: "command", func: "seekTo", args: [time, true] },
    { context: "player.js", version: "0.0.11", method: "setCurrentTime", value: time }
  ];
}

/** Reads the player's progress messages: { time, duration } in seconds, or null for any other message. */
export function readPlayerTime(data) {
  if (!data || typeof data !== "object") return null;
  let time;
  let duration;
  if (data.event === "time") {
    time = data.time;
    duration = data.duration;
  } else if (data.type === "watching-log") {
    time = data.currentTime;
    duration = data.duration;
  } else {
    return null;
  }
  if (time === null || time === undefined || time === "") return null;
  time = Number(time);
  duration = Number(duration);
  if (!Number.isFinite(time) || time < 0) return null;
  return { time, duration: Number.isFinite(duration) && duration > 0 ? duration : 0 };
}

/**
 * @param {{
 *   sendSeek: (seconds:number) => void,      // posts the seek commands to the player
 *   goNext: () => void,                      // plays the next episode
 *   hasNext: () => boolean,                  // is there a next episode?
 *   notify?: (text:string) => void,          // short message for the viewer
 *   now?: () => number
 * }} hooks
 */
export function createAutoSkipper({ sendSeek, goNext, hasNext, notify = () => {}, now = () => Date.now() }) {
  const brokenServers = new Set();   // servers whose player ignored our seek commands
  let server = "";
  let times = null;                  // { intro, outro } from AniSkip, null until loaded
  let run = 0;
  let active = false;
  let state = fresh();

  function fresh() {
    return { introDone: false, outroDone: false, pending: null };
  }

  function seek(target, label) {
    state.pending = { target, label, sentAt: now(), attempts: 1 };
    sendSeek(target);
  }

  return {
    get active() { return active; },

    /** Begin watching a new playback. loadTimes() resolves to { intro, outro } (either may be null). */
    start(serverId, loadTimes) {
      const mine = ++run;
      server = serverId;
      active = true;
      times = null;
      state = fresh();
      Promise.resolve()
        .then(loadTimes)
        .then((value) => { if (mine === run) times = value || null; })
        .catch(() => { /* no times: nothing to skip */ });
    },

    stop() {
      run++;
      active = false;
      times = null;
      state = fresh();
    },

    /** Call with every progress message from the player. */
    onTime(time, duration = 0) {
      if (!active || !Number.isFinite(time)) return;
      const s = state;

      // 1) a seek command is out: did the player jump?
      if (s.pending) {
        const p = s.pending;
        if (time >= p.target - 2 && time <= p.target + 90) {
          s.pending = null;                                    // the jump worked: no message, so nothing covers the video
        } else if (now() - p.sentAt >= VERIFY_MS) {
          if (p.attempts < MAX_ATTEMPTS) {
            p.attempts++;
            p.sentAt = now();
            sendSeek(p.target);
          } else {
            s.pending = null;
            brokenServers.add(server);
            notify("Auto Skip could not jump ahead: this player does not accept skip commands from the page.");
          }
        }
        return;
      }
      if (!times) return;

      // 2) the opening
      const { intro, outro } = times;
      if (intro && !s.introDone && time >= Math.max(intro.start - 0.5, 2) && time < intro.end - INTRO_MARGIN) {
        s.introDone = true;
        if (!brokenServers.has(server)) seek(intro.end, "Opening");
        return;
      }

      // 3) the ending
      if (outro && !s.outroDone && time >= outro.start - 0.5 && time < outro.end) {
        s.outroDone = true;
        const tail = duration > 0 ? duration - outro.end : 0;   // video left after the ending
        if (tail <= OUTRO_TAIL_LIMIT) {
          if (hasNext()) goNext();                                // nothing worth watching after it: next episode
        } else if (!brokenServers.has(server) && outro.end - time > INTRO_MARGIN) {
          seek(outro.end, "Ending");                              // a long scene follows the ending
        }
      }
    }
  };
}
