import test from "node:test";
import assert from "node:assert/strict";
import { featureEnabled } from "../src/services/entitlements.js";

test("trial never grants remote features", () => {
  assert.equal(featureEnabled({ is_trial: true, features: { site_control: true } }, "site_control"), false);
});

test("paid plan feature flags grant remote access", () => {
  assert.equal(featureEnabled({ is_trial: false, features: { site_control: true } }, "site_control"), true);
  assert.equal(featureEnabled({ is_trial: false, features: { site_control: false } }, "site_control"), false);
});
