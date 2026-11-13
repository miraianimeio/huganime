 
export function friendlyError(error, action = "load this content") {
  const status = Number(error?.status) || 0;
  const technical = String(error?.message || "").toLowerCase();

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return `You're offline. Reconnect to the internet and try again.`;
  }
  if (status === 404) return "We couldn't find that anime. It may have been removed or renamed.";
  if (status === 429 || technical.includes("too many requests") || technical.includes("rate limit")) {
    return "Anime data is busy right now. Please wait a minute and try again.";
  }
  if (status === 403 || technical.includes("temporarily disabled") || technical.includes("stability issues")) {
    return "Our anime catalog is temporarily unavailable. Please try again shortly.";
  }
  if (technical.includes("timeout") || technical.includes("timed out") || technical.includes("abort")) {
    return `It took too long to ${action}. Check your connection and try again.`;
  }
  if (status >= 500 || technical.includes("unreachable") || technical.includes("failed to fetch")) {
    return `We couldn't ${action} because the service is temporarily unavailable. Please try again.`;
  }
  return `We couldn't ${action}. Please try again.`;
}

export function reportUiError(scope, error) {
  console.error(`[${scope}]`, error);
}
