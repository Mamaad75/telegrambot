<?php
/**
 * Diagnostics screen and Site Health integration.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Answers the question an administrator actually asks: "is it working?"
 *
 * Every check returns a status, a human explanation and — where the answer is
 * "no" — what to do about it. The same checks feed WordPress Site Health, so a
 * broken analytics setup surfaces where site owners already look instead of
 * only on a screen they have to remember to visit.
 */
class BAP_Diagnostics_Page {

	const NONCE_ACTION = 'bap_run_connection_test';
	const NONCE_FIELD  = 'bap_diagnostics_nonce';

	const STATUS_GOOD        = 'good';
	const STATUS_RECOMMENDED = 'recommended';
	const STATUS_CRITICAL    = 'critical';

	/**
	 * Registers hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_post_bap_run_connection_test', array( __CLASS__, 'handle_connection_test' ) );
		add_action( 'admin_post_bap_retry_failed_events', array( __CLASS__, 'handle_retry_failed' ) );
		add_filter( 'site_status_tests', array( __CLASS__, 'register_site_health_test' ) );
		add_filter( 'debug_information', array( __CLASS__, 'register_debug_information' ) );
	}

	// ---------- Checks ----------

	/**
	 * Runs every local check.
	 *
	 * Deliberately does no network I/O: this renders on page load, and a
	 * hanging collector must not hang wp-admin. The connection test is a
	 * separate, explicit action.
	 *
	 * @return array[] Each: `label`, `status`, `message`, `action` (optional).
	 */
	public static function run_checks() {
		$settings = BAP_Settings::all();
		$checks   = array();

		$checks['environment'] = self::check_environment();
		$checks['configured']  = self::check_configured( $settings );
		$checks['api_key']     = self::check_api_key();
		$checks['enabled']     = self::check_enabled( $settings );
		$checks['transport']   = self::check_transport( $settings );
		$checks['outbox']      = self::check_outbox();
		$checks['cron']        = self::check_cron();
		$checks['bundle']      = self::check_bundle();
		$checks['woocommerce'] = self::check_woocommerce( $settings );
		$checks['privacy']     = self::check_privacy( $settings );
		$checks['consent']     = self::check_consent( $settings );
		$checks['connection']  = self::check_last_connection();

		/**
		 * Filters the diagnostics checks.
		 *
		 * @param array $checks Check results keyed by id.
		 */
		return apply_filters( 'bap_diagnostics_checks', $checks );
	}

	/**
	 * Worst status across all checks.
	 *
	 * @param array $checks Check results.
	 * @return string
	 */
	public static function overall_status( array $checks ) {
		foreach ( $checks as $check ) {
			if ( self::STATUS_CRITICAL === $check['status'] ) {
				return self::STATUS_CRITICAL;
			}
		}
		foreach ( $checks as $check ) {
			if ( self::STATUS_RECOMMENDED === $check['status'] ) {
				return self::STATUS_RECOMMENDED;
			}
		}
		return self::STATUS_GOOD;
	}

	/**
	 * Platform versions and plugin presence.
	 *
	 * @return array
	 */
	private static function check_environment() {
		global $wp_version;

		$php_ok = version_compare( PHP_VERSION, '7.4', '>=' );
		$wp_ok  = version_compare( $wp_version, '5.8', '>=' );

		$summary = sprintf(
			/* translators: 1: plugin version, 2: WordPress version, 3: PHP version, 4: WooCommerce state. */
			__( 'افزونه %1$s · وردپرس %2$s · PHP %3$s · ووکامرس %4$s', 'bahoosh-analytics-pro' ),
			BAP_VERSION,
			$wp_version,
			PHP_VERSION,
			BAP_WooCommerce::is_active()
				? ( defined( 'WC_VERSION' ) ? WC_VERSION : __( 'فعال', 'bahoosh-analytics-pro' ) )
				: __( 'غیرفعال', 'bahoosh-analytics-pro' )
		);

		if ( $php_ok && $wp_ok ) {
			return self::result( __( 'محیط', 'bahoosh-analytics-pro' ), self::STATUS_GOOD, $summary );
		}

		return self::result(
			__( 'محیط', 'bahoosh-analytics-pro' ),
			self::STATUS_CRITICAL,
			$summary,
			__( 'این افزونه به وردپرس ۵.۸ یا جدیدتر و PHP 7.4 یا جدیدتر نیاز دارد.', 'bahoosh-analytics-pro' )
		);
	}

