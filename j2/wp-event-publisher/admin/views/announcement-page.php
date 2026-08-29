<?php
/**
 * "Announcement page" screen.
 *
 * Chooses which WordPress page shows the announcements, and hands the
 * administrator straight to whichever editor their site uses. The plugin
 * supplies a shortcode and a page; the layout is WordPress's job, not
 * Jarchi's.
 *
 * @package WPEventPublisher
 *
 * @var \WP_Post|null $page      Currently selected page, when it still exists.
 * @var array         $pages     Selectable pages.
 * @var bool          $elementor Whether Elementor is available.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_page_id = $page instanceof WP_Post ? (int) $page->ID : 0;
?>
<div class="wrap wpep-wrap">
	<h1><?php esc_html_e( 'صفحه اطلاعیه‌ها', 'wp-event-publisher' ); ?></h1>

	<p class="description">
		<?php esc_html_e( 'یک صفحه از سایت را انتخاب کنید تا اطلاعیه‌ها در آن نمایش داده شوند. این صفحه یک صفحه معمولی وردپرس است، بنابراین می‌توانید آن را با المنتور یا هر ویرایشگر دیگری که استفاده می‌کنید بچینید.', 'wp-event-publisher' ); ?>
	</p>

	<?php settings_errors(); ?>

	<div class="wpep-card">
		<form method="post" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>">
			<?php settings_fields( 'wpep_announcement_page_group' ); ?>

			<h2 class="wpep-card__title"><?php esc_html_e( 'انتخاب صفحه', 'wp-event-publisher' ); ?></h2>

			<p>
				<label for="wpep-announcement-page" class="screen-reader-text">
					<?php esc_html_e( 'صفحه اطلاعیه‌ها', 'wp-event-publisher' ); ?>
				</label>

				<select id="wpep-announcement-page" name="<?php echo esc_attr( WPEventPublisher\Announcements::OPTION_PAGE ); ?>" class="regular-text">
					<option value="0"><?php esc_html_e( '— انتخاب نشده —', 'wp-event-publisher' ); ?></option>

					<?php foreach ( $pages as $wpep_option_page ) : ?>
						<option value="<?php echo esc_attr( (string) $wpep_option_page->ID ); ?>" <?php selected( $wpep_page_id, (int) $wpep_option_page->ID ); ?>>
							<?php echo esc_html( $wpep_option_page->post_title ); ?>
						</option>
					<?php endforeach; ?>
				</select>
			</p>

			<p class="wpep-card__hint">
				<?php esc_html_e( 'اگر صفحه‌ای که انتخاب می‌کنید شورت‌کد اطلاعیه‌ها را نداشته باشد، این شورت‌کد را در آن قرار دهید:', 'wp-event-publisher' ); ?>
				<code>[jarchi_announcements]</code>
			</p>

			<?php submit_button( __( 'ذخیره تغییرات', 'wp-event-publisher' ) ); ?>
		</form>
	</div>

	<div class="wpep-card">
		<h2 class="wpep-card__title"><?php esc_html_e( 'ساخت صفحه تازه', 'wp-event-publisher' ); ?></h2>

		<p class="wpep-card__hint">
			<?php esc_html_e( 'اگر هنوز صفحه‌ای ندارید، جارچی می‌تواند یک صفحه آماده با شورت‌کد اطلاعیه‌ها بسازد و همین‌جا انتخابش کند.', 'wp-event-publisher' ); ?>
		</p>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="wpep_create_announcement_page" />
			<?php wp_nonce_field( 'wpep_create_announcement_page' ); ?>

			<?php submit_button( __( 'ساخت صفحه اطلاعیه‌ها', 'wp-event-publisher' ), 'secondary', 'submit', false ); ?>
		</form>
	</div>

	<?php if ( $page instanceof WP_Post ) : ?>
		<div class="wpep-card">
			<h2 class="wpep-card__title"><?php esc_html_e( 'ویرایش ظاهر صفحه', 'wp-event-publisher' ); ?></h2>

			<p class="wpep-card__hint">
				<?php
				printf(
					/* translators: %s: page title. */
					esc_html__( 'صفحه فعلی: %s', 'wp-event-publisher' ),
					'<strong>' . esc_html( $page->post_title ) . '</strong>'
				);
				?>
			</p>

			<p>
				<?php if ( $elementor ) : ?>
					<a class="button button-primary" href="<?php echo esc_url( WPEventPublisher\Announcements::elementor_edit_url( $wpep_page_id ) ); ?>">
						<?php esc_html_e( 'ویرایش با المنتور', 'wp-event-publisher' ); ?>
					</a>
				<?php endif; ?>

				<a class="button" href="<?php echo esc_url( get_edit_post_link( $wpep_page_id ) ); ?>">
					<?php esc_html_e( 'ویرایش با ویرایشگر وردپرس', 'wp-event-publisher' ); ?>
				</a>

				<a class="button" href="<?php echo esc_url( (string) get_permalink( $wpep_page_id ) ); ?>" target="_blank" rel="noopener">
					<?php esc_html_e( 'مشاهده صفحه', 'wp-event-publisher' ); ?>
				</a>
			</p>

			<?php if ( ! $elementor ) : ?>
				<p class="wpep-card__hint">
					<?php esc_html_e( 'المنتور روی این سایت نصب نیست. صفحه با ویرایشگر وردپرس هم کاملاً قابل ویرایش است؛ اگر المنتور را نصب کنید، دکمه ویرایش با المنتور همین‌جا اضافه می‌شود.', 'wp-event-publisher' ); ?>
				</p>
			<?php endif; ?>
		</div>
	<?php endif; ?>
</div>
