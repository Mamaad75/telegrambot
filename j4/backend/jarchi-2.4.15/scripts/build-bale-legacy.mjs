#!/usr/bin/env node
/**
 * Rebuilds public/app/app-bale-legacy.js from public/app/app.js.
 *
 * Bale's WebView engine on older Android builds fails to *parse* optional
 * chaining and arrow functions, so it never reaches Jarchi's first statement.
 * Telegram gets the modern bundle; Bale gets this ES5 transpile of the same
 * source, which is why the two must never drift.
 *
 * The recipe was previously undocumented, and app.js changed in 2.4.15 without
 * the bundle following it. Writing it down here is the fix: run this after any
 * change to app.js, and the two stay the same app.
 *
 *   npx --yes typescript@5 >/dev/null 2>&1   # tsc 6 removed --target es5
 *   node scripts/build-bale-legacy.mjs
 *
 * TypeScript is not a runtime dependency and is deliberately not in
 * package.json: nothing in production transpiles anything.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicApp = fileURLToPath(new URL("../public/app/", import.meta.url));
const source = path.join(publicApp, "app.js");
const target = path.join(publicApp, "app-bale-legacy.js");

/**
 * The polyfills the transpiled output assumes but ES5 engines lack.
 *
 * Kept verbatim from the existing bundle rather than regenerated, because it is
 * handwritten: tsc downlevels syntax, not library methods.
 */
const PRELUDE_LINES = 29;

if (!fs.existsSync(target)) {
  throw new Error(`${target} is missing; the prelude lives there and cannot be regenerated.`);
}

const prelude = fs.readFileSync(target, "utf8").split("\n").slice(0, PRELUDE_LINES).join("\n");

if (!prelude.includes("String.prototype.replaceAll")) {
  throw new Error("The first 29 lines of the bundle are not the polyfill prelude; refusing to overwrite it.");
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "jarchi-bale-"));

try {
  fs.copyFileSync(source, path.join(work, "app.js"));

  // downlevelIteration matters: without it tsc spreads a NodeList with a plain
  // slice, which is empty in the engines this bundle exists for.
  execFileSync("npx", [
    "--yes", "typescript@5", "tsc",
    "--allowJs", "--target", "es5", "--downlevelIteration",
    "--skipLibCheck", "--lib", "es5,dom,scripthost,es2015.iterable",
    "--outDir", path.join(work, "out"),
    path.join(work, "app.js"),
  ], { stdio: "inherit" });

  const body = fs.readFileSync(path.join(work, "out", "app.js"), "utf8");

  for (const [label, pattern] of [
    ["optional chaining", /\?\./], ["nullish coalescing", /\?\?/],
    ["arrow function", /=>/], ["const", /\bconst\s/], ["let", /\blet\s/],
  ]) {
    if (pattern.test(body)) throw new Error(`Transpiled bundle still contains ${label}; Bale would fail to parse it.`);
  }

  fs.writeFileSync(target, `${prelude}\n${body}`);
  process.stdout.write(`wrote ${target}\n`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
