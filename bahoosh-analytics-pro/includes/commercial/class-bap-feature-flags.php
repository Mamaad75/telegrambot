<?php
/** Runtime feature flags supplied by Bahoosh Cloud. @package Bahoosh_Analytics_Pro */

defined( 'ABSPATH' ) || exit;

/**
 * Keeps remote rollout/configuration flags separate from subscription entitlements.
 * Flags are read only from the cached license snapshot; this class never performs
 * a network request while rendering WordPress pages.
 */
class BAP_Feature_Flags {

	/**
	 * Returns whether a rollout flag is enabled.
	 *
	 * @param string $flag    Stable flag key.
	 * @param bool   $default Safe local default when the backend has no opinion.
	 * @return bool
	 */
	public static function enabled( $flag, $default = false ) {
		$flag     = sanitize_key( (string) $flag );
		$snapshot = BAP_License_Manager::snapshot();
		$flags    = isset( $snapshot['feature_flags'] ) && is_array( $snapshot['feature_flags'] ) ? $snapshot['feature_flags'] : array();

		if ( array_key_exists( $flag, $flags ) ) {
			return (bool) $flags[ $flag ];
		}

		return (bool) apply_filters( 'bap_feature_flag_default', $default, $flag );
	}

	/** @return array<string,bool> */
	public static function all() {
		$snapshot = BAP_License_Manager::snapshot();
		return isset( $snapshot['feature_flags'] ) && is_array( $snapshot['feature_flags'] ) ? $snapshot['feature_flags'] : array();
	}
}
