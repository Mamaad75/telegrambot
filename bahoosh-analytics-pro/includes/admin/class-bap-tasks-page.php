<?php
/**
 * The UX fix list.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shows what to fix, where, and how to open it.
 *
 * Every other screen in the plugin reports. This one assigns work: each row is
 * a problem the data found, the page it happens on, a button that opens
 * whichever editor owns that page, and a tick box for when it is done.
 *
 * It applies nothing, and says so on the screen. That is worth being explicit
 * about to the person reading it, because the plugin *can* change prices
 * automatically and they may reasonably assume this works the same way.
 *
 * @since 4.11.0
 */
class BAP_Tasks_Page {

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
		<div class="wrap bap-wrap bap-tasks">
			<?php
			BAP_Admin::render_page_header(
				__( 'کارهایی که باید انجام شود', 'bahoosh-analytics-pro' ),
				__( 'هر ردیف یک مشکل واقعی است که در داده‌های سایت شما پیدا شده، با صفحه‌ای که در آن رخ می‌دهد و دکمه‌ای که همان صفحه را در ویرایشگر درست باز می‌کند.', 'bahoosh-analytics-pro' ),
				BAP_Admin::TASKS_SLUG
			);
			?>

			<div class="bap-notice-inline">
				<span class="dashicons dashicons-info-outline"></span>
				<p>
					<strong><?php esc_html_e( 'این صفحه هیچ تغییری در سایت شما نمی‌دهد.', 'bahoosh-analytics-pro' ); ?></strong>
					<?php esc_html_e( 'فقط می‌گوید کجا مشکل هست و چه چیزی را عوض کنید. تغییر دادن صفحه کار شماست — برخلاف تخفیف‌ها که ایجنت می‌تواند خودش اعمال کند، چیدمان و محتوای صفحه هیچ‌وقت خودکار عوض نمی‌شود.', 'bahoosh-analytics-pro' ); ?>
				</p>
			</div>

			<div class="bap-toolbar bap-toolbar--glass">
				<label class="bap-toolbar-field">
					<span><?php esc_html_e( 'بازه زمانی', 'bahoosh-analytics-pro' ); ?></span>
					<select id="bap-tasks-range">
						<option value="last_7_days"><?php esc_html_e( '۷ روز گذشته', 'bahoosh-analytics-pro' ); ?></option>
						<option value="last_30_days" selected><?php esc_html_e( '۳۰ روز گذشته', 'bahoosh-analytics-pro' ); ?></option>
					</select>
				</label>
				<label class="bap-toolbar-field">
					<input type="checkbox" id="bap-tasks-show-done" />
					<span><?php esc_html_e( 'نمایش انجام‌شده‌ها', 'bahoosh-analytics-pro' ); ?></span>
				</label>
				<button type="button" class="button button-primary bap-primary" id="bap-tasks-refresh"><?php esc_html_e( 'بررسی دوباره', 'bahoosh-analytics-pro' ); ?></button>
				<span class="bap-status" id="bap-tasks-status"></span>
			</div>

			<div class="bap-kpi-grid" id="bap-tasks-counts"></div>

			<div id="bap-tasks-list" class="bap-task-list"></div>
		</div>
		<?php
	}
}
