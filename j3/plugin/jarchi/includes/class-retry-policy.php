<?php
/**
 * Retry decisions and failure classification.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Decides whether a failed delivery is worth attempting again, when, and
 * what to tell the administrator about it.
 *
 * Retrying everything is as wrong as retrying nothing. A 401 means the
 * secret does not match: sending it four more times produces four more
 * rejections and hides the real problem behind a wall of noise. A 503
 * means the service is restarting: giving up immediately loses an
 * advertisement that would have gone through a minute later.
 *
 * The split is therefore explicit, and every outcome carries a human
 * explanation instead of a transport error code.
 *
 * @since 1.3.0
 */
class RetryPolicy {

	/**
	 * Status codes that will never succeed by repeating the request.
	 *
	 * @var int[]
	 */
	public const PERMANENT = array( 400, 401, 403, 404, 405, 409, 410, 413, 422 );

	/**
	 * Status codes that usually succeed on a later attempt.
	 *
	 * @var int[]
	 */
	public const TRANSIENT = array( 408, 423, 425, 429, 500, 502, 503, 504, 507, 509, 522, 524 );

	/**
	 * Failure class: the endpoint refused our credentials.
	 *
	 * @var string
	 */
	public const CLASS_AUTH = 'auth';

	/**
	 * Failure class: the URL does not exist on that host.
	 *
	 * @var string
	 */
	public const CLASS_NOT_FOUND = 'not_found';

	/**
	 * Failure class: the endpoint rejected the payload itself.
	 *
	 * @var string
	 */
	public const CLASS_REJECTED = 'rejected';

	/**
	 * Failure class: too many requests.
	 *
	 * @var string
	 */
	public const CLASS_RATE_LIMITED = 'rate_limited';

	/**
	 * Failure class: the service is unavailable or erroring.
	 *
	 * @var string
	 */
	public const CLASS_SERVER = 'server';

	/**
	 * Failure class: the request ran out of time.
	 *
	 * @var string
	 */
	public const CLASS_TIMEOUT = 'timeout';

	/**
	 * Failure class: the host could not be resolved.
	 *
	 * @var string
	 */
	public const CLASS_DNS = 'dns';

	/**
	 * Failure class: the TLS handshake failed.
	 *
	 * @var string
	 */
	public const CLASS_TLS = 'tls';

	/**
	 * Failure class: the connection was refused or reset.
	 *
	 * @var string
	 */
	public const CLASS_CONNECTION = 'connection';

	/**
	 * Failure class: nothing more specific could be determined.
	 *
	 * @var string
	 */
	public const CLASS_UNKNOWN = 'unknown';

	/**
	 * Whether a failed attempt should be tried again.
	 *
	 * @since 1.3.0
	 *
	 * @param int    $code        HTTP status code, 0 for transport errors.
	 * @param string $error_class Failure class from {@see self::classify()}.
	 * @param int    $attempt     Attempt number that just failed, 1-based.
	 * @param int    $max_retries Configured retry budget.
	 *
	 * @return bool True when another attempt is warranted.
	 */
	public function should_retry( int $code, string $error_class, int $attempt, int $max_retries ): bool {
		if ( $attempt > $max_retries ) {
			return false;
		}

		// A rejected credential or a missing route does not improve with
		// repetition; it needs a human.
		if ( in_array( $error_class, array( self::CLASS_AUTH, self::CLASS_NOT_FOUND, self::CLASS_REJECTED ), true ) ) {
			return false;
		}

		if ( $code > 0 && in_array( $code, self::PERMANENT, true ) ) {
			return false;
		}

		$retry = 0 === $code || in_array( $code, self::TRANSIENT, true ) || $code >= 500;

		/**
		 * Filters whether a failed delivery is retried.
		 *
		 * @since 1.3.0
		 *
		 * @param bool   $retry       Whether to retry.
		 * @param int    $code        HTTP status code, 0 for transport errors.
		 * @param string $error_class Failure class.
		 * @param int    $attempt     Attempt that failed.
		 */
		return (bool) apply_filters( 'wpep_should_retry', $retry, $code, $error_class, $attempt );
	}

	/**
	 * Returns the delay before the next attempt.
	 *
	 * Exponential backoff with jitter, so a service coming back from an
	 * outage is not hit by every site at the same second. A `Retry-After`
	 * header from the endpoint always wins: it is the service telling us
	 * exactly when it wants us back.
	 *
	 * @since 1.3.0
	 *
	 * @param int      $attempt     Attempt number that just failed, 1-based.
	 * @param int|null $retry_after Seconds requested by the endpoint, when sent.
	 *
	 * @return int Delay in seconds.
	 */
	public function delay( int $attempt, ?int $retry_after = null ): int {
		if ( null !== $retry_after && $retry_after > 0 ) {
			return min( 6 * HOUR_IN_SECONDS, $retry_after );
		}

		$base = MINUTE_IN_SECONDS * ( 2 ** max( 0, $attempt - 1 ) );
		$base = min( HOUR_IN_SECONDS, $base );

		// Up to 20% jitter, never negative.
		$jitter = (int) round( $base * 0.2 * ( wp_rand( 0, 100 ) / 100 ) );

		/**
		 * Filters the delay before the next delivery attempt.
		 *
		 * @since 1.0.0
		 *
		 * @param int $delay   Delay in seconds.
		 * @param int $attempt Attempt number that just failed.
		 */
		return (int) apply_filters( 'wpep_retry_backoff', $base + $jitter, $attempt );
	}

