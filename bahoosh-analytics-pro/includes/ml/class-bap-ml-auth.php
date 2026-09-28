<?php
/**
 * Authentication and pseudonymisation for the ML service connection.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Signs nothing and trusts nothing: every call from the ML service must carry
 * an HMAC over the method, route, query and body made with a secret only this
 * site and the service know.
 *
 * The scheme is mirrored byte for byte in ml-service/bahoosh_ml/security.py:
 *
 *   message = timestamp \n nonce \n METHOD \n route \n canonical_query \n sha256(body)
 *
 * A request older than five minutes, or reusing a nonce, is refused, so a
 * captured request cannot be replayed.
 *
 * @since 4.8.0
 */
class BAP_ML_Auth {

	const OPTION_SECRET = 'bap_ml_secret';
	const OPTION_SALT   = 'bap_ml_customer_salt';
	const WINDOW        = 300;

	/**
	 * The signing secret, created on first use.
	 *
	 * @return string
	 */
	public static function secret() {
		/**
		 * Filters the ML signing secret, e.g. to read it from an environment
		 * variable instead of the database.
		 *
		 * @param string $secret Secret.
		 */
		$secret = (string) apply_filters( 'bap_ml_secret', (string) get_option( self::OPTION_SECRET, '' ) );
		if ( '' === $secret ) {
			$secret = self::rotate_secret();
		}
		return $secret;
	}

	/**
	 * Replaces the secret. The ML service must be updated with the new value.
	 *
	 * @return string
	 */
	public static function rotate_secret() {
		$secret = wp_generate_password( 64, false, false );
		update_option( self::OPTION_SECRET, $secret, false );
		return $secret;
	}

	/**
	 * Canonical query string: sorted keys, RFC 3986 encoding.
	 *
	 * `rest_route` is dropped because it is how plain-permalink sites carry the
	 * route in the query string; the route is signed separately.
	 *
	 * @param array $params Query parameters.
	 * @return string
	 */
	public static function canonical_query( array $params ) {
		unset( $params['rest_route'] );
		ksort( $params, SORT_STRING );
		$parts = array();
		foreach ( $params as $key => $value ) {
			if ( is_array( $value ) ) {
				continue; // The client never sends arrays; refusing them keeps the canonical form unambiguous.
			}
			$parts[] = rawurlencode( (string) $key ) . '=' . rawurlencode( (string) $value );
		}
		return implode( '&', $parts );
	}

	/**
	 * REST permission callback for every signed ML route.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public static function verify( WP_REST_Request $request ) {
		if ( ! BAP_ML_Policy::connection_enabled() ) {
			return new WP_Error( 'bap_ml_disabled', 'ML connection is disabled in Bahoosh > Customer Segments.', array( 'status' => 403 ) );
		}

		$timestamp = (string) $request->get_header( 'x_bap_ml_timestamp' );
		$nonce     = (string) $request->get_header( 'x_bap_ml_nonce' );
		$signature = strtolower( (string) $request->get_header( 'x_bap_ml_signature' ) );

		if ( '' === $timestamp || '' === $nonce || '' === $signature || ! ctype_digit( $timestamp ) || ! preg_match( '/^[a-f0-9]{16,64}$/', $nonce ) ) {
			return new WP_Error( 'bap_ml_unsigned', 'Missing or malformed signature headers.', array( 'status' => 401 ) );
		}
		if ( abs( time() - (int) $timestamp ) > self::WINDOW ) {
			return new WP_Error( 'bap_ml_stale', 'Signature timestamp outside the allowed window. Check the server clocks.', array( 'status' => 401 ) );
		}

		$message = implode(
			"\n",
			array(
				$timestamp,
				$nonce,
				strtoupper( $request->get_method() ),
				$request->get_route(),
				self::canonical_query( (array) $request->get_query_params() ),
				hash( 'sha256', (string) $request->get_body() ),
			)
		);
		$expected = hash_hmac( 'sha256', $message, self::secret() );

		if ( ! hash_equals( $expected, $signature ) ) {
			return new WP_Error( 'bap_ml_bad_signature', 'Invalid signature.', array( 'status' => 401 ) );
		}

		// Checked after the signature so an unauthenticated caller cannot fill
		// the options table with nonces.
		$nonce_key = 'bap_ml_n_' . md5( $nonce );
		if ( false !== get_transient( $nonce_key ) ) {
			return new WP_Error( 'bap_ml_replay', 'Nonce already used.', array( 'status' => 401 ) );
		}
		set_transient( $nonce_key, 1, 2 * self::WINDOW );

		return true;
	}

	/**
	 * Per-site salt for customer pseudonyms. Never leaves WordPress.
	 *
	 * @return string
	 */
	private static function salt() {
		$salt = (string) get_option( self::OPTION_SALT, '' );
		if ( '' === $salt ) {
			$salt = wp_generate_password( 64, true, true );
			update_option( self::OPTION_SALT, $salt, false );
		}
		return $salt;
	}

	/**
	 * Stable pseudonymous customer id.
	 *
	 * Keyed on the normalised email when there is one, so a guest who later
	 * registers keeps one history; on the user id otherwise. The ML service only
	 * ever sees this value, and without the salt it cannot be reversed or linked
	 * to another site.
	 *
	 * @param string $email   Billing or account email.
	 * @param int    $user_id WordPress user id, 0 for guests.
	 * @return string Empty when there is nothing to key on.
	 */
	public static function customer_key( $email, $user_id = 0 ) {
		$email = strtolower( trim( (string) $email ) );
		if ( '' !== $email && is_email( $email ) ) {
			$basis = 'email:' . $email;
		} elseif ( (int) $user_id > 0 ) {
			$basis = 'user:' . (int) $user_id;
		} else {
			return '';
		}
		return 'c_' . substr( hash_hmac( 'sha256', $basis, self::salt() ), 0, 32 );
	}

	/**
	 * Signed token for the one-click unsubscribe link in campaign emails.
	 *
	 * @param string $customer_key Customer key.
	 * @return string
	 */
	public static function unsubscribe_token( $customer_key ) {
		return $customer_key . '.' . substr( hash_hmac( 'sha256', 'unsub:' . $customer_key, self::salt() ), 0, 20 );
	}

	/**
	 * Validates an unsubscribe token and returns its customer key.
	 *
	 * @param string $token Token.
	 * @return string Empty when invalid.
	 */
	public static function customer_from_unsubscribe_token( $token ) {
		$parts = explode( '.', (string) $token );
		if ( 2 !== count( $parts ) || ! preg_match( '/^c_[a-f0-9]{32}$/', $parts[0] ) ) {
			return '';
		}
		return hash_equals( self::unsubscribe_token( $parts[0] ), (string) $token ) ? $parts[0] : '';
	}
}
