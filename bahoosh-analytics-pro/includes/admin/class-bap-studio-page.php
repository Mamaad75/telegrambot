<?php
/**
 * Advanced analytics workspace screens.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Renders the purchase-funnel and sales-suggestions screens.
 *
 * Data is hydrated through authenticated REST calls so wp-admin HTML stays
 * small. Those routes answer from this site's own store, and prefer a
 * collector only when one is configured and reachable.
 */
class BAP_Studio_Page {

	/** Common header/navigation for workspace pages. */
	private static function header( $title, $subtitle, $active ) {
		$slugs = array(
			'funnels' => BAP_Admin::FUNNELS_SLUG,
			'ai'      => BAP_Admin::AI_SLUG,
		);
		BAP_Admin::render_page_header(
			$title,
			$subtitle,
			isset( $slugs[ $active ] ) ? $slugs[ $active ] : BAP_Admin::MENU_SLUG,
			__( 'باهوش', 'bahoosh-analytics-pro' )
		);
	}

	/**
	 * The purchase funnel, where it leaks, and why.
	 *
	 * This one screen replaced three. "Experience", "Funnels" and "Journeys"
	 * each proxied a different collector report, each showed the same "the
	 * backend does not provide this yet" placeholder without one, and the funnel
	 * builder invited an administrator to define a funnel over arbitrary events
	 * that nothing in the plugin could then measure.
	 *
	 * What a shop owner actually wants is one answer: how many people reach each
	 * step, where they stop, which page they were on, and what was broken there.
	 * That is one story, so it is one screen — and every number on it comes from
	 * this site's own rollup and event store.
	 *
	 * @return void
	 */
	public static function render_funnels() {
		self::guard();
		?>
		<div class="wrap bap-wrap bap-studio" data-bap-screen="funnels">
			<?php self::header( __( 'قیف خرید و رها کردن', 'bahoosh-analytics-pro' ), __( 'از مشاهده محصول تا پرداخت: در هر مرحله چند نفر ماندند، کجا رها کردند و چه چیزی روی آن صفحه خراب بوده.', 'bahoosh-analytics-pro' ), 'funnels' ); ?>

			<div class="bap-toolbar bap-toolbar--glass">
				<label class="bap-toolbar-field">
					<span><?php esc_html_e( 'بازه زمانی', 'bahoosh-analytics-pro' ); ?></span>
					<select id="bap-studio-range">
						<option value="last_7_days"><?php esc_html_e( '۷ روز گذشته', 'bahoosh-analytics-pro' ); ?></option>
						<option value="last_30_days"><?php esc_html_e( '۳۰ روز گذشته', 'bahoosh-analytics-pro' ); ?></option>
					</select>
				</label>
				<button type="button" class="button button-primary bap-primary" data-bap-load><?php esc_html_e( 'به‌روزرسانی', 'bahoosh-analytics-pro' ); ?></button>
				<span class="bap-status" data-bap-status></span>
			</div>

			<section class="bap-section">
				<div class="bap-section-title">
					<div>
						<span class="bap-kicker"><?php esc_html_e( 'قیف خرید', 'bahoosh-analytics-pro' ); ?></span>
						<h2><?php esc_html_e( 'در هر مرحله چند نفر ماندند', 'bahoosh-analytics-pro' ); ?></h2>
					</div>
				</div>
				<div id="bap-funnel-report" class="bap-funnel-report">
					<div class="bap-empty-state"><?php esc_html_e( 'قیف از لحظه فعال‌سازی این نسخه شروع به جمع‌آوری می‌کند.', 'bahoosh-analytics-pro' ); ?></div>
				</div>
			</section>

			<section class="bap-section">
				<div class="bap-section-title">
					<div>
						<span class="bap-kicker"><?php esc_html_e( 'به تفکیک محصول', 'bahoosh-analytics-pro' ); ?></span>
						<h2><?php esc_html_e( 'کدام محصول، کجا رها شد', 'bahoosh-analytics-pro' ); ?></h2>
					</div>
				</div>
				<div id="bap-product-funnel" class="bap-product-funnel"></div>
				<p class="bap-muted"><?php esc_html_e( 'محصولی که زیاد دیده می‌شود و کم سبد می‌شود، مشکلش صفحه محصول است. محصولی که زیاد سبد می‌شود و کم خریده می‌شود، مشکلش هزینه ارسال یا صفحه پرداخت است. این دو، دو کار متفاوت‌اند.', 'bahoosh-analytics-pro' ); ?></p>
			</section>

			<div class="bap-explorer-grid">
				<section class="bap-section">
					<div class="bap-section-title">
						<div>
							<span class="bap-kicker"><?php esc_html_e( 'محل رها کردن', 'bahoosh-analytics-pro' ); ?></span>
							<h2><?php esc_html_e( 'روی کدام صفحه خرید را رها کردند', 'bahoosh-analytics-pro' ); ?></h2>
						</div>
					</div>
					<div id="bap-exit-pages" class="bap-explorer-table"></div>
				</section>

				<section class="bap-section">
					<div class="bap-section-title">
						<div>
							<span class="bap-kicker"><?php esc_html_e( 'دلیل احتمالی', 'bahoosh-analytics-pro' ); ?></span>
							<h2><?php esc_html_e( 'چه چیزی روی آن صفحه خراب بوده', 'bahoosh-analytics-pro' ); ?></h2>
						</div>
					</div>
					<div id="bap-issues" class="bap-explorer-table"></div>
					<p class="bap-muted"><?php esc_html_e( 'کلیک عصبی، کلیک بی‌اثر و خطای جاوااسکریپت روی صفحه‌ای که خرید در آن رها می‌شود، معمولاً همان باگی است که دنبالش می‌گردید.', 'bahoosh-analytics-pro' ); ?></p>
				</section>
			</div>
		</div>
		<?php
	}

