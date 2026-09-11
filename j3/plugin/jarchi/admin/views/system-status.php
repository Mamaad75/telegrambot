<?php
/**
 * System status screen.
 *
 * @package WPEventPublisher
 *
 * @var array<int,array{label:string,rows:array}> $report Grouped status report.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_status_labels = array(
	WPEventPublisher\SystemStatus::OK   => __( 'سالم', 'wp-event-publisher' ),
	WPEventPublisher\SystemStatus::WARN => __( 'هشدار', 'wp-event-publisher' ),
	WPEventPublisher\SystemStatus::FAIL => __( 'اشکال', 'wp-event-publisher' ),
	WPEventPublisher\SystemStatus::INFO => __( 'اطلاعات', 'wp-event-publisher' ),
);
?>
<div class="wrap wpep-wrap">
	<h1><?php esc_html_e( 'وضعیت سیستم', 'wp-event-publisher' ); ?></h1>

	<p class="description">
		<?php esc_html_e( 'این صفحه نشان می‌دهد جارچی روی این سایت چه چیزی را می‌بیند. اگر افزونه‌ای را نصب کرده‌اید و اینجا دیده نمی‌شود، جارچی هم آن را نمی‌بیند.', 'wp-event-publisher' ); ?>
	</p>

	<?php foreach ( $report as $wpep_group ) : ?>
		<div class="wpep-card">
			<h2 class="wpep-card__title"><?php echo esc_html( $wpep_group['label'] ); ?></h2>

			<table class="wpep-status-table">
				<caption class="screen-reader-text"><?php echo esc_html( $wpep_group['label'] ); ?></caption>
				<tbody>
					<?php foreach ( $wpep_group['rows'] as $wpep_row ) : ?>
						<tr>
							<th scope="row"><?php echo esc_html( $wpep_row['label'] ); ?></th>
							<td>
								<span class="wpep-status wpep-status--<?php echo esc_attr( $wpep_row['status'] ); ?>">
									<span class="wpep-status__dot" aria-hidden="true"></span>
									<?php // The state is written out, not only coloured. ?>
									<span class="screen-reader-text"><?php echo esc_html( $wpep_status_labels[ $wpep_row['status'] ] ?? '' ); ?>:</span>
									<?php echo esc_html( $wpep_row['value'] ); ?>
								</span>

								<?php if ( '' !== $wpep_row['note'] ) : ?>
									<p class="wpep-card__hint"><?php echo esc_html( $wpep_row['note'] ); ?></p>
								<?php endif; ?>
							</td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>
	<?php endforeach; ?>
</div>
