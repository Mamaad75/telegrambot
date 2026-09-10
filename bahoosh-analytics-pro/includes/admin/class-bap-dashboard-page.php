<?php
/**
 * Dashboard screen.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Renders the analytics dashboard shell.
 *
 * The metric cards and panels are described by filterable arrays rather than
 * hard-coded markup, so a future module (funnels, cohorts, retention) can add
 * a card or a table without touching this file or the JavaScript.
 */
class BAP_Dashboard_Page {

	/**
	 * Metric cards shown at the top of the dashboard.
	 *
	 * @return array<string,array{label:string,format:string}>
	 */
	public static function cards() {
		$cards = array(
			'total_events'    => array(
				'label'  => __( 'کل رویدادها', 'bahoosh-analytics-pro' ),
				'format' => 'integer',
			),
			'unique_users'    => array(
				'label'  => __( 'کاربران یکتا', 'bahoosh-analytics-pro' ),
				'format' => 'integer',
			),
			'sessions'        => array(
				'label'  => __( 'نشست‌ها', 'bahoosh-analytics-pro' ),
				'format' => 'integer',
			),
			'realtime_users'  => array(
				'label'  => __( 'کاربران آنلاین', 'bahoosh-analytics-pro' ),
				'format' => 'integer',
			),
			'page_views'      => array(
				'label'  => __( 'بازدید صفحات', 'bahoosh-analytics-pro' ),
				'format' => 'integer',
			),
			'searches'        => array(
				'label'  => __( 'جست‌وجوها', 'bahoosh-analytics-pro' ),
				'format' => 'integer',
			),
			'conversions'     => array(
				'label'  => __( 'تبدیل‌ها', 'bahoosh-analytics-pro' ),
				'format' => 'integer',
			),
			'revenue'         => array(
				'label'  => __( 'درآمد', 'bahoosh-analytics-pro' ),
				'format' => 'currency',
			),
			'conversion_rate' => array(
				'label'  => __( 'نرخ تبدیل', 'bahoosh-analytics-pro' ),
				'format' => 'percent',
			),
		);

		/**
		 * Filters the dashboard metric cards.
		 *
		 * @param array $cards Card definitions keyed by metric name.
		 */
		return apply_filters( 'bap_dashboard_cards', $cards );
	}

	/**
	 * Breakdown panels shown below the cards.
	 *
	 * @return array<string,string>
	 */
	public static function panels() {
		$panels = array(
			'top_pages'       => __( 'صفحات برتر', 'bahoosh-analytics-pro' ),
			'traffic_sources' => __( 'منابع ورودی', 'bahoosh-analytics-pro' ),
			'devices'         => __( 'دستگاه‌ها', 'bahoosh-analytics-pro' ),
			'countries'       => __( 'کشورها', 'bahoosh-analytics-pro' ),
		);

		/**
		 * Filters the dashboard breakdown panels.
		 *
		 * @param array $panels Panel labels keyed by metric name.
		 */
		return apply_filters( 'bap_dashboard_panels', $panels );
	}

