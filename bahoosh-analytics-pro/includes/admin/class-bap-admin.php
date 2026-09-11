<?php
/**
 * Admin bootstrap.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the admin menu and screen assets.
 */
class BAP_Admin {

	const MENU_SLUG        = 'bahoosh-analytics';
	const SETTINGS_SLUG    = 'bahoosh-analytics-settings';
	const DIAGNOSTICS_SLUG = 'bahoosh-analytics-diagnostics';
	const INSPECTOR_SLUG   = 'bahoosh-analytics-inspector';
	const EXPLORER_SLUG    = 'bahoosh-analytics-explorer';
	const FUNNELS_SLUG     = 'bahoosh-analytics-funnels';
	const AI_SLUG          = 'bahoosh-analytics-ai';

	/**
	 * The capability required to read reports.
	 *
	 * Hardcoding `manage_options` means only administrators can ever see the
	 * numbers. Marketing and shop-manager roles routinely need them without
	 * being handed the keys to the site, so the capability is filterable.
	 *
	 * @return string
	 */
	public static function reports_capability() {
		/**
		 * Filters the capability required to view analytics reports.
		 *
		 * @param string $capability Default `manage_options`.
		 */
		return (string) apply_filters( 'bap_reports_capability', 'manage_options' );
	}

	/**
	 * The capability required to change settings.
	 *
	 * Separate from reading: viewing numbers is far less sensitive than
	 * editing an API key.
	 *
	 * @return string
	 */
	public static function settings_capability() {
		/**
		 * Filters the capability required to change plugin settings.
		 *
		 * @param string $capability Default `manage_options`.
		 */
		return (string) apply_filters( 'bap_settings_capability', 'manage_options' );
	}

	/**
	 * Registers hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'register_menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'admin_notices', array( __CLASS__, 'configuration_notice' ) );
		add_filter( 'admin_body_class', array( __CLASS__, 'admin_body_class' ) );
		add_filter( 'plugin_action_links_' . BAP_PLUGIN_BASENAME, array( __CLASS__, 'action_links' ) );

		BAP_Settings_Page::init();
		BAP_Diagnostics_Page::init();
		BAP_Inspector_Page::init();
	}

	/**
	 * Adds the menu entries.
	 *
	 * @return void
	 */
	public static function register_menu() {
		add_menu_page(
			__( 'باهوش آنالیتیکس', 'bahoosh-analytics-pro' ),
			__( 'باهوش آنالیتیکس', 'bahoosh-analytics-pro' ),
			self::reports_capability(),
			self::MENU_SLUG,
			array( 'BAP_Dashboard_Page', 'render' ),
			'dashicons-chart-area',
			25
		);

		add_submenu_page(
			self::MENU_SLUG,
			__( 'داشبورد', 'bahoosh-analytics-pro' ),
			__( 'داشبورد', 'bahoosh-analytics-pro' ),
			self::reports_capability(),
			self::MENU_SLUG,
			array( 'BAP_Dashboard_Page', 'render' )
		);

		// Four screens, each answering one question: how much, what exactly,
		// where the money leaks, and what to do about it.
		//
		// There used to be eight. "Experience", "Funnels" and "Journeys" were
		// three separate screens that each proxied a different collector report
		// and each showed the same placeholder when there was no collector; the
		// funnel builder in particular offered to define a funnel the plugin had
		// no way to measure. They are now one screen backed by data this site
		// actually holds, which is both fewer clicks and fewer lies.
		add_submenu_page(
			self::MENU_SLUG,
			__( 'رویدادها و صفحات', 'bahoosh-analytics-pro' ),
			__( 'رویدادها و صفحات', 'bahoosh-analytics-pro' ),
			self::reports_capability(),
			self::EXPLORER_SLUG,
			array( 'BAP_Explorer_Page', 'render' )
		);

		if ( BAP_Settings::get( 'module_funnels' ) ) {
			add_submenu_page(
				self::MENU_SLUG,
				__( 'قیف خرید و رها کردن', 'bahoosh-analytics-pro' ),
				__( 'قیف خرید', 'bahoosh-analytics-pro' ),
				self::reports_capability(),
				self::FUNNELS_SLUG,
				array( 'BAP_Studio_Page', 'render_funnels' )
			);
		}

		if ( BAP_Settings::get( 'module_ai' ) ) {
			add_submenu_page(
				self::MENU_SLUG,
				__( 'پیشنهادهای باهوش', 'bahoosh-analytics-pro' ),
				__( 'پیشنهادهای باهوش', 'bahoosh-analytics-pro' ),
				self::reports_capability(),
				self::AI_SLUG,
				array( 'BAP_Studio_Page', 'render_ai' )
			);
		}

		add_submenu_page(
			self::MENU_SLUG,
			__( 'تنظیمات', 'bahoosh-analytics-pro' ),
			__( 'تنظیمات', 'bahoosh-analytics-pro' ),
			self::settings_capability(),
			self::SETTINGS_SLUG,
			array( 'BAP_Settings_Page', 'render' )
		);

		// The queue inspector inspects the delivery queue to a collector. With
		// no collector there is no queue, and the screen would only ever be
		// empty, so it appears when it has something to show.
		if ( BAP_Settings::is_configured() ) {
			add_submenu_page(
				self::MENU_SLUG,
				__( 'صف ارسال به کالکتور', 'bahoosh-analytics-pro' ),
				__( 'صف ارسال', 'bahoosh-analytics-pro' ),
				self::reports_capability(),
				self::INSPECTOR_SLUG,
				array( 'BAP_Inspector_Page', 'render' )
			);
		}

		add_submenu_page(
			self::MENU_SLUG,
			__( 'عیب‌یابی', 'bahoosh-analytics-pro' ),
			__( 'عیب‌یابی', 'bahoosh-analytics-pro' ),
			self::settings_capability(),
			self::DIAGNOSTICS_SLUG,
			array( 'BAP_Diagnostics_Page', 'render' )
		);
	}


