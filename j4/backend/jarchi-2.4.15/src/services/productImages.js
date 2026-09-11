import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { query } from "../db/db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { AiError, AI_ERROR_CODES } from "../ai/errors.js";
import { validateImageBuffer } from "../ai/image/validation.js";
import { sanitizePlainText } from "../ai/sanitize.js";

/**
 * Product image storage.
 *
 * Bytes live on disk under AI_MEDIA_DIR; PostgreSQL holds metadata and
 * references only. Files are named from a random id, never from anything the
 * customer supplied, so a crafted filename cannot escape the directory.
 */

const publicId = () => `img_${crypto.randomBytes(9).toString("base64url")}`;

async function mediaRoot() {
  const root = path.resolve(config.ai.mediaDir);
  await fs.mkdir(root, { recursive: true });
  return root;
}

/** Resolves a stored path and refuses anything outside the media root. */
async function resolveStoredPath(storagePath) {
  const root = await mediaRoot();
  const resolved = path.resolve(root, storagePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new AiError(AI_ERROR_CODES.IMAGE_VALIDATION_ERROR, `Path escapes media root: ${storagePath}`, {
      retryable: false,
    });
  }
  return resolved;
}

/**
 * Validates and stores one image.
 * The format is decided by the bytes, not by any declared content type.
 */
