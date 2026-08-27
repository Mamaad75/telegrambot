<?php
/**
 * WordPress stand-in for the Jarchi test harnesses.
 *
 * The rule this file is written to: a stub that answers a question WordPress
 * would answer differently is worse than no stub at all, because it converts a
 * real defect into a passing test. Two entries here exist specifically because
 * that already happened:
 *
 *   - wp_insert_post() fires `transition_post_status`. Without it, creating a
 *     ticket could not re-trigger a "post published" automation, so a runaway
 *     loop that sent a customer hundreds of tickets and stalled their request
 *     looked perfectly healthy under test.
 *   - wp_insert_comment() fires `wp_insert_comment`, for the same reason on
 *     the comment-reply trigger.
 *
 * @package WPEventPublisherAudit
 */

error_reporting( E_ALL );

define( 'ABSPATH', '/tmp/wpstub/' );
define( 'WP_DEBUG', true );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'DAY_IN_SECONDS', 86400 );
define( 'WEEK_IN_SECONDS', 604800 );
define( 'ARRAY_A', 'ARRAY_A' );
define( 'OBJECT', 'OBJECT' );

foreach ( array( 'file.php', 'media.php', 'image.php', 'plugin.php', 'upgrade.php', 'template.php', 'user.php' ) as $wpep_inc ) {
	$wpep_path = ABSPATH . 'wp-admin/includes/' . $wpep_inc;

	if ( ! file_exists( $wpep_path ) ) {
		@mkdir( dirname( $wpep_path ), 0777, true );
		file_put_contents( $wpep_path, "<?php\n" );
	}
}

$GLOBALS['opt']          = array();
$GLOBALS['meta']         = array();
$GLOBALS['usermeta']     = array();
$GLOBALS['commentmeta']  = array();
$GLOBALS['transients']   = array();
$GLOBALS['posts']        = array();
$GLOBALS['comments']     = array();
$GLOBALS['terms']        = array();
$GLOBALS['object_terms'] = array();
$GLOBALS['attachments']  = array();
$GLOBALS['actions']      = array();
$GLOBALS['filters']      = array();
$GLOBALS['menus']        = array();
$GLOBALS['top_menus']    = array();
$GLOBALS['screens']      = array();
$GLOBALS['post_types']   = array();
$GLOBALS['taxes']        = array();
$GLOBALS['roles_store']  = array();
$GLOBALS['scripts']      = array();
$GLOBALS['styles']       = array();
$GLOBALS['cron']         = array();
$GLOBALS['sent_mail']    = array();
$GLOBALS['term_seq']     = 100;
$GLOBALS['post_seq']     = 1000;
$GLOBALS['comment_seq']  = 5000;
$GLOBALS['is_admin']     = true;

/* ---------------------------------------------------------- core types */

class WP_Post {
	public $ID = 0;
	public $post_title = '';
	public $post_content = '';
	public $post_excerpt = '';
	public $post_name = '';
	public $post_status = 'publish';
	public $post_type = 'post';
	public $post_author = 1;
	public $post_parent = 0;
	public $menu_order = 0;
	public $comment_status = 'open';
	public $post_date = '2026-08-01 10:00:00';
	public $post_date_gmt = '2026-08-01 10:00:00';
	public $post_modified = '2026-08-01 10:00:00';

	public function __construct( array $data = array() ) {
		foreach ( $data as $k => $v ) { $this->$k = $v; }
	}
}

class WP_Term {
	public $term_id = 0;
	public $name = '';
	public $slug = '';
	public $taxonomy = '';
	public $parent = 0;
	public $count = 0;

	public function __construct( array $data = array() ) {
		foreach ( $data as $k => $v ) { $this->$k = $v; }
	}
}

class WP_Taxonomy {
	public $name;
	public $hierarchical;
	public $labels;

	public function __construct( string $n, bool $h, string $s ) {
		$this->name         = $n;
		$this->hierarchical = $h;
		$this->labels       = (object) array( 'singular_name' => $s, 'name' => $s );
	}
}

class WP_Error {
	private $code;
	private $message;
	private $data;

	public function __construct( $code = '', $message = '', $data = null ) {
		$this->code    = $code;
		$this->message = $message;
		$this->data    = $data;
	}

	public function get_error_code() { return $this->code; }
	public function get_error_message() { return $this->message; }
	public function get_error_data() { return $this->data; }
}

class WP_Role_Stub {
	public string $name;
	public array $capabilities = array();

	public function __construct( string $n, array $c = array() ) { $this->name = $n; $this->capabilities = $c; }
	public function add_cap( $c, $g = true ) { $this->capabilities[ $c ] = $g; }
	public function remove_cap( $c ) { unset( $this->capabilities[ $c ] ); }
	public function has_cap( $c ) { return ! empty( $this->capabilities[ $c ] ); }
}

class WP_User_Stub {
	public $ID = 0;
	public $display_name = '';
	public $user_email = '';
	public $user_login = '';
	public $roles = array();

	public function __construct( int $id, string $login = '', string $email = '', array $roles = array() ) {
		$this->ID           = $id;
		$this->user_login   = $login ?: 'user-' . $id;
		$this->display_name = $login ?: 'user-' . $id;
		$this->user_email   = $email ?: $this->user_login . '@example.test';
		$this->roles        = $roles ?: array( 'subscriber' );
	}

	public function add_role( $role ) { if ( ! in_array( $role, $this->roles, true ) ) { $this->roles[] = $role; } }
	public function remove_role( $role ) { $this->roles = array_values( array_diff( $this->roles, array( $role ) ) ); }
	public function has_cap( $cap ) { return in_array( 'administrator', $this->roles, true ); }
}

$GLOBALS['users_store'] = array( '1' => new WP_User_Stub( 1, 'admin', 'admin@example.ir', array( 'administrator' ) ) );

class FakeWpdb {
	public $prefix = 'wp_';
	public $options = 'wp_options';
	public $postmeta = 'wp_postmeta';
	public $posts = 'wp_posts';
	public $comments = 'wp_comments';
	public $commentmeta = 'wp_commentmeta';
	public $users = 'wp_users';
	public $usermeta = 'wp_usermeta';
	public $insert_id = 0;
	public $last_error = '';
	public array $queries = array();

	public function get_charset_collate() { return 'DEFAULT CHARACTER SET utf8mb4'; }
	public function insert( $t, $d, $f = null ) { $this->insert_id++; return 1; }
	public function update( $t, $d, $w, $df = null, $wf = null ) { return 1; }
	public function delete( $t, $w, $f = null ) { return 1; }
	public function query( $sql ) { $this->queries[] = $sql; return 0; }
	public function get_col( $sql ) { $this->queries[] = $sql; return array(); }
	/*
	 * Answers the unread-ticket COUNT from the in-memory stores.
	 *
	 * The badge was moved off WP_Query onto one COUNT(*) for performance. A
	 * get_var() that always returns 0 would make every badge assertion pass
	 * with the feature removed, so this models the one query the plugin
	 * actually runs rather than pretending to.
	 */
	public function get_var( $sql ) {
		$this->queries[] = $sql;

		if ( str_contains( (string) $sql, '_jarchi_ticket_user_unread' ) ) {
			$author = 0;

			if ( preg_match( '/post_author = (\d+)/', (string) $sql, $m ) ) {
				$author = (int) $m[1];
			}

			$count = 0;

			foreach ( $GLOBALS['posts'] as $post ) {
				if ( 'jarchi_ticket' !== $post->post_type ) { continue; }
				if ( $author && (int) $post->post_author !== $author ) { continue; }
				if ( ! in_array( $post->post_status, array( 'publish', 'private', 'draft' ), true ) ) { continue; }
				if ( '1' === (string) ( $GLOBALS['meta'][ (int) $post->ID ]['_jarchi_ticket_user_unread'] ?? '' ) ) { ++$count; }
			}

			return $count;
		}

		return 0;
	}
	public function get_row( $sql, $o = null ) { $this->queries[] = $sql; return null; }
	/* Substitutes the placeholders, so the SQL the model reads is the SQL the
	   plugin built — a passthrough would leave %d where the author id goes. */
	public function prepare( $sql, ...$a ) {
		$args = ( 1 === count( $a ) && is_array( $a[0] ) ) ? $a[0] : $a;

		foreach ( $args as $value ) {
			$sql = preg_replace( '/%[sdf]/', is_numeric( $value ) ? (string) $value : "'" . $value . "'", (string) $sql, 1 );
		}

		return $sql;
	}
	public function esc_like( $t ) { return $t; }
	public function db_version() { return '8.0.35'; }
	public function get_results( $sql, $o = null ) { $this->queries[] = $sql; return array(); }
}
$GLOBALS['wpdb'] = new FakeWpdb();