	/**
	 * Unified navigation model shared by every Bahoosh admin screen.
	 *
	 * @return array<int,array{slug:string,label:string,capability:string,enabled:bool}>
	 */
	public static function navigation_items() {
		return array(
			array( 'slug' => self::MENU_SLUG,        'label' => __( 'داشبورد', 'bahoosh-analytics-pro' ),           'capability' => self::reports_capability(),  'enabled' => true ),
			array( 'slug' => self::EXPLORER_SLUG,    'label' => __( 'رویدادها و صفحات', 'bahoosh-analytics-pro' ),  'capability' => self::reports_capability(),  'enabled' => true ),
			array( 'slug' => self::FUNNELS_SLUG,     'label' => __( 'قیف خرید', 'bahoosh-analytics-pro' ),          'capability' => self::reports_capability(),  'enabled' => (bool) BAP_Settings::get( 'module_funnels' ) ),
			array( 'slug' => self::AI_SLUG,          'label' => __( 'پیشنهادهای باهوش', 'bahoosh-analytics-pro' ),   'capability' => self::reports_capability(),  'enabled' => (bool) BAP_Settings::get( 'module_ai' ) ),
			array( 'slug' => self::INSPECTOR_SLUG,   'label' => __( 'صف ارسال', 'bahoosh-analytics-pro' ),          'capability' => self::reports_capability(),  'enabled' => BAP_Settings::is_configured() ),
			array( 'slug' => self::DIAGNOSTICS_SLUG, 'label' => __( 'عیب‌یابی', 'bahoosh-analytics-pro' ),           'capability' => self::settings_capability(), 'enabled' => true ),
			array( 'slug' => self::SETTINGS_SLUG,    'label' => __( 'تنظیمات', 'bahoosh-analytics-pro' ),           'capability' => self::settings_capability(), 'enabled' => true ),
		);
	}

	/**
	 * Renders the same visual shell on every Bahoosh screen.
	 *
	 * @param string $title    Page title.
	 * @param string $subtitle Supporting description.
	 * @param string $active   Active menu slug.
	 * @param string $kicker   Small eyebrow label.
	 * @return void
	 */
	public static function render_page_header( $title, $subtitle, $active, $kicker = '' ) {
		if ( '' === $kicker ) {
			$kicker = __( 'باهوش', 'bahoosh-analytics-pro' );
		}
		?>
		<header class="bap-page-hero">
			<div class="bap-page-hero__copy">
				<span class="bap-kicker"><?php echo esc_html( $kicker ); ?></span>
				<h1><?php echo esc_html( $title ); ?></h1>
				<p><?php echo esc_html( $subtitle ); ?></p>
			</div>
			<div class="bap-page-hero__meta">
				<span class="bap-version-pill">v<?php echo esc_html( BAP_VERSION ); ?></span>
			</div>
		</header>
		<nav class="bap-primary-nav" aria-label="<?php esc_attr_e( 'ناوبری باهوش آنالیتیکس', 'bahoosh-analytics-pro' ); ?>">
			<?php foreach ( self::navigation_items() as $item ) : ?>
				<?php if ( empty( $item['enabled'] ) || ! current_user_can( $item['capability'] ) ) { continue; } ?>
				<a class="<?php echo $active === $item['slug'] ? 'is-active' : ''; ?>" href="<?php echo esc_url( admin_url( 'admin.php?page=' . $item['slug'] ) ); ?>" <?php echo $active === $item['slug'] ? 'aria-current="page"' : ''; ?>>
					<?php echo esc_html( $item['label'] ); ?>
				</a>
			<?php endforeach; ?>
		</nav>
		<?php
	}

