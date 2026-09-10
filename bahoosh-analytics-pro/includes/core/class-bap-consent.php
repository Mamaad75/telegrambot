<?php
/**
 * Server-side consent state.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Mirrors the browser ConsentManager so server-originated events (WooCommerce
 * orders, for example) honour the same choices.
 *
 * The tracker writes its consent state to localStorage; a compact copy is also
 * written to a first-party cookie precisely so PHP can read it here.
 */
class BAP_Consent {

	const COOKIE = 'bap_consent';

	/**
	 * Returns the consent state for the current request.
	 *
	 * @return array{analytics:bool,marketing:bool,personalization:bool,source:string}
	 */
	public static function current() {
		$require = (bool) BAP_Settings::get( 'require_consent' );

		$state = array(
			'analytics'       => ! $require,
			'marketing'       => ! $require,
			'personalization' => false,
			'source'          => $require ? 'required' : 'default',
		);

		if ( ! empty( $_COOKIE[ self::COOKIE ] ) ) {
			$raw     = sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) );
			$decoded = json_decode( $raw, true );
			if ( is_array( $decoded ) ) {
				foreach ( array( 'analytics', 'marketing', 'personalization' ) as $key ) {
					if ( isset( $decoded[ $key ] ) ) {
						$state[ $key ] = (bool) $decoded[ $key ];
					}
				}
				$state['source'] = 'cookie';
			}
		}

		if ( BAP_Settings::get( 'respect_dnt' ) && self::signals_opt_out() ) {
			$state = array(
				'analytics'       => false,
				'marketing'       => false,
				'personalization' => false,
				'source'          => 'dnt',
			);
		}

		/**
		 * Filters the resolved server-side consent state.
		 *
		 * @param array $state Consent state.
		 */
		return apply_filters( 'bap_consent_state', $state );
	}

	/**
	 * Detects Do Not Track / Global Privacy Control request signals.
	 *
	 * @return bool
	 */
	public static function signals_opt_out() {
		if ( isset( $_SERVER['HTTP_SEC_GPC'] ) && '1' === $_SERVER['HTTP_SEC_GPC'] ) {
			return true;
		}
		if ( isset( $_SERVER['HTTP_DNT'] ) && '1' === $_SERVER['HTTP_DNT'] ) {
			return true;
		}
		return false;
	}

	/**
	 * Whether analytics collection is permitted right now.
	 *
	 * @return bool
	 */
	public static function allows_analytics() {
		$state = self::current();
		return ! empty( $state['analytics'] );
	}

	/**
	 * Payload block attached to events.
	 *
	 * @return array
	 */
	public static function payload() {
		$state = self::current();
		return array(
			'analytics'       => ! empty( $state['analytics'] ),
			'marketing'       => ! empty( $state['marketing'] ),
			'personalization' => ! empty( $state['personalization'] ),
		);
	}
}
