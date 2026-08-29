<?php
/**
 * Settings service (WordPress Options API).
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Owns reading, writing, sanitizing and registering plugin settings.
 *
 * All settings live in a single serialized option to keep the options
 * table lean and the autoload footprint predictable.
 *
 * @since 1.0.0
 */
class Settings {

	/**
	 * Option name in wp_options.
	 *
	 * @var string
	 */
	public const OPTION = 'wpep_settings';

	/**
	 * Settings group used by the Settings API.
	 *
	 * @var string
	 */
	public const GROUP = 'wpep_settings_group';

	/**
	 * Default Jarchi webhook endpoint: deliberately empty.
	 *
	 * Until 1.5.1 this constant carried one customer's production URL, so every
	 * fresh installation of the plugin pointed at that customer's backend until
	 * somebody noticed and changed it. A shipped default that names a customer
	 * is a bug in a product meant to serve many, so there is no default now:
	 * the administrator supplies the URL Jarchi gave them, and the plugin
	 * reports itself as unconfigured until they do.
	 *
	 * @since 1.2.0
	 * @since 1.6.0 Emptied. See the note above.
	 *
	 * @var string
	 */
	public const DEFAULT_ENDPOINT = '';

	/**
	 * Admin language: follow the WordPress locale.
	 *
	 * @since 1.2.1
	 *
	 * @var string
	 */
	public const LOCALE_SITE = 'site';

	/**
	 * Admin language: always Persian.
	 *
	 * @since 1.2.1
	 *
	 * @var string
	 */
	public const LOCALE_FA = 'fa_IR';

	/**
	 * Admin language: always English.
	 *
	 * @since 1.2.1
	 *
	 * @var string
	 */
	public const LOCALE_EN = 'en_US';

	/**
	 * Post type detection: use exactly what the administrator ticked.
	 *
	 * @since 1.3.0
	 *
	 * @var string
	 */
	public const POST_TYPES_MANUAL = 'manual';

	/**
	 * Post type detection: discover public post types automatically.
	 *
	 * @since 1.3.0
	 *
	 * @var string
	 */
	public const POST_TYPES_AUTO = 'auto';

	/**
	 * Post types that never carry an advertisement.
	 *
	 * Attachments, revisions, menu items and the block editor's own
	 * bookkeeping types all move through the same publishing hooks. They
	 * are excluded in every mode, including a manual selection, because
	 * ticking one of them by accident would send a menu item to Telegram.
	 *
	 * @since 1.3.2
	 *
	 * @var string[]
	 */
	public const EXCLUDED_POST_TYPES = array(
		'attachment',
		'revision',
		'nav_menu_item',
		'custom_css',
		'customize_changeset',
		'oembed_cache',
		'user_request',
		'wp_block',
		'wp_template',
		'wp_template_part',
		'wp_global_styles',
		'wp_navigation',
		'wp_font_family',
		'wp_font_face',
		'patterns_ai_data',
		'scheduled-action',
		'action-scheduler-action',
	);

	/**
	 * Dispatch mode: cron first, inline fallback when cron cannot run.
	 *
	 * @var string
	 */
	public const DISPATCH_AUTO = 'auto';

	/**
	 * Dispatch mode: WP-Cron only.
	 *
	 * @var string
	 */
	public const DISPATCH_CRON = 'cron';

	/**
	 * Dispatch mode: deliver at the end of the current request.
	 *
	 * @var string
	 */
	public const DISPATCH_IMMEDIATE = 'immediate';

	/**
	 * Validator dependency.
	 *
	 * @var Validator
	 */
	private Validator $validator;

	/**
	 * Runtime cache of resolved settings.
	 *
	 * @var array<string,mixed>|null
	 */
	private ?array $cache = null;

	/**
	 * Constructor.
	 *
	 * @since 1.0.0
	 *
	 * @param Validator $validator Validator service.
	 */
	public function __construct( Validator $validator ) {
		$this->validator = $validator;
	}

