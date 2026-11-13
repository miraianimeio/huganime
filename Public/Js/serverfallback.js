// serverfallback.js: which servers the watch page shows, and which one to switch to. No DOM code, so it can be tested on its own.

/**
 * Is this server (in this language) shown?
 * A server is hidden only when its check answered exactly `false` (null / unknown stays visible).
 * If every check says false, everything is shown, in case the checks themselves are wrong.
 * Servers that need a lookup (S-2) stay hidden until that lookup has answered, so they never flash in and out.
 */
export function isUsable(availability, serverId, language, { lookupServers = new Set() } = {}) {
  const values = Object.values(availability);
  if (values.length && values.every((v) => v === false)) return true;
  const key = `${serverId}:${language}`;
  if (lookupServers.has(serverId) && !(key in availability)) return false;
  return availability[key] !== false;
}

/**
 * The server to switch to when the current one is not usable (or just failed): a server that CONFIRMED it has the
 * episode first (same language, then the other), and only then one that could merely not be checked.
 * Servers in `failed` (their player reported an error for this episode) are never picked again.
 * Returns { server, language } or null.
 */
export function pickFallback({ servers, language, availability, failed = new Set(), keyOf = (id, lang) => `${id}:${lang}`, lookupServers }) {
  const usable = (id, lang) => isUsable(availability, id, lang, { lookupServers }) && !failed.has(keyOf(id, lang));
  const confirmed = (id, lang) => availability[`${id}:${lang}`] === true;
  const order = [language, language === "sub" ? "dub" : "sub"];
  for (const strict of [true, false]) {
    for (const lang of order) {
      const next = servers.find((server) => usable(server.id, lang) && (!strict || confirmed(server.id, lang)));
      if (next) return { server: next.id, language: lang };
    }
  }
  return null;
}
