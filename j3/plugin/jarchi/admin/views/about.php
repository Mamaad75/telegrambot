<?php
/**
 * About admin view.
 *
 * @package WPEventPublisher
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap wpep-wrap">
	<h1><?php esc_html_e( 'درباره جارچی', 'wp-event-publisher' ); ?></h1>

	<div class="wpep-card wpep-card-full">
		<h2><?php esc_html_e( 'What this plugin does', 'wp-event-publisher' ); ?></h2>
		<p>
			<?php esc_html_e( 'جارچی رویدادهای انتشار سایت شما را تشخیص می‌دهد، محتوا را به یک بسته JSON استاندارد تبدیل می‌کند و آن را از طریق یک وب‌هوک امن به سرویس جارچی می‌فرستد تا در پلتفرم‌های انتخابی منتشر شود.', 'wp-event-publisher' ); ?>
		</p>
		<p>
			<?php esc_html_e( 'The plugin never talks to Telegram or any other social platform directly — all channel-specific logic lives in the Node.js service. WordPress stays responsible only for detecting events, collecting data, authenticating requests and logging.', 'wp-event-publisher' ); ?>
		</p>
		<p>
			<?php esc_html_e( 'Every step of that journey is written to the Logs screen, so a publish that produced nothing always has a recorded reason.', 'wp-event-publisher' ); ?>
		</p>

		<h2><?php esc_html_e( 'Architecture', 'wp-event-publisher' ); ?></h2>
		<ol>
			<li><?php esc_html_e( 'Bootstrap — wp-event-publisher.php wires the autoloader and boots the container.', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Hook Manager — listens to WordPress lifecycle hooks and delegates.', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Event Detector — decides whether a change is a created, updated or deleted event.', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Event ID — issues the stable identifier that survives every retry.', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Normalizer — collects everything WordPress knows about the post.', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Contract — maps that data onto the versioned JSON envelope.', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Signer — computes the HMAC-SHA256 signature over the raw request body.', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Webhook Client — delivers the signed payload via wp_remote_post().', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Dispatcher — queues the event, delivers it through WP-Cron or inline, sweeps anything left waiting and retries transient failures.', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Logger — records every request, response and exception in a custom table.', 'wp-event-publisher' ); ?></li>
			<li><?php esc_html_e( 'Admin Dashboard — status, settings, logs and diagnostic tools.', 'wp-event-publisher' ); ?></li>
		</ol>

		<h2><?php esc_html_e( 'Event Lifecycle', 'wp-event-publisher' ); ?></h2>
		<ul class="wpep-hook-list">
			<li>
				<strong><?php esc_html_e( 'created', 'wp-event-publisher' ); ?></strong>
				— <?php esc_html_e( 'sent once, the first time a post enters a configured publish status.', 'wp-event-publisher' ); ?>
			</li>
			<li>
				<strong><?php esc_html_e( 'updated', 'wp-event-publisher' ); ?></strong>
				— <?php esc_html_e( 'sent when an already published post is modified and stays published. Saves that change nothing observable are ignored.', 'wp-event-publisher' ); ?>
			</li>
			<li>
				<strong><?php esc_html_e( 'deleted', 'wp-event-publisher' ); ?></strong>
				— <?php esc_html_e( 'sent when a previously published post is permanently deleted. Drafts that never went live are ignored.', 'wp-event-publisher' ); ?>
			</li>
		</ul>

		<h2><?php esc_html_e( 'Idempotency', 'wp-event-publisher' ); ?></h2>
		<p>
			<?php esc_html_e( 'Every event receives an identifier such as evt_9f1c0f2a… when it is detected. That identifier is persisted, travels in the payload, the X-Event-ID header and the logs, and is reused unchanged by every retry — so the Node.js service can safely deduplicate on it. A genuinely new event always receives a new identifier.', 'wp-event-publisher' ); ?>
		</p>

		<h2><?php esc_html_e( 'Extensibility', 'wp-event-publisher' ); ?></h2>
		<p><?php esc_html_e( 'Developers can customize behaviour without touching core files using these hooks:', 'wp-event-publisher' ); ?></p>
		<ul class="wpep-hook-list">
			<li><code>wpep_event_payload</code> — <?php esc_html_e( 'filter the complete envelope before it is encoded and signed.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_contract_listing</code> / <code>wpep_contract_taxonomy</code> / <code>wpep_contract_site</code> — <?php esc_html_e( 'extend individual envelope blocks.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_detect_event_type</code> — <?php esc_html_e( 'reclassify or suppress a detected event.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_fingerprint_source</code> — <?php esc_html_e( 'control which changes count as a modification.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_update_cooldown</code> — <?php esc_html_e( 'tune the window that suppresses update events right after publishing.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_generate_event_id</code> — <?php esc_html_e( 'replace the identifier strategy.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_site_id</code> — <?php esc_html_e( 'override the site identifier at runtime.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_payload</code> — <?php esc_html_e( 'filter the flat normalized post data.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_webhook_headers</code> — <?php esc_html_e( 'filter request headers.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_webhook_request_args</code> — <?php esc_html_e( 'filter wp_remote_post() arguments.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_should_dispatch</code> — <?php esc_html_e( 'veto dispatching for specific posts.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_custom_fields</code> — <?php esc_html_e( 'filter the custom fields included in the payload.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_retry_delay</code> — <?php esc_html_e( 'customize the retry backoff.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_excluded_post_types</code> — <?php esc_html_e( 'change which internal post types can never be watched.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_backfill_cutoff</code> — <?php esc_html_e( 'move the line between back catalogue and new advertisements.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_inline_batch_limit</code> — <?php esc_html_e( 'change how many advertisements one request delivers itself.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_webhook_sent</code> / <code>wpep_webhook_failed</code> — <?php esc_html_e( 'react to delivery results.', 'wp-event-publisher' ); ?></li>
			<li><code>wpep_job_enqueued</code> / <code>wpep_job_failed</code> / <code>wpep_event_delivered</code> — <?php esc_html_e( 'observe the async queue.', 'wp-event-publisher' ); ?></li>
		</ul>

		<h2><?php esc_html_e( 'Version', 'wp-event-publisher' ); ?></h2>
		<p>
			<?php
			printf(
				/* translators: %s: plugin version. */
				esc_html__( 'جارچی %s — GPL-2.0-or-later.', 'wp-event-publisher' ),
				esc_html( WPEP_VERSION )
			);
			?>
		</p>

		<h2><?php esc_html_e( 'Credits', 'wp-event-publisher' ); ?></h2>
		<p>
			<?php
			printf(
				/* translators: %s: plugin author name. */
				esc_html__( 'Written and maintained by %s.', 'wp-event-publisher' ),
				esc_html__( 'ممد از تیم بایمر', 'wp-event-publisher' )
			);
			?>
		</p>
	</div>
</div>
