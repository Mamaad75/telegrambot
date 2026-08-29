<?php
/**
 * HMAC request signing.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Produces and verifies HMAC-SHA256 request signatures, and builds the
 * authentication headers every outgoing request carries.
 *
 * This class is the single source of truth for the authentication half
 * of the webhook contract: the signing string, the digest algorithm and
 * the header names are defined here and consumed by both the outbound
 * transport ({@see Webhook}) and the inbound REST controller
 * ({@see Rest}). The connection test goes through the same code, so a
 * successful test proves the credential a real advertisement will use.
 *
 * Signing string:
 *
 *     signature = HMAC_SHA256( timestamp + "." + raw_request_body, api_secret )
 *
 * The signature is always computed over the exact byte sequence that is
 * transmitted. The body is JSON-encoded once and neither re-encoded nor
 * normalized afterwards, so the Node.js service can recompute the digest
 * from the raw request body it receives.
 *
 * @since 1.1.0
 */
class Signer {

	/**
	 * Hashing algorithm used for the signature.
	 *
	 * @var string
	 */
	public const ALGORITHM = 'sha256';

	/**
	 * Separator between timestamp and body in the signing string.
	 *
	 * @var string
	 */
	public const SEPARATOR = '.';

	/**
	 * Authentication style: send every supported credential header.
	 *
	 * @var string
	 */
	public const AUTH_ALL = 'all';

	/**
	 * Authentication style: HMAC signature headers only.
	 *
	 * @var string
	 */
	public const AUTH_HMAC = 'hmac';

	/**
	 * Authentication style: shared secret as an API key header.
	 *
	 * @var string
	 */
	public const AUTH_API_KEY = 'api_key';

	/**
	 * Authentication style: shared secret as a bearer token.
	 *
	 * @var string
	 */
	public const AUTH_BEARER = 'bearer';

	/**
	 * All supported authentication styles.
	 *
	 * @var string[]
	 */
	public const AUTH_STYLES = array( self::AUTH_ALL, self::AUTH_HMAC, self::AUTH_API_KEY, self::AUTH_BEARER );

	/**
	 * Returns the current time as a UTC ISO 8601 timestamp.
	 *
	 * Format: `2026-07-25T10:30:00Z`.
	 *
	 * @since 1.1.0
	 *
	 * @param int|null $time Unix timestamp; defaults to the current time.
	 *
	 * @return string ISO 8601 timestamp in UTC.
	 */
	public function timestamp( ?int $time = null ): string {
		return gmdate( 'Y-m-d\TH:i:s\Z', $time ?? time() );
	}

	/**
	 * Builds the exact string that gets signed.
	 *
	 * Exposed so integrators and the Node.js team can assert both sides
	 * agree on the construction without re-implementing it.
	 *
	 * @since 1.1.0
	 *
	 * @param string $timestamp ISO 8601 UTC timestamp.
	 * @param string $raw_body  Raw request body, exactly as transmitted.
	 *
	 * @return string Signing string.
	 */
	public function signing_string( string $timestamp, string $raw_body ): string {
		return $timestamp . self::SEPARATOR . $raw_body;
	}

	/**
	 * Calculates the hexadecimal HMAC-SHA256 digest for a request.
	 *
	 * @since 1.1.0
	 *
	 * @param string $timestamp ISO 8601 UTC timestamp.
	 * @param string $raw_body  Raw request body, exactly as transmitted.
	 * @param string $secret    Shared API secret.
	 *
	 * @return string Lowercase hexadecimal digest, empty when no secret is set.
	 */
	public function sign( string $timestamp, string $raw_body, string $secret ): string {
		if ( '' === $secret ) {
			return '';
		}

		return hash_hmac( self::ALGORITHM, $this->signing_string( $timestamp, $raw_body ), $secret );
	}

	/**
	 * Calculates the digest of the body alone.
	 *
	 * Some Node.js middlewares (and the GitHub-style
	 * `X-Hub-Signature-256` convention) verify the raw body without a
	 * timestamp prefix. Providing both digests means the backend can pick
	 * whichever it already implements.
	 *
	 * @since 1.2.0
	 *
	 * @param string $raw_body Raw request body.
	 * @param string $secret   Shared API secret.
	 *
	 * @return string Lowercase hexadecimal digest, empty when no secret is set.
	 */
	public function sign_body( string $raw_body, string $secret ): string {
		if ( '' === $secret ) {
			return '';
		}

		return hash_hmac( self::ALGORITHM, $raw_body, $secret );
	}

