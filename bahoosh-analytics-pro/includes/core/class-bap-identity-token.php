<?php
/**
 * Signed identity tokens.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Carries a server-resolved identity to the ingest endpoint without trusting
 * the browser.
 *
 * The problem: the tracker delivers batches with `sendBeacon` during page
 * unload, where WordPress cookie authentication and REST nonces are unreliable.
 * If we simply believed a `wp_user_id` field in the payload, anyone could
 * attribute events to any account.
 *
 * The solution: while rendering the page — where `wp_get_current_user()` is
 * authoritative — PHP mints a short-lived HMAC-signed token binding the user id
 * to the visitor's anonymous id. The ingest route verifies the signature and
 * the binding before believing anything about identity.
 */
class BAP_Identity_Token {

	const TTL           = 43200; // 12 hours.
	const OPTION_SECRET = 'bap_token_secret';

	/**
	 * Issues a token for the current visitor.
	 *
	 * @param string $anonymous_id Anonymous id the token is bound to.
	 * @return string Empty string for anonymous visitors.
	 */
	public static function issue( $anonymous_id ) {
		$user_id = BAP_Identity::wp_user_id();
		if ( $user_id <= 0 ) {
			return '';
		}

		$payload = array(
			'u' => $user_id,
			'c' => BAP_Identity::woocommerce_customer_id(),
			'a' => (string) $anonymous_id,
			'e' => time() + self::TTL,
		);

		$encoded = self::b64_encode( (string) wp_json_encode( $payload ) );
		return $encoded . '.' . self::sign( $encoded );
	}

	/**
	 * Verifies a token and returns its identity claims.
	 *
	 * @param string $token        Token string.
	 * @param string $anonymous_id Anonymous id from the request payload.
	 * @return array{wp_user_id:int,woocommerce_customer_id:int}|null Null when invalid.
	 */
	public static function verify( $token, $anonymous_id ) {
		if ( ! is_string( $token ) || false === strpos( $token, '.' ) ) {
			return null;
		}

		list( $encoded, $signature ) = explode( '.', $token, 2 );

		if ( ! hash_equals( self::sign( $encoded ), (string) $signature ) ) {
			return null;
		}

		$payload = json_decode( self::b64_decode( $encoded ), true );
		if ( ! is_array( $payload ) || empty( $payload['e'] ) || empty( $payload['u'] ) ) {
			return null;
		}

		if ( (int) $payload['e'] < time() ) {
			return null;
		}

		// Binding check: a token captured from one visitor's page is useless to
		// a client presenting a different anonymous id.
		if ( ! isset( $payload['a'] ) || ! hash_equals( (string) $payload['a'], (string) $anonymous_id ) ) {
			return null;
		}

		return array(
			'wp_user_id'              => (int) $payload['u'],
			'woocommerce_customer_id' => isset( $payload['c'] ) ? (int) $payload['c'] : 0,
		);
	}

	/**
	 * Computes the token signature.
	 *
	 * @param string $encoded Encoded payload.
	 * @return string
	 */
	private static function sign( $encoded ) {
		return self::b64_encode( hash_hmac( 'sha256', $encoded, self::secret(), true ) );
	}

	/**
	 * Returns the signing secret, creating it on first use.
	 *
	 * @return string
	 */
	private static function secret() {
		$secret = get_option( self::OPTION_SECRET, '' );
		if ( ! $secret ) {
			$secret = wp_generate_password( 64, true, true );
			update_option( self::OPTION_SECRET, $secret, false );
		}
		return $secret;
	}

	/**
	 * URL-safe base64 encode.
	 *
	 * @param string $data Raw data.
	 * @return string
	 */
	private static function b64_encode( $data ) {
		return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
	}

	/**
	 * URL-safe base64 decode.
	 *
	 * @param string $data Encoded data.
	 * @return string
	 */
	private static function b64_decode( $data ) {
		$padded    = strtr( $data, '-_', '+/' );
		$remainder = strlen( $padded ) % 4;
		if ( $remainder ) {
			$padded .= str_repeat( '=', 4 - $remainder );
		}
		$decoded = base64_decode( $padded, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		return false === $decoded ? '' : $decoded;
	}
}
