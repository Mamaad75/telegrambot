<?php
/** SaaS plan/entitlement abstraction. @package Bahoosh_Analytics_Pro */

defined( 'ABSPATH' ) || exit;

/** Central entitlement checks; feature code never compares plan names. */
class BAP_Entitlements {

	/** Core features kept available during outages and on legacy installations. */
	private static $core = array( 'analytics', 'tracking', 'woocommerce', 'diagnostics' );

	/**
	 * Whether the current installation may use a capability.
	 *
	 * Existing 4.x installations are deliberately not bricked merely because a
	 * license has never been configured. Once a license has a definitive state,
	 * server-provided entitlements become authoritative for premium capabilities.
	 *
	 * @param string $capability Capability key.
	 * @return bool
	 */
	public static function can( $capability ) {
		$capability = sanitize_key( (string) $capability );
		if ( in_array( $capability, self::$core, true ) ) {
			return true;
		}

		$snapshot = BAP_License_Manager::snapshot();
		$status   = (string) ( $snapshot['status'] ?? 'unknown' );
		$known    = BAP_License_Manager::has_license_key();

		// Backward compatibility: an upgraded installation with no commercial
		// key keeps its existing feature set. SaaS gating starts after activation.
		if ( ! $known ) {
			return (bool) apply_filters( 'bap_entitlement_legacy_default', true, $capability );
		}

		if ( in_array( $status, array( 'active', 'grace_period' ), true ) ) {
			$entitlements = (array) ( $snapshot['entitlements'] ?? array() );
			if ( array_key_exists( $capability, $entitlements ) ) {
				return (bool) $entitlements[ $capability ];
			}
			// During grace/older backend responses, preserve access instead of
			// failing closed on an omitted flag.
			if ( 'grace_period' === $status ) {
				return true;
			}
		}

		return (bool) apply_filters( 'bap_entitlement_default', false, $capability, $snapshot );
	}

	/** @return array<string,bool> */
	public static function all() {
		return (array) ( BAP_License_Manager::snapshot()['entitlements'] ?? array() );
	}
}
