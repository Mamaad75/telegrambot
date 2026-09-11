import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Integration tests run against a REAL PostgreSQL database.
 *
 * They only ever touch the database named by JARCHI_TEST_DATABASE_URL — never
 * DATABASE_URL — because the harness drops and recreates the public schema.
 * Without that variable the integration suites skip and say so.
 */
export const TEST_DATABASE_URL = process.env.JARCHI_TEST_DATABASE_URL || "";
export const databaseAvailable = Boolean(TEST_DATABASE_URL);
export const skipWithoutDatabase = databaseAvailable
  ? false
  : "NOT TESTED: set JARCHI_TEST_DATABASE_URL to a disposable PostgreSQL database to run this suite";

export const TEST_ENV = Object.freeze({
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  PLATFORM_CREDENTIAL_KEY: "test-credential-key-0123456789abcdef",
  ADMIN_BOOTSTRAP_USERNAME: "admin",
  ADMIN_BOOTSTRAP_PASSWORD: "bootstrap-password-1",
  ADMIN_TELEGRAM_ID: "123456789",
  ADMIN_API_TOKEN: "legacy-admin-token-for-tests-000",
  LOG_LEVEL: "error",
  LOG_DIR: "/tmp/jarchi-test-logs",
  PUBLICATION_RETRY_INTERVAL_MS: "3600000",
  EXPIRY_SCAN_INTERVAL_MS: "3600000",
});

/** Drops and rebuilds the test schema, then applies every migration. */
export async function resetDatabase() {
  const { Client } = (await import("pg")).default;
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.end();
  await run(process.execPath, ["src/db/migrate.js"], {
    cwd: ROOT,
    env: { ...process.env, ...TEST_ENV },
  });
}

export async function withPool(fn) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/* ------------------------------------------------------------------ *
 * Local test doubles for external platforms
 * ------------------------------------------------------------------ */

/**
 * A Bale-Bot-API-shaped server on localhost.
 *
 * This exercises the real src/platforms/bale.js adapter over real HTTP. It is
 * a local double, NOT the Bale service: tests using it verify our adapter,
 * error mapping and retry behaviour, not Bale itself.
 */
