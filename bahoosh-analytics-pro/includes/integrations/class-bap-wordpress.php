<?php
/**
 * WordPress frontend integration.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Enqueues the tracker and hands it a server-built configuration.
 *
 * The configuration is where "identity is resolved server-side" becomes
 * concrete: `wp_user_id` is written by PHP from the WordPress session, and a
 * signed token accompanies it so the ingest endpoint can verify the claim
 * later without trusting the browser.
 */
class BAP_WordPress {

	const AUTH_EVENT_META = '_bap_pending_auth_event';

	/**
	 * Registers hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'maybe_seed_anonymous_cookie' ), 5 );
		add_action( 'wp_head', array( __CLASS__, 'print_api_stub' ), 1 );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'wp_login', array( __CLASS__, 'record_login' ), 10, 2 );
		add_action( 'user_register', array( __CLASS__, 'record_signup' ) );
	}

	/**
	 * Ensures a logged-in visitor has an anonymous id cookie.
	 *
	 * The signed identity token is bound to the anonymous id, so on the very
	 * first authenticated page view — before the tracker has run — there would
	 * be nothing to bind to. Seeding it server-side closes that gap. Anonymous
	 * visitors are left alone so cached pages are not forced to vary.
	 *
	 * @return void
	 */
	public static function maybe_seed_anonymous_cookie() {
		if ( ! is_user_logged_in() || headers_sent() ) {
			return;
		}
		if ( '' !== BAP_Identity::anonymous_id_from_cookie() ) {
			return;
		}
		if ( ! BAP_Identity::should_track_current_user() ) {
			return;
		}

		$anon = 'anon_' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 32 );

		setcookie(
			BAP_Identity::ANON_COOKIE,
			$anon,
			array(
				'expires'  => time() + BAP_Identity::ANON_TTL,
				'path'     => COOKIEPATH ? COOKIEPATH : '/',
				'domain'   => COOKIE_DOMAIN,
				'secure'   => is_ssl(),
				'httponly' => false, // The tracker must be able to read it.
				'samesite' => 'Lax',
			)
		);

