import crypto from "node:crypto";

export const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export const randomSecret = (prefix) => `${prefix || "jch"}_${crypto.randomBytes(32).toString("base64url")}`;

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length !== right.length) {
    // Still compare something of equal length so the timing does not leak length.
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function encryptText(plain, secret) {
  if (!secret || secret.length < 16) throw new Error("PLATFORM_CREDENTIAL_KEY is not configured");
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptText(payload, secret) {
  const [iv, tag, data] = String(payload).split(".");
  const key = crypto.createHash("sha256").update(secret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString();
}

/* ------------------------------------------------------------------ *
 * Admin passwords
 * ------------------------------------------------------------------ */

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64 });

export function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  if (String(password || "").length < 10) throw new Error("Password must be at least 10 characters");
  const derived = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${derived.toString("base64url")}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, expected] = parts;
  try {
    const derived = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return safeEqual(derived.toString("base64url"), expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Privacy helpers
 * ------------------------------------------------------------------ */

/** `1234567890:AA…` -> `1234…AA12` for display in admin surfaces. */
export function maskSecret(value, visible = 4) {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (raw.length <= visible * 2) return "•".repeat(raw.length);
  return `${raw.slice(0, visible)}${"•".repeat(Math.min(12, raw.length - visible * 2))}${raw.slice(-visible)}`;
}

/** `09121234567` -> `0912•••4567`. Never widen this without a policy change. */
export function maskPhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return "•".repeat(raw.length);
  return `${digits.slice(0, 4)}${"•".repeat(digits.length - 8)}${digits.slice(-4)}`;
}
