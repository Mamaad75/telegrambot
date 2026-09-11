import { query } from "../db/db.js";
import { logger } from "../logger.js";
import { Filters, parsePagination, paginated } from "../utils/pagination.js";

/**
 * Administrator audit trail. Every state-changing admin action — from the web
 * panel or the Telegram bot — lands here. Secrets are never recorded; callers
 * pass descriptive metadata only.
 */
export async function recordAudit({
  actor = null,
  action,
  targetType = "",
  targetId = "",
  success = true,
  requestId = "",
  ip = "",
  channel = "web",
  metadata = {},
}) {
  try {
    await query(
      `INSERT INTO admin_audit_log(
         actor_admin_id,actor_label,actor_role,channel,action,
         target_type,target_id,success,request_id,ip,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        Number.isFinite(Number(actor?.id)) ? Number(actor.id) : null,
        String(actor?.username || actor?.display_name || actor?.label || "unknown"),
        String(actor?.role || ""),
        String(channel),
        String(action),
        String(targetType),
        String(targetId ?? ""),
        Boolean(success),
        String(requestId || ""),
        String(ip || ""),
        JSON.stringify(metadata || {}),
      ],
    );
  } catch (error) {
    // An audit write must never break the action it describes, but it must be
    // visible when it fails.
    logger.error("audit log write failed", { error, action, target_type: targetType, target_id: String(targetId ?? "") });
  }
}

export async function listAudit(input = {}) {
  const { page, pageSize, limit, offset } = parsePagination(input);
  const filters = new Filters();
  filters
    .add("a.action = ?", input.action)
    .add("a.channel = ?", input.channel)
    .add("a.target_type = ?", input.target_type)
    .add("a.target_id = ?", input.target_id)
    .add("a.actor_admin_id = ?", input.actor_admin_id ? Number(input.actor_admin_id) : undefined)
    .add("a.created_at >= ?", input.from)
    .add("a.created_at <= ?", input.to);

  if (input.success === "true" || input.success === true) filters.addRaw("a.success = true");
  if (input.success === "false" || input.success === false) filters.addRaw("a.success = false");

  if (input.q) {
    const term = filters.next(`%${String(input.q).trim()}%`);
    filters.addRaw(`(a.action ILIKE ${term} OR a.actor_label ILIKE ${term} OR a.target_id ILIKE ${term})`);
  }

  const where = filters.where();
  const rows = (await query(
    `SELECT a.* FROM admin_audit_log a ${where}
     ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`,
    filters.params,
  )).rows;
  const total = (await query(
    `SELECT COUNT(*)::int AS count FROM admin_audit_log a ${where}`,
    filters.params,
  )).rows[0].count;

  return paginated(rows, total, { page, pageSize });
}
