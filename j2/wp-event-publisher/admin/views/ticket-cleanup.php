<?php
/**
 * Ticket cleanup tool.
 *
 * Uses the existing card and button styles rather than introducing any of its
 * own — this is a tool being added to the plugin, not a redesign of it.
 *
 * @package WPEventPublisher
 *
 * @var array<string,mixed>|null $job       Running job.
 * @var int                      $automated Automated ticket count.
 * @var int                      $all       Total ticket count.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_post_url = admin_url( 'admin-post.php' );

// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only notice.
$wpep_notice = isset( $_GET['cleanup'] ) ? sanitize_key( wp_unslash( (string) $_GET['cleanup'] ) ) : '';
?>
<div class="wrap wpep-wrap wpep-dashboard wpep-inner-page" dir="rtl">

	<?php if ( 'unconfirmed' === $wpep_notice ) : ?>
		<div class="notice notice-error"><p><?php esc_html_e( 'برای حذف همهٔ تیکت‌ها باید عبارت DELETE را وارد کنید.', 'wp-event-publisher' ); ?></p></div>
	<?php elseif ( 'cancelled' === $wpep_notice ) : ?>
		<div class="notice notice-info"><p><?php esc_html_e( 'پاک‌سازی متوقف شد. تیکت‌هایی که تا این لحظه حذف شده‌اند برنمی‌گردند.', 'wp-event-publisher' ); ?></p></div>
	<?php endif; ?>

	<section class="wpep-card">
		<h1 class="wpep-card__title"><?php esc_html_e( 'پاک‌سازی تیکت‌ها', 'wp-event-publisher' ); ?></h1>
		<p class="wpep-card__hint">
			<?php esc_html_e( 'حذف دسته‌ای تیکت‌ها. حذف در بسته‌های ۱۰۰تایی انجام می‌شود تا روی سایت‌های بزرگ هم درخواست نیمه‌کاره رها نشود. تا وقتی پاک‌سازی در جریان است، تیکت‌های خودکار متوقف می‌مانند تا همزمان جدول را دوباره پر نکنند.', 'wp-event-publisher' ); ?>
		</p>
		<p class="wpep-card__hint"><strong><?php esc_html_e( 'این کار برگشت‌پذیر نیست. فقط تیکت‌های جارچی حذف می‌شوند؛ نوشته‌ها، برگه‌ها، کاربران و سفارش‌ها دست نمی‌خورند.', 'wp-event-publisher' ); ?></strong></p>
	</section>

	<?php if ( null !== $job ) : ?>
		<section class="wpep-card" data-jarchi-cleanup data-nonce="<?php echo esc_attr( wp_create_nonce( WPEventPublisher\Tickets::AJAX_NONCE ) ); ?>" data-ajax-url="<?php echo esc_attr( admin_url( 'admin-ajax.php' ) ); ?>">
			<h2 class="wpep-card__title"><?php esc_html_e( 'در حال پاک‌سازی', 'wp-event-publisher' ); ?></h2>

			<p class="jarchi-cleanup__status" data-jarchi-cleanup-status>
				<?php
				printf(
					/* translators: 1: deleted so far, 2: total. */
					esc_html__( '%1$s از %2$s حذف شد…', 'wp-event-publisher' ),
					esc_html( (string) ( $job['deleted'] ?? 0 ) ),
					esc_html( (string) ( $job['total'] ?? 0 ) )
				);
				?>
			</p>

			<p class="wpep-card__hint"><?php esc_html_e( 'این صفحه را باز نگه دارید تا پاک‌سازی کامل شود.', 'wp-event-publisher' ); ?></p>

			<form method="post" action="<?php echo esc_url( $wpep_post_url ); ?>">
				<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>
				<input type="hidden" name="action" value="wpep_ticket_cleanup_cancel" />
				<button type="submit" class="button"><?php esc_html_e( 'توقف', 'wp-event-publisher' ); ?></button>
			</form>
		</section>
	<?php else : ?>
		<section class="wpep-card">
			<h2 class="wpep-card__title"><?php esc_html_e( 'حذف تیکت‌های خودکار', 'wp-event-publisher' ); ?></h2>
			<p class="wpep-card__hint">
				<?php
				printf(
					/* translators: %s: count. */
					esc_html__( 'فقط تیکت‌هایی که قانون‌های خودکار ساخته‌اند: %s تیکت.', 'wp-event-publisher' ),
					esc_html( number_format_i18n( $automated ) )
				);
				?>
			</p>

			<form method="post" action="<?php echo esc_url( $wpep_post_url ); ?>">
				<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>
				<input type="hidden" name="action" value="wpep_ticket_cleanup_start" />
				<input type="hidden" name="scope" value="automated" />
				<button
					type="submit"
					class="button button-primary"
					<?php disabled( 0 === $automated ); ?>
					onclick="return confirm('<?php echo esc_js( __( 'همهٔ تیکت‌های خودکار حذف شوند؟ این کار برگشت‌پذیر نیست.', 'wp-event-publisher' ) ); ?>');"
				><?php esc_html_e( 'حذف تیکت‌های خودکار', 'wp-event-publisher' ); ?></button>
			</form>
		</section>

		<section class="wpep-card">
			<h2 class="wpep-card__title"><?php esc_html_e( 'حذف همهٔ تیکت‌ها', 'wp-event-publisher' ); ?></h2>
			<p class="wpep-card__hint">
				<?php
				printf(
					/* translators: %s: count. */
					esc_html__( 'همهٔ تیکت‌ها، شامل تیکت‌هایی که کاربران خودشان ثبت کرده‌اند: %s تیکت.', 'wp-event-publisher' ),
					esc_html( number_format_i18n( $all ) )
				);
				?>
			</p>

			<form method="post" action="<?php echo esc_url( $wpep_post_url ); ?>">
				<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>
				<input type="hidden" name="action" value="wpep_ticket_cleanup_start" />
				<input type="hidden" name="scope" value="all" />

				<label class="wpep-field" style="max-width:280px">
					<span><?php esc_html_e( 'برای تأیید، عبارت DELETE را بنویسید', 'wp-event-publisher' ); ?></span>
					<input type="text" name="confirm" autocomplete="off" placeholder="DELETE" />
				</label>

				<button
					type="submit"
					class="button button-link-delete"
					<?php disabled( 0 === $all ); ?>
					onclick="return confirm('<?php echo esc_js( __( 'همهٔ تیکت‌ها حذف شوند؟ این کار برگشت‌پذیر نیست.', 'wp-event-publisher' ) ); ?>');"
				><?php esc_html_e( 'حذف همهٔ تیکت‌ها', 'wp-event-publisher' ); ?></button>
			</form>
		</section>
	<?php endif; ?>
</div>
