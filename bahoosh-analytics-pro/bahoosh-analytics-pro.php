<?php
/**
 * Plugin Name: Bahoosh Analytics Pro
 * Plugin URI:  https://bahoosh.ai/
 * Description: First-party analytics, experience intelligence, funnels, journeys and safe AI orchestration for WordPress and WooCommerce.
 * Version:     4.6.0
 * Author:      Bahoosh_developers
 * License:     GPL-2.0-or-later
 * Text Domain: bahoosh-analytics-pro
 * Domain Path: /languages
 * Requires PHP: 7.4
 * Requires at least: 5.8
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

define( 'BAP_VERSION', '4.6.0' );
define( 'BAP_SCHEMA_VERSION', 3 );
define( 'BAP_PLUGIN_FILE', __FILE__ );
define( 'BAP_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'BAP_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'BAP_PLUGIN_BASENAME', plugin_basename( __FILE__ ) );

/**
 * Version 1 exposed configuration as constants in this file. Installations that
 * edited them keep working: the settings layer falls back to these values when
 * no option has been saved yet. Nothing else in v2 reads them directly.
 */
if ( ! defined( 'AAT_API_URL' ) ) {
	define( 'AAT_API_URL', '' );
}
if ( ! defined( 'AAT_SITE_ID' ) ) {
	define( 'AAT_SITE_ID', '' );
}
if ( ! defined( 'AAT_API_KEY' ) ) {
	define( 'AAT_API_KEY', '' );
}

require_once BAP_PLUGIN_DIR . 'includes/class-bap-autoloader.php';
BAP_Autoloader::register();

register_activation_hook( __FILE__, array( 'BAP_Installer', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'BAP_Installer', 'deactivate' ) );

/**
 * Returns the plugin container.
 *
 * @return BAP_Plugin
 */
function bahoosh_analytics() {
	return BAP_Plugin::instance();
}

bahoosh_analytics()->boot();
