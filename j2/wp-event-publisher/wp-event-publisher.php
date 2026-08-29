<?php
/**
 * Plugin Name:       جارچی
 * Plugin URI:        https://bymer.ir
 * Description:       انتشار خودکار محتوای وردپرس در تلگرام، بله و واتس‌اپ از طریق سرویس جارچی.
 * Version:           1.19.2
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            ممد از تیم بایمر
 * Author URI:        https://bymer.ir/mamad-js
 * License:           GPL-2.0-or-later
 * License URI:       https://bymer.ir/plugin-license
 * Text Domain:       wp-event-publisher
 * Domain Path:       /languages
 *
 * @package jarchi
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Prevent the bootstrap file from being loaded more than once in the same request.
 * This protects against accidental duplicate plugin inclusion and avoids
 * function/constant redeclaration fatals.
 */
if ( defined( 'WPEP_BOOTSTRAPPED' ) ) {
	return;
}

define( 'WPEP_BOOTSTRAPPED', true );

/*
 * -------------------------------------------------------------------------
 * Plugin constants.
 * -------------------------------------------------------------------------
 */
define( 'WPEP_VERSION', '1.19.2' );
define( 'WPEP_PLUGIN_FILE', __FILE__ );
define( 'WPEP_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'WPEP_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'WPEP_PLUGIN_BASENAME', plugin_basename( __FILE__ ) );
define( 'WPEP_MIN_PHP', '8.1' );
define( 'WPEP_MIN_WP', '6.5' );

/*
 * -------------------------------------------------------------------------
 * Environment guard. Bail out gracefully on unsupported environments.
 * -------------------------------------------------------------------------
 */
if ( version_compare( PHP_VERSION, WPEP_MIN_PHP, '<' ) ) {
	add_action(
		'admin_notices',
		static function (): void {
			printf(
				'<div class="notice notice-error"><p>%s</p></div>',
				esc_html(
					sprintf(
						/* translators: 1: required PHP version, 2: current PHP version. */
						__( 'Jarchi requires PHP %1$s or newer. Your server runs PHP %2$s. The plugin has not been loaded.', 'wp-event-publisher' ),
						WPEP_MIN_PHP,
						PHP_VERSION
					)
				)
			);
		}
	);

	return;
}

/*
 * -------------------------------------------------------------------------
 * PSR-4 style autoloader (no Composer).
 *
 * Maps the WPEventPublisher\ namespace onto WordPress-style file names:
 *   WPEventPublisher\Webhook  -> includes/class-webhook.php
 *   WPEventPublisher\Rest     -> includes/class-rest.php
 * -------------------------------------------------------------------------
 */
require_once WPEP_PLUGIN_DIR . 'includes/class-loader.php';

WPEventPublisher\Loader::register();

require_once WPEP_PLUGIN_DIR . 'includes/helpers.php';

/*
 * -------------------------------------------------------------------------
 * Activation / deactivation lifecycle.
 * -------------------------------------------------------------------------
 */
register_activation_hook( __FILE__, array( WPEventPublisher\Plugin::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( WPEventPublisher\Plugin::class, 'deactivate' ) );

/**
 * Returns the shared plugin instance.
 *
 * Acts as the single procedural entry point for other code that needs to
 * interact with the plugin container.
 *
 * @since 1.0.0
 *
 * @return WPEventPublisher\Plugin Shared plugin instance.
 */
if ( ! function_exists( 'wpep' ) ) {
	function wpep(): WPEventPublisher\Plugin {
		return WPEventPublisher\Plugin::instance();
	}
}

/*
 * -------------------------------------------------------------------------
 * Boot the plugin once all plugins are loaded.
 * -------------------------------------------------------------------------
 */
add_action(
	'plugins_loaded',
	static function (): void {
		wpep()->boot();
	}
);