	/**
	 * Whether a hook belongs to one of the plugin's screens.
	 *
	 * @param string $hook Current admin page hook.
	 * @return bool
	 */
	private static function is_plugin_screen( $hook = '' ) {
		$page = self::current_page_slug();
		if ( in_array( $page, self::plugin_page_slugs(), true ) ) {
			return true;
		}

		// Fallback for environments that alter or omit the `page` query arg.
		return '' !== $hook && (
			'toplevel_page_' . self::MENU_SLUG === $hook ||
			false !== strpos( $hook, '_page_bahoosh-analytics-' )
		);
	}

	/**
	 * All wp-admin page slugs that belong to Bahoosh.
	 *
	 * @return string[]
	 */
	private static function plugin_page_slugs() {
		return array(
			self::MENU_SLUG,
			self::SETTINGS_SLUG,
			self::DIAGNOSTICS_SLUG,
			self::INSPECTOR_SLUG,
			self::EXPLORER_SLUG,
			self::FUNNELS_SLUG,
			self::AI_SLUG,
		);
	}

	/**
	 * Resolves the active Bahoosh page from the request instead of relying on
	 * WordPress' hook suffix. Some admin-menu configurations generate a
	 * different hook suffix for submenu pages; using the page slug prevents
	 * child screens from losing the shared stylesheet and reverting to the
	 * native light wp-admin UI.
	 *
	 * @return string
	 */
	private static function current_page_slug() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only admin routing.
		return isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
	}

	/**
	 * Adds a stable body class to every Bahoosh admin screen so WordPress-level
	 * notices that are rendered outside `.bap-wrap` can use the same dark
	 * design language as the dashboard.
	 *
	 * @param string $classes Existing admin body classes.
	 * @return string
	 */
	public static function admin_body_class( $classes ) {
		if ( self::is_plugin_screen() ) {
			$classes .= ' bap-admin-page';
		}
		return $classes;
	}

	/**
	 * Enqueues admin assets.
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public static function enqueue( $hook ) {
		if ( ! self::is_plugin_screen( $hook ) ) {
			return;
		}

		$page      = self::current_page_slug();
		$css_file  = BAP_PLUGIN_DIR . 'assets/admin/admin.css';
		$css_ver   = BAP_VERSION . '.' . ( is_readable( $css_file ) ? (int) filemtime( $css_file ) : time() );

		wp_enqueue_style(
			'bahoosh-admin',
			BAP_PLUGIN_URL . 'assets/admin/admin.css',
			array(),
			$css_ver
		);

		wp_enqueue_script(
			'bahoosh-jalali-datepicker',
			BAP_PLUGIN_URL . 'assets/admin/jalali-datepicker.js',
			array(),
			BAP_VERSION,
			true
		);


		$accent = sanitize_hex_color( BAP_Settings::get( 'admin_accent', '#7c5cff' ) );
		if ( ! $accent ) {
			$accent = '#7c5cff';
		}
		$density = 'compact' === BAP_Settings::get( 'admin_density' ) ? 'compact' : 'comfortable';
		wp_add_inline_style( 'bahoosh-admin', '.bap-wrap{--bap-accent:' . $accent . ';--bap-density:' . ( 'compact' === $density ? '0.82' : '1' ) . ';}' );

		if ( self::EXPLORER_SLUG === $page ) {
			self::enqueue_explorer();
			return;
		}

		$studio_pages = array( self::FUNNELS_SLUG, self::AI_SLUG );
		if ( in_array( $page, $studio_pages, true ) ) {
			self::enqueue_studio();
			return;
		}

		if ( self::SETTINGS_SLUG === $page ) {
			wp_enqueue_script(
				'bahoosh-settings',
				BAP_PLUGIN_URL . 'assets/admin/settings.js',
				array(),
				BAP_VERSION,
				true
			);
			wp_localize_script(
				'bahoosh-settings',
				'bapSettingsPage',
				array(
					'testUrl' => rest_url( BAP_REST_Controller::NAMESPACE_V2 . '/ai/provider/test' ),
					'nonce'   => wp_create_nonce( 'wp_rest' ),
					'i18n'    => array(
						'test'     => __( 'تست اتصال مدل', 'bahoosh-analytics-pro' ),
						'testing'  => __( 'در حال بررسی…', 'bahoosh-analytics-pro' ),
						'ok'       => __( 'اتصال برقرار است.', 'bahoosh-analytics-pro' ),
						'failed'   => __( 'اتصال برقرار نشد.', 'bahoosh-analytics-pro' ),
						'models'   => __( 'مدل‌های موجود روی این سرویس:', 'bahoosh-analytics-pro' ),
						'unsaved'  => __( 'ابتدا تنظیمات را ذخیره کنید، سپس تست بگیرید.', 'bahoosh-analytics-pro' ),
					),
				)
			);
			return;
		}

		if ( self::INSPECTOR_SLUG === $page ) {
			self::enqueue_queue_inspector();
			return;
		}

		if ( self::MENU_SLUG !== $page && 'toplevel_page_' . self::MENU_SLUG !== $hook ) {
			return;
		}

		wp_enqueue_script(
			'bahoosh-admin',
			BAP_PLUGIN_URL . 'assets/admin/admin.js',
			array(),
			BAP_VERSION,
			true
		);

		// The dashboard talks to WordPress, which holds the collector key. The
		// key itself is never exposed here — v1 shipped it to the browser.
		wp_add_inline_script(
			'bahoosh-admin',
			'window.BAP_ADMIN = ' . wp_json_encode(
				array(
					'restUrl'      => rest_url( BAP_REST_Controller::NAMESPACE_V2 . '/dashboard' ),
					'statusUrl'    => rest_url( BAP_REST_Controller::NAMESPACE_V2 . '/status' ),
					'layoutUrl'    => rest_url( BAP_REST_Controller::NAMESPACE_V2 . '/workspace/dashboard' ),
					'nonce'        => wp_create_nonce( 'wp_rest' ),
					'ranges'       => BAP_Reports::ranges(),
					'defaultRange' => 'last_7_days',
					'refreshMs'    => 30000,
					'i18n'         => array(
						'loading'       => __( 'در حال بارگذاری…', 'bahoosh-analytics-pro' ),
						'error'         => __( 'داده‌های تحلیلی بارگذاری نشد.', 'bahoosh-analytics-pro' ),
						'noData'        => __( 'برای این بازه داده‌ای وجود ندارد.', 'bahoosh-analytics-pro' ),
						'notConfigured' => __( 'آدرس کالکتور، شناسه سایت و کلید API را در تنظیمات وارد کنید.', 'bahoosh-analytics-pro' ),
						'localSource'   => __( 'این اعداد از داده‌های خود همین سایت محاسبه شده‌اند؛ کالکتور بیرونی تنظیم نشده است.', 'bahoosh-analytics-pro' ),
						'localFallback' => __( 'کالکتور پاسخ نداد، بنابراین اعداد از داده‌های محلی همین سایت محاسبه شد.', 'bahoosh-analytics-pro' ),
						'collectingSince' => __( 'جمع‌آوری داده از %s آغاز شده است.', 'bahoosh-analytics-pro' ),
						'noLocalData'   => __( 'هنوز رویدادی ثبت نشده است. یک صفحه از سایت را در مرورگر باز کنید و چند ثانیه بعد این صفحه را به‌روزرسانی کنید.', 'bahoosh-analytics-pro' ),
						'noTimeseries'  => __( 'کالکتور برای این بازه داده روزانه برنگردانده، بنابراین نمودار روند قابل ترسیم نیست. پاسخ API داشبورد باید آرایه `timeseries` داشته باشد.', 'bahoosh-analytics-pro' ),
						'chartLabel'    => __( 'رویدادها، کاربران، نشست‌ها و بازدیدهای روزانه', 'bahoosh-analytics-pro' ),
						'viewData'      => __( 'نمایش به‌صورت جدول', 'bahoosh-analytics-pro' ),
						'date'          => __( 'تاریخ', 'bahoosh-analytics-pro' ),
						'events'        => __( 'رویدادها', 'bahoosh-analytics-pro' ),
						'users'         => __( 'کاربران', 'bahoosh-analytics-pro' ),
						'sessions'      => __( 'نشست‌ها', 'bahoosh-analytics-pro' ),
						'pageViews'     => __( 'بازدید صفحات', 'bahoosh-analytics-pro' ),
						'vsPrevious'    => __( 'نسبت به دوره قبل', 'bahoosh-analytics-pro' ),
						'up'            => __( 'افزایش', 'bahoosh-analytics-pro' ),
						'down'          => __( 'کاهش', 'bahoosh-analytics-pro' ),
						'flat'          => __( 'بدون تغییر', 'bahoosh-analytics-pro' ),
						'layoutSaved'   => __( 'چیدمان داشبورد ذخیره شد.', 'bahoosh-analytics-pro' ),
					),
				)
			) . ';',
			'before'
		);
	}

	/**
	 * Loads the advanced analytics workspace.
	 *
	 * @return void
	 */
	/**
	 * Assets for the events-and-pages explorer.
	 *
	 * @return void
	 */
	private static function enqueue_explorer() {
		wp_enqueue_script(
			'bahoosh-explorer',
			BAP_PLUGIN_URL . 'assets/admin/explorer.js',
			array(),
			BAP_VERSION,
			true
		);

		wp_localize_script(
			'bahoosh-explorer',
			'BAP_EXPLORER',
			array(
				'restUrl' => rest_url( BAP_REST_Controller::NAMESPACE_V2 . '/explore' ),
				'nonce'   => wp_create_nonce( 'wp_rest' ),
				'i18n'    => array(
					'loading'    => __( 'در حال بارگذاری…', 'bahoosh-analytics-pro' ),
					'error'      => __( 'داده‌ها بارگذاری نشد.', 'bahoosh-analytics-pro' ),
					'empty'      => __( 'در این بازه رویدادی ثبت نشده است.', 'bahoosh-analytics-pro' ),
					'noEvents'   => __( 'هنوز هیچ رویدادی ثبت نشده. یک صفحه از سایت را در مرورگری که وارد پیشخوان نشده باز کنید و چند ثانیه بعد این صفحه را تازه کنید.', 'bahoosh-analytics-pro' ),
					'views'      => __( 'بازدید', 'bahoosh-analytics-pro' ),
					'events'     => __( 'رویداد', 'bahoosh-analytics-pro' ),
					'visitors'   => __( 'کاربر', 'bahoosh-analytics-pro' ),
					'revenue'    => __( 'درآمد', 'bahoosh-analytics-pro' ),
					'lastSeen'   => __( 'آخرین بار', 'bahoosh-analytics-pro' ),
					'searchTerm' => __( 'عبارت جست‌وجو', 'bahoosh-analytics-pro' ),
					'times'      => __( 'بار', 'bahoosh-analytics-pro' ),
					'truncated'  => __( 'تعداد رویدادها از سقف خواندن بیشتر است؛ بازه کوتاه‌تری انتخاب کنید.', 'bahoosh-analytics-pro' ),
					'since'      => __( 'جمع‌آوری از %s', 'bahoosh-analytics-pro' ),
					'stored'     => __( '%s رویداد ذخیره‌شده', 'bahoosh-analytics-pro' ),
				),
			)
		);
	}

	private static function enqueue_studio() {
		wp_enqueue_script(
			'bahoosh-studio',
			BAP_PLUGIN_URL . 'assets/admin/studio.js',
			array(),
			BAP_VERSION,
			true
		);

		wp_add_inline_script(
			'bahoosh-studio',
			'window.BAP_STUDIO = ' . wp_json_encode(
				array(
					'restBase'   => untrailingslashit( rest_url( BAP_REST_Controller::NAMESPACE_V2 ) ),
					'nonce'      => wp_create_nonce( 'wp_rest' ),
					'eventTypes' => BAP_Event_Validator::allowed_types(),
					'i18n'       => array(
						'loading'           => __( 'در حال بارگذاری…', 'bahoosh-analytics-pro' ),
						'ready'             => __( 'آماده', 'bahoosh-analytics-pro' ),
						'error'             => __( 'این نمای تحلیلی بارگذاری نشد.', 'bahoosh-analytics-pro' ),
						'backendUpgrade'    => __( 'ماژول وردپرس آماده است، اما بک‌اند ASP.NET هنوز این گزارش نسخه ۴ را ارائه نمی‌دهد.', 'bahoosh-analytics-pro' ),
						'noHeatmap'         => __( 'برای این فیلتر نقطه کلیک نرمال‌شده‌ای دریافت نشد.', 'bahoosh-analytics-pro' ),
						'noIssues'          => __( 'در این بازه مشکل تجربه کاربری گزارش نشده است.', 'bahoosh-analytics-pro' ),
						'noFunnels'         => __( 'هنوز قیفی ساخته نشده؛ اولین قیف را ایجاد کنید.', 'bahoosh-analytics-pro' ),
						'noReport'          => __( 'برای این بازه گزارش قیف دریافت نشد.', 'bahoosh-analytics-pro' ),
						'noJourneys'        => __( 'برای این فیلتر مسیر سفری دریافت نشد.', 'bahoosh-analytics-pro' ),
						'noRecommendations' => __( 'هنوز پیشنهادی از هوش مصنوعی دریافت نشده است.', 'bahoosh-analytics-pro' ),
						'saving'            => __( 'در حال ذخیره…', 'bahoosh-analytics-pro' ),
						'saved'             => __( 'ذخیره شد', 'bahoosh-analytics-pro' ),
						'delete'            => __( 'حذف', 'bahoosh-analytics-pro' ),
						'aiDisabled'        => __( 'هوش مصنوعی در تنظیمات غیرفعال است.', 'bahoosh-analytics-pro' ),
						'aiRunning'         => __( 'در حال درخواست تحلیل هوش مصنوعی…', 'bahoosh-analytics-pro' ),
						'aiQueued'          => __( 'درخواست تحلیل ثبت شد؛ پیشنهادها از بک‌اند همگام می‌شوند.', 'bahoosh-analytics-pro' ),
						'approve'           => __( 'تأیید و اجرا', 'bahoosh-analytics-pro' ),
						'reject'            => __( 'رد', 'bahoosh-analytics-pro' ),
						'applying'          => __( 'در حال اعمال تصمیم…', 'bahoosh-analytics-pro' ),
					),
				)
			) . ';',
			'before'
		);
	}

	/**
	 * Loads the browser queue inspector.
	 *
	 * The tracker bundle is loaded with `manual_boot`, so it exposes its
	 * modules without starting collection inside wp-admin. The inspector then
	 * uses the production queue code to read the real IndexedDB store rather
	 * than reimplementing it.
	 *
	 * @return void
	 */
	private static function enqueue_queue_inspector() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only navigation.
		$tab = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'events';
		if ( 'queue' !== $tab ) {
			return;
		}

		$bundle = BAP_PLUGIN_DIR . 'assets/js/dist/bahoosh-tracker.js';
		if ( ! is_readable( $bundle ) ) {
			return;
		}

		wp_enqueue_script(
			'bahoosh-tracker',
			BAP_PLUGIN_URL . 'assets/js/dist/bahoosh-tracker.js',
			array(),
			BAP_VERSION . '.' . (int) filemtime( $bundle ),
			true
		);

		// Prevents the bundle from booting a tracker on an admin screen.
		wp_add_inline_script( 'bahoosh-tracker', 'window.BAP_CONFIG = { manual_boot: true };', 'before' );

		wp_enqueue_script(
			'bahoosh-queue-inspector',
			BAP_PLUGIN_URL . 'assets/admin/queue-inspector.js',
			array( 'bahoosh-tracker' ),
			BAP_VERSION,
			true
		);

		wp_add_inline_script(
			'bahoosh-queue-inspector',
			'window.BAP_QUEUE_INSPECTOR = ' . wp_json_encode(
				array(
					'endpoint' => rest_url( BAP_REST_Controller::NAMESPACE_V2 . '/events' ),
					'siteId'   => BAP_Settings::get( 'site_id' ),
					'nonce'    => wp_create_nonce( 'wp_rest' ),
					'i18n'     => array(
						'states'               => array(
							'pending' => __( 'در انتظار', 'bahoosh-analytics-pro' ),
							'sending' => __( 'در حال ارسال', 'bahoosh-analytics-pro' ),
							'failed'  => __( 'ناموفق', 'bahoosh-analytics-pro' ),
						),
						'never'                => __( 'هرگز', 'bahoosh-analytics-pro' ),
						'online'               => __( 'آنلاین', 'bahoosh-analytics-pro' ),
						'offline'              => __( 'آفلاین', 'bahoosh-analytics-pro' ),
						'granted'              => __( 'مجاز', 'bahoosh-analytics-pro' ),
						'denied'               => __( 'ردشده', 'bahoosh-analytics-pro' ),
						'analytics'            => __( 'تحلیل داده', 'bahoosh-analytics-pro' ),
						'noConsentCookie'      => __( 'هیچ رضایتی در این مرورگر ثبت نشده است', 'bahoosh-analytics-pro' ),
						'noStorage'            => __( 'فضای ذخیره مرورگر در دسترس نیست', 'bahoosh-analytics-pro' ),
						'nothingQueued'        => __( 'صف خالی است.', 'bahoosh-analytics-pro' ),
						'trackerMissing'       => __( 'باندل Tracker بارگذاری نشد. آن را با npm run build دوباره بسازید.', 'bahoosh-analytics-pro' ),
						'error'                => __( 'خطایی رخ داد.', 'bahoosh-analytics-pro' ),
						'working'              => __( 'در حال انجام…', 'bahoosh-analytics-pro' ),
						'refreshed'            => __( 'به‌روزرسانی شد.', 'bahoosh-analytics-pro' ),
						'flushed'              => __( 'ارسال صف کامل شد.', 'bahoosh-analytics-pro' ),
						'flushSkipped'         => __( 'چیزی برای ارسال وجود ندارد', 'bahoosh-analytics-pro' ),
						/* translators: %d: number of events returned to the queue. */
						'requeued'             => __( '%d رویداد به صف بازگردانده شد.', 'bahoosh-analytics-pro' ),
						/* translators: %d: number of failed events removed. */
						'cleared'              => __( '%d رویداد ناموفق حذف شد.', 'bahoosh-analytics-pro' ),
						'clearedAll'           => __( 'تمام داده‌های تحلیلی محلی پاک شد.', 'bahoosh-analytics-pro' ),
						'confirmClearFailed'   => __( 'همه رویدادهای ناموفق این مرورگر حذف شوند؟ این موارد قابل بازیابی نیستند.', 'bahoosh-analytics-pro' ),
						'confirmClearAll'      => __( 'این کار همه رویدادهای صف این مرورگر، حتی موارد در انتظار ارسال را پاک می‌کند. ادامه می‌دهید؟', 'bahoosh-analytics-pro' ),
						'confirmClearAllAgain' => __( 'مطمئن هستید؟ رویدادهای در انتظار از بین می‌روند و قابل بازیابی نیستند.', 'bahoosh-analytics-pro' ),
					),
				)
			) . ';',
			'before'
		);
	}

	/**
	 * Warns only when the plugin genuinely cannot collect anything.
	 *
	 * This used to fire whenever no collector URL was set, and it said the
	 * plugin was collecting nothing — which was true then and is not now. The
	 * plugin measures the site by itself; a collector is an addition, not a
	 * requirement, and telling an administrator their working installation is
	 * broken sends them to fix something that is not wrong.
	 *
	 * @return void
	 */
	public static function configuration_notice() {
		if ( ! current_user_can( self::settings_capability() ) || BAP_Settings::tracking_enabled() ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( $screen && false === strpos( (string) $screen->id, self::MENU_SLUG ) ) {
			return;
		}

		printf(
			'<div class="notice notice-warning"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'رهگیری باهوش خاموش است، بنابراین داده‌ای جمع‌آوری نمی‌شود.', 'bahoosh-analytics-pro' ),
			esc_url( admin_url( 'admin.php?page=' . self::SETTINGS_SLUG ) ),
			esc_html__( 'باز کردن تنظیمات', 'bahoosh-analytics-pro' )
		);
	}

	/**
	 * Adds a settings shortcut to the plugins list.
	 *
	 * @param string[] $links Existing links.
	 * @return string[]
	 */
	public static function action_links( $links ) {
		$settings = sprintf(
			'<a href="%s">%s</a>',
			esc_url( admin_url( 'admin.php?page=' . self::SETTINGS_SLUG ) ),
			esc_html__( 'تنظیمات', 'bahoosh-analytics-pro' )
		);
		array_unshift( $links, $settings );
		return $links;
	}
}
