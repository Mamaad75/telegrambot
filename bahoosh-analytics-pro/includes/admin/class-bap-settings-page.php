<?php
/**
 * Settings screen.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Renders and processes the settings form.
 *
 * Version 1 had no settings screen — configuration meant editing constants in
 * the plugin file, which is lost on every update. Saving goes through
 * `BAP_Settings::sanitize()`, and the form is protected by a nonce and a
 * capability check.
 */
class BAP_Settings_Page {

	const NONCE_ACTION = 'bap_save_settings';
	const NONCE_FIELD  = 'bap_settings_nonce';

	/**
	 * Registers hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_post_bap_save_settings', array( __CLASS__, 'handle_save' ) );
	}

	/**
	 * Handles the form submission.
	 *
	 * @return void
	 */
	public static function handle_save() {
		if ( ! current_user_can( BAP_Admin::settings_capability() ) ) {
			wp_die( esc_html__( 'اجازه تغییر این تنظیمات را ندارید.', 'bahoosh-analytics-pro' ) );
		}

		check_admin_referer( self::NONCE_ACTION, self::NONCE_FIELD );

		$input = isset( $_POST['bap'] ) ? wp_unslash( $_POST['bap'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised in BAP_Settings::sanitize().
		if ( ! is_array( $input ) ) {
			$input = array();
		}

		BAP_Settings::save( $input );

		// The secret key is handled separately and is never echoed back. An
		// empty submission leaves the stored key untouched so it does not get
		// wiped by someone saving an unrelated option.
		if ( isset( $_POST['bap_api_key'] ) ) {
			$key = trim( (string) wp_unslash( $_POST['bap_api_key'] ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised in set_api_key().
			if ( '' !== $key ) {
				BAP_Settings::set_api_key( $key );
			}
		}

		if ( ! empty( $_POST['bap_clear_api_key'] ) ) {
			BAP_Settings::set_api_key( '' );
		}


		// Every secret below follows the same rule as the collector key: an
		// empty field means "leave it alone", never "delete it". Clearing is an
		// explicit checkbox, so nobody wipes a working connection by saving an
		// unrelated setting on another part of the page.
		if ( isset( $_POST['bap_ai_provider_key'] ) ) {
			$provider_key = trim( (string) wp_unslash( $_POST['bap_ai_provider_key'] ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised in setter.
			if ( '' !== $provider_key ) {
				BAP_AI_Provider::set_api_key( $provider_key );
			}
		}
		if ( ! empty( $_POST['bap_clear_ai_provider_key'] ) ) {
			BAP_AI_Provider::set_api_key( '' );
		}

		$ga4_error = '';
		if ( isset( $_POST['bap_ga4_credentials'] ) ) {
			$credentials = trim( (string) wp_unslash( $_POST['bap_ga4_credentials'] ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- validated as JSON in the setter.
			if ( '' !== $credentials ) {
				$stored = BAP_GA4::set_credentials( $credentials );
				if ( is_wp_error( $stored ) ) {
					$ga4_error = $stored->get_error_code();
				}
			}
		}
		if ( ! empty( $_POST['bap_clear_ga4_credentials'] ) ) {
			BAP_GA4::set_credentials( '' );
		}

		if ( isset( $_POST['bap_clarity_token'] ) ) {
			$clarity_token = trim( (string) wp_unslash( $_POST['bap_clarity_token'] ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised in setter.
			if ( '' !== $clarity_token ) {
				BAP_Clarity::set_token( $clarity_token );
			}
		}
		if ( ! empty( $_POST['bap_clear_clarity_token'] ) ) {
			BAP_Clarity::set_token( '' );
		}

		$redirect = add_query_arg(
			'bap-updated',
			'1',
			admin_url( 'admin.php?page=' . BAP_Admin::SETTINGS_SLUG )
		);

		if ( '' !== $ga4_error ) {
			$redirect = add_query_arg( 'bap-ga4-error', '1', $redirect );
		}

		wp_safe_redirect( $redirect );
		exit;
	}

	/**
	 * Renders the screen.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( BAP_Admin::settings_capability() ) ) {
			wp_die( esc_html__( 'اجازه مشاهده این صفحه را ندارید.', 'bahoosh-analytics-pro' ) );
		}

		$settings         = BAP_Settings::all();
		$has_key          = '' !== BAP_Settings::get_api_key();
		$has_provider_key = '' !== BAP_AI_Provider::api_key();
		$ga4_status       = BAP_GA4::status();
		$clarity_status   = BAP_Clarity::status();
		$updated          = isset( $_GET['bap-updated'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only notice flag.
		$ga4_error        = isset( $_GET['bap-ga4-error'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only notice flag.
		?>
		<div class="wrap bap-wrap bap-settings bap-unified-screen">
			<?php BAP_Admin::render_page_header(
				__( 'تنظیمات باهوش', 'bahoosh-analytics-pro' ),
				__( 'اتصال، رهگیری، حریم خصوصی، هوش مصنوعی، عملکرد و ظاهر افزونه را از یک مرکز کنترل مدیریت کنید.', 'bahoosh-analytics-pro' ),
				BAP_Admin::SETTINGS_SLUG
			); ?>

			<?php if ( $updated ) : ?>
				<div class="notice notice-success is-dismissible">
					<p><?php esc_html_e( 'تنظیمات ذخیره شد.', 'bahoosh-analytics-pro' ); ?></p>
				</div>
			<?php endif; ?>

			<?php if ( $ga4_error ) : ?>
				<div class="notice notice-error is-dismissible">
					<p><?php esc_html_e( 'فایل سرویس‌اکانت گوگل ذخیره نشد: محتوای واردشده یک JSON معتبر شامل client_email و private_key نبود. بقیه تنظیمات ذخیره شدند.', 'bahoosh-analytics-pro' ); ?></p>
				</div>
			<?php endif; ?>

			<form class="bap-settings-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="bap_save_settings" />
				<?php wp_nonce_field( self::NONCE_ACTION, self::NONCE_FIELD ); ?>

				<h2><?php esc_html_e( 'اتصال', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="bap-api-url"><?php esc_html_e( 'آدرس API کالکتور', 'bahoosh-analytics-pro' ); ?></label></th>
						<td>
							<input type="url" class="regular-text code" id="bap-api-url" name="bap[api_url]"
								value="<?php echo esc_attr( $settings['api_url'] ); ?>"
								placeholder="https://api.example.com/api/v2" />
							<p class="description"><?php esc_html_e( 'آدرس پایه کالکتور باهوش را بدون اسلش انتهایی وارد کنید. مسیرهای /events، /identity/link و /dashboard به آن افزوده می‌شوند.', 'bahoosh-analytics-pro' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="bap-site-id"><?php esc_html_e( 'شناسه سایت', 'bahoosh-analytics-pro' ); ?></label></th>
						<td>
							<input type="text" class="regular-text code" id="bap-site-id" name="bap[site_id]"
								value="<?php echo esc_attr( $settings['site_id'] ); ?>" />
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="bap-api-key"><?php esc_html_e( 'کلید API (محرمانه)', 'bahoosh-analytics-pro' ); ?></label></th>
						<td>
							<input type="password" class="regular-text code" id="bap-api-key" name="bap_api_key"
								autocomplete="new-password"
								placeholder="<?php echo $has_key ? esc_attr__( '•••••••• (ذخیره‌شده)', 'bahoosh-analytics-pro' ) : ''; ?>" />
							<p class="description">
								<?php esc_html_e( 'روی سرور ذخیره می‌شود و هرگز به مرورگر ارسال نمی‌شود. برای حفظ کلید فعلی، این فیلد را خالی بگذارید.', 'bahoosh-analytics-pro' ); ?>
							</p>
							<?php if ( $has_key ) : ?>
								<label>
									<input type="checkbox" name="bap_clear_api_key" value="1" />
									<?php esc_html_e( 'حذف کلید ذخیره‌شده', 'bahoosh-analytics-pro' ); ?>
								</label>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'روش ارسال داده', 'bahoosh-analytics-pro' ); ?></th>
						<td>
							<label>
								<input type="radio" name="bap[transport_mode]" value="proxy" <?php checked( 'proxy', $settings['transport_mode'] ); ?> />
								<?php esc_html_e( 'از طریق وردپرس (پیشنهادشده)', 'bahoosh-analytics-pro' ); ?>
							</label><br />
							<label>
								<input type="radio" name="bap[transport_mode]" value="direct" <?php checked( 'direct', $settings['transport_mode'] ); ?> />
								<?php esc_html_e( 'مستقیم از مرورگر (نیازمند کالکتور v3 و کلید عمومی دریافت داده)', 'bahoosh-analytics-pro' ); ?>
							</label>
							<p class="description"><?php esc_html_e( 'حالت پروکسی کلید محرمانه API را روی سرور نگه می‌دارد و وردپرس پیش از ارسال، هویت بازدیدکننده را تأیید می‌کند. حالت مستقیم وردپرس را دور می‌زند و به کلید جداگانه فقط‌نوشتنی نیاز دارد؛ در این حالت کالکتور هویت اعلام‌شده توسط مرورگر را می‌پذیرد.', 'bahoosh-analytics-pro' ); ?></p>
							<p class="description"><strong><?php esc_html_e( 'حالت مستقیم به کالکتوری نیاز دارد که Schema نسخه ۳ را پشتیبانی کند.', 'bahoosh-analytics-pro' ); ?></strong> <?php esc_html_e( 'تا زمانی که کالکتور روی نسخه ۲ است، وردپرس تبدیل داده را انجام می‌دهد؛ بنابراین فقط حالت پروکسی به‌صورت کامل کار می‌کند.', 'bahoosh-analytics-pro' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="bap-ingest-key"><?php esc_html_e( 'کلید عمومی دریافت داده', 'bahoosh-analytics-pro' ); ?></label></th>
						<td>
							<input type="text" class="regular-text code" id="bap-ingest-key" name="bap[ingest_key]"
								value="<?php echo esc_attr( $settings['ingest_key'] ); ?>" />
							<p class="description"><?php esc_html_e( 'کلید فقط‌نوشتنی که نمایش آن امن است و فقط در حالت ارسال مستقیم استفاده می‌شود.', 'bahoosh-analytics-pro' ); ?></p>
						</td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'رهگیری', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<?php
					self::checkbox( 'enabled', __( 'فعال‌سازی رهگیری', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'track_page_views', __( 'بازدید صفحات', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'track_clicks', __( 'کلیک‌ها', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'track_scroll', __( 'عمق اسکرول', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'track_time', __( 'زمان حضور در صفحه', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'track_forms', __( 'فرم‌ها', 'bahoosh-analytics-pro' ), $settings, __( 'نمایش فرم، اولین تعامل و ارسال ثبت می‌شود. فرم‌های رمز عبور، ورود و پرداخت هرگز رهگیری نمی‌شوند.', 'bahoosh-analytics-pro' ) );
					self::checkbox( 'track_spa', __( 'ناوبری تک‌صفحه‌ای', 'bahoosh-analytics-pro' ), $settings, __( 'ناوبری History API را برای قالب‌هایی که بدون بارگذاری مجدد صفحه را تغییر می‌دهند به‌عنوان بازدید صفحه ثبت می‌کند.', 'bahoosh-analytics-pro' ) );
					self::checkbox( 'track_logged_in', __( 'رهگیری کاربران واردشده', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'track_admins', __( 'رهگیری مدیران', 'bahoosh-analytics-pro' ), $settings );
					?>
					<tr>
						<th scope="row"><?php esc_html_e( 'محدوده رهگیری کلیک', 'bahoosh-analytics-pro' ); ?></th>
						<td>
							<fieldset>
								<legend class="screen-reader-text"><?php esc_html_e( 'محدوده رهگیری کلیک', 'bahoosh-analytics-pro' ); ?></legend>
								<label>
									<input type="radio" name="bap[click_capture]" value="interactive" <?php checked( 'interactive', $settings['click_capture'] ); ?> />
									<?php esc_html_e( 'فقط عناصر تعاملی (پیشنهادشده)', 'bahoosh-analytics-pro' ); ?>
								</label><br />
								<label>
									<input type="radio" name="bap[click_capture]" value="all" <?php checked( 'all', $settings['click_capture'] ); ?> />
									<?php esc_html_e( 'تمام کلیک‌های صفحه', 'bahoosh-analytics-pro' ); ?>
								</label>
							</fieldset>
							<p class="description">
								<?php esc_html_e( 'حالت تعاملی فقط کلیک روی لینک‌ها، دکمه‌ها و عناصر دارای data-bap-track را ثبت می‌کند. ثبت همه کلیک‌ها حجم رویداد را چند برابر می‌کند و معمولاً شامل کلیک روی فضاهای خالی هم می‌شود.', 'bahoosh-analytics-pro' ); ?>
							</p>
						</td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'هوش تجربه کاربری', 'bahoosh-analytics-pro' ); ?></h2>
				<p><?php esc_html_e( 'سیگنال‌های رفتاری پیشرفته با رعایت حریم خصوصی کار می‌کنند و هرگز مقدار تایپ‌شده فیلدها یا متن کپی‌شده را ذخیره نمی‌کنند. پس از پشتیبانی بک‌اند از رویدادهای نسخه ۴ آن‌ها را فعال کنید.', 'bahoosh-analytics-pro' ); ?></p>
				<table class="form-table" role="presentation">
					<?php
					self::checkbox( 'track_rage_clicks', __( 'تشخیص کلیک عصبی', 'bahoosh-analytics-pro' ), $settings, __( 'کلیک‌های تکراری در یک ناحیه کوچک را تشخیص می‌دهد و یک رویداد نارضایتی ثبت می‌کند.', 'bahoosh-analytics-pro' ) );
					self::checkbox( 'track_dead_clicks', __( 'تشخیص کلیک بی‌اثر', 'bahoosh-analytics-pro' ), $settings, __( 'کلیک‌های قابل اقدام را که هیچ ناوبری یا تغییر DOM ایجاد نمی‌کنند با حساسیت محافظه‌کارانه تشخیص می‌دهد.', 'bahoosh-analytics-pro' ) );
					self::checkbox( 'track_js_errors', __( 'خطاهای جاوااسکریپت', 'bahoosh-analytics-pro' ), $settings, __( 'خلاصه خطاهای پاک‌سازی‌شده را بدون Stack Trace یا محتوای صفحه ثبت می‌کند.', 'bahoosh-analytics-pro' ) );
					self::checkbox( 'track_web_vitals', __( 'شاخص‌های حیاتی وب', 'bahoosh-analytics-pro' ), $settings, __( 'LCP، CLS، INP، FCP و TTFB به‌صورت رویداد ساختاریافته ثبت می‌شوند.', 'bahoosh-analytics-pro' ) );
					self::checkbox( 'track_media', __( 'تعامل با رسانه', 'bahoosh-analytics-pro' ), $settings, __( 'پخش، توقف، پایان و پیشرفت ۲۵/۵۰/۷۵/۱۰۰٪ برای ویدئو و صوت HTML5 ثبت می‌شود.', 'bahoosh-analytics-pro' ) );
					self::checkbox( 'track_copy', __( 'رفتار کپی', 'bahoosh-analytics-pro' ), $settings, __( 'فقط تعداد کاراکتر کپی‌شده و زمینه عنصر را ثبت می‌کند و هرگز متن Clipboard ذخیره نمی‌شود.', 'bahoosh-analytics-pro' ) );
					?>
				</table>

				<h2><?php esc_html_e( 'ووکامرس', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<?php
					self::checkbox( 'woocommerce_enabled', __( 'رهگیری فروشگاه', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'server_side_purchase', __( 'رویداد خرید و بازپرداخت سمت سرور', 'bahoosh-analytics-pro' ), $settings, __( 'به‌شدت پیشنهاد می‌شود: رهگیری خرید فقط در مرورگر ممکن است برخی سفارش‌ها را از دست بدهد یا تکراری ثبت کند.', 'bahoosh-analytics-pro' ) );
					?>
				</table>

				<h2><?php esc_html_e( 'مغز تحلیلگر', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<?php self::checkbox( 'ai_enabled', __( 'فعال‌سازی تحلیل هوشمند', 'bahoosh-analytics-pro' ), $settings, __( 'تمام محاسبه‌ها داخل همین افزونه انجام می‌شود. مدل فقط یک بسته از اعداد آماده را می‌بیند: هیچ نام، ایمیل، شماره یا شناسه بازدیدکننده‌ای در آن نیست.', 'bahoosh-analytics-pro' ) ); ?>

					<tr><th scope="row"><label for="bap-ai-provider"><?php esc_html_e( 'مدل زبانی', 'bahoosh-analytics-pro' ); ?></label></th><td>
						<select name="bap[ai_provider]" id="bap-ai-provider">
							<option value="llama" <?php selected( 'llama', $settings['ai_provider'] ); ?>><?php esc_html_e( 'لاما روی همین سرور (Ollama / llama.cpp / LM Studio)', 'bahoosh-analytics-pro' ); ?></option>
							<option value="openai_compatible" <?php selected( 'openai_compatible', $settings['ai_provider'] ); ?>><?php esc_html_e( 'سرویس سازگار با OpenAI', 'bahoosh-analytics-pro' ); ?></option>
							<option value="local" <?php selected( 'local', $settings['ai_provider'] ); ?>><?php esc_html_e( 'بدون مدل — فقط موتور قانون‌محور داخلی', 'bahoosh-analytics-pro' ); ?></option>
						</select>
						<p class="description"><?php esc_html_e( 'اگر مدل در دسترس نباشد، موتور قانون‌محور داخلی همان اعداد را تحلیل می‌کند و صفحه خالی نمی‌ماند. در نتیجه همیشه مشخص است پاسخ را کدام منبع تولید کرده.', 'bahoosh-analytics-pro' ); ?></p>
					</td></tr>

					<tr><th scope="row"><label for="bap-ai-provider-url"><?php esc_html_e( 'آدرس سرویس مدل', 'bahoosh-analytics-pro' ); ?></label></th><td>
						<input type="url" class="regular-text code" id="bap-ai-provider-url" name="bap[ai_provider_url]"
							value="<?php echo esc_attr( $settings['ai_provider_url'] ); ?>"
							placeholder="<?php echo esc_attr( BAP_AI_Provider::LLAMA_DEFAULT_URL ); ?>" />
						<p class="description"><?php
							printf(
								/* translators: %s: default Llama endpoint. */
								esc_html__( 'خالی بگذارید تا %s استفاده شود (پیش‌فرض اولاما). آدرس ریشه، مسیر v1 یا آدرس کامل chat/completions هر سه پذیرفته می‌شوند.', 'bahoosh-analytics-pro' ),
								'<code>' . esc_html( BAP_AI_Provider::LLAMA_DEFAULT_URL ) . '</code>'
							);
						?></p>
					</td></tr>

					<tr><th scope="row"><label for="bap-ai-provider-model"><?php esc_html_e( 'نام مدل', 'bahoosh-analytics-pro' ); ?></label></th><td>
						<input type="text" class="regular-text code" id="bap-ai-provider-model" name="bap[ai_provider_model]"
							value="<?php echo esc_attr( $settings['ai_provider_model'] ); ?>"
							placeholder="<?php echo esc_attr( BAP_AI_Provider::LLAMA_DEFAULT_MODEL ); ?>" />
						<p class="description"><?php
							printf(
								/* translators: 1: default model name, 2: pull command. */
								esc_html__( 'پیش‌فرض %1$s است. اگر هنوز آن را دانلود نکرده‌اید روی سرور اجرا کنید: %2$s', 'bahoosh-analytics-pro' ),
								'<code>' . esc_html( BAP_AI_Provider::LLAMA_DEFAULT_MODEL ) . '</code>',
								'<code>ollama pull ' . esc_html( BAP_AI_Provider::LLAMA_DEFAULT_MODEL ) . '</code>'
							);
						?></p>
					</td></tr>

					<tr><th scope="row"><label for="bap-ai-provider-key"><?php esc_html_e( 'کلید سرویس مدل', 'bahoosh-analytics-pro' ); ?></label></th><td>
						<input type="password" class="regular-text code" id="bap-ai-provider-key" name="bap_ai_provider_key" autocomplete="off"
							placeholder="<?php echo $has_provider_key ? esc_attr__( 'ذخیره شده — برای تغییر مقدار جدید وارد کنید', 'bahoosh-analytics-pro' ) : esc_attr__( 'برای لامای محلی لازم نیست', 'bahoosh-analytics-pro' ); ?>" />
						<p class="description"><?php esc_html_e( 'مدل محلی به کلید نیاز ندارد. این کلید هرگز به مرورگر فرستاده نمی‌شود و در گزارش عیب‌یابی هم نمایش داده نمی‌شود.', 'bahoosh-analytics-pro' ); ?></p>
						<?php if ( $has_provider_key ) : ?>
							<label><input type="checkbox" name="bap_clear_ai_provider_key" value="1" /> <?php esc_html_e( 'حذف کلید ذخیره‌شده', 'bahoosh-analytics-pro' ); ?></label>
						<?php endif; ?>
					</td></tr>

					<tr><th scope="row"><?php esc_html_e( 'حالت خودکارسازی', 'bahoosh-analytics-pro' ); ?></th><td>
						<select name="bap[ai_autonomy]" id="bap-ai-autonomy">
							<option value="insights" <?php selected( 'insights', $settings['ai_autonomy'] ); ?>><?php esc_html_e( 'فقط ارائه بینش — بدون اجرای خودکار', 'bahoosh-analytics-pro' ); ?></option>
							<option value="approval" <?php selected( 'approval', $settings['ai_autonomy'] ); ?>><?php esc_html_e( 'نیازمند تأیید — پیشنهادشده', 'bahoosh-analytics-pro' ); ?></option>
							<option value="safe_auto" <?php selected( 'safe_auto', $settings['ai_autonomy'] ); ?>><?php esc_html_e( 'اجرای خودکار امن — فقط اقدامات کم‌ریسک مجاز', 'bahoosh-analytics-pro' ); ?></option>
						</select>
						<p class="description"><?php esc_html_e( 'هیچ پاسخ هوش مصنوعی اجازه اجرای PHP، SQL، دستورات Shell، URL دلخواه یا تنظیمات دلخواه وردپرس را ندارد.', 'bahoosh-analytics-pro' ); ?></p>
					</td></tr>
					<?php self::number( 'ai_min_confidence', __( 'حداقل اطمینان برای اجرای خودکار', 'bahoosh-analytics-pro' ), $settings, 50, 100, __( 'اقدامات اجرای خودکار امن که اطمینانشان کمتر از این مقدار باشد، فقط به‌عنوان پیشنهاد ذخیره می‌شوند.', 'bahoosh-analytics-pro' ) ); ?>
				</table>

				<h2><?php esc_html_e( 'ایجنت فروشگاه', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr><th scope="row"><label for="bap-ai-agent-mode"><?php esc_html_e( 'اجازه تغییر در ووکامرس', 'bahoosh-analytics-pro' ); ?></label></th><td>
						<select name="bap[ai_agent_mode]" id="bap-ai-agent-mode">
							<option value="off" <?php selected( 'off', $settings['ai_agent_mode'] ); ?>><?php esc_html_e( 'خاموش — هیچ تغییری در فروشگاه انجام نمی‌شود', 'bahoosh-analytics-pro' ); ?></option>
							<option value="approval" <?php selected( 'approval', $settings['ai_agent_mode'] ); ?>><?php esc_html_e( 'با تأیید شما — پیشنهاد ساخته می‌شود، اجرا با کلیک شما', 'bahoosh-analytics-pro' ); ?></option>
							<option value="auto" <?php selected( 'auto', $settings['ai_agent_mode'] ); ?>><?php esc_html_e( 'خودکار — تغییرات در سقف تعیین‌شده بدون تأیید اعمال می‌شود', 'bahoosh-analytics-pro' ); ?></option>
						</select>
						<p class="description"><?php esc_html_e( 'ایجنت فقط دو کار بلد است: تخفیف زمان‌دار روی محصول کم‌فروش، و ساخت کد تخفیف پکیجی برای دو محصولی که با هم خریده می‌شوند. قیمت اصلی محصول هرگز تغییر نمی‌کند، هر تغییر تاریخ پایان دارد و همه‌چیز با یک کلیک قابل بازگرداندن است.', 'bahoosh-analytics-pro' ); ?></p>
						<p class="description"><strong><?php esc_html_e( 'در حالت خودکار، تخفیف بدون تأیید شما روی فروشگاه زنده اعمال می‌شود. اگر مطمئن نیستید، حالت «با تأیید شما» را انتخاب کنید.', 'bahoosh-analytics-pro' ); ?></strong></p>
					</td></tr>
					<?php self::number( 'ai_agent_max_discount', __( 'سقف درصد تخفیف', 'bahoosh-analytics-pro' ), $settings, 1, 40, __( 'ایجنت هرگز از این عدد بیشتر تخفیف نمی‌دهد، حتی اگر مدل چیز دیگری پیشنهاد کند. درصد تخفیف را افزونه محاسبه می‌کند، نه مدل.', 'bahoosh-analytics-pro' ) ); ?>
				</table>

				<h2><?php esc_html_e( 'منابع داده بیرونی', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr><td colspan="2"><p class="description"><?php esc_html_e( 'این دو اختیاری هستند و جای داده خود افزونه را نمی‌گیرند. گوگل آنالیتیکس تاریخچه پیش از نصب این افزونه را دارد و کلاریتی می‌گوید روی کدام صفحه دقیقاً چه چیزی خراب است.', 'bahoosh-analytics-pro' ); ?></p></td></tr>

					<tr><th scope="row"><label for="bap-ga4-property"><?php esc_html_e( 'شناسه Property گوگل آنالیتیکس ۴', 'bahoosh-analytics-pro' ); ?></label></th><td>
						<input type="text" class="regular-text code" id="bap-ga4-property" name="bap[ga4_property_id]"
							value="<?php echo esc_attr( $settings['ga4_property_id'] ); ?>" placeholder="123456789" />
						<p class="description"><?php esc_html_e( 'فقط عدد. در گوگل آنالیتیکس: Admin ← Property Settings ← Property ID. این با کد G-XXXXXXX فرق دارد.', 'bahoosh-analytics-pro' ); ?></p>
					</td></tr>

					<tr><th scope="row"><label for="bap-ga4-credentials"><?php esc_html_e( 'فایل سرویس‌اکانت گوگل', 'bahoosh-analytics-pro' ); ?></label></th><td>
						<textarea class="large-text code" rows="4" id="bap-ga4-credentials" name="bap_ga4_credentials" autocomplete="off"
							placeholder="<?php echo $ga4_status['has_key'] ? esc_attr__( 'ذخیره شده — برای تغییر، فایل JSON جدید را اینجا بچسبانید', 'bahoosh-analytics-pro' ) : esc_attr__( 'محتوای فایل JSON سرویس‌اکانت را اینجا بچسبانید', 'bahoosh-analytics-pro' ); ?>"></textarea>
						<p class="description"><?php esc_html_e( 'کلید خصوصی این فایل یک راز است: در دیتابیس ذخیره می‌شود ولی هرگز به مرورگر برنمی‌گردد و در گزارش عیب‌یابی نمی‌آید. راهنمای گام‌به‌گام در فایل docs/CONNECT-GA4-CLARITY.md آمده است.', 'bahoosh-analytics-pro' ); ?></p>
						<?php if ( $ga4_status['has_key'] ) : ?>
							<p class="description"><?php
								printf(
									/* translators: %s: masked service account email. */
									esc_html__( 'سرویس‌اکانت متصل: %s', 'bahoosh-analytics-pro' ),
									'<code>' . esc_html( $ga4_status['account'] ) . '</code>'
								);
							?></p>
							<label><input type="checkbox" name="bap_clear_ga4_credentials" value="1" /> <?php esc_html_e( 'حذف اتصال گوگل آنالیتیکس', 'bahoosh-analytics-pro' ); ?></label>
						<?php endif; ?>
						<?php if ( ! $ga4_status['openssl'] ) : ?>
							<p class="description"><strong><?php esc_html_e( 'هشدار: افزونه OpenSSL روی PHP این سرور فعال نیست و بدون آن اتصال به گوگل ممکن نیست.', 'bahoosh-analytics-pro' ); ?></strong></p>
						<?php endif; ?>
					</td></tr>

					<tr><th scope="row"><label for="bap-clarity-token"><?php esc_html_e( 'توکن مایکروسافت کلاریتی', 'bahoosh-analytics-pro' ); ?></label></th><td>
						<input type="password" class="regular-text code" id="bap-clarity-token" name="bap_clarity_token" autocomplete="off"
							placeholder="<?php echo $clarity_status['connected'] ? esc_attr__( 'ذخیره شده — برای تغییر مقدار جدید وارد کنید', 'bahoosh-analytics-pro' ) : esc_attr__( 'از Settings ← Data Export در پنل کلاریتی', 'bahoosh-analytics-pro' ); ?>" />
						<p class="description"><?php
							printf(
								/* translators: 1: calls used today, 2: daily limit, 3: window in days. */
								esc_html__( 'کلاریتی روزانه فقط %2$d درخواست اجازه می‌دهد (امروز %1$d بار استفاده شده) و حداکثر %3$d روز اخیر را برمی‌گرداند. به همین دلیل نتیجه چند ساعت کش می‌شود.', 'bahoosh-analytics-pro' ),
								(int) $clarity_status['calls_today'],
								(int) $clarity_status['daily_limit'],
								(int) $clarity_status['window_days']
							);
						?></p>
						<?php if ( $clarity_status['connected'] ) : ?>
							<label><input type="checkbox" name="bap_clear_clarity_token" value="1" /> <?php esc_html_e( 'حذف اتصال کلاریتی', 'bahoosh-analytics-pro' ); ?></label>
						<?php endif; ?>
					</td></tr>
				</table>

				<h2><?php esc_html_e( 'حریم خصوصی', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<?php
					self::checkbox( 'require_consent', __( 'نیاز به رضایت پیش از رهگیری', 'bahoosh-analytics-pro' ), $settings, __( 'تا زمانی که کاربر از طریق بنر رضایت، اجازه تحلیل داده را ندهد رویدادی جمع‌آوری نمی‌شود.', 'bahoosh-analytics-pro' ) );
					self::checkbox( 'respect_dnt', __( 'رعایت Do Not Track / Global Privacy Control', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'anonymize_ip', __( 'ناشناس‌سازی IP', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'hash_user_email', __( 'ارسال ایمیل هش‌شده برای تطبیق هویت', 'bahoosh-analytics-pro' ), $settings, __( 'SHA-256 ایمیل با حروف کوچک ارسال می‌شود و مقدار خام هرگز فرستاده نمی‌شود.', 'bahoosh-analytics-pro' ) );
					?>
				</table>

				<h2><?php esc_html_e( 'عملکرد', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<?php
					self::number( 'max_concurrent_requests', __( 'درخواست‌های هم‌زمان', 'bahoosh-analytics-pro' ), $settings, 1, 12, __( 'هر رویداد در یک درخواست جدا ارسال می‌شود. این گزینه تعداد درخواست‌های هم‌زمان را محدود می‌کند.', 'bahoosh-analytics-pro' ) );
					self::number( 'max_events_per_page', __( 'حداکثر رویداد در هر بازدید صفحه', 'bahoosh-analytics-pro' ), $settings, 10, 5000 );
					self::number( 'max_retry_attempts', __( 'حداکثر تلاش مجدد', 'bahoosh-analytics-pro' ), $settings, 1, 50 );
					self::number( 'max_queue_size', __( 'حداکثر رویدادهای صف', 'bahoosh-analytics-pro' ), $settings, 50, 20000 );
					self::checkbox( 'multi_tab_coordination', __( 'هماهنگی بین تب‌های مرورگر', 'bahoosh-analytics-pro' ), $settings, __( 'یک تب صف معوق را به نمایندگی از بقیه پردازش می‌کند. خاموش‌کردن آن امن است و جلوگیری از تکرار به این گزینه وابسته نیست.', 'bahoosh-analytics-pro' ) );
					?>
				</table>

				<h2><?php esc_html_e( 'فضای کاری و ظاهر', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<?php
					self::checkbox( 'module_experience', __( 'ماژول تجربه کاربری', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'module_funnels', __( 'ماژول قیف‌ها', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'module_journeys', __( 'ماژول سفر کاربران', 'bahoosh-analytics-pro' ), $settings );
					self::checkbox( 'module_ai', __( 'ماژول مرکز هوش مصنوعی', 'bahoosh-analytics-pro' ), $settings );
					?>
					<tr><th scope="row"><label for="bap-admin-accent"><?php esc_html_e( 'رنگ اصلی رابط', 'bahoosh-analytics-pro' ); ?></label></th><td><input type="color" id="bap-admin-accent" name="bap[admin_accent]" value="<?php echo esc_attr( $settings['admin_accent'] ); ?>" /></td></tr>
					<tr><th scope="row"><label for="bap-admin-density"><?php esc_html_e( 'تراکم رابط', 'bahoosh-analytics-pro' ); ?></label></th><td><select id="bap-admin-density" name="bap[admin_density]"><option value="comfortable" <?php selected( 'comfortable', $settings['admin_density'] ); ?>><?php esc_html_e( 'راحت', 'bahoosh-analytics-pro' ); ?></option><option value="compact" <?php selected( 'compact', $settings['admin_density'] ); ?>><?php esc_html_e( 'فشرده', 'bahoosh-analytics-pro' ); ?></option></select></td></tr>
				</table>

				<h2><?php esc_html_e( 'اشکال‌زدایی', 'bahoosh-analytics-pro' ); ?></h2>
				<table class="form-table" role="presentation">
					<?php
					self::checkbox( 'debug', __( 'حالت دیباگ', 'bahoosh-analytics-pro' ), $settings, __( 'فعالیت افزونه را در یک گزارش محدود و پاک‌سازی‌شده و همچنین Console مرورگر ثبت می‌کند. در محیط عملیاتی خاموش باشد.', 'bahoosh-analytics-pro' ) );
					?>
					<tr>
						<th scope="row"><?php esc_html_e( 'ابزارها', 'bahoosh-analytics-pro' ); ?></th>
						<td>
							<a href="<?php echo esc_url( admin_url( 'admin.php?page=' . BAP_Admin::INSPECTOR_SLUG ) ); ?>">
								<?php esc_html_e( 'بازرس رویدادها', 'bahoosh-analytics-pro' ); ?>
							</a> &middot;
							<a href="<?php echo esc_url( admin_url( 'admin.php?page=' . BAP_Admin::DIAGNOSTICS_SLUG ) ); ?>">
								<?php esc_html_e( 'عیب‌یابی', 'bahoosh-analytics-pro' ); ?>
							</a>
						</td>
					</tr>
				</table>

				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Renders a checkbox row.
	 *
	 * @param string $key         Setting key.
	 * @param string $label       Field label.
	 * @param array  $settings    Current settings.
	 * @param string $description Optional description.
	 * @return void
	 */
	private static function checkbox( $key, $label, array $settings, $description = '' ) {
		?>
		<tr>
			<th scope="row"><?php echo esc_html( $label ); ?></th>
			<td>
				<label>
					<input type="checkbox" id="bap-<?php echo esc_attr( $key ); ?>"
						name="bap[<?php echo esc_attr( $key ); ?>]" value="1"
						<?php checked( ! empty( $settings[ $key ] ) ); ?> />
					<?php esc_html_e( 'فعال', 'bahoosh-analytics-pro' ); ?>
				</label>
				<?php if ( '' !== $description ) : ?>
					<p class="description"><?php echo esc_html( $description ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * Renders a number row.
	 *
	 * @param string $key      Setting key.
	 * @param string $label    Field label.
	 * @param array  $settings Current settings.
	 * @param int    $min      Minimum.
	 * @param int    $max      Maximum.
	 * @param string $description Optional help text.
	 * @return void
	 */
	private static function number( $key, $label, array $settings, $min, $max, $description = '' ) {
		?>
		<tr>
			<th scope="row"><label for="bap-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<input type="number" id="bap-<?php echo esc_attr( $key ); ?>"
					name="bap[<?php echo esc_attr( $key ); ?>]"
					value="<?php echo esc_attr( (string) $settings[ $key ] ); ?>"
					min="<?php echo esc_attr( (string) $min ); ?>"
					max="<?php echo esc_attr( (string) $max ); ?>" class="small-text" />
				<?php if ( '' !== $description ) : ?>
					<p class="description"><?php echo esc_html( $description ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}
}