	/**
	 * Whether the last real request to the collector worked.
	 *
	 * @return array
	 */
	private static function check_last_connection() {
		$label = __( 'دسترسی به کالکتور', 'bahoosh-analytics-pro' );
		$last  = get_option( 'bap_last_transport_result', array() );

		if ( ! is_array( $last ) || empty( $last['at'] ) ) {
			return self::result(
				$label,
				self::STATUS_RECOMMENDED,
				__( 'هنوز درخواستی ارسال نشده و وضعیت دسترسی نامشخص است.', 'bahoosh-analytics-pro' ),
				__( 'از «تست اتصال» در پایین صفحه استفاده کنید.', 'bahoosh-analytics-pro' )
			);
		}

		$when = sprintf(
			/* translators: %s: human-readable time difference. */
			__( '%s قبل', 'bahoosh-analytics-pro' ),
			human_time_diff( (int) $last['at'] )
		);

		if ( ! empty( $last['ok'] ) ) {
			return self::result(
				$label,
				self::STATUS_GOOD,
				sprintf(
					/* translators: %s: relative time. */
					__( 'آخرین درخواست %s موفق بود.', 'bahoosh-analytics-pro' ),
					$when
				)
			);
		}

		return self::result(
			$label,
			self::STATUS_CRITICAL,
			sprintf(
				/* translators: 1: relative time, 2: HTTP status, 3: error message. */
				__( 'آخرین درخواست %1$s ناموفق بود (HTTP %2$d): %3$s', 'bahoosh-analytics-pro' ),
				$when,
				(int) $last['status'],
				isset( $last['error'] ) ? $last['error'] : ''
			),
			__( 'آدرس کالکتور و کلید API را بررسی و سپس تست اتصال را اجرا کنید.', 'bahoosh-analytics-pro' )
		);
	}

	/**
	 * Whether the consent configuration is coherent.
	 *
	 * @param array $settings Settings.
	 * @return array
	 */
	private static function check_consent( array $settings ) {
		$label = __( 'رضایت', 'bahoosh-analytics-pro' );
		$state = BAP_Consent::current();

		$summary = sprintf(
			/* translators: 1: analytics state, 2: source of the decision. */
			__( 'رضایت تحلیل داده برای این درخواست: %1$s (منبع: %2$s).', 'bahoosh-analytics-pro' ),
			$state['analytics'] ? __( 'مجاز', 'bahoosh-analytics-pro' ) : __( 'عدم رضایت', 'bahoosh-analytics-pro' ),
			$state['source']
		);

		if ( ! empty( $settings['require_consent'] ) && 'cookie' !== $state['source'] && ! $state['analytics'] ) {
			return self::result(
				$label,
				self::STATUS_RECOMMENDED,
				$summary . ' ' . __( 'هیچ تصمیم رضایتی در این مرورگر ثبت نشده است.', 'bahoosh-analytics-pro' ),
				__( 'پیش از پاسخ کاربر به بنر رضایت طبیعی است. اگر هیچ‌وقت تغییر نکرد، بنر رضایت API مربوطه را فراخوانی نمی‌کند.', 'bahoosh-analytics-pro' )
			);
		}

		return self::result( $label, self::STATUS_GOOD, $summary );
	}

	/**
	 * Collector URL and site id present.
	 *
	 * @param array $settings Settings.
	 * @return array
	 */
	private static function check_configured( array $settings ) {
		if ( BAP_Settings::is_configured() ) {
			return self::result(
				__( 'کالکتور پیکربندی شده', 'bahoosh-analytics-pro' ),
				self::STATUS_GOOD,
				sprintf(
					/* translators: %s: collector URL. */
					__( 'در حال ارسال به %s.', 'bahoosh-analytics-pro' ),
					$settings['api_url']
				)
			);
		}

		return self::result(
			__( 'کالکتور پیکربندی شده', 'bahoosh-analytics-pro' ),
			self::STATUS_CRITICAL,
			__( 'آدرس کالکتور یا شناسه سایت تنظیم نشده و داده‌ای جمع‌آوری نمی‌شود.', 'bahoosh-analytics-pro' ),
			__( 'تنظیمات را باز کنید و آدرس کالکتور و شناسه سایت را وارد کنید.', 'bahoosh-analytics-pro' )
		);
	}

