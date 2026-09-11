# Jarchi 1.26.1

- New top-level approved comments on a public custom advert create an automated ticket for the advert owner with `{comment_author}` and `{post_url}` tokens.
- Published adverts edited back to `pending` create the requested “درخواست بروزرسانی آگهی در انتظار بررسی ⏳” ticket instead of being misclassified as rejected.
- Owner-initiated trash/hard-delete creates “آگهی شما حذف شد 🗑” and is separated from moderator rejection.
- Profile completion is detected immediately from common user-meta/profile-update events and `{profile_fields}` lists the completed profile values; no legacy-user hourly completion blast is performed.
- PublishPress Future is integrated directly: Jarchi schedules the seven-day warning from `publishpressfuture_schedule_expiration`, sends the final expiry ticket from `publishpressfuture_post_expired`, and keeps an hourly `_expiration-date` fallback for schedules created before this upgrade.
- The standard Iran-Exim automation pack is enabled automatically on upgrade. Profile-incomplete runs at registration, not as a bulk hourly scan.
- Every automated ticket sends a matching customer email and is mirrored to the backend ticket event stream.
- Backend ticket event compatibility is hardened with top-level `post_id`, alias `id`, and structured `post.id`.
- Front-end stale nonces no longer expose WordPress’ generic expired-link screen; submit/reply/rating return to the same embedded Ticket Center with a recoverable message.
- WP Rocket bypass now recognizes published pages that embed `[jarchi_tickets]` or the Elementor `jarchi_ticket_center` widget, in addition to the configured ticket page. The canonical renderer also enforces private/no-store at runtime and the upgrade purges already-cached direct Ticket Center surfaces once.
- Existing attachment thumbnails, independent ticket/announcement unread badges, and embedded Elementor/JetEngine return-URL preservation are retained.