/* ------------------------------------------------------------ hooks */

function add_action( $t, $cb, $p = 10, $a = 1 ) { $GLOBALS['actions'][ $t ][ $p ][] = $cb; return true; }
function add_filter( $t, $cb, $p = 10, $a = 1 ) { $GLOBALS['filters'][ $t ][ $p ][] = $cb; return true; }
function remove_action( $t, $cb, $p = 10 ) { return true; }
function remove_filter( $t, $cb, $p = 10 ) { return true; }
function has_action( $t, $cb = false ) { return ! empty( $GLOBALS['actions'][ $t ] ); }
function has_filter( $t, $cb = false ) { return ! empty( $GLOBALS['filters'][ $t ] ); }
function did_action( $t ) { return (int) ( $GLOBALS['did_action'][ $t ] ?? 0 ); }

function do_action( $t, ...$args ) {
	$GLOBALS['did_action'][ $t ] = ( $GLOBALS['did_action'][ $t ] ?? 0 ) + 1;
	$hooks = $GLOBALS['actions'][ $t ] ?? array();
	ksort( $hooks );
	foreach ( $hooks as $cbs ) { foreach ( $cbs as $cb ) { $cb( ...$args ); } }
}

function apply_filters( $t, $v, ...$args ) {
	$hooks = $GLOBALS['filters'][ $t ] ?? array();
	ksort( $hooks );
	foreach ( $hooks as $cbs ) { foreach ( $cbs as $cb ) { $v = $cb( $v, ...$args ); } }
	return $v;
}

function do_action_ref_array( $t, $a ) { do_action( $t, ...$a ); }
function apply_filters_ref_array( $t, $a ) { return apply_filters( $t, ...$a ); }

/* ------------------------------------------------------------ i18n & escaping */

function __( $t, $d = '' ) { return $t; }
function _e( $t, $d = '' ) { echo $t; }
function _n( $s, $p, $n, $d = '' ) { return 1 === (int) $n ? $s : $p; }
function _x( $t, $c, $d = '' ) { return $t; }
function esc_html__( $t, $d = '' ) { return htmlspecialchars( (string) $t, ENT_QUOTES ); }
function esc_html_e( $t, $d = '' ) { echo htmlspecialchars( (string) $t, ENT_QUOTES ); }
function esc_attr__( $t, $d = '' ) { return htmlspecialchars( (string) $t, ENT_QUOTES ); }
function esc_attr_e( $t, $d = '' ) { echo htmlspecialchars( (string) $t, ENT_QUOTES ); }
function esc_html( $t ) { return htmlspecialchars( (string) $t, ENT_QUOTES ); }
function esc_attr( $t ) { return htmlspecialchars( (string) $t, ENT_QUOTES ); }
function esc_textarea( $t ) { return htmlspecialchars( (string) $t, ENT_QUOTES ); }
function esc_js( $t ) { return str_replace( array( "'", "\r", "\n" ), array( "\\'", '', ' ' ), (string) $t ); }
function esc_url( $u ) { return (string) $u; }

function esc_url_raw( $u, $p = null ) {
	// A passthrough would let a javascript: assertion pass while proving nothing.
	$u       = trim( (string) $u );
	$allowed = is_array( $p ) ? $p : array( 'http', 'https', 'mailto', 'tel' );

	if ( preg_match( '#^([a-zA-Z][a-zA-Z0-9+.-]*):#', $u, $m ) ) {
		return in_array( strtolower( $m[1] ), $allowed, true ) ? $u : '';
	}

	return $u;
}

// Mirrors the part of wp_kses_post the plugin relies on: script/style/iframe
// are removed, and on* handlers and javascript: URLs do not survive.
function wp_kses_post( $t ) {
	$t = (string) $t;
	$t = preg_replace( '#<\s*(script|style|iframe|object|embed)\b.*?<\s*/\s*\1\s*>#is', '', $t ) ?? '';
	$t = preg_replace( '#<\s*(script|style|iframe|object|embed)\b[^>]*/?>#is', '', $t ) ?? '';
	$t = preg_replace( '#\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)#is', '', $t ) ?? '';
	$t = preg_replace( '#(href|src)\s*=\s*("|\')\s*javascript:[^"\']*\2#is', '', $t ) ?? '';
	return $t;
}

function wp_strip_all_tags( $t, $br = false ) { return trim( strip_tags( (string) $t ) ); }
function sanitize_text_field( $t ) { return trim( preg_replace( '/[\r\n\t]+/', ' ', strip_tags( (string) $t ) ) ?? '' ); }
function sanitize_textarea_field( $t ) { return trim( strip_tags( (string) $t ) ); }
function sanitize_key( $t ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $t ) ) ?? ''; }
function sanitize_title( $t ) { $k = sanitize_key( $t ); return '' !== $k ? $k : 'term-' . substr( md5( (string) $t ), 0, 8 ); }
function sanitize_email( $t ) { return filter_var( (string) $t, FILTER_VALIDATE_EMAIL ) ?: ''; }
function sanitize_file_name( $t ) { return preg_replace( '/[^A-Za-z0-9._-]/', '-', (string) $t ) ?? ''; }
function sanitize_hex_color( $t ) { return preg_match( '/^#([A-Fa-f0-9]{3}){1,2}$/', (string) $t ) ? (string) $t : ''; }
function wp_unslash( $v ) { return is_array( $v ) ? array_map( 'wp_unslash', $v ) : stripslashes( (string) $v ); }
function absint( $v ) { return abs( (int) $v ); }
function wp_json_encode( $v, $f = 0, $d = 512 ) { return json_encode( $v, $f | JSON_UNESCAPED_UNICODE, $d ); }
function is_wp_error( $t ) { return $t instanceof WP_Error; }
function wpautop( $t, $br = true ) { return '<p>' . str_replace( "\n\n", '</p><p>', (string) $t ) . '</p>'; }
function esc_like( $t ) { return $t; }
function number_format_i18n( $n, $d = 0 ) { return number_format( (float) $n, (int) $d ); }
function checked( $a, $b = true, $echo = true ) { $r = $a == $b ? ' checked="checked"' : ''; if ( $echo ) { echo $r; } return $r; }
function selected( $a, $b = true, $echo = true ) { $r = (string) $a === (string) $b ? ' selected="selected"' : ''; if ( $echo ) { echo $r; } return $r; }
function disabled( $a, $b = true, $echo = true ) { $r = $a == $b ? ' disabled="disabled"' : ''; if ( $echo ) { echo $r; } return $r; }

