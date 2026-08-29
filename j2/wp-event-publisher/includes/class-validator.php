<?php
/**
 * Input validation and sanitization service.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Validates and sanitizes every piece of untrusted input the plugin
 * handles: settings, endpoint URLs and numeric ranges.
 *
 * @since 1.0.0
 */
class Validator {

	/**
	 * Minimum allowed webhook timeout in seconds.
	 *
	 * A one or two second budget cannot survive a TLS handshake to a
	 * remote VPS, and the resulting cURL error 28 looks exactly like an
	 * unreachable endpoint. Five seconds is the floor; fifteen is the
	 * default.
	 *
	 * @since 1.2.1 Raised from 1 to 5.
	 *
	 * @var int
	 */
	public const TIMEOUT_MIN = 5;

	/**
	 * Maximum allowed webhook timeout in seconds.
	 *
	 * @var int
	 */
	public const TIMEOUT_MAX = 60;

	/**
	 * Maximum allowed retry count.
	 *
	 * @var int
	 */
	public const RETRY_MAX = 10;

	/**
	 * Minimum allowed signature tolerance in seconds.
	 *
	 * @var int
	 */
	public const TOLERANCE_MIN = 30;

	/**
	 * Maximum allowed signature tolerance in seconds.
	 *
	 * A wide window weakens replay protection, so the upper bound stays
	 * at one hour.
	 *
	 * @var int
	 */
	public const TOLERANCE_MAX = 3600;

	/**
	 * Maximum length of a site identifier.
	 *
	 * @var int
	 */
	public const SITE_ID_MAX = 64;

	/**
	 * Maximum number of images transmitted with one event.
	 *
	 * @var int
	 */
	public const IMAGES_MAX = 30;

	/**
	 * Validates a webhook endpoint URL.
	 *
	 * Only absolute HTTPS URLs are accepted. Plain HTTP is allowed
	 * exclusively for local development hosts (localhost / 127.0.0.1)
	 * and only when the `wpep_allow_insecure_url` filter opts in.
	 *
	 * Requests are additionally kept away from link-local metadata
	 * addresses, so a compromised settings write cannot turn the plugin
	 * into an SSRF probe against cloud metadata services.
	 *
	 * @since 1.0.0
	 *
	 * @param string $url Raw URL.
	 *
	 * @return string Sanitized URL or empty string when invalid.
	 */
	public function validate_url( string $url ): string {
		$url = esc_url_raw( trim( $url ), array( 'https', 'http' ) );

		if ( '' === $url ) {
			return '';
		}

		$parts = wp_parse_url( $url );

		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}

		if ( $this->is_blocked_host( (string) $parts['host'] ) ) {
			return '';
		}

		if ( 'https' === $parts['scheme'] ) {
			return $url;
		}

		$is_local = in_array( $parts['host'], array( 'localhost', '127.0.0.1', '::1' ), true );

		/**
		 * Filters whether a non-HTTPS webhook URL may be used.
		 *
		 * Defaults to true only for local development hosts.
		 *
		 * @since 1.0.0
		 *
		 * @param bool   $allow Whether the insecure URL is allowed.
		 * @param string $url   The URL being validated.
		 */
		$allow_insecure = apply_filters( 'wpep_allow_insecure_url', $is_local, $url );

