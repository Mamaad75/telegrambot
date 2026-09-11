<?php
/**
 * Logs admin view.
 *
 * @package WPEventPublisher
 *
 * @var array<int,object>   $logs  Log rows for the current page.
 * @var int                 $total Total matching rows.
 * @var int                 $pages Total pages.
 * @var array<string,mixed> $args  Current filter arguments.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_base_url = WPEventPublisher\Admin::app_url( 'logs' );

// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only notice display.
$wpep_notice = isset( $_GET['wpep_notice'] ) ? sanitize_key( wp_unslash( $_GET['wpep_notice'] ) ) : '';
?>
<div class="wrap wpep-wrap">
	<h1><?php esc_html_e( 'تاریخچه انتقال', 'wp-event-publisher' ); ?></h1>

	<p class="description">
		<?php esc_html_e( 'One publish produces several entries: the hook that fired, the event that was created, how it was scheduled, the request that went out and the status the endpoint returned. Turn on Debug Mode in Settings to also record the steps that decided nothing should happen.', 'wp-event-publisher' ); ?>
	</p>

	<?php if ( 'cleared' === $wpep_notice ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'All logs deleted.', 'wp-event-publisher' ); ?></p></div>
	<?php elseif ( 'deleted' === $wpep_notice ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Log entry deleted.', 'wp-event-publisher' ); ?></p></div>
	<?php elseif ( 'error' === $wpep_notice ) : ?>
		<div class="notice notice-error is-dismissible"><p><?php esc_html_e( 'The requested log action failed.', 'wp-event-publisher' ); ?></p></div>
	<?php endif; ?>

	<form method="get" action="<?php echo esc_url( admin_url( 'admin.php' ) ); ?>" class="wpep-filters">
		<input type="hidden" name="page" value="wp-event-publisher-logs" />

		<input
			type="search"
			name="s"
			value="<?php echo esc_attr( (string) $args['search'] ); ?>"
			placeholder="<?php esc_attr_e( 'Search URL, payload, response, message…', 'wp-event-publisher' ); ?>"
		/>

		<select name="status">
			<option value=""><?php esc_html_e( 'All statuses', 'wp-event-publisher' ); ?></option>
			<?php foreach ( WPEventPublisher\Logger::STATUSES as $wpep_status_option ) : ?>
				<option value="<?php echo esc_attr( $wpep_status_option ); ?>" <?php selected( $args['status'], $wpep_status_option ); ?>>
					<?php echo esc_html( ucfirst( $wpep_status_option ) ); ?>
				</option>
			<?php endforeach; ?>
		</select>

		<select name="event_type">
			<option value=""><?php esc_html_e( 'All event types', 'wp-event-publisher' ); ?></option>
			<?php foreach ( array( 'created', 'updated', 'deleted', 'test', 'sample' ) as $wpep_type_option ) : ?>
				<option value="<?php echo esc_attr( $wpep_type_option ); ?>" <?php selected( $args['event_type'], $wpep_type_option ); ?>>
					<?php echo esc_html( ucfirst( $wpep_type_option ) ); ?>
				</option>
			<?php endforeach; ?>
		</select>

		<input
			type="text"
			name="stage"
			value="<?php echo esc_attr( (string) $args['stage'] ); ?>"
			placeholder="<?php esc_attr_e( 'Stage, e.g. webhook.response', 'wp-event-publisher' ); ?>"
			class="code"
		/>

		<input
			type="text"
			name="event_id"
			value="<?php echo esc_attr( (string) $args['event_id'] ); ?>"
			placeholder="<?php esc_attr_e( 'Event ID', 'wp-event-publisher' ); ?>"
			class="code"
		/>

		<input
			type="number"
			name="post_id"
			min="0"
			value="<?php echo esc_attr( $args['post_id'] ? (string) $args['post_id'] : '' ); ?>"
			placeholder="<?php esc_attr_e( 'Post ID', 'wp-event-publisher' ); ?>"
			class="small-text"
		/>

		<?php submit_button( __( 'Filter', 'wp-event-publisher' ), 'secondary', '', false ); ?>
	</form>

	<div class="wpep-log-actions">
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="wpep-inline-form">
			<?php wp_nonce_field( WPEventPublisher\Admin::NONCE_LOGS ); ?>
			<input type="hidden" name="action" value="wpep_export_logs" />
			<input type="hidden" name="s" value="<?php echo esc_attr( (string) $args['search'] ); ?>" />
			<input type="hidden" name="status" value="<?php echo esc_attr( (string) $args['status'] ); ?>" />
			<input type="hidden" name="stage" value="<?php echo esc_attr( (string) $args['stage'] ); ?>" />
			<input type="hidden" name="event_id" value="<?php echo esc_attr( (string) $args['event_id'] ); ?>" />
			<input type="hidden" name="event_type" value="<?php echo esc_attr( (string) $args['event_type'] ); ?>" />
			<input type="hidden" name="site_id" value="<?php echo esc_attr( (string) $args['site_id'] ); ?>" />
			<input type="hidden" name="post_id" value="<?php echo esc_attr( (string) $args['post_id'] ); ?>" />
			<?php submit_button( __( 'Export Logs (CSV)', 'wp-event-publisher' ), 'secondary', '', false ); ?>
		</form>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="wpep-inline-form" data-wpep-confirm="clear">
			<?php wp_nonce_field( WPEventPublisher\Admin::NONCE_LOGS ); ?>
			<input type="hidden" name="action" value="wpep_logs_action" />
			<input type="hidden" name="task" value="clear" />
			<?php submit_button( __( 'Clear Logs', 'wp-event-publisher' ), 'delete', '', false ); ?>
		</form>
	</div>

	<p class="wpep-total">
		<?php
		printf(
			/* translators: %s: number of log entries. */
			esc_html( _n( '%s log entry found.', '%s log entries found.', $total, 'wp-event-publisher' ) ),
			esc_html( number_format_i18n( $total ) )
		);
		?>
	</p>

	<table class="widefat striped wpep-table">
		<thead>
			<tr>
				<th><?php esc_html_e( 'ID', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Stage', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Status', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Type', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Post', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Try', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'HTTP', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Message', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Date (UTC)', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Details', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Actions', 'wp-event-publisher' ); ?></th>
			</tr>
		</thead>
		<tbody>
			<?php if ( empty( $logs ) ) : ?>
				<tr>
					<td colspan="11"><?php esc_html_e( 'No log entries match your filters.', 'wp-event-publisher' ); ?></td>
				</tr>
			<?php else : ?>
				<?php foreach ( $logs as $wpep_row ) : ?>
					<tr>
						<td><?php echo esc_html( (string) $wpep_row->id ); ?></td>
						<td><code><?php echo esc_html( (string) ( $wpep_row->stage ?? '' ) ); ?></code></td>
						<td>
							<span class="wpep-badge wpep-badge-<?php echo esc_attr( (string) $wpep_row->status ); ?>">
								<?php echo esc_html( (string) $wpep_row->status ); ?>
							</span>
						</td>
						<td>
							<?php if ( '' !== (string) $wpep_row->event_type ) : ?>
								<span class="wpep-event-type"><?php echo esc_html( (string) $wpep_row->event_type ); ?></span>
							<?php else : ?>
								&mdash;
							<?php endif; ?>
						</td>
						<td>
							<?php if ( $wpep_row->post_id > 0 ) : ?>
								<a href="<?php echo esc_url( (string) get_edit_post_link( (int) $wpep_row->post_id ) ); ?>">
									#<?php echo esc_html( (string) $wpep_row->post_id ); ?>
								</a>
							<?php else : ?>
								&mdash;
							<?php endif; ?>
						</td>
						<td><?php echo esc_html( (string) ( $wpep_row->attempt ?? 0 ) ); ?></td>
						<td><?php echo esc_html( $wpep_row->response_code ? (string) $wpep_row->response_code : '—' ); ?></td>
						<td class="wpep-cell-message"><?php echo esc_html( mb_substr( (string) ( $wpep_row->message ?? '' ), 0, 220 ) ); ?></td>
						<td><?php echo esc_html( (string) $wpep_row->created_at ); ?></td>
						<td>
							<button type="button" class="button-link wpep-toggle-details" aria-expanded="false">
								<?php esc_html_e( 'View', 'wp-event-publisher' ); ?>
							</button>
						</td>
						<td>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="wpep-inline-form" data-wpep-confirm="delete">
								<?php wp_nonce_field( WPEventPublisher\Admin::NONCE_LOGS ); ?>
								<input type="hidden" name="action" value="wpep_logs_action" />
								<input type="hidden" name="task" value="delete" />
								<input type="hidden" name="log_id" value="<?php echo esc_attr( (string) $wpep_row->id ); ?>" />
								<button type="submit" class="button-link wpep-delete-link"><?php esc_html_e( 'Delete', 'wp-event-publisher' ); ?></button>
							</form>
						</td>
					</tr>
					<tr class="wpep-details-row" hidden>
						<td colspan="11">
							<h4><?php esc_html_e( 'Event ID', 'wp-event-publisher' ); ?></h4>
							<pre class="wpep-pre"><?php echo esc_html( (string) $wpep_row->event_id ); ?></pre>
							<h4><?php esc_html_e( 'Message', 'wp-event-publisher' ); ?></h4>
							<pre class="wpep-pre"><?php echo esc_html( (string) ( $wpep_row->message ?? '' ) ); ?></pre>
							<h4><?php esc_html_e( 'Request URL', 'wp-event-publisher' ); ?></h4>
							<pre class="wpep-pre"><?php echo esc_html( (string) $wpep_row->request_url ); ?></pre>
							<h4><?php esc_html_e( 'Payload', 'wp-event-publisher' ); ?></h4>
							<pre class="wpep-pre"><?php echo esc_html( (string) $wpep_row->payload ); ?></pre>
							<h4><?php esc_html_e( 'Response Body', 'wp-event-publisher' ); ?></h4>
							<pre class="wpep-pre"><?php echo esc_html( (string) $wpep_row->response_body ); ?></pre>
						</td>
					</tr>
				<?php endforeach; ?>
			<?php endif; ?>
		</tbody>
	</table>

	<?php if ( $pages > 1 ) : ?>
		<div class="tablenav">
			<div class="tablenav-pages">
				<?php
				echo wp_kses_post(
					(string) paginate_links(
						array(
							'base'      => add_query_arg(
								array(
									's'          => rawurlencode( (string) $args['search'] ),
									'status'     => rawurlencode( (string) $args['status'] ),
									'stage'      => rawurlencode( (string) $args['stage'] ),
									'event_id'   => rawurlencode( (string) $args['event_id'] ),
									'event_type' => rawurlencode( (string) $args['event_type'] ),
									'site_id'    => rawurlencode( (string) $args['site_id'] ),
									'post_id'    => $args['post_id'] ? (int) $args['post_id'] : false,
									'paged'      => '%#%',
								),
								$wpep_base_url
							),
							'format'    => '',
							'current'   => (int) $args['page'],
							'total'     => $pages,
							'prev_text' => __( '&laquo;', 'wp-event-publisher' ),
							'next_text' => __( '&raquo;', 'wp-event-publisher' ),
						)
					)
				);
				?>
			</div>
		</div>
	<?php endif; ?>
</div>