/* ------------------------------------------------------------ options */

function get_option( $k, $d = false ) { return array_key_exists( $k, $GLOBALS['opt'] ) ? $GLOBALS['opt'][ $k ] : $d; }
function update_option( $k, $v, $a = null ) { $GLOBALS['opt'][ $k ] = $v; return true; }
function add_option( $k, $v, $x = '', $a = null ) { if ( ! array_key_exists( $k, $GLOBALS['opt'] ) ) { $GLOBALS['opt'][ $k ] = $v; } return true; }
function delete_option( $k ) { unset( $GLOBALS['opt'][ $k ] ); return true; }
function get_transient( $k ) { $e = $GLOBALS['transients'][ $k ] ?? null; if ( ! $e || $e['expires'] < time() ) { return false; } return $e['value']; }
function set_transient( $k, $v, $t = 0 ) { $GLOBALS['transients'][ $k ] = array( 'value' => $v, 'expires' => time() + ( $t ?: 3600 ) ); return true; }
function delete_transient( $k ) { unset( $GLOBALS['transients'][ $k ] ); return true; }
function wp_cache_get( $k, $g = '' ) { return $GLOBALS['obj_cache'][ $g ][ $k ] ?? false; }
function wp_cache_set( $k, $v, $g = '', $e = 0 ) { $GLOBALS['obj_cache'][ $g ][ $k ] = $v; return true; }
function wp_cache_delete( $k, $g = '' ) { unset( $GLOBALS['obj_cache'][ $g ][ $k ] ); return true; }

/* ------------------------------------------------------------ meta */

function get_post_meta( $id, $key = '', $single = false ) {
	if ( '' === $key ) { return $GLOBALS['meta'][ (int) $id ] ?? array(); }
	$v = $GLOBALS['meta'][ (int) $id ][ $key ] ?? '';
	return $single ? $v : ( '' === $v ? array() : array( $v ) );
}
function update_post_meta( $id, $key, $value, $prev = '' ) { $GLOBALS['meta'][ (int) $id ][ $key ] = $value; return true; }
function add_post_meta( $id, $key, $value, $unique = false ) { $GLOBALS['meta'][ (int) $id ][ $key ] = $value; return true; }
function delete_post_meta( $id, $key, $value = '' ) { unset( $GLOBALS['meta'][ (int) $id ][ $key ] ); return true; }

function get_user_meta( $id, $key = '', $single = false ) {
	if ( '' === $key ) { return $GLOBALS['usermeta'][ (int) $id ] ?? array(); }
	$v = $GLOBALS['usermeta'][ (int) $id ][ $key ] ?? '';
	return $single ? $v : ( '' === $v ? array() : array( $v ) );
}
function update_user_meta( $id, $key, $value, $prev = '' ) { $GLOBALS['usermeta'][ (int) $id ][ $key ] = $value; return true; }
function add_user_meta( $id, $key, $value, $unique = false ) { $GLOBALS['usermeta'][ (int) $id ][ $key ] = $value; return true; }
function delete_user_meta( $id, $key, $value = '' ) { unset( $GLOBALS['usermeta'][ (int) $id ][ $key ] ); return true; }

function get_comment_meta( $id, $key = '', $single = false ) {
	if ( '' === $key ) { return $GLOBALS['commentmeta'][ (int) $id ] ?? array(); }
	$v = $GLOBALS['commentmeta'][ (int) $id ][ $key ] ?? '';
	return $single ? $v : ( '' === $v ? array() : array( $v ) );
}
function update_comment_meta( $id, $key, $value, $prev = '' ) { $GLOBALS['commentmeta'][ (int) $id ][ $key ] = $value; return true; }
function add_comment_meta( $id, $key, $value, $unique = false ) { $GLOBALS['commentmeta'][ (int) $id ][ $key ] = $value; return true; }
function delete_comment_meta( $id, $key, $value = '' ) { unset( $GLOBALS['commentmeta'][ (int) $id ][ $key ] ); return true; }

/* ------------------------------------------------------------ posts */

function get_post( $p = null, $output = OBJECT ) {
	if ( $p instanceof WP_Post ) { return $p; }
	return $GLOBALS['posts'][ (int) $p ] ?? null;
}
function get_post_type( $p = null ) { $post = get_post( $p ); return $post ? $post->post_type : false; }
function get_post_status( $p = null ) { $post = get_post( $p ); return $post ? $post->post_status : false; }
function get_the_modified_date( $f = '', $p = null ) { return '۱۴۰۵/۰۶/۰۳'; }
function get_the_date( $f = '', $p = null ) { return '۱۴۰۵/۰۶/۰۳'; }
function get_the_title( $p = 0 ) { $post = get_post( $p ); return $post ? (string) $post->post_title : ''; }
function get_permalink( $p = 0 ) { $id = is_object( $p ) ? $p->ID : (int) $p; return 'https://example.ir/?p=' . $id; }
function get_edit_post_link( $p = 0, $c = '&' ) { return 'https://example.ir/wp-admin/post.php?post=' . (int) $p . '&action=edit'; }
function get_post_thumbnail_id( $p = null ) { $post = get_post( $p ); return $post ? (int) ( $GLOBALS['meta'][ $post->ID ]['_thumbnail_id'] ?? 0 ) : 0; }

/*
 * Fires `transition_post_status`, exactly as WordPress does.
 *
 * This is the single most important line in this file. Creating a ticket is a
 * wp_insert_post(), and WordPress announces that with transition_post_status.
 * A stub that stayed silent could not reproduce an automation whose own output
 * re-triggers it — which is how a loop that sent one customer hundreds of
 * tickets, and stalled the request that created their advert, passed its tests.
 */
function wp_insert_post( $data = array(), $wp_error = false, $fire_after_hooks = true ) {
	$data = (array) $data;

	if ( '' === trim( (string) ( $data['post_title'] ?? '' ) ) && '' === trim( (string) ( $data['post_content'] ?? '' ) ) ) {
		return $wp_error ? new WP_Error( 'empty_content', 'Content, title, and excerpt are empty.' ) : 0;
	}

	$update = ! empty( $data['ID'] ) && isset( $GLOBALS['posts'][ (int) $data['ID'] ] );
	$id     = $update ? (int) $data['ID'] : ( ++$GLOBALS['post_seq'] );
	$old    = $update ? $GLOBALS['posts'][ $id ]->post_status : 'new';

	$post = $update ? $GLOBALS['posts'][ $id ] : new WP_Post();

	$post->ID = $id;

	foreach ( array( 'post_title', 'post_content', 'post_excerpt', 'post_status', 'post_type', 'post_author', 'post_parent', 'comment_status' ) as $field ) {
		if ( isset( $data[ $field ] ) ) { $post->$field = $data[ $field ]; }
	}

	$post->post_author = (int) ( $data['post_author'] ?? $post->post_author );
	$post->post_name   = $post->post_name ?: sanitize_title( (string) $post->post_title );

	$GLOBALS['posts'][ $id ] = $post;

	if ( $fire_after_hooks ) {
		do_action( 'transition_post_status', $post->post_status, $old, $post );
		do_action( 'save_post', $id, $post, $update );
		do_action( 'wp_insert_post', $id, $post, $update );
	}

	return $id;
}

