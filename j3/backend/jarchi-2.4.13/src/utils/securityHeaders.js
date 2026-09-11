const BALE_FRAME_ANCESTORS = [
  "https://web.bale.ai",
  "https://bale.ai",
  "https://*.bale.ai",
  "https://bale.sh",
  "https://*.bale.sh",
].join(" ");

function requestPath(req) {
  return String(req?.path || req?.originalUrl || "").split("?", 1)[0];
}

function requestPlatform(req) {
  const direct = String(req?.query?.platform || "").trim().toLowerCase();
  if (direct) return direct;
  try {
    const raw = String(req?.originalUrl || "");
    const qs = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
    return String(new URLSearchParams(qs).get("platform") || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

export function isBaleFrameEntry(req) {
  const path = requestPath(req);
  if (path === "/app/bale.html") return true; // legacy 2.4.6-2.4.9 buttons
  return requestPlatform(req) === "bale" && ["/app", "/app/", "/app/index.html"].includes(path);
}

export function applySecurityHeaders(req, res) {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // Bale Web renders Mini Apps in a cross-origin frame. A global
  // X-Frame-Options: DENY makes the Bale desktop/web client show a generic
  // broken-document page before Jarchi JavaScript can run. Only the dedicated
  // Bale entry point is frameable, and only by official Bale origins.
  if (isBaleFrameEntry(req)) {
    if (typeof res.removeHeader === "function") res.removeHeader("X-Frame-Options");
    res.setHeader(
      "Content-Security-Policy",
      `frame-ancestors ${BALE_FRAME_ANCESTORS}; frame-src https://*.bale.ai https://bale.ai https://*.bale.sh https://bale.sh`,
    );
    return;
  }

  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
}

export { BALE_FRAME_ANCESTORS };
