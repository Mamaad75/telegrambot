<?php
/**
 * Admin UI controller.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers the admin menu, renders every admin screen, enqueues admin
 * assets and handles all AJAX / form actions (connection test, sample
 * payload, manual dispatch, queue processing, log management, export).
 *
 * @since 1.0.0
 */
class Admin {

	/**
	 * Capability required for every plugin screen and action.
	 *
	 * @var string
	 */
	public const CAPABILITY = 'manage_options';

	/**
	 * Top level menu slug.
	 *
	 * @var string
	 */
	public const MENU_SLUG = 'wp-event-publisher';

	/**
	 * Hook suffixes of every registered Jarchi screen, keyed by page slug.
	 *
	 * @since 1.17.7
	 * @var array<string,string>
	 */
	private static array $screens = array();

	/**
	 * Nonce action for AJAX requests.
	 *
	 * @var string
	 */
	public const NONCE_AJAX = 'wpep_ajax';

	/**
	 * Screen slug of the announcement page picker.
	 *
	 * Named rather than concatenated at each call site, so the registration
	 * and every link to it cannot drift apart — which is how a screen ends up
	 * registered at one route and linked at another.
	 *
	 * @since 1.7.3
	 * @var string
	 */
	public const PAGE_ANNOUNCEMENT_PAGE = 'wp-event-publisher-announcement-page';

	/**
	 * Nonce action for log management form actions.
	 *
	 * @var string
	 */
	public const NONCE_LOGS = 'wpep_logs_action';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Logger dependency.
	 *
	 * @var Logger
	 */
	private Logger $logger;

	/**
	 * Webhook client dependency.
	 *
	 * @var Webhook
	 */
	private Webhook $webhook;

	/**
	 * Normalizer dependency.
	 *
	 * @var Normalizer
	 */
	private Normalizer $normalizer;

	/**
	 * Contract builder.
	 *
	 * @var Contract
	 */
	private Contract $contract;

	/**
	 * Event identifier service.
	 *
	 * @var EventId
	 */
	private EventId $event_id;

	/**
	 * Signature service.
	 *
	 * @var Signer
	 */
	private Signer $signer;

	/**
	 * Dispatcher dependency.
	 *
	 * @var Dispatcher
	 */
	private Dispatcher $dispatcher;

	/**
	 * Event detector dependency.
	 *
	 * @var EventDetector
	 */
	private EventDetector $detector;

	/**
	 * Validator dependency.
	 *
	 * @var Validator
	 */
	private Validator $validator;

	/**
	 * Diagnostics service.
	 *
	 * @var Diagnostics
	 */
	private Diagnostics $diagnostics;

	/**
	 * Constructor.
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Added the contract, event identifier and signer dependencies.
	 * @since 1.2.0 Added the dispatcher, detector and validator dependencies.
	 *
	 * @param Settings      $settings   Settings service.
	 * @param Logger        $logger     Logger service.
	 * @param Webhook       $webhook    Webhook client.
	 * @param Normalizer    $normalizer Normalizer service.
	 * @param Contract      $contract   Contract builder.
	 * @param EventId       $event_id   Event identifier service.
	 * @param Signer        $signer     Signature service.
	 * @param Dispatcher    $dispatcher Delivery dispatcher.
	 * @param EventDetector $detector   Event detector.
	 * @param Validator     $validator  Validator service.
	 * @param Diagnostics   $diagnostics Diagnostics service.
	 */
	public function __construct(
		Settings $settings,
		Logger $logger,
		Webhook $webhook,
		Normalizer $normalizer,
		Contract $contract,
		EventId $event_id,
		Signer $signer,
		Dispatcher $dispatcher,
		EventDetector $detector,
		Validator $validator,
		Diagnostics $diagnostics
	) {
		$this->settings   = $settings;
		$this->logger     = $logger;
		$this->webhook    = $webhook;
		$this->normalizer = $normalizer;
		$this->contract   = $contract;
		$this->event_id   = $event_id;
		$this->signer     = $signer;
		$this->dispatcher = $dispatcher;
		$this->detector   = $detector;
		$this->validator   = $validator;
		$this->diagnostics = $diagnostics;
	}

	/**
	 * Registers all admin hooks.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( 'admin_menu', array( $this, 'register_menu' ), 99 );

		// A bookmark or an old link still pointing at one of the per-screen
		// slugs this build no longer registers would otherwise land on
		// "Sorry, you are not allowed to access this page." This is the hook
		// WordPress fires immediately before saying that, so the stale link is
		// forwarded to the screen it means instead of dead-ending.
		add_action( 'admin_page_access_denied', array( $this, 'rescue_legacy_route' ) );
		add_filter( 'parent_file', array( $this, 'native_parent_file' ) );
		add_filter( 'submenu_file', array( $this, 'native_submenu_file' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'admin_notices', array( $this, 'maybe_show_configuration_notice' ) );
		add_filter( 'admin_body_class', array( $this, 'filter_admin_body_class' ) );
		add_action( 'admin_head', array( $this, 'brand_post_type_icons' ) );

		// AJAX endpoints (admin only, nonce protected).
		add_action( 'wp_ajax_wpep_test_connection', array( $this, 'ajax_test_connection' ) );
		add_action( 'wp_ajax_wpep_send_sample', array( $this, 'ajax_send_sample' ) );
		add_action( 'wp_ajax_wpep_validate_config', array( $this, 'ajax_validate_config' ) );
		add_action( 'wp_ajax_wpep_dispatch_post', array( $this, 'ajax_dispatch_post' ) );
		add_action( 'wp_ajax_wpep_run_queue', array( $this, 'ajax_run_queue' ) );
		add_action( 'wp_ajax_wpep_run_diagnostics', array( $this, 'ajax_run_diagnostics' ) );

		// Form actions via admin-post.php.
		add_action( 'admin_post_wpep_logs_action', array( $this, 'handle_logs_action' ) );
		add_action( 'admin_post_wpep_export_logs', array( $this, 'handle_export_logs' ) );

		add_filter( 'plugin_action_links_' . WPEP_PLUGIN_BASENAME, array( $this, 'plugin_action_links' ) );
	}

	/**
	 * Registers the top level menu and all submenus.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function register_menu(): void {
		/*
		 * IMPORTANT ARCHITECTURE:
		 *
		 * WordPress is used as a single stable entry point for the Jarchi app.
		 * Every internal screen is rendered through the already-registered
		 * top-level page (MENU_SLUG) with a jarchi_view query argument.
		 *
		 * We deliberately do NOT register the detailed Jarchi screens as
		 * add_submenu_page() entries. WordPress' admin_page authorization logic
		 * reconstructs a plugin screen's parent from $submenu; hiding/removing
		 * those registrations has historically caused the recurring
		 * "Sorry, you are not allowed to access this page" failure.
		 *
		 * The native WordPress menu therefore contains only:
		 *   - Jarchi (home)
		 *   - ارتباط با کاربران (same Jarchi page, routed with jarchi_view=support)
		 *
		 * All detailed navigation lives in the Jarchi application sidebar.
		 */
		$menu_icon = $this->get_menu_icon_data_uri();

		add_menu_page(
			__( 'جارچی', 'wp-event-publisher' ),
			__( 'جارچی', 'wp-event-publisher' ),
			self::CAPABILITY,
			self::MENU_SLUG,
			array( $this, 'render_dashboard' ),
			$menu_icon,
			25
		);

