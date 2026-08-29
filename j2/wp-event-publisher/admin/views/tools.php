<?php
/**
 * Tools admin view.
 *
 * @package WPEventPublisher
 *
 * @var array<string,mixed> $settings Plugin settings.
 * @var string[]            $problems Configuration problems, if any.
 * @var array<string,mixed> $system   System information.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap wpep-wrap">
	<h1><?php esc_html_e( 'تست انتقال', 'wp-event-publisher' ); ?></h1>

	<?php if ( ! empty( $problems ) ) : ?>
		<div class="notice notice-warning">
			<p><strong><?php esc_html_e( 'These problems stop advertisements from reaching Telegram:', 'wp-event-publisher' ); ?></strong></p>
			<ul class="ul-disc">
				<?php foreach ( $problems as $wpep_problem ) : ?>
					<li><?php echo esc_html( $wpep_problem ); ?></li>
				<?php endforeach; ?>
			</ul>
		</div>
	<?php endif; ?>

	<div class="wpep-cards wpep-cards-wide">
		<div class="wpep-card">
			<h2><?php esc_html_e( 'Connection Test', 'wp-event-publisher' ); ?></h2>
			<p><?php esc_html_e( 'Posts a "test" event to the configured webhook URL with the production credentials and reports the HTTP status, the response body and any configuration problem that would still block a real advertisement.', 'wp-event-publisher' ); ?></p>
			<button type="button" class="button button-primary" id="wpep-tools-test">
				<?php esc_html_e( 'Run Connection Test', 'wp-event-publisher' ); ?>
			</button>
			<div class="wpep-result" id="wpep-tools-test-result" role="status" aria-live="polite" hidden></div>
		</div>

		<div class="wpep-card">
			<h2><?php esc_html_e( 'Send One Advertisement Now', 'wp-event-publisher' ); ?></h2>
			<p><?php esc_html_e( 'Builds the exact payload a publish would produce for one post ID and sends it immediately, so you can see the HTTP result without waiting for the queue.', 'wp-event-publisher' ); ?></p>
			<p>
				<label for="wpep-dispatch-post-id"><?php esc_html_e( 'Advertisement post ID', 'wp-event-publisher' ); ?></label>
				<input type="number" min="1" step="1" class="small-text" id="wpep-dispatch-post-id" />
			</p>
			<button type="button" class="button button-primary" id="wpep-tools-dispatch">
				<?php esc_html_e( 'Send Advertisement', 'wp-event-publisher' ); ?>
			</button>
			<div class="wpep-result" id="wpep-tools-dispatch-result" role="status" aria-live="polite" hidden></div>
		</div>

		<div class="wpep-card">
			<h2><?php esc_html_e( 'Process Queue Now', 'wp-event-publisher' ); ?></h2>
			<p>
				<?php
				printf(
					/* translators: %d: number of queued events. */
					esc_html__( 'Delivers everything still waiting in the queue. Currently waiting: %d.', 'wp-event-publisher' ),
					(int) $system['queue_size']
				);
				?>
			</p>
			<button type="button" class="button button-primary" id="wpep-tools-queue">
				<?php esc_html_e( 'Process Queue', 'wp-event-publisher' ); ?>
			</button>
			<div class="wpep-result" id="wpep-tools-queue-result" role="status" aria-live="polite" hidden></div>
		</div>

		<div class="wpep-card">
			<h2><?php esc_html_e( 'Send Sample Payload', 'wp-event-publisher' ); ?></h2>
			<p><?php esc_html_e( 'Normalizes your most recent published advertisement and sends it as a "sample" event so the Node.js team can inspect real data.', 'wp-event-publisher' ); ?></p>
			<button type="button" class="button" id="wpep-tools-sample">
				<?php esc_html_e( 'Send Sample Payload', 'wp-event-publisher' ); ?>
			</button>
			<div class="wpep-result" id="wpep-tools-sample-result" role="status" aria-live="polite" hidden></div>
		</div>

		<div class="wpep-card">
			<h2><?php esc_html_e( 'Validate Configuration', 'wp-event-publisher' ); ?></h2>
			<p><?php esc_html_e( 'Checks the current settings for the problems that silently stop delivery: missing URL, weak secret, disabled toggles, empty post type selection and unusable cron settings.', 'wp-event-publisher' ); ?></p>
			<button type="button" class="button" id="wpep-tools-validate">
				<?php esc_html_e( 'Validate Configuration', 'wp-event-publisher' ); ?>
			</button>
			<div class="wpep-result" id="wpep-tools-validate-result" role="status" aria-live="polite" hidden></div>
		</div>
	</div>

	<h2><?php esc_html_e( 'Pipeline Status', 'wp-event-publisher' ); ?></h2>

	<table class="widefat striped wpep-table wpep-system-table">
		<tbody>
			<tr>
				<th scope="row"><?php esc_html_e( 'Webhook URL', 'wp-event-publisher' ); ?></th>
				<td>
					<?php if ( '' !== (string) $system['endpoint'] ) : ?>
						<code><?php echo esc_html( (string) $system['endpoint'] ); ?></code>
					<?php else : ?>
						<strong><?php esc_html_e( 'Not configured', 'wp-event-publisher' ); ?></strong>
					<?php endif; ?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Webhook secret', 'wp-event-publisher' ); ?></th>
				<td>
					<?php
					$system['secret_set']
						? esc_html_e( 'Configured (never displayed or logged)', 'wp-event-publisher' )
						: esc_html_e( 'Not set — requests carry no credentials', 'wp-event-publisher' );
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Authentication style', 'wp-event-publisher' ); ?></th>
				<td><code><?php echo esc_html( (string) $system['auth_style'] ); ?></code></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Signature algorithm', 'wp-event-publisher' ); ?></th>
				<td>
					<?php
					printf(
						/* translators: %s: hashing algorithm name. */
						esc_html__( 'HMAC-%s over "timestamp.raw_body"', 'wp-event-publisher' ),
						esc_html( (string) $system['signature'] )
					);
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Enabled post types', 'wp-event-publisher' ); ?></th>
				<td>
					<?php
					echo esc_html(
						empty( $system['post_types'] )
							? __( 'None — publishing is ignored', 'wp-event-publisher' )
							: implode( ', ', (array) $system['post_types'] )
					);
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Publish statuses', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( implode( ', ', (array) $system['statuses'] ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Event types', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( implode( ', ', (array) $system['event_types'] ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Dispatch mode', 'wp-event-publisher' ); ?></th>
				<td><code><?php echo esc_html( (string) $system['dispatch_mode'] ); ?></code></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Events waiting in the queue', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( number_format_i18n( (int) $system['queue_size'] ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'WP-Cron', 'wp-event-publisher' ); ?></th>
				<td>
					<?php
					if ( ! $system['wp_cron'] ) {
						esc_html_e( 'Disabled (DISABLE_WP_CRON) — events are delivered inline instead', 'wp-event-publisher' );
					} elseif ( ! $system['cron_healthy'] ) {
						esc_html_e( 'Enabled but overdue — events are delivered inline until cron catches up', 'wp-event-publisher' );
					} else {
						esc_html_e( 'Enabled and running', 'wp-event-publisher' );
					}
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Next queue sweep (UTC)', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( '' !== (string) $system['next_sweep'] ? (string) $system['next_sweep'] : __( 'not scheduled', 'wp-event-publisher' ) ); ?></td>
			</tr>
		</tbody>
	</table>

	<h2><?php esc_html_e( 'System Information', 'wp-event-publisher' ); ?></h2>

	<table class="widefat striped wpep-table wpep-system-table">
		<tbody>
			<tr>
				<th scope="row"><?php esc_html_e( 'Plugin version', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( (string) $system['plugin_version'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Contract version', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( (string) $system['contract'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Site ID', 'wp-event-publisher' ); ?></th>
				<td><code><?php echo esc_html( (string) $system['site_id'] ); ?></code></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Signature tolerance', 'wp-event-publisher' ); ?></th>
				<td>
					<?php
					printf(
						/* translators: %d: tolerance in seconds. */
						esc_html__( '%d seconds', 'wp-event-publisher' ),
						(int) $system['tolerance']
					);
					?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'WordPress version', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( (string) $system['wp_version'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'PHP version', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( (string) $system['php_version'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'MySQL version', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( (string) $system['mysql_version'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'WooCommerce', 'wp-event-publisher' ); ?></th>
				<td><?php $system['woocommerce'] ? esc_html_e( 'Active', 'wp-event-publisher' ) : esc_html_e( 'Not active', 'wp-event-publisher' ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'HTTPS (admin)', 'wp-event-publisher' ); ?></th>
				<td><?php $system['ssl'] ? esc_html_e( 'Yes', 'wp-event-publisher' ) : esc_html_e( 'No', 'wp-event-publisher' ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Timezone', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( (string) $system['timezone'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Locale', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( (string) $system['locale'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Memory limit', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( (string) $system['memory_limit'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Max execution time', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( (string) $system['max_exec_time'] ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Multisite', 'wp-event-publisher' ); ?></th>
				<td><?php $system['multisite'] ? esc_html_e( 'Yes', 'wp-event-publisher' ) : esc_html_e( 'No', 'wp-event-publisher' ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'REST namespace', 'wp-event-publisher' ); ?></th>
				<td><code><?php echo esc_html( (string) $system['rest_url'] ); ?></code></td>
			</tr>
		</tbody>
	</table>
</div>
