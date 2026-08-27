<?php
/**
 * Ticket categories screen.
 *
 * @package WPEventPublisher
 *
 * @var \WP_Term[] $categories Categories.
 * @var string     $notice     Result of the last action.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap wpep-wrap wpep-dashboard wpep-inner-page" dir="rtl">

	<?php if ( '' !== (string) $notice ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php echo esc_html( $notice ); ?></p></div>
	<?php endif; ?>

	<div class="wpep-card">
		<div class="wpep-card__head">
			<div>
				<h2 class="wpep-card__title"><?php esc_html_e( 'دسته‌بندی تیکت‌ها', 'wp-event-publisher' ); ?></h2>
				<p class="wpep-card__hint"><?php esc_html_e( 'دسته‌های موضوعی تیکت را جدا از دپارتمان تعریف کنید.', 'wp-event-publisher' ); ?></p>
			</div>
		</div>

		<form method="post" class="wpep-grid-2">
			<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>

			<label class="wpep-field">
				<span><?php esc_html_e( 'نام دسته', 'wp-event-publisher' ); ?></span>
				<input type="text" name="name" required />
			</label>

			<label class="wpep-field">
				<span><?php esc_html_e( 'دسته والد', 'wp-event-publisher' ); ?></span>
				<select name="parent">
					<option value="0"><?php esc_html_e( 'بدون والد', 'wp-event-publisher' ); ?></option>
					<?php foreach ( $categories as $wpep_category ) : ?>
						<option value="<?php echo esc_attr( (string) $wpep_category->term_id ); ?>"><?php echo esc_html( $wpep_category->name ); ?></option>
					<?php endforeach; ?>
				</select>
			</label>

			<div>
				<button type="submit" class="button button-primary" name="jarchi_category_save" value="1"><?php esc_html_e( 'افزودن دسته', 'wp-event-publisher' ); ?></button>
			</div>
		</form>
	</div>

	<div class="wpep-card">
		<h2 class="wpep-card__title"><?php esc_html_e( 'دسته‌های فعلی', 'wp-event-publisher' ); ?></h2>

		<?php if ( ! $categories ) : ?>
			<div class="wpep-empty"><?php esc_html_e( 'هنوز دسته‌ای ساخته نشده است.', 'wp-event-publisher' ); ?></div>
		<?php else : ?>
			<div class="wpep-ticket-list">
				<?php foreach ( $categories as $wpep_category ) : ?>
					<div class="wpep-ticket-row">
						<span>
							<strong><?php echo esc_html( $wpep_category->name ); ?></strong>
							<small>
								<?php
								printf(
									/* translators: %s: number of tickets. */
									esc_html__( '%s تیکت', 'wp-event-publisher' ),
									esc_html( (string) $wpep_category->count )
								);
								?>
							</small>
						</span>

						<form method="post" class="wpep-inline-form">
							<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>
							<input type="hidden" name="term_id" value="<?php echo esc_attr( (string) $wpep_category->term_id ); ?>" />
							<button
								type="submit"
								class="button button-link-delete"
								name="jarchi_category_delete"
								value="1"
								onclick="return confirm('<?php echo esc_js( __( 'این دسته حذف شود؟', 'wp-event-publisher' ) ); ?>');"
							><?php esc_html_e( 'حذف', 'wp-event-publisher' ); ?></button>
						</form>
					</div>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</div>
</div>
