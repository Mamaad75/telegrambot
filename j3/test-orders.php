<?php
/**
 * WooCommerce order notifications: where they go, and whether they start.
 *
 * "Where does this section send orders? Nothing shows up even though it is on."
 *
 * Two separate causes. The screen named the platform and nothing else — not
 * the channel, not whether anything had ever been queued — so a missing channel
 * id and a working one looked identical. And only orders created through the
 * checkout form ever raised the event: `woocommerce_checkout_order_created`
 * does not fire for an order made in wp-admin, over the REST API, or by a
 * gateway that builds the order itself.
 *
 * @package WPEventPublisherAudit
 */

require __DIR__ . '/boot.php';

use WPEventPublisher\Field;
use WPEventPublisher\Settings;
use WPEventPublisher\WooCommerceOrders;

/**
 * The callback method names registered on one action.
 *
 * @param string $hook Action name.
 *
 * @return string[] Method names.
 */
function wpep_hooked( string $hook ): array {
	$out = array();

	foreach ( (array) ( $GLOBALS['actions'][ $hook ] ?? array() ) as $priority ) {
		foreach ( (array) $priority as $entry ) {
			$cb = is_array( $entry ) ? ( $entry['function'] ?? $entry ) : $entry;
			$out[] = is_array( $cb ) ? (string) ( $cb[1] ?? '' ) : ( is_string( $cb ) ? $cb : 'closure' );
		}
	}

	return $out;
}

/* =====================================================================
 * 1. THE REPORTED DEFECT: only checkout orders raised the event.
 * ================================================================== */

/*
 * The order hooks are registered only when WooCommerce is present — a site
 * without it pays nothing and raises no notice. So the shop has to exist
 * before register() is called, or this section would test a no-op.
 */
require_once __DIR__ . '/harness-woocommerce.php';

check( 'the test shop is present', WPEventPublisher\WooCommerceOrder::available() );

$orders = wpep()->orders();
$orders->register();

check(
	'checkout orders are still covered',
	in_array( 'on_created', wpep_hooked( 'woocommerce_checkout_order_created' ), true ),
	implode( ', ', wpep_hooked( 'woocommerce_checkout_order_created' ) )
);

/*
 * The gap. An order placed by an administrator, by the REST API, by a
 * subscription renewal or by a gateway that creates the order itself never
 * touches the checkout hook — so on those shops "new order" was switched on
 * and never fired once.
 */
check(
	'and so is every other way an order is created',
	in_array( 'on_new_order', wpep_hooked( 'woocommerce_new_order' ), true ),
	implode( ', ', wpep_hooked( 'woocommerce_new_order' ) )
);

check(
	'status transitions are covered',
	in_array( 'on_status_changed', wpep_hooked( 'woocommerce_order_status_changed' ), true )
);

/*
 * The two creation hooks overlap on a checkout order. That is what the
 * per-order idempotency marker exists for, so the overlap must not be read as
 * a reason to drop one of them.
 */
$source = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-woo-commerce-orders.php' );

check(
	'creation is de-duplicated per order rather than per hook',
	str_contains( $source, 'META_ANNOUNCED' ) && str_contains( $source, 'in_array( $key, $sent, true )' )
);

/*
 * `woocommerce_new_order` passes the id first and the object second — the
 * opposite of the checkout hook. One callback with a guessed signature would
 * read the id out of the wrong argument and send nothing.
 */
check(
	'the id-first hook has its own entry point',
	method_exists( $orders, 'on_new_order' )
);

$reflection = new ReflectionMethod( $orders, 'on_new_order' );
$params     = $reflection->getParameters();

check(
	'whose first argument is the order id',
	isset( $params[0] ) && 'order_id' === $params[0]->getName(),
	isset( $params[0] ) ? $params[0]->getName() : 'none'
);

check(
	'and whose second argument is optional, since not every caller passes one',
	isset( $params[1] ) && $params[1]->isOptional()
);

/* =====================================================================
 * 2. The screen can answer "where does it send?"
 * ================================================================== */

$view = (string) file_get_contents( $GLOBALS['wpep_root'] . 'admin/views/woocommerce.php' );

check(
	'the destination is printed, not only the platform name',
	str_contains( $view, 'wpep-order-destinations' )
);

foreach ( array( 'channel_id', 'chat_id', 'recipient' ) as $wpep_key ) {
	check(
		'it reads the address key ' . $wpep_key . ' that platform actually uses',
		str_contains( $view, "'" . $wpep_key . "'" )
	);
}

/*
 * A platform switched on with no channel behind it is the exact case that
 * looks like "it is on but nothing arrives", so it gets said out loud rather
 * than rendered as an empty space beside the platform name.
 */
check(
	'a platform with no channel is called out',
	str_contains( $view, 'مقصدی تنظیم نشده' )
);

/* =====================================================================
 * 3. And "has anything been sent?"
 * ================================================================== */

check( 'recent order sends are listed on the screen', str_contains( $view, 'wpep-order-log' ) );
check( 'including the ones that were skipped, with the reason', str_contains( $view, '$wpep_skipped' ) );

check(
	'an empty history explains what that means rather than showing nothing',
	str_contains( $view, 'تا حالا هیچ سفارشی در صف ارسال قرار نگرفته است' )
);

/* The log lines the screen reads have to be the ones the pipeline writes. */
check( 'the pipeline records a queued order under order.queued', str_contains( $source, "'order.queued'" ) );
check( 'and a skipped one under order.skipped', str_contains( $source, "'order.skipped'" ) );

