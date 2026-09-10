<?php
/**
 * Bounded, redacting debug log.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Records what the plugin did, so a developer can see why an event did or did
 * not go out.
 *
 * Two properties matter more than convenience here.
 *
 * It cannot grow without bound. Entries are held in a single option capped at
 * `MAX_ENTRIES`, oldest discarded first — an analytics plugin that fills
 * `wp_options` is worse than one with no logging at all.
 *
 * It cannot leak secrets. Every value passes through `redact()` before it is
 * stored, so an API key or identity token that reaches the logger by accident
 * is replaced rather than written down. The log is meant to be pasted into a
 * support ticket.
 */
class BAP_Debug_Log {

	const OPTION      = 'bap_debug_log';
	const MAX_ENTRIES = 200;
	const MAX_VALUE   = 500;

	/**
	 * Context keys whose values are never stored.
	 *
	 * @var string[]
	 */
	private static $secret_keys = array(
		'api_key',
		'apikey',
		'key',
		'secret',
		'token',
		'identity_token',
		'ingest_key',
		'password',
		'pwd',
		'auth',
		'authorization',
		'nonce',
		'email',
		'user_email',
	);

	/**
	 * Whether logging is switched on.
	 *
	 * @return bool
	 */
	public static function enabled() {
		return (bool) BAP_Settings::get( 'debug' );
	}

	/**
	 * Records an entry.
	 *
	 * @param string $channel One of: event, identity, session, queue, batch,
	 *                        retry, api, consent, woocommerce.
	 * @param string $message Human-readable summary.
	 * @param array  $context Structured detail. Redacted before storage.
	 * @return void
	 */
	public static function log( $channel, $message, array $context = array() ) {
		if ( ! self::enabled() ) {
			return;
		}

		$entries = self::all();

		$entries[] = array(
			'at'      => microtime( true ),
			'channel' => sanitize_key( $channel ),
			'message' => substr( sanitize_text_field( (string) $message ), 0, self::MAX_VALUE ),
			'context' => self::redact( $context ),
		);

		// Rotation: keep the most recent window. Newest entries are the ones a
		// developer is looking at, so the oldest go first.
		if ( count( $entries ) > self::MAX_ENTRIES ) {
			$entries = array_slice( $entries, -self::MAX_ENTRIES );
		}

		update_option( self::OPTION, $entries, false );
	}

	/**
	 * Returns stored entries, newest last.
	 *
	 * @return array
	 */
	public static function all() {
		$entries = get_option( self::OPTION, array() );
		return is_array( $entries ) ? $entries : array();
	}

	/**
	 * Returns entries newest first, optionally filtered.
	 *
	 * @param string $channel Channel filter, or empty for all.
	 * @param int    $limit   Maximum entries.
	 * @return array
	 */
	public static function recent( $channel = '', $limit = 100 ) {
		$entries = array_reverse( self::all() );

		if ( '' !== $channel ) {
			$entries = array_values(
				array_filter(
					$entries,
					static function ( $entry ) use ( $channel ) {
						return isset( $entry['channel'] ) && $entry['channel'] === $channel;
					}
				)
			);
		}

		return array_slice( $entries, 0, max( 1, (int) $limit ) );
	}

	/**
	 * Channels present in the current log.
	 *
	 * @return string[]
	 */
	public static function channels() {
		$channels = array();
		foreach ( self::all() as $entry ) {
			if ( ! empty( $entry['channel'] ) ) {
				$channels[ $entry['channel'] ] = true;
			}
		}
		ksort( $channels );
		return array_keys( $channels );
	}

	/**
	 * Empties the log.
	 *
	 * @return void
	 */
	public static function clear() {
		delete_option( self::OPTION );
	}

	/**
	 * Approximate stored size, for the admin screen.
	 *
	 * @return int Bytes.
	 */
	public static function size() {
		$encoded = wp_json_encode( self::all() );
		return is_string( $encoded ) ? strlen( $encoded ) : 0;
	}

	/**
	 * Recursively removes secrets and bounds value sizes.
	 *
	 * Matching is on the key name rather than the value, because a key called
	 * `api_key` is a reliable signal while guessing at which strings look
	 * secret is not.
	 *
	 * @param mixed $data  Value to redact.
	 * @param int   $depth Current recursion depth.
	 * @return mixed
	 */
	public static function redact( $data, $depth = 0 ) {
		if ( $depth > 4 ) {
			return '[truncated]';
		}

		if ( is_array( $data ) ) {
			$clean = array();
			foreach ( $data as $key => $value ) {
				$safe_key = is_string( $key ) ? $key : (string) $key;
				if ( self::is_secret_key( $safe_key ) ) {
					$clean[ $safe_key ] = '[redacted]';
					continue;
				}
				$clean[ $safe_key ] = self::redact( $value, $depth + 1 );
			}
			return $clean;
		}

		if ( is_object( $data ) ) {
			return '[object]';
		}

		if ( is_string( $data ) ) {
			return substr( sanitize_text_field( $data ), 0, self::MAX_VALUE );
		}

		if ( is_bool( $data ) || is_int( $data ) || is_float( $data ) || null === $data ) {
			return $data;
		}

		return '[unsupported]';
	}

	/**
	 * Whether a key name denotes a secret.
	 *
	 * @param string $key Key name.
	 * @return bool
	 */
	private static function is_secret_key( $key ) {
		$normalized = strtolower( (string) $key );
		foreach ( self::$secret_keys as $needle ) {
			if ( false !== strpos( $normalized, $needle ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Shows enough of an identifier to correlate it, without publishing it.
	 *
	 * @param string $value Identifier.
	 * @return string
	 */
	public static function mask( $value ) {
		$value = (string) $value;
		if ( '' === $value ) {
			return '';
		}
		if ( strlen( $value ) <= 12 ) {
			return substr( $value, 0, 2 ) . str_repeat( '•', 6 );
		}
		return substr( $value, 0, 8 ) . '…' . substr( $value, -4 );
	}
}