	/**
	 * A secret key is stored.
	 *
	 * @return array
	 */
	private static function check_api_key() {
		if ( '' !== BAP_Settings::get_api_key() ) {
			return self::result(
				__( 'کلید API ذخیره شده است', 'bahoosh-analytics-pro' ),
				self::STATUS_GOOD,
				__( 'کلید API کالکتور روی سرور نگه‌داری می‌شود و هرگز به مرورگر ارسال نمی‌شود.', 'bahoosh-analytics-pro' )
			);
		}

		return self::result(
			__( 'کلید API ذخیره شده است', 'bahoosh-analytics-pro' ),
			self::STATUS_CRITICAL,
			__( 'کلید API ذخیره نشده و کالکتور همه Batchها را رد خواهد کرد.', 'bahoosh-analytics-pro' ),
			__( 'کلید صادرشده توسط سرویس تحلیل را در تنظیمات وارد کنید.', 'bahoosh-analytics-pro' )
		);
	}

	/**
	 * Tracking switched on, and not silently excluding everyone.
	 *
	 * @param array $settings Settings.
	 * @return array
	 */
	private static function check_enabled( array $settings ) {
		if ( empty( $settings['enabled'] ) ) {
			return self::result(
				__( 'رهگیری فعال', 'bahoosh-analytics-pro' ),
				self::STATUS_CRITICAL,
				__( 'رهگیری در تنظیمات خاموش است.', 'bahoosh-analytics-pro' ),
				__( 'رهگیری را در تنظیمات فعال کنید.', 'bahoosh-analytics-pro' )
			);
		}

		if ( ! empty( $settings['require_consent'] ) ) {
			return self::result(
				__( 'رهگیری فعال', 'bahoosh-analytics-pro' ),
				self::STATUS_RECOMMENDED,
				__( 'رهگیری روشن است اما به رضایت نیاز دارد. تا زمانی که بنر رضایت اجازه تحلیل داده را ندهد چیزی جمع‌آوری نمی‌شود.', 'bahoosh-analytics-pro' ),
				__( 'بررسی کنید بنر رضایت پس از پذیرش کاربر، bahoosh("consent", { analytics: true }) را فراخوانی کند.', 'bahoosh-analytics-pro' )
			);
		}

		return self::result(
			__( 'رهگیری فعال', 'bahoosh-analytics-pro' ),
			self::STATUS_GOOD,
			__( 'رهگیری برای بازدیدکنندگان فعال است.', 'bahoosh-analytics-pro' )
		);
	}

	/**
	 * Transport mode sanity.
	 *
	 * @param array $settings Settings.
	 * @return array
	 */
	private static function check_transport( array $settings ) {
		if ( 'direct' === $settings['transport_mode'] ) {
			if ( '' === $settings['ingest_key'] ) {
				return self::result(
					__( 'روش ارسال داده', 'bahoosh-analytics-pro' ),
					self::STATUS_RECOMMENDED,
					__( 'حالت مستقیم انتخاب شده اما کلید عمومی دریافت داده تنظیم نشده؛ بنابراین افزونه موقتاً از وردپرس برای ارسال استفاده می‌کند.', 'bahoosh-analytics-pro' ),
					__( 'یک کلید عمومی دریافت داده وارد کنید یا به حالت پروکسی برگردید.', 'bahoosh-analytics-pro' )
				);
			}

			return self::result(
				__( 'روش ارسال داده', 'bahoosh-analytics-pro' ),
				self::STATUS_RECOMMENDED,
				__( 'رویدادها مستقیم از مرورگر به کالکتور می‌روند و وردپرس نمی‌تواند هویت کاربر واردشده را برای این رویدادها تأیید کند.', 'bahoosh-analytics-pro' ),
				__( 'تا زمانی که درخواست اضافه واقعاً مشکل عملکردی ایجاد نکرده، از حالت پروکسی استفاده کنید.', 'bahoosh-analytics-pro' )
			);
		}

		return self::result(
			__( 'روش ارسال داده', 'bahoosh-analytics-pro' ),
			self::STATUS_GOOD,
			__( 'رویدادها از طریق وردپرس ارسال می‌شوند؛ کلید API روی سرور می‌ماند و هویت بازدیدکننده توسط وردپرس تأیید می‌شود.', 'bahoosh-analytics-pro' )
		);
	}