	/**
	 * Verifies a signature using a timing-safe comparison.
	 *
	 * @since 1.1.0
	 *
	 * @param string $signature Signature supplied by the caller.
	 * @param string $timestamp ISO 8601 UTC timestamp supplied by the caller.
	 * @param string $raw_body  Raw request body received.
	 * @param string $secret    Shared API secret.
	 *
	 * @return bool True when the signature matches.
	 */
	public function verify( string $signature, string $timestamp, string $raw_body, string $secret ): bool {
		if ( '' === $secret || '' === $signature || '' === $timestamp ) {
			return false;
		}

		$expected = $this->sign( $timestamp, $raw_body, $secret );

		if ( '' === $expected ) {
			return false;
		}

		return hash_equals( $expected, $signature );
	}

	/**
	 * Whether a timestamp falls inside the replay tolerance window.
	 *
	 * WordPress always sends the current time, so this helper exists for
	 * inbound requests and for integration tests that need to assert the
	 * same window the Node.js service enforces. The rejection policy
	 * itself belongs to the Node.js service.
	 *
	 * @since 1.1.0
	 *
	 * @param string $timestamp ISO 8601 UTC timestamp.
	 * @param int    $tolerance Allowed drift in seconds.
	 *
	 * @return bool True when the timestamp is fresh enough.
	 */
	public function is_fresh( string $timestamp, int $tolerance ): bool {
		$parsed = strtotime( $timestamp );

		if ( false === $parsed ) {
			return false;
		}

		return abs( time() - $parsed ) <= max( 0, $tolerance );
	}

	/**
	 * Builds the authentication headers for an outgoing request.
	 *
	 * Centralised here so transport and diagnostics cannot drift apart:
	 * a connection test and a real advertisement carry byte-identical
	 * credential headers.
	 *
	 * `X-Webhook-Secret` is always present when a secret is configured,
	 * because that is the credential the Node.js Telegram Publisher checks.
	 * With the default style the other supported schemes travel alongside
	 * it — HMAC signature, API key and bearer token, all derived from the
	 * same shared secret — so a backend that expects one of those works
	 * without configuration. Narrow the style down once you know which
	 * scheme is in use.
	 *
	 * @since 1.1.0
	 * @since 1.2.0 Added the `$style` argument and the body-only digest.
	 *
	 * @param Event  $event     Event being delivered.
	 * @param string $site_id   Configured site identifier.
	 * @param string $timestamp ISO 8601 UTC timestamp of this request.
	 * @param string $signature Hexadecimal HMAC digest of this request.
	 * @param string $secret    Shared API secret.
	 * @param string $style     One of the AUTH_* constants.
	 * @param string $raw_body  Raw request body, used for the body-only digest.
	 *
	 * @return array<string,string> Header map.
	 */
	public function auth_headers(
		Event $event,
		string $site_id,
		string $timestamp,
		string $signature,
		string $secret,
		string $style = self::AUTH_ALL,
		string $raw_body = ''
	): array {
		$headers = array(
			'X-Site-ID'        => $site_id,
			'X-Event-ID'       => $event->id(),
			'X-Timestamp'      => $timestamp,
			'X-Idempotency-Key' => $event->id(),
		);

		if ( '' === $secret ) {
			/** This filter is documented below. */
			return apply_filters( 'wpep_auth_headers', $headers, $event, $style );
		}

		$style = in_array( $style, self::AUTH_STYLES, true ) ? $style : self::AUTH_ALL;

		$wants = static fn( string $candidate ): bool => self::AUTH_ALL === $style || $candidate === $style;

		// The Node.js Telegram Publisher authenticates on X-Webhook-Secret
		// and rejects the request outright without it ("Missing webhook
		// authentication"). It therefore travels with every request,
		// whatever narrower style is selected, so tightening the style can
		// never accidentally lock the plugin out of its own backend.
		$headers['X-Webhook-Secret'] = $secret;

		if ( $wants( self::AUTH_HMAC ) && '' !== $signature ) {
			$headers['X-Signature']         = $signature;
			$headers['X-Hub-Signature-256'] = 'sha256=' . $this->sign_body( $raw_body, $secret );
		}

		if ( $wants( self::AUTH_API_KEY ) ) {
			$headers['X-API-Key'] = $secret;
		}

		if ( $wants( self::AUTH_BEARER ) ) {
			$headers['Authorization'] = 'Bearer ' . $secret;
		}

		/**
		 * Filters the authentication headers of an outgoing request.
		 *
		 * Use this when the Node.js service expects a header name this
		 * plugin does not send. Never log the result: it contains the
		 * shared secret.
		 *
		 * @since 1.2.0
		 *
		 * @param array<string,string> $headers Authentication headers.
		 * @param Event                $event   Event being delivered.
		 * @param string               $style   Configured authentication style.
		 */
		return apply_filters( 'wpep_auth_headers', $headers, $event, $style );
	}
}
