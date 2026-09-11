import { config } from "../config.js";

/**
 * Parses page/page_size from a query object into a safe LIMIT/OFFSET pair.
 * Admin lists are always paginated — no endpoint returns an unbounded set.
 */
export function parsePagination(input = {}, { maxPageSize = config.pagination.maxPageSize } = {}) {
  const page = Math.max(1, Math.trunc(Number(input.page ?? input.p ?? 1)) || 1);
  const requested = Number(input.page_size ?? input.pageSize ?? config.pagination.defaultPageSize);
  const pageSize = Math.min(
    maxPageSize,
    Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : config.pagination.defaultPageSize),
  );
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export function paginated(rows, total, { page, pageSize }) {
  const totalCount = Number(total || 0);
  return {
    items: rows,
    pagination: {
      page,
      page_size: pageSize,
      total: totalCount,
      pages: Math.max(1, Math.ceil(totalCount / pageSize)),
      has_next: page * pageSize < totalCount,
      has_previous: page > 1,
    },
  };
}

/**
 * Small helper that accumulates `WHERE` fragments with positional parameters,
 * so filter handling stays parameterized (never string-interpolated).
 */
export class Filters {
  constructor(params = []) {
    this.clauses = [];
    this.params = [...params];
  }

  add(sql, value) {
    if (value === undefined || value === null || value === "") return this;
    this.params.push(value);
    this.clauses.push(sql.replace("?", `$${this.params.length}`));
    return this;
  }

  addRaw(sql) {
    this.clauses.push(sql);
    return this;
  }

  where(prefix = "WHERE") {
    return this.clauses.length ? `${prefix} ${this.clauses.join(" AND ")}` : "";
  }

  next(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }
}