	/**
	 * Returns the default settings.
	 *
	 * @since 1.0.0
	 * @since 1.2.0 Added debug, dispatch, authentication and field mapping defaults.
	 *
	 * @return array<string,mixed> Default settings.
	 */
	public function defaults(): array {
		$defaults = array(
			'node_api_url'          => self::DEFAULT_ENDPOINT,
			'api_secret'            => '',
			'site_id'               => '',
			'enabled'               => true,
			'logging_enabled'       => true,
			'webhooks_enabled'      => true,
			'debug_mode'            => false,
			'webhook_timeout'       => 15,
			'retry_count'           => 3,
			'signature_tolerance'   => 300,
			'allowed_post_types'    => array( 'post' ),
			'allowed_post_statuses' => array( 'publish' ),
			'allowed_event_types'   => array( Event::TYPE_CREATED, Event::TYPE_UPDATED, Event::TYPE_DELETED ),
			'dispatch_mode'         => self::DISPATCH_AUTO,
			// API Key is the default in 1.6.0 (spec 11). HMAC and Bearer stay
			// available for a site already using them, but a new installation
			// gets the simplest scheme that works.
			'auth_style'            => Signer::AUTH_API_KEY,
			'trash_as_deleted'      => false,
			'price_meta_keys'       => '',
			'location_meta_keys'    => '',
			'phone_meta_keys'       => '',
			'image_meta_keys'       => '',
			'description_source'    => 'auto',
			'max_images'            => 10,
			'admin_locale'          => self::LOCALE_FA,
			'post_type_mode'        => self::POST_TYPES_MANUAL,
			'connect_timeout'       => 10,
			'custom_headers'        => '',
			'queue_retention_days'  => 7,
			'platforms'             => $this->platform_defaults(),

			// WooCommerce order notifications. Off by default: a shop that
			// upgrades must not start messaging a channel unasked.
			'orders_enabled'        => false,
			'order_events'          => array( 'order.created', 'order.completed' ),
			'order_platforms'       => array(),
			'order_fields'          => array(),
			'order_min_total'       => '',
		);

		/**
		 * Filters the default plugin settings.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string,mixed> $defaults Default settings.
		 */
		return apply_filters( 'wpep_default_settings', $defaults );
	}

	/**
	 * Returns all settings merged with defaults.
	 *
	 * @since 1.0.0
	 *
	 * @return array<string,mixed> Settings.
	 */
	public function all(): array {
		if ( null !== $this->cache ) {
			return $this->cache;
		}

		$stored = get_option( self::OPTION, array() );

		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$this->cache = wp_parse_args( $stored, $this->defaults() );

		return $this->cache;
	}

	/**
	 * Returns a single setting.
	 *
	 * @since 1.0.0
	 *
	 * @param string $key      Setting key.
	 * @param mixed  $fallback Fallback when the key does not exist.
	 *
	 * @return mixed Setting value.
	 */
	public function get( string $key, mixed $fallback = null ): mixed {
		$all = $this->all();

		return array_key_exists( $key, $all ) ? $all[ $key ] : $fallback;
	}

	/**
	 * Returns the validated webhook endpoint.
	 *
	 * The connection test and real event delivery both resolve the
	 * endpoint through this single method, so a test can never exercise a
	 * different URL than production traffic.
	 *
	 * @since 1.2.0
	 *
	 * @return string Endpoint URL, empty when nothing valid is configured.
	 */
	public function endpoint(): string {
		return $this->validator->validate_url( (string) $this->get( 'node_api_url', '' ) );
	}

	/**
	 * Whether verbose lifecycle logging is switched on.
	 *
	 * @since 1.2.0
	 *
	 * @return bool True when debug mode is active.
	 */
	public function debug(): bool {
		return (bool) $this->get( 'debug_mode', false );
	}

	/**
	 * Returns the post types the event detector is allowed to look at.
	 *
	 * @since 1.2.0
	 *
	 * @return string[] Post type slugs.
	 */
	public function allowed_post_types(): array {
		$types = (array) $this->get( 'allowed_post_types', array() );

		// Automatic discovery: every post type that can hold public
		// content counts, whichever plugin registered it. Manual
		// selections are kept on top, so a private or UI-only type an
		// administrator ticked is never dropped.
		if ( self::POST_TYPES_AUTO === $this->post_type_mode() ) {
			$discovered = get_post_types( array( 'public' => true ), 'names' );

			/**
			 * Filters the automatically discovered post types.
			 *
			 * @since 1.3.0
			 *
			 * @param string[] $discovered Discovered post type slugs.
			 */
			$discovered = (array) apply_filters( 'wpep_discovered_post_types', array_values( $discovered ) );

			$types = array_merge( $types, $discovered );
		}

		/**
		 * Filters the post types events are detected for.
		 *
		 * Useful when the advertisement post type is registered by a theme
		 * or plugin that the administrator cannot configure.
		 *
		 * @since 1.2.0
		 *
		 * @param string[] $types Post type slugs.
		 */
		$types = (array) apply_filters( 'wpep_allowed_post_types', $types );

		$types = array_unique( array_filter( array_map( 'strval', $types ) ) );

		/**
		 * Filters the post types that can never carry an advertisement.
		 *
		 * @since 1.3.2
		 *
		 * @param string[] $excluded Excluded post type slugs.
		 */
		$excluded = (array) apply_filters( 'wpep_excluded_post_types', self::EXCLUDED_POST_TYPES );

		return array_values( array_diff( $types, $excluded ) );
	}

