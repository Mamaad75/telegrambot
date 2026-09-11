import crypto from "node:crypto";

/**
 * Validates Bale Mini App initData.
 *
 * Bale exposes a signed initData string to Mini Apps. The current Bale
 * ecosystem documents the same Bot-API-style initData contract and the
 * X-Bale-Init-Data header for server-side verification.
 */
export function validateBaleInitData(initData, botToken, maxAgeSeconds = 3600) {
  if (!botToken) throw new Error("Bale bot token is not configured");

  const p = new URLSearchParams(String(initData || ""));
  const hash = p.get("hash");
  if (!hash) throw new Error("Missing Bale hash");

  const authDate = Number(p.get("auth_date") || 0);
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isFinite(authDate) || authDate <= 0 || age < 0 || age > maxAgeSeconds) {
    throw new Error("Bale initData expired");
  }

  p.delete("hash");

  const dataCheckString = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const expected = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  if (
    expected.length !== hash.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))
  ) {
    throw new Error("Bale initData signature invalid");
  }

  let user = {};
  try {
    user = JSON.parse(p.get("user") || "{}");
  } catch {
    throw new Error("Bale initData user payload invalid");
  }

  if (!user?.id) throw new Error("Bale initData user is missing");

  return user;
}
