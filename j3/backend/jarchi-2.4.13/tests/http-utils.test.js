import test from "node:test";
import assert from "node:assert/strict";
import { safeRequestPath } from "../src/utils/http.js";

test("request logging redacts launch credentials but preserves useful routing", () => {
  const path = safeRequestPath("/app/?session=ses_secret&platform=telegram&tab=tickets");
  assert.doesNotMatch(path, /ses_secret/);
  assert.match(path, /session=%5BREDACTED%5D/);
  assert.match(path, /platform=telegram/);
  assert.match(path, /tab=tickets/);
});

test("request logging redacts common secret-like query keys", () => {
  const path = safeRequestPath("/x?access_token=a&webhook_secret=b&q=ok");
  assert.doesNotMatch(path, /access_token=a|webhook_secret=b/);
  assert.match(path, /q=ok/);
});
