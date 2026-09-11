import test from "node:test";
import assert from "node:assert/strict";
import {PLAN_DAYS} from "../src/core/plans.js";
test("trial is seven days",()=>assert.equal(PLAN_DAYS.trial_7d,7));
test("paid durations",()=>assert.deepEqual([PLAN_DAYS.monthly,PLAN_DAYS.quarterly,PLAN_DAYS.semiannual,PLAN_DAYS.annual],[30,90,180,365]));