	/** Renders AI Center. */
	public static function render_ai() {
		self::guard();
		$recommendations = BAP_AI::recommendations();
		$provider        = BAP_AI_Provider::current();
		$agent_mode      = BAP_Commerce_Agent::mode();
		$ga4             = BAP_GA4::status();
		$clarity         = BAP_Clarity::status();
		$provider_labels = array(
			'llama'             => __( 'لامای محلی', 'bahoosh-analytics-pro' ),
			'openai_compatible' => __( 'سرویس سازگار با OpenAI', 'bahoosh-analytics-pro' ),
			'local'             => __( 'موتور قانون‌محور', 'bahoosh-analytics-pro' ),
		);
		$agent_labels    = array(
			'off'      => __( 'خاموش', 'bahoosh-analytics-pro' ),
			'approval' => __( 'با تأیید شما', 'bahoosh-analytics-pro' ),
			'auto'     => __( 'خودکار', 'bahoosh-analytics-pro' ),
		);
		$counts          = array( 'pending' => 0, 'applied' => 0, 'rejected' => 0, 'failed' => 0 );
		foreach ( $recommendations as $recommendation ) {
			$status = isset( $recommendation['status'] ) ? $recommendation['status'] : 'pending';
			if ( isset( $counts[ $status ] ) ) {
				$counts[ $status ]++;
			}
		}
		$mode = BAP_Settings::get( 'ai_autonomy' );
		$mode_labels = array(
			'insights'  => __( 'فقط بینش', 'bahoosh-analytics-pro' ),
			'approval'  => __( 'نیازمند تأیید', 'bahoosh-analytics-pro' ),
			'safe_auto' => __( 'اجرای خودکار امن', 'bahoosh-analytics-pro' ),
		);
		?>
		<div class="wrap bap-wrap bap-studio" data-bap-screen="ai">
			<?php self::header( __( 'پیشنهادهای فروش', 'bahoosh-analytics-pro' ), __( 'از روی سفارش‌ها و رفتار واقعی فروشگاه شما: چه چیزی می‌فروشد، کجا فروش از دست می‌رود و چه کاری می‌شود کرد.', 'bahoosh-analytics-pro' ), 'ai' ); ?>

			<div class="bap-grid bap-grid--ai-summary">
				<div class="bap-card"><h3><?php esc_html_e( 'کل پیشنهادها', 'bahoosh-analytics-pro' ); ?></h3><div class="bap-value" id="bap-ai-total-count"><?php echo esc_html( count( $recommendations ) ); ?></div></div>
				<div class="bap-card"><h3><?php esc_html_e( 'در انتظار بررسی', 'bahoosh-analytics-pro' ); ?></h3><div class="bap-value" id="bap-ai-pending-count"><?php echo esc_html( $counts['pending'] ); ?></div></div>
				<div class="bap-card"><h3><?php esc_html_e( 'اجراشده', 'bahoosh-analytics-pro' ); ?></h3><div class="bap-value" id="bap-ai-applied-count"><?php echo esc_html( $counts['applied'] ); ?></div></div>
				<div class="bap-card"><h3><?php esc_html_e( 'حالت کنترل', 'bahoosh-analytics-pro' ); ?></h3><div class="bap-value bap-value--text"><?php echo esc_html( isset( $mode_labels[ $mode ] ) ? $mode_labels[ $mode ] : $mode_labels['approval'] ); ?></div></div>
			</div>

			<section class="bap-section bap-ai-guide">
				<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'روش کار', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'هوش مصنوعی باهوش دقیقاً چه می‌کند؟', 'bahoosh-analytics-pro' ); ?></h2></div></div>
				<div class="bap-ai-flow" aria-label="<?php esc_attr_e( 'جریان داده هوش مصنوعی', 'bahoosh-analytics-pro' ); ?>">
					<div><strong>۱</strong><span><?php esc_html_e( 'خواندن سفارش‌های ووکامرس و رفتار ثبت‌شده', 'bahoosh-analytics-pro' ); ?></span></div><i>←</i>
					<div><strong>۲</strong><span><?php esc_html_e( 'محاسبه Factها در همین افزونه، بدون هیچ داده شخصی', 'bahoosh-analytics-pro' ); ?></span></div><i>←</i>
					<div><strong>۳</strong><span><?php esc_html_e( 'ارسال فقط همان اعداد به مدل', 'bahoosh-analytics-pro' ); ?></span></div><i>←</i>
					<div><strong>۴</strong><span><?php esc_html_e( 'دور ریختن هر پیشنهادی که شواهدش جعلی باشد', 'bahoosh-analytics-pro' ); ?></span></div><i>←</i>
					<div><strong>۵</strong><span><?php esc_html_e( 'پیشنهاد، و در صورت اجازه شما، اقدام روی فروشگاه', 'bahoosh-analytics-pro' ); ?></span></div>
				</div>
				<div class="bap-ai-howto">
					<div><strong>۱.</strong><span><?php esc_html_e( 'موضوع تحلیل و بازه زمانی را انتخاب کنید.', 'bahoosh-analytics-pro' ); ?></span></div>
					<div><strong>۲.</strong><span><?php esc_html_e( 'روی «اجرای تحلیل هوش مصنوعی» بزنید؛ همه محاسبه‌ها روی همین سرور انجام می‌شود.', 'bahoosh-analytics-pro' ); ?></span></div>
					<div><strong>۳.</strong><span><?php esc_html_e( 'اثر احتمالی، شواهد، اولویت و میزان اطمینان هر پیشنهاد را بررسی کنید.', 'bahoosh-analytics-pro' ); ?></span></div>
					<div><strong>۴.</strong><span><?php esc_html_e( 'پیشنهاد را تأیید یا رد کنید؛ فقط Actionهای ثبت‌شده امکان اجرا دارند.', 'bahoosh-analytics-pro' ); ?></span></div>
				</div>
				<p class="bap-muted"><?php esc_html_e( 'هر عددی که در پیشنهادها می‌بینید را خود افزونه حساب کرده است. کار مدل تفسیر آن اعداد است، نه ساختنشان؛ اگر پیشنهادی به شواهدی اشاره کند که وجود ندارد، پیش از رسیدن به این صفحه حذف می‌شود.', 'bahoosh-analytics-pro' ); ?></p>
			</section>

