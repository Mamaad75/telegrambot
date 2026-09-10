<?php
/**
 * The slice of WordPress these tests need. Each function exists because some
 * path under test calls it, and behaves as the real one does on the points that
 * matter.
 *
 * @package Bahoosh_Analytics_Pro
 */

// phpcs:disable

$GLOBALS['bap_options']  = array();
$GLOBALS['bap_filters']  = array();
$GLOBALS['bap_actions']  = array();
$GLOBALS['bap_timezone'] = 'UTC';

function get_option( $name, $default = false ) {
	return array_key_exists( $name, $GLOBALS['bap_options'] ) ? $GLOBALS['bap_options'][ $name ] : $default;
}
function update_option( $name, $value, $autoload = null ) { $GLOBALS['bap_options'][ $name ] = $value; return true; }
function add_option( $name, $value, $d = '', $a = 'yes' ) {
	if ( array_key_exists( $name, $GLOBALS['bap_options'] ) ) { return false; }
	$GLOBALS['bap_options'][ $name ] = $value; return true;
}
function delete_option( $name ) { unset( $GLOBALS['bap_options'][ $name ] ); return true; }
function get_transient( $k ) { return get_option( '_t_' . $k, false ); }
function set_transient( $k, $v, $t = 0 ) { return update_option( '_t_' . $k, $v ); }
function delete_transient( $k ) { return delete_option( '_t_' . $k ); }

function add_filter( $hook, $cb, $p = 10, $a = 1 ) { $GLOBALS['bap_filters'][ $hook ][] = $cb; return true; }
function apply_filters( $hook, $value, ...$args ) {
	foreach ( $GLOBALS['bap_filters'][ $hook ] ?? array() as $cb ) { $value = $cb( $value, ...$args ); }
	return $value;
}
function add_action( $hook, $cb, $p = 10, $a = 1 ) { $GLOBALS['bap_actions'][ $hook ][] = $cb; return true; }
function do_action( $hook, ...$args ) {
	foreach ( $GLOBALS['bap_actions'][ $hook ] ?? array() as $cb ) { $cb( ...$args ); }
}

function esc_html( $t ) { return htmlspecialchars( (string) $t, ENT_QUOTES, 'UTF-8' ); }
function esc_attr( $t ) { return esc_html( $t ); }
function esc_url_raw( $u, $schemes = null ) {
	$u = trim( (string) $u );
	if ( '' === $u ) { return ''; }
	$scheme = strtolower( (string) parse_url( $u, PHP_URL_SCHEME ) );
	if ( is_array( $schemes ) && ! in_array( $scheme, $schemes, true ) ) { return ''; }
	return $u;
}
function esc_url( $u ) { return esc_url_raw( $u ); }

function __( $t, $d = null ) { return $t; }
function esc_html__( $t, $d = null ) { return esc_html( $t ); }
function _n( $one, $many, $n, $d = null ) { return 1 === (int) $n ? $one : $many; }
function number_format_i18n( $n, $decimals = 0 ) { return number_format( (float) $n, $decimals ); }

function sanitize_key( $k ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $k ) ); }
function sanitize_text_field( $t ) { return trim( strip_tags( (string) $t ) ); }
function sanitize_textarea_field( $t ) { return trim( strip_tags( (string) $t ) ); }
function wp_unslash( $v ) { return is_string( $v ) ? stripslashes( $v ) : $v; }
function absint( $v ) { return abs( (int) $v ); }

function wp_parse_url( $url, $component = -1 ) { return parse_url( (string) $url, $component ); }
function wp_json_encode( $v, $f = 0, $d = 512 ) { return json_encode( $v, $f | JSON_UNESCAPED_UNICODE, $d ); }
function wp_generate_uuid4() {
	return sprintf( '%04x%04x-%04x-%04x-%04x-%04x%04x%04x', ...array_map( fn() => random_int( 0, 0xffff ), range( 1, 8 ) ) );
}
function current_time( $type = 'timestamp', $gmt = 0 ) {
	if ( 'timestamp' === $type || 'U' === $type ) { return time(); }
	if ( 'mysql' === $type ) { return gmdate( 'Y-m-d H:i:s' ); }
	return gmdate( $type );
}
function wp_timezone_string() { return $GLOBALS['bap_timezone']; }
function home_url( $p = '' ) { return 'https://shop.test' . $p; }
function admin_url( $p = '' ) { return 'https://shop.test/wp-admin/' . $p; }
function is_ssl() { return true; }
function wp_is_mobile() { return false; }
function current_user_can( $c ) { return true; }
function wp_remote_post( $url, $args = array() ) { return $GLOBALS['bap_http_response'] ?? new WP_Error( 'no_stub', 'no response configured' ); }
function wp_remote_retrieve_response_code( $r ) { return is_array( $r ) ? ( $r['response']['code'] ?? 0 ) : 0; }
function wp_remote_retrieve_body( $r ) { return is_array( $r ) ? ( $r['body'] ?? '' ) : ''; }
function is_wp_error( $t ) { return $t instanceof WP_Error; }

if ( ! class_exists( 'WP_Error' ) ) {
	class WP_Error {
		public array $errors = array();
		public function __construct( $code = '', $message = '' ) { if ( '' !== $code ) { $this->errors[ $code ] = array( $message ); } }
		public function get_error_message() { foreach ( $this->errors as $m ) { return $m[0]; } return ''; }
	}
}

// --- Added for v4.3.0: the agent, the provider and the external sources. ---

if ( ! defined( 'DAY_IN_SECONDS' ) ) { define( 'DAY_IN_SECONDS', 86400 ); }

function get_current_user_id() { return 1; }
function wp_generate_password( $length = 12, $special = true, $extra = false ) { return substr( str_repeat( 'abc123', 20 ), 0, $length ); }
function wp_list_pluck( $list, $field ) {
	$out = array();
	foreach ( (array) $list as $row ) { $out[] = is_array( $row ) ? ( $row[ $field ] ?? null ) : ( $row->$field ?? null ); }
	return $out;
}
function add_query_arg( $args, $url = '' ) {
	$sep = str_contains( (string) $url, '?' ) ? '&' : '?';
	return $url . $sep . http_build_query( (array) $args );
}
function wp_remote_get( $url, $args = array() ) { return $GLOBALS['bap_http_response'] ?? new WP_Error( 'no_stub', 'no response configured' ); }
