<?php
/**
 * The events-and-pages explorer.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shows what actually happened, item by item.
 *
 * The dashboard answers "how much": eight hundred page views, forty orders.
 * This screen answers "what": which pages, which events, what people typed into
 * the search box, and what has happened in the last few minutes.
 *
 * It exists because the two questions need different answers and were being
 * given the same one. A card reading "جست‌وجوها ۱۱" tells a shop owner nothing
 * they can act on; the eleven terms, three of which returned no products, tell
 * them what to stock. Same for pages: a total is a number, a list is a task.
 *
 * Everything here is read from this site's own store, so the screen works with
 * or without a collector — and it is the fastest way to confirm that tracking
 * is running at all, which is the first thing anyone checks after installing.
 *
 * @since 4.4.0
 */
class BAP_Explorer_Page {

	/**
	 * Renders the screen.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( BAP_Admin::reports_capability() ) ) {
			wp_die( esc_html__( 'اجازه مشاهده این صفحه را ندارید.', 'bahoosh-analytics-pro' ) );
		}
		?>
		<div class="wrap bap-wrap bap-explorer">
			<?php
			BAP_Admin::render_page_header(
				__( 'رویدادها و صفحات', 'bahoosh-analytics-pro' ),
				__( 'دقیقاً چه صفحاتی دیده شده، چه رویدادهایی رخ داده و کاربران دنبال چه چیزی گشته‌اند.', 'bahoosh-analytics-pro' ),
				BAP_Admin::EXPLORER_SLUG
			);
			?>

			<div class="bap-toolbar bap-toolbar--glass">
				<label class="bap-toolbar-field">
					<span><?php esc_html_e( 'بازه زمانی', 'bahoosh-analytics-pro' ); ?></span>
					<select id="bap-explorer-range">
						<option value="today"><?php esc_html_e( 'امروز', 'bahoosh-analytics-pro' ); ?></option>
						<option value="last_7_days" selected><?php esc_html_e( '۷ روز گذشته', 'bahoosh-analytics-pro' ); ?></option>
						<option value="last_30_days"><?php esc_html_e( '۳۰ روز گذشته', 'bahoosh-analytics-pro' ); ?></option>
					</select>
				</label>
				<button type="button" class="button button-primary bap-primary" id="bap-explorer-refresh"><?php esc_html_e( 'به‌روزرسانی', 'bahoosh-analytics-pro' ); ?></button>
				<span class="bap-status" id="bap-explorer-status"></span>
			</div>

			<div class="bap-explorer-grid">
				<section class="bap-section">
					<div class="bap-section-title">
						<div>
							<span class="bap-kicker"><?php esc_html_e( 'صفحات', 'bahoosh-analytics-pro' ); ?></span>
							<h2><?php esc_html_e( 'کدام صفحات دیده شده‌اند', 'bahoosh-analytics-pro' ); ?></h2>
						</div>
					</div>
					<div id="bap-explorer-pages" class="bap-explorer-table"></div>
				</section>

				<section class="bap-section">
					<div class="bap-section-title">
						<div>
							<span class="bap-kicker"><?php esc_html_e( 'رویدادها', 'bahoosh-analytics-pro' ); ?></span>
							<h2><?php esc_html_e( 'چه اتفاقاتی افتاده', 'bahoosh-analytics-pro' ); ?></h2>
						</div>
					</div>
					<div id="bap-explorer-types" class="bap-explorer-table"></div>
				</section>
			</div>

			<div class="bap-explorer-grid">
				<section class="bap-section">
					<div class="bap-section-title">
						<div>
							<span class="bap-kicker"><?php esc_html_e( 'جست‌وجو', 'bahoosh-analytics-pro' ); ?></span>
							<h2><?php esc_html_e( 'کاربران دنبال چه بودند', 'bahoosh-analytics-pro' ); ?></h2>
						</div>
					</div>
					<div id="bap-explorer-searches" class="bap-explorer-table"></div>
					<p class="bap-muted"><?php esc_html_e( 'عبارتی که تکرار شده ولی محصولی برایش ندارید، یک فرصت فروش از دست رفته است.', 'bahoosh-analytics-pro' ); ?></p>
				</section>

				<section class="bap-section">
					<div class="bap-section-title">
						<div>
							<span class="bap-kicker"><?php esc_html_e( 'مسیرها', 'bahoosh-analytics-pro' ); ?></span>
							<h2><?php esc_html_e( 'کاربران چه مسیری رفته‌اند', 'bahoosh-analytics-pro' ); ?></h2>
						</div>
					</div>
					<div id="bap-explorer-paths" class="bap-explorer-table"></div>
				</section>
			</div>

			<section class="bap-section">
				<div class="bap-section-title">
					<div>
						<span class="bap-kicker"><?php esc_html_e( 'زنده', 'bahoosh-analytics-pro' ); ?></span>
						<h2><?php esc_html_e( 'آخرین رویدادها', 'bahoosh-analytics-pro' ); ?></h2>
					</div>
				</div>
				<div id="bap-explorer-feed" class="bap-explorer-feed"></div>
			</section>
		</div>
		<?php
	}
}
