<?php
/**
 * Validation and normalisation of inbound events.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Everything a browser sends is untrusted input.
 *
 * This class is the single choke point where that input becomes a well-formed
 * event: identifiers are format-checked, `site_id` is replaced with the
 * server's own value, authenticated identity is overwritten with what the
 * server resolved, timestamps are format-checked, and payloads are
 * size-bounded.
 *
 * v3 validates one event per request. The batch validator is gone with the
 * batch itself — see `sanitize_timestamp()` for the one rule that changed
 * meaning rather than merely moving.
 */
class BAP_Event_Validator {

	const MAX_DATA_BYTES    = 32768;
	const MAX_STRING_LENGTH = 2048;
	const MAX_DATA_DEPTH    = 6;

	/**
	 * Event types the plugin knows about.
	 *
	 * @return string[]
	 */
	public static function allowed_types() {
		$types = array(
			// v1 types, preserved for compatibility.
			'page_view',
			'click',
			'search',
			'time_spent',
			// v2 core. `session_start` and `session_end` are gone in v3 — the
			// tracker no longer models sessions, and accepting the types would
			// invite a stale bundle to keep writing them.
			'scroll',
			'outbound_click',
			'file_download',
			'form_view',
			'form_start',
			'form_submit',
			'login',
			'signup',
			'identify',
			// WooCommerce.
			'view_item',
			'view_item_list',
			'add_to_cart',
			'remove_from_cart',
			'view_cart',
			'begin_checkout',
			'add_payment_info',
			'purchase',
			'refund',
			// v4 experience intelligence.
			'rage_click',
			'dead_click',
			'js_error',
			'web_vital',
			'media_engagement',
			'copy',
		);

		/**
		 * Filters the accepted event types.
		 *
		 * @param string[] $types Allowed event types.
		 */
		return apply_filters( 'bap_allowed_event_types', $types );
	}

	/**
	 * Whether a type is acceptable.
	 *
	 * Custom events are allowed under a `custom.` prefix so integrators are not
	 * forced to patch the allowlist, while unknown bare names stay rejected.
	 *
	 * @param mixed $type Candidate type.
	 * @return bool
	 */
	public static function is_allowed_type( $type ) {
		if ( ! is_string( $type ) || '' === $type ) {
			return false;
		}
		if ( in_array( $type, self::allowed_types(), true ) ) {
			return true;
		}
		return (bool) preg_match( '/^custom\.[a-z0-9_]{1,48}$/', $type );
	}