	/**
	 * Outbox backlog.
	 *
	 * @return array
	 */
	private static function check_outbox() {
		$stats = BAP_Outbox::stats();
		$label = __( 'صف رویدادهای سمت سرور', 'bahoosh-analytics-pro' );

		if ( $stats['failed'] > 0 ) {
			return self::result(
				$label,
				self::STATUS_CRITICAL,
				sprintf(
					/* translators: %d: number of failed events. */
					_n(
						'%d event could not be delivered and has been parked.',
						'%d events could not be delivered and have been parked.',
						$stats['failed'],
						'bahoosh-analytics-pro'
					),
					$stats['failed']
				),
				__( 'آدرس کالکتور و کلید API را بررسی کنید، سپس از «ارسال مجدد رویدادهای ناموفق» در پایین صفحه استفاده کنید.', 'bahoosh-analytics-pro' )
			);
		}

		if ( $stats['pending'] > 50 ) {
			return self::result(
				$label,
				self::STATUS_RECOMMENDED,
				sprintf(
					/* translators: %d: number of pending events. */
					__( '%d رویداد در انتظار ارسال است. انباشته‌شدن صف معمولاً یعنی WP-Cron اجرا نمی‌شود.', 'bahoosh-analytics-pro' ),
					$stats['pending']
				),
				__( 'بررسی کنید WP-Cron اجرا شود یا یک Cron واقعی روی سرور تنظیم کنید.', 'bahoosh-analytics-pro' )
			);
		}

		return self::result(
			$label,
			self::STATUS_GOOD,
			sprintf(
				/* translators: %d: number of pending events. */
				__( '%d رویداد در انتظار است و هیچ مورد ناموفقی وجود ندارد.', 'bahoosh-analytics-pro' ),
				$stats['pending']
			)
		);
	}

	/**
	 * Whether the outbox worker can actually run.
	 *
	 * @return array
	 */
	private static function check_cron() {
		$label = __( 'ارسال زمان‌بندی‌شده', 'bahoosh-analytics-pro' );

		if ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ) {
			return self::result(
				$label,
				self::STATUS_RECOMMENDED,
				__( 'WP-Cron غیرفعال است. رویدادهای خرید سمت سرور با وظیفه زمان‌بندی‌شده ارسال می‌شوند.', 'bahoosh-analytics-pro' ),
				__( 'مطمئن شوید Cron سرور wp-cron.php را فراخوانی می‌کند یا دستور wp cron event run --due-now را زمان‌بندی کنید.', 'bahoosh-analytics-pro' )
			);
		}

		$next = wp_next_scheduled( BAP_Outbox::CRON_HOOK );
		if ( ! $next ) {
			return self::result(
				$label,
				self::STATUS_RECOMMENDED,
				__( 'وظیفه زمان‌بندی‌شده ارسال ثبت نشده است.', 'bahoosh-analytics-pro' ),
				__( 'برای بازیابی زمان‌بندی، افزونه را یک‌بار غیرفعال و دوباره فعال کنید.', 'bahoosh-analytics-pro' )
			);
		}

