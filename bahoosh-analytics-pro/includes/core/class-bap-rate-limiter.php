<?php
/**
 * Rate limiting for public REST routes.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Fixed-window counter backed by the object cache, falling back to transients.
 *
 * The ingest proxy is necessarily open to anonymous visitors, so it needs a
 * ceiling. The window is deliberately coarse — this is abuse protection, not
 * precise quota accounting, and it must not become a performance problem
 * itself.
 */
class BAP_Rate_Limiter {

	const GROUP = 'bap_rate';

	/**
	 * Checks and increments the counter for a key.
	 *
	 * @param string $bucket      Logical bucket, e.g. 'ingest'.
	 * @param int    $limit       Maximum requests per window.
	 * @param int    $window_secs Window length in seconds.
	 * @param string $identifier  Caller identifier; defaults to the client IP.
	 * @return array{allowed:bool,remaining:int,retry_after:int}
	 */
	public static function check( $bucket, $limit, $window_secs, $identifier = '' ) {
		if ( $limit <= 0 ) {
			return array(
				'allowed'     => true,
				'remaining'   => PHP_INT_MAX,
				'retry_after' => 0,
			);
		}

		if ( '' === $identifier ) {
			$identifier = self::client_fingerprint();
		}

		$window = (int) floor( time() / max( 1, $window_secs ) );
		$key    = 'bap_rl_' . $bucket . '_' . substr( hash( 'sha256', $identifier ), 0, 20 ) . '_' . $window;

		$count = self::increment( $key, $window_secs );

		$allowed     = $count <= $limit;
		$retry_after = $allowed ? 0 : ( ( $window + 1 ) * $window_secs ) - time();

		return array(
			'allowed'     => $allowed,
			'remaining'   => max( 0, $limit - $count ),
			'retry_after' => max( 1, (int) $retry_after ),
		);
	}

	/**
	 * Increments a counter, creating it if needed.
	 *
	 * @param string $key         Cache key.
	 * @param int    $window_secs TTL.
	 * @return int Current count.
	 */
	private static function increment( $key, $window_secs ) {
		if ( wp_using_ext_object_cache() ) {
			$value = wp_cache_get( $key, self::GROUP );
			if ( false === $value ) {
				wp_cache_add( $key, 1, self::GROUP, $window_secs + 5 );
				return 1;
			}
			$next = (int) $value + 1;
			wp_cache_set( $key, $next, self::GROUP, $window_secs + 5 );
			return $next;
		}

		$value = get_transient( $key );
		$next  = false === $value ? 1 : (int) $value + 1;
		set_transient( $key, $next, $window_secs + 5 );
		return $next;
	}

	/**
	 * Identifies a caller for limiting purposes.
	 *
	 * Uses the raw remote address — never a client-supplied header — so the
	 * limit cannot be trivially evaded by spoofing `X-Forwarded-For`.
	 *
	 * @return string
	 */
	private static function client_fingerprint() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] )
			? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) )
			: 'unknown';

		$user_id = get_current_user_id();
		return $user_id > 0 ? 'user:' . $user_id : 'ip:' . $ip;
	}
}
