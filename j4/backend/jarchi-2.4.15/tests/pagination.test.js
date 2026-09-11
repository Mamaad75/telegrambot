import test from "node:test";
import assert from "node:assert/strict";
import { parsePagination, paginated, Filters } from "../src/utils/pagination.js";

test("pagination defaults and clamps", () => {
  assert.deepEqual(parsePagination({}), { page: 1, pageSize: 25, limit: 25, offset: 0 });
  assert.equal(parsePagination({ page: 3, page_size: 10 }).offset, 20);
  // Hostile input cannot request an unbounded page.
  assert.equal(parsePagination({ page_size: 100000 }).pageSize, 200);
  assert.equal(parsePagination({ page_size: 0 }).pageSize, 1);
  assert.equal(parsePagination({ page: -5 }).page, 1);
  assert.equal(parsePagination({ page: "abc" }).page, 1);
  assert.equal(parsePagination({ page_size: "abc" }).pageSize, 25);
});

test("pagination metadata describes the window", () => {
  const result = paginated([1, 2], 57, { page: 2, pageSize: 25 });
  assert.deepEqual(result.pagination, {
    page: 2, page_size: 25, total: 57, pages: 3, has_next: true, has_previous: true,
  });
  assert.deepEqual(paginated([], 0, { page: 1, pageSize: 25 }).pagination.pages, 1);
});

test("filters build parameterized SQL only", () => {
  const filters = new Filters();
  filters.add("site_id = ?", "site_x").add("status = ?", undefined).add("platform = ?", "");
  assert.equal(filters.where(), "WHERE site_id = $1");
  assert.deepEqual(filters.params, ["site_x"]);

  const injection = new Filters();
  injection.add("post_id = ?", "1'; DROP TABLE publications;--");
  assert.equal(injection.where(), "WHERE post_id = $1");
  assert.deepEqual(injection.params, ["1'; DROP TABLE publications;--"]);
});

test("empty filters produce no WHERE clause", () => {
  assert.equal(new Filters().where(), "");
});