	/**
	 * Renders the screen.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( BAP_Admin::reports_capability() ) ) {
			wp_die( esc_html__( 'اجازه مشاهده این صفحه را ندارید.', 'bahoosh-analytics-pro' ) );
		}

		$settings = BAP_Settings::all();
		$outbox   = BAP_Outbox::stats();
		$layout   = BAP_Workspace::dashboard();
		$visible_cards  = isset( $layout['cards'] ) && is_array( $layout['cards'] ) ? $layout['cards'] : array_keys( self::cards() );
		$visible_panels = isset( $layout['panels'] ) && is_array( $layout['panels'] ) ? $layout['panels'] : array_keys( self::panels() );
		?>
		<div class="wrap bap-wrap">

			<?php BAP_Admin::render_page_header(
				__( 'داشبورد تحلیل', 'bahoosh-analytics-pro' ),
				__( 'نمای کلی عملکرد سایت، رفتار کاربران، تبدیل‌ها و سلامت جریان داده.', 'bahoosh-analytics-pro' ),
				BAP_Admin::MENU_SLUG
			); ?>

			<div class="bap-toolbar">
				<label for="bap-range"><?php esc_html_e( 'بازه زمانی', 'bahoosh-analytics-pro' ); ?></label>
				<select id="bap-range">
					<?php foreach ( BAP_Reports::ranges() as $key => $label ) : ?>
						<option value="<?php echo esc_attr( $key ); ?>" <?php selected( 'last_7_days', $key ); ?>>
							<?php echo esc_html( $label ); ?>
						</option>
					<?php endforeach; ?>
				</select>

				<span class="bap-custom-range" id="bap-custom-range" hidden>
					<input type="hidden" id="bap-from" />
					<input type="text" id="bap-from-jalali" class="bap-jalali-input" readonly placeholder="از تاریخ" data-bap-jalali-target="bap-from" />
					<span class="bap-date-separator">تا</span>
					<input type="hidden" id="bap-to" />
					<input type="text" id="bap-to-jalali" class="bap-jalali-input" readonly placeholder="تا تاریخ" data-bap-jalali-target="bap-to" />
				</span>

				<button type="button" class="button" id="bap-refresh">
					<?php esc_html_e( 'به‌روزرسانی', 'bahoosh-analytics-pro' ); ?>
				</button>

				<button type="button" class="button" id="bap-customize-toggle" aria-expanded="false">
					<?php esc_html_e( 'شخصی‌سازی داشبورد', 'bahoosh-analytics-pro' ); ?>
				</button>

				<span class="bap-status" id="bap-status" role="status" aria-live="polite"></span>
			</div>

			<div class="bap-dashboard-customizer" id="bap-dashboard-customizer" hidden>
				<div>
					<strong><?php esc_html_e( 'کارت‌های شاخص', 'bahoosh-analytics-pro' ); ?></strong>
					<div class="bap-checkbox-grid">
						<?php foreach ( self::cards() as $metric => $card ) : ?>
							<label><input type="checkbox" data-layout-card="<?php echo esc_attr( $metric ); ?>" <?php checked( in_array( $metric, $visible_cards, true ) ); ?> /> <?php echo esc_html( $card['label'] ); ?></label>
						<?php endforeach; ?>
					</div>
				</div>
				<div>
					<strong><?php esc_html_e( 'پنل‌های تفکیکی', 'bahoosh-analytics-pro' ); ?></strong>
					<div class="bap-checkbox-grid">
						<?php foreach ( self::panels() as $metric => $label ) : ?>
							<label><input type="checkbox" data-layout-panel="<?php echo esc_attr( $metric ); ?>" <?php checked( in_array( $metric, $visible_panels, true ) ); ?> /> <?php echo esc_html( $label ); ?></label>
						<?php endforeach; ?>
					</div>
				</div>
				<button type="button" class="button button-primary bap-primary" id="bap-save-layout"><?php esc_html_e( 'ذخیره چیدمان', 'bahoosh-analytics-pro' ); ?></button>
			</div>

			<div class="bap-grid" id="bap-cards">
				<?php foreach ( self::cards() as $metric => $card ) : ?>
					<div class="bap-card" data-metric="<?php echo esc_attr( $metric ); ?>" data-format="<?php echo esc_attr( $card['format'] ); ?>" <?php echo in_array( $metric, $visible_cards, true ) ? '' : 'hidden'; ?>>
						<h3><?php echo esc_html( $card['label'] ); ?></h3>
						<div class="bap-value" data-value>--</div>
					</div>
				<?php endforeach; ?>
			</div>

			<div class="bap-section bap-chart-section">
				<h2><?php esc_html_e( 'روند تغییرات', 'bahoosh-analytics-pro' ); ?></h2>
				<div id="bap-chart">
					<p class="bap-muted"><?php esc_html_e( 'در حال بارگذاری…', 'bahoosh-analytics-pro' ); ?></p>
				</div>
			</div>

			<div class="bap-panels" id="bap-panels">
				<?php foreach ( self::panels() as $metric => $label ) : ?>
					<div class="bap-section" data-panel="<?php echo esc_attr( $metric ); ?>" <?php echo in_array( $metric, $visible_panels, true ) ? '' : 'hidden'; ?>>
						<h2><?php echo esc_html( $label ); ?></h2>
						<div class="bap-rows" data-rows>
							<p class="bap-muted"><?php esc_html_e( 'در حال بارگذاری…', 'bahoosh-analytics-pro' ); ?></p>
						</div>
					</div>
				<?php endforeach; ?>
			</div>

			<div class="bap-section">
				<h2><?php esc_html_e( 'وضعیت افزونه', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table">
					<tr>
						<th><?php esc_html_e( 'منبع داده', 'bahoosh-analytics-pro' ); ?></th>
						<td>
							<?php if ( BAP_Settings::is_configured() ) : ?>
								<?php esc_html_e( 'کالکتور بیرونی، با داده محلی به‌عنوان پشتیبان', 'bahoosh-analytics-pro' ); ?>
							<?php else : ?>
								<?php esc_html_e( 'داده‌های همین سایت (بدون کالکتور بیرونی)', 'bahoosh-analytics-pro' ); ?>
							<?php endif; ?>
							<p class="description"><?php
								$first_day = BAP_Local_Store::first_day();
								$rows      = BAP_Local_Store::size();

								if ( $rows > 0 ) {
									printf(
										/* translators: 1: event count, 2: first date. */
										esc_html__( '%1$s رویداد در پایگاه داده این سایت، از تاریخ %2$s.', 'bahoosh-analytics-pro' ),
										esc_html( number_format_i18n( $rows ) ),
										esc_html( $first_day )
									);
								} else {
									esc_html_e( 'هنوز رویدادی ثبت نشده است. یک صفحه از سایت را در مرورگر باز کنید تا جمع‌آوری شروع شود.', 'bahoosh-analytics-pro' );
								}
							?></p>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'شناسه سایت', 'bahoosh-analytics-pro' ); ?></th>
						<td><code><?php echo esc_html( BAP_Settings::resolved_site_id() ); ?></code></td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'آدرس کالکتور', 'bahoosh-analytics-pro' ); ?></th>
						<td>
							<code><?php echo esc_html( $settings['api_url'] ? $settings['api_url'] : '—' ); ?></code>
							<p class="description"><?php esc_html_e( 'اختیاری. اگر خالی باشد، افزونه داده را در پایگاه داده همین سایت نگه می‌دارد و همه گزارش‌ها از روی آن ساخته می‌شوند.', 'bahoosh-analytics-pro' ); ?></p>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'روش ارسال داده', 'bahoosh-analytics-pro' ); ?></th>
						<td>
							<?php
							echo esc_html(
								'proxy' === $settings['transport_mode']
									? __( 'از طریق وردپرس (امن)', 'bahoosh-analytics-pro' )
									: __( 'مستقیم از مرورگر', 'bahoosh-analytics-pro' )
							);
							?>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'صف رویدادهای سمت سرور', 'bahoosh-analytics-pro' ); ?></th>
						<td>
							<?php
							printf(
								/* translators: 1: pending count, 2: in-flight count, 3: failed count */
								esc_html__( 'در انتظار: %1$d — در حال ارسال: %2$d — ناموفق: %3$d', 'bahoosh-analytics-pro' ),
								(int) $outbox['pending'],
								(int) $outbox['sending'],
								(int) $outbox['failed']
							);
							?>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'وضعیت', 'bahoosh-analytics-pro' ); ?></th>
						<td>
							<span class="bap-badge <?php echo BAP_Settings::tracking_enabled() ? 'is-active' : 'is-inactive'; ?>">
								<?php
								echo esc_html(
									BAP_Settings::tracking_enabled()
										? __( 'در حال جمع‌آوری', 'bahoosh-analytics-pro' )
										: __( 'خاموش', 'bahoosh-analytics-pro' )
								);
								?>
							</span>
						</td>
					</tr>
				</table>
			</div>
		</div>
		<?php
	}
}
