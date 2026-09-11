import { query } from "../db/db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { encryptText, decryptText, maskSecret } from "../utils/security.js";
import { assertSafeUrl, joinUrl, UnsafeUrlError } from "../utils/safeUrl.js";
import { AiError, AI_ERROR_CODES } from "../ai/errors.js";

/**
 * WooCommerce connection storage and REST access.
 *
 * Credentials belong to the site, are encrypted with PLATFORM_CREDENTIAL_KEY —
 * the same key the rest of the platform already uses — and are decrypted only
 * inside this module, immediately before a request. Nothing here ever returns a
 * secret to a caller: `getConnectionView` is what the API is allowed to show.
 */

const PUBLIC_COLUMNS = `id, site_id, base_url, wp_username, status, last_tested_at,
  last_test_ok, last_test_error, store_info, created_at, updated_at`;

function requireKey() {
  if (!config.credentialKey) {
    throw new AiError(AI_ERROR_CODES.WORDPRESS_AUTH_ERROR, "PLATFORM_CREDENTIAL_KEY is not configured", {
      retryable: false,
      safeMessage: "پیکربندی سرور برای نگهداری امن اطلاعات کامل نیست.",
    });
  }
}

/**
 * Saves or replaces a site's WooCommerce credentials.
 * The base URL is pinned to the hostname already registered for the site, so a
 * customer cannot point the backend at an arbitrary host.
 */
export async function saveConnection(siteId, { baseUrl, consumerKey, consumerSecret, wpUsername = "", wpAppPassword = "", siteWordpressUrl = "", userId = null }) {
  requireKey();

  let expectedHostname = "";
  try {
    if (siteWordpressUrl) expectedHostname = new URL(siteWordpressUrl).hostname.toLowerCase();
  } catch { expectedHostname = ""; }

  let url;
  try {
    url = await assertSafeUrl(baseUrl, {
      allowPrivateHosts: config.woocommerce.allowPrivateHosts,
      expectedHostname,
    });
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      throw new AiError(AI_ERROR_CODES.WORDPRESS_AUTH_ERROR, `Unsafe WooCommerce base URL: ${error.reason}`, {
        retryable: false,
        safeMessage: error.reason === "hostname_mismatch"
          ? "آدرس فروشگاه باید با دامنه ثبت‌شده همین سایت یکی باشد."
          : "آدرس فروشگاه معتبر نیست.",
      });
    }
    throw error;
  }

  if (!consumerKey || !consumerSecret) {
    throw new AiError(AI_ERROR_CODES.WORDPRESS_AUTH_ERROR, "Consumer key and secret are required", {
      retryable: false,
      safeMessage: "کلید و رمز ووکامرس الزامی است.",
    });
  }

  const row = (await query(
    `INSERT INTO woocommerce_connections(
       site_id, base_url, consumer_key_enc, consumer_secret_enc, wp_username, wp_app_password_enc,
       status, created_by_user_id)
     VALUES($1,$2,$3,$4,$5,$6,'active',$7)
     ON CONFLICT(site_id) DO UPDATE SET
       base_url=EXCLUDED.base_url,
       consumer_key_enc=EXCLUDED.consumer_key_enc,
       consumer_secret_enc=EXCLUDED.consumer_secret_enc,
       wp_username=EXCLUDED.wp_username,
       wp_app_password_enc=COALESCE(EXCLUDED.wp_app_password_enc, woocommerce_connections.wp_app_password_enc),
       status='active',
       updated_at=NOW()
     RETURNING ${PUBLIC_COLUMNS}`,
    [
      siteId,
      url.toString().replace(/\/+$/, ""),
      encryptText(String(consumerKey), config.credentialKey),
      encryptText(String(consumerSecret), config.credentialKey),
      String(wpUsername || ""),
      wpAppPassword ? encryptText(String(wpAppPassword), config.credentialKey) : null,
      userId,
    ],
  )).rows[0];

  logger.info("woocommerce connection saved", { site_id: siteId, base_url: row.base_url, user_id: userId });
  return row;
}

