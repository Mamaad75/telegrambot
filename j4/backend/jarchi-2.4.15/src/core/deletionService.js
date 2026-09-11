import { query } from "../db/db.js";
import { deleteTelegramPublication } from "../platforms/telegram.js";
import { deleteBalePublication } from "../platforms/bale.js";
import { logger } from "../logger.js";

/**
 * Handles `deleted` / `deleted_from_trash` events from WordPress.
 *
 * Telegram and Bale can delete a message they posted; the WhatsApp Cloud API
 * cannot recall a delivered message, so that result is reported as
 * `unsupported` and recorded as such — never as a successful deletion.
 */
const DELETABLE_PLATFORMS = new Set(["telegram", "bale"]);

async function findPublications(siteId, postId) {
  return (await query(
    `SELECT * FROM publications
      WHERE site_id=$1 AND post_id=$2 AND status='published'
      ORDER BY published_at DESC NULLS LAST, id DESC`,
    [siteId, postId],
  )).rows;
}

async function recordOutcome(publicationId, { status, error = null, metadata }) {
  await query(
    `UPDATE publications
        SET status=$2,
            error_message=$3,
            metadata=metadata || $4::jsonb,
            updated_at=NOW()
      WHERE id=$1`,
    [publicationId, status, error, JSON.stringify(metadata)],
  );
}

export async function deletePublication(ad) {
  const rows = await findPublications(ad.site_id, ad.post_id);
  if (!rows.length) {
    logger.info("deletion event had no published messages", {
      site_id: ad.site_id, post_id: ad.post_id, event_type: ad.event_type,
    });
    return [{ platform: "all", status: "skipped", reason: "nothing_published" }];
  }

  const results = [];
  for (const publication of rows) {
    if (!DELETABLE_PLATFORMS.has(publication.platform)) {
      await recordOutcome(publication.id, {
        // The message stays published on the platform, so the row keeps that
        // status; the deletion attempt is recorded in metadata.
        status: "published",
        metadata: {
          deletion: {
            status: "unsupported",
            reason: `${publication.platform} API cannot delete a delivered message`,
            attempted_at: new Date().toISOString(),
            event_type: ad.event_type,
          },
        },
      });
      results.push({
        platform: publication.platform,
        status: "unsupported",
        reason: "platform_cannot_delete",
      });
      continue;
    }

    try {
      if (publication.platform === "telegram") await deleteTelegramPublication(publication);
      else await deleteBalePublication(publication);

      await recordOutcome(publication.id, {
        status: "deleted",
        metadata: { deletion: { status: "deleted", at: new Date().toISOString(), event_type: ad.event_type } },
      });
      results.push({ platform: publication.platform, status: "deleted" });
    } catch (error) {
      await recordOutcome(publication.id, {
        status: "failed",
        error: error.message,
        metadata: {
          deletion: {
            status: "failed",
            error_code: error.category || "unknown",
            at: new Date().toISOString(),
            event_type: ad.event_type,
          },
        },
      });
      results.push({
        platform: publication.platform,
        status: "failed",
        error: error.message,
        error_code: error.category || "unknown",
      });
    }
  }

  return results;
}
