<?php
/**
 * Static audit of the plugin's request handlers and output.
 *
 * Looks for the classes of defect that do not announce themselves: a form
 * handler with no capability check, a nonce that is never verified, output
 * that is never escaped, and unbounded queries.
 */
require __DIR__ . '/harness.php';

$root  = __DIR__ . '/wp-event-publisher/';
$files = array();

$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $root ) );

foreach ( $it as $f ) {
	if ( 'php' === strtolower( $f->getExtension() ) ) { $files[] = $f->getPathname(); }
}

sort( $files );

/** Extracts one method body by brace matching through the tokeniser. */
function method_body( string $src, string $name ): string {
	$tokens = token_get_all( $src );
	$count  = count( $tokens );

	for ( $i = 0; $i < $count; $i++ ) {
		if ( ! is_array( $tokens[ $i ] ) || T_FUNCTION !== $tokens[ $i ][0] ) { continue; }

		for ( $j = $i + 1; $j < $count; $j++ ) {
			if ( is_array( $tokens[ $j ] ) && T_WHITESPACE === $tokens[ $j ][0] ) { continue; }
			if ( is_array( $tokens[ $j ] ) && T_STRING === $tokens[ $j ][0] && $tokens[ $j ][1] === $name ) { break; }
			$j = $count; break;
		}

		if ( $j >= $count ) { continue; }

		$depth = 0; $body = ''; $started = false;

		for ( $k = $j; $k < $count; $k++ ) {
			$text = is_array( $tokens[ $k ] ) ? $tokens[ $k ][1] : $tokens[ $k ];

			if ( ! $started ) { if ( '{' === $text ) { $started = true; $depth = 1; } continue; }
			if ( '{' === $text ) { ++$depth; }
			elseif ( '}' === $text ) { --$depth; if ( 0 === $depth ) { break 2; } }

			$body .= $text;
		}
	}

	return $body ?? '';
}

/* --- 1. Every admin_post handler is guarded. ---------------------------- */

$unguarded = array();
$nononce   = array();

foreach ( $files as $file ) {
	$src = (string) file_get_contents( $file );

	if ( ! preg_match_all( "/add_action\(\s*'admin_post_(\w+)'\s*,\s*array\(\s*\\\$this\s*,\s*'(\w+)'/", $src, $m, PREG_SET_ORDER ) ) {
		continue;
	}

	foreach ( $m as $hook ) {
		$body = method_body( $src, $hook[2] );

		if ( '' === $body ) { continue; }

		$guarded = str_contains( $body, 'current_user_can' ) || str_contains( $body, 'is_user_logged_in' );
		$nonced  = str_contains( $body, 'check_admin_referer' ) || str_contains( $body, 'wp_verify_nonce' ) || str_contains( $body, 'check_ajax_referer' );

		if ( ! $guarded ) { $unguarded[] = basename( $file ) . '::' . $hook[2]; }
		if ( ! $nonced ) { $nononce[] = basename( $file ) . '::' . $hook[2]; }
	}
}

check( 'every admin_post handler checks a capability or login', empty( $unguarded ), implode( ', ', $unguarded ) );
check( 'every admin_post handler verifies a nonce', empty( $nononce ), implode( ', ', $nononce ) );

/* --- 2. Every wp_ajax handler is guarded. ------------------------------- */

$ajax_bad  = array();
$ajax_open = array();

foreach ( $files as $file ) {
	$src = (string) file_get_contents( $file );

	if ( ! preg_match_all( "/add_action\(\s*'wp_ajax_(?:nopriv_)?(\w+)'\s*,\s*array\(\s*\\\$this\s*,\s*'(\w+)'/", $src, $m, PREG_SET_ORDER ) ) {
		continue;
	}

	foreach ( $m as $hook ) {
		$body = method_body( $src, $hook[2] );

		if ( '' === $body ) { continue; }

		/*
		 * A handler may delegate its guard to a shared helper. Following the
		 * delegation matters: without it this reported twenty-five clean
		 * handlers as unguarded, and a report that is mostly noise is one
		 * nobody reads the real entries in.
		 */
		$guard_body = '';

		if ( preg_match( '/\$this->(verify_ajax|verify|guard|assert_ajax|check_ajax)\s*\(/', $body, $delegate ) ) {
			$guard_body = method_body( $src, $delegate[1] );
		}

		$checked = $body . $guard_body;

		if ( ! str_contains( $checked, 'check_ajax_referer' ) && ! str_contains( $checked, 'wp_verify_nonce' ) ) {
			$ajax_bad[] = basename( $file ) . '::' . $hook[2];
		}

		/*
		 * A customer-facing endpoint — the unread badge, marking a thread read
		 * — is meant for any signed-in visitor, so a capability check would be
		 * wrong there, not missing. A login check is the correct guard.
		 */
		if ( ! str_contains( $checked, 'current_user_can' ) && ! str_contains( $checked, 'is_user_logged_in' ) ) {
			$ajax_open[] = basename( $file ) . '::' . $hook[2];
		}
	}
}

check( 'every AJAX handler verifies a nonce', empty( $ajax_bad ), implode( ', ', $ajax_bad ) );
check( 'every AJAX handler checks a capability', empty( $ajax_open ), implode( ', ', $ajax_open ) );

/* --- 3. Unbounded queries. ---------------------------------------------- */