export async function startBaleDouble() {
  const state = { mode: "ok", requests: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const json = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url.endsWith("/sendMessage")) {
        state.requests.push(JSON.parse(body || "{}"));
        if (state.mode === "fail") return json(502, { ok: false, description: "Bad Gateway from upstream" });
        if (state.mode === "badchat") return json(400, { ok: false, description: "chat not found" });
        return json(200, { ok: true, result: { message_id: 555 } });
      }
      if (req.url.endsWith("/getChat")) {
        if (state.mode === "badchat") return json(400, { ok: false, description: "chat not found" });
        return json(200, { ok: true, result: { id: 12345, title: "Test Channel", type: "channel" } });
      }
      if (req.url.endsWith("/deleteMessage")) return json(200, { ok: true, result: true });
      if (req.url.endsWith("/getMe")) return json(200, { ok: true, result: { id: 1, username: "bale_test_bot" } });
      return json(200, { ok: true, result: {} });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    setMode: (mode) => { state.mode = mode; },
    requests: state.requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Boots src/server.js as a child process and waits for /health. */
export async function startServer(extraEnv = {}) {
  const { spawn } = await import("node:child_process");
  const port = 4000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...TEST_ENV,
      PORT: String(port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`Server did not start in time:\n${logs.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) break;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => { setTimeout(resolve, 150); });
  }

  return {
    baseUrl,
    logs,
    stop: () => new Promise((resolve) => {
      child.on("exit", resolve);
      child.kill("SIGKILL");
    }),
  };
}

/** Minimal fetch wrapper that tracks the session cookie and CSRF token. */
export function createAdminClient(baseUrl) {
  const session = { cookie: "", csrf: "" };

  async function request(method, url, body, options = {}) {
    const headers = { "content-type": "application/json", ...(options.headers || {}) };
    if (session.cookie) headers.cookie = session.cookie;
    if (session.csrf && !["GET", "HEAD"].includes(method)) headers["X-CSRF-Token"] = session.csrf;

    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) session.cookie = setCookie.split(";")[0];

    let data = null;
    try {
      data = await response.json();
    } catch { data = null; }
    return { status: response.status, data, headers: response.headers };
  }

  return {
    session,
    get: (url, options) => request("GET", url, undefined, options),
    post: (url, body, options) => request("POST", url, body, options),
    patch: (url, body, options) => request("PATCH", url, body, options),
    del: (url, body, options) => request("DELETE", url, body, options),
    async login(username = "admin", password = "bootstrap-password-1") {
      const result = await request("POST", "/api/admin/auth/login", { username, password });
      if (result.data?.csrf_token) session.csrf = result.data.csrf_token;
      return result;
    },
    /** Drops the CSRF token to prove the server rejects unprotected writes. */
    dropCsrf() { session.csrf = ""; },
  };
}

/* ------------------------------------------------------------------ *
 * Telegram bot double
 * ------------------------------------------------------------------ */

/**
 * Records what the admin bot would send, so bot behaviour (authorization,
 * navigation, flows) is testable without a live Telegram connection.
 */
export function createBotDouble() {
  const calls = { messages: [], edits: [], answers: [] };
  return {
    calls,
    last: () => calls.messages.at(-1) || calls.edits.at(-1) || null,
    text: () => (calls.edits.at(-1)?.text ?? calls.messages.at(-1)?.text ?? ""),
    async sendMessage(chatId, text, options = {}) {
      calls.messages.push({ chatId: String(chatId), text, options });
      return { message_id: calls.messages.length };
    },
    async editMessageText(text, options = {}) {
      calls.edits.push({ text, options });
      return { message_id: options.message_id };
    },
    async answerCallbackQuery(id, options = {}) {
      calls.answers.push({ id, ...options });
      return true;
    },
    async sendPhoto(chatId, photo, options = {}) {
      calls.messages.push({ chatId: String(chatId), photo, text: options.caption, options });
      return { message_id: calls.messages.length };
    },
  };
}

export const callbackQuery = (data, { fromId = "123456789", chatId = "555", messageId = 1 } = {}) => ({
  id: `cb-${Math.random().toString(36).slice(2)}`,
  data,
  from: { id: fromId },
  message: { chat: { id: chatId }, message_id: messageId },
});

export const message = (text, { fromId = "123456789", chatId = "555" } = {}) => ({
  message_id: Math.floor(Math.random() * 1000),
  text,
  chat: { id: chatId },
  from: { id: fromId, first_name: "Admin" },
});

/**
 * A WooCommerce/WordPress REST double on localhost.
 *
 * Exercises the real src/services/woocommerce.js over real HTTP — auth headers,
 * JSON handling, error mapping, media upload and product creation. It is a
 * local stand-in for a store, not WooCommerce itself: tests using it verify our
 * client and publishing logic, not WooCommerce's behaviour.
 */
export async function startWooCommerceDouble() {
  const state = {
    mode: "ok",
    products: new Map(),
    media: new Map(),
    categories: [{ id: 10, name: "موبایل", slug: "mobile", parent: 0, count: 4 }],
    tags: [{ id: 20, name: "پرفروش", slug: "bestseller", count: 3 }],
    attributes: [{ id: 30, name: "رنگ", slug: "pa_color" }],
    requests: [],
    nextId: 100,
    orders: new Map(),
    // Let a test make the shop refuse a transition, or settle somewhere other
    // than where it was pushed.
    rejectStatus: "",
    forceStatus: "",
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, "http://127.0.0.1");
      const path = url.pathname;
      state.requests.push({ method: req.method, path, auth: req.headers.authorization || "" });

      const json = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (state.mode === "unauthorized") return json(401, { message: "Sorry, you cannot list resources.", code: "woocommerce_rest_cannot_view" });
      if (state.mode === "server_error") return json(503, { message: "Service Unavailable" });
      if (state.mode === "html") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<html><body>maintenance</body></html>");
      }
      if (state.mode === "timeout") return undefined; // never responds

      if (path === "/wp-json/wc/v3/system_status") {
        return json(200, { environment: { version: "9.1.2", wp_version: "6.6", home_url: "https://shop.example.com" }, settings: { currency: "IRT" } });
      }
      if (path === "/wp-json/wc/v3/products/categories") {
        if (req.method === "POST") {
          const payload = JSON.parse(body.toString() || "{}");
          const category = { id: state.nextId += 1, name: payload.name, slug: `c-${state.nextId}` };
          state.categories.push(category);
          return json(201, category);
        }
        return json(200, Number(url.searchParams.get("page") || 1) > 1 ? [] : state.categories);
      }
      if (path === "/wp-json/wc/v3/products/tags") {
        if (req.method === "POST") {
          const payload = JSON.parse(body.toString() || "{}");
          const tag = { id: state.nextId += 1, name: payload.name, slug: `t-${state.nextId}` };
          state.tags.push(tag);
          return json(201, tag);
        }
        return json(200, Number(url.searchParams.get("page") || 1) > 1 ? [] : state.tags);
      }
      if (path === "/wp-json/wc/v3/products/attributes") return json(200, state.attributes);

      if (path === "/wp-json/wp/v2/media" && req.method === "POST") {
        const id = state.nextId += 1;
        state.media.set(id, { id, bytes: body.length, disposition: req.headers["content-disposition"] || "" });
        return json(201, { id, source_url: `https://shop.example.com/wp-content/uploads/${id}.png`, mime_type: req.headers["content-type"] });
      }
      if (path.startsWith("/wp-json/wp/v2/media/")) return json(200, { id: Number(path.split("/").pop()) });

      if (path === "/wp-json/wc/v3/products" && req.method === "POST") {
        const payload = JSON.parse(body.toString() || "{}");
        const id = state.nextId += 1;
        const product = { ...payload, id, permalink: `https://shop.example.com/product/${payload.slug || id}/`, status: payload.status || "draft" };
        state.products.set(id, product);
        return json(201, product);
      }
      if (path === "/wp-json/wc/v3/products" && req.method === "GET") {
        const search = url.searchParams.get("search") || "";
        const matches = [...state.products.values()].filter((product) => JSON.stringify(product.meta_data || []).includes(search));
        return json(200, matches);
      }
      if (path.startsWith("/wp-json/wc/v3/products/")) {
        const id = Number(path.split("/").pop());
        if (req.method === "PUT") {
          const payload = JSON.parse(body.toString() || "{}");
          const updated = { ...(state.products.get(id) || {}), ...payload, id };
          state.products.set(id, updated);
          return json(200, updated);
        }
        const product = state.products.get(id);
        return product ? json(200, product) : json(404, { message: "Invalid ID." });
      }

      /*
       * Orders. The status write-back is the reason this double exists for the
       * order tests: a test that asserts the backend "sent" an update proves
       * nothing, so the shop records what it was actually asked to do and the
       * test reads it back.
       */
      if (path.startsWith("/wp-json/wc/v3/orders/")) {
        const id = Number(path.split("/").pop());
        const existing = state.orders.get(id);

        if (req.method === "PUT") {
          if (!existing) return json(404, { message: "Invalid ID.", code: "woocommerce_rest_shop_order_invalid_id" });

          const payload = JSON.parse(body.toString() || "{}");

          // A shop may refuse a transition, and the backend must report what
          // the shop settled on rather than what it asked for.
          if (state.rejectStatus && payload.status === state.rejectStatus) {
            return json(400, { message: "Order status is not valid.", code: "woocommerce_rest_invalid_order_status" });
          }

          const settled = state.forceStatus || payload.status || existing.status;
          const updated = { ...existing, ...payload, status: settled, id };
          state.orders.set(id, updated);
          return json(200, updated);
        }

        return existing ? json(200, existing) : json(404, { message: "Invalid ID." });
      }

      if (path === "/wp-json/wc/v3/orders" && req.method === "GET") {
        return json(200, [...state.orders.values()]);
      }

      return json(404, { message: "No route was found matching the URL" });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state,
    setMode: (mode) => { state.mode = mode; },
    productCount: () => state.products.size,
    products: () => [...state.products.values()],
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Seeds a customer with an active subscription and an owned site. */
export async function seedCustomer(pool, {
  telegramId = "900000001", planId = "monthly", siteId = "site_ai-shop_test01",
  wordpressUrl = "https://shop.example.com",
} = {}) {
  const user = (await pool.query(
    "INSERT INTO users(display_name, username, status) VALUES($1,$2,'active') RETURNING *",
    ["AI Customer", "aicustomer"],
  )).rows[0];
  await pool.query(
    "INSERT INTO identities(user_id, platform, platform_user_id) VALUES($1,'telegram',$2)",
    [user.id, telegramId],
  );
  await pool.query(
    `INSERT INTO subscriptions(user_id, plan_id, starts_at, expires_at, status, source)
     VALUES($1,$2,NOW()-INTERVAL '1 day', NOW()+INTERVAL '30 days','active','admin')`,
    [user.id, planId],
  );
  const site = (await pool.query(
    `INSERT INTO sites(id, name, wordpress_url, webhook_secret, owner_user_id, enabled)
     VALUES($1,'AI Shop',$2,'jch_test_secret',$3,true) RETURNING *`,
    [siteId, wordpressUrl, user.id],
  )).rows[0];
  const token = `ses_test_${Math.random().toString(36).slice(2)}`;
  const { createHash } = await import("node:crypto");
  await pool.query(
    `INSERT INTO app_sessions(user_id, token_hash, platform, expires_at)
     VALUES($1,$2,'telegram',NOW()+INTERVAL '1 day')`,
    [user.id, createHash("sha256").update(token).digest("hex")],
  );
  return { user, site, token };
}
