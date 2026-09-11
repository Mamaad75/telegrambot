<?php
/**
 * PSR-4 style class autoloader.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Autoloads plugin classes.
 *
 * Follows PSR-4 semantics (one class per file, namespace maps to a base
 * directory) while keeping WordPress file naming conventions, i.e. the
 * class `WPEventPublisher\Webhook` lives in `includes/class-webhook.php`.
 *
 * @since 1.0.0
 */
final class Loader {

	/**
	 * Namespace prefix handled by this autoloader.
	 *
	 * @var string
	 */
	private const PREFIX = 'WPEventPublisher\\';

	/**
	 * Registers the autoloader with SPL.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function register(): void {
		spl_autoload_register( array( self::class, 'autoload' ) );
	}

	/**
	 * Attempts to load a class belonging to the plugin namespace.
	 *
	 * @since 1.0.0
	 *
	 * @param string $class_name Fully qualified class name.
	 *
	 * @return void
	 */
	public static function autoload( string $class_name ): void {
		if ( ! str_starts_with( $class_name, self::PREFIX ) ) {
			return;
		}

		$relative = substr( $class_name, strlen( self::PREFIX ) );
		$file     = WPEP_PLUGIN_DIR . 'includes/' . self::class_to_file( $relative );

		if ( is_readable( $file ) ) {
			require_once $file;

			return;
		}

		// Interfaces follow the same convention with the `interface-` prefix
		// WordPress uses, so `FieldProvider` lives in
		// `includes/interface-field-provider.php`.
		$interface = preg_replace( '#(^|/)class-#', '$1interface-', $file, 1 );

		if ( is_string( $interface ) && is_readable( $interface ) ) {
			require_once $interface;
		}
	}

	/**
	 * Converts a relative class name into a WordPress style file name.
	 *
	 * Example: `Webhook` becomes `class-webhook.php`, `Rest` becomes
	 * `class-rest.php` and nested namespaces map to sub-directories.
	 *
	 * @since 1.0.0
	 *
	 * @param string $relative_class Class name without the namespace prefix.
	 *
	 * @return string Relative file path.
	 */
	private static function class_to_file( string $relative_class ): string {
		$parts = explode( '\\', $relative_class );
		$class = array_pop( $parts );

		// CamelCase -> kebab-case.
		$kebab = strtolower( preg_replace( '/(?<!^)[A-Z]/', '-$0', $class ) );

		$path = '';
		foreach ( $parts as $part ) {
			$path .= strtolower( preg_replace( '/(?<!^)[A-Z]/', '-$0', $part ) ) . '/';
		}

		return $path . 'class-' . $kebab . '.php';
	}
}
