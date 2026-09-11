import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/app/bale.html", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../public/app/app-bale-legacy.js", import.meta.url), "utf8");
const modern = fs.readFileSync(new URL("../public/app/app.js", import.meta.url), "utf8");
const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Bale uses the dedicated legacy-compatible bundle", () => {
  // Pinned to the shipped version rather than a literal: a bundle served from a
  // stale cache-buster is the same outage as not shipping the fix at all.
  assert.ok(html.includes(`app-bale-legacy.js?v=${version}`), `bale.html must load app-bale-legacy.js?v=${version}`);
  assert.doesNotMatch(html, /src="\/app\/app\.js\?v=/);
});

test("legacy bundle starts Jarchi and strips modern parse syntax", () => {
  assert.match(legacy, /__JARCHI_APP_STARTED__/);
  assert.doesNotMatch(legacy, /\?\./);
  assert.doesNotMatch(legacy, /\?\?/);
  assert.doesNotMatch(legacy, /=>/);
  assert.doesNotMatch(legacy, /\bconst\s/);
  assert.doesNotMatch(legacy, /\blet\s/);
});

test("legacy bundle includes required runtime polyfills", () => {
  assert.match(legacy, /String\.prototype\.replaceAll/);
  assert.match(legacy, /Object\.fromEntries/);
  assert.match(legacy, /crypto\.randomUUID/);
});

test("Telegram modern bundle remains untouched in behavior marker", () => {
  assert.match(modern, /window\.__JARCHI_APP_STARTED__ = true/);
});

/*
 * The bundle is a transpile of app.js, not a separate app, and it went stale
 * once already: 2.4.15 added the Orders screen to app.js and Bale kept serving
 * the 2.4.13 build. Top-level names survive downlevelling unchanged, so their
 * absence here means somebody edited app.js without running
 * scripts/build-bale-legacy.mjs.
 */
test("legacy bundle is rebuilt from the current app.js, not left behind", () => {
  for (const marker of ["orderSettingsModal", "ORDER_STATUS_LABELS", "openOrder", "writeField"]) {
    assert.ok(modern.includes(marker), `${marker} should exist in app.js`);
    assert.ok(legacy.includes(marker), `${marker} is missing from app-bale-legacy.js — rebuild it`);
  }
});
