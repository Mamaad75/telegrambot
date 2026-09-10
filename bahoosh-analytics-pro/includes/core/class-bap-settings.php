<?php
/**
 * Settings store.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Reads and writes plugin options with validation and sane defaults.
 *
 * The secret API key is stored separately from the rest of the settings so it
 * is never accidentally serialised into a page, a REST response, or an export.
 */
class BAP_Settings {

	const OPTION_KEY        = 'bap_settings';
	const OPTION_SECRET_KEY = 'bap_api_key';
	const OPTION_DB_VERSION = 'bap_db_version';
	const OPTION_AI_WEBHOOK_SECRET = 'bap_ai_webhook_secret';

	/**
	 * Cached settings.
	 *
	 * @var array|null
	 */
	private static $cache = null;

	/**
	 * Default values.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'enabled'                 => true,
			'api_url'                 => '',
			'site_id'                 => '',
			'ingest_key'              => '',
			'transport_mode'          => 'proxy',
			'request_timeout_ms'      => 15000,
			'max_concurrent_requests' => 4,
			'max_retry_attempts'      => 10,
			'max_queue_size'          => 1000,
			'click_capture'           => 'interactive',
			'max_events_per_page'     => 500,
			'track_page_views'        => true,
			'track_clicks'            => true,
			'track_scroll'            => true,
			'track_time'              => true,
			'track_forms'             => true,
			'track_spa'               => true,
			'track_rage_clicks'       => false,
			'track_dead_clicks'       => false,
			'track_js_errors'         => false,
			'track_web_vitals'        => false,
			'track_media'             => false,
			'track_copy'              => false,
			'module_experience'       => true,
			'module_funnels'          => true,
			'module_journeys'         => true,
			'module_ai'               => true,
			'ai_enabled'              => false,
			'ai_autonomy'             => 'approval',
			'ai_min_confidence'       => 80,
			// Defaults to a Llama model on the same machine. No key, no bill, and
			// the shop's revenue figures and product names never leave the
			// server. When nothing is listening on the port the rule engine
			// answers instead, so the feature still works out of the box.
			'ai_provider'             => 'llama',
			'ai_provider_url'         => '',
			'ai_provider_model'       => '',
			// The agent starts switched off. Letting a model's reading of the
			// numbers change prices is a decision a shop owner makes on purpose,
			// not one they discover after an update.
			'ai_agent_mode'           => 'off',
			'ai_agent_max_discount'   => 15,
			'ga4_property_id'         => '',
			'admin_accent'            => '#7c5cff',
			'admin_density'           => 'comfortable',
			'multi_tab_coordination'  => true,
			'track_logged_in'         => true,
			'track_admins'            => false,
			'require_consent'         => false,
			'respect_dnt'             => true,
			'anonymize_ip'            => true,
			'hash_user_email'         => true,
			'woocommerce_enabled'     => true,
			'server_side_purchase'    => true,
			'data_retention_days'     => 0,
			'debug'                   => false,
		);
	}

	/**
	 * Returns all settings, merged over defaults.
	 *
	 * @return array
	 */
	public static function all() {
		if ( null !== self::$cache ) {
			return self::$cache;
		}

		$stored = get_option( self::OPTION_KEY, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$settings = array_merge( self::defaults(), $stored );

		// v1 compatibility: honour the constants when nothing has been saved.
		if ( '' === $settings['api_url'] && defined( 'AAT_API_URL' ) && AAT_API_URL ) {
			$settings['api_url'] = AAT_API_URL;
		}
		if ( '' === $settings['site_id'] && defined( 'AAT_SITE_ID' ) && AAT_SITE_ID ) {
			$settings['site_id'] = AAT_SITE_ID;
		}

		/**
		 * Filters the resolved plugin settings.
		 *
		 * @param array $settings Settings array.
		 */
		self::$cache = apply_filters( 'bap_settings', $settings );

		return self::$cache;
	}

	/**
	 * Returns a single setting.
	 *
	 * @param string $key      Setting name.
	 * @param mixed  $fallback Value returned when the setting is unset.
	 * @return mixed
	 */
	public static function get( $key, $fallback = null ) {
		$all = self::all();
		return array_key_exists( $key, $all ) ? $all[ $key ] : $fallback;
	}

	/**
	 * Persists a settings array after sanitising it.
	 *
	 * @param array $input Raw input.
	 * @return array Sanitised settings that were stored.
	 */
	public static function save( array $input ) {
		$clean = self::sanitize( $input );
		// Autoloaded on purpose: `all()` runs on every front-end request, so a
		// non-autoloaded option would add a query to every page load. The value
		// is small and contains no secrets — the API key lives elsewhere.
		update_option( self::OPTION_KEY, $clean, true );
		self::$cache = null;
		return $clean;
	}

	/**
	 * Sanitises raw settings input.
	 *
	 * @param array $input Raw input.
	 * @return array
	 */
	public static function sanitize( array $input ) {
		$defaults = self::defaults();
		$current  = get_option( self::OPTION_KEY, array() );
		$current  = is_array( $current ) ? $current : array();
		$clean    = array_merge( $defaults, $current );

		$booleans = array(
			'enabled',
			'track_logged_in',
			'track_admins',
			'require_consent',
			'respect_dnt',
			'anonymize_ip',
			'hash_user_email',
			'woocommerce_enabled',
			'server_side_purchase',
			'track_page_views',
			'track_clicks',
			'track_scroll',
			'track_time',
			'track_forms',
			'track_spa',
			'track_rage_clicks',
			'track_dead_clicks',
			'track_js_errors',
			'track_web_vitals',
			'track_media',
			'track_copy',
			'module_experience',
			'module_funnels',
			'module_journeys',
			'module_ai',
			'ai_enabled',
			'multi_tab_coordination',
			'debug',
		);
		foreach ( $booleans as $key ) {
			$clean[ $key ] = ! empty( $input[ $key ] );
		}

		if ( isset( $input['api_url'] ) ) {
			$url              = esc_url_raw( trim( (string) $input['api_url'] ), array( 'http', 'https' ) );
			$clean['api_url'] = untrailingslashit( $url );
		}

		if ( isset( $input['site_id'] ) ) {
			// Public identifier: conservative charset, mirrors what the
			// collector accepts.
			$clean['site_id'] = preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) $input['site_id'] );
		}