		return $allow_insecure ? $url : '';
	}

	/**
	 * Whether a host is on the never-call list.
	 *
	 * @since 1.2.0
	 *
	 * @param string $host Host name or IP literal.
	 *
	 * @return bool True when requests to this host must be refused.
	 */
	private function is_blocked_host( string $host ): bool {
		$host = strtolower( trim( $host, '[]' ) );

		// Cloud instance metadata endpoints.
		$blocked = array( '169.254.169.254', 'metadata.google.internal', 'fd00:ec2::254' );

		/**
		 * Filters the hosts the webhook transport refuses to call.
		 *
		 * @since 1.2.0
		 *
		 * @param string[] $blocked Blocked host names / IP literals.
		 */
		$blocked = (array) apply_filters( 'wpep_blocked_hosts', $blocked );

		if ( in_array( $host, array_map( 'strtolower', $blocked ), true ) ) {
			return true;
		}

		// Entire link-local ranges.
		return str_starts_with( $host, '169.254.' ) || str_starts_with( $host, 'fe80:' );
	}

	/**
	 * Sanitizes the shared API secret.
	 *
	 * @since 1.0.0
	 *
	 * @param string $secret Raw secret.
	 *
	 * @return string Sanitized secret.
	 */
	public function sanitize_secret( string $secret ): string {
		// Secrets are opaque tokens: strip control characters and tags only.
		$secret = wp_strip_all_tags( $secret );
		$secret = preg_replace( '/[\x00-\x1F\x7F]/', '', $secret ) ?? '';

		return substr( trim( $secret ), 0, 255 );
	}

	/**
	 * Clamps the webhook timeout to a safe range.
	 *
	 * @since 1.0.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return int Timeout in seconds.
	 */
	public function sanitize_timeout( mixed $value ): int {
		return max( self::TIMEOUT_MIN, min( self::TIMEOUT_MAX, absint( $value ) ) );
	}

	/**
	 * Sanitizes the site identifier.
	 *
	 * Restricted to characters that survive an HTTP header and a JSON
	 * document unescaped: letters, digits, dash, underscore and dot.
	 *
	 * @since 1.1.0
	 *
	 * @param string $site_id Raw identifier.
	 *
	 * @return string Sanitized identifier, empty when nothing usable remained.
	 */
	public function sanitize_site_id( string $site_id ): string {
		$site_id = preg_replace( '/[^A-Za-z0-9._-]/', '', trim( $site_id ) ) ?? '';

		return substr( $site_id, 0, self::SITE_ID_MAX );
	}

	/**
	 * Clamps the signature tolerance to a safe range.
	 *
	 * @since 1.1.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return int Tolerance in seconds.
	 */
	public function sanitize_tolerance( mixed $value ): int {
		return max( self::TOLERANCE_MIN, min( self::TOLERANCE_MAX, absint( $value ) ) );
	}

	/**
	 * Clamps the retry count to a safe range.
	 *
	 * @since 1.0.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return int Retry count.
	 */
	public function sanitize_retry_count( mixed $value ): int {
		return min( self::RETRY_MAX, absint( $value ) );
	}

	/**
	 * Returns every post type an administrator may pick.
	 *
	 * Advertisement post types are frequently registered without
	 * `public => true` (for example listings that are only rendered
	 * through a shortcode or a custom template), so restricting the list
	 * to public types silently hides the very post type this plugin
	 * exists for. Anything with an editing UI, plus every non-built-in
	 * type, is offered instead.
	 *
	 * @since 1.2.0
	 *
	 * @return array<string,\WP_Post_Type> Map of slug to post type object.
	 */
	public function selectable_post_types(): array {
		$types = get_post_types( array(), 'objects' );
		$clean = array();

		foreach ( $types as $slug => $type ) {
			if ( in_array( $slug, array( 'revision', 'nav_menu_item', 'custom_css', 'customize_changeset', 'oembed_cache', 'user_request', 'wp_block', 'wp_template', 'wp_template_part', 'wp_global_styles', 'wp_navigation', 'wp_font_family', 'wp_font_face', 'patterns_ai_data' ), true ) ) {
				continue;
			}

			if ( empty( $type->show_ui ) && empty( $type->public ) && ! empty( $type->_builtin ) ) {
				continue;
			}

			$clean[ $slug ] = $type;
		}

		/**
		 * Filters the post types offered on the settings screen.
		 *
		 * @since 1.2.0
		 *
		 * @param array<string,\WP_Post_Type> $clean Selectable post types.
		 * @param array<string,\WP_Post_Type> $types All registered post types.
		 */
		return (array) apply_filters( 'wpep_selectable_post_types', $clean, $types );
	}

	/**
	 * Sanitizes a list of post type slugs.
	 *
	 * A slug that is not registered at save time is kept rather than
	 * discarded: post types provided by a theme or plugin are frequently
	 * registered after the options screen has been processed, and
	 * dropping them would silently disable event detection for exactly
	 * the post type the administrator just selected.
	 *
	 * @since 1.0.0
	 * @since 1.2.0 Unregistered but syntactically valid slugs are preserved.
	 *
	 * @param mixed $value Raw value (expected array of slugs).
	 *
	 * @return string[] Post type slugs.
	 */
	public function sanitize_post_types( mixed $value ): array {
		if ( is_string( $value ) ) {
			$value = $this->parse_key_list( $value );
		}

		if ( ! is_array( $value ) ) {
			return array();
		}

		$clean = array();

		foreach ( $value as $slug ) {
			$slug = sanitize_key( (string) $slug );

			if ( '' === $slug ) {
				continue;
			}

			$clean[] = $slug;
		}

		return array_values( array_unique( $clean ) );
	}

	/**
	 * Sanitizes a list of post statuses against registered statuses.
	 *
	 * @since 1.0.0
	 *
	 * @param mixed $value Raw value (expected array of statuses).
	 *
	 * @return string[] Valid post status slugs.
	 */
	public function sanitize_post_statuses( mixed $value ): array {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$registered = get_post_stati();

		$clean = array();
		foreach ( $value as $status ) {
			$status = sanitize_key( (string) $status );
			if ( isset( $registered[ $status ] ) ) {
				$clean[] = $status;
			}
		}

		return array_values( array_unique( $clean ) );
	}

	/**
	 * Sanitizes the selected lifecycle event types.
	 *
	 * @since 1.2.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return string[] Event types.
	 */
	public function sanitize_event_types( mixed $value ): array {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$known = array( Event::TYPE_CREATED, Event::TYPE_UPDATED, Event::TYPE_DELETED );

		$clean = array();
		foreach ( $value as $type ) {
			$type = sanitize_key( (string) $type );
			if ( in_array( $type, $known, true ) ) {
				$clean[] = $type;
			}
		}

		return array_values( array_unique( $clean ) );
	}

	/**
	 * Sanitizes the dispatch mode.
	 *
	 * @since 1.2.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return string Dispatch mode.
	 */
	public function sanitize_dispatch_mode( mixed $value ): string {
		$value = sanitize_key( (string) $value );

		$allowed = array( Settings::DISPATCH_AUTO, Settings::DISPATCH_CRON, Settings::DISPATCH_IMMEDIATE );

		return in_array( $value, $allowed, true ) ? $value : Settings::DISPATCH_AUTO;
	}

	/**
	 * Sanitizes the authentication style.
	 *
	 * @since 1.2.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return string Authentication style.
	 */
	public function sanitize_auth_style( mixed $value ): string {
		$value = sanitize_key( (string) $value );

		return in_array( $value, Signer::AUTH_STYLES, true ) ? $value : Signer::AUTH_ALL;
	}

	/**
	 * Sanitizes the post type detection mode.
	 *
	 * @since 1.3.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return string One of the Settings POST_TYPES_* constants.
	 */
	public function sanitize_post_type_mode( mixed $value ): string {
		$value = sanitize_key( (string) $value );

		return in_array( $value, array( Settings::POST_TYPES_MANUAL, Settings::POST_TYPES_AUTO ), true )
			? $value
			: Settings::POST_TYPES_MANUAL;
	}

	/**
	 * Sanitizes free-form request headers.
	 *
	 * Header names and values are restricted to characters that are legal
	 * in an HTTP header, and anything resembling a header injection —
	 * embedded newlines, control characters — cannot survive.
	 *
	 * @since 1.3.0
	 *
	 * @param string $value Raw textarea value, one `Name: value` per line.
	 *
	 * @return string Sanitized header block.
	 */
	public function sanitize_headers( string $value ): string {
		$clean = array();

		foreach ( preg_split( '/[\r\n]+/', $value ) ?: array() as $line ) {
			$line = trim( (string) $line );

			if ( '' === $line || ! str_contains( $line, ':' ) ) {
				continue;
			}

			[ $name, $header_value ] = explode( ':', $line, 2 );

			$name         = preg_replace( '/[^A-Za-z0-9\-_]/', '', trim( $name ) ) ?? '';
			$header_value = preg_replace( '/[\x00-\x1F\x7F]/', '', trim( $header_value ) ) ?? '';

			if ( '' === $name || '' === $header_value ) {
				continue;
			}

			$clean[] = substr( $name, 0, 128 ) . ': ' . substr( $header_value, 0, 512 );
		}

		return implode( "\n", array_slice( $clean, 0, 20 ) );
	}

	/**
	 * Sanitizes the admin language selector.
	 *
	 * @since 1.2.1
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return string One of the Settings LOCALE_* constants.
	 */
	public function sanitize_admin_locale( mixed $value ): string {
		$value = (string) $value;

		$allowed = array( Settings::LOCALE_SITE, Settings::LOCALE_FA, Settings::LOCALE_EN );

		return in_array( $value, $allowed, true ) ? $value : Settings::LOCALE_FA;
	}

	/**
	 * Sanitizes the description source selector.
	 *
	 * @since 1.2.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return string One of `auto`, `excerpt`, `content`.
	 */
	public function sanitize_description_source( mixed $value ): string {
		$value = sanitize_key( (string) $value );

		return in_array( $value, array( 'auto', 'excerpt', 'content' ), true ) ? $value : 'auto';
	}

	/**
	 * Clamps the maximum number of transmitted images.
	 *
	 * @since 1.2.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return int Image limit.
	 */
	public function sanitize_max_images( mixed $value ): int {
		return max( 0, min( self::IMAGES_MAX, absint( $value ) ) );
	}

	/**
	 * Sanitizes a free text list of meta keys into a stored string.
	 *
	 * @since 1.2.0
	 *
	 * @param string $value Raw textarea value.
	 *
	 * @return string Newline separated, sanitized key list.
	 */
	public function sanitize_key_list( string $value ): string {
		return implode( "\n", $this->parse_key_list( $value ) );
	}

	/**
	 * Parses a comma or newline separated key list.
	 *
	 * Meta keys may legitimately start with an underscore (protected
	 * meta such as WooCommerce's `_price`), so the underscore prefix is
	 * preserved.
	 *
	 * @since 1.2.0
	 *
	 * @param string $value Raw list.
	 *
	 * @return string[] Parsed keys, order preserved.
	 */
	public function parse_key_list( string $value ): array {
		$parts = preg_split( '/[\r\n,]+/', $value ) ?: array();

		$keys = array();

		foreach ( $parts as $part ) {
			$part = trim( (string) $part );

			if ( '' === $part ) {
				continue;
			}

			$part = preg_replace( '/[^A-Za-z0-9_\-.:]/', '', $part ) ?? '';

			if ( '' === $part ) {
				continue;
			}

			$keys[] = substr( $part, 0, 255 );
		}

		return array_values( array_unique( $keys ) );
	}

	/**
	 * Normalizes a checkbox value into a strict boolean.
	 *
	 * @since 1.0.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return bool Boolean value.
	 */
	public function sanitize_bool( mixed $value ): bool {
		return rest_sanitize_boolean( $value );
	}

	/**
	 * Sanitizes the per-platform publication configuration.
	 *
	 * What WordPress is allowed to know about a platform is deliberately
	 * narrow: whether the site publishes there, which channel to publish to,
	 * and what the buttons should say. Bot tokens, Meta secrets and backend
	 * master keys are *not* in this list and must never be, because the
	 * architecture is WordPress → Jarchi backend → platform: only the backend
	 * holds credentials. Any key not named below is dropped rather than
	 * stored, so a stray token posted to this form is discarded instead of
	 * being written to the options table.
	 *
	 * @since 1.6.0
	 *
	 * @param mixed $value Raw platform configuration.
	 *
	 * @return array<string,array<string,mixed>> Sanitized configuration keyed by platform.
	 */
	public function sanitize_platforms( mixed $value ): array {
		$input = is_array( $value ) ? $value : array();
		$clean = array();

		foreach ( Field::PLATFORMS as $platform ) {
			$raw = isset( $input[ $platform ] ) && is_array( $input[ $platform ] ) ? $input[ $platform ] : array();

			$entry = array(
				'enabled'        => $this->sanitize_bool( $raw['enabled'] ?? false ),
				'channel_title'  => $this->sanitize_platform_text( $raw['channel_title'] ?? '' ),
				'view_button'    => $this->sanitize_bool( $raw['view_button'] ?? false ),
				'view_label'     => $this->sanitize_platform_text( $raw['view_label'] ?? '' ),
				'contact_button' => $this->sanitize_bool( $raw['contact_button'] ?? false ),
				'contact_label'  => $this->sanitize_platform_text( $raw['contact_label'] ?? '' ),
			);

			// Each platform addresses its destination differently, so only the
			// key that platform actually uses is stored.
			if ( Field::PLATFORM_TELEGRAM === $platform ) {
				$entry['channel_id'] = $this->sanitize_channel_address( $raw['channel_id'] ?? '' );
			} elseif ( Field::PLATFORM_BALE === $platform ) {
				$entry['chat_id'] = $this->sanitize_channel_address( $raw['chat_id'] ?? '' );
			} else {
				$entry['recipient']    = $this->sanitize_channel_address( $raw['recipient'] ?? '' );
				$entry['message_mode'] = in_array( $raw['message_mode'] ?? '', array( 'text', 'media' ), true )
					? (string) $raw['message_mode']
					: 'text';
			}

			$clean[ $platform ] = $entry;
		}

		return $clean;
	}

	/**
	 * Sanitizes a short piece of administrator-authored platform text.
	 *
	 * Button labels and channel names are display strings that reach a
	 * message body, so tags are stripped rather than escaped: there is no
	 * markup that would be meaningful at the destination, and storing raw
	 * markup would only create an escaping obligation everywhere it is read.
	 *
	 * @since 1.6.0
	 *
	 * @param mixed $value Raw text.
	 *
	 * @return string Sanitized text, capped at a sane length.
	 */
	private function sanitize_platform_text( mixed $value ): string {
		$text = sanitize_text_field( (string) $value );

		return mb_substr( $text, 0, 120 );
	}

	/**
	 * Sanitizes a client-side channel address.
	 *
	 * A Telegram channel ID, a Bale chat ID or a WhatsApp recipient are
	 * addresses, not secrets — the backend needs them to know where to post.
	 * They are still constrained to the characters those addresses can
	 * actually contain, so this field cannot be used to smuggle markup or a
	 * URL into the payload.
	 *
	 * @since 1.6.0
	 *
	 * @param mixed $value Raw address.
	 *
	 * @return string Sanitized address.
	 */
	private function sanitize_channel_address( mixed $value ): string {
		$text = sanitize_text_field( (string) $value );
		$text = preg_replace( '/[^A-Za-z0-9_@\-\+\.]/', '', $text ) ?? '';

		return mb_substr( $text, 0, 100 );
	}

	/**
	 * Sanitizes the selected WooCommerce order events.
	 *
	 * Filtered against the known event list rather than merely cleaned, so a
	 * crafted form cannot register an event code the plugin will later try to
	 * match and never find.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $value Raw selection.
	 *
	 * @return string[] Known event codes.
	 */
	public function sanitize_order_events( mixed $value ): array {
		$input = is_array( $value ) ? $value : array();
		$known = array_keys( WooCommerceOrders::event_types() );

		return array_values( array_intersect( array_map( 'strval', $input ), $known ) );
	}

	/**
	 * Sanitizes a list of platform identifiers.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $value Raw list.
	 *
	 * @return string[] Known platform identifiers.
	 */
	public function sanitize_platform_list( mixed $value ): array {
		$input = is_array( $value ) ? $value : array();

		return array_values( array_intersect( array_map( 'strval', $input ), Field::PLATFORMS ) );
	}

	/**
	 * Sanitizes a monetary threshold.
	 *
	 * Persian and Arabic-Indic digits are accepted, because an administrator
	 * typing a threshold on a Persian keyboard should not have to switch.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $value Raw amount.
	 *
	 * @return string Decimal string, or an empty string when unset.
	 */
	public function sanitize_amount( mixed $value ): string {
		$text = trim( (string) $value );

		if ( '' === $text ) {
			return '';
		}

		$text = strtr(
			$text,
			array(
				'۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
				'۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
				'٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
				'٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
			)
		);

		// A negative amount is rejected rather than stripped of its sign.
		// Dropping the minus turns "-500" into a 500 threshold, which silently
		// blocks every order under 500 — the opposite of what was typed.
		$negative = str_starts_with( ltrim( $text ), '-' );

		$text = preg_replace( '/[^0-9.]/', '', $text ) ?? '';

		if ( '' === $text || $negative ) {
			return '';
		}

		return (string) (float) $text;
	}

	/**
	 * Sanitizes the WooCommerce order field mapping.
	 *
	 * Built from the known field list rather than from the submitted keys, so
	 * the stored mapping cannot be widened by extra form fields.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $value Raw mapping.
	 *
	 * @return array<string,array<string,mixed>> Sanitized mapping.
	 */
	public function sanitize_order_fields( mixed $value ): array {
		$input = is_array( $value ) ? $value : array();

		if ( empty( $input ) ) {
			return array();
		}

		$labels = WooCommerceOrders::field_labels();
		$clean  = array();

		foreach ( $labels as $key => $default_label ) {
			$entry = isset( $input[ $key ] ) && is_array( $input[ $key ] ) ? $input[ $key ] : array();

			$platforms = array();

			foreach ( Field::PLATFORMS as $platform ) {
				$platforms[ $platform ] = ! empty( $entry['platforms'][ $platform ] );
			}

			$clean[ $key ] = array(
				'enabled'   => ! empty( $entry['enabled'] ),
				'label'     => mb_substr( sanitize_text_field( (string) ( $entry['label'] ?? $default_label ) ), 0, 120 ),
				'order'     => max( 0, min( 999, absint( $entry['order'] ?? 0 ) ) ),
				'platforms' => $platforms,
			);
		}

		return $clean;
	}

	/**
	 * Validates the current configuration and returns human readable
	 * problems.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $settings Settings to validate.
	 *
	 * @return string[] List of validation error messages; empty when valid.
	 */
	public function validate_configuration( array $settings ): array {
		$errors = array();

		if ( empty( $settings['node_api_url'] ) ) {
			$errors[] = __( 'The webhook URL is empty.', 'wp-event-publisher' );
		} elseif ( '' === $this->validate_url( (string) $settings['node_api_url'] ) ) {
			$errors[] = __( 'The webhook URL is invalid. Only HTTPS URLs are accepted.', 'wp-event-publisher' );
		}

		if ( empty( $settings['api_secret'] ) ) {
			$errors[] = __( 'The API secret is empty, so the request carries no authentication.', 'wp-event-publisher' );
		} elseif ( strlen( (string) $settings['api_secret'] ) < 16 ) {
			$errors[] = __( 'The API secret is shorter than 16 characters. Use a long random token.', 'wp-event-publisher' );
		}

		if ( empty( $settings['site_id'] ) ) {
			$errors[] = __( 'No Site ID is configured. A value derived from the site address is being sent instead.', 'wp-event-publisher' );
		}

		if ( empty( $settings['allowed_post_types'] ) ) {
			$errors[] = __( 'No post types are selected. No events will ever be published.', 'wp-event-publisher' );
		} else {
			$registered = get_post_types();

			foreach ( (array) $settings['allowed_post_types'] as $type ) {
				if ( ! isset( $registered[ (string) $type ] ) ) {
					$errors[] = sprintf(
						/* translators: %s: post type slug. */
						__( 'The selected post type "%s" is not registered on this site. Check the slug.', 'wp-event-publisher' ),
						(string) $type
					);
				}
			}
		}

		if ( empty( $settings['allowed_post_statuses'] ) ) {
			$errors[] = __( 'No post statuses are selected. Publishing will never be detected.', 'wp-event-publisher' );
		}

		if ( empty( $settings['allowed_event_types'] ) ) {
			$errors[] = __( 'No event types are enabled. Detected events would be discarded.', 'wp-event-publisher' );
		}

		if ( empty( $settings['enabled'] ) ) {
			$errors[] = __( 'The plugin is disabled in Settings, so publishing an advertisement creates no event.', 'wp-event-publisher' );
		}

		if ( empty( $settings['webhooks_enabled'] ) ) {
			$errors[] = __( 'Webhooks are disabled in Settings.', 'wp-event-publisher' );
		}

		$timeout = (int) ( $settings['webhook_timeout'] ?? 0 );

		if ( $timeout > 0 && $timeout < 10 ) {
			$errors[] = sprintf(
				/* translators: %d: configured timeout in seconds. */
				__( 'The webhook timeout is only %d seconds. A TLS handshake to a remote server can take longer than that, which produces "cURL error 28: Operation timed out" even though the endpoint is healthy. Use 15 seconds.', 'wp-event-publisher' ),
				$timeout
			);
		}

		if ( Settings::DISPATCH_CRON === (string) ( $settings['dispatch_mode'] ?? Settings::DISPATCH_AUTO )
			&& defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ) {
			$errors[] = __( 'Dispatch mode is set to WP-Cron only but DISABLE_WP_CRON is defined. Use Automatic or Immediate, or run wp-cron.php from a system cron job.', 'wp-event-publisher' );
		}

		/**
		 * Filters the configuration validation result.
		 *
		 * @since 1.0.0
		 *
		 * @param string[]            $errors   Validation error messages.
		 * @param array<string,mixed> $settings Settings being validated.
		 */
		return apply_filters( 'wpep_validate_configuration', $errors, $settings );
	}
}
