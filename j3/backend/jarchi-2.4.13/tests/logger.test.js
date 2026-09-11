import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarchi-log-"));
process.env.LOG_DIR = logDir;
process.env.LOG_LEVEL = "debug";
const { logger, flushLogs } = await import("../src/logger.js");

function captured(fn) {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.map((line) => JSON.parse(line));
}

test("secrets are redacted from log context", () => {
  const [entry] = captured(() => logger.info("test", {
    webhook_secret: "jch_supersecret",
    access_token: "EAAG123",
    authorization: "Bearer abc",
    api_key: "key-123",
    password: "hunter2",
    merchant_id: "zarin-merchant",
  }));
  for (const key of ["webhook_secret", "access_token", "authorization", "api_key", "password", "merchant_id"]) {
    assert.equal(entry[key], "[REDACTED]", key);
  }
});

test("phone numbers are masked, not printed", () => {
  const [entry] = captured(() => logger.info("test", {
    contact_phone: "09121234567",
    author: { phone: "+989121234567" },
    has_contact_phone: true,
  }));
  assert.doesNotMatch(JSON.stringify(entry), /09121234567/);
  assert.doesNotMatch(JSON.stringify(entry), /989121234567/);
  assert.equal(entry.has_contact_phone, true);
});

test("nested and array values are redacted too", () => {
  const [entry] = captured(() => logger.info("test", {
    connections: [{ credentials: "abc", platform: "whatsapp" }],
    nested: { deep: { token: "abc123" } },
  }));
  assert.equal(entry.connections[0].credentials, "[REDACTED]");
  assert.equal(entry.connections[0].platform, "whatsapp");
  assert.equal(entry.nested.deep.token, "[REDACTED]");
});

test("errors are serialized with name, message and stack", () => {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(line);
  try {
    logger.error("boom", { error: new Error("something failed") });
  } finally {
    console.error = original;
  }
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.error.name, "Error");
  assert.equal(entry.error.message, "something failed");
  assert.ok(entry.error.stack.includes("Error: something failed"));
});

test("log level filtering is applied", () => {
  const entries = captured(() => logger.debug("visible at debug", {}));
  assert.equal(entries.length, 1);
});

test("entries are also written to the log file", async () => {
  logger.info("file write check", { marker: "jarchi-file-test" });
  await flushLogs();
  const contents = fs.readFileSync(path.join(logDir, "jarchi.log"), "utf8");
  assert.match(contents, /jarchi-file-test/);
});
