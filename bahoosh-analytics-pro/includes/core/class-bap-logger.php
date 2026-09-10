<?php
/**
 * Logging helper.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Writes to the WordPress debug log, gated on the plugin's debug setting.
 *
 * Errors are always recorded when WP_DEBUG is on so a misconfigured collector
 * is discoverable without first enabling plugin debugging.
 */
class BAP_Logger {

	/**
	 * Logs a debug message.
	 *
	 * @param string $message Message.
	 * @return void
	 */
	public static function debug( $message ) {
		if ( ! BAP_Settings::get( 'debug' ) ) {
			return;
		}
		self::write( 'DEBUG', $message );
	}

	/**
	 * Logs a warning.
	 *
	 * @param string $message Message.
	 * @return void
	 */
	public static function warn( $message ) {
		self::write( 'WARN', $message );
	}

	/**
	 * Logs an error.
	 *
	 * @param string $message Message.
	 * @return void
	 */
	public static function error( $message ) {
		self::write( 'ERROR', $message );
	}

	/**
	 * Writes a line to the debug log.
	 *
	 * @param string $level   Severity.
	 * @param string $message Message.
	 * @return void
	 */
	private static function write( $level, $message ) {
		if ( ! defined( 'WP_DEBUG' ) || ! WP_DEBUG ) {
			return;
		}
		if ( ! is_string( $message ) ) {
			$message = wp_json_encode( $message );
		}
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- intentional debug channel.
		error_log( '[Bahoosh Analytics][' . $level . '] ' . $message );
	}
}