export async function storeImage({
  buffer, userId, siteId = null, draftId = null, origin = "user_upload",
  purpose = "product", declaredMimeType = "", altText = "", provider = null,
  model = null, prompt = null, promptVersion = null, sourceImageId = null, position = 0,
}) {
  const meta = validateImageBuffer(buffer, { declaredMimeType });

  if (draftId) {
    const { rows } = await query(
      "SELECT COUNT(*)::int AS count FROM ai_product_images WHERE draft_id=$1 AND status <> 'deleted'",
      [Number(draftId)],
    );
    if (rows[0].count >= config.ai.maxImagesPerDraft) {
      throw new AiError(
        AI_ERROR_CODES.IMAGE_VALIDATION_ERROR,
        `Draft ${draftId} already has ${rows[0].count} images`,
        { retryable: false, safeMessage: `حداکثر ${config.ai.maxImagesPerDraft} تصویر برای هر محصول مجاز است.` },
      );
    }
  }

  const id = publicId();
  const relativePath = path.join(String(userId), `${id}.${meta.extension}`);
  const absolutePath = await resolveStoredPath(relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer, { mode: 0o600 });

  const row = (await query(
    `INSERT INTO ai_product_images(
       public_id, draft_id, user_id, site_id, origin, purpose, source_image_id, storage_path,
       mime_type, byte_size, width, height, checksum, status, provider, model, prompt,
       prompt_version, alt_text, position)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'stored',$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      id, draftId, Number(userId), siteId, origin, purpose, sourceImageId, relativePath,
      meta.mimeType, meta.byteSize, meta.width, meta.height, meta.checksum,
      provider, model, prompt ? String(prompt).slice(0, 2000) : null, promptVersion,
      sanitizePlainText(altText, { maxLength: 140 }), position,
    ],
  )).rows[0];

  logger.info("product image stored", {
    image_id: id, draft_id: draftId, user_id: userId, origin, purpose,
    mime_type: meta.mimeType, bytes: meta.byteSize, width: meta.width, height: meta.height,
  });
  return row;
}

export async function readImageBuffer(image) {
  if (!image?.storage_path) {
    throw new AiError(AI_ERROR_CODES.IMAGE_VALIDATION_ERROR, "Image has no stored file");
  }
  const absolutePath = await resolveStoredPath(image.storage_path);
  return fs.readFile(absolutePath);
}

export async function listImages(draftId) {
  return (await query(
    `SELECT * FROM ai_product_images
      WHERE draft_id=$1 AND status <> 'deleted' ORDER BY position ASC, id ASC`,
    [Number(draftId)],
  )).rows;
}

export async function getImage(id, { userId = null } = {}) {
  const numeric = Number.isFinite(Number(id)) ? Number(id) : 0;
  const row = (await query(
    "SELECT * FROM ai_product_images WHERE public_id=$1 OR id=$2",
    [String(id), numeric],
  )).rows[0];
  if (!row) return null;
  if (userId !== null && String(row.user_id) !== String(userId)) {
    throw new AiError(AI_ERROR_CODES.PERMISSION_ERROR, `User ${userId} may not access image ${row.public_id}`);
  }
  return row;
}

export async function attachToDraft(imageId, draftId, position = 0) {
  return (await query(
    "UPDATE ai_product_images SET draft_id=$2, position=$3, updated_at=NOW() WHERE id=$1 RETURNING *",
    [Number(imageId), Number(draftId), Number(position)],
  )).rows[0];
}

export async function saveAnalysis(imageId, analysis) {
  await query(
    "UPDATE ai_product_images SET analysis=$2::jsonb, updated_at=NOW() WHERE id=$1",
    [Number(imageId), JSON.stringify(analysis || {})],
  );
}

export async function setAltText(imageId, altText) {
  await query(
    "UPDATE ai_product_images SET alt_text=$2, updated_at=NOW() WHERE id=$1",
    [Number(imageId), sanitizePlainText(altText, { maxLength: 140 })],
  );
}

/** Records the WordPress media id so the same file is never uploaded twice. */
export async function markUploaded(imageId, { wpMediaId, sourceUrl }) {
  return (await query(
    `UPDATE ai_product_images
        SET wp_media_id=$2, wp_source_url=$3, status='uploaded', error_message=NULL, updated_at=NOW()
      WHERE id=$1 RETURNING *`,
    [Number(imageId), Number(wpMediaId), sourceUrl || null],
  )).rows[0];
}

export async function markUploadFailed(imageId, message) {
  await query(
    "UPDATE ai_product_images SET status='upload_failed', error_message=$2, updated_at=NOW() WHERE id=$1",
    [Number(imageId), String(message).slice(0, 500)],
  );
}

export async function deleteImage(imageId) {
  const image = (await query("SELECT * FROM ai_product_images WHERE id=$1", [Number(imageId)])).rows[0];
  if (!image) return false;

  if (image.storage_path) {
    try {
      await fs.unlink(await resolveStoredPath(image.storage_path));
    } catch { /* already gone */ }
  }
  await query(
    "UPDATE ai_product_images SET status='deleted', storage_path=NULL, updated_at=NOW() WHERE id=$1",
    [Number(imageId)],
  );
  return true;
}

/**
 * Sweeps uploads that were never attached to a draft.
 * Someone who opens the upload dialog and walks away should not leave files on
 * disk forever.
 */
export async function purgeAbandonedUploads({ olderThanHours = config.ai.mediaTtlHours } = {}) {
  const rows = (await query(
    `SELECT id, storage_path FROM ai_product_images
      WHERE draft_id IS NULL AND status='stored'
        AND created_at < NOW() - ($1||' hours')::interval`,
    [String(Math.max(1, Number(olderThanHours) || 72))],
  )).rows;

  let removed = 0;
  for (const row of rows) {
    if (row.storage_path) {
      try {
        await fs.unlink(await resolveStoredPath(row.storage_path));
      } catch { /* already gone */ }
    }
    await query(
      "UPDATE ai_product_images SET status='expired', storage_path=NULL, updated_at=NOW() WHERE id=$1",
      [row.id],
    );
    removed += 1;
  }

  if (removed) logger.info("abandoned product uploads purged", { count: removed, older_than_hours: olderThanHours });
  return removed;
}

/** Images prepared for a vision call: base64 with their real mime type. */
export async function loadForAnalysis(draftId, { max = 3 } = {}) {
  const images = (await listImages(draftId)).filter((image) => image.origin === "user_upload").slice(0, max);
  const prepared = [];
  for (const image of images) {
    try {
      const buffer = await readImageBuffer(image);
      prepared.push({ id: image.id, mimeType: image.mime_type, base64: buffer.toString("base64") });
    } catch (error) {
      logger.warn("image could not be read for analysis", { image_id: image.public_id, error: error.message });
    }
  }
  return prepared;
}