			<div class="bap-toolbar bap-toolbar--glass bap-ai-runbar">
				<label class="bap-toolbar-field"><span><?php esc_html_e( 'تمرکز تحلیل', 'bahoosh-analytics-pro' ); ?></span><select id="bap-ai-focus"><option value="growth">رشد</option><option value="conversion">تبدیل</option><option value="ux">تجربه کاربری</option><option value="retention">بازگشت کاربران</option><option value="revenue">درآمد</option><option value="performance">عملکرد</option></select></label>
				<label class="bap-toolbar-field"><span><?php esc_html_e( 'بازه زمانی', 'bahoosh-analytics-pro' ); ?></span><select id="bap-ai-range"><option value="last_7_days"><?php esc_html_e( '۷ روز گذشته', 'bahoosh-analytics-pro' ); ?></option><option value="last_30_days"><?php esc_html_e( '۳۰ روز گذشته', 'bahoosh-analytics-pro' ); ?></option></select></label>
				<button type="button" class="button button-primary bap-primary" id="bap-run-ai"><?php esc_html_e( 'اجرای تحلیل هوش مصنوعی', 'bahoosh-analytics-pro' ); ?></button>
				<button type="button" class="button" id="bap-refresh-ai"><?php esc_html_e( 'به‌روزرسانی پیشنهادها', 'bahoosh-analytics-pro' ); ?></button>
				<span class="bap-status" data-bap-status></span>
			</div>