	/**
	 * Returns how advertisement post types are determined.
	 *
	 * @since 1.3.0
	 *
	 * @return string One of the POST_TYPES_* constants.
	 */
	public function post_type_mode(): string {
		$mode = (string) $this->get( 'post_type_mode', self::POST_TYPES_MANUAL );

		return in_array( $mode, array( self::POST_TYPES_MANUAL, self::POST_TYPES_AUTO ), true )
			? $mode
			: self::POST_TYPES_MANUAL;
	}

	/**
	 * Returns the extra request headers configured by the administrator.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Header name to value.
	 */
	public function custom_headers(): array {
		$headers = array();

		foreach ( preg_split( '/[\r\n]+/', (string) $this->get( 'custom_headers', '' ) ) ?: array() as $line ) {
			$line = trim( (string) $line );

			if ( '' === $line || ! str_contains( $line, ':' ) ) {
				continue;
			}

			[ $name, $value ] = explode( ':', $line, 2 );

			$name  = trim( $name );
			$value = trim( $value );

			if ( '' !== $name && '' !== $value ) {
				$headers[ $name ] = $value;
			}
		}

		/**
		 * Filters the extra headers sent with every webhook request.
		 *
		 * @since 1.3.0
		 *
		 * @param array<string,string> $headers Custom headers.
		 */
		return (array) apply_filters( 'wpep_custom_headers', $headers );
	}

	/**
	 * Returns the lifecycle event types that may be dispatched.
	 *
	 * @since 1.2.0
	 *
	 * @return string[] Event types.
	 */
	public function allowed_event_types(): array {
		$types = (array) $this->get(
			'allowed_event_types',
			array( Event::TYPE_CREATED, Event::TYPE_UPDATED, Event::TYPE_DELETED )
		);

		/**
		 * Filters the lifecycle event types that may be dispatched.
		 *
		 * @since 1.2.0
		 *
		 * @param string[] $types Event types.
		 */
		return (array) apply_filters( 'wpep_allowed_event_types', array_values( array_filter( array_map( 'strval', $types ) ) ) );
	}

	/**
	 * Returns the configured dispatch mode.
	 *
	 * @since 1.2.0
	 *
	 * @return string One of the DISPATCH_* constants.
	 */
	public function dispatch_mode(): string {
		$mode = (string) $this->get( 'dispatch_mode', self::DISPATCH_AUTO );

		return in_array( $mode, array( self::DISPATCH_AUTO, self::DISPATCH_CRON, self::DISPATCH_IMMEDIATE ), true )
			? $mode
			: self::DISPATCH_AUTO;
	}

	/**
	 * Returns the locale the plugin's own admin screens are rendered in.
	 *
	 * The plugin ships a Persian translation. Sites whose WordPress locale
	 * is English would otherwise show the plugin in English, so the locale
	 * used for this text domain is configurable and defaults to Persian.
	 *
	 * @since 1.2.1
	 *
	 * @return string One of the LOCALE_* constants.
	 */
	public function admin_locale(): string {
		$locale = (string) $this->get( 'admin_locale', self::LOCALE_FA );

		return in_array( $locale, array( self::LOCALE_SITE, self::LOCALE_FA, self::LOCALE_EN ), true )
			? $locale
			: self::LOCALE_FA;
	}

	/**
	 * Whether the plugin's admin screens should be laid out right to left.
	 *
	 * @since 1.2.1
	 *
	 * @return bool True when the plugin UI is rendered in a RTL language.
	 */
	public function is_rtl_ui(): bool {
		$locale = $this->admin_locale();

		if ( self::LOCALE_FA === $locale ) {
			return true;
		}

		if ( self::LOCALE_EN === $locale ) {
			return false;
		}

		return function_exists( 'is_rtl' ) && is_rtl();
	}