		// Make it visible to the rest of this request.
		$_COOKIE[ BAP_Identity::ANON_COOKIE ] = $anon;
	}

	/**
	 * Prints the queueing stub that stands in for the tracker until it loads.
	 *
	 * The tracker is deferred to the footer, so theme and plugin code running
	 * earlier in the page would otherwise hit `bahoosh is not defined`. The stub
	 * records calls; the real API replays them on boot. Eight lines inline beats
	 * asking integrators to guard every call.
	 *
	 * @return void
	 */
	public static function print_api_stub() {
		if ( ! BAP_Settings::tracking_enabled() || ! BAP_Settings::collects_in_browser() || ! BAP_Identity::should_track_current_user() ) {
			return;
		}

		$stub = 'window.bahoosh=window.bahoosh||function(){(window.bahoosh.q=window.bahoosh.q||[]).push(arguments)};';

		if ( function_exists( 'wp_print_inline_script_tag' ) ) {
			wp_print_inline_script_tag( $stub, array( 'id' => 'bahoosh-analytics-stub' ) );
			return;
		}

		echo '<script id="bahoosh-analytics-stub">' . $stub . '</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- static literal, no interpolation.
	}

	/**
	 * Enqueues tracker assets.
	 *
	 * @return void
	 */
	public static function enqueue() {
		if ( ! BAP_Settings::tracking_enabled() || ! BAP_Settings::collects_in_browser() || ! BAP_Identity::should_track_current_user() ) {
			return;
		}

		$handles = self::enqueue_tracker_scripts();
		if ( empty( $handles ) ) {
			return;
		}

		// The config must be attached to the FIRST handle. In SCRIPT_DEBUG mode
		// the modules load individually and the tracker auto-boots from
		// 12-tracker.js, which runs before the WooCommerce integration — hanging
		// the config off the last handle would define it too late.
		$config_handle = $handles[0];

		wp_add_inline_script(
			$config_handle,
			'window.BAP_CONFIG = ' . wp_json_encode( self::build_config() ) . ';',
			'before'
		);

		if ( BAP_WooCommerce::should_track() ) {
			wp_add_inline_script(
				$config_handle,
				'window.BAP_WC = ' . wp_json_encode( BAP_WooCommerce::build_config() ) . ';',
				'before'
			);
		}
	}

	/**
	 * Registers the tracker script(s).
	 *
	 * Production loads the generated single-file bundle. With SCRIPT_DEBUG on,
	 * the individual modules are loaded in dependency order instead, so stack
	 * traces point at real source files.
	 *
	 * @return string[] Enqueued handles, in load order.
	 */
	private static function enqueue_tracker_scripts() {
		$bundle_path = BAP_PLUGIN_DIR . 'assets/js/dist/bahoosh-tracker.js';
		$use_bundle  = ( ! defined( 'SCRIPT_DEBUG' ) || ! SCRIPT_DEBUG ) && is_readable( $bundle_path );

		if ( $use_bundle ) {
			wp_enqueue_script(
				'bahoosh-tracker',
				BAP_PLUGIN_URL . 'assets/js/dist/bahoosh-tracker.js',
				array(),
				self::asset_version( $bundle_path ),
				true
			);
			return array( 'bahoosh-tracker' );
		}

		$modules = self::tracker_modules();

		$handles  = array();
		$previous = array();

		foreach ( $modules as $relative ) {
			$absolute = BAP_PLUGIN_DIR . $relative;
			if ( ! is_readable( $absolute ) ) {
				continue;
			}
			$handle = 'bahoosh-' . sanitize_key( str_replace( array( '/', '.js' ), array( '-', '' ), $relative ) );
			wp_enqueue_script(
				$handle,
				BAP_PLUGIN_URL . $relative,
				$previous,
				self::asset_version( $absolute ),
				true
			);
			$previous  = array( $handle );
			$handles[] = $handle;
		}

		// The config must land before the tracker module that auto-boots.
		return $handles;
	}

	/**
	 * The tracker's source modules, in load order.
	 *
	 * Read from the directory rather than hardcoded, using the same rule as
	 * `tools/build-bundle.js`: the numeric filename prefixes encode load order,
	 * so a plain sort is the dependency order.
	 *
	 * This used to be a hand-maintained list, and it drifted — `10b-tab-
	 * coordinator.js` was added to `core/` and picked up by the bundler (which
	 * globs) but never added to the list (which did not). Production was fine;
	 * every site running SCRIPT_DEBUG got a tracker that threw on boot because
	 * `NS.TabCoordinator` was undefined. Deriving both lists from the same
	 * source is what stops that recurring.
	 *
	 * @return string[] Plugin-relative paths.
	 */
	private static function tracker_modules() {
		$core = glob( BAP_PLUGIN_DIR . 'assets/js/core/*.js' );
		if ( ! is_array( $core ) ) {
			$core = array();
		}
		sort( $core ); // Numeric prefixes encode load order.

		$integrations = glob( BAP_PLUGIN_DIR . 'assets/js/integrations/*.js' );
		if ( ! is_array( $integrations ) ) {
			$integrations = array();
		}
		sort( $integrations );

		$modules = array();
		foreach ( array_merge( $core, $integrations ) as $absolute ) {
			$modules[] = str_replace( BAP_PLUGIN_DIR, '', $absolute );
		}

		return $modules;
	}

	/**
	 * Cache-busting version for an asset.
	 *
	 * @param string $path Absolute path.
	 * @return string
	 */
	private static function asset_version( $path ) {
		$mtime = is_readable( $path ) ? filemtime( $path ) : false;
		return $mtime ? BAP_VERSION . '.' . $mtime : BAP_VERSION;
	}

	/**
	 * Builds the tracker configuration.
	 *
	 * @return array
	 */
	public static function build_config() {
		$settings   = BAP_Settings::all();
		$anonymous  = BAP_Identity::anonymous_id_from_cookie();
		$wp_user_id = BAP_Identity::wp_user_id();

		$direct = 'direct' === $settings['transport_mode'] && '' !== $settings['ingest_key'];

		$config = array(
			'schema_version'          => BAP_SCHEMA_VERSION,
			// Resolved rather than raw: a site with no collector still needs a
			// stable label for its own data.
			'site_id'                 => BAP_Settings::resolved_site_id(),
			'endpoint'                => $direct
				? BAP_Settings::endpoint( 'events' )
				: rest_url( BAP_REST_Controller::NAMESPACE_V2 . '/events' ),
			'beacon_endpoint'         => $direct
				? BAP_Settings::endpoint( 'events' )
				: rest_url( BAP_REST_Controller::NAMESPACE_V2 . '/events' ),
			'link_endpoint'           => rest_url( BAP_REST_Controller::NAMESPACE_V2 . '/identity/link' ),
			'credentials'             => $direct ? 'omit' : 'same-origin',
			// Public ingest key only — the secret API key never reaches a browser.
			'ingest_key'              => $direct ? $settings['ingest_key'] : '',
			'nonce'                   => wp_create_nonce( 'wp_rest' ),
			'wp_user_id'              => $wp_user_id,
			'woocommerce_customer_id' => BAP_Identity::woocommerce_customer_id(),
			'identity_token'          => '' !== $anonymous ? BAP_Identity_Token::issue( $anonymous ) : '',
			'request_timeout_ms'      => (int) $settings['request_timeout_ms'],
			'max_concurrent_requests' => (int) $settings['max_concurrent_requests'],
			'max_retry_attempts'      => (int) $settings['max_retry_attempts'],
			'max_queue_size'          => (int) $settings['max_queue_size'],
			'require_consent'         => (bool) $settings['require_consent'],
			'respect_dnt'             => (bool) $settings['respect_dnt'],
			'debug'                   => (bool) $settings['debug'],
			'search_param'            => 's',
			'click_capture'           => $settings['click_capture'],
			'multi_tab_coordination'  => (bool) $settings['multi_tab_coordination'],
			'features'                => array(
				'page_views' => (bool) $settings['track_page_views'],
				'clicks'     => (bool) $settings['track_clicks'],
				'scroll'     => (bool) $settings['track_scroll'],
				'time'       => (bool) $settings['track_time'],
				'forms'      => (bool) $settings['track_forms'],
				'spa'         => (bool) $settings['track_spa'],
				'rage_clicks' => (bool) $settings['track_rage_clicks'],
				'dead_clicks' => (bool) $settings['track_dead_clicks'],
				'js_errors'   => (bool) $settings['track_js_errors'],
				'web_vitals'  => (bool) $settings['track_web_vitals'],
				'media'       => (bool) $settings['track_media'],
				'copy'        => (bool) $settings['track_copy'],
			),
			'max_events_per_page'     => (int) $settings['max_events_per_page'],
			'cookie_enabled'          => true,
			'page_type'               => self::page_type(),
			'post_id'                 => is_singular() ? get_the_ID() : null,
			'auth_event'              => self::consume_auth_event( $wp_user_id ),
		);

		if ( is_search() ) {
			global $wp_query;
			$config['search_results_count'] = isset( $wp_query->found_posts ) ? (int) $wp_query->found_posts : null;
		}

		/**
		 * Filters the tracker configuration sent to the browser.
		 *
		 * Anything added here is public. Never add secrets.
		 *
		 * @param array $config Tracker configuration.
		 */
		return apply_filters( 'bap_tracker_config', $config );
	}

	/**
	 * Classifies the current request for the `page_view` payload.
	 *
	 * @return string
	 */
	public static function page_type() {
		if ( BAP_WooCommerce::is_active() ) {
			$woo_type = BAP_WooCommerce::page_type();
			if ( '' !== $woo_type ) {
				return $woo_type;
			}
		}
		if ( is_front_page() ) {
			return 'home';
		}
		if ( is_search() ) {
			return 'search';
		}
		if ( is_singular( 'post' ) ) {
			return 'post';
		}
		if ( is_page() ) {
			return 'page';
		}
		if ( is_singular() ) {
			return 'singular';
		}
		if ( is_category() || is_tag() || is_tax() ) {
			return 'taxonomy';
		}
		if ( is_archive() ) {
			return 'archive';
		}
		if ( is_404() ) {
			return 'not_found';
		}
		return 'other';
	}

	/**
	 * Flags a login so the next page view emits a `login` event.
	 *
	 * The flag lives in user meta rather than a session variable so it survives
	 * the redirect that follows authentication.
	 *
	 * @param string  $user_login Username.
	 * @param WP_User $user       User object.
	 * @return void
	 */
	public static function record_login( $user_login, $user = null ) {
		if ( $user instanceof WP_User ) {
			update_user_meta( $user->ID, self::AUTH_EVENT_META, 'login' );
		}
	}

	/**
	 * Flags a registration so the next page view emits a `signup` event.
	 *
	 * @param int $user_id New user id.
	 * @return void
	 */
	public static function record_signup( $user_id ) {
		update_user_meta( (int) $user_id, self::AUTH_EVENT_META, 'signup' );
	}

	/**
	 * Reads and clears the pending auth event for a user.
	 *
	 * @param int $user_id User id.
	 * @return string Empty string when there is none.
	 */
	private static function consume_auth_event( $user_id ) {
		if ( $user_id <= 0 ) {
			return '';
		}
		$event = get_user_meta( $user_id, self::AUTH_EVENT_META, true );
		if ( ! $event ) {
			return '';
		}
		delete_user_meta( $user_id, self::AUTH_EVENT_META );
		return in_array( $event, array( 'login', 'signup' ), true ) ? $event : '';
	}
}
