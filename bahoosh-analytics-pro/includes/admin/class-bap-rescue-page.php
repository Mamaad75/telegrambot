<?php
/**
 * The search rescue screen.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shows searches that returned nothing, and what the shop already sells.
 *
 * Each row is one phrase a shopper typed and got nothing back, with the verdict
 * that matters: either there is a product that is probably what they meant, so
 * the shop needs the word, or there is not, so the shop needs the product.
 *
 * Nothing is applied. Synonyms belong to whichever search plugin the shop runs.
 *
 * @since 4.14.0
 */
class BAP_Rescue_Page {

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
		<div class="wrap bap-wrap bap-rescue">
			<?php
			BAP_Admin::render_page_header(
				__( 'نجات جست‌وجو', 'bahoosh-analytics-pro' ),
				__( 'عبارت‌هایی که مشتری جست‌وجو کرده و هیچ نتیجه‌ای نگرفته، کنار نزدیک‌ترین محصولی که همین حالا در فروشگاه دارید.', 'bahoosh-analytics-pro' ),
				BAP_Admin::RESCUE_SLUG
			);
			?>

			<div class="bap-notice-inline">
				<span class="dashicons dashicons-info-outline"></span>
				<p>
					<strong><?php esc_html_e( 'این صفحه هیچ تغییری در سایت شما نمی‌دهد.', 'bahoosh-analytics-pro' ); ?></strong>
					<?php esc_html_e( 'هم‌معنی‌ها در افزونه جست‌وجوی خودتان تنظیم می‌شوند و افزونه باهوش به آن دسترسی ندارد. اینجا فقط می‌گوید کدام کلمه را کم دارید و کدام محصول را.', 'bahoosh-analytics-pro' ); ?>
				</p>
			</div>

			<div class="bap-toolbar bap-toolbar--glass">
				<label class="bap-toolbar-field">
					<span><?php esc_html_e( 'بازه زمانی', 'bahoosh-analytics-pro' ); ?></span>
					<select id="bap-rescue-range">
						<option value="last_7_days"><?php esc_html_e( '۷ روز گذشته', 'bahoosh-analytics-pro' ); ?></option>
						<option value="last_30_days" selected><?php esc_html_e( '۳۰ روز گذشته', 'bahoosh-analytics-pro' ); ?></option>
						<option value="last_90_days"><?php esc_html_e( '۹۰ روز گذشته', 'bahoosh-analytics-pro' ); ?></option>
					</select>
				</label>
				<button type="button" class="button" id="bap-rescue-reload"><?php esc_html_e( 'نمایش', 'bahoosh-analytics-pro' ); ?></button>
				<?php if ( current_user_can( BAP_Admin::settings_capability() ) ) : ?>
					<button type="button" class="button button-primary bap-primary" id="bap-rescue-fresh"><?php esc_html_e( 'تطبیق دوباره با مدل', 'bahoosh-analytics-pro' ); ?></button>
				<?php endif; ?>
				<span class="bap-status" id="bap-rescue-status"></span>
			</div>

			<div class="bap-kpi-grid" id="bap-rescue-counts"></div>

			<div id="bap-rescue-list" class="bap-rescue-list"></div>
		</div>
		<?php
	}
}
