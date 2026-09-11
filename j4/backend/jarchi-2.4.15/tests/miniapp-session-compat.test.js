import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("legacy session query compatibility and safe cookie exchange are preserved", () => {
  const auth = fs.readFileSync(new URL("../src/middleware/customerAuth.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app/app.js", import.meta.url), "utf8");
  assert.match(auth, /req\.query\?\.session/);
  assert.match(auth, /req\.body\?\.session/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /SameSite=Lax/);
  assert.match(app, /establishSession/);
  assert.match(app, /omitSessionBearer:\s*true/);
  assert.doesNotMatch(auth, /token !== bearer/);
  assert.match(auth, /token === querySession \|\| token === bodySession/);
  assert.match(app, /BOOT_WATCHDOG/);
});

test("Bale /panel prefers the server-minted session while direct launches still support initData", () => {
  const app = fs.readFileSync(new URL("../public/app/app.js", import.meta.url), "utf8");
  const auth = fs.readFileSync(new URL("../src/middleware/customerAuth.js", import.meta.url), "utf8");
  assert.match(app, /platform === "bale" \? \(bale\?\.initData \|\| ""\)/);
  assert.match(app, /if \(initData && platform === "bale"\) headers\["X-Bale-Init-Data"\] = initData/);
  assert.match(app, /if \(platform === "bale" && sessionToken\)/);
  assert.match(app, /exchangeLaunchSession\(\{ keepBearer: true \}\)/);
  assert.match(app, /if \(sessionToken && !omitSessionBearer\) headers\.authorization/);
  assert.match(auth, /SameSite=Lax/);
});



test("Telegram keeps its loader while Bale SDK is first but non-blocking", () => {
  const html = fs.readFileSync(new URL("../public/app/index.html", import.meta.url), "utf8");
  const baleHtml = fs.readFileSync(new URL("../public/app/bale.html", import.meta.url), "utf8");
  const loader = fs.readFileSync(new URL("../public/app/sdk-loader.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /tapi\.bale\.ai\/miniapp\.js/);
  assert.ok(html.includes(`sdk-loader.js?v=${version}`), `index.html must load sdk-loader.js?v=${version}`);
  assert.match(loader, /script\.async = true/);
  const sdkPos = baleHtml.indexOf('https://tapi.bale.ai/miniapp.js?3');
  const themeScriptPos = baleHtml.indexOf('(function ()');
  const appScriptPos = baleHtml.indexOf(`/app/app-bale-legacy.js?v=${version}`);
  assert.ok(sdkPos >= 0 && sdkPos < themeScriptPos && sdkPos < appScriptPos);
  assert.match(baleHtml.slice(baleHtml.lastIndexOf('<script', sdkPos), baleHtml.indexOf('</script>', sdkPos) + 9), /\basync\b/i);
  assert.doesNotMatch(baleHtml, /sdk-loader\.js/);
  assert.match(app, /signalPlatformReady/);
  assert.match(app, /sdk\.ready\?\.\(\)/);
});

test("Bale does not mutate browser history or persist the fallback launch token", () => {
  const app = fs.readFileSync(new URL("../public/app/app.js", import.meta.url), "utf8");
  assert.match(app, /if \(platform === "bale"\)/);
  assert.match(app, /do not mutate history\/sessionStorage/);
  assert.match(app, /if \(platform !== "bale"\)/);
});

test("Telegram keeps fragment launch tokens while Bale uses its dedicated canonical entry", () => {
  const telegram = fs.readFileSync(new URL("../src/bot/customer.js", import.meta.url), "utf8");
  const bale = fs.readFileSync(new URL("../src/bot/bale.js", import.meta.url), "utf8");
  const admin = fs.readFileSync(new URL("../src/bot/admin/index.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app/app.js", import.meta.url), "utf8");
  assert.match(telegram, /\?platform=telegram#session=/);
  assert.match(bale, /\/app\/bale\.html\?platform=bale&session=/);
  assert.match(admin, /\?platform=telegram#session=/);
  assert.match(app, /params\.get\("session"\)/);
  assert.match(app, /hashParams\.get\("session"\)/);
});

test("Bale dedicated entry is a real Mini App document with SDK first", () => {
  const baleHtml = fs.readFileSync(new URL("../public/app/bale.html", import.meta.url), "utf8");
  const bale = fs.readFileSync(new URL("../src/bot/bale.js", import.meta.url), "utf8");
  assert.match(bale, /\/app\/bale\.html\?platform=bale&session=/);
  assert.match(baleHtml, /https:\/\/tapi\.bale\.ai\/miniapp\.js\?3/);
  assert.ok(baleHtml.includes(`/app/app-bale-legacy.js?v=${version}`), `bale.html must load the ${version} bundle`);
  assert.match(baleHtml, /<script[^>]*async[^>]*tapi\.bale\.ai\/miniapp\.js\?3/i);
  assert.doesNotMatch(baleHtml, /location\.replace/);
});

test("Customer auth accepts initData from a JSON request body", () => {
  const auth = fs.readFileSync(new URL("../src/middleware/customerAuth.js", import.meta.url), "utf8");
  assert.match(auth, /if \(telegramInit \|\| baleInit \|\| bodyInit\)/);
});


test("generic cross-origin Script error does not replace Mini App bootstrap", () => {
  const app = fs.readFileSync(new URL("../public/app/app.js", import.meta.url), "utf8");
  assert.ok(app.includes("^script error\\.?$/i.test(rawMessage)"));
  assert.match(app, /if \(!event\?\.error/);
});

test("customer field API returns effective routing state for read-only screens", () => {
  const api = fs.readFileSync(new URL("../src/routes/api.js", import.meta.url), "utf8");
  assert.match(api, /effective_platforms: field\.effective_platforms/);
  assert.match(api, /effective_label: field\.effective_label/);
});


test("Bale SDK cannot parser-block Jarchi and /panel session wins over initData", () => {
  const baleHtml = fs.readFileSync(new URL("../public/app/bale.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app/app.js", import.meta.url), "utf8");
  const firstScript = baleHtml.match(/<script[^>]*>/i)?.[0] || "";
  assert.match(firstScript, /tapi\.bale\.ai\/miniapp\.js\?3/);
  assert.match(firstScript, /\basync\b/i);
  assert.match(app, /platform === "bale" && sessionToken/);
  assert.match(app, /exchangeLaunchSession\(\{ keepBearer: true \}\)/);
  assert.match(app, /baleAttachTimer = setInterval/);
});