$admin = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-admin.php' );

check(
	'the screen queries those same stages',
	str_contains( $admin, "'stage'    => 'order.queued'" ) && str_contains( $admin, "'stage'    => 'order.skipped'" )
);

/* =====================================================================
 * 4. Resolved targets carry the address the screen prints.
 * ================================================================== */

$all = (array) get_option( Settings::OPTION, array() );

$all['platforms'] = array_merge(
	(array) wpep()->settings()->platforms(),
	array(
		Field::PLATFORM_TELEGRAM => array(
			'enabled'       => true,
			'channel_id'    => '@iranexim_orders',
			'channel_title' => 'سفارش‌های ایران اگزیم',
		),
	)
);

$all['orders_enabled']  = true;
$all['order_platforms'] = array( Field::PLATFORM_TELEGRAM );

update_option( Settings::OPTION, $all );
wpep()->settings()->flush_cache();

$targets = wpep()->orders()->targets();
$telegram = (array) ( $targets[ Field::PLATFORM_TELEGRAM ] ?? array() );

check( 'the chosen platform resolves as live', ! empty( $telegram['enabled'] ), var_export( $telegram, true ) );

check(
	'and carries the channel the screen will print',
	'@iranexim_orders' === ( $telegram['channel_id'] ?? '' ),
	(string) ( $telegram['channel_id'] ?? '' )
);

check(
	'along with its title',
	'سفارش‌های ایران اگزیم' === ( $telegram['channel_title'] ?? '' ),
	(string) ( $telegram['channel_title'] ?? '' )
);

/*
 * Choosing a platform on this screen narrows the site configuration; it cannot
 * widen it. A platform the administrator never configured has no channel to
 * post to, so selecting it here must not switch it on.
 */
$all['order_platforms'] = array( Field::PLATFORM_TELEGRAM, Field::PLATFORM_BALE );

update_option( Settings::OPTION, $all );
wpep()->settings()->flush_cache();

$targets = wpep()->orders()->targets();

check(
	'selecting an unconfigured platform does not switch it on',
	empty( $targets[ Field::PLATFORM_BALE ]['enabled'] ),
	var_export( $targets[ Field::PLATFORM_BALE ] ?? null, true )
);

/* =====================================================================
 * 5. An order actually reaching the queue.
 *
 * Everything above checks that the wiring exists. This runs an order through
 * it: the strongest evidence that "it is on but nothing shows up" is fixed is
 * an order created the way the checkout hook never saw, arriving in the queue.
 * ================================================================== */

$all['order_platforms'] = array( Field::PLATFORM_TELEGRAM );
$all['order_events']    = array_keys( WooCommerceOrders::event_types() );
$all['order_min_total'] = 0;

update_option( Settings::OPTION, $all );
wpep()->settings()->flush_cache();

/*
 * Observed through the log the screen reads, not through a mock. If an order
 * does not appear here, it does not appear on the screen either — which is
 * the same thing the report was about.
 */
$GLOBALS['queued_events'] = array();

$GLOBALS['filters']['wpep_log_entry'][10][] = static function ( $entry ) {
	if ( 'order.queued' === ( $entry['stage'] ?? '' ) ) {
		$GLOBALS['queued_events'][] = $entry;
	}

	return $entry;
};

$GLOBALS['wc_orders'][9001] = new WC_Order( 9001, 'processing', 250000 );

$before = count( $GLOBALS['queued_events'] );

// Not the checkout hook. This is the path an order placed in wp-admin, by the
// REST API, or by a gateway takes — the one that used to raise nothing.
do_action( 'woocommerce_new_order', 9001, $GLOBALS['wc_orders'][9001] );

check(
	'an order created outside the checkout reaches the queue',
	count( $GLOBALS['queued_events'] ) > $before,
	sprintf( '%d queued', count( $GLOBALS['queued_events'] ) - $before )
);

/*
 * And exactly once. Both creation hooks fire for a checkout order, so without
 * the per-order marker this shop would announce every checkout twice.
 */
$before = count( $GLOBALS['queued_events'] );

do_action( 'woocommerce_new_order', 9001, $GLOBALS['wc_orders'][9001] );
do_action( 'woocommerce_checkout_order_created', $GLOBALS['wc_orders'][9001] );

check(
	'and repeating it, by either hook, sends nothing further',
	$before === count( $GLOBALS['queued_events'] ),
	sprintf( '%d extra', count( $GLOBALS['queued_events'] ) - $before )
);

/* A later status change is a different event and does report. */
$before = count( $GLOBALS['queued_events'] );

do_action( 'woocommerce_order_status_changed', 9001, 'processing', 'completed', $GLOBALS['wc_orders'][9001] );

check(
	'a status change afterwards is its own event',
	count( $GLOBALS['queued_events'] ) > $before,
	sprintf( '%d queued', count( $GLOBALS['queued_events'] ) - $before )
);

/* With the whole feature switched off, nothing moves at all. */
$all['orders_enabled'] = false;

update_option( Settings::OPTION, $all );
wpep()->settings()->flush_cache();

$GLOBALS['wc_orders'][9002] = new WC_Order( 9002, 'processing', 250000 );

$before = count( $GLOBALS['queued_events'] );

do_action( 'woocommerce_new_order', 9002, $GLOBALS['wc_orders'][9002] );

check(
	'and nothing is sent while order notifications are off',
	$before === count( $GLOBALS['queued_events'] ),
	sprintf( '%d queued', count( $GLOBALS['queued_events'] ) - $before )
);

wpep_report( 'ORDERS' );