	/**
	 * Classifies a failure from the status code and transport message.
	 *
	 * @since 1.3.0
	 *
	 * @param int    $code    HTTP status code, 0 for transport errors.
	 * @param string $message Transport or response message.
	 *
	 * @return string One of the CLASS_* constants.
	 */
	public function classify( int $code, string $message ): string {
		if ( $code > 0 ) {
			if ( in_array( $code, array( 401, 403 ), true ) ) {
				return self::CLASS_AUTH;
			}

			if ( 404 === $code || 405 === $code || 410 === $code ) {
				return self::CLASS_NOT_FOUND;
			}

			if ( 429 === $code ) {
				return self::CLASS_RATE_LIMITED;
			}

			if ( 408 === $code || 504 === $code || 524 === $code ) {
				return self::CLASS_TIMEOUT;
			}

			if ( $code >= 500 ) {
				return self::CLASS_SERVER;
			}

			if ( $code >= 400 ) {
				return self::CLASS_REJECTED;
			}

			return self::CLASS_UNKNOWN;
		}

		$normalized = strtolower( $message );

		if ( str_contains( $normalized, 'timed out' ) || str_contains( $normalized, 'timeout' ) || str_contains( $normalized, 'error 28' ) ) {
			return self::CLASS_TIMEOUT;
		}

		if ( str_contains( $normalized, 'could not resolve' ) || str_contains( $normalized, 'name or service not known' ) || str_contains( $normalized, 'error 6' ) ) {
			return self::CLASS_DNS;
		}

		if ( str_contains( $normalized, 'ssl' ) || str_contains( $normalized, 'certificate' ) || str_contains( $normalized, 'tls' ) ) {
			return self::CLASS_TLS;
		}

		if ( str_contains( $normalized, 'refused' ) || str_contains( $normalized, 'reset by peer' ) || str_contains( $normalized, 'failed to connect' ) ) {
			return self::CLASS_CONNECTION;
		}

		return self::CLASS_UNKNOWN;
	}

	/**
	 * Returns a plain explanation of a failure class.
	 *
	 * This is what an administrator reads instead of "cURL error 28".
	 *
	 * @since 1.3.0
	 *
	 * @param string $error_class Failure class.
	 * @param int    $code        HTTP status code, 0 for transport errors.
	 *
	 * @return string Human readable explanation.
	 */
	public function explain( string $error_class, int $code = 0 ): string {
		switch ( $error_class ) {
			case self::CLASS_AUTH:
				return __( 'Authentication failed: the service rejected the webhook secret. Check that the secret in Settings matches the one the Node.js service expects. This is not retried, because repeating it cannot help.', 'wp-event-publisher' );

			case self::CLASS_NOT_FOUND:
				return __( 'The webhook URL does not exist on that host, or the route does not accept POST. Check the Webhook URL setting. This is not retried.', 'wp-event-publisher' );

			case self::CLASS_REJECTED:
				return sprintf(
					/* translators: %d: HTTP status code. */
					__( 'The service rejected the payload itself (HTTP %d). The response body is stored with this log entry. This is not retried, because the same payload would be rejected again.', 'wp-event-publisher' ),
					$code
				);

			case self::CLASS_RATE_LIMITED:
				return __( 'The service is rate limiting this site. The event stays in the queue and is retried later, honouring the Retry-After header when the service sends one.', 'wp-event-publisher' );

			case self::CLASS_SERVER:
				return sprintf(
					/* translators: %d: HTTP status code. */
					__( 'The service answered with a server error (HTTP %d). It is usually restarting or overloaded; the event stays in the queue and is retried.', 'wp-event-publisher' ),
					$code
				);

			case self::CLASS_TIMEOUT:
				return __( 'Connection timeout: the request ran out of time before the service answered. Raise the Webhook Timeout, or check whether another plugin is shortening outgoing requests. The event stays in the queue and is retried.', 'wp-event-publisher' );

			case self::CLASS_DNS:
				return __( 'The webhook host name could not be resolved from this server. Check DNS on the WordPress host. The event stays in the queue and is retried.', 'wp-event-publisher' );

			case self::CLASS_TLS:
				return __( 'The TLS handshake failed: the certificate could not be verified from this server. Check the certificate chain and the WordPress CA bundle. The event stays in the queue and is retried.', 'wp-event-publisher' );

			case self::CLASS_CONNECTION:
				return __( 'The connection was refused or reset, usually a firewall on the WordPress host or the service not listening. The event stays in the queue and is retried.', 'wp-event-publisher' );

			default:
				return __( 'The delivery failed for an unrecognised reason. The exact transport message is stored with this log entry.', 'wp-event-publisher' );
		}
	}
}