		if ( isset( $input['ingest_key'] ) ) {
			$clean['ingest_key'] = preg_replace( '/[^A-Za-z0-9_\-\.]/', '', (string) $input['ingest_key'] );
		}

		if ( isset( $input['click_capture'] ) ) {
			$clean['click_capture'] = in_array( $input['click_capture'], array( 'interactive', 'all' ), true )
				? $input['click_capture']
				: 'interactive';
		}

		if ( isset( $input['transport_mode'] ) ) {
			$mode                    = in_array( $input['transport_mode'], array( 'proxy', 'direct' ), true )
				? $input['transport_mode']
				: 'proxy';
			$clean['transport_mode'] = $mode;
		}

		if ( isset( $input['ai_provider'] ) ) {
			$clean['ai_provider'] = in_array( $input['ai_provider'], array( 'llama', 'openai_compatible', 'local' ), true )
				? $input['ai_provider']
				: 'llama';
		}

		if ( isset( $input['ai_agent_mode'] ) ) {
			$clean['ai_agent_mode'] = in_array( $input['ai_agent_mode'], array( 'off', 'approval', 'auto' ), true )
				? $input['ai_agent_mode']
				: 'off';
		}

		if ( isset( $input['ga4_property_id'] ) ) {
			// A GA4 property id is digits. Anything else is a measurement id
			// (G-XXXX) pasted into the wrong box, which would fail later with a
			// confusing 400 from Google.
			$clean['ga4_property_id'] = preg_replace( '/[^0-9]/', '', (string) $input['ga4_property_id'] );
		}

		if ( isset( $input['ai_provider_url'] ) ) {
			// A model endpoint is a URL the site owner chooses; it is validated
			// as a URL and nothing more is assumed about it.
			$clean['ai_provider_url'] = esc_url_raw( trim( (string) $input['ai_provider_url'] ), array( 'http', 'https' ) );
		}

		if ( isset( $input['ai_provider_model'] ) ) {
			$clean['ai_provider_model'] = substr( sanitize_text_field( (string) $input['ai_provider_model'] ), 0, 120 );
		}

		if ( isset( $input['ai_autonomy'] ) ) {
			$clean['ai_autonomy'] = in_array( $input['ai_autonomy'], array( 'insights', 'approval', 'safe_auto' ), true )
				? $input['ai_autonomy']
				: 'approval';
		}

