<?php
/**
 * Boots the plugin's classes against a WordPress stub layer.
 *
 * @package Bahoosh_Analytics_Pro
 */

// phpcs:disable

define( 'ABSPATH', __DIR__ . '/' );

$plugin_dir = dirname( __DIR__ ) . '/bahoosh-analytics-pro/';

$main = file_get_contents( $plugin_dir . 'bahoosh-analytics-pro.php' );
preg_match( "/define\(\s*'BAP_VERSION',\s*'([^']+)'/", $main, $v );
preg_match( "/define\(\s*'BAP_SCHEMA_VERSION',\s*(\d+)/", $main, $s );

define( 'BAP_VERSION', $v[1] ?? '0.0.0' );
define( 'BAP_SCHEMA_VERSION', (int) ( $s[1] ?? 3 ) );
define( 'BAP_PLUGIN_FILE', $plugin_dir . 'bahoosh-analytics-pro.php' );
define( 'BAP_PLUGIN_DIR', $plugin_dir );
define( 'BAP_PLUGIN_URL', 'https://shop.test/wp-content/plugins/bahoosh-analytics-pro/' );
define( 'BAP_PLUGIN_BASENAME', 'bahoosh-analytics-pro/bahoosh-analytics-pro.php' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'DAY_IN_SECONDS', 86400 );

require __DIR__ . '/wp-stubs.php';
require __DIR__ . '/fake-wpdb.php';
require __DIR__ . '/wc-stubs.php';

$GLOBALS['wpdb'] = new Fake_WPDB();

require $plugin_dir . 'includes/class-bap-autoloader.php';
BAP_Autoloader::register();

/* ------------------------------------------------------------- Harness */

$GLOBALS['bap_tests'] = array();

function test( string $name, callable $fn ): void {
	$GLOBALS['bap_tests'][] = array( $name, $fn );
}

function ok( $condition, string $message = '' ): void {
	if ( ! $condition ) {
		throw new Exception( '' !== $message ? $message : 'expected truthy' );
	}
}

function is_same( $expected, $actual, string $message = '' ): void {
	if ( $expected !== $actual ) {
		throw new Exception(
			sprintf( "%s\n      expected: %s\n      actual:   %s", $message, var_export( $expected, true ), var_export( $actual, true ) )
		);
	}
}

function reset_state(): void {
	$GLOBALS['wpdb']          = new Fake_WPDB();
	$GLOBALS['bap_options']   = array();
	$GLOBALS['bap_filters']   = array();
	$GLOBALS['bap_actions']   = array();
	$GLOBALS['bap_orders']    = array();
	$GLOBALS['bap_products']  = array();
	$GLOBALS['bap_coupons']   = array();
	$GLOBALS['bap_timezone']  = 'UTC';
	$GLOBALS['bap_wc_active'] = true;
	$GLOBALS['bap_http_response'] = null;
	BAP_Settings::flush_cache();
}

/**
 * Stores settings directly, bypassing the sanitiser's allowlists where a test
 * needs a specific configuration rather than a user's input.
 */
function set_settings( array $values ): void {
	$GLOBALS['bap_options']['bap_settings'] = array_merge(
		is_array( $GLOBALS['bap_options']['bap_settings'] ?? null ) ? $GLOBALS['bap_options']['bap_settings'] : array(),
		$values
	);
	BAP_Settings::flush_cache();
}

/**
 * Queues one fake HTTP response for the next wp_remote_* call.
 */
function fake_http( int $status, $body ): void {
	$GLOBALS['bap_http_response'] = array(
		'response' => array( 'code' => $status ),
		'body'     => is_string( $body ) ? $body : json_encode( $body ),
	);
}

function run_tests(): void {
	$passed   = 0;
	$failures = array();

	foreach ( $GLOBALS['bap_tests'] as [$name, $fn] ) {
		try {
			reset_state();
			$fn();
			$passed++;
			echo "  \xE2\x9C\x93 {$name}\n";
		} catch ( Throwable $e ) {
			$failures[] = array( $name, $e );
			echo "  \xE2\x9C\x97 {$name}\n";
		}
	}

	echo "\n{$passed}/" . count( $GLOBALS['bap_tests'] ) . " passed\n";

	if ( $failures ) {
		echo "\n";
		foreach ( $failures as [$name, $e] ) {
			echo "FAILED: {$name}\n" . $e->getMessage() . "\n\n";
		}
		exit( 1 );
	}
}
