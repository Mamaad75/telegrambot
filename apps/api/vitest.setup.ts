/**
 * Unit-test environment.
 *
 * The engine modules are pure, but they sit in a tree that reads configuration at import
 * time. These placeholders let the tree load without a database, a Redis instance, or any
 * provider credentials — which is exactly the point: none of them are required to score a
 * lead, match an opportunity or build a sales brief.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unit:test@127.0.0.1:5432/unit_tests_not_connected';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.JWT_SECRET ??= 'unit-test-secret-0123456789abcdef0123456789abcdef';
process.env.APP_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.LOG_LEVEL ??= 'silent';
