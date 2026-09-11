/** Redacts credentials from request URLs before they reach logs/audit metadata. */
const SENSITIVE_QUERY_KEY = /(^|_)(session|token|secret|password|api_key|access_key|authorization|code)(_|$)/i;

export function safeRequestPath(input = "") {
  const raw = String(input || "");
  try {
    const url = new URL(raw, "http://jarchi.local");
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    const query = url.searchParams.toString();
    return `${url.pathname}${query ? `?${query}` : ""}${url.hash || ""}`;
  } catch {
    // A malformed URL should never make logging fail. Dropping its query is the
    // safe fallback because query strings are where bearer-style launch secrets live.
    return raw.split("?", 1)[0] || "/";
  }
}
