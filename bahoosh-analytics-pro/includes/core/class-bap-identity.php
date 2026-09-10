<?php
/**
 * Server-side identity resolution.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Resolves who the current visitor is, authoritatively.
 *
 * Authenticated identity always comes from WordPress itself
 * (`wp_get_current_user()`), never from a value the browser supplied. The
 * anonymous id is the one piece the browser owns, and it is treated as an
 * opaque, format-validated token — it grants no authority on its own.
 */
class BAP_Identity {

	const ANON_COOKIE = 'bap_anon_id';
	const ANON_TTL    = 34560000; // ~400 days.

	/**
	 * Returns the WordPress user id, or 0 for anonymous visitors.
	 *
	 * @return int
	 */
	public static function wp_user_id() {
		return (int) get_current_user_id();
	}

	/**
	 * Returns the WooCommerce customer id for the current visitor.
	 *
	 * WooCommerce uses the WP user id for registered customers; guests have no
	 * stable customer id, so 0 is returned for them.
	 *
	 * @return int
	 */
	public static function woocommerce_customer_id() {
		if ( ! BAP_WooCommerce::is_active() ) {
			return 0;
		}
		$user_id = self::wp_user_id();
		return $user_id > 0 ? $user_id : 0;
	}

	/**
	 * Validates an anonymous id supplied by a client.
	 *
	 * @param mixed $value Candidate value.
	 * @return bool
	 */
	public static function is_valid_anonymous_id( $value ) {
		return is_string( $value ) && (bool) preg_match( '/^anon_[A-Za-z0-9_\-]{8,128}$/', $value );
	}

	/**
	 * Reads the anonymous id from the first-party cookie the tracker sets.
	 *
	 * @return string Empty string when absent or malformed.
	 */
	public static function anonymous_id_from_cookie() {
		if ( empty( $_COOKIE[ self::ANON_COOKIE ] ) ) {
			return '';
		}
		$raw = sanitize_text_field( wp_unslash( $_COOKIE[ self::ANON_COOKIE ] ) );
		return self::is_valid_anonymous_id( $raw ) ? $raw : '';
	}

	/**
	 * Returns an anonymous id for server-originated events.
	 *
	 * Prefers the cookie the browser already uses so that a server-side
	 * purchase event joins the same identity as the browsing events that led
	 * to it. Falls back to a per-user derived id, and finally to a fresh one.
	 *
	 * @return string
	 */
	public static function resolve_anonymous_id() {
		$cookie = self::anonymous_id_from_cookie();
		if ( '' !== $cookie ) {
			return $cookie;
		}

		$user_id = self::wp_user_id();
		if ( $user_id > 0 ) {
			// Deterministic per (site, user) so repeated server-side events for
			// the same account do not fan out into new identities.
			return 'anon_' . substr(
				hash_hmac( 'sha256', 'wpuser:' . $user_id, self::identity_salt() ),
				0,
				32
			);
		}

		return 'anon_' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 32 );
	}

	/**
	 * The full identity block for an event.
	 *
	 * @param array $overrides Optional explicit values (used by order hooks,
	 *                         where the "current user" may be a cron process).
	 * @return array
	 */
	public static function payload( array $overrides = array() ) {
		$identity = array(
			'anonymous_id' => isset( $overrides['anonymous_id'] )
				? $overrides['anonymous_id']
				: self::resolve_anonymous_id(),
		);

		$wp_user_id = isset( $overrides['wp_user_id'] )
			? (int) $overrides['wp_user_id']
			: self::wp_user_id();

		if ( $wp_user_id > 0 ) {
			$identity['wp_user_id'] = $wp_user_id;

			$customer_id = isset( $overrides['woocommerce_customer_id'] )
				? (int) $overrides['woocommerce_customer_id']
				: self::woocommerce_customer_id();
			if ( $customer_id > 0 ) {
				$identity['woocommerce_customer_id'] = $customer_id;
			}

			$email_hash = self::hashed_email( $wp_user_id );
			if ( '' !== $email_hash ) {
				$identity['email_sha256'] = $email_hash;
			}
		}

		/**
		 * Filters the identity block attached to server-side events.
		 *
		 * @param array $identity Identity payload.
		 */
		return apply_filters( 'bap_identity_payload', $identity );
	}

	/**
	 * Returns a hashed email for identity resolution across systems.
	 *
	 * The raw address is never sent. Hashing is normalised (trim + lowercase)
	 * so the same address hashes identically everywhere, and the setting can
	 * be turned off entirely.
	 *
	 * @param int $user_id WordPress user id.
	 * @return string Empty string when disabled or unavailable.
	 */
	public static function hashed_email( $user_id ) {
		if ( ! BAP_Settings::get( 'hash_user_email' ) ) {
			return '';
		}
		$user = get_userdata( $user_id );
		if ( ! $user || empty( $user->user_email ) ) {
			return '';
		}
		return hash( 'sha256', strtolower( trim( $user->user_email ) ) );
	}

	/**
	 * Salt used for derived identifiers. Site-specific and stable.
	 *
	 * @return string
	 */
	private static function identity_salt() {
		if ( defined( 'AUTH_SALT' ) && AUTH_SALT ) {
			return AUTH_SALT;
		}
		$salt = get_option( 'bap_identity_salt' );
		if ( ! $salt ) {
			$salt = wp_generate_password( 64, true, true );
			update_option( 'bap_identity_salt', $salt, false );
		}
		return $salt;
	}

	/**
	 * Whether the current visitor should be tracked at all.
	 *
	 * @return bool
	 */
	public static function should_track_current_user() {
		if ( ! BAP_Settings::get( 'enabled' ) ) {
			return false;
		}
		if ( is_user_logged_in() && ! BAP_Settings::get( 'track_logged_in' ) ) {
			return false;
		}
		if ( ! BAP_Settings::get( 'track_admins' ) && current_user_can( 'manage_options' ) ) {
			return false;
		}

		/**
		 * Filters whether the current request should be tracked.
		 *
		 * @param bool $should_track Decision so far.
		 */
		return (bool) apply_filters( 'bap_should_track', true );
	}
}