/** Internal: the decrypted connection. Never hand this to a route. */
async function loadConnection(siteId) {
  const row = (await query(
    "SELECT * FROM woocommerce_connections WHERE site_id=$1 AND status='active'",
    [siteId],
  )).rows[0];
  if (!row) {
    throw new AiError(AI_ERROR_CODES.WORDPRESS_AUTH_ERROR, `No WooCommerce connection for site ${siteId}`, {
      retryable: false,
      safeMessage: "برای این سایت اتصال ووکامرس ثبت نشده است.",
    });
  }
  requireKey();

  return {
    id: row.id,
    siteId: row.site_id,
    baseUrl: row.base_url,
    consumerKey: decryptText(row.consumer_key_enc, config.credentialKey),
    consumerSecret: decryptText(row.consumer_secret_enc, config.credentialKey),
    wpUsername: row.wp_username || "",
    wpAppPassword: row.wp_app_password_enc ? decryptText(row.wp_app_password_enc, config.credentialKey) : "",
  };
}

/** Safe projection for API responses: status and a masked key hint only. */
export async function getConnectionView(siteId) {
  const row = (await query(
    `SELECT ${PUBLIC_COLUMNS}, consumer_key_enc, wp_app_password_enc FROM woocommerce_connections WHERE site_id=$1`,
    [siteId],
  )).rows[0];
  if (!row) return null;

  const { consumer_key_enc: keyEnc, wp_app_password_enc: passwordEnc, ...safe } = row;
  let keyHint = "";
  try {
    if (config.credentialKey && keyEnc) keyHint = maskSecret(decryptText(keyEnc, config.credentialKey));
  } catch { keyHint = ""; }

  return {
    ...safe,
    consumer_key_hint: keyHint,
    media_upload_configured: Boolean(passwordEnc && row.wp_username),
  };
}

export async function deleteConnection(siteId) {
  const result = await query("DELETE FROM woocommerce_connections WHERE site_id=$1", [siteId]);
  if (result.rowCount) logger.warn("woocommerce connection removed", { site_id: siteId });
  return result.rowCount > 0;
}

/* ------------------------------------------------------------------ *
 * REST access
 * ------------------------------------------------------------------ */

