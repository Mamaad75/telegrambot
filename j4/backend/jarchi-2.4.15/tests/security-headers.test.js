import test from "node:test";
import assert from "node:assert/strict";
import { applySecurityHeaders, isBaleFrameEntry } from "../src/utils/securityHeaders.js";

function fakeResponse() {
  const headers = new Map();
  return {
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    removeHeader(name) { headers.delete(String(name).toLowerCase()); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
  };
}

test("Bale can frame the proven main Mini App entry only when platform=bale", () => {
  for (const req of [
    { path: "/app/", query: { platform: "bale" } },
    { path: "/app", originalUrl: "/app?platform=bale&session=redacted" },
    { path: "/app/index.html", query: { platform: "bale" } },
    { path: "/app/bale.html" }, // legacy buttons remain usable
  ]) {
    assert.equal(isBaleFrameEntry(req), true);
    const res = fakeResponse();
    applySecurityHeaders(req, res);
    assert.equal(res.getHeader("x-frame-options"), undefined);
    const csp = res.getHeader("content-security-policy");
    assert.match(csp, /^frame-ancestors /);
    assert.match(csp, /https:\/\/web\.bale\.ai/);
    assert.match(csp, /frame-src https:\/\/\*\.bale\.ai/);
  }
});

test("normal Jarchi and Telegram pages remain non-frameable", () => {
  for (const req of [
    { path: "/" },
    { path: "/app/" },
    { path: "/app/", query: { platform: "telegram" } },
    { path: "/admin/" },
    { path: "/health" },
  ]) {
    const res = fakeResponse();
    applySecurityHeaders(req, res);
    assert.equal(res.getHeader("x-frame-options"), "DENY");
    assert.equal(res.getHeader("content-security-policy"), "frame-ancestors 'none'");
  }
});