function wp_update_post( $data = array(), $wp_error = false, $fire = true ) { return wp_insert_post( $data, $wp_error, $fire ); }
function wp_delete_post( $id, $force = false ) { $p = $GLOBALS['posts'][ (int) $id ] ?? null; unset( $GLOBALS['posts'][ (int) $id ] ); return $p ?: false; }
function wp_trash_post( $id ) { if ( isset( $GLOBALS['posts'][ (int) $id ] ) ) { $GLOBALS['posts'][ (int) $id ]->post_status = 'trash'; } return true; }

function get_posts( $args = array() ) {
	$type   = (array) ( $args['post_type'] ?? 'post' );
	$status = (array) ( $args['post_status'] ?? array( 'publish' ) );
	$author = (int) ( $args['author'] ?? 0 );
	$out    = array();

	foreach ( $GLOBALS['posts'] as $post ) {
		if ( ! in_array( $post->post_type, $type, true ) ) { continue; }
		if ( ! in_array( 'any', $status, true ) && ! in_array( $post->post_status, $status, true ) ) { continue; }
		if ( $author && (int) $post->post_author !== $author ) { continue; }
		$out[] = $post;
	}

	$limit = (int) ( $args['numberposts'] ?? $args['posts_per_page'] ?? -1 );

	if ( $limit > 0 ) { $out = array_slice( $out, 0, $limit ); }

	if ( 'ids' === ( $args['fields'] ?? '' ) ) { return array_map( static fn( $p ) => (int) $p->ID, $out ); }

	return $out;
}

class WP_Query {
	public array $posts = array();
	public int $found_posts = 0;
	public int $max_num_pages = 1;
	public array $query_vars = array();
	private int $pointer = 0;

	public function __construct( $args = array() ) {
		$this->query_vars = (array) $args;
		$this->posts      = $this->run( (array) $args );
		$this->found_posts = count( $this->posts );
		$per = (int) ( $args['posts_per_page'] ?? 10 );
		$this->max_num_pages = $per > 0 ? (int) ceil( $this->found_posts / $per ) : 1;
	}

	private function run( array $args ): array {
		$type   = (array) ( $args['post_type'] ?? 'post' );
		$status = (array) ( $args['post_status'] ?? array( 'publish' ) );
		$out    = array();

		foreach ( $GLOBALS['posts'] as $post ) {
			if ( ! in_array( $post->post_type, $type, true ) ) { continue; }
			if ( ! in_array( 'any', $status, true ) && ! in_array( $post->post_status, $status, true ) ) { continue; }
			if ( ! empty( $args['author'] ) && (int) $post->post_author !== (int) $args['author'] ) { continue; }

			// Honour meta_query, because ticket lists are filtered by status.
			$ok = true;

			foreach ( (array) ( $args['meta_query'] ?? array() ) as $clause ) {
				if ( ! is_array( $clause ) || empty( $clause['key'] ) ) { continue; }
				$have = (string) get_post_meta( (int) $post->ID, (string) $clause['key'], true );
				if ( isset( $clause['value'] ) && $have !== (string) $clause['value'] ) { $ok = false; }
			}

			// And tax_query, because agent scoping depends on it.
			foreach ( (array) ( $args['tax_query'] ?? array() ) as $key => $clause ) {
				if ( 'relation' === $key || ! is_array( $clause ) || empty( $clause['taxonomy'] ) ) { continue; }
				$want = array_map( 'intval', (array) ( $clause['terms'] ?? array() ) );
				$have = array_map( 'intval', (array) ( $GLOBALS['object_terms'][ (int) $post->ID ][ $clause['taxonomy'] ] ?? array() ) );
				if ( ! array_intersect( $want, $have ) ) { $ok = false; }
			}

			if ( $ok ) { $out[] = $post; }
		}

		return $out;
	}

	public function have_posts() { return $this->pointer < count( $this->posts ); }
	public function the_post() { $GLOBALS['post'] = $this->posts[ $this->pointer++ ] ?? null; }
	public function rewind_posts() { $this->pointer = 0; }
}

/* ------------------------------------------------------------ comments */

function wp_insert_comment( $data = array() ) {
	$id = ++$GLOBALS['comment_seq'];

	$GLOBALS['comments'][ $id ] = (object) array_merge(
		array(
			'comment_ID'       => $id,
			'comment_post_ID'  => 0,
			'comment_content'  => '',
			'comment_type'     => '',
			'comment_parent'   => 0,
			'comment_author'   => '',
			'comment_approved' => 1,
			'comment_date'     => '2026-08-01 10:00:00',
			'user_id'          => 0,
		),
		(array) $data
	);

	// WordPress announces new comments; the reply automation listens for it.
	do_action( 'wp_insert_comment', $id, $GLOBALS['comments'][ $id ] );

	return $id;
}

function get_comment( $id, $output = OBJECT ) { return is_object( $id ) ? $id : ( $GLOBALS['comments'][ (int) $id ] ?? null ); }

function get_comments( $args = array() ) {
	$post = (int) ( $args['post_id'] ?? 0 );
	$type = (string) ( $args['type'] ?? '' );
	$out  = array();

	foreach ( $GLOBALS['comments'] as $comment ) {
		if ( $post && (int) $comment->comment_post_ID !== $post ) { continue; }
		if ( '' !== $type && (string) $comment->comment_type !== $type ) { continue; }
		$out[] = $comment;
	}

	return $out;
}

function wp_delete_comment( $id, $force = false ) { unset( $GLOBALS['comments'][ (int) $id ] ); return true; }
function get_comment_author( $c = 0 ) { $comment = get_comment( $c ); return $comment ? (string) $comment->comment_author : ''; }
function get_comment_date( $f = '', $c = 0 ) { return '۱۴۰۵/۰۶/۰۳'; }
function get_comment_time( $f = '', $g = false, $t = true, $c = 0 ) { return '۱۰:۰۰'; }
function get_avatar_url( $id, $args = array() ) { return 'https://example.ir/avatar.png'; }
function get_avatar( $id, $size = 96, $d = '', $alt = '', $args = array() ) { return '<img src="https://example.ir/avatar.png" alt="" />'; }

/* ------------------------------------------------------------ terms */

function register_taxonomy( $t, $o, $a = array() ) {
	$GLOBALS['taxes'][ $t ] = $a;
	$GLOBALS['tax_objects'][ $t ] = new WP_Taxonomy( $t, ! empty( $a['hierarchical'] ), (string) ( $a['labels']['singular_name'] ?? $t ) );
	return $GLOBALS['tax_objects'][ $t ];
}
function taxonomy_exists( $t ) { return isset( $GLOBALS['taxes'][ $t ] ); }
function get_taxonomy( $t ) { return $GLOBALS['tax_objects'][ $t ] ?? false; }

function term_exists( $term, $taxonomy = '', $parent = null ) {
	foreach ( $GLOBALS['terms'] as $t ) {
		if ( '' !== $taxonomy && $t->taxonomy !== $taxonomy ) { continue; }
		if ( (string) $t->name === (string) $term || (string) $t->slug === (string) $term || (int) $t->term_id === (int) $term ) {
			return array( 'term_id' => (int) $t->term_id, 'term_taxonomy_id' => (int) $t->term_id );
		}
	}
	return null;
}