	/**
	 * Whether WP-Cron can be expected to run on this installation.
	 *
	 * @since 1.2.0
	 *
	 * @return bool False when DISABLE_WP_CRON is set.
	 */
	public function cron_available(): bool {
		return ! ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON );
	}

	/**
	 * Returns a meta key list configured as a free text field.
	 *
	 * Accepts comma or newline separated keys so administrators can map
	 * their advertisement fields without writing code.
	 *
	 * @since 1.2.0
	 *
	 * @param string $key Settings key holding the list.
	 *
	 * @return string[] Meta keys in priority order.
	 */
	public function meta_keys( string $key ): array {
		return $this->validator->parse_key_list( (string) $this->get( $key, '' ) );
	}

	/**
	 * Returns the configured site identifier.
	 *
	 * The identifier is what the Node.js service uses to tell tenants
	 * apart, so it must never be empty on the wire. When an installation
	 * has not configured one yet, a stable value derived from the site
	 * address is used instead of a hardcoded constant.
	 *
	 * @since 1.1.0
	 *
	 * @return string Site identifier.
	 */
	public function site_id(): string {
		$site_id = (string) $this->get( 'site_id', '' );

		if ( '' === $site_id ) {
			$site_id = $this->derive_site_id();
		}

		/**
		 * Filters the site identifier sent to the Node.js service.
		 *
		 * @since 1.1.0
		 *
		 * @param string $site_id Site identifier.
		 */
		return (string) apply_filters( 'wpep_site_id', $site_id );
	}

	/**
	 * Derives a stable site identifier from the site address.
	 *
	 * Used as the default for new and upgraded installations; it stays
	 * constant for a given site URL and contains no secret material.
	 *
	 * @since 1.1.0
	 *
	 * @return string Derived identifier, for example `site_3f9a1c22`.
	 */
	public function derive_site_id(): string {
		return 'site_' . substr( md5( home_url() ), 0, 8 );
	}

	/**
	 * Returns the replay tolerance window in seconds.
	 *
	 * WordPress always signs the current time; this value is advertised
	 * to the Node.js service, which enforces the window when it validates
	 * incoming signatures.
	 *
	 * @since 1.1.0
	 *
	 * @return int Tolerance in seconds.
	 */
	public function signature_tolerance(): int {
		return (int) $this->get( 'signature_tolerance', 300 );
	}

	/**
	 * Returns the factory platform configuration: every platform off.
	 *
	 * A new installation publishes nowhere until an administrator says
	 * otherwise (spec 26). That is a deliberate default, not an oversight —
	 * a plugin that started broadcasting to a channel the moment it was
	 * activated would be a worse bug than one that publishes nothing.
	 *
	 * @since 1.6.0
	 *
	 * @return array<string,array<string,mixed>> Platform defaults keyed by platform.
	 */
	public function platform_defaults(): array {
		$defaults = array();

		foreach ( Field::PLATFORMS as $platform ) {
			$entry = array(
				'enabled'        => false,
				'channel_title'  => '',
				'view_button'    => false,
				'view_label'     => '',
				'contact_button' => false,
				'contact_label'  => '',
			);

			if ( Field::PLATFORM_TELEGRAM === $platform ) {
				$entry['channel_id'] = '';
			} elseif ( Field::PLATFORM_BALE === $platform ) {
				$entry['chat_id'] = '';
			} else {
				$entry['recipient']    = '';
				$entry['message_mode'] = 'text';
			}

			$defaults[ $platform ] = $entry;
		}

		return $defaults;
	}

	/**
	 * Returns the site-wide platform configuration, always complete.
	 *
	 * Every platform is present whether or not it was ever configured, so
	 * callers never have to distinguish "off" from "never saved".
	 *
	 * @since 1.6.0
	 *
	 * @return array<string,array<string,mixed>> Platform configuration keyed by platform.
	 */
	public function platforms(): array {
		$stored = $this->get( 'platforms', array() );
		$stored = is_array( $stored ) ? $stored : array();

		$platforms = array();

		foreach ( $this->platform_defaults() as $platform => $defaults ) {
			$entry = isset( $stored[ $platform ] ) && is_array( $stored[ $platform ] )
				? $stored[ $platform ]
				: array();

			$platforms[ $platform ] = wp_parse_args( $entry, $defaults );
		}

		return $platforms;
	}

	/**
	 * Returns the configuration for a single platform.
	 *
	 * @since 1.6.0
	 *
	 * @param string $platform Platform identifier.
	 *
	 * @return array<string,mixed> Platform configuration; empty when unknown.
	 */
	public function platform( string $platform ): array {
		$platforms = $this->platforms();

		return $platforms[ $platform ] ?? array();
	}

	/**
	 * Returns the identifiers of the platforms switched on site-wide.
	 *
	 * @since 1.6.0
	 *
	 * @return string[] Enabled platform identifiers, in display order.
	 */
	public function enabled_platforms(): array {
		$enabled = array();

		foreach ( $this->platforms() as $platform => $config ) {
			if ( ! empty( $config['enabled'] ) ) {
				$enabled[] = $platform;
			}
		}

		return $enabled;
	}

	/**
	 * Persists a full, already-sanitized settings array.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $settings Settings to store.
	 *
	 * @return bool Whether the option was updated.
	 */
	public function save( array $settings ): bool {
		$this->cache = null;

		return update_option( self::OPTION, $this->sanitize( $settings ) );
	}

	/**
	 * Seeds default options on activation without overwriting existing
	 * configuration.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function seed_defaults(): void {
		if ( false === get_option( self::OPTION, false ) ) {
			add_option( self::OPTION, $this->defaults() );
		}
	}

	/**
	 * Registers the setting with the WordPress Settings API.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function register(): void {
		register_setting(
			self::GROUP,
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize' ),
				'default'           => $this->defaults(),
			)
		);
	}

	/**
	 * Sanitizes a raw settings array.
	 *
	 * Used both by the Settings API and by programmatic saves. Every
	 * field is individually validated by the Validator service. Keys
	 * stored by older versions or by integrations are preserved so an
	 * upgrade never silently drops configuration.
	 *
	 * @since 1.0.0
	 *
	 * @param mixed $input Raw input.
	 *
	 * @return array<string,mixed> Sanitized settings.
	 */
	public function sanitize( mixed $input ): array {
		if ( ! is_array( $input ) ) {
			$input = array();
		}

		$current = get_option( self::OPTION, array() );
		if ( ! is_array( $current ) ) {
			$current = array();
		}
		$current = wp_parse_args( $current, $this->defaults() );

		$keep = static function ( string $key, mixed $default ) use ( $input, $current ): mixed {
			if ( array_key_exists( $key, $input ) ) {
				return $input[ $key ];
			}

			return array_key_exists( $key, $current ) ? $current[ $key ] : $default;
		};

		$url_raw = $keep( 'node_api_url', (string) ( $current['node_api_url'] ?? '' ) );
		$url = $this->validator->validate_url( (string) $url_raw );

		if ( ! empty( $input['node_api_url'] ) && '' === $url && function_exists( 'add_settings_error' ) ) {
			add_settings_error(
				self::OPTION,
				'wpep_invalid_url',
				__( 'The webhook URL was rejected: only valid HTTPS URLs are accepted.', 'wp-event-publisher' )
			);
		}

		/*
		 * 1.6.0 removes a number of fields from the settings screen without
		 * removing them from the database (spec 10, 12, 26). A form that no
		 * longer renders a field does not submit it, and every one of these
		 * would otherwise sanitize from a missing key straight back to its
		 * default — silently clearing meta key lists, resetting allowed
		 * statuses and, for the checkboxes, switching the plugin off. So an
		 * absent key means "keep what is stored", and only a key the form
		 * actually submitted can change a value.
		 */


		$clean = array(
			'node_api_url'          => $url,
			'api_secret'            => $this->validator->sanitize_secret( (string) $keep( 'api_secret', '' ) ),
			'site_id'               => $this->validator->sanitize_site_id( (string) $keep( 'site_id', '' ) ),
			'enabled'               => $this->validator->sanitize_bool( $keep( 'enabled', false ) ),
			'logging_enabled'       => $this->validator->sanitize_bool( $keep( 'logging_enabled', false ) ),
			'webhooks_enabled'      => $this->validator->sanitize_bool( $keep( 'webhooks_enabled', false ) ),
			'debug_mode'            => $this->validator->sanitize_bool( $keep( 'debug_mode', false ) ),
			'webhook_timeout'       => $this->validator->sanitize_timeout( $keep( 'webhook_timeout', 15 ) ),
			'retry_count'           => $this->validator->sanitize_retry_count( $keep( 'retry_count', 3 ) ),
			'signature_tolerance'   => $this->validator->sanitize_tolerance( $keep( 'signature_tolerance', 300 ) ),
			'allowed_post_types'    => $this->validator->sanitize_post_types( $keep( 'allowed_post_types', array() ) ),
			'allowed_post_statuses' => $this->validator->sanitize_post_statuses( $keep( 'allowed_post_statuses', array( 'publish' ) ) ),
			'allowed_event_types'   => $this->validator->sanitize_event_types( $keep( 'allowed_event_types', array() ) ),
			'dispatch_mode'         => $this->validator->sanitize_dispatch_mode( $keep( 'dispatch_mode', self::DISPATCH_AUTO ) ),
			'auth_style'            => $this->validator->sanitize_auth_style( $keep( 'auth_style', Signer::AUTH_API_KEY ) ),
			'trash_as_deleted'      => $this->validator->sanitize_bool( $keep( 'trash_as_deleted', false ) ),
			'price_meta_keys'       => $this->validator->sanitize_key_list( (string) $keep( 'price_meta_keys', '' ) ),
			'location_meta_keys'    => $this->validator->sanitize_key_list( (string) $keep( 'location_meta_keys', '' ) ),
			'phone_meta_keys'       => $this->validator->sanitize_key_list( (string) $keep( 'phone_meta_keys', '' ) ),
			'image_meta_keys'       => $this->validator->sanitize_key_list( (string) $keep( 'image_meta_keys', '' ) ),
			'description_source'    => $this->validator->sanitize_description_source( $keep( 'description_source', 'auto' ) ),
			'max_images'            => $this->validator->sanitize_max_images( $keep( 'max_images', 10 ) ),
			'admin_locale'          => $this->validator->sanitize_admin_locale( $keep( 'admin_locale', self::LOCALE_FA ) ),
			'post_type_mode'        => $this->validator->sanitize_post_type_mode( $keep( 'post_type_mode', self::POST_TYPES_MANUAL ) ),
			'connect_timeout'       => $this->validator->sanitize_timeout( $keep( 'connect_timeout', 10 ) ),
			'custom_headers'        => $this->validator->sanitize_headers( (string) $keep( 'custom_headers', '' ) ),
			'queue_retention_days'  => max( 1, min( 90, absint( $keep( 'queue_retention_days', 7 ) ) ) ),
			'orders_enabled'        => $this->validator->sanitize_bool( $keep( 'orders_enabled', false ) ),
			'order_events'          => $this->validator->sanitize_order_events( $keep( 'order_events', array() ) ),
			'order_platforms'       => $this->validator->sanitize_platform_list( $keep( 'order_platforms', array() ) ),
			'order_fields'          => $this->validator->sanitize_order_fields( $keep( 'order_fields', array() ) ),
			'order_min_total'       => $this->validator->sanitize_amount( $keep( 'order_min_total', '' ) ),
			'platforms'             => $this->validator->sanitize_platforms(
				// A form that does not carry the platform block at all — the
				// main Settings screen, or a programmatic save — must not
				// silently switch every platform off, so the stored value is
				// the fallback rather than the defaults.
				array_key_exists( 'platforms', $input ) ? $input['platforms'] : ( $current['platforms'] ?? array() )
			),
		);

		// An empty Site ID falls back to the stored one, then to a value
		// derived from the site address, so the header and payload are
		// never sent blank.
		if ( '' === $clean['site_id'] ) {
			$clean['site_id'] = '' !== (string) $current['site_id'] ? (string) $current['site_id'] : $this->derive_site_id();
		}

		// An empty secret submitted on the form keeps the stored secret so
		// admins do not need to re-enter it on every save.
		if ( '' === $clean['api_secret'] && '' !== (string) $current['api_secret'] ) {
			$clean['api_secret'] = (string) $current['api_secret'];
		}

		// Preserve keys this version does not know about.
		$clean = array_merge( $current, $clean );

		$this->cache = null;

		/**
		 * Filters the sanitized settings before they are persisted.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string,mixed> $clean Sanitized settings.
		 * @param array<string,mixed> $input Raw input.
		 */
		return apply_filters( 'wpep_sanitize_settings', $clean, $input );
	}

	/**
	 * Clears the runtime settings cache.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function flush_cache(): void {
		$this->cache = null;
	}
}