	/**
	 * Validates and normalises one event.
	 *
	 * @param mixed $raw     Raw event.
	 * @param array $context Server-resolved values.
	 * @return array Normalised event, or an array carrying `__error`.
	 */
	public static function validate_event( $raw, array $context ) {
		if ( ! is_array( $raw ) ) {
			return array( '__error' => 'not_an_object' );
		}

		$event_id = self::sanitize_id( isset( $raw['event_id'] ) ? $raw['event_id'] : '', 'evt' );
		if ( '' === $event_id ) {
			return array( '__error' => 'invalid_event_id' );
		}

		$type = isset( $raw['event_type'] ) ? $raw['event_type'] : ( isset( $raw['type'] ) ? $raw['type'] : '' );
		if ( ! self::is_allowed_type( $type ) ) {
			return array(
				'__error'    => 'unknown_event_type',
				'__event_id' => $event_id,
			);
		}

		$raw_identity = isset( $raw['identity'] ) && is_array( $raw['identity'] ) ? $raw['identity'] : array();
		$anonymous_id = isset( $raw_identity['anonymous_id'] ) ? $raw_identity['anonymous_id'] : '';
		if ( ! BAP_Identity::is_valid_anonymous_id( $anonymous_id ) ) {
			return array(
				'__error'    => 'invalid_anonymous_id',
				'__event_id' => $event_id,
			);
		}

		$page_view_id = self::sanitize_id( isset( $raw['page_view_id'] ) ? $raw['page_view_id'] : '', 'pv' );
		if ( '' === $page_view_id ) {
			return array(
				'__error'    => 'invalid_page_view_id',
				'__event_id' => $event_id,
			);
		}

		// Identity: the anonymous id is the client's to choose; the
		// authenticated ids are not. They come from the server, always.
		$identity = array( 'anonymous_id' => $anonymous_id );
		if ( ! empty( $context['wp_user_id'] ) ) {
			$identity['wp_user_id'] = (int) $context['wp_user_id'];
			if ( ! empty( $context['woocommerce_customer_id'] ) ) {
				$identity['woocommerce_customer_id'] = (int) $context['woocommerce_customer_id'];
			}
		}

		$page          = isset( $raw['page'] ) && is_array( $raw['page'] ) ? $raw['page'] : array();
		$context_block = isset( $raw['context'] ) && is_array( $raw['context'] ) ? $raw['context'] : array();

		$event = array(
			'schema_version'   => BAP_SCHEMA_VERSION,
			'event_id'         => $event_id,
			// Never taken from the client: a site may only write its own data.
			'site_id'          => (string) $context['site_id'],
			'page_view_id'     => $page_view_id,
			'identity'         => $identity,
			'event_type'       => $type,
			'timestamp_client' => self::sanitize_timestamp(
				isset( $raw['timestamp_client'] ) ? $raw['timestamp_client'] : ( isset( $raw['timestamp'] ) ? $raw['timestamp'] : '' )
			),
			'timestamp_server' => gmdate( 'Y-m-d\TH:i:s.v\Z' ),
			'origin'           => isset( $context['origin'] ) ? $context['origin'] : 'browser',
			'page'             => array(
				'url'      => self::sanitize_url( isset( $page['url'] ) ? $page['url'] : ( isset( $raw['url'] ) ? $raw['url'] : '' ) ),
				'path'     => self::sanitize_string( isset( $page['path'] ) ? $page['path'] : '', 512 ),
				'title'    => self::sanitize_string( isset( $page['title'] ) ? $page['title'] : ( isset( $raw['title'] ) ? $raw['title'] : '' ), 300 ),
				'referrer' => self::sanitize_url( isset( $page['referrer'] ) ? $page['referrer'] : ( isset( $raw['referrer'] ) ? $raw['referrer'] : '' ) ),
			),
			'context'          => self::sanitize_context( $context_block, $context ),
			'consent'          => self::sanitize_consent( isset( $raw['consent'] ) ? $raw['consent'] : null ),
			'data'             => self::sanitize_data( isset( $raw['data'] ) ? $raw['data'] : array() ),
		);

		if ( isset( $raw['attribution'] ) && is_array( $raw['attribution'] ) ) {
			$event['attribution'] = self::sanitize_data( $raw['attribution'] );
		}

		/**
		 * Filters a validated inbound event before it is forwarded.
		 *
		 * @param array $event Normalised event.
		 * @param array $raw   Original client payload.
		 */
		return apply_filters( 'bap_validated_event', $event, $raw );
	}

	/**
	 * Validates a prefixed identifier.
	 *
	 * @param mixed  $value  Candidate.
	 * @param string $prefix Required prefix.
	 * @return string Empty string when invalid.
	 */
	public static function sanitize_id( $value, $prefix ) {
		if ( ! is_string( $value ) ) {
			return '';
		}
		$pattern = '/^' . preg_quote( $prefix, '/' ) . '_[A-Za-z0-9_\-]{8,120}$/';
		return preg_match( $pattern, $value ) ? $value : '';
	}

