<?php
/**
 * Activation, deactivation and schema upgrades.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Handles install-time work and the v1 → v2 migration.
 */
class BAP_Installer {

	const DB_VERSION = 8;

	/**
	 * Runs on activation.
	 *
	 * @return void
	 */
	public static function activate() {
		$installed = (int) get_option( BAP_Settings::OPTION_DB_VERSION, 0 );
		BAP_Outbox::install();
		BAP_Rollup::install();
		BAP_Local_Store::install();
		self::migrate_from_v1();
		self::migrate_to_v3( $installed );
		BAP_Settings::ensure_ai_webhook_secret();
		self::ensure_autoload();
		self::schedule_cron();
		update_option( BAP_Settings::OPTION_DB_VERSION, self::DB_VERSION, true );
	}

	/**
	 * Runs on deactivation. Data is preserved; only scheduling is torn down.
	 *
	 * @return void
	 */
	public static function deactivate() {
		wp_clear_scheduled_hook( BAP_Outbox::CRON_HOOK );
	}

	/**
	 * Applies pending upgrades on load.
	 *
	 * @return void
	 */
	public static function maybe_upgrade() {
		$installed = (int) get_option( BAP_Settings::OPTION_DB_VERSION, 0 );
		if ( $installed >= self::DB_VERSION ) {
			return;
		}

		BAP_Outbox::install();
		BAP_Rollup::install();
		BAP_Local_Store::install();
		self::migrate_from_v1();
		self::migrate_to_v3( $installed );
		BAP_Settings::ensure_ai_webhook_secret();
		self::ensure_autoload();
		self::schedule_cron();
		update_option( BAP_Settings::OPTION_DB_VERSION, self::DB_VERSION, true );
		BAP_Logger::debug( 'upgraded schema from version ' . $installed . ' to ' . self::DB_VERSION );
	}

	/**
	 * Drops settings the v3 model removed.
	 *
	 * Batching, the session timeout and logout rotation are gone: the first two
	 * because events are now sent individually, the third because the anonymous
	 * id identifies the browser and rotating it severed the device from its own
	 * history. Leaving the keys behind would be harmless but confusing — they
	 * would sit in the options table looking like configuration that does
	 * something.
	 *
	 * Queued events are deliberately untouched. Upgrading them is the browser's
	 * job (`NS.queueStore.upgradeRecord`) and the server outbox's rows are
	 * already schema-agnostic; discarding either would lose events that were
	 * captured but never delivered, which is the one thing the outbox exists to
	 * prevent.
	 *
	 * @param int $installed The schema version being upgraded from.
	 * @return void
	 */
	public static function migrate_to_v3( $installed ) {
		if ( $installed >= 5 ) {
			return;
		}

		$settings = get_option( BAP_Settings::OPTION_KEY, null );
		if ( ! is_array( $settings ) ) {
			return;
		}

		$removed = array( 'batch_size', 'flush_interval_ms', 'session_timeout_ms', 'reset_on_logout' );
		$dropped = array();

		foreach ( $removed as $key ) {
			if ( array_key_exists( $key, $settings ) ) {
				$dropped[] = $key;
				unset( $settings[ $key ] );
			}
		}

		if ( empty( $dropped ) ) {
			return;
		}

		update_option( BAP_Settings::OPTION_KEY, $settings, true );
		BAP_Settings::flush_cache();

		// Logged rather than silent: an administrator who had tuned these
		// deserves to find out where they went.
		BAP_Logger::warn( 'v3 upgrade removed obsolete settings: ' . implode( ', ', $dropped ) );
	}

	/**
	 * Seeds v2 settings from a v1 installation.
	 *
	 * Version 1 kept configuration in constants inside the plugin file. Anyone who
	 * edited them keeps their configuration: the values are copied into options
	 * once, and the constants remain readable as a fallback afterwards.
	 *
	 * @return void
	 */
	public static function migrate_from_v1() {
		$existing = get_option( BAP_Settings::OPTION_KEY, null );
		if ( is_array( $existing ) && ! empty( $existing ) ) {
			return; // Already configured under v2.
		}

		$seed = BAP_Settings::defaults();

		if ( defined( 'AAT_API_URL' ) && AAT_API_URL ) {
			$seed['api_url'] = untrailingslashit( AAT_API_URL );
		}
		if ( defined( 'AAT_SITE_ID' ) && AAT_SITE_ID ) {
			$seed['site_id'] = AAT_SITE_ID;
		}

		update_option( BAP_Settings::OPTION_KEY, $seed, true );

		if ( defined( 'AAT_API_KEY' ) && AAT_API_KEY && '' === get_option( BAP_Settings::OPTION_SECRET_KEY, '' ) ) {
			BAP_Settings::set_api_key( AAT_API_KEY );
		}

		BAP_Settings::flush_cache();
	}

	/**
	 * Moves the hot options into the autoload cache.
	 *
	 * `update_option()` only rewrites the autoload flag when the value also
	 * changes, so an install created before this behaviour existed keeps
	 * paying for an extra query on every page load until the option is
	 * removed and re-added.
	 *
	 * @return void
	 */
	public static function ensure_autoload() {
		foreach ( array( BAP_Settings::OPTION_KEY, BAP_Settings::OPTION_DB_VERSION ) as $option ) {
			$value = get_option( $option, null );
			if ( null === $value ) {
				continue;
			}
			delete_option( $option );
			add_option( $option, $value, '', true );
		}
		BAP_Settings::flush_cache();
	}

	/**
	 * Ensures the outbox worker is scheduled.
	 *
	 * @return void
	 */
	public static function schedule_cron() {
		if ( ! wp_next_scheduled( BAP_Outbox::CRON_HOOK ) ) {
			wp_schedule_event( time() + 60, 'bap_minute', BAP_Outbox::CRON_HOOK );
		}
	}
}
