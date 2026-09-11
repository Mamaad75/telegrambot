import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/app/bale.html", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../public/app/app-bale-legacy.js", import.meta.url), "utf8");
const modern = fs.readFileSync(new URL("../public/app/app.js", import.meta.url), "utf8");

test("Bale uses the dedicated legacy-compatible bundle", () => {
  assert.match(html, /app-bale-legacy\.js\?v=2\.4\.13/);
  assert.doesNotMatch(html, /src="\/app\/app\.js\?v=2\.4\.13"/);
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