		if ( isset( $input['admin_density'] ) ) {
			$clean['admin_density'] = in_array( $input['admin_density'], array( 'comfortable', 'compact' ), true )
				? $input['admin_density']
				: 'comfortable';
		}

		if ( isset( $input['admin_accent'] ) ) {
			$accent = sanitize_hex_color( $input['admin_accent'] );
			$clean['admin_accent'] = $accent ? $accent : '#7c5cff';
		}

		$integers = array(
			'request_timeout_ms'      => array( 1000, 60000 ),
			'max_concurrent_requests' => array( 1, 12 ),
			'max_retry_attempts'      => array( 1, 50 ),
			'max_queue_size'          => array( 50, 20000 ),
			'max_events_per_page'     => array( 10, 5000 ),
			'data_retention_days'     => array( 0, 3650 ),
			'ai_min_confidence'       => array( 50, 100 ),
			// Upper bound matches BAP_Commerce_Agent::HARD_MAX_DISCOUNT. The
			// agent clamps again at execution time; this is only so the settings
			// screen cannot store a value it will then refuse to honour.
			'ai_agent_max_discount'   => array( 1, 40 ),
		);
		foreach ( $integers as $key => $bounds ) {
			if ( ! isset( $input[ $key ] ) ) {
				continue;
			}
			$value         = (int) $input[ $key ];
			$clean[ $key ] = max( $bounds[0], min( $bounds[1], $value ) );
		}

		return $clean;
	}

	/**
	 * Returns the secret collector API key.
	 *
	 * Never send this to a browser. It authenticates the site, not a visitor.
	 * Stored un-autoloaded so it is not pulled into memory on requests that
	 * will never make an outbound call.
	 *
	 * @return string
	 */
	public static function get_api_key() {
		$key = get_option( self::OPTION_SECRET_KEY, '' );

		if ( '' === $key && defined( 'AAT_API_KEY' ) && AAT_API_KEY ) {
			$key = AAT_API_KEY;
		}

		/**
		 * Filters the collector API key, e.g. to source it from an environment
		 * variable or a secrets manager instead of the database.
		 *
		 * @param string $key API key.
		 */
		return (string) apply_filters( 'bap_api_key', $key );
	}

	/**
	 * Stores the secret API key.
	 *
	 * @param string $key API key.
	 * @return void
	 */
	public static function set_api_key( $key ) {
		$key = preg_replace( '/[^\x21-\x7E]/', '', (string) $key );
		update_option( self::OPTION_SECRET_KEY, $key, false );
	}

	/**
	 * Returns the secret used to authenticate ASP.NET -> WordPress AI callbacks.
	 *
	 * @return string
	 */
	public static function get_ai_webhook_secret() {
		return (string) get_option( self::OPTION_AI_WEBHOOK_SECRET, '' );
	}

	/**
	 * Stores the AI callback signing secret.
	 *
	 * @param string $secret Secret.
	 * @return void
	 */
	public static function set_ai_webhook_secret( $secret ) {
		$secret = preg_replace( '/[^A-Za-z0-9_\-.]/', '', (string) $secret );
		update_option( self::OPTION_AI_WEBHOOK_SECRET, $secret, false );
	}

	/**
	 * Returns an existing AI callback secret or creates a strong one.
	 *
	 * @return string
	 */
	public static function ensure_ai_webhook_secret() {
		$secret = self::get_ai_webhook_secret();
		if ( '' === $secret ) {
			$secret = wp_generate_password( 48, false, false );
			self::set_ai_webhook_secret( $secret );
		}
		return $secret;
	}

	/**
	 * Whether the plugin has the minimum configuration needed to send data.
	 *
	 * @return bool
	 */
	public static function is_configured() {
		$settings = self::all();
		return ! empty( $settings['api_url'] ) && ! empty( $settings['site_id'] );
	}

	/**
	 * Builds a collector endpoint URL.
	 *
	 * @param string $path Path relative to the API root, e.g. 'events'.
	 * @return string
	 */
	public static function endpoint( $path ) {
		$base = untrailingslashit( (string) self::get( 'api_url' ) );
		if ( '' === $base ) {
			return '';
		}
		return $base . '/' . ltrim( $path, '/' );
	}

	/**
	 * Clears the in-process cache. Used by tests and after option updates.
	 *
	 * @return void
	 */
	public static function flush_cache() {
		self::$cache = null;
	}
}