function wp_insert_term( $term, $taxonomy, $args = array() ) {
	$term = trim( (string) $term );

	if ( '' === $term ) { return new WP_Error( 'empty_term_name', 'A name is required for this term.' ); }

	$existing = term_exists( $term, $taxonomy );

	if ( $existing ) { return new WP_Error( 'term_exists', 'A term with the name provided already exists.', (int) $existing['term_id'] ); }

	$id = ++$GLOBALS['term_seq'];

	$GLOBALS['terms'][ $id ] = new WP_Term( array(
		'term_id'  => $id,
		'name'     => $term,
		'slug'     => (string) ( $args['slug'] ?? sanitize_title( $term ) ),
		'taxonomy' => $taxonomy,
		'parent'   => (int) ( $args['parent'] ?? 0 ),
		'count'    => 0,
	) );

	return array( 'term_id' => $id, 'term_taxonomy_id' => $id );
}

function wp_update_term( $term_id, $taxonomy, $args = array() ) {
	$term = $GLOBALS['terms'][ (int) $term_id ] ?? null;
	if ( ! $term || $term->taxonomy !== $taxonomy ) { return new WP_Error( 'invalid_term', 'Empty Term.' ); }
	if ( isset( $args['name'] ) ) { $term->name = (string) $args['name']; }
	if ( isset( $args['parent'] ) ) { $term->parent = (int) $args['parent']; }
	return array( 'term_id' => (int) $term_id, 'term_taxonomy_id' => (int) $term_id );
}

function wp_delete_term( $term_id, $taxonomy, $args = array() ) {
	$term_id = (int) $term_id;
	$term    = $GLOBALS['terms'][ $term_id ] ?? null;

	if ( ! $term || $term->taxonomy !== $taxonomy ) { return new WP_Error( 'invalid_term', 'Empty Term.' ); }

	foreach ( $GLOBALS['terms'] as $child ) {
		if ( (int) $child->parent === $term_id ) { $child->parent = (int) $term->parent; }
	}

	foreach ( $GLOBALS['object_terms'] as $object_id => $taxes ) {
		foreach ( $taxes as $tax => $ids ) {
			$GLOBALS['object_terms'][ $object_id ][ $tax ] = array_values( array_diff( $ids, array( $term_id ) ) );
		}
	}

	unset( $GLOBALS['terms'][ $term_id ] );

	return true;
}

function get_term( $id, $tax = '', $output = OBJECT ) {
	$term = $GLOBALS['terms'][ (int) $id ] ?? null;
	if ( ! $term ) { return null; }
	if ( '' !== $tax && $term->taxonomy !== $tax ) { return null; }
	return $term;
}

function get_terms( $args = array() ) {
	$tax = is_array( $args ) ? ( $args['taxonomy'] ?? '' ) : $args;
	$out = array();
	foreach ( $GLOBALS['terms'] as $t ) { if ( $t->taxonomy === $tax ) { $out[] = $t; } }
	return $out;
}

function wp_set_object_terms( $object_id, $terms, $taxonomy, $append = false ) {
	$object_id = (int) $object_id;
	$ids       = array();

	foreach ( (array) $terms as $term ) {
		if ( is_numeric( $term ) && isset( $GLOBALS['terms'][ (int) $term ] ) ) { $ids[] = (int) $term; continue; }
		$existing = term_exists( $term, $taxonomy );
		if ( $existing ) { $ids[] = (int) $existing['term_id']; continue; }
		$created = wp_insert_term( (string) $term, $taxonomy );
		if ( is_array( $created ) ) { $ids[] = (int) $created['term_id']; }
	}

	if ( $append ) { $ids = array_merge( (array) ( $GLOBALS['object_terms'][ $object_id ][ $taxonomy ] ?? array() ), $ids ); }

	$GLOBALS['object_terms'][ $object_id ][ $taxonomy ] = array_values( array_unique( $ids ) );

	foreach ( $GLOBALS['terms'] as $t ) {
		if ( $t->taxonomy !== $taxonomy ) { continue; }
		$t->count = 0;
		foreach ( $GLOBALS['object_terms'] as $by_tax ) {
			if ( in_array( (int) $t->term_id, (array) ( $by_tax[ $taxonomy ] ?? array() ), true ) ) { ++$t->count; }
		}
	}

	return $ids;
}

function wp_get_object_terms( $object_ids, $taxonomies, $args = array() ) {
	$out = array();

	foreach ( (array) $object_ids as $object_id ) {
		foreach ( (array) $taxonomies as $taxonomy ) {
			foreach ( (array) ( $GLOBALS['object_terms'][ (int) $object_id ][ $taxonomy ] ?? array() ) as $id ) {
				if ( isset( $GLOBALS['terms'][ (int) $id ] ) ) { $out[ (int) $id ] = $GLOBALS['terms'][ (int) $id ]; }
			}
		}
	}

	if ( 'ids' === ( $args['fields'] ?? '' ) ) { return array_map( 'intval', array_keys( $out ) ); }

	return array_values( $out );
}

function wp_set_post_terms( $post_id, $terms = array(), $taxonomy = 'post_tag', $append = false ) { return wp_set_object_terms( $post_id, $terms, $taxonomy, $append ); }
function wp_get_post_terms( $post_id, $taxonomy = 'post_tag', $args = array() ) { return wp_get_object_terms( $post_id, $taxonomy, $args ); }
function get_the_terms( $p, $tax ) { $terms = wp_get_object_terms( is_object( $p ) ? $p->ID : (int) $p, $tax ); return $terms ?: false; }

/* ------------------------------------------------------------ users */

function get_userdata( $id ) { return $GLOBALS['users_store'][ (string) (int) $id ] ?? false; }
function get_user_by( $field, $value ) {
	if ( 'id' === strtolower( (string) $field ) ) { return $GLOBALS['users_store'][ (string) (int) $value ] ?? false; }
	foreach ( $GLOBALS['users_store'] as $u ) {
		if ( 'email' === $field && $u->user_email === $value ) { return $u; }
		if ( 'login' === $field && $u->user_login === $value ) { return $u; }
	}
	return false;
}
function wp_get_current_user() { return get_userdata( get_current_user_id() ) ?: new WP_User_Stub( 0, 'guest' ); }
function get_current_user_id() { return (int) ( $GLOBALS['current_user_id'] ?? 1 ); }
function is_user_logged_in() { return get_current_user_id() > 0; }

/*
 * `user_caps_override` names capabilities the current user DOES hold while
 * `user_can` is false. Without it a support agent cannot be modelled at all:
 * every capability would answer the same way, so "an agent may open the ticket
 * list but not the settings" is not expressible and a scoping test written
 * against it would be checking nothing.
 */
function current_user_can( $c, ...$a ) {
	if ( isset( $GLOBALS['user_caps_override'] ) && array_key_exists( $c, (array) $GLOBALS['user_caps_override'] ) ) {
		return (bool) $GLOBALS['user_caps_override'][ $c ];
	}
	return ! isset( $GLOBALS['user_can'] ) || (bool) $GLOBALS['user_can'];
}
function user_can( $user, $cap, ...$a ) { return current_user_can( $cap ); }

function get_users( $args = array() ) {
	$users = array_values( $GLOBALS['users_store'] ?? array() );
	$role  = (string) ( $args['role'] ?? '' );

	if ( '' !== $role ) {
		$users = array_values( array_filter( $users, static fn( $u ) => in_array( $role, (array) $u->roles, true ) ) );
	}

	if ( ! empty( $args['include'] ) ) {
		$include = array_map( 'intval', (array) $args['include'] );
		$users   = array_values( array_filter( $users, static fn( $u ) => in_array( (int) $u->ID, $include, true ) ) );
	}

	if ( in_array( (string) ( $args['fields'] ?? '' ), array( 'ID', 'ids' ), true ) ) {
		return array_map( static fn( $u ) => (int) $u->ID, $users );
	}

	usort( $users, static fn( $a, $b ) => strcmp( (string) $a->display_name, (string) $b->display_name ) );

	return $users;
}

