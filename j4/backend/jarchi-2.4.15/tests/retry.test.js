import test from "node:test";
import assert from "node:assert/strict";
import { backoffMs } from "../src/services/retry.js";
import { PlatformError, ERROR_CATEGORIES, isRetryableError, categorizeHttpStatus, categorizeThrown } from "../src/platforms/errors.js";

test("backoff grows exponentially and stays under the ceiling", () => {
  const options = { baseDelayMs: 1000, maxDelayMs: 60000 };
  const first = backoffMs(1, options);
  const second = backoffMs(2, options);
  const tenth = backoffMs(10, options);

  assert.ok(first >= 1000 && first < 1400, `first=${first}`);
  assert.ok(second >= 2000 && second < 2800, `second=${second}`);
  assert.ok(tenth >= 60000 && tenth <= 90000, `tenth=${tenth}`);
});

test("backoff is bounded for absurd attempt counts", () => {
  const value = backoffMs(1000, { baseDelayMs: 60000, maxDelayMs: 3600000 });
  assert.ok(Number.isFinite(value));
  assert.ok(value <= 3600000 * 1.2);
});

test("only transport-class failures are retryable", () => {
  const retryable = [ERROR_CATEGORIES.TIMEOUT, ERROR_CATEGORIES.NETWORK, ERROR_CATEGORIES.RATE_LIMITED, ERROR_CATEGORIES.SERVER_ERROR];
  for (const category of retryable) {
    assert.equal(isRetryableError(new PlatformError("x", { category })), true, category);
  }
  const permanent = [ERROR_CATEGORIES.AUTH, ERROR_CATEGORIES.CONFIG, ERROR_CATEGORIES.NOT_FOUND, ERROR_CATEGORIES.INVALID_REQUEST, ERROR_CATEGORIES.UNSUPPORTED];
  for (const category of permanent) {
    assert.equal(isRetryableError(new PlatformError("x", { category })), false, category);
  }
});

test("unclassified errors are never retried blindly", () => {
  assert.equal(isRetryableError(new Error("kaboom")), false);
  assert.equal(isRetryableError(null), false);
});

test("HTTP statuses map to the right categories", () => {
  assert.equal(categorizeHttpStatus(429), ERROR_CATEGORIES.RATE_LIMITED);
  assert.equal(categorizeHttpStatus(500), ERROR_CATEGORIES.SERVER_ERROR);
  assert.equal(categorizeHttpStatus(503), ERROR_CATEGORIES.SERVER_ERROR);
  assert.equal(categorizeHttpStatus(404), ERROR_CATEGORIES.NOT_FOUND);
  assert.equal(categorizeHttpStatus(401), ERROR_CATEGORIES.AUTH);
  assert.equal(categorizeHttpStatus(400, "Bad Request: message text is empty"), ERROR_CATEGORIES.INVALID_REQUEST);
  // A missing channel is a configuration problem, whichever status it arrives as.
  assert.equal(categorizeHttpStatus(400, "Bad Request: chat not found"), ERROR_CATEGORIES.CONFIG);
  assert.equal(categorizeHttpStatus(403, "bot was kicked from the channel chat"), ERROR_CATEGORIES.CONFIG);
});

test("thrown transport errors are categorized", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(categorizeThrown(abort), ERROR_CATEGORIES.TIMEOUT);
  assert.equal(categorizeThrown(new Error("fetch failed")), ERROR_CATEGORIES.NETWORK);
  assert.equal(categorizeThrown(new Error("connect ECONNREFUSED 127.0.0.1:80")), ERROR_CATEGORIES.NETWORK);
  assert.equal(categorizeThrown(new Error("BALE_BOT_TOKEN is not configured")), ERROR_CATEGORIES.CONFIG);
});

test("retryAfter from a rate limit is preserved for scheduling", () => {
  const error = new PlatformError("Too Many Requests", { category: ERROR_CATEGORIES.RATE_LIMITED, retryAfterMs: 30000 });
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterMs, 30000);
});