			<div class="bap-layout-2-1">
				<section class="bap-section">
					<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'تحلیل‌گر هوشمند', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'پیشنهادهای قابل بررسی', 'bahoosh-analytics-pro' ); ?></h2></div></div>
					<div id="bap-ai-recommendations" class="bap-ai-list"></div>
				</section>
				<aside>
					<section class="bap-section bap-ai-policy">
						<span class="bap-kicker"><?php esc_html_e( 'سیاست اجرا', 'bahoosh-analytics-pro' ); ?></span>
						<h2><?php echo esc_html( isset( $mode_labels[ $mode ] ) ? $mode_labels[ $mode ] : $mode_labels['approval'] ); ?></h2>
						<p><?php esc_html_e( 'در حالت «فقط بینش» هیچ Actionی اجرا نمی‌شود. در حالت «نیازمند تأیید» اجرا فقط با تصمیم ادمین انجام می‌شود. اجرای خودکار امن نیز فقط برای Actionهای Allowlist و بالاتر از حد اطمینان مجاز است.', 'bahoosh-analytics-pro' ); ?></p>
						<div class="bap-policy-row"><span><?php esc_html_e( 'حداقل اطمینان خودکار', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( (int) BAP_Settings::get( 'ai_min_confidence', 80 ) ); ?>%</strong></div>
					</section>
					<section class="bap-section">
						<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'اقدامات مجاز', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'AI الان چه کارهایی می‌تواند انجام دهد؟', 'bahoosh-analytics-pro' ); ?></h2></div></div>
						<div class="bap-ai-capabilities">
							<?php foreach ( BAP_AI::action_catalog() as $type => $definition ) : ?>
								<div class="bap-ai-capability"><strong><?php echo esc_html( $definition['label'] ); ?></strong><p><?php echo esc_html( $definition['description'] ); ?></p><code><?php echo esc_html( $type ); ?></code></div>
							<?php endforeach; ?>
						</div>
					</section>
					<section class="bap-section">
						<span class="bap-kicker"><?php esc_html_e( 'منابع داده', 'bahoosh-analytics-pro' ); ?></span>
						<h2><?php esc_html_e( 'این تحلیل از کجا می‌آید؟', 'bahoosh-analytics-pro' ); ?></h2>
						<div class="bap-policy-row">
							<span><?php esc_html_e( 'مدل', 'bahoosh-analytics-pro' ); ?></span>
							<strong><?php echo esc_html( $provider_labels[ $provider ] ?? $provider ); ?></strong>
						</div>
						<div class="bap-policy-row">
							<span><?php esc_html_e( 'ووکامرس', 'bahoosh-analytics-pro' ); ?></span>
							<strong><?php echo BAP_Commerce_Facts::available() ? esc_html__( 'متصل', 'bahoosh-analytics-pro' ) : esc_html__( 'غیرفعال', 'bahoosh-analytics-pro' ); ?></strong>
						</div>
						<div class="bap-policy-row">
							<span><?php esc_html_e( 'گوگل آنالیتیکس ۴', 'bahoosh-analytics-pro' ); ?></span>
							<strong><?php echo $ga4['connected'] ? esc_html__( 'متصل', 'bahoosh-analytics-pro' ) : esc_html__( 'متصل نیست', 'bahoosh-analytics-pro' ); ?></strong>
						</div>
						<div class="bap-policy-row">
							<span><?php esc_html_e( 'مایکروسافت کلاریتی', 'bahoosh-analytics-pro' ); ?></span>
							<strong><?php echo $clarity['connected'] ? esc_html__( 'متصل', 'bahoosh-analytics-pro' ) : esc_html__( 'متصل نیست', 'bahoosh-analytics-pro' ); ?></strong>
						</div>
						<div class="bap-policy-row">
							<span><?php esc_html_e( 'ایجنت فروشگاه', 'bahoosh-analytics-pro' ); ?></span>
							<strong><?php echo esc_html( $agent_labels[ $agent_mode ] ?? $agent_mode ); ?></strong>
						</div>
						<?php if ( ! $ga4['connected'] || ! $clarity['connected'] ) : ?>
							<p class="bap-muted"><?php esc_html_e( 'اتصال گوگل آنالیتیکس و کلاریتی اختیاری است. گوگل آنالیتیکس تاریخچه پیش از نصب افزونه را اضافه می‌کند و کلاریتی دلیل فنی رها کردن خرید را نشان می‌دهد.', 'bahoosh-analytics-pro' ); ?>
							<a href="<?php echo esc_url( admin_url( 'admin.php?page=' . BAP_Admin::SETTINGS_SLUG ) ); ?>"><?php esc_html_e( 'تنظیم اتصال', 'bahoosh-analytics-pro' ); ?></a></p>
						<?php endif; ?>
					</section>
				</aside>
			</div>

			<div class="bap-layout-1-1 bap-ai-artifacts">
				<section class="bap-section">
					<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'خروجی اجرا', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'هشدارهای ساخته‌شده', 'bahoosh-analytics-pro' ); ?></h2></div></div>
					<div id="bap-ai-alerts" class="bap-ai-artifact-list"><div class="bap-empty-state"><?php esc_html_e( 'هنوز هشداری توسط هوش مصنوعی ساخته نشده است.', 'bahoosh-analytics-pro' ); ?></div></div>
				</section>
				<section class="bap-section">
					<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'خروجی اجرا', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'یادداشت‌های خط زمانی', 'bahoosh-analytics-pro' ); ?></h2></div></div>
					<div id="bap-ai-annotations" class="bap-ai-artifact-list"><div class="bap-empty-state"><?php esc_html_e( 'هنوز یادداشتی توسط هوش مصنوعی ثبت نشده است.', 'bahoosh-analytics-pro' ); ?></div></div>
				</section>
			</div>

			<section class="bap-section">
				<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'ایجنت فروشگاه', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'تغییراتی که روی ووکامرس اعمال شده', 'bahoosh-analytics-pro' ); ?></h2></div></div>
				<div id="bap-agent-log" class="bap-ai-artifact-list"><div class="bap-empty-state"><?php echo 'off' === $agent_mode ? esc_html__( 'ایجنت خاموش است؛ هیچ تغییری روی فروشگاه انجام نمی‌شود.', 'bahoosh-analytics-pro' ) : esc_html__( 'هنوز تغییری روی فروشگاه اعمال نشده است.', 'bahoosh-analytics-pro' ); ?></div></div>
				<p class="bap-muted"><?php esc_html_e( 'هر تغییر تاریخ پایان دارد و دکمه «بازگرداندن» دقیقاً همان چیزی را که پیش از تغییر وجود داشت برمی‌گرداند. قیمت اصلی محصول هیچ‌وقت دست‌کاری نمی‌شود.', 'bahoosh-analytics-pro' ); ?></p>
			</section>

			<section class="bap-section">
				<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'شواهد', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'اعدادی که مدل دید', 'bahoosh-analytics-pro' ); ?></h2></div></div>
				<div id="bap-ai-facts" class="bap-ai-artifact-list"><div class="bap-empty-state"><?php esc_html_e( 'پس از اجرای تحلیل، تمام Factهایی که به مدل داده شده اینجا نمایش داده می‌شود تا بتوانید هر پیشنهاد را با داده خودتان بسنجید.', 'bahoosh-analytics-pro' ); ?></div></div>
			</section>

			<section class="bap-section">
				<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'ممیزی', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'آخرین فعالیت‌های هوش مصنوعی', 'bahoosh-analytics-pro' ); ?></h2></div></div>
				<div id="bap-ai-audit" class="bap-ai-audit"><div class="bap-empty-state"><?php esc_html_e( 'پس از تحلیل، دریافت پیشنهاد یا اجرای Action، سوابق اینجا نمایش داده می‌شود.', 'bahoosh-analytics-pro' ); ?></div></div>
			</section>
		</div>
		<?php
	}

	/** Permission gate shared by all reports. */
	private static function guard() {
		if ( ! current_user_can( BAP_Admin::reports_capability() ) ) {
			wp_die( esc_html__( 'اجازه مشاهده این صفحه را ندارید.', 'bahoosh-analytics-pro' ) );
		}
	}
}
