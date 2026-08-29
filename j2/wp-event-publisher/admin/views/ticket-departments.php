<?php
/**
 * Ticket departments screen.
 *
 * @package WPEventPublisher
 *
 * @var \WP_Term[]                  $departments          Departments.
 * @var \WP_Term[]                  $categories           Categories.
 * @var array<int,array<int,object>> $agents_by_department Agents per department.
 * @var string                      $notice               Result of the last action.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap wpep-wrap wpep-dashboard wpep-inner-page" dir="rtl">

	<?php if ( '' !== (string) $notice ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php echo esc_html( $notice ); ?></p></div>
	<?php endif; ?>

	<div class="wpep-ticket-depts">
		<section class="wpep-card">
			<div class="wpep-card__head">
				<div>
					<h2 class="wpep-card__title"><?php esc_html_e( 'دپارتمان‌های تیکت', 'wp-event-publisher' ); ?></h2>
					<p class="wpep-card__hint"><?php esc_html_e( 'تیکت‌ها را بر اساس تیم پشتیبانی، فروش، فنی و هر ساختار دلخواه دسته‌بندی کنید. هر پشتیبان فقط تیکت‌های دپارتمان خودش را می‌بیند.', 'wp-event-publisher' ); ?></p>
				</div>
			</div>

			<div style="margin-top:12px">
				<?php if ( empty( $departments ) ) : ?>
					<div class="wpep-empty"><?php esc_html_e( 'هنوز دپارتمانی ساخته نشده است.', 'wp-event-publisher' ); ?></div>
				<?php else : ?>
					<?php foreach ( $departments as $wpep_department ) : ?>
						<?php $wpep_agents = (array) ( $agents_by_department[ (int) $wpep_department->term_id ] ?? array() ); ?>
						<div class="wpep-ticket-dept-row">
							<span class="wpep-ticket-dept-row__main">
								<strong><?php echo esc_html( $wpep_department->name ); ?></strong>
								<small>
									<?php
									printf(
										/* translators: 1: ticket count, 2: agent count. */
										esc_html__( '%1$s تیکت · %2$s پشتیبان', 'wp-event-publisher' ),
										esc_html( (string) $wpep_department->count ),
										esc_html( (string) count( $wpep_agents ) )
									);
									?>
									<?php if ( $wpep_agents ) : ?>
										— <?php echo esc_html( implode( '، ', array_map( static fn( $a ) => (string) $a->display_name, $wpep_agents ) ) ); ?>
									<?php endif; ?>
								</small>
							</span>

							<form method="post" class="wpep-inline-form">
								<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>
								<input type="hidden" name="term_id" value="<?php echo esc_attr( (string) $wpep_department->term_id ); ?>" />
								<button
									type="submit"
									class="button button-link-delete"
									name="jarchi_department_delete"
									value="1"
									onclick="return confirm('<?php echo esc_js( __( 'این دپارتمان حذف شود؟ تیکت‌های داخل آن حذف نمی‌شوند و بدون دپارتمان می‌مانند.', 'wp-event-publisher' ) ); ?>');"
								><?php esc_html_e( 'حذف', 'wp-event-publisher' ); ?></button>
							</form>
						</div>
					<?php endforeach; ?>
				<?php endif; ?>
			</div>
		</section>

		<section class="wpep-card">
			<h3 class="wpep-card__title"><?php esc_html_e( 'افزودن دپارتمان', 'wp-event-publisher' ); ?></h3>

			<form method="post" style="margin-top:12px">
				<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>

				<label>
					<?php esc_html_e( 'نام دپارتمان', 'wp-event-publisher' ); ?>
					<input type="text" name="name" required style="width:100%;margin-top:6px" />
				</label>

				<label style="display:block;margin-top:10px">
					<?php esc_html_e( 'دپارتمان والد', 'wp-event-publisher' ); ?>
					<select name="parent" style="width:100%;margin-top:6px">
						<option value="0">—</option>
						<?php foreach ( $departments as $wpep_department ) : ?>
							<option value="<?php echo esc_attr( (string) $wpep_department->term_id ); ?>"><?php echo esc_html( $wpep_department->name ); ?></option>
						<?php endforeach; ?>
					</select>
				</label>

				<button type="submit" class="button button-primary" name="jarchi_department_save" value="1" style="margin-top:12px"><?php esc_html_e( 'افزودن دپارتمان', 'wp-event-publisher' ); ?></button>
			</form>
		</section>
	</div>
</div>