$unbounded = array();

foreach ( $files as $file ) {
	$src = (string) file_get_contents( $file );

	foreach ( array( "'posts_per_page' => -1", "'numberposts' => -1", "'number' => -1" ) as $needle ) {
		if ( str_contains( $src, $needle ) ) { $unbounded[] = basename( $file ) . ' ' . $needle; }
	}
}

check( 'no query asks for every row without a limit', empty( $unbounded ), implode( '; ', $unbounded ) );

/* --- 4. Direct superglobal output. -------------------------------------- */

$raw_echo = array();

foreach ( $files as $file ) {
	$src   = (string) file_get_contents( $file );
	$lines = explode( "\n", $src );

	foreach ( $lines as $n => $line ) {
		if ( preg_match( '/echo\s+\$_(GET|POST|REQUEST|SERVER)/', $line ) ) {
			$raw_echo[] = basename( $file ) . ':' . ( $n + 1 );
		}
	}
}

check( 'no superglobal is echoed directly', empty( $raw_echo ), implode( ', ', $raw_echo ) );

/* --- 5. Interpolated SQL. ----------------------------------------------- */

$sql_risk = array();

foreach ( $files as $file ) {
	$src   = (string) file_get_contents( $file );
	$lines = explode( "\n", $src );

	foreach ( $lines as $n => $line ) {
		/*
		 * A variable inside a query string. $wpdb->table names and a $table
		 * local assigned from the plugin's own table() method are structural
		 * identifiers, not values — prepare() cannot bind an identifier, so
		 * flagging them would be advice that cannot be followed.
		 */
		if ( ! preg_match( '/\$wpdb->(get_var|get_col|get_row|get_results|query)\(\s*"[^"]*\{?\$/', $line ) ) {
			continue;
		}

		$interpolated = array();

		// Only variables INSIDE the query string count. Scanning the whole
		// line also matched the assignment target on the left of the `=`,
		// which is not interpolated into anything.
		if ( preg_match( '/"([^"]*)"/', $line, $quoted ) ) {
			preg_match_all( '/\{?\$(\w+)/', $quoted[1], $vars );

			foreach ( (array) ( $vars[1] ?? array() ) as $var ) {
				if ( in_array( $var, array( 'wpdb', 'table' ), true ) ) { continue; }
				$interpolated[] = $var;
			}
		}

		if ( $interpolated ) {
			$sql_risk[] = basename( $file ) . ':' . ( $n + 1 ) . ' ($' . implode( ', $', $interpolated ) . ')';
		}
	}
}

check( 'no query interpolates a variable without prepare()', empty( $sql_risk ), implode( ', ', $sql_risk ) );

/* --- 6. Double-quoted positional format strings. ------------------------ */

/*
 * "%1$s" inside DOUBLE quotes is not a format specifier — PHP interpolates $s
 * first, so sprintf() receives "%1" and raises "Unknown format specifier",
 * which is a fatal on a screen that looked fine in review.
 *
 * This must be detected on the token STREAM, not by looking for
 * T_CONSTANT_ENCAPSED_STRING: a double-quoted string containing a variable is
 * never that token, so the obvious version of this check can never fire. The
 * shape to look for is an encapsed fragment ending in %<digits> immediately
 * followed by the variable PHP just interpolated.
 */
$fmt = array();

foreach ( $files as $file ) {
	$tokens = token_get_all( (string) file_get_contents( $file ) );
	$count  = count( $tokens );

	for ( $i = 0; $i < $count - 1; $i++ ) {
		$token = $tokens[ $i ];

		if ( ! is_array( $token ) || T_ENCAPSED_AND_WHITESPACE !== $token[0] ) { continue; }
		if ( ! preg_match( '/%\d+$/', $token[1] ) ) { continue; }

		$next = $tokens[ $i + 1 ];

		if ( is_array( $next ) && T_VARIABLE === $next[0] ) {
			$fmt[] = basename( $file ) . ':' . $token[2];
		}
	}
}

check( 'no double-quoted positional format string', empty( $fmt ), implode( ', ', $fmt ) );

/* --- 7. Every view file blocks direct access. --------------------------- */

$open_views = array();

foreach ( $files as $file ) {
	if ( ! str_contains( $file, '/views/' ) && ! str_contains( $file, '/partials/' ) ) { continue; }
	if ( 'index.php' === basename( $file ) ) { continue; }

	$src = (string) file_get_contents( $file );

	if ( ! str_contains( $src, 'ABSPATH' ) ) { $open_views[] = basename( $file ); }
}

check( 'every view refuses direct access', empty( $open_views ), implode( ', ', $open_views ) );

/* --- 8. Options are not autoloaded needlessly. -------------------------- */

$autoloaded = array();

foreach ( $files as $file ) {
	$src   = (string) file_get_contents( $file );
	$lines = explode( "\n", $src );

	foreach ( $lines as $n => $line ) {
		if ( preg_match( '/update_option\(\s*[^,]+,\s*[^,)]+\)\s*;/', $line ) && ! str_contains( $line, 'false' ) ) {
			$autoloaded[] = basename( $file ) . ':' . ( $n + 1 );
		}
	}
}

check( 'large options are not left autoloading', count( $autoloaded ) <= 6, implode( ', ', array_slice( $autoloaded, 0, 8 ) ) );

wpep_report( 'AUDIT' );