function get_role( $r ) { return $GLOBALS['roles_store'][ $r ] ?? null; }
function add_role( $r, $n, $c = array() ) { $GLOBALS['roles_store'][ $r ] = new WP_Role_Stub( $n, $c ); return $GLOBALS['roles_store'][ $r ]; }
function remove_role( $r ) { unset( $GLOBALS['roles_store'][ $r ] ); }
function wp_login_url( $redirect = '', $force = false ) { return 'https://example.ir/wp-login.php'; }
function get_edit_user_link( $id = null ) { return 'https://example.ir/wp-admin/user-edit.php?user_id=' . (int) $id; }

/* ------------------------------------------------------------ misc */

function get_bloginfo( $s = '', $f = 'raw' ) { return 'name' === $s ? 'Iran Exim' : 'https://example.ir'; }
function home_url( $p = '', $sc = null ) { return 'https://example.ir' . $p; }
function site_url( $p = '', $sc = null ) { return 'https://example.ir' . $p; }
function admin_url( $p = '', $sc = 'admin' ) { return 'https://example.ir/wp-admin/' . $p; }
function rest_url( $p = '', $sc = 'rest' ) { return 'https://example.ir/wp-json/' . ltrim( (string) $p, '/' ); }
function plugin_dir_path( $f ) { return rtrim( dirname( (string) $f ), '/' ) . '/'; }
function plugin_dir_url( $f ) { return 'https://example.ir/wp-content/plugins/wp-event-publisher/'; }
function plugin_basename( $f ) { return basename( (string) $f ); }
function plugins_url( $p = '', $f = '' ) { return 'https://example.ir/wp-content/plugins/' . ltrim( (string) $p, '/' ); }
function register_activation_hook( $f, $cb ) { $GLOBALS['activate_cb'] = $cb; }
function register_deactivation_hook( $f, $cb ) { $GLOBALS['deactivate_cb'] = $cb; }
function is_admin() { return (bool) $GLOBALS['is_admin']; }
function wp_doing_ajax() { return false; }
function wp_doing_cron() { return false; }
function is_singular( $t = '' ) { return false; }
function is_page( $p = '' ) { return false; }
function current_time( $type = 'mysql', $gmt = 0 ) { return 'timestamp' === $type ? time() : gmdate( 'Y-m-d H:i:s' ); }
function wp_date( $f, $t = null, $tz = null ) { return gmdate( (string) $f, $t ?: time() ); }
function date_i18n( $f, $t = false, $g = false ) { return gmdate( (string) $f, $t ?: time() ); }
function human_time_diff( $from, $to = 0 ) { return 'چند دقیقه'; }
function wp_rand( $a = 0, $b = 0 ) { return $b > $a ? random_int( (int) $a, (int) $b ) : (int) $a; }
function wp_generate_uuid4() { return sprintf( '%04x%04x-%04x-%04x-%04x-%04x%04x%04x', wp_rand( 0, 0xffff ), wp_rand( 0, 0xffff ), wp_rand( 0, 0xffff ), wp_rand( 0, 0x0fff ) | 0x4000, wp_rand( 0, 0x3fff ) | 0x8000, wp_rand( 0, 0xffff ), wp_rand( 0, 0xffff ), wp_rand( 0, 0xffff ) ); }
function wp_generate_password( $l = 12, $s = true, $x = false ) { return substr( str_repeat( 'aB3', 20 ), 0, (int) $l ); }
function wp_create_nonce( $a = -1 ) { return 'nonce-' . md5( (string) $a ); }
function wp_verify_nonce( $n, $a = -1 ) { return 'nonce-' . md5( (string) $a ) === $n ? 1 : false; }
function check_admin_referer( $a = -1, $q = '_wpnonce' ) { return 1; }
function check_ajax_referer( $a = -1, $q = false, $die = true ) { return 1; }
function wp_nonce_field( $a = -1, $n = '_wpnonce', $r = true, $echo = true ) {
	$out = '<input type="hidden" name="' . esc_attr( $n ) . '" value="' . esc_attr( wp_create_nonce( $a ) ) . '" />';
	if ( $echo ) { echo $out; }
	return $out;
}
function submit_button( $text = null, $type = 'primary', $name = 'submit', $wrap = true, $other = null ) {
	echo '<button type="submit" class="button button-' . esc_attr( $type ) . '" name="' . esc_attr( (string) $name ) . '">' . esc_html( (string) ( $text ?? 'Save Changes' ) ) . '</button>';
}
function add_query_arg( ...$args ) {
	if ( is_array( $args[0] ) ) {
		$params = $args[0];
		$url    = $args[1] ?? '';
	} else {
		$params = array( $args[0] => $args[1] );
		$url    = $args[2] ?? '';
	}
	$parts = explode( '#', (string) $url, 2 );
	$base  = $parts[0];
	$sep   = str_contains( $base, '?' ) ? '&' : '?';
	$query = http_build_query( $params );
	return $base . ( '' !== $query ? $sep . $query : '' ) . ( isset( $parts[1] ) ? '#' . $parts[1] : '' );
}
function remove_query_arg( $k, $url = '' ) { return (string) $url; }

class WPEP_Redirect extends \Exception {
	public string $target = '';
	public function __construct( string $target ) { $this->target = $target; parent::__construct( 'redirect:' . $target ); }
}
function wp_safe_redirect( $location, $status = 302, $x = '' ) { $GLOBALS['last_redirect'] = (string) $location; throw new WPEP_Redirect( (string) $location ); }
function wp_redirect( $location, $status = 302, $x = '' ) { return wp_safe_redirect( $location, $status, $x ); }
function wp_die( $m = '', $t = '', $a = array() ) { throw new \RuntimeException( 'wp_die: ' . ( is_object( $m ) ? 'error' : (string) $m ) ); }

/* ------------------------------------------------------------ cron */

function wp_next_scheduled( $h, $a = array() ) { return $GLOBALS['cron'][ $h ]['time'] ?? false; }
function wp_schedule_event( $t, $r, $h, $a = array() ) { $GLOBALS['cron'][ $h ] = array( 'time' => (int) $t, 'args' => $a, 'recurrence' => $r ); return true; }
function wp_schedule_single_event( $t, $h, $a = array(), $e = false ) { $GLOBALS['cron'][ $h ] = array( 'time' => (int) $t, 'args' => $a, 'recurrence' => '' ); return true; }
function wp_clear_scheduled_hook( $h, $a = array() ) { unset( $GLOBALS['cron'][ $h ] ); return 1; }
function wp_unschedule_hook( $h ) { unset( $GLOBALS['cron'][ $h ] ); return 1; }

/* ------------------------------------------------------------ assets */