	/**
	 * Normalises a client timestamp.
	 *
	 * Format is enforced; the *value* is not second-guessed. v2 replaced any
	 * timestamp more than a day from server time with `now`, on the theory that
	 * client clocks are unreliable. With a durable outbox that theory became
	 * wrong: an event queued offline legitimately arrives hours or days after it
	 * happened, and rewriting it to arrival time destroyed the one field that
	 * recorded when the visitor actually did the thing.
	 *
	 * `timestamp_server` is stamped alongside and is authoritative for
	 * time-series work, so a skewed or forged client clock misreports only
	 * itself. Trading a real signal for protection against a fabrication the
	 * server already sees through was a bad bargain.
	 *
	 * @param mixed $value Candidate timestamp.
	 * @return string ISO-8601 UTC.
	 */
	public static function sanitize_timestamp( $value ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return gmdate( 'Y-m-d\TH:i:s.v\Z' );
		}
		$parsed = strtotime( $value );
		if ( false === $parsed ) {
			return gmdate( 'Y-m-d\TH:i:s.v\Z' );
		}
		return gmdate( 'Y-m-d\TH:i:s.v\Z', $parsed );
	}

	/**
	 * Sanitises a URL field.
	 *
	 * @param mixed $value Candidate URL.
	 * @return string
	 */
	public static function sanitize_url( $value ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return '';
		}
		$url = esc_url_raw( $value, array( 'http', 'https' ) );
		return substr( (string) $url, 0, self::MAX_STRING_LENGTH );
	}

	/**
	 * Sanitises a free-text field.
	 *
	 * @param mixed $value  Candidate.
	 * @param int   $length Maximum length.
	 * @return string
	 */
	public static function sanitize_string( $value, $length = self::MAX_STRING_LENGTH ) {
		if ( is_bool( $value ) ) {
			return $value ? '1' : '';
		}
		if ( ! is_scalar( $value ) ) {
			return '';
		}
		$clean = sanitize_text_field( (string) $value );
		return substr( $clean, 0, $length );
	}

	/**
	 * Sanitises the device/environment block.
	 *
	 * @param array $block   Client-supplied context.
	 * @param array $context Server-resolved values.
	 * @return array
	 */
	private static function sanitize_context( array $block, array $context ) {
		$allowed_ints    = array(
			'screen_width',
			'screen_height',
			'viewport_width',
			'viewport_height',
			'timezone_offset_minutes',
		);
		$allowed_strings = array(
			'library',
			'library_version',
			'device_type',
			'browser',
			'browser_version',
			'operating_system',
			'language',
			'timezone',
			'screen_resolution',
			'viewport_size',
		);

		$clean = array();
		foreach ( $allowed_strings as $key ) {
			if ( isset( $block[ $key ] ) ) {
				$clean[ $key ] = self::sanitize_string( $block[ $key ], 120 );
			}
		}
		foreach ( $allowed_ints as $key ) {
			if ( isset( $block[ $key ] ) ) {
				$clean[ $key ] = (int) $block[ $key ];
			}
		}

		// Server-derived, never client-supplied.
		if ( ! empty( $context['ip'] ) ) {
			$clean['ip'] = $context['ip'];
		}

		return $clean;
	}

	/**
	 * Sanitises the consent block.
	 *
	 * @param mixed $value Candidate.
	 * @return array
	 */
	private static function sanitize_consent( $value ) {
		$server = BAP_Consent::payload();
		if ( ! is_array( $value ) ) {
			return $server;
		}
		return array(
			// A client may withhold consent it holds, but cannot grant consent
			// the server-side state denies.
			'analytics'       => ! empty( $value['analytics'] ) && $server['analytics'],
			'marketing'       => ! empty( $value['marketing'] ) && $server['marketing'],
			'personalization' => ! empty( $value['personalization'] ) && $server['personalization'],
		);
	}

	/**
	 * Recursively sanitises the free-form `data` block.
	 *
	 * @param mixed $data  Candidate data.
	 * @param int   $depth Current depth.
	 * @return array
	 */
	public static function sanitize_data( $data, $depth = 0 ) {
		if ( ! is_array( $data ) ) {
			return array();
		}
		if ( $depth >= self::MAX_DATA_DEPTH ) {
			return array();
		}

		$clean = array();
		foreach ( $data as $key => $value ) {
			$safe_key = is_string( $key )
				? substr( preg_replace( '/[^A-Za-z0-9_\-\.]/', '', $key ), 0, 64 )
				: (string) (int) $key;
			if ( '' === $safe_key ) {
				continue;
			}

			if ( is_array( $value ) ) {
				$clean[ $safe_key ] = self::sanitize_data( $value, $depth + 1 );
			} elseif ( is_bool( $value ) ) {
				$clean[ $safe_key ] = $value;
			} elseif ( is_int( $value ) || is_float( $value ) ) {
				$clean[ $safe_key ] = $value;
			} elseif ( is_string( $value ) ) {
				$clean[ $safe_key ] = self::sanitize_string( $value );
			} elseif ( null === $value ) {
				$clean[ $safe_key ] = null;
			}
		}

		if ( 0 === $depth ) {
			$encoded = wp_json_encode( $clean );
			if ( is_string( $encoded ) && strlen( $encoded ) > self::MAX_DATA_BYTES ) {
				return array(
					'__truncated' => true,
					'__bytes'     => strlen( $encoded ),
				);
			}
		}

		return $clean;
	}
}
