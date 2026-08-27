<?php
/** Boots the plugin the way WordPress does, for the test harnesses. */
require __DIR__ . '/harness.php';

$GLOBALS['wpep_root'] = __DIR__ . '/wp-event-publisher/';

require $GLOBALS['wpep_root'] . 'wp-event-publisher.php';

do_action( 'activate_wpep' );

if ( isset( $GLOBALS['activate_cb'] ) && is_callable( $GLOBALS['activate_cb'] ) ) {
	( $GLOBALS['activate_cb'] )();
}

wpep()->boot();
do_action( 'init' );