function wp_enqueue_style( $h, $src = '', $d = array(), $v = false, $m = 'all' ) { $GLOBALS['styles'][ $h ] = $src; }
function wp_enqueue_script( $h, $src = '', $d = array(), $v = false, $f = false ) { $GLOBALS['scripts'][ $h ] = $src; }
function wp_register_style( $h, $src = '', $d = array(), $v = false, $m = 'all' ) { $GLOBALS['styles'][ $h ] = $src; return true; }
function wp_register_script( $h, $src = '', $d = array(), $v = false, $f = false ) { $GLOBALS['scripts'][ $h ] = $src; return true; }
function wp_localize_script( $h, $n, $d ) { $GLOBALS['localized'][ $h ][ $n ] = $d; return true; }
function wp_add_inline_script( $h, $d, $p = 'after' ) { $GLOBALS['inline_scripts'][ $h ][] = $d; return true; }
function wp_add_inline_style( $h, $d ) { $GLOBALS['inline_styles'][ $h ][] = $d; return true; }
function wp_script_is( $h, $l = 'enqueued' ) { return isset( $GLOBALS['scripts'][ $h ] ); }
function wp_style_is( $h, $l = 'enqueued' ) { return isset( $GLOBALS['styles'][ $h ] ); }
function wp_enqueue_media( $a = array() ) { return true; }
function add_shortcode( $t, $cb ) { $GLOBALS['shortcodes'][ $t ] = $cb; }
function shortcode_atts( $pairs, $atts, $sc = '' ) { return array_merge( (array) $pairs, array_intersect_key( (array) $atts, (array) $pairs ) ); }
function do_shortcode( $c ) { return $c; }

/* ------------------------------------------------------------ media */

function wp_get_attachment_url( $id ) { return $id > 0 && isset( $GLOBALS['attachments'][ (int) $id ] ) ? 'https://example.ir/uploads/file-' . (int) $id : false; }
function wp_get_attachment_image_url( $id, $size = 'thumbnail' ) { return wp_get_attachment_url( $id ); }
function wp_get_attachment_image( $id, $size = 'thumbnail', $icon = false, $attr = '' ) { return '<img src="' . esc_url( (string) wp_get_attachment_url( $id ) ) . '" alt="" />'; }
function wp_attachment_is_image( $id = 0 ) { return ! empty( $GLOBALS['attachments'][ (int) $id ]['is_image'] ); }
function get_post_mime_type( $id = 0 ) { return (string) ( $GLOBALS['attachments'][ (int) $id ]['mime'] ?? '' ); }

/*
 * Models the part of media_handle_upload() the plugin depends on: an upload
 * WordPress would reject yields a WP_Error and no attachment. A stub that
 * always returned an id would let "a disallowed file is refused" pass without
 * any check existing.
 */
function media_handle_upload( $field, $post_id, $post_data = array(), $overrides = array() ) {
	$file = $_FILES[ $field ] ?? null;

	if ( ! $file || ! empty( $file['error'] ) ) { return new WP_Error( 'upload_error', 'The uploaded file could not be moved.' ); }

	$name      = (string) $file['name'];
	$extension = strtolower( (string) pathinfo( $name, PATHINFO_EXTENSION ) );
	$images    = array( 'jpg', 'jpeg', 'png', 'gif', 'webp' );
	$allowed   = array_merge( $images, array( 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'zip' ) );

	if ( ! in_array( $extension, $allowed, true ) ) { return new WP_Error( 'invalid_file_type', 'Sorry, you are not allowed to upload this file type.' ); }

	$id = ( $GLOBALS['attachment_seq'] = ( $GLOBALS['attachment_seq'] ?? 900 ) + 1 );

	$GLOBALS['attachments'][ $id ] = array(
		'name'     => $name,
		'is_image' => in_array( $extension, $images, true ),
		'mime'     => in_array( $extension, $images, true ) ? 'image/' . $extension : 'application/' . $extension,
	);

	$GLOBALS['posts'][ $id ] = new WP_Post( array( 'ID' => $id, 'post_type' => 'attachment', 'post_title' => $name ) );

	return $id;
}

/* ------------------------------------------------------------ mail & http */

function wp_mail( $to, $subject, $message, $headers = '', $attachments = array() ) {
	$GLOBALS['sent_mail'][] = array( 'to' => $to, 'subject' => $subject, 'message' => $message, 'headers' => $headers );
	return true;
}
function wp_remote_post( $url, $args = array() ) { $GLOBALS['http_posts'][] = array( 'url' => $url, 'args' => $args ); return array( 'response' => array( 'code' => 200 ), 'body' => '{"ok":true}' ); }
function wp_remote_get( $url, $args = array() ) { $GLOBALS['http_gets'][] = array( 'url' => $url, 'args' => $args ); return array( 'response' => array( 'code' => 200 ), 'body' => '{"ok":true}' ); }
function wp_remote_retrieve_body( $r ) { return is_array( $r ) ? (string) ( $r['body'] ?? '' ) : ''; }
function wp_remote_retrieve_response_code( $r ) { return is_array( $r ) ? (int) ( $r['response']['code'] ?? 0 ) : 0; }

/* ------------------------------------------------------------ REST */

class WP_REST_Request {
	private array $params;
	private array $headers;
	public function __construct( array $params = array(), array $headers = array() ) { $this->params = $params; $this->headers = $headers; }
	public function get_param( $k ) { return $this->params[ $k ] ?? null; }
	public function set_param( $k, $v ) { $this->params[ $k ] = $v; }
	public function get_params() { return $this->params; }
	public function get_header( $k ) { return $this->headers[ strtolower( (string) $k ) ] ?? ''; }
	public function get_json_params() { return $this->params; }
}

class WP_REST_Response {
	public $data;
	public $status;
	public function __construct( $data = null, $status = 200 ) { $this->data = $data; $this->status = $status; }
	public function get_data() { return $this->data; }
	public function get_status() { return $this->status; }
}

function register_rest_route( $ns, $route, $args = array(), $override = false ) { $GLOBALS['rest_routes'][ $ns . $route ] = $args; return true; }
function rest_ensure_response( $r ) { return $r instanceof WP_REST_Response ? $r : new WP_REST_Response( $r ); }
function wp_send_json_success( $d = null, $s = null ) { throw new WPEP_Json( array( 'success' => true, 'data' => $d ) ); }
function wp_send_json_error( $d = null, $s = null ) { throw new WPEP_Json( array( 'success' => false, 'data' => $d ) ); }
function wp_send_json( $d, $s = null ) { throw new WPEP_Json( $d ); }

class WPEP_Json extends \Exception {
	public $payload;
	public function __construct( $payload ) { $this->payload = $payload; parent::__construct( 'json' ); }
}

/* ------------------------------------------------------------ post types */