		/*
		 * Exactly two native entries, both really registered.
		 *
		 * The previous build appended the second entry straight into
		 * $submenu[ MENU_SLUG ] — but add_menu_page() does not create that
		 * array, and nothing else called add_submenu_page(), so the `isset()`
		 * guard was always false and the entry was silently never added. That
		 * is why only "جارچی" appeared in the WordPress menu.
		 *
		 * Registering both through add_submenu_page() creates the array, gives
		 * the first entry a proper label instead of repeating the parent's,
		 * and — because both slugs are genuinely registered and nothing is
		 * removed from $submenu afterwards — WordPress can resolve each one's
		 * parent and authorize it. Every other screen lives inside the app
		 * sidebar, reached through the jarchi_view selector on these two
		 * pages.
		 */
		add_submenu_page(
			self::MENU_SLUG,
			__( 'جارچی', 'wp-event-publisher' ),
			__( 'جارچی', 'wp-event-publisher' ),
			self::CAPABILITY,
			self::MENU_SLUG,
			array( $this, 'render_dashboard' )
		);

		add_submenu_page(
			self::MENU_SLUG,
			__( 'ارتباط با کاربران', 'wp-event-publisher' ),
			__( 'ارتباط با کاربران', 'wp-event-publisher' ),
			self::CAPABILITY,
			Tickets::PAGE,
			array( $this, 'render_support' )
		);
	}

	/**
	 * Renders the support section.
	 *
	 * The second native entry is a real registered page rather than a link
	 * painted into $submenu, so a bookmark to it authorizes like any other
	 * WordPress admin page. It routes on the same jarchi_view selector the
	 * rest of the app uses, and defaults to the ticket list.
	 *
	 * @since 1.18.4
	 *
	 * @return void
	 */
	public function render_support(): void {
		$this->guard();

		$view = self::current_view();

		if ( '' !== $view && 'support' !== $view ) {
			$this->render_application_view( $view );

			return;
		}

		wpep()->tickets()->render_admin();
	}

	/**
	 * Forwards a legacy Jarchi page slug to its in-app view.
	 *
	 * Runs on `admin_page_access_denied`, which WordPress fires just before
	 * it refuses a page. Only slugs belonging to this plugin are touched, and
	 * only for a user who already holds the plugin capability — someone
	 * genuinely lacking permission still gets refused, exactly as before.
	 *
	 * @since 1.18.4
	 *
	 * @return void
	 */
	public function rescue_legacy_route(): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing.
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( (string) $_GET['page'] ) ) : '';

		if ( '' === $page || ! str_starts_with( $page, self::MENU_SLUG ) ) {
			return;
		}

		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}

		$view = AdminShell::view_from_legacy_page( $page );

		// An unmapped slug would become an unknown view; send it home rather
		// than to a view that does not exist.
		if ( $view === $page ) {
			$view = '';
		}

		$args = array();

		foreach ( array( 'ticket', 'announcement', 'status', 'department', 'category', 'paged', 's' ) as $key ) {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing.
			if ( isset( $_GET[ $key ] ) ) {
				$args[ $key ] = sanitize_text_field( wp_unslash( (string) $_GET[ $key ] ) );
			}
		}

		wp_safe_redirect( self::app_url( $view, $args ) );
		exit;
	}

	/**
	 * Canonical in-app URL. Every Jarchi screen uses the same registered
	 * WordPress page and only changes the local view selector.
	 */
	public static function app_url( string $view = '', array $args = array() ): string {
		$query = array( 'page' => self::MENU_SLUG );
		if ( '' !== $view ) {
			$query['jarchi_view'] = $view;
		}
		foreach ( $args as $key => $value ) {
			$query[ sanitize_key( (string) $key ) ] = $value;
		}
		return add_query_arg( $query, admin_url( 'admin.php' ) );
	}

	/**
	 * Returns the current in-app view selector.
	 */
	public static function current_view(): string {
		return isset( $_GET['jarchi_view'] ) ? sanitize_key( wp_unslash( (string) $_GET['jarchi_view'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	}

	/**
	 * Registers one Jarchi admin screen.
	 *
	 * The single canonical way this plugin creates an admin page, so a screen
	 * cannot be registered two different ways in two different files.
	 *
	 * WHY THE PARENT MATTERS
	 * ----------------------
	 * WordPress authorizes a plugin page in `user_can_access_admin_page()`:
	 *
	 *     $parent   = get_admin_page_parent();          // scans $menu/$submenu
	 *     $hookname = get_plugin_page_hookname( $page, $parent );
	 *     if ( ! isset( $_registered_pages[ $hookname ] ) ) return false;
	 *
	 * `add_submenu_page()` computes that hook name from the parent it is
	 * GIVEN, while the check above recomputes it from the parent it can FIND.
	 * The two agree only while the page is still listed in `$submenu`. Earlier
	 * releases registered every screen under the Jarchi menu and then stripped
	 * `$submenu` to keep the native menu short — which left the parent
	 * unresolvable, so the recomputed hook name (`admin_page_…`) no longer
	 * matched the registered one (`<parent>_page_…`) and WordPress answered
	 * with "Sorry, you are not allowed to access this page."
	 *
	 * An empty parent avoids the whole problem: both sides compute
	 * `admin_page_<slug>`, the page stays out of the native menu because no
	 * menu item claims that parent, and nothing has to be deleted afterwards.
	 *
	 * @since 1.17.7
	 *
	 * @param string   $slug     Page slug.
	 * @param string   $title    Page and menu title.
	 * @param callable $callback Render callback.
	 * @param bool     $visible  Whether the screen appears in the native menu.
	 *
	 * @return string Hook suffix, or an empty string when the capability is missing.
	 */
	public static function register_screen( string $slug, string $title, $callback, string $parent = self::MENU_SLUG ): string {
		// Legacy compatibility only. Detailed screens are no longer registered
		// as WordPress submenu/plugin pages; all navigation goes through the
		// canonical top-level Jarchi page and jarchi_view.
		return '';
	}

	/**
	 * Renders one screen, turning an unexpected failure into a readable notice.
	 *
	 * WordPress's own answer to an uncaught error is the "There has been a
	 * critical error on this website" page, which says nothing about what
	 * broke and replaces the whole screen. That is not more honest than a
	 * notice — it is less, because the administrator cannot even tell which
	 * part failed.
	 *
	 * The error is re-reported here in full, and written to the log, so it is
	 * strictly more visible than before. Nothing is swallowed: the message,
	 * file and line are printed, and only to a user who already holds the
	 * plugin's capability.
	 *
	 * @since 1.17.7
	 *
	 * @param callable $callback Screen renderer.
	 * @param string   $slug     Page slug.
	 * @param string   $title    Page title.
	 *
	 * @return void
	 */
	private static function render_guarded( $callback, string $slug, string $title ): void {
		if ( ! is_callable( $callback ) ) {
			return;
		}

		try {
			$callback();
		} catch ( \Throwable $e ) {
			if ( class_exists( Logger::class ) ) {
				try {
					wpep()->logger()->event(
						'admin-screen',
						Logger::STATUS_FAILED,
						sprintf( '%s: %s', $slug, $e->getMessage() ),
						array( 'file' => $e->getFile(), 'line' => $e->getLine() )
					);
				} catch ( \Throwable $ignored ) {
					unset( $ignored );
				}
			}

			printf(
				'<div class="wrap"><h1>%s</h1><div class="notice notice-error"><p><strong>%s</strong></p><p><code>%s</code></p><p>%s</p></div></div>',
				esc_html( $title ),
				esc_html__( 'این صفحه به‌درستی بارگذاری نشد.', 'wp-event-publisher' ),
				esc_html( $e->getMessage() ),
				esc_html( sprintf( '%s:%d', $e->getFile(), $e->getLine() ) )
			);
		}
	}

	/**
	 * Every Jarchi screen and the hook suffix WordPress gave it.
	 *
	 * Asset loading and screen detection read this rather than guessing at a
	 * hook name, which is what makes a hidden page detectable at all.
	 *
	 * @since 1.17.7
	 *
	 * @return array<string,string> Hook suffix keyed by page slug.
	 */
	public static function screens(): array {
		return self::$screens;
	}


	/** Hide detailed Jarchi screens visually from the native WordPress submenu while
	 * keeping their submenu registrations intact so WordPress can resolve access. */
	public function hide_native_jarchi_detail_submenus(): void { /* native menu now has only the two intended items */ }

	/**
	 * Removes WordPress submenus from the two Jarchi top-level entries.
	 *
	 * Jarchi uses its own in-app sidebar after entering either section.
	 * Keeping the native WordPress menu to two top-level entries makes the
	 * plugin feel like one coherent product rather than two competing navs.
	 *
	 * @since 1.7.7
	 *
	 * @return void
	 */
	public function clean_native_submenus(): void {
		// Deliberately does nothing.
		//
		// This used to strip $submenu so the native menu stayed short. That is
		// what broke every hidden screen: WordPress resolves a plugin page's
		// parent by scanning $submenu, and a page it cannot find a parent for
		// gets a different hook name than the one it was registered under —
		// which WordPress reports as "Sorry, you are not allowed to access this
		// page." Hidden screens now register with an empty parent instead, so
		// they never enter the native menu and nothing needs removing.
	}

	/**
	 * Keeps the Jarchi top-level entry active on hidden application screens.
	 *
	 * @since 1.7.7
	 *
	 * @param string $parent Current parent file.
	 * @return string Parent file.
	 */
	public function native_parent_file( $parent ): string {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( (string) $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return self::MENU_SLUG === $page ? self::MENU_SLUG : (string) $parent;
	}


	/**
	 * Keeps the two native Jarchi submenu items coherent. Detailed screens are
	 * no longer native submenu pages at all; they are views inside the top-level
	 * Jarchi application.
	 */
	public function native_submenu_file( $submenu ): string {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( (string) $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( self::MENU_SLUG === $page ) {
			$view = self::current_view();
			return self::MENU_SLUG;
		}
		return (string) $submenu;
	}


	/**
	 * Marks the correct Jarchi section in the native WordPress submenu.
	 *
	 * @since 1.7.8
	 *
	 * @param string $submenu Current submenu file.
	 * @return string Submenu file.
	 */



	/**
	 * Keeps the native WordPress Jarchi submenu intentionally minimal.
	 *
	 * WordPress still keeps every detailed screen registered under the Jarchi
	 * parent so admin.php?page=... authorization remains valid. We hide those
	 * detailed items visually instead of deleting them from $submenu, because
	 * deleting them is what caused the recurring access-denied bug.
	 *
	 * Only these native children stay visible:
	 *  - Jarchi (automatic home item)
	 *  - ارتباط با کاربران (Ticket Center entry)
	 *
	 * @return void
	 */
	public function hide_native_jarchi_children(): void {
		// Intentionally kept as a compatibility hook. Native submenu entries are
		// visually filtered in hide_native_jarchi_detail_submenus() without
		// removing them from WordPress' registry.
	}

	/**
	 * Renders the announcement page picker.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function render_announcement_page(): void {
		$this->guard();

		$announcements = wpep()->announcements();

		$this->render_view(
			'announcement-page',
			array(
				'page'      => $announcements->page(),
				'pages'     => get_posts(
					array(
						'post_type'        => 'page',
						'post_status'      => array( 'publish', 'draft', 'private' ),
						'numberposts'      => 200,
						'orderby'          => 'title',
						'order'            => 'ASC',
						'suppress_filters' => false,
					)
				),
				'elementor' => Announcements::elementor_available(),
			)
		);
	}

	/**
	 * Renders the WooCommerce order settings screen.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function render_woocommerce(): void {
		$this->guard();

		$stored = (array) $this->settings->get( 'order_fields', array() );

		$this->render_view(
			'woocommerce',
			array(
				'settings'  => $this->settings->all(),
				'events'    => WooCommerceOrders::event_types(),
				'fields'    => WooCommerceOrders::field_labels(),
				// An unconfigured shop sees the sensible default selection
				// rather than an empty form it has to fill in from scratch.
				'mapping'   => ! empty( $stored ) ? $stored : WooCommerceOrders::default_fields(),
				'platforms' => array(
					Field::PLATFORM_TELEGRAM => __( 'تلگرام', 'wp-event-publisher' ),
					Field::PLATFORM_BALE     => __( 'بله', 'wp-event-publisher' ),
					Field::PLATFORM_WHATSAPP => __( 'واتس‌اپ', 'wp-event-publisher' ),
				),
				// Which platforms the site has actually configured. Selecting a
				// platform that has no channel cannot switch it on, so the
				// screen says which ones are ready rather than offering a
				// choice that silently does nothing.
				'configured' => array_map(
					static fn( $config ): bool => ! empty( $config['enabled'] ),
					$this->settings->platforms()
				),
				'resolved'   => wpep()->orders()->targets(),
				'currency'   => WooCommerceOrder::currency(),
				'hpos'       => WooCommerceOrder::hpos_enabled(),
			)
		);
	}

	/**
	 * Renders the System Status screen.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function render_system_status(): void {
		$this->guard();

		$status = new SystemStatus( $this->settings, wpep()->field_registry() );

		$this->render_view( 'system-status', array( 'report' => $status->report() ) );
	}

	/**
	 * Renders the Telegram screen.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function render_telegram(): void {
		$this->render_platform( Field::PLATFORM_TELEGRAM, __( 'تلگرام', 'wp-event-publisher' ) );
	}

	/**
	 * Renders the Bale screen.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function render_bale(): void {
		$this->render_platform( Field::PLATFORM_BALE, __( 'بله', 'wp-event-publisher' ) );
	}

	/**
	 * Renders the WhatsApp screen.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function render_whatsapp(): void {
		$this->render_platform( Field::PLATFORM_WHATSAPP, __( 'واتس‌اپ', 'wp-event-publisher' ) );
	}

	/**
	 * Renders one platform settings screen.
	 *
	 * All three share a view; they differ only in how they address a
	 * destination, which the view declares.
	 *
	 * @since 1.6.0
	 *
	 * @param string $platform Platform identifier.
	 * @param string $title    Screen title.
	 *
	 * @return void
	 */
	private function render_platform( string $platform, string $title ): void {
		$this->guard();

		$this->render_view(
			'platform',
			array(
				'platform' => $platform,
				'title'    => $title,
				'config'   => $this->settings->platform( $platform ),
			)
		);
	}

	/**
	 * Enqueues admin CSS/JS on plugin screens only.
	 *
	 * @since 1.0.0
	 *
	 * @param string $hook_suffix Current admin page hook suffix.
	 *
	 * @return void
	 */
	public function enqueue_assets( string $hook_suffix ): void {
		if ( ! str_contains( $hook_suffix, self::MENU_SLUG ) ) {
			return;
		}

		wp_enqueue_style(
			'wpep-admin',
			WPEP_PLUGIN_URL . 'admin/css/admin.css',
			array(),
			WPEP_VERSION . '.' . filemtime( WPEP_PLUGIN_DIR . 'admin/css/admin.css' )
		);

		// The plugin UI can be Persian on an otherwise English admin, so
		// the RTL sheet follows the plugin's own language rather than the
		// site locale.
		if ( $this->settings->is_rtl_ui() ) {
			wp_enqueue_style(
				'wpep-admin-rtl',
				WPEP_PLUGIN_URL . 'admin/css/admin-rtl.css',
				array( 'wpep-admin' ),
				WPEP_VERSION
			);
		}

		wp_enqueue_script(
			'wpep-admin',
			WPEP_PLUGIN_URL . 'admin/js/admin.js',
			array(),
			WPEP_VERSION . '.' . filemtime( WPEP_PLUGIN_DIR . 'admin/js/admin.js' ),
			true
		);

		// Only the nonce and UI strings reach the browser; the API secret
		// never leaves the server.
		wp_localize_script(
			'wpep-admin',
			'wpepAdmin',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( self::NONCE_AJAX ),
				'i18n'    => array(
					'testing'       => __( 'Testing connection…', 'wp-event-publisher' ),
					'sending'       => __( 'Sending sample payload…', 'wp-event-publisher' ),
					'validating'    => __( 'Validating configuration…', 'wp-event-publisher' ),
					'dispatching'   => __( 'Sending advertisement…', 'wp-event-publisher' ),
					'processing'    => __( 'Processing the queue…', 'wp-event-publisher' ),
					'diagnosing'    => __( 'Running diagnostics…', 'wp-event-publisher' ),
					'requestFailed' => __( 'Request failed. Check your network and try again.', 'wp-event-publisher' ),
					'confirmClear'  => __( 'Delete ALL log entries? This cannot be undone.', 'wp-event-publisher' ),
					'confirmDelete' => __( 'Delete this log entry?', 'wp-event-publisher' ),
					'missingPostId' => __( 'Enter the ID of the advertisement you want to send.', 'wp-event-publisher' ),
				),
			)
		);
	}

	/**
	 * Marks plugin screens so the stylesheet can lay them out right to left.
	 *
	 * @since 1.2.1
	 *
	 * @param string $classes Space separated admin body classes.
	 *
	 * @return string Modified classes.
	 */
	public function filter_admin_body_class( string $classes ): string {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

		if ( ! $screen || ! str_contains( (string) $screen->id, self::MENU_SLUG ) ) {
			return $classes;
		}

		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : self::MENU_SLUG;
		$screen_class = $page === self::MENU_SLUG ? ' wpep-dashboard-screen' : ' wpep-inner-screen';

		return $classes . ' wpep-plugin-screen' . $screen_class . ( $this->settings->is_rtl_ui() ? ' wpep-rtl' : ' wpep-ltr' );
	}

	/**
	 * Returns the Jarchi icon as an inline SVG data URI. WordPress admin menu
	 * icons are safest as SVG data URIs because a PNG URL can be rendered as an
	 * unconstrained <img> by another admin screen/plugin. The SVG wrapper forces
	 * the icon to stay within the menu's 20x20 box.
	 *
	 * @return string
	 */
	private function get_menu_icon_data_uri(): string {
		$file = WPEP_PLUGIN_DIR . 'assets/jarchi-post-type-icon.png';
		if ( ! is_readable( $file ) ) {
			return 'dashicons-megaphone';
		}

		$png = base64_encode( (string) file_get_contents( $file ) );
		$svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 64 64"><image href="data:image/png;base64,' . $png . '" x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet"/></svg>';
		return 'data:image/svg+xml;base64,' . base64_encode( $svg );
	}

	/**
	 * Uses the Jarchi icon for the WordPress post-type menu items that Jarchi can publish.
	 *
	 * The plugin does not register those post types itself, so the icon is applied
	 * at admin-menu render time to whatever post types are currently allowed.
	 *
	 * @return void
	 */
	/**
	 * Opens the same two-column, in-flow layout used by the dashboard on every
	 * inner Jarchi screen. This is intentionally rendered before admin notices
	 * so notices also stay inside the main content column rather than underneath
	 * or behind the sidebar.
	 *
	 * @return void
	 */
	public function render_inner_shell_start(): void {
		if ( ! $this->is_inner_jarchi_screen() ) {
			return;
		}

		// Navigation belongs to the application shell, which renders one
		// sidebar on every Jarchi screen — including the announcement editor,
		// which this hook never reached. Rendering a second one here put two
		// sidebars on the same page and left neither of them authoritative,
		// so the inner screens now open only their content column.
		echo '<div class="wrap wpep-wrap wpep-dashboard wpep-inner-page">';
		echo '<main class="wpep-dashboard-main">';
	}

	/**
	 * Closes the in-flow inner-screen shell opened by render_inner_shell_start().
	 *
	 * @return void
	 */
	public function render_inner_shell_end(): void {
		if ( ! $this->is_inner_jarchi_screen() ) {
			return;
		}

		echo '</main></div>';
	}

	/**
	 * Determines whether the current request is an inner Jarchi admin screen.
	 *
	 * @return bool
	 */
	private function is_inner_jarchi_screen(): bool {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return false;
		}

		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || ! str_contains( (string) $screen->id, self::MENU_SLUG ) ) {
			return false;
		}

		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : self::MENU_SLUG;
		return self::MENU_SLUG !== $page;
	}


	public function brand_post_type_icons(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}

		$post_types = array_values( array_filter( array_map( 'sanitize_key', (array) $this->settings->allowed_post_types() ) ) );
		if ( empty( $post_types ) ) {
			return;
		}

		$icon = $this->get_menu_icon_data_uri();
		$rules = array();
		foreach ( $post_types as $post_type ) {
			$menu_id = 'menu-posts-' . $post_type;
			$rules[] = '#' . esc_attr( $menu_id ) . ' .wp-menu-image{width:20px!important;height:20px!important;box-sizing:border-box!important;background-image:url("' . esc_url( $icon ) . '")!important;background-size:18px 18px!important;background-repeat:no-repeat!important;background-position:center!important;background-color:transparent!important;}';
			$rules[] = '#' . esc_attr( $menu_id ) . ' .wp-menu-image:before{display:none!important;}';
			$rules[] = '#' . esc_attr( $menu_id ) . ' .wp-menu-image img{display:none!important;width:0!important;height:0!important;}';
		}

		echo '<style id="wpep-post-type-icon">' . implode( '', $rules ) . '</style>';
	}

	/**
	 * Adds a "Settings" link on the Plugins list screen.
	 *
	 * @since 1.0.0
	 *
	 * @param string[] $links Existing action links.
	 *
	 * @return string[] Modified action links.
	 */
	public function plugin_action_links( array $links ): array {
		$url = self::app_url( 'settings' );

		array_unshift(
			$links,
			'<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'wp-event-publisher' ) . '</a>'
		);

		return $links;
	}

	/**
	 * Shows a notice while the plugin cannot possibly publish an event.
	 *
	 * The three silent killers — the plugin switched off, no post type
	 * selected and no endpoint — are named explicitly, because each of
	 * them lets the connection test succeed while real advertisements go
	 * nowhere.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function maybe_show_configuration_notice(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}

		// Webhook configuration is optional for the local WordPress features
		// (Ticket Center, Announcements, FAQ, Customer Hub, etc.). Never block
		// the admin UI or show a global warning merely because Remote Publishing
		// is not configured. The dedicated Settings screen explains optional
		// remote configuration when the administrator actually needs it.
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( (string) $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$post_type = isset( $_GET['post_type'] ) ? sanitize_key( wp_unslash( (string) $_GET['post_type'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		$is_jarchi_context = (
			$page === self::MENU_SLUG
			|| ( $page !== '' && ( str_starts_with( $page, self::MENU_SLUG ) || str_starts_with( $page, 'wp-event-publisher-ticket-' ) || str_starts_with( $page, 'wp-event-publisher-tickets' ) ) )
			|| $post_type === Announcements::POST_TYPE
		);
		if ( ! $is_jarchi_context ) {
			return;
		}

		// Only the Settings screen should surface an optional configuration
		// reminder; even there it must never prevent local functionality.
		$is_settings = ( $page === self::MENU_SLUG . '-settings' ) || ( self::MENU_SLUG === $page && 'settings' === self::current_view() );
		if ( ! $is_settings ) {
			return;
		}

		$problems = array();
		if ( ! $this->settings->get( 'webhooks_enabled' ) ) {
			$problems[] = __( 'انتقال از راه دور (Webhook) غیرفعال است؛ قابلیت‌های محلی همچنان فعال هستند.', 'wp-event-publisher' );
		}
		if ( '' === $this->settings->endpoint() ) {
			$problems[] = __( 'برای استفاده از قابلیت‌های از راه دور، آدرس Webhook را تنظیم کنید.', 'wp-event-publisher' );
		}
		if ( empty( $problems ) ) {
			return;
		}

		printf(
			'<div class="notice notice-info is-dismissible"><p><strong>%1$s</strong> %2$s <a href="%3$s">%4$s</a></p></div>',
			esc_html__( 'جارچی:', 'wp-event-publisher' ),
			esc_html( implode( ' ', $problems ) ),
			esc_url( self::app_url( 'settings' ) ),
			esc_html__( 'تنظیمات Webhook', 'wp-event-publisher' )
		);
	}

	/* ---------------------------------------------------------------------
	 * Screen renderers.
	 * ------------------------------------------------------------------ */

	/**
	 * Builds the seven-day delivery trend shown on the dashboard.
	 *
	 * Three things this has to get right, and the previous implementation got
	 * none of them:
	 *
	 * - **The query was never prepared.** `get_results()` takes an output
	 *   type as its second argument, not prepare arguments, so the `%s` in
	 *   the SQL was sent to MySQL literally and the timestamp was read as an
	 *   output format. The window silently did nothing.
	 * - **Days were computed in UTC.** On a site at +03:30 that puts the
	 *   boundary three and a half hours off, so deliveries land in the wrong
	 *   column and "today" can be empty until the small hours (spec 17).
	 * - **The week must always show seven days**, including today, with zeros
	 *   for days that saw nothing — not only the days that happen to have
	 *   rows.
	 *
	 * Success and failure are counted independently: a day can have both, and
	 * one is never inferred from the other.
	 *
	 * @since 1.6.0
	 *
	 * @return array<string,array<string,int>> Counts keyed by local Y-m-d, oldest first.
	 */
	private function weekly_trend(): array {
		global $wpdb;

		$table = $this->logger->table();
		$tz    = wp_timezone();
		$now   = new \DateTimeImmutable( 'now', $tz );
		$today = $now->format( 'Y-m-d' );

		// The Persian week runs Saturday → Friday, so the chart is anchored on
		// the Saturday of the current week rather than on a rolling seven days
		// ending today. Anchoring is done by ISO weekday number, never by a
		// locale-dependent helper: `N` is 1 (Monday) … 7 (Sunday) on every
		// server whatever its locale, so Saturday is 6 and the distance back
		// to it is the only arithmetic involved. PHP's "last Saturday" and
		// JavaScript's Sunday-first `getDay()` are both avoided for the same
		// reason — neither is stable across locales or across "today is
		// already Saturday".
		$weekday = (int) $now->format( 'N' );
		$back    = ( $weekday + 1 ) % 7;
		$saturday = $now->modify( "-{$back} days" )->setTime( 0, 0 );

		// Seeded in order, Saturday first, so the array itself carries the
		// ordering and no consumer has to re-sort. Each entry holds its own
		// label and date, which is what makes it impossible for the labels to
		// be reordered without the data moving with them.
		$labels = self::weekday_labels();
		$trend  = array();

		for ( $i = 0; $i < 7; $i++ ) {
			$date = $saturday->modify( "+{$i} days" );
			$key  = $date->format( 'Y-m-d' );

			$trend[ $key ] = array(
				'success'  => 0,
				'failed'   => 0,
				'pending'  => 0,
				'label'    => $labels[ (int) $date->format( 'N' ) ] ?? $key,
				'date'     => $key,
				'is_today' => $key === $today,
				// A day later this week has not happened yet. It still shows,
				// and still shows zero, but it is not the same thing as a day
				// that happened and saw nothing.
				'future'   => $key > $today,
			);
		}

		$start  = $saturday->setTimezone( new \DateTimeZone( 'UTC' ) );
		$finish = $saturday->modify( '+7 days' )->setTimezone( new \DateTimeZone( 'UTC' ) );
		$offset = $now->format( 'P' );

		// CONVERT_TZ turns the stored UTC timestamp into the site's local day
		// before grouping, so a delivery at 01:00 local time counts towards
		// the day the administrator would call it.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				"SELECT DATE(CONVERT_TZ(created_at, '+00:00', %s)) AS day, status, COUNT(*) AS total
				 FROM {$table}
				 WHERE created_at >= %s AND created_at < %s
				 GROUP BY day, status
				 ORDER BY day ASC",
				$offset,
				$start->format( 'Y-m-d H:i:s' ),
				$finish->format( 'Y-m-d H:i:s' )
			)
		);

		foreach ( (array) $rows as $row ) {
			$day    = (string) ( $row->day ?? '' );
			$status = (string) ( $row->status ?? '' );

			// Counts are written per status, so success and failure stay
			// independent — neither is ever derived from the other or from a
			// total.
			if ( isset( $trend[ $day ][ $status ] ) ) {
				$trend[ $day ][ $status ] = (int) $row->total;
			}
		}

		return $trend;
	}

	/**
	 * Persian weekday names keyed by ISO-8601 weekday number.
	 *
	 * Keyed by `N` (1 = Monday … 7 = Sunday) rather than by position, so a
	 * caller looks a name up from a date and cannot accidentally pair a label
	 * with the wrong day.
	 *
	 * @since 1.6.0
	 *
	 * @return array<int,string> Weekday names.
	 */
	public static function weekday_labels(): array {
		return array(
			1 => __( 'دوشنبه', 'wp-event-publisher' ),
			2 => __( 'سه‌شنبه', 'wp-event-publisher' ),
			3 => __( 'چهارشنبه', 'wp-event-publisher' ),
			4 => __( 'پنج‌شنبه', 'wp-event-publisher' ),
			5 => __( 'جمعه', 'wp-event-publisher' ),
			6 => __( 'شنبه', 'wp-event-publisher' ),
			7 => __( 'یکشنبه', 'wp-event-publisher' ),
		);
	}

	/**
	 * Routes every internal Jarchi view through the canonical top-level page.
	 * This completely bypasses WordPress' fragile hidden-submenu authorization
	 * path while preserving legacy renderers and their existing behavior.
	 */
	private function render_application_view( string $view ): void {
		$routes = array(
			'fields'                 => array( wpep()->field_mapping_admin(), 'render' ),
			'telegram'               => array( $this, 'render_telegram' ),
			'bale'                   => array( $this, 'render_bale' ),
			'whatsapp'               => array( $this, 'render_whatsapp' ),
			'woocommerce'            => array( $this, 'render_woocommerce' ),
			'rules'                  => array( wpep()->platform_admin(), 'render' ),
			'destinations'           => array( wpep()->platform_admin(), 'render' ),
			'profiles'               => array( wpep()->platform_admin(), 'render' ),
			'logs'                   => array( $this, 'render_logs' ),
			'tools'                  => array( $this, 'render_tools' ),
			'announcement-page'      => array( $this, 'render_announcement_page' ),
			'announcement'           => array( wpep()->announcement_builder(), 'render' ),
			'settings'               => array( $this, 'render_settings' ),
			'status'                 => array( $this, 'render_system_status' ),
			'diagnostics'            => array( $this, 'render_diagnostics' ),
			'about'                  => array( $this, 'render_about' ),
			'support'                => array( wpep()->tickets(), 'render_admin' ),
			'ticket-departments'     => array( wpep()->tickets(), 'render_departments' ),
			'ticket-sms'             => array( wpep()->tickets(), 'render_sms_settings' ),
			'ticket-ui'              => array( wpep()->tickets(), 'render_ui_settings' ),
			'ticket-agents'          => array( wpep()->tickets(), 'render_agents' ),
			'ticket-canned'          => array( wpep()->tickets(), 'render_canned_replies' ),
			'ticket-faq'             => array( wpep()->tickets(), 'render_faq' ),
			'ticket-new'             => array( wpep()->tickets(), 'render_admin_new_ticket' ),
			'ticket-advanced'        => array( wpep()->tickets(), 'render_advanced_settings' ),
			'ticket-bot'             => array( wpep()->tickets(), 'render_bot_settings' ),
			'ticket-ops'             => array( wpep()->ticket_operations(), 'render_page' ),
			'ticket-notifications'   => array( wpep()->ticket_notifications(), 'render_admin' ),
			'ticket-automations'     => array( wpep()->ticket_automations(), 'render' ),
			'ticket-cleanup'         => array( wpep()->ticket_cleanup(), 'render' ),
			'ticket-categories'      => array( wpep()->tickets(), 'render_categories' ),
		);

		if ( ! isset( $routes[ $view ] ) || ! is_callable( $routes[ $view ] ) ) {
			// Render the home screen's BODY, not render_dashboard(), which
			// re-reads jarchi_view from the query string and would route
			// straight back here. That loop consumed memory until PHP was
			// killed, which WordPress reports as "There has been a critical
			// error on this website" — the failure this comment exists to
			// stop anyone reintroducing.
			$this->render_home();
			return;
		}

		// A few legacy renderers inspect `$_GET['page']` to select their view.
		// Give them the slug they historically expected for the duration of the
		// callback, while the actual browser route remains the canonical Jarchi
		// page. This avoids changing their data/rendering logic.
		$legacy_pages = array(
			'fields' => self::MENU_SLUG . '-fields', 'telegram' => self::MENU_SLUG . '-telegram',
			'bale' => self::MENU_SLUG . '-bale', 'whatsapp' => self::MENU_SLUG . '-whatsapp',
			'woocommerce' => self::MENU_SLUG . '-woocommerce', 'rules' => self::MENU_SLUG . '-rules',
			'destinations' => self::MENU_SLUG . '-destinations', 'profiles' => self::MENU_SLUG . '-profiles',
			'logs' => self::MENU_SLUG . '-logs', 'tools' => self::MENU_SLUG . '-tools',
			'announcement-page' => self::PAGE_ANNOUNCEMENT_PAGE, 'announcement' => AnnouncementBuilder::PAGE,
			'settings' => self::MENU_SLUG . '-settings', 'status' => self::MENU_SLUG . '-status',
			'diagnostics' => self::MENU_SLUG . '-diagnostics', 'about' => self::MENU_SLUG . '-about',
			'support' => Tickets::PAGE, 'ticket-departments' => Tickets::PAGE_DEPTS, 'ticket-sms' => Tickets::PAGE_SMS,
			'ticket-ui' => Tickets::PAGE_UI, 'ticket-agents' => 'wp-event-publisher-ticket-agents',
			'ticket-canned' => 'wp-event-publisher-ticket-canned', 'ticket-faq' => Tickets::PAGE_FAQ,
			'ticket-new' => Tickets::PAGE_NEW, 'ticket-advanced' => Tickets::PAGE_ADVANCED, 'ticket-bot' => Tickets::PAGE_BOT,
			'ticket-ops' => TicketOperations::PAGE_SLA, 'ticket-notifications' => TicketNotifications::PAGE,
			'ticket-automations' => TicketAutomations::PAGE, 'ticket-categories' => 'wp-event-publisher-ticket-categories',
			'ticket-cleanup' => 'wp-event-publisher-ticket-cleanup',
		);
		$original_page = $_GET['page'] ?? null; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$_GET['page'] = $legacy_pages[ $view ] ?? self::MENU_SLUG; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		try {
			( $routes[ $view ] )();
		} finally {
			if ( null === $original_page ) {
				unset( $_GET['page'] );
			} else {
				$_GET['page'] = $original_page; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			}
		}
	}

	/**
	 * Renders the Dashboard screen.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function render_dashboard(): void {
		$this->guard();

		$view = self::current_view();

		if ( '' !== $view ) {
			$this->render_application_view( $view );

			return;
		}

		$this->render_home();
	}

	/**
	 * Renders the Jarchi home screen.
	 *
	 * Deliberately separate from {@see self::render_dashboard()}, which is the
	 * router. A renderer that also routes cannot be used as a router's
	 * fallback without looping.
	 *
	 * @since 1.18.4
	 *
	 * @return void
	 */
	private function render_home(): void {
		$stats  = $this->logger->stats();
		$recent = $this->logger->query( array( 'per_page' => 8 ) );

		$trend = $this->weekly_trend();

		$destinations = array();
		foreach ( wpep()->destinations()->all() as $destination ) {
			$destinations[] = array(
				'name' => (string) ( $destination['name'] ?? $destination['id'] ),
				'provider' => (string) ( $destination['provider'] ?? '' ),
				'enabled' => ! empty( $destination['enabled'] ),
			);
		}

		$this->render_view(
			'dashboard',
			array(
				'stats'        => $stats,
				'settings'     => $this->settings->all(),
				'recent'       => $recent['items'],
				'queue'        => $this->dispatcher->storage()->count_pending(),
				'trend'        => $trend,
				'destinations' => $destinations,
			)
		);
	}

	/**
	 * Renders the Settings screen.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function render_settings(): void {
		$this->guard();

		$this->render_view(
			'settings',
			array(
				'settings'    => $this->settings->all(),
				'post_types'  => $this->validator->selectable_post_types(),
				'statuses'    => get_post_stati( array( 'internal' => false ), 'objects' ),
				'event_types' => array(
					// The internal codes never change — `created`, `updated`,
					// `deleted` are what the backend matches on. Only what an
					// administrator reads is Persian (spec 14).
					Event::TYPE_CREATED => __( 'انتشار جدید', 'wp-event-publisher' ),
					Event::TYPE_UPDATED => __( 'ویرایش محتوا', 'wp-event-publisher' ),
					Event::TYPE_DELETED => __( 'حذف محتوا', 'wp-event-publisher' ),
				),
			)
		);
	}

	/**
	 * Renders the Logs screen.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function render_logs(): void {
		$this->guard();

		// Read-only list filters; nonce not required for viewing.
		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		$args = array(
			'search'     => isset( $_GET['s'] ) ? sanitize_text_field( wp_unslash( $_GET['s'] ) ) : '',
			'status'     => isset( $_GET['status'] ) ? sanitize_key( wp_unslash( $_GET['status'] ) ) : '',
			'stage'      => isset( $_GET['stage'] ) ? sanitize_text_field( wp_unslash( $_GET['stage'] ) ) : '',
			'event_id'   => isset( $_GET['event_id'] ) ? sanitize_text_field( wp_unslash( $_GET['event_id'] ) ) : '',
			'event_type' => isset( $_GET['event_type'] ) ? sanitize_key( wp_unslash( $_GET['event_type'] ) ) : '',
			'site_id'    => isset( $_GET['site_id'] ) ? sanitize_text_field( wp_unslash( $_GET['site_id'] ) ) : '',
			'post_id'    => isset( $_GET['post_id'] ) ? absint( $_GET['post_id'] ) : 0,
			'page'       => isset( $_GET['paged'] ) ? max( 1, absint( $_GET['paged'] ) ) : 1,
			'per_page'   => 30,
		);
		// phpcs:enable

		$result = $this->logger->query( $args );

		$this->render_view(
			'logs',
			array(
				'logs'  => $result['items'],
				'total' => $result['total'],
				'pages' => $result['pages'],
				'args'  => $args,
			)
		);
	}

	/**
	 * Renders the Tools screen.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function render_tools(): void {
		$this->guard();

		global $wpdb;

		$next_sweep = wp_next_scheduled( Dispatcher::SWEEP_HOOK );

		$this->render_view(
			'tools',
			array(
				'settings' => $this->settings->all(),
				'problems' => $this->validator->validate_configuration( $this->settings->all() ),
				'system'   => array(
					'plugin_version' => WPEP_VERSION,
					'contract'       => Contract::VERSION,
					'endpoint'       => $this->settings->endpoint(),
					'site_id'        => $this->settings->site_id(),
					'signature'      => strtoupper( Signer::ALGORITHM ),
					'auth_style'     => (string) $this->settings->get( 'auth_style', Signer::AUTH_ALL ),
					'secret_set'     => '' !== (string) $this->settings->get( 'api_secret' ),
					'tolerance'      => $this->settings->signature_tolerance(),
					'post_types'     => $this->settings->allowed_post_types(),
					'statuses'       => (array) $this->settings->get( 'allowed_post_statuses', array() ),
					'event_types'    => $this->settings->allowed_event_types(),
					'dispatch_mode'  => $this->settings->dispatch_mode(),
					'queue_size'     => $this->dispatcher->storage()->count_pending(),
					'queue_stats'    => $this->dispatcher->storage()->stats(),
					'cron_healthy'   => $this->dispatcher->cron_healthy(),
					'next_sweep'     => $next_sweep ? gmdate( 'Y-m-d H:i:s', (int) $next_sweep ) : '',
					'wp_version'     => get_bloginfo( 'version' ),
					'php_version'    => PHP_VERSION,
					'mysql_version'  => $wpdb->db_version(),
					'wp_cron'        => $this->settings->cron_available(),
					'timezone'       => wp_timezone_string(),
					'memory_limit'   => ini_get( 'memory_limit' ),
					'max_exec_time'  => ini_get( 'max_execution_time' ),
					'ssl'            => is_ssl(),
					'locale'         => get_locale(),
					'multisite'      => is_multisite(),
					'woocommerce'    => class_exists( 'WooCommerce' ),
					'rest_url'       => rest_url( Rest::REST_NAMESPACE ),
				),
			)
		);
	}

	/**
	 * Renders the Diagnostics screen.
	 *
	 * Network checks are skipped on the initial page load so opening the
	 * screen is never slow; the button runs the full suite.
	 *
	 * @since 1.3.0
	 *
	 * @return void
	 */
	public function render_diagnostics(): void {
		$this->guard();

		$this->render_view(
			'diagnostics',
			array(
				'checks'     => $this->diagnostics->run( false ),
				'queue'      => $this->dispatcher->storage()->stats(),
				'deliveries' => $this->dispatcher->delivery_stats(),
				'endpoint'   => $this->settings->endpoint(),
				'post_types' => $this->validator->selectable_post_types(),
				'settings'   => $this->settings->all(),
			)
		);
	}

	/**
	 * Renders the About screen.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function render_about(): void {
		$this->guard();

		$this->render_view( 'about', array() );
	}

	/* ---------------------------------------------------------------------
	 * AJAX handlers.
	 * ------------------------------------------------------------------ */

	/**
	 * AJAX: runs a connection test against the configured endpoint.
	 *
	 * The test uses the production URL, the production credentials and the
	 * production encoder. Configuration problems that would stop a real
	 * advertisement — plugin disabled, no post types — are reported
	 * alongside the HTTP result, so a reachable endpoint can never be
	 * mistaken for a working pipeline.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function ajax_test_connection(): void {
		$this->verify_ajax();

		$result   = $this->webhook->test_connection();
		$problems = $this->validator->validate_configuration( $this->settings->all() );

		// A failed POST cannot distinguish "host unreachable" from
		// "endpoint rejected us". A GET to the service health probe on the
		// same origin separates the two, which is the difference between a
		// network problem and a configuration problem.
		if ( ! $result['success'] ) {
			$health = $this->probe_health();

			if ( '' !== $health ) {
				$problems[] = $health;
			}
		}

		$data = array(
			'message'  => $result['message'],
			'code'     => $result['code'],
			'endpoint' => $this->settings->endpoint(),
			'body'     => mb_substr( trim( wp_strip_all_tags( (string) $result['body'] ) ), 0, 500 ),
			'errors'   => $problems,
		);

		if ( $result['success'] ) {
			if ( ! empty( $problems ) ) {
				$data['message'] = sprintf(
					/* translators: %s: HTTP result message. */
					__( '%s The endpoint works, but real advertisements would still not be published:', 'wp-event-publisher' ),
					$result['message']
				);
			}

			wp_send_json_success( $data );
		}

		wp_send_json_error( $data );
	}

	/**
	 * Probes the service health endpoint on the webhook's own origin.
	 *
	 * @since 1.2.1
	 *
	 * @return string Human readable finding, empty when nothing to report.
	 */
	private function probe_health(): string {
		$endpoint = $this->settings->endpoint();

		if ( '' === $endpoint ) {
			return '';
		}

		$parts = wp_parse_url( $endpoint );

		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}

		// Same scheme, host and port as the configured endpoint: no
		// caller-supplied URL is ever fetched here.
		$health = $parts['scheme'] . '://' . $parts['host']
			. ( empty( $parts['port'] ) ? '' : ':' . (int) $parts['port'] ) . '/health';

		$response = wp_remote_get(
			$health,
			array(
				'timeout'     => max( Validator::TIMEOUT_MIN, (int) $this->settings->get( 'webhook_timeout', 15 ) ),
				'redirection' => 2,
				'sslverify'   => true,
			)
		);

		if ( is_wp_error( $response ) ) {
			return sprintf(
				/* translators: 1: health URL, 2: error message. */
				__( 'The service health probe at %1$s is also unreachable (%2$s), so this is a network or firewall problem on the WordPress side rather than a plugin setting.', 'wp-event-publisher' ),
				$health,
				$response->get_error_message()
			);
		}

		return sprintf(
			/* translators: 1: health URL, 2: HTTP status code. */
			__( 'The service health probe at %1$s answered HTTP %2$d, so the host is reachable and the failure above is about the webhook request itself — check the secret and the response body.', 'wp-event-publisher' ),
			$health,
			(int) wp_remote_retrieve_response_code( $response )
		);
	}

	/**
	 * AJAX: sends a sample payload built from the most recent published
	 * post (or a synthetic sample when none exists).
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function ajax_send_sample(): void {
		$this->verify_ajax();

		$post_types = $this->settings->allowed_post_types();

		$posts = get_posts(
			array(
				'numberposts' => 1,
				'post_status' => (array) $this->settings->get( 'allowed_post_statuses', array( 'publish' ) ),
				'post_type'   => empty( $post_types ) ? array( 'post' ) : $post_types,
			)
		);

		$post_id   = ! empty( $posts ) ? (int) $posts[0]->ID : 0;
		$event     = new Event( $this->event_id->generate(), Event::TYPE_SAMPLE, $post_id );
		$timestamp = $this->signer->timestamp();

		// A sample carries a real, fully normalized post so the Node.js
		// service can be built against production-shaped data, but it is
		// typed `sample` so it is never mistaken for a publish event.
		$payload = ! empty( $posts )
			? $this->contract->build( $event, $this->normalizer->normalize( $posts[0], Event::TYPE_SAMPLE ), $timestamp )
			: $this->contract->build_minimal(
				$event,
				$timestamp,
				array( 'title' => __( 'Sample payload', 'wp-event-publisher' ) )
			);

		$result = $this->webhook->send_event( $event, $payload );

		$this->respond( $result, array( 'post_id' => $post_id ) );
	}

	/**
	 * AJAX: validates the current configuration.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function ajax_validate_config(): void {
		$this->verify_ajax();

		$errors = $this->validator->validate_configuration( $this->settings->all() );

		if ( empty( $errors ) ) {
			wp_send_json_success(
				array( 'message' => __( 'Configuration looks valid. You are ready to publish advertisements.', 'wp-event-publisher' ) )
			);
		}

		wp_send_json_error(
			array(
				'message' => __( 'The configuration has problems that stop advertisements from being published:', 'wp-event-publisher' ),
				'errors'  => $errors,
			)
		);
	}

	/**
	 * AJAX: sends one specific advertisement through the real pipeline.
	 *
	 * Builds the same payload, with the same credentials, that a publish
	 * would produce, and reports the HTTP status synchronously — the
	 * fastest way to prove the whole chain works without waiting for a
	 * queue tick.
	 *
	 * @since 1.2.0
	 *
	 * @return void
	 */
	public function ajax_dispatch_post(): void {
		$this->verify_ajax();

		$post_id = isset( $_POST['post_id'] ) ? absint( wp_unslash( $_POST['post_id'] ) ) : 0;
		$post    = $post_id > 0 ? get_post( $post_id ) : null;

		if ( ! $post instanceof WP_Post ) {
			wp_send_json_error(
				array(
					/* translators: %d: post ID. */
					'message' => sprintf( __( 'No post with ID %d exists.', 'wp-event-publisher' ), $post_id ),
				)
			);
		}

		$notes = array();

		if ( ! in_array( $post->post_type, $this->settings->allowed_post_types(), true ) ) {
			$notes[] = sprintf(
				/* translators: %s: post type slug. */
				__( 'Heads up: the post type "%s" is not enabled in Settings, so publishing it would not create an event automatically.', 'wp-event-publisher' ),
				$post->post_type
			);
		}

		if ( ! $this->detector->is_published_status( $post->post_status ) ) {
			$notes[] = sprintf(
				/* translators: %s: post status. */
				__( 'Heads up: the status "%s" is not one of the enabled publish statuses.', 'wp-event-publisher' ),
				$post->post_status
			);
		}

		$type  = $this->detector->has_been_published( $post_id ) ? Event::TYPE_UPDATED : Event::TYPE_CREATED;
		$event = $this->dispatcher->create_event( $post_id, $type );

		$payload = $this->contract->build(
			$event,
			$this->normalizer->normalize( $post, $type ),
			$this->signer->timestamp()
		);

		$result = $this->webhook->send_event( $event, $payload );

		// This tool delivers synchronously instead of queueing, so the
		// identifier is released here rather than by the dispatcher.
		$this->event_id->release( $post_id, $event->id() );

		$this->respond(
			$result,
			array(
				'post_id'  => $post_id,
				'event_id' => $event->id(),
				'errors'   => $notes,
				'images'   => count( (array) ( $payload['images'] ?? array() ) ),
			)
		);
	}

	/**
	 * AJAX: processes queued events immediately.
	 *
	 * @since 1.2.0
	 *
	 * @return void
	 */
	public function ajax_run_queue(): void {
		$this->verify_ajax();

		$waiting = $this->dispatcher->storage()->count_pending();

		// Manual run: no grace period, deliver everything that is due now.
		$processed = $this->dispatcher->sweep( 20, 0 );

		wp_send_json_success(
			array(
				'message' => sprintf(
					/* translators: 1: number of processed events, 2: number of events that were waiting. */
					__( 'Processed %1$d of %2$d queued events. Check the Logs screen for each delivery result.', 'wp-event-publisher' ),
					$processed,
					$waiting
				),
				'queue'   => $this->dispatcher->storage()->count_pending(),
			)
		);
	}

	/**
	 * AJAX: runs the full diagnostics suite, including network checks.
	 *
	 * @since 1.3.0
	 *
	 * @return void
	 */
	public function ajax_run_diagnostics(): void {
		$this->verify_ajax();

		$checks = $this->diagnostics->run( true );

		$failed = array_filter( $checks, static fn( $check ) => Diagnostics::FAIL === $check['status'] );

		wp_send_json_success(
			array(
				'checks'  => $checks,
				'message' => empty( $failed )
					? __( 'Every check passed. Publishing an advertisement will reach the service.', 'wp-event-publisher' )
					: sprintf(
						/* translators: %d: number of failed checks. */
						_n( '%d check failed. Fix it and run the diagnostics again.', '%d checks failed. Fix them and run the diagnostics again.', count( $failed ), 'wp-event-publisher' ),
						count( $failed )
					),
			)
		);
	}

	/**
	 * Sends a delivery result back to the browser.
	 *
	 * @since 1.2.0
	 *
	 * @param array{success:bool,code:int,message:string,body:string} $result Delivery result.
	 * @param array<string,mixed>                                     $extra  Additional response data.
	 *
	 * @return void
	 */
	private function respond( array $result, array $extra = array() ): void {
		$data = array_merge(
			array(
				'message'  => $result['message'],
				'code'     => $result['code'],
				'endpoint' => $this->settings->endpoint(),
				'body'     => mb_substr( trim( wp_strip_all_tags( (string) $result['body'] ) ), 0, 500 ),
			),
			$extra
		);

		if ( $result['success'] ) {
			wp_send_json_success( $data );
		}

		wp_send_json_error( $data );
	}

	/* ---------------------------------------------------------------------
	 * Form (admin-post.php) handlers.
	 * ------------------------------------------------------------------ */

	/**
	 * Handles log management actions: delete single entry, clear all.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function handle_logs_action(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'You are not allowed to manage logs.', 'wp-event-publisher' ), '', array( 'response' => 403 ) );
		}

		check_admin_referer( self::NONCE_LOGS );

		$task = isset( $_REQUEST['task'] ) ? sanitize_key( wp_unslash( $_REQUEST['task'] ) ) : '';

		$notice = 'error';

		if ( 'delete' === $task ) {
			$log_id = isset( $_REQUEST['log_id'] ) ? absint( $_REQUEST['log_id'] ) : 0;
			$notice = $log_id && $this->logger->delete( $log_id ) ? 'deleted' : 'error';
		} elseif ( 'clear' === $task ) {
			$notice = $this->logger->clear() ? 'cleared' : 'error';
		}

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'        => self::MENU_SLUG . '-logs',
					'wpep_notice' => $notice,
				),
				admin_url( 'admin.php' )
			)
		);
		exit;
	}

	/**
	 * Streams the (optionally filtered) log table as a CSV download.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function handle_export_logs(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'You are not allowed to export logs.', 'wp-event-publisher' ), '', array( 'response' => 403 ) );
		}

		check_admin_referer( self::NONCE_LOGS );

		$csv = $this->logger->export_csv(
			array(
				'search'     => isset( $_REQUEST['s'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['s'] ) ) : '',
				'status'     => isset( $_REQUEST['status'] ) ? sanitize_key( wp_unslash( $_REQUEST['status'] ) ) : '',
				'stage'      => isset( $_REQUEST['stage'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['stage'] ) ) : '',
				'event_id'   => isset( $_REQUEST['event_id'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['event_id'] ) ) : '',
				'event_type' => isset( $_REQUEST['event_type'] ) ? sanitize_key( wp_unslash( $_REQUEST['event_type'] ) ) : '',
				'site_id'    => isset( $_REQUEST['site_id'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['site_id'] ) ) : '',
				'post_id'    => isset( $_REQUEST['post_id'] ) ? absint( $_REQUEST['post_id'] ) : 0,
			)
		);

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename=wpep-logs-' . gmdate( 'Ymd-His' ) . '.csv' );

		echo $csv; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CSV file download, not HTML.
		exit;
	}

	/* ---------------------------------------------------------------------
	 * Internals.
	 * ------------------------------------------------------------------ */

	/**
	 * Dies unless the current user may access plugin screens.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	private function guard(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'wp-event-publisher' ), '', array( 'response' => 403 ) );
		}
	}

	/**
	 * Verifies capability and nonce for AJAX requests.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	private function verify_ajax(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => __( 'Insufficient permissions.', 'wp-event-publisher' ) ), 403 );
		}

		check_ajax_referer( self::NONCE_AJAX, 'nonce' );
	}

	/**
	 * Includes an admin view template with scoped variables.
	 *
	 * @since 1.0.0
	 *
	 * @param string              $view Template name without extension.
	 * @param array<string,mixed> $data Variables extracted into the template.
	 *
	 * @return void
	 */
	private function render_view( string $view, array $data ): void {
		$file = WPEP_PLUGIN_DIR . 'admin/views/' . $view . '.php';

		if ( ! is_readable( $file ) ) {
			return;
		}

		$is_inner = $this->is_inner_jarchi_screen();

		if ( $is_inner ) {
			$this->render_inner_shell_start();
		}

		// phpcs:ignore WordPress.PHP.DontExtract.extract_extract -- controlled template scope.
		extract( $data, EXTR_SKIP );

		include $file;

		if ( $is_inner ) {
			$this->render_inner_shell_end();
		}
	}
}
