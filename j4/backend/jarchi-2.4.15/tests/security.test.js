import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, safeEqual, maskSecret, maskPhone, encryptText, decryptText, sha256, randomToken } from "../src/utils/security.js";

const KEY = "test-credential-key-0123456789abcdef";

test("passwords are salted, hashed and verifiable", () => {
  const hash = hashPassword("correct-horse-battery");
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/);
  assert.equal(verifyPassword("correct-horse-battery", hash), true);
  assert.equal(verifyPassword("Correct-horse-battery", hash), false);
  assert.equal(verifyPassword("", hash), false);
});

test("the same password hashes differently every time", () => {
  assert.notEqual(hashPassword("correct-horse-battery"), hashPassword("correct-horse-battery"));
});

test("short passwords are rejected at hashing time", () => {
  assert.throws(() => hashPassword("short"), /at least 10 characters/);
});

test("malformed stored hashes never verify", () => {
  for (const stored of ["", "plaintext", "scrypt$bad", null, undefined]) {
    assert.equal(verifyPassword("whatever", stored), false);
  }
});

test("safeEqual compares without leaking length", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcdef"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual(null, undefined), true);
});

test("credentials round-trip through AES-256-GCM", () => {
  const payload = JSON.stringify({ accessToken: "EAAG...", phoneNumberId: "123" });
  const encrypted = encryptText(payload, KEY);
  assert.doesNotMatch(encrypted, /EAAG/);
  assert.equal(decryptText(encrypted, KEY), payload);
});

test("tampered ciphertext fails authentication instead of decrypting", () => {
  const encrypted = encryptText("secret-value", KEY);
  const [iv, tag, data] = encrypted.split(".");
  const flipped = `${iv}.${tag}.${data.slice(0, -2)}${data.slice(-2) === "aa" ? "bb" : "aa"}`;
  assert.throws(() => decryptText(flipped, KEY));
});

test("a wrong key cannot decrypt", () => {
  const encrypted = encryptText("secret-value", KEY);
  assert.throws(() => decryptText(encrypted, "another-key-0123456789abcdefghij"));
});

test("encryption requires a configured key", () => {
  assert.throws(() => encryptText("x", ""), /PLATFORM_CREDENTIAL_KEY/);
  assert.throws(() => encryptText("x", "tooshort"), /PLATFORM_CREDENTIAL_KEY/);
});

test("masking never reveals the middle of a secret or phone", () => {
  assert.equal(maskPhone("09121234567"), "0912•••4567");
  assert.equal(maskPhone("+98 912 123 4567"), "9891••••4567");
  assert.equal(maskPhone(""), "");
  const masked = maskSecret("jch_abcdefghijklmnopqrstuvwxyz");
  assert.ok(masked.startsWith("jch_"));
  assert.ok(masked.endsWith("wxyz"));
  assert.doesNotMatch(masked, /ghijklmnopqrst/);
});

test("tokens are unique and urlsafe", () => {
  const tokens = new Set(Array.from({ length: 50 }, () => randomToken(32)));
  assert.equal(tokens.size, 50);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(sha256("a"), sha256("a"));
  assert.notEqual(sha256("a"), sha256("b"));
});