function register_post_type( $t, $a = array() ) { $GLOBALS['post_types'][ $t ] = $a; $GLOBALS['pt_objects'][ $t ] = (object) array( 'name' => $t, 'labels' => (object) array( 'singular_name' => (string) ( $a['labels']['singular_name'] ?? $t ), 'name' => (string) ( $a['labels']['name'] ?? $t ) ), 'public' => ! empty( $a['public'] ) ); return $GLOBALS['pt_objects'][ $t ]; }
function post_type_exists( $t ) { return isset( $GLOBALS['post_types'][ $t ] ); }
function get_post_type_object( $t ) { return $GLOBALS['pt_objects'][ $t ] ?? null; }
function get_post_types( $args = array(), $output = 'names' ) {
	$out = $GLOBALS['pt_objects'] ?? array();
	if ( isset( $args['public'] ) ) {
		$out = array_filter( $out, static fn( $o ) => (bool) $o->public === (bool) $args['public'] );
	}
	return 'objects' === $output ? $out : array_keys( $out );
}
function get_post_stati( $a = array(), $o = 'names' ) { return array( 'publish', 'draft', 'pending', 'trash', 'private' ); }
function get_post_status_object( $s ) { return (object) array( 'label' => ucfirst( (string) $s ) ); }
function flush_rewrite_rules( $hard = true ) { return true; }
function get_page_by_path( $p, $o = OBJECT, $t = 'page' ) { return null; }
function wp_get_current_commenter() { return array( 'comment_author' => '', 'comment_author_email' => '' ); }
function get_object_taxonomies( $t, $o = 'names' ) { return array(); }
function dbDelta( $q, $execute = true ) { return array(); }
function wp_parse_args( $args, $defaults = array() ) {
	if ( is_object( $args ) ) { $args = get_object_vars( $args ); }
	if ( ! is_array( $args ) ) { parse_str( (string) $args, $args ); }
	return is_array( $defaults ) ? array_merge( $defaults, $args ) : $args;
}
function wp_list_pluck( $list, $field, $index_key = null ) {
	$out = array();
	foreach ( (array) $list as $k => $item ) {
		$value = is_object( $item ) ? ( $item->$field ?? null ) : ( $item[ $field ] ?? null );
		if ( null === $index_key ) { $out[] = $value; } else {
			$idx = is_object( $item ) ? ( $item->$index_key ?? $k ) : ( $item[ $index_key ] ?? $k );
			$out[ $idx ] = $value;
		}
	}
	return $out;
}
function wp_list_filter( $list, $args = array(), $op = 'AND' ) { return $list; }
function is_email( $e ) { return (bool) filter_var( (string) $e, FILTER_VALIDATE_EMAIL ); }
function trailingslashit( $s ) { return rtrim( (string) $s, '/\\' ) . '/'; }
function untrailingslashit( $s ) { return rtrim( (string) $s, '/\\' ); }
function wp_normalize_path( $s ) { return str_replace( '\\', '/', (string) $s ); }
function wp_upload_dir( $t = null, $create = true, $refresh = false ) { return array( 'path' => '/tmp/uploads', 'url' => 'https://example.ir/uploads', 'basedir' => '/tmp/uploads', 'baseurl' => 'https://example.ir/uploads', 'error' => false ); }
function size_format( $b, $d = 0 ) { return number_format( (float) $b / 1024, (int) $d ) . ' KB'; }
function wp_slash( $v ) { return $v; }
function wp_hash( $d, $s = 'auth' ) { return md5( (string) $d ); }
function wp_timezone_string() { return 'Asia/Tehran'; }
function wp_timezone() { return new \DateTimeZone( 'UTC' ); }
function get_gmt_from_date( $d, $f = 'Y-m-d H:i:s' ) { return gmdate( (string) $f, strtotime( (string) $d ) ?: time() ); }
function get_date_from_gmt( $d, $f = 'Y-m-d H:i:s' ) { return gmdate( (string) $f, strtotime( (string) $d ) ?: time() ); }
function mysql2date( $f, $d, $translate = true ) { return gmdate( (string) $f, strtotime( (string) $d ) ?: time() ); }
function _doing_it_wrong( $f, $m, $v ) {}
function _deprecated_function( $f, $v, $r = '' ) {}
function wp_is_mobile() { return false; }
function get_locale() { return 'fa_IR'; }
function is_rtl() { return true; }
function wp_kses( $t, $allowed = array(), $protocols = array() ) { return wp_kses_post( $t ); }
function force_balance_tags( $t ) { return (string) $t; }
function make_clickable( $t ) { return (string) $t; }
function get_post_field( $field, $post = null, $context = 'display' ) { $p = get_post( $post ); return $p ? ( $p->$field ?? '' ) : ''; }
function get_the_author_meta( $f, $id = false ) { $u = get_userdata( (int) $id ); return $u ? ( $u->$f ?? '' ) : ''; }
function get_userdata_by_email( $e ) { return get_user_by( 'email', $e ); }
function count_users() { return array( 'total_users' => count( $GLOBALS['users_store'] ) ); }
function wp_count_posts( $type = 'post', $perm = '' ) { return (object) array( 'publish' => 0, 'draft' => 0, 'pending' => 0 ); }
function paginate_links( $args = array() ) { return ''; }
function wp_dropdown_categories( $args = array() ) { return ''; }
function settings_fields( $g ) {}
function do_settings_sections( $p ) {}
function register_setting( $g, $o, $a = array() ) {}
function add_settings_error( $s, $c, $m, $t = 'error' ) {}
function screen_icon() {}
function get_current_screen() { return null; }
function wp_get_referer() { return ''; }
function status_header( $c ) {}
function nocache_headers() {}
function wp_get_environment_type() { return 'production'; }
function maybe_serialize( $d ) { return is_array( $d ) || is_object( $d ) ? serialize( $d ) : $d; }
function maybe_unserialize( $d ) { $r = @unserialize( (string) $d ); return false === $r && 'b:0;' !== $d ? $d : $r; }

/* ------------------------------------------------------------ admin menu */

function add_menu_page( $page_title, $menu_title, $cap, $slug, $cb = '', $icon = '', $pos = null ) {
	$GLOBALS['top_menus'][ $slug ] = $menu_title;
	$GLOBALS['menus'][ $slug ]     = $cb;

	return 'toplevel_page_' . $slug;
}

function add_submenu_page( $parent, $page_title, $menu_title, $cap, $slug, $cb = '', $pos = null ) {
	$GLOBALS['submenus'][ $parent ][ $slug ] = $menu_title;
	$GLOBALS['menus'][ $slug ]               = $cb;

	return $parent . '_page_' . $slug;
}

function remove_menu_page( $slug ) { unset( $GLOBALS['top_menus'][ $slug ] ); return null; }
function remove_submenu_page( $parent, $slug ) { unset( $GLOBALS['submenus'][ $parent ][ $slug ] ); return null; }
function add_menu_classes( $menu ) { return $menu; }
function menu_page_url( $slug, $echo = true ) { $u = 'https://example.ir/wp-admin/admin.php?page=' . $slug; if ( $echo ) { echo $u; } return $u; }

/* --- Functions the plugin calls but whose return value it never inspects. */

function load_plugin_textdomain( $d, $x = false, $p = '' ) { return true; }
function wp_is_post_revision( $p ) { return false; }
function is_protected_meta( $key, $type = '' ) { return str_starts_with( (string) $key, '_' ); }
function has_post_thumbnail( $p = null ) { return false; }
function get_children( $a = array(), $o = OBJECT ) { return array(); }
function wc_get_order( $id ) { return $GLOBALS['wc_orders'][ (int) $id ] ?? false; }
function wp_is_post_autosave( $p ) { return false; }

/* ------------------------------------------------------------ the report */

$GLOBALS['failures'] = array();

function check( string $label, bool $ok, string $detail = '' ): void {
	if ( $ok ) {
		echo "PASS {$label}" . ( '' !== $detail ? " — {$detail}" : '' ) . "\n";
		return;
	}

	$GLOBALS['failures'][] = $label . ( '' !== $detail ? " ({$detail})" : '' );
	echo "FAIL {$label}" . ( '' !== $detail ? " — {$detail}" : '' ) . "\n";
}

function wpep_report( string $suite ): void {
	echo "\n";

	if ( empty( $GLOBALS['failures'] ) ) {
		echo "ALL {$suite} CHECKS PASSED\n";
		exit( 0 );
	}

	printf( "%d FAILURE(S):\n", count( $GLOBALS['failures'] ) );

	foreach ( $GLOBALS['failures'] as $failure ) { echo " - {$failure}\n"; }

	exit( 1 );
}

set_error_handler(
	static function ( $no, $str, $file, $line ) {
		if ( ! ( error_reporting() & $no ) ) { return false; }
		check( 'PHP diagnostic', false, sprintf( '%s in %s:%d', $str, basename( (string) $file ), $line ) );
		return true;
	}
);