async function request(connection, { method = "GET", path, query: search = {}, body, timeoutMs = config.woocommerce.timeoutMs, auth = "woocommerce" }) {
  const url = new URL(joinUrl(connection.baseUrl, path));
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  // The stored base URL was vetted when saved; re-check on every call so a
  // changed DNS record cannot turn it into an internal address later.
  await assertSafeUrl(url.toString(), { allowPrivateHosts: config.woocommerce.allowPrivateHosts });

  const headers = { Accept: "application/json" };
  if (auth === "woocommerce") {
    const basic = Buffer.from(`${connection.consumerKey}:${connection.consumerSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  } else {
    if (!connection.wpUsername || !connection.wpAppPassword) {
      throw new AiError(AI_ERROR_CODES.WORDPRESS_AUTH_ERROR, "WordPress application password is not configured", {
        retryable: false,
        safeMessage: "برای بارگذاری تصویر، نام کاربری و رمز برنامه وردپرس لازم است.",
      });
    }
    const basic = Buffer.from(`${connection.wpUsername}:${connection.wpAppPassword}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    const init = { method, headers, signal: controller.signal };
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) {
        init.body = body;
      } else {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
    }
    if (body?.__raw) {
      init.body = body.buffer;
      Object.assign(headers, body.headers);
      delete headers["Content-Type"];
      if (body.contentType) headers["Content-Type"] = body.contentType;
    }
    response = await fetch(url, init);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    throw new AiError(
      AI_ERROR_CODES.WOOCOMMERCE_API_ERROR,
      timedOut ? `WooCommerce request timed out after ${timeoutMs}ms` : `WooCommerce request failed: ${error.message}`,
      { retryable: true, cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // A WordPress error page instead of JSON usually means the REST route is
    // blocked or the site is showing a maintenance/redirect page.
    throw new AiError(
      AI_ERROR_CODES.WOOCOMMERCE_API_ERROR,
      `WooCommerce returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
      { retryable: response.status >= 500, safeMessage: "پاسخ ووکامرس معتبر نبود؛ تنظیمات REST سایت را بررسی کنید." },
    );
  }

  if (!response.ok) {
    const detail = payload?.message || `HTTP ${response.status}`;
    if (response.status === 401 || response.status === 403) {
      throw new AiError(AI_ERROR_CODES.WORDPRESS_AUTH_ERROR, `WooCommerce auth failed: ${detail}`, {
        retryable: false,
        safeMessage: "کلیدهای ووکامرس پذیرفته نشد؛ دسترسی خواندن/نوشتن را بررسی کنید.",
      });
    }
    throw new AiError(AI_ERROR_CODES.WOOCOMMERCE_API_ERROR, `WooCommerce error ${response.status}: ${detail}`, {
      retryable: response.status >= 500 || response.status === 429,
      meta: { status: response.status, code: payload?.code },
    });
  }

  return { data: payload, headers: response.headers, status: response.status };
}

/** Verifies credentials and reports what the store looks like. */
export async function testConnection(siteId) {
  const started = Date.now();
  const connection = await loadConnection(siteId);

  try {
    const [system, categories] = await Promise.all([
      request(connection, { path: "wp-json/wc/v3/system_status", query: { _fields: "environment,settings" } })
        .catch(() => ({ data: null })),
      request(connection, { path: "wp-json/wc/v3/products/categories", query: { per_page: 1 } }),
    ]);

    const storeInfo = {
      wc_version: system?.data?.environment?.version || "",
      wp_version: system?.data?.environment?.wp_version || "",
      currency: system?.data?.settings?.currency || "",
      home_url: system?.data?.environment?.home_url || connection.baseUrl,
      categories_reachable: Array.isArray(categories.data),
    };

    await query(
      `UPDATE woocommerce_connections
          SET last_tested_at=NOW(), last_test_ok=true, last_test_error=NULL,
              store_info=$2::jsonb, updated_at=NOW()
        WHERE site_id=$1`,
      [siteId, JSON.stringify(storeInfo)],
    );

    logger.info("woocommerce connection test succeeded", {
      site_id: siteId, duration_ms: Date.now() - started, wc_version: storeInfo.wc_version,
    });
    return { ok: true, store: storeInfo, duration_ms: Date.now() - started };
  } catch (error) {
    const aiError = error instanceof AiError ? error : new AiError(AI_ERROR_CODES.WOOCOMMERCE_API_ERROR, error.message);
    await query(
      `UPDATE woocommerce_connections
          SET last_tested_at=NOW(), last_test_ok=false, last_test_error=$2, updated_at=NOW()
        WHERE site_id=$1`,
      [siteId, aiError.detail.slice(0, 500)],
    );
    logger.warn("woocommerce connection test failed", {
      site_id: siteId, error_code: aiError.code, error: aiError.detail, duration_ms: Date.now() - started,
    });
    return { ok: false, error_code: aiError.code, error: aiError.safeMessage, duration_ms: Date.now() - started };
  }
}

/* ------------------------------------------------------------------ *
 * Taxonomy and products
 * ------------------------------------------------------------------ */

const listAll = async (connection, path, { perPage = 100, maxPages = 3, ...search } = {}) => {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await request(connection, { path, query: { per_page: perPage, page, ...search } });
    if (!Array.isArray(data) || !data.length) break;
    items.push(...data);
    if (data.length < perPage) break;
  }
  return items;
};

export async function listCategories(siteId) {
  const connection = await loadConnection(siteId);
  const rows = await listAll(connection, "wp-json/wc/v3/products/categories", { _fields: "id,name,slug,parent,count" });
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, parent: row.parent, count: row.count }));
}

export async function listTags(siteId) {
  const connection = await loadConnection(siteId);
  const rows = await listAll(connection, "wp-json/wc/v3/products/tags", { _fields: "id,name,slug,count" });
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, count: row.count }));
}

export async function listAttributes(siteId) {
  const connection = await loadConnection(siteId);
  const { data } = await request(connection, { path: "wp-json/wc/v3/products/attributes" });
  return (Array.isArray(data) ? data : []).map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
}

export async function createCategory(siteId, name, parent = 0) {
  const connection = await loadConnection(siteId);
  const { data } = await request(connection, {
    method: "POST", path: "wp-json/wc/v3/products/categories", body: { name, parent },
  });
  return { id: data.id, name: data.name, slug: data.slug };
}

export async function createTag(siteId, name) {
  const connection = await loadConnection(siteId);
  const { data } = await request(connection, {
    method: "POST", path: "wp-json/wc/v3/products/tags", body: { name },
  });
  return { id: data.id, name: data.name, slug: data.slug };
}

export async function getProduct(siteId, productId) {
  const connection = await loadConnection(siteId);
  const { data } = await request(connection, { path: `wp-json/wc/v3/products/${Number(productId)}` });
  return data;
}

/** Finds a product previously created for a draft, via its stored meta key. */
export async function findProductByDraft(siteId, draftPublicId) {
  const connection = await loadConnection(siteId);
  const { data } = await request(connection, {
    path: "wp-json/wc/v3/products",
    query: { search: draftPublicId, per_page: 20, status: "any", _fields: "id,name,permalink,status,meta_data" },
  });
  if (!Array.isArray(data)) return null;
  return data.find((product) => (product.meta_data || [])
    .some((meta) => meta.key === "_jarchi_draft_id" && String(meta.value) === String(draftPublicId))) || null;
}

export async function createProduct(siteId, payload) {
  const connection = await loadConnection(siteId);
  const { data } = await request(connection, { method: "POST", path: "wp-json/wc/v3/products", body: payload });
  return data;
}

export async function updateProduct(siteId, productId, payload) {
  const connection = await loadConnection(siteId);
  const { data } = await request(connection, {
    method: "PUT", path: `wp-json/wc/v3/products/${Number(productId)}`, body: payload,
  });
  return data;
}

/**
 * Uploads bytes to the WordPress media library.
 * Uses the WordPress REST API with an application password, because the
 * WooCommerce keys cannot create media.
 */
export async function uploadMedia(siteId, { buffer, filename, mimeType, altText = "", title = "" }) {
  const connection = await loadConnection(siteId);
  const safeName = String(filename || "product").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);

  const { data } = await request(connection, {
    method: "POST",
    path: "wp-json/wp/v2/media",
    auth: "wordpress",
    timeoutMs: Math.max(config.woocommerce.timeoutMs, 30000),
    body: {
      __raw: true,
      buffer,
      contentType: mimeType,
      headers: { "Content-Disposition": `attachment; filename="${safeName}"` },
    },
  });

  if (!data?.id) {
    throw new AiError(AI_ERROR_CODES.MEDIA_UPLOAD_ERROR, "WordPress media upload returned no id");
  }

  // Alt text and title are a separate write; a failure there must not lose the
  // upload we already made.
  if (altText || title) {
    try {
      await request(connection, {
        method: "POST",
        path: `wp-json/wp/v2/media/${data.id}`,
        auth: "wordpress",
        body: { alt_text: altText, title },
      });
    } catch (error) {
      logger.warn("media metadata update failed", { site_id: siteId, media_id: data.id, error: error.message });
    }
  }

  return { id: data.id, source_url: data.source_url, mime_type: data.mime_type };
}

export { loadConnection as __loadConnectionForTests };
