# Validation — Jarchi 2.4.4

## Completed in build environment

- `node --check` passed for every `.js`, `.mjs`, and `.cjs` file under `src/`, `public/`, `tests/`, and `tools/`.
- Dependency-free regression tests passed: 8/8.
  - launch/session cookie compatibility assertions
  - fragment-based launch URL assertions
  - generic cross-origin `Script error.` guard
  - read-only effective field state
  - request URL credential redaction
- `package.json`, `package-lock.json`, runtime version source, and Mini App asset cache version are aligned to 2.4.4.
- Build scan confirmed no server IP/password from the review conversation was embedded in the package.

## Integration coverage added

The PostgreSQL integration suite now contains behavioural coverage for:

- legacy session POST exchange -> HttpOnly cookie -> `/api/me` without Bearer authentication
- partial field-platform patches preserving prior platform overrides

Those DB-backed tests require a disposable `JARCHI_TEST_DATABASE_URL`. They were not run against production data.

## Upgrade characteristics

- No new SQL migration is required by 2.4.4.
- Existing `.env` and PostgreSQL data remain compatible.
- Production reverse-proxy trust defaults to `loopback`; `TRUST_PROXY` can override this for non-local proxy topologies.
