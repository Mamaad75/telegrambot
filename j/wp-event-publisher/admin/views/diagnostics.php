<?php
/**
 * Diagnostics admin view.
 *
 * @package WPEventPublisher
 *
 * @var array<int,array{id:string,label:string,status:string,detail:string}> $checks     Check results.
 * @var array<string,mixed>                                                  $queue      Queue statistics.
 * @var array<string,mixed>                                                  $deliveries Lifetime delivery counters.
 * @var string                                                               $endpoint   Configured webhook URL.
 * @var array<string,\WP_Post_Type>                                          $post_types Selectable post types.
 * @var array<string,mixed>                                                  $settings   Plugin settings.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_labels = array(
	WPEventPublisher\Diagnostics::OK   => __( 'Pass', 'wp-event-publisher' ),
	WPEventPublisher\Diagnostics::WARN => __( 'Warning', 'wp-event-publisher' ),
	WPEventPublisher\Diagnostics::FAIL => __( 'Fail', 'wp-event-publisher' ),
);
?>
<div class="wrap wpep-wrap">
	<h1><?php esc_html_e( 'گزارش فنی', 'wp-event-publisher' ); ?></h1>

	<p class="description">
		<?php esc_html_e( 'Each row checks one link in the chain, in the order a publication travels it. The first failing row is the thing to fix. The checks below run without touching the network; use the button to include DNS, TLS, the service health endpoint and a real authenticated webhook request.', 'wp-event-publisher' ); ?>
	</p>

	<p>
		<button type="button" class="button button-primary" id="wpep-run-diagnostics">
			<?php esc_html_e( 'Run Full Diagnostics', 'wp-event-publisher' ); ?>
		</button>
	</p>

	<div class="wpep-result" id="wpep-diagnostics-result" role="status" aria-live="polite" hidden></div>

	<table class="widefat striped wpep-table wpep-diagnostics-table" id="wpep-diagnostics-table">
		<thead>
			<tr>
				<th style="width:110px"><?php esc_html_e( 'Result', 'wp-event-publisher' ); ?></th>
				<th style="width:220px"><?php esc_html_e( 'Check', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Detail', 'wp-event-publisher' ); ?></th>
			</tr>
		</thead>
		<tbody>
			<?php foreach ( $checks as $wpep_check ) : ?>
				<tr>
					<td>
						<span class="wpep-badge wpep-badge-<?php echo esc_attr( $wpep_check['status'] ); ?>">
							<?php echo esc_html( $wpep_labels[ $wpep_check['status'] ] ?? $wpep_check['status'] ); ?>
						</span>
					</td>
					<td><?php echo esc_html( $wpep_check['label'] ); ?></td>
					<td><?php echo esc_html( $wpep_check['detail'] ); ?></td>
				</tr>
			<?php endforeach; ?>
		</tbody>
	</table>

	<h2><?php esc_html_e( 'Delivery record', 'wp-event-publisher' ); ?></h2>

	<p class="description">
		<?php esc_html_e( 'These totals count every advertisement this site has delivered, and they are kept independently of the queue, which only retains recent rows. The webhook secret is never shown here, in the logs, or in the page source.', 'wp-event-publisher' ); ?>
	</p>

	<table class="widefat striped wpep-table wpep-system-table">
		<tbody>
			<tr>
				<th scope="row"><?php esc_html_e( 'Webhook URL', 'wp-event-publisher' ); ?></th>
				<td><code><?php echo esc_html( '' !== $endpoint ? $endpoint : __( 'not configured', 'wp-event-publisher' ) ); ?></code></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Total successful deliveries', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( number_format_i18n( (int) $deliveries['success_total'] ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Total failed deliveries', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( number_format_i18n( (int) $deliveries['failed_total'] ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Last successful delivery (UTC)', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( '' !== (string) $deliveries['last_success'] ? (string) $deliveries['last_success'] : __( 'never', 'wp-event-publisher' ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Last failed delivery (UTC)', 'wp-event-publisher' ); ?></th>
				<td>
					<?php if ( '' !== (string) $deliveries['last_failure'] ) : ?>
						<?php echo esc_html( (string) $deliveries['last_failure'] ); ?>
						<?php if ( '' !== (string) $deliveries['last_error'] ) : ?>
							<br />
							<em><?php echo esc_html( (string) $deliveries['last_error'] ); ?></em>
						<?php endif; ?>
					<?php else : ?>
						<?php esc_html_e( 'never', 'wp-event-publisher' ); ?>
					<?php endif; ?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Last response code', 'wp-event-publisher' ); ?></th>
				<td>
					<?php
					echo esc_html(
						(int) $deliveries['last_code'] > 0
							? sprintf(
								/* translators: 1: HTTP status code, 2: UTC timestamp. */
								__( 'HTTP %1$d at %2$s UTC', 'wp-event-publisher' ),
								(int) $deliveries['last_code'],
								(string) $deliveries['last_at']
							)
							: __( 'no response received yet', 'wp-event-publisher' )
					);
					?>
				</td>
			</tr>
		</tbody>
	</table>

	<h2><?php esc_html_e( 'Queue', 'wp-event-publisher' ); ?></h2>

	<table class="widefat striped wpep-table wpep-system-table">
		<tbody>
			<tr>
				<th scope="row"><?php esc_html_e( 'Waiting for delivery', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( number_format_i18n( (int) $queue['waiting'] ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Currently retrying', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( number_format_i18n( (int) $queue['retrying'] ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Next attempt due (UTC)', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( '' !== (string) $queue['next_due'] ? (string) $queue['next_due'] : __( 'nothing scheduled', 'wp-event-publisher' ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Last successful delivery (UTC)', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( '' !== (string) $queue['last_success'] ? (string) $queue['last_success'] : __( 'never', 'wp-event-publisher' ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Last failed delivery (UTC)', 'wp-event-publisher' ); ?></th>
				<td>
					<?php if ( '' !== (string) $queue['last_failure'] ) : ?>
						<?php echo esc_html( (string) $queue['last_failure'] ); ?>
						<br />
						<em><?php echo esc_html( (string) $queue['last_error'] ); ?></em>
					<?php else : ?>
						<?php esc_html_e( 'never', 'wp-event-publisher' ); ?>
					<?php endif; ?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Delivered (kept for the duplicate guard)', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( number_format_i18n( (int) ( $queue['counts'][ WPEventPublisher\Queue::STATUS_DONE ] ?? 0 ) ) ); ?></td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Permanently failed', 'wp-event-publisher' ); ?></th>
				<td><?php echo esc_html( number_format_i18n( (int) ( $queue['counts'][ WPEventPublisher\Queue::STATUS_FAILED ] ?? 0 ) ) ); ?></td>
			</tr>
		</tbody>
	</table>

	<h2><?php esc_html_e( 'Registered post types', 'wp-event-publisher' ); ?></h2>

	<p class="description">
		<?php
		echo esc_html(
			WPEventPublisher\Settings::POST_TYPES_AUTO === (string) $settings['post_type_mode']
				? __( 'Detection is automatic: every public post type is watched, whichever plugin registered it, plus anything ticked manually.', 'wp-event-publisher' )
				: __( 'Detection is manual: only the ticked post types are watched.', 'wp-event-publisher' )
		);
		?>
	</p>

	<table class="widefat striped wpep-table">
		<thead>
			<tr>
				<th><?php esc_html_e( 'Post type', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Slug', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Public', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Published', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Watched', 'wp-event-publisher' ); ?></th>
			</tr>
		</thead>
		<tbody>
			<?php
			$wpep_watched = wpep()->settings()->allowed_post_types();

			foreach ( $post_types as $wpep_type ) :
				$wpep_counts = wp_count_posts( $wpep_type->name );
				$wpep_is_on  = in_array( $wpep_type->name, $wpep_watched, true );
				?>
				<tr>
					<td><?php echo esc_html( $wpep_type->labels->singular_name ?? $wpep_type->name ); ?></td>
					<td><code><?php echo esc_html( $wpep_type->name ); ?></code></td>
					<td><?php echo esc_html( ! empty( $wpep_type->public ) ? __( 'Yes', 'wp-event-publisher' ) : __( 'No', 'wp-event-publisher' ) ); ?></td>
					<td><?php echo esc_html( number_format_i18n( isset( $wpep_counts->publish ) ? (int) $wpep_counts->publish : 0 ) ); ?></td>
					<td>
						<span class="wpep-badge wpep-badge-<?php echo $wpep_is_on ? 'ok' : 'skipped'; ?>">
							<?php echo esc_html( $wpep_is_on ? __( 'Yes', 'wp-event-publisher' ) : __( 'No', 'wp-event-publisher' ) ); ?>
						</span>
					</td>
				</tr>
			<?php endforeach; ?>
		</tbody>
	</table>
</div>
