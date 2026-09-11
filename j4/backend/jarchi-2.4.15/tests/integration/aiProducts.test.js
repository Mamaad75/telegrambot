import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TEST_ENV, skipWithoutDatabase, resetDatabase, startWooCommerceDouble, seedCustomer,
} from "../helpers.mjs";

/**
 * AI product automation, service layer, against real PostgreSQL and a local
 * WooCommerce REST double. The AI provider is the deterministic mock, so no
 * test needs an API key or spends money.
 */
test("AI product domain", { skip: skipWithoutDatabase }, async (t) => {
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarchi-ai-media-"));
  Object.assign(process.env, TEST_ENV, {
    AI_ENABLED: "true",
    AI_PROVIDER: "mock",
    AI_MEDIA_DIR: mediaDir,
    AI_ENABLE_IMAGE_GENERATION: "true",
    AI_WORKER_ENABLED: "false",
    AI_JOB_BASE_DELAY_MS: "10",
  });
  await resetDatabase();

  const { pool } = await import("../../src/db/db.js");
  const ai = await import("../../src/ai/index.js");
  const { MockAiProvider, makePng } = await import("../../src/ai/providers/mock.js");
  const drafts = await import("../../src/services/productDrafts.js");
  const jobs = await import("../../src/services/productJobs.js");
  const images = await import("../../src/services/productImages.js");
  const usage = await import("../../src/services/aiUsage.js");
  const woocommerce = await import("../../src/services/woocommerce.js");
  const settings = await import("../../src/services/siteProductSettings.js");
  const { runProductWorker, processJob } = await import("../../src/workers/productWorker.js");

  const store = await startWooCommerceDouble();
  const customer = await seedCustomer(pool);
  const provider = new MockAiProvider();
  ai.setAiProvider(provider);

  t.after(async () => {
    ai.resetAiProvider();
    await store.close();
    await pool.end();
    await fs.rm(mediaDir, { recursive: true, force: true });
  });

  const connect = () => woocommerce.saveConnection(customer.site.id, {
    baseUrl: store.baseUrl,
    consumerKey: "ck_test_key",
    consumerSecret: "cs_test_secret",
    wpUsername: "editor",
    wpAppPassword: "app pass word",
    // The double runs on localhost, so the hostname pin is not applied here;
    // production sites are pinned to their registered wordpress_url.
    siteWordpressUrl: "",
    userId: customer.user.id,
  });

  await t.test("WooCommerce credentials are encrypted and never returned", async () => {
    // A private host is refused unless the deployment opts in.
    await assert.rejects(connect(), (error) => error.code === "WORDPRESS_AUTH_ERROR");

    process.env.WOOCOMMERCE_ALLOW_PRIVATE_HOSTS = "true";
    const { config } = await import("../../src/config.js");
    config.woocommerce.allowPrivateHosts = true;

    const saved = await connect();
    assert.equal(saved.site_id, customer.site.id);
    assert.equal("consumer_key_enc" in saved, false);

    const { rows } = await pool.query("SELECT consumer_key_enc, consumer_secret_enc FROM woocommerce_connections WHERE site_id=$1", [customer.site.id]);
    assert.doesNotMatch(rows[0].consumer_key_enc, /ck_test_key/, "consumer key must be encrypted at rest");
    assert.doesNotMatch(rows[0].consumer_secret_enc, /cs_test_secret/);

    const view = await woocommerce.getConnectionView(customer.site.id);
    assert.equal("consumer_secret" in view, false);
    assert.equal("consumer_secret_enc" in view, false);
    assert.ok(view.consumer_key_hint.includes("•"), "only a masked hint is exposed");
    assert.equal(view.media_upload_configured, true);
  });

  await t.test("connection test reports the store and records the result", async () => {
    const result = await woocommerce.testConnection(customer.site.id);
    assert.equal(result.ok, true);
    assert.equal(result.store.wc_version, "9.1.2");

    const view = await woocommerce.getConnectionView(customer.site.id);
    assert.equal(view.last_test_ok, true);
  });

  await t.test("a failing store is reported safely, not as a raw error", async () => {
    store.setMode("unauthorized");
    const result = await woocommerce.testConnection(customer.site.id);
    assert.equal(result.ok, false);
    assert.equal(result.error_code, "WORDPRESS_AUTH_ERROR");
    assert.doesNotMatch(result.error, /woocommerce_rest_cannot_view/, "provider wording stays in the log");

    store.setMode("html");
    const invalid = await woocommerce.testConnection(customer.site.id);
    assert.equal(invalid.ok, false);
    store.setMode("ok");
  });

  await t.test("site automation defaults are safe", async () => {
    const defaults = await settings.getSettings(customer.site.id);
    assert.equal(defaults.auto_generate_content, true);
    assert.equal(defaults.require_manual_approval, true);
    assert.equal(defaults.auto_publish, false);
    assert.equal(defaults.auto_generate_images, false);
    assert.equal(defaults.auto_assign_categories, false);
    assert.equal(defaults.allow_category_creation, false);
    assert.equal(defaults.is_default, true);
  });

  let draftId = null;

  await t.test("draft creation is idempotent per customer key", async () => {
    const first = await drafts.createDraft({
      userId: customer.user.id, siteId: customer.site.id,
      input: { name: "کتری برقی", price: "1,850,000", color: "مشکی" },
      idempotencyKey: "create-key-1",
    });
    assert.equal(first.created, true);
    draftId = first.draft.id;

    const repeat = await drafts.createDraft({
      userId: customer.user.id, siteId: customer.site.id,
      input: { name: "کتری برقی" }, idempotencyKey: "create-key-1",
    });
    assert.equal(repeat.created, false);
    assert.equal(repeat.draft.id, first.draft.id, "a repeated create must not fork a second draft");

    const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM ai_product_drafts");
    assert.equal(rows[0].count, 1);
    // The customer's own values are preserved verbatim.
    assert.equal(first.draft.input.name, "کتری برقی");
    assert.equal(first.draft.input.price, 1850000);
  });

  await t.test("a draft needs at least a name or a description", async () => {
    await assert.rejects(
      drafts.createDraft({ userId: customer.user.id, siteId: customer.site.id, input: { color: "مشکی" } }),
      (error) => error.code === "PRODUCT_VALIDATION_ERROR",
    );
  });

  await t.test("images are validated by their bytes and stored outside the database", async () => {
    const stored = await images.storeImage({
      buffer: makePng(400, 300),
      userId: customer.user.id,
      siteId: customer.site.id,
      draftId,
      declaredMimeType: "image/png",
    });
    assert.equal(stored.width, 400);
    assert.equal(stored.mime_type, "image/png");
    assert.ok(stored.storage_path, "file lives on disk");

    const onDisk = await fs.readFile(path.join(mediaDir, stored.storage_path));
    assert.ok(onDisk.length > 0);

    // A script with an image extension is rejected on its content.
    await assert.rejects(
      images.storeImage({
        buffer: Buffer.from("<?php system($_GET[0]); ?>"),
        userId: customer.user.id, draftId, declaredMimeType: "image/png",
      }),
      (error) => error.code === "IMAGE_VALIDATION_ERROR",
    );
  });

  await t.test("generation runs as a job and produces validated content", async () => {
    const reservation = await usage.reserveUsage({
      userId: customer.user.id, siteId: customer.site.id, draftId,
      operation: usage.USAGE_OPERATIONS.PRODUCT_GENERATION,
    });
    const queued = await jobs.enqueueJob({
      draftId, userId: customer.user.id, siteId: customer.site.id,
      type: jobs.JOB_TYPES.GENERATE, payload: { usage_id: reservation.id },
    });
    assert.equal(queued.created, true);

    // A second request while one is open does not start a second generation.
    const duplicate = await jobs.enqueueJob({
      draftId, userId: customer.user.id, siteId: customer.site.id, type: jobs.JOB_TYPES.GENERATE,
    });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.job.id, queued.job.id);

    const result = await runProductWorker();
    assert.equal(result.succeeded, 1, "generation job should succeed");

    const draft = await drafts.getDraft(draftId);
    assert.equal(draft.status, "awaiting_review", "manual approval is required by default");
    assert.equal(draft.generated.title, "کتری برقی");
    assert.ok(draft.generated.description.includes("<h2>"));
    assert.ok(draft.generated.slug);
    assert.equal(draft.current_version, 1);
    assert.equal(draft.provider, "mock");

    // The image was analysed and its alt text stored.
    const stored = await images.listImages(draftId);
    assert.ok(stored[0].analysis, "vision result recorded against the image");
    assert.ok(stored[0].alt_text);

    // The reservation was committed, not left dangling.
    const { rows } = await pool.query("SELECT status FROM ai_usage WHERE id=$1", [reservation.id]);
    assert.equal(rows[0].status, "committed");
  });

  await t.test("inferred attributes are flagged for review, never asserted as fact", async () => {
    const draft = await drafts.getDraft(draftId);
    const inferred = draft.generated.attributes.filter((attribute) => attribute.source === "inferred");
    assert.ok(inferred.length, "the mock produces one inferred attribute");
    assert.ok(inferred.every((attribute) => attribute.requires_review === true));
    assert.ok(draft.warnings.some((warning) => warning.code === "inferred_attributes"));
  });

  await t.test("a customer edit locks the field against later regeneration", async () => {
    const edited = await drafts.applyEdit(draftId, { title: "کتری برقی حرفه‌ای" }, { userId: customer.user.id });
    assert.equal(edited.draft.generated.title, "کتری برقی حرفه‌ای");
    assert.deepEqual(edited.draft.locked_fields, ["title"]);
    assert.equal(edited.version, 2);

    const reservation = await usage.reserveUsage({
      userId: customer.user.id, siteId: customer.site.id, draftId,
      operation: usage.USAGE_OPERATIONS.REGENERATION,
    });
    await jobs.enqueueJob({
      draftId, userId: customer.user.id, siteId: customer.site.id,
      type: jobs.JOB_TYPES.REGENERATE, payload: { section: "description", usage_id: reservation.id },
    });
    await runProductWorker();

    const draft = await drafts.getDraft(draftId);
    assert.equal(draft.generated.title, "کتری برقی حرفه‌ای", "the edited title survives regeneration");
    assert.ok(draft.generated.description.length > 0);
    assert.equal(draft.current_version, 3);
  });

  await t.test("version history is kept, not overwritten", async () => {
    const versions = await drafts.listVersions(draftId);
    assert.equal(versions.length, 3);
    assert.deepEqual(versions.map((version) => version.source), ["regeneration", "user_edit", "ai_generation"]);
    const first = await drafts.getVersion(draftId, 1);
    assert.equal(first.content.title, "کتری برقی", "the original generation is still readable");
  });

  await t.test("publishing creates exactly one WooCommerce product, twice over", async () => {
    await drafts.approveDraft(draftId, { userId: customer.user.id });
    const before = store.productCount();

    await jobs.enqueueJob({ draftId, userId: customer.user.id, siteId: customer.site.id, type: jobs.JOB_TYPES.PUBLISH });
    await runProductWorker();

    const draft = await drafts.getDraft(draftId);
    assert.equal(draft.status, "published");
    assert.ok(draft.wc_product_id);
    assert.ok(draft.wc_permalink);
    assert.equal(store.productCount(), before + 1);

    const product = store.products().at(-1);
    assert.equal(product.name, "کتری برقی حرفه‌ای");
    assert.ok(product.images.length, "the uploaded image is attached");
    assert.ok(product.meta_data.some((meta) => meta.key === "_jarchi_draft_id"));
    // SEO metadata is written for both common SEO plugins.
    assert.ok(product.meta_data.some((meta) => meta.key === "_yoast_wpseo_title" && meta.value));
    assert.ok(product.meta_data.some((meta) => meta.key === "rank_math_focus_keyword" && meta.value));
    // The inferred attribute is not written to the store as a specification.
    const attributeNames = (product.attributes || []).map((attribute) => attribute.name);
    assert.ok(!attributeNames.includes("سبک"), "inferred attributes stay out of WooCommerce");

    // Publishing again must update, never create a second product.
    await jobs.enqueueJob({ draftId, userId: customer.user.id, siteId: customer.site.id, type: jobs.JOB_TYPES.PUBLISH });
    await runProductWorker();
    assert.equal(store.productCount(), before + 1, "a repeated publish must not create a second product");
  });

  await t.test("media is uploaded once and reused on republish", async () => {
    const uploads = store.state.requests.filter((request) => request.path === "/wp-json/wp/v2/media" && request.method === "POST");
    assert.equal(uploads.length, 1, "the same image must not be uploaded twice");
    const stored = await images.listImages(draftId);
    assert.ok(stored[0].wp_media_id);
  });

  await t.test("a product created by a lost attempt is adopted, not duplicated", async () => {
    const { draft } = await drafts.createDraft({
      userId: customer.user.id, siteId: customer.site.id, input: { name: "محصول گمشده" },
    });
    await jobs.enqueueJob({ draftId: draft.id, userId: customer.user.id, siteId: customer.site.id, type: jobs.JOB_TYPES.GENERATE });
    await runProductWorker();
    await drafts.approveDraft(draft.id, { userId: customer.user.id });

    // Simulate the previous attempt: the product exists in the store carrying
    // this draft's id, but the backend never recorded it.
    const orphan = await woocommerce.createProduct(customer.site.id, {
      name: "محصول گمشده", meta_data: [{ key: "_jarchi_draft_id", value: draft.public_id }],
    });
    const before = store.productCount();

    await jobs.enqueueJob({ draftId: draft.id, userId: customer.user.id, siteId: customer.site.id, type: jobs.JOB_TYPES.PUBLISH });
    await runProductWorker();

    assert.equal(store.productCount(), before, "the orphaned product is adopted");
    const published = await drafts.getDraft(draft.id);
    assert.equal(Number(published.wc_product_id), Number(orphan.id));
  });

  await t.test("a transport failure retries, a permanent one does not", async () => {
    const { draft } = await drafts.createDraft({
      userId: customer.user.id, siteId: customer.site.id, input: { name: "محصول ناموفق" },
    });

    ai.setAiProvider(new MockAiProvider({ failStructured: "provider", failTimes: 1 }));
    await jobs.enqueueJob({ draftId: draft.id, userId: customer.user.id, siteId: customer.site.id, type: jobs.JOB_TYPES.GENERATE });

    const first = await runProductWorker();
    assert.equal(first.failed, 1);
    let job = await jobs.latestJobForDraft(draft.id);
    assert.equal(job.status, "pending", "a retryable failure goes back to the queue");
    assert.equal(job.attempts, 1);

    await pool.query("UPDATE ai_jobs SET next_attempt_at=NOW() WHERE id=$1", [job.id]);
    const second = await runProductWorker();
    assert.equal(second.succeeded, 1, "the retry succeeds once the provider recovers");

    // A permanent failure stops immediately.
    const { draft: other } = await drafts.createDraft({
      userId: customer.user.id, siteId: customer.site.id, input: { name: "محصول دائمی ناموفق" },
    });
    ai.setAiProvider(new MockAiProvider({ failStructured: "permanent" }));
    const reservation = await usage.reserveUsage({
      userId: customer.user.id, siteId: customer.site.id, draftId: other.id,
      operation: usage.USAGE_OPERATIONS.PRODUCT_GENERATION,
    });
    await jobs.enqueueJob({
      draftId: other.id, userId: customer.user.id, siteId: customer.site.id,
      type: jobs.JOB_TYPES.GENERATE, payload: { usage_id: reservation.id },
    });
    await runProductWorker();

    job = await jobs.latestJobForDraft(other.id);
    assert.equal(job.status, "failed", "a permanent failure is not repeated");
    const failedDraft = await drafts.getDraft(other.id);
    assert.equal(failedDraft.status, "generation_failed");
    assert.equal(failedDraft.error_code, "AI_PROVIDER_ERROR");

    // The credit is returned when the work never happened.
    const { rows } = await pool.query("SELECT status FROM ai_usage WHERE id=$1", [reservation.id]);
    assert.equal(rows[0].status, "released");

    ai.setAiProvider(new MockAiProvider());
  });

  await t.test("malformed AI output is rejected rather than stored", async () => {
    const { draft } = await drafts.createDraft({
      userId: customer.user.id, siteId: customer.site.id, input: { name: "خروجی خراب" },
    });
    ai.setAiProvider(new MockAiProvider({ failStructured: "malformed" }));
    await jobs.enqueueJob({ draftId: draft.id, userId: customer.user.id, siteId: customer.site.id, type: jobs.JOB_TYPES.GENERATE });
    await runProductWorker();

    const failed = await drafts.getDraft(draft.id);
    assert.equal(failed.generated, null, "unvalidated output is never stored");
    assert.equal(failed.status, "validation_failed");
    assert.equal(failed.error_code, "AI_VALIDATION_ERROR");
    ai.setAiProvider(new MockAiProvider());
  });

  await t.test("quota is enforced and reservations are atomic", async () => {
    const summary = await usage.getUsageSummary(customer.user.id);
    assert.equal(summary.products.limit, 20, "monthly plan grants 20 product credits");
    assert.ok(summary.products.used > 0);

    // Drain the remaining allowance.
    const remaining = summary.products.remaining;
    for (let index = 0; index < remaining; index += 1) {
      await usage.reserveUsage({ userId: customer.user.id, operation: usage.USAGE_OPERATIONS.PRODUCT_GENERATION });
    }
    await assert.rejects(
      usage.reserveUsage({ userId: customer.user.id, operation: usage.USAGE_OPERATIONS.PRODUCT_GENERATION }),
      (error) => error.code === "AI_QUOTA_ERROR",
    );

    const exhausted = await usage.getUsageSummary(customer.user.id);
    assert.equal(exhausted.products.remaining, 0);
    // Images have their own bucket and are unaffected.
    assert.ok(exhausted.images.remaining > 0);
  });

  await t.test("a customer without a subscription gets no AI", async () => {
    const other = await seedCustomer(pool, { telegramId: "900000002", siteId: "site_nosub_test01" });
    await pool.query("UPDATE subscriptions SET status='expired', expires_at=NOW()-INTERVAL '1 day' WHERE user_id=$1", [other.user.id]);

    await assert.rejects(
      usage.reserveUsage({ userId: other.user.id, operation: usage.USAGE_OPERATIONS.PRODUCT_GENERATION }),
      (error) => error.code === "AI_QUOTA_ERROR",
    );
  });

  await t.test("cross-customer access is refused at the service boundary", async () => {
    const intruder = await seedCustomer(pool, { telegramId: "900000003", siteId: "site_intruder_t1" });
    await assert.rejects(
      drafts.getDraft(draftId, { userId: intruder.user.id }),
      (error) => error.code === "PERMISSION_ERROR",
    );

    const job = await jobs.latestJobForDraft(draftId);
    await assert.rejects(
      jobs.getJob(job.public_id, { userId: intruder.user.id }),
      (error) => error.code === "PERMISSION_ERROR",
    );

    const stored = await images.listImages(draftId);
    await assert.rejects(
      images.getImage(stored[0].public_id, { userId: intruder.user.id }),
      (error) => error.code === "PERMISSION_ERROR",
    );
  });

  await t.test("automatic publishing only happens when the site enables it", async () => {
    await settings.saveSettings(customer.site.id, {
      require_manual_approval: false, auto_publish: true, auto_assign_categories: true, allow_tag_creation: true,
    }, { userId: customer.user.id });

    // Give the customer room for one more generation.
    await pool.query("UPDATE ai_usage SET status='released' WHERE user_id=$1 AND status='reserved'", [customer.user.id]);

    const { draft } = await drafts.createDraft({
      userId: customer.user.id, siteId: customer.site.id, input: { name: "محصول خودکار" },
    });
    await jobs.enqueueJob({ draftId: draft.id, userId: customer.user.id, siteId: customer.site.id, type: jobs.JOB_TYPES.GENERATE });
    await runProductWorker();          // generation queues the publish job
    await runProductWorker();          // publish job runs

    const published = await drafts.getDraft(draft.id);
    assert.equal(published.status, "published");
    assert.ok(published.wc_product_id);

    const product = store.products().find((item) => Number(item.id) === Number(published.wc_product_id));
    assert.ok(product.categories.length, "categories were assigned once the site allowed it");

    await settings.saveSettings(customer.site.id, { require_manual_approval: true, auto_publish: false }, { userId: customer.user.id });
  });

  await t.test("stale jobs are reclaimed for another worker", async () => {
    const { draft } = await drafts.createDraft({
      userId: customer.user.id, siteId: customer.site.id, input: { name: "محصول قفل‌شده" },
    });
    const queued = await jobs.enqueueJob({
      draftId: draft.id, userId: customer.user.id, siteId: customer.site.id, type: jobs.JOB_TYPES.GENERATE,
    });
    await pool.query(
      "UPDATE ai_jobs SET status='processing', locked_at=NOW()-INTERVAL '2 hours', locked_by='dead-worker' WHERE id=$1",
      [queued.job.id],
    );

    assert.equal(await jobs.reclaimStaleJobs(60000), 1);
    const reclaimed = await jobs.getJob(queued.job.public_id);
    assert.equal(reclaimed.status, "pending");
  });

  await t.test("abandoned uploads are swept, attached ones are kept", async () => {
    const orphan = await images.storeImage({
      buffer: makePng(200, 200), userId: customer.user.id, siteId: customer.site.id, draftId: null,
    });
    await pool.query("UPDATE ai_product_images SET created_at = NOW() - INTERVAL '5 days' WHERE id=$1", [orphan.id]);

    const removed = await images.purgeAbandonedUploads({ olderThanHours: 72 });
    assert.equal(removed, 1);

    const { rows } = await pool.query("SELECT status, storage_path FROM ai_product_images WHERE id=$1", [orphan.id]);
    assert.equal(rows[0].status, "expired");
    assert.equal(rows[0].storage_path, null);

    const attached = await images.listImages(draftId);
    assert.ok(attached.length, "images belonging to a draft are untouched");
  });
});