		return self::result(
			$label,
			self::STATUS_GOOD,
			sprintf(
				/* translators: %s: human-readable time difference. */
				__( 'ارسال بعدی تا %s دیگر انجام می‌شود.', 'bahoosh-analytics-pro' ),
				human_time_diff( time(), $next )
			)
		);
	}

	/**
	 * The generated tracker bundle exists and is not older than its sources.
	 *
	 * @return array
	 */
	private static function check_bundle() {
		$label  = __( 'باندل Tracker', 'bahoosh-analytics-pro' );
		$bundle = BAP_PLUGIN_DIR . 'assets/js/dist/bahoosh-tracker.js';

		if ( ! is_readable( $bundle ) ) {
			return self::result(
				$label,
				self::STATUS_RECOMMENDED,
				__( 'فایل تجمیعی Tracker وجود ندارد؛ بنابراین ماژول‌ها جداگانه بارگذاری می‌شوند. رهگیری کار می‌کند اما درخواست‌های بیشتری ایجاد می‌شود.', 'bahoosh-analytics-pro' ),
				__( 'برای ساخت مجدد، دستور npm run build را در پوشه افزونه اجرا کنید.', 'bahoosh-analytics-pro' )
			);
		}

		$bundle_time = (int) filemtime( $bundle );
		$newest      = 0;
		foreach ( (array) glob( BAP_PLUGIN_DIR . 'assets/js/core/*.js' ) as $module ) {
			$newest = max( $newest, (int) filemtime( $module ) );
		}

		if ( $newest > $bundle_time ) {
			return self::result(
				$label,
				self::STATUS_RECOMMENDED,
				__( 'فایل تجمیعی Tracker از ماژول‌های منبع قدیمی‌تر است و ممکن است تغییرات جدید فعال نشده باشند.', 'bahoosh-analytics-pro' ),
				__( 'دستور npm run build را در پوشه افزونه اجرا کنید.', 'bahoosh-analytics-pro' )
			);
		}

		return self::result(
			$label,
			self::STATUS_GOOD,
			sprintf(
				/* translators: %s: file size. */
				__( 'به‌صورت یک فایل %s بارگذاری شده است.', 'bahoosh-analytics-pro' ),
				size_format( (int) filesize( $bundle ) )
			)
		);
	}

	/**
	 * WooCommerce integration state.
	 *
	 * @param array $settings Settings.
	 * @return array
	 */
	private static function check_woocommerce( array $settings ) {
		$label = __( 'ووکامرس', 'bahoosh-analytics-pro' );

		if ( ! BAP_WooCommerce::is_active() ) {
			return self::result( $label, self::STATUS_GOOD, __( 'ووکامرس فعال نیست و رهگیری فروشگاه در حالت غیرفعال است.', 'bahoosh-analytics-pro' ) );
		}

		if ( empty( $settings['woocommerce_enabled'] ) ) {
			return self::result(
				$label,
				self::STATUS_RECOMMENDED,
				__( 'ووکامرس فعال است اما رهگیری فروشگاه خاموش است.', 'bahoosh-analytics-pro' ),
				__( 'رهگیری ووکامرس را در تنظیمات فعال کنید.', 'bahoosh-analytics-pro' )
			);
		}

		if ( empty( $settings['server_side_purchase'] ) ) {
			return self::result(
				$label,
				self::STATUS_CRITICAL,
				__( 'رهگیری خرید سمت سرور خاموش است؛ با بستن تب پس از پرداخت ممکن است سفارش از دست برود و با بارگذاری مجدد صفحه تشکر احتمال شمارش تکراری وجود دارد.', 'bahoosh-analytics-pro' ),
				__( 'رویدادهای خرید و بازپرداخت سمت سرور را در تنظیمات دوباره فعال کنید.', 'bahoosh-analytics-pro' )
			);
		}

		return self::result( $label, self::STATUS_GOOD, __( 'رهگیری فروشگاه فعال است و خریدها در سمت سرور ثبت می‌شوند.', 'bahoosh-analytics-pro' ) );
	}

	/**
	 * Privacy posture.
	 *
	 * @param array $settings Settings.
	 * @return array
	 */
	private static function check_privacy( array $settings ) {
		$label  = __( 'حریم خصوصی', 'bahoosh-analytics-pro' );
		$issues = array();

		if ( empty( $settings['anonymize_ip'] ) ) {
			$issues[] = __( 'آدرس‌های IP به‌صورت کامل ذخیره می‌شوند.', 'bahoosh-analytics-pro' );
		}
		if ( empty( $settings['respect_dnt'] ) ) {
			$issues[] = __( 'سیگنال‌های Do Not Track و Global Privacy Control نادیده گرفته می‌شوند.', 'bahoosh-analytics-pro' );
		}

		if ( empty( $issues ) ) {
			return self::result( $label, self::STATUS_GOOD, __( 'ناشناس‌سازی IP فعال است و سیگنال‌های حریم خصوصی مرورگر رعایت می‌شوند.', 'bahoosh-analytics-pro' ) );
		}

		return self::result(
			$label,
			self::STATUS_RECOMMENDED,
			implode( ' ', $issues ),
			__( 'تنظیمات حریم خصوصی را با قوانین مربوط به کاربران خود تطبیق دهید.', 'bahoosh-analytics-pro' )
		);
	}

	/**
	 * Builds a check result.
	 *
	 * @param string $label   Check name.
	 * @param string $status  One of the STATUS_* constants.
	 * @param string $message What is true right now.
	 * @param string $action  What to do about it.
	 * @return array
	 */
	private static function result( $label, $status, $message, $action = '' ) {
		return array(
			'label'   => $label,
			'status'  => $status,
			'message' => $message,
			'action'  => $action,
		);
	}

	// ---------- Connection test ----------

	/**
	 * Sends a real request to the collector and reports what came back.
	 *
	 * @return void
	 */
	public static function handle_connection_test() {
		if ( ! current_user_can( BAP_Admin::settings_capability() ) ) {
			wp_die( esc_html__( 'اجازه اجرای این تست را ندارید.', 'bahoosh-analytics-pro' ) );
		}

		check_admin_referer( self::NONCE_ACTION, self::NONCE_FIELD );

		$result = BAP_Transport::dashboard(
			array(
				'range' => 'today',
				'from'  => gmdate( 'Y-m-d' ),
				'to'    => gmdate( 'Y-m-d' ),
			)
		);

		update_option(
			'bap_last_transport_result',
			array(
				'ok'     => ! empty( $result['ok'] ),
				'status' => (int) $result['status'],
				'error'  => substr( (string) $result['error'], 0, 300 ),
				'at'     => time(),
			),
			false
		);

		set_transient(
			'bap_connection_test',
			array(
				'ok'     => ! empty( $result['ok'] ),
				'status' => (int) $result['status'],
				'error'  => (string) $result['error'],
				'tested' => time(),
			),
			5 * MINUTE_IN_SECONDS
		);

		wp_safe_redirect( admin_url( 'admin.php?page=' . BAP_Admin::DIAGNOSTICS_SLUG ) );
		exit;
	}

	/**
	 * Requeues parked events.
	 *
	 * @return void
	 */
	public static function handle_retry_failed() {
		if ( ! current_user_can( BAP_Admin::settings_capability() ) ) {
			wp_die( esc_html__( 'اجازه انجام این عملیات را ندارید.', 'bahoosh-analytics-pro' ) );
		}

		check_admin_referer( self::NONCE_ACTION, self::NONCE_FIELD );

		$requeued = BAP_Outbox::retry_failed();

		wp_safe_redirect(
			add_query_arg(
				'bap-requeued',
				(int) $requeued,
				admin_url( 'admin.php?page=' . BAP_Admin::DIAGNOSTICS_SLUG )
			)
		);
		exit;
	}

	// ---------- Site Health ----------

	/**
	 * Adds a Site Health test.
	 *
	 * @param array $tests Registered tests.
	 * @return array
	 */
	public static function register_site_health_test( $tests ) {
		$tests['direct']['bahoosh_analytics'] = array(
			'label' => __( 'باهوش آنالیتیکس', 'bahoosh-analytics-pro' ),
			'test'  => array( __CLASS__, 'site_health_test' ),
		);
		return $tests;
	}

	/**
	 * Site Health test body.
	 *
	 * @return array
	 */
	public static function site_health_test() {
		$checks  = self::run_checks();
		$overall = self::overall_status( $checks );

		$problems = array();
		foreach ( $checks as $check ) {
			if ( self::STATUS_GOOD !== $check['status'] ) {
				$problems[] = '<li>' . esc_html( $check['label'] . ': ' . $check['message'] ) . '</li>';
			}
		}

		if ( empty( $problems ) ) {
			return array(
				'label'       => __( 'باهوش آنالیتیکس در حال جمع‌آوری داده است', 'bahoosh-analytics-pro' ),
				'status'      => 'good',
				'badge'       => array(
					'label' => __( 'تحلیل داده', 'bahoosh-analytics-pro' ),
					'color' => 'blue',
				),
				'description' => '<p>' . esc_html__( 'همه بررسی‌ها با موفقیت انجام شد.', 'bahoosh-analytics-pro' ) . '</p>',
				'test'        => 'bahoosh_analytics',
			);
		}

		return array(
			'label'       => __( 'باهوش آنالیتیکس نیاز به بررسی دارد', 'bahoosh-analytics-pro' ),
			'status'      => self::STATUS_CRITICAL === $overall ? 'critical' : 'recommended',
			'badge'       => array(
				'label' => __( 'تحلیل داده', 'bahoosh-analytics-pro' ),
				'color' => 'blue',
			),
			'description' => '<ul>' . implode( '', $problems ) . '</ul>',
			'actions'     => sprintf(
				'<p><a href="%s">%s</a></p>',
				esc_url( admin_url( 'admin.php?page=' . BAP_Admin::DIAGNOSTICS_SLUG ) ),
				esc_html__( 'باز کردن عیب‌یابی باهوش', 'bahoosh-analytics-pro' )
			),
			'test'        => 'bahoosh_analytics',
		);
	}

	/**
	 * Adds plugin state to the Site Health info tab.
	 *
	 * Secrets are reported as present/absent, never printed — this screen is
	 * routinely copied wholesale into support tickets.
	 *
	 * @param array $info Debug information.
	 * @return array
	 */
	public static function register_debug_information( $info ) {
		$settings = BAP_Settings::all();
		$stats    = BAP_Outbox::stats();

		$info['bahoosh-analytics-pro'] = array(
			'label'  => __( 'باهوش آنالیتیکس', 'bahoosh-analytics-pro' ),
			'fields' => array(
				'version'        => array(
					'label' => __( 'نسخه', 'bahoosh-analytics-pro' ),
					'value' => BAP_VERSION,
				),
				'schema_version' => array(
					'label' => __( 'ساختار رویداد', 'bahoosh-analytics-pro' ),
					'value' => (string) BAP_SCHEMA_VERSION,
				),
				'api_url'        => array(
					'label' => __( 'آدرس کالکتور', 'bahoosh-analytics-pro' ),
					'value' => $settings['api_url'] ? $settings['api_url'] : __( 'تنظیم نشده', 'bahoosh-analytics-pro' ),
				),
				'site_id'        => array(
					'label' => __( 'شناسه سایت', 'bahoosh-analytics-pro' ),
					'value' => $settings['site_id'] ? $settings['site_id'] : __( 'تنظیم نشده', 'bahoosh-analytics-pro' ),
				),
				'api_key'        => array(
					'label'   => __( 'کلید API', 'bahoosh-analytics-pro' ),
					'value'   => '' !== BAP_Settings::get_api_key()
						? __( 'ذخیره‌شده', 'bahoosh-analytics-pro' )
						: __( 'تنظیم نشده', 'bahoosh-analytics-pro' ),
					'private' => true,
				),
				'transport_mode' => array(
					'label' => __( 'روش ارسال داده', 'bahoosh-analytics-pro' ),
					'value' => $settings['transport_mode'],
				),
				'outbox'         => array(
					'label' => __( 'رویدادهای در صف', 'bahoosh-analytics-pro' ),
					'value' => sprintf(
						/* translators: 1: pending, 2: sending, 3: failed. */
						__( '%1$d در انتظار، %2$d در حال ارسال، %3$d ناموفق', 'bahoosh-analytics-pro' ),
						$stats['pending'],
						$stats['sending'],
						$stats['failed']
					),
				),
				'woocommerce'    => array(
					'label' => __( 'ووکامرس', 'bahoosh-analytics-pro' ),
					'value' => BAP_WooCommerce::is_active()
						? __( 'فعال', 'bahoosh-analytics-pro' )
						: __( 'غیرفعال', 'bahoosh-analytics-pro' ),
				),
			),
		);

		return $info;
	}

	// ---------- Rendering ----------

	/**
	 * Renders the diagnostics screen.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( BAP_Admin::settings_capability() ) ) {
			wp_die( esc_html__( 'اجازه مشاهده این صفحه را ندارید.', 'bahoosh-analytics-pro' ) );
		}

		$checks = self::run_checks();
		$test   = get_transient( 'bap_connection_test' );
		?>
		<div class="wrap bap-wrap bap-settings bap-unified-screen">
			<?php BAP_Admin::render_page_header(
				__( 'عیب‌یابی و سلامت سیستم', 'bahoosh-analytics-pro' ),
				__( 'وضعیت اتصال، تنظیمات، صف ارسال و سلامت رهگیری را در یک نمای عملیاتی بررسی کنید.', 'bahoosh-analytics-pro' ),
				BAP_Admin::DIAGNOSTICS_SLUG
			); ?>

			<?php if ( is_array( $test ) ) : ?>
				<div class="notice <?php echo $test['ok'] ? 'notice-success' : 'notice-error'; ?>">
					<p>
						<?php if ( $test['ok'] ) : ?>
							<?php esc_html_e( 'تست اتصال موفق بود — کالکتور پاسخ داد.', 'bahoosh-analytics-pro' ); ?>
						<?php else : ?>
							<?php
							printf(
								/* translators: 1: HTTP status, 2: error message. */
								esc_html__( 'تست اتصال ناموفق بود (HTTP %1$d): %2$s', 'bahoosh-analytics-pro' ),
								(int) $test['status'],
								esc_html( $test['error'] )
							);
							?>
						<?php endif; ?>
					</p>
				</div>
				<?php delete_transient( 'bap_connection_test' ); ?>
			<?php endif; ?>

			<section class="bap-section bap-diagnostics-section">
				<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'سلامت سیستم', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'بررسی‌های پیکربندی', 'bahoosh-analytics-pro' ); ?></h2></div></div>
			<table class="widefat striped bap-diagnostics">
				<caption class="screen-reader-text">
					<?php esc_html_e( 'بررسی پیکربندی تحلیل داده', 'bahoosh-analytics-pro' ); ?>
				</caption>
				<thead>
					<tr>
						<th scope="col"><?php esc_html_e( 'بررسی', 'bahoosh-analytics-pro' ); ?></th>
						<th scope="col"><?php esc_html_e( 'وضعیت', 'bahoosh-analytics-pro' ); ?></th>
						<th scope="col"><?php esc_html_e( 'جزئیات', 'bahoosh-analytics-pro' ); ?></th>
					</tr>
				</thead>
				<tbody>
					<?php foreach ( $checks as $check ) : ?>
						<tr>
							<th scope="row"><?php echo esc_html( $check['label'] ); ?></th>
							<td>
								<span class="bap-badge <?php echo esc_attr( 'is-' . $check['status'] ); ?>">
									<?php echo esc_html( self::status_label( $check['status'] ) ); ?>
								</span>
							</td>
							<td>
								<?php echo esc_html( $check['message'] ); ?>
								<?php if ( '' !== $check['action'] ) : ?>
									<p class="description"><?php echo esc_html( $check['action'] ); ?></p>
								<?php endif; ?>
							</td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
			</section>

			<?php
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only result notice.
			$requeued = isset( $_GET['bap-requeued'] ) ? (int) $_GET['bap-requeued'] : -1;
			if ( $requeued >= 0 ) :
				?>
				<div class="notice notice-success is-dismissible">
					<p>
						<?php
						printf(
							/* translators: %d: number of events requeued. */
							esc_html( _n( '%d رویداد به صف ارسال برگشت.', '%d رویداد به صف ارسال برگشت.', $requeued, 'bahoosh-analytics-pro' ) ),
							esc_html( (string) $requeued )
						);
						?>
					</p>
				</div>
			<?php endif; ?>

			<?php if ( BAP_Outbox::stats()['failed'] > 0 ) : ?>
				<section class="bap-section">
				<h2><?php esc_html_e( 'رویدادهای ناموفق', 'bahoosh-analytics-pro' ); ?></h2>
				<p class="description">
					<?php esc_html_e( 'رویدادهایی که همه تلاش‌های ارسالشان ناموفق شده نگه‌داری می‌شوند. پس از رفع مشکل پیکربندی، دوباره آن‌ها را ارسال کنید.', 'bahoosh-analytics-pro' ); ?>
				</p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="bap_retry_failed_events" />
					<?php wp_nonce_field( self::NONCE_ACTION, self::NONCE_FIELD ); ?>
					<?php submit_button( __( 'ارسال مجدد رویدادهای ناموفق', 'bahoosh-analytics-pro' ), 'secondary', 'submit', false ); ?>
				</form>
				</section>
			<?php endif; ?>

			<div class="bap-layout-1-1 bap-diagnostics-actions">
			<section class="bap-section">
			<h2><?php esc_html_e( 'تست اتصال', 'bahoosh-analytics-pro' ); ?></h2>
			<p class="description">
				<?php esc_html_e( 'یک درخواست با اطلاعات ذخیره‌شده به کالکتور می‌فرستد و نتیجه را گزارش می‌کند.', 'bahoosh-analytics-pro' ); ?>
			</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="bap_run_connection_test" />
				<?php wp_nonce_field( self::NONCE_ACTION, self::NONCE_FIELD ); ?>
				<?php submit_button( __( 'تست اتصال', 'bahoosh-analytics-pro' ), 'secondary', 'submit', false ); ?>
			</form>
			</section>

			<section class="bap-section">
			<h2><?php esc_html_e( 'بررسی مرورگر', 'bahoosh-analytics-pro' ); ?></h2>
			<p class="description">
				<?php
				esc_html_e(
					'یک صفحه از سایت را باز کنید و این دستور را در Console مرورگر اجرا کنید؛ هویت بازدیدکننده، نشست، موتور صف و شمارنده‌های ارسال را نشان می‌دهد.',
					'bahoosh-analytics-pro'
				);
				?>
			</p>
			<pre class="bap-code"><code>bahoosh('getState')</code></pre>
			</section>
			</div>
		</div>
		<?php
	}

	/**
	 * Human label for a status.
	 *
	 * @param string $status Status constant.
	 * @return string
	 */
	private static function status_label( $status ) {
		switch ( $status ) {
			case self::STATUS_CRITICAL:
				return __( 'نیازمند اقدام', 'bahoosh-analytics-pro' );
			case self::STATUS_RECOMMENDED:
				return __( 'بررسی', 'bahoosh-analytics-pro' );
			default:
				return __( 'سالم', 'bahoosh-analytics-pro' );
		}
	}
}
