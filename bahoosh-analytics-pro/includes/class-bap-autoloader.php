<?php
/**
 * PSR-ish autoloader for the plugin's `BAP_`-prefixed classes.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Maps `BAP_Foo_Bar` to `class-bap-foo-bar.php` inside one of the known
 * subdirectories.
 */
class BAP_Autoloader {

	/**
	 * Directories searched, in order.
	 *
	 * @var string[]
	 */
	private static $paths = array(
		'includes/core/',
		'includes/api/',
		'includes/integrations/',
		'includes/privacy/',
		'includes/admin/',
		'includes/',
	);

	/**
	 * Registers the autoloader.
	 *
	 * @return void
	 */
	public static function register() {
		spl_autoload_register( array( __CLASS__, 'autoload' ) );
	}

	/**
	 * Loads a class file.
	 *
	 * @param string $class_name Fully qualified class name.
	 * @return void
	 */
	public static function autoload( $class_name ) {
		if ( 0 !== strpos( $class_name, 'BAP_' ) ) {
			return;
		}

		$file = 'class-' . str_replace( '_', '-', strtolower( $class_name ) ) . '.php';

		foreach ( self::$paths as $path ) {
			$candidate = BAP_PLUGIN_DIR . $path . $file;
			if ( is_readable( $candidate ) ) {
				require_once $candidate;
				return;
			}
		}
	}
}
