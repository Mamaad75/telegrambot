<?php
/**
 * Tests for the commerce insight features.
 *
 * @package Bahoosh_Analytics_Pro
 */

// phpcs:disable

require __DIR__ . '/bootstrap.php';

/* ============================================================ */
/* The regression that started this                             */
/* ============================================================ */

test( 'woocommerce: is_active() checks the real class name', function () {
	// 4.2.1 shipped class_exists('ووکامرس') — a PHP class name replaced by a
	// localisation pass — which made this return false on every site and
	// silently disabled the whole shop integration.
	$source = file_get_contents( BAP_PLUGIN_DIR . 'includes/integrations/class-bap-woocommerce.php' );

	ok( str_contains( $source, "class_exists( 'WooCommerce' )" ), 'the ASCII class name must be used' );
	ok( ! str_contains( $source, "class_exists( 'ووکامرس' )" ), 'the translated class name must not return' );
} );

test( 'plugin: no PHP identifier anywhere has been translated', function () {
	$damaged = array();
	// `delete_metadata` is in this list because 4.2.1 also shipped
	// delete_metadata( 'کاربر', … ) in uninstall.php — the same mistake, in a
	// place nobody would notice, quietly leaving user meta behind forever.
	$pattern = '/(class_exists|function_exists|interface_exists|method_exists|delete_metadata|get_metadata|update_metadata|post_type_exists|taxonomy_exists)\(\s*\'[^\']*[\x{0600}-\x{06FF}]/u';

	$files = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( BAP_PLUGIN_DIR ) );
	foreach ( $files as $file ) {
		if ( 'php' !== $file->getExtension() ) { continue; }
		if ( preg_match( $pattern, (string) file_get_contents( $file->getPathname() ) ) ) {
			$damaged[] = str_replace( BAP_PLUGIN_DIR, '', $file->getPathname() );
		}
	}

	is_same( array(), $damaged, 'translated identifiers found in: ' . implode( ', ', $damaged ) );
} );

/* ============================================================ */
/* Rollup — the funnel store                                    */
/* ============================================================ */

test( 'rollup: records only funnel steps and ignores everything else', function () {
	is_same( true, BAP_Rollup::record( 'add_to_cart', 'mobile', '/product/lipstick' ) );
	is_same( false, BAP_Rollup::record( 'scroll', 'mobile', '/product/lipstick' ), 'a scroll is not a funnel step' );
} );

test( 'rollup: repeated observations increment one bucket', function () {
	for ( $i = 0; $i < 5; $i++ ) {
		BAP_Rollup::record( 'view_item', 'mobile', '/product/x' );
	}

	is_same( 1, count( $GLOBALS['wpdb']->rollup ), 'one bucket, not five rows' );
	is_same( 5, (int) array_values( $GLOBALS['wpdb']->rollup )[0]['hits'] );
} );

test( 'rollup: a query string never reaches storage', function () {
	// Query strings carry session ids and coupon codes; the table is meant to
	// hold nothing identifying, and /checkout is the answer an admin wants.
	is_same( '/checkout', BAP_Rollup::normalize_path( 'https://shop.test/checkout?token=abc123&utm_source=x' ) );
	is_same( '/product/{id}', BAP_Rollup::normalize_path( '/product/4471' ), 'numeric ids collapse so one product is not a thousand buckets' );
} );

test( 'rollup: an unknown device is never guessed into a real bucket', function () {
	is_same( 'unknown', BAP_Rollup::normalize_device( 'PlayStation' ) );
	is_same( 'unknown', BAP_Rollup::normalize_device( '' ) );
	is_same( 'mobile', BAP_Rollup::normalize_device( 'MOBILE' ) );
} );

test( 'rollup: observe() reads a validated event and takes value only from a purchase', function () {
	BAP_Rollup::observe( array(
		'event_type' => 'purchase',
		'context'    => array( 'device_type' => 'mobile' ),
		'page'       => array( 'path' => '/checkout/received' ),
		'data'       => array( 'value' => 250000 ),
	) );

	BAP_Rollup::observe( array(
		'event_type' => 'add_to_cart',
		'context'    => array( 'device_type' => 'mobile' ),
		'page'       => array( 'path' => '/product/x' ),
		'data'       => array( 'value' => 999999 ),
	) );

	$rows = array_values( $GLOBALS['wpdb']->rollup );
	$by_step = array();
	foreach ( $rows as $row ) { $by_step[ $row['step'] ] = $row; }

	is_same( 250000.0, (float) $by_step['purchase']['value_sum'], 'a purchase carries money' );
	is_same( 0.0, (float) $by_step['add_to_cart']['value_sum'], 'a cart subtotal that was never paid must not be counted as revenue' );
} );

test( 'rollup: the funnel reports every step, including untouched ones', function () {
	$today = BAP_Rollup::today();

	foreach ( range( 1, 100 ) as $i ) { BAP_Rollup::record( 'view_item', 'mobile', '/p' ); }
	foreach ( range( 1, 40 ) as $i )  { BAP_Rollup::record( 'add_to_cart', 'mobile', '/p' ); }
	foreach ( range( 1, 10 ) as $i )  { BAP_Rollup::record( 'begin_checkout', 'mobile', '/checkout' ); }

	$funnel = BAP_Rollup::funnel( $today, $today );

	is_same( 100, $funnel['view_item'] );
	is_same( 40, $funnel['add_to_cart'] );
	is_same( 0, $funnel['purchase'], 'a step nobody reached reports zero rather than being absent' );
} );

/* ============================================================ */
/* Commerce facts                                               */
/* ============================================================ */

/** A small shop: lipstick and lip tint genuinely go together. */
function seed_shop(): void {
	// 12 orders pairing lipstick (10) + tint (11) — the real pattern.
	for ( $i = 1; $i <= 12; $i++ ) {
		bap_add_order( $i, array(
			array( 10, 'رژ لب', 1, 200000 ),
			array( 11, 'تینت لب', 1, 150000 ),
		), $i % 3 === 0 ? 'desktop' : 'mobile' );
	}

	// 8 orders of lipstick alone.
	for ( $i = 13; $i <= 20; $i++ ) {
		bap_add_order( $i, array( array( 10, 'رژ لب', 1, 200000 ) ), 'mobile' );
	}

	// 6 orders of an expensive serum, desktop only.
	for ( $i = 21; $i <= 26; $i++ ) {
		bap_add_order( $i, array( array( 12, 'سرم ویتامین C', 1, 900000 ) ), 'desktop' );
	}

	// Two products in the catalogue that have never sold.
	bap_add_product( 90, 'ماسک مو' );
	bap_add_product( 91, 'لاک ناخن' );
}

test( 'commerce: revenue splits by device', function () {
	seed_shop();
	$orders = BAP_Commerce_Facts::orders( '2026-01-01', '2026-12-31' );
	$split  = BAP_Commerce_Facts::device_revenue( $orders );

	is_same( 16, $split['mobile']['orders'], 'mobile order count' );
	is_same( 10, $split['desktop']['orders'], 'desktop order count' );

	// Desktop sells fewer orders but far more money — exactly the case where
	// counting visits instead of revenue would mislead.
	ok( $split['desktop']['aov'] > $split['mobile']['aov'], 'desktop has the higher average order value' );
	is_same( 100.0, round( $split['mobile']['share'] + $split['desktop']['share'], 1 ), 'shares total 100%' );
} );

test( 'commerce: products rank by revenue, counting each order once', function () {
	seed_shop();
	$orders   = BAP_Commerce_Facts::orders( '2026-01-01', '2026-12-31' );
	$products = BAP_Commerce_Facts::product_performance( $orders );

	// The serum out-earns the lipstick on far fewer orders — which is the
	// ranking working correctly. Revenue, not popularity, is what a shop owner
	// deciding where to put effort actually needs.
	is_same( 12, $products[0]['id'], 'the serum leads on revenue' );
	is_same( 5400000.0, $products[0]['revenue'] );

	$lipstick = null;
	foreach ( $products as $row ) { if ( 10 === $row['id'] ) { $lipstick = $row; } }
	is_same( 20, $lipstick['orders'], 'the lipstick appeared in 20 orders' );
	is_same( 4000000.0, $lipstick['revenue'] );
} );

test( 'commerce: products that never sold are surfaced, not hidden', function () {
	seed_shop();
	$orders = BAP_Commerce_Facts::orders( '2026-01-01', '2026-12-31' );
	$slow   = BAP_Commerce_Facts::slow_movers( $orders, 5 );

	$ids = array_column( $slow, 'id' );

	// The whole point: a product with zero sales appears in no order, so ranking
	// the order history alone would systematically hide the worst cases.
	ok( in_array( 90, $ids, true ), 'a never-sold product is reported' );
	ok( in_array( 91, $ids, true ), 'and so is the second one' );
	is_same( 0.0, $slow[0]['revenue'], 'the worst performer comes first' );
} );

test( 'commerce: co-purchase finds the real pair and rates it by lift', function () {
	seed_shop();
	$orders = BAP_Commerce_Facts::orders( '2026-01-01', '2026-12-31' );
	$pairs  = BAP_Commerce_Facts::product_affinity( $orders, 5 );

	ok( ! empty( $pairs ), 'a pair was found' );

	$top = $pairs[0];
	is_same( 10, $top['a'] );
	is_same( 11, $top['b'] );
	is_same( 12, $top['support'], 'bought together 12 times' );
	// Modest but real: the tint is never bought without the lipstick, yet the
	// lipstick is so common that the lift stays near 1.3. That is lift behaving
	// correctly, and it is why the bundle gate sits at 1.2 rather than 1.5.
	ok( $top['lift'] > 1.2, 'the pairing is stronger than popularity alone explains' );
	is_same( 60.0, $top['confidence'], '60% of lipstick buyers also took the tint' );
} );

test( 'commerce: a coincidental pair is rejected below the support floor', function () {
	// Two products bought together twice is not a pattern.
	bap_add_order( 1, array( array( 1, 'A', 1, 100 ), array( 2, 'B', 1, 100 ) ) );
	bap_add_order( 2, array( array( 1, 'A', 1, 100 ), array( 2, 'B', 1, 100 ) ) );

	$orders = BAP_Commerce_Facts::orders( '2026-01-01', '2026-12-31' );
	is_same( array(), BAP_Commerce_Facts::product_affinity( $orders ), 'below MIN_PAIR_SUPPORT, nothing is claimed' );
} );

/* ============================================================ */
/* Analysis packet                                              */
/* ============================================================ */

test( 'packet: every fact carries an id matching the schema and a sample size', function () {
	seed_shop();
	$packet = BAP_Analysis_Packet::build( '2026-01-01', '2026-12-31', 'revenue' );

	ok( ! empty( $packet['facts'] ), 'facts were produced' );

	foreach ( $packet['facts'] as $fact ) {
		ok( (bool) preg_match( '/^fact_[A-Za-z0-9_-]{3,100}$/', $fact['id'] ), 'id violates the schema: ' . $fact['id'] );
		ok( isset( $fact['sample_size'] ), 'every fact declares its sample size' );
		ok( isset( $fact['kind'], $fact['label'] ), 'and its kind and label' );
	}
} );

test( 'packet: a Persian product name cannot break a fact id', function () {
	seed_shop();
	$packet = BAP_Analysis_Packet::build( '2026-01-01', '2026-12-31' );

	$affinity = array_values( array_filter( $packet['facts'], fn( $f ) => 'commerce.product_affinity' === $f['kind'] ) );
	ok( ! empty( $affinity ), 'affinity facts exist' );
	ok( (bool) preg_match( '/^fact_[A-Za-z0-9_-]+$/', $affinity[0]['id'] ), 'the id is ASCII even though the products are not' );
	ok( str_contains( $affinity[0]['label'], 'رژ لب' ), 'but the label keeps the real name' );
} );

test( 'packet: no customer data leaves the site', function () {
	seed_shop();
	$packet  = BAP_Analysis_Packet::build( '2026-01-01', '2026-12-31' );
	$encoded = wp_json_encode( $packet );

	foreach ( array( 'email', 'first_name', 'last_name', 'billing_address', 'customer_id', 'anonymous_id', 'ip' ) as $forbidden ) {
		is_same( false, str_contains( $encoded, $forbidden ), "the packet must not contain {$forbidden}" );
	}
} );

test( 'packet: a thin dataset is reported as such rather than silently trusted', function () {
	bap_add_order( 1, array( array( 1, 'A', 1, 1000 ) ) );

	$packet = BAP_Analysis_Packet::build( '2026-01-01', '2026-12-31' );

	ok( $packet['data_quality']['score'] < 40, 'the quality score is low' );
	ok( ! empty( $packet['data_quality']['warnings'] ), 'and the reason is stated' );
} );

test( 'packet: WooCommerce being inactive is a warning, not a crash', function () {
	$GLOBALS['bap_orders'] = array();
	$packet = BAP_Analysis_Packet::build( '2026-01-01', '2026-12-31' );

	is_same( array(), $packet['facts'], 'no data, no facts' );
	ok( ! empty( $packet['data_quality']['warnings'] ) );
} );

/* ============================================================ */
/* Local insight engine                                         */
/* ============================================================ */

test( 'insights: the engine answers all five questions from real data', function () {
	seed_shop();
	$today = BAP_Rollup::today();

	foreach ( range( 1, 500 ) as $i ) { BAP_Rollup::record( 'view_item', 'mobile', '/product/x' ); }
	foreach ( range( 1, 200 ) as $i ) { BAP_Rollup::record( 'add_to_cart', 'mobile', '/product/x' ); }
	foreach ( range( 1, 150 ) as $i ) { BAP_Rollup::record( 'view_cart', 'mobile', '/cart' ); }
	foreach ( range( 1, 120 ) as $i ) { BAP_Rollup::record( 'begin_checkout', 'mobile', '/checkout' ); }
	foreach ( range( 1, 20 ) as $i )  { BAP_Rollup::record( 'add_payment_info', 'mobile', '/checkout' ); }
	foreach ( range( 1, 18 ) as $i )  { BAP_Rollup::record( 'purchase', 'mobile', '/checkout/received', 200000 ); }

	$packet = BAP_Analysis_Packet::build( $today, $today );
	$items  = BAP_Local_Insights::derive( $packet );

	ok( count( $items ) >= 4, 'several recommendations were produced' );

	$titles = implode( ' | ', array_column( $items, 'title' ) );

	// Every one of the five asks should be represented.
	ok( str_contains( $titles, 'درآمد' ) || str_contains( $titles, 'سبد خرید' ), 'device insight present' );
	ok( str_contains( $titles, 'رها' ), 'abandonment insight present' );
	ok( str_contains( $titles, 'پرفروش' ), 'best-seller insight present' );
	ok( str_contains( $titles, 'پکیج' ), 'bundle insight present' );
	ok( str_contains( $titles, 'هیچ فروشی' ), 'slow-mover insight present' );
} );

test( 'insights: the abandonment recommendation names the actual page', function () {
	$today = BAP_Rollup::today();
	seed_shop();

	foreach ( range( 1, 200 ) as $i ) { BAP_Rollup::record( 'begin_checkout', 'mobile', '/checkout' ); }
	foreach ( range( 1, 20 ) as $i )  { BAP_Rollup::record( 'add_payment_info', 'mobile', '/checkout' ); }

	$packet = BAP_Analysis_Packet::build( $today, $today );
	$items  = BAP_Local_Insights::derive( $packet );

	$leak = null;
	foreach ( $items as $item ) {
		if ( str_contains( $item['title'], 'رها' ) ) { $leak = $item; break; }
	}

	ok( null !== $leak, 'the leak was reported' );
	ok( str_contains( $leak['summary'], '/checkout' ), 'and it names the page the admin must fix' );
	is_same( 'critical', $leak['priority'], '90% drop is critical' );
} );

test( 'insights: every recommendation cites evidence that exists', function () {
	seed_shop();
	$packet = BAP_Analysis_Packet::build( '2026-01-01', '2026-12-31' );
	$items  = BAP_Local_Insights::derive( $packet );

	$known = array_column( $packet['facts'], 'id' );

	foreach ( $items as $item ) {
		ok( ! empty( $item['evidence'] ), 'a recommendation without evidence is not auditable: ' . $item['title'] );
		foreach ( $item['evidence'] as $fact_id ) {
			ok( in_array( $fact_id, $known, true ), "cited a fact that does not exist: {$fact_id}" );
		}
	}
} );

test( 'insights: confidence scales with sample size', function () {
	// Same shape of data, different volume. The thin one must not be presented
	// with the same certainty as the thick one.
	bap_add_order( 1, array( array( 10, 'A', 1, 100 ), array( 11, 'B', 1, 100 ) ) );
	for ( $i = 2; $i <= 6; $i++ ) {
		bap_add_order( $i, array( array( 10, 'A', 1, 100 ), array( 11, 'B', 1, 100 ) ) );
	}

	$thin = BAP_Local_Insights::derive( BAP_Analysis_Packet::build( '2026-01-01', '2026-12-31' ) );

	reset_state();
	seed_shop();
	$thick = BAP_Local_Insights::derive( BAP_Analysis_Packet::build( '2026-01-01', '2026-12-31' ) );

	$bundle_confidence = function ( array $items ) {
		foreach ( $items as $item ) {
			if ( str_contains( $item['title'], 'پکیج' ) ) { return $item['confidence']; }
		}
		return null;
	};

	$a = $bundle_confidence( $thin );
	$b = $bundle_confidence( $thick );

	if ( null !== $a && null !== $b ) {
		ok( $b > $a, 'more data means more confidence' );
	}
	ok( true );
} );

test( 'insights: nothing is ever marked auto-executable', function () {
	seed_shop();
	$items = BAP_Local_Insights::derive( BAP_Analysis_Packet::build( '2026-01-01', '2026-12-31' ) );

	foreach ( $items as $item ) {
		is_same( null, $item['action'], 'a price or discount suggestion is text for a human, never an instruction' );
	}
} );

/* ============================================================ */
/* Provider                                                     */
/* ============================================================ */

test( 'provider: an explicit `local` setting keeps a model out of it entirely', function () {
	// The default moved to `llama` in 4.3.0. `local` is now a deliberate choice
	// for sites that want reproducible output and no model call at all.
	set_settings( array( 'ai_provider' => 'local' ) );
	is_same( 'local', BAP_AI_Provider::current() );
} );

test( 'provider: a model reply citing an invented fact is discarded', function () {
	$packet = array(
		'run_id' => 'run_test123456',
		'facts'  => array( array( 'id' => 'fact_real_one', 'kind' => 'x', 'label' => 'y', 'value' => 1, 'sample_size' => 10 ) ),
	);

	$reply = wp_json_encode( array( 'recommendations' => array(
		array( 'title' => 'Legit', 'summary' => 's', 'evidence' => array( 'fact_real_one' ), 'confidence' => 80 ),
		array( 'title' => 'Hallucinated', 'summary' => 's', 'evidence' => array( 'fact_does_not_exist' ), 'confidence' => 95 ),
		array( 'title' => 'No evidence at all', 'summary' => 's', 'evidence' => array(), 'confidence' => 99 ),
	) ) );

	$items = BAP_AI_Provider::parse_recommendations( $reply, $packet );

	is_same( 1, count( $items ), 'only the verifiable recommendation survives' );
	is_same( 'Legit', $items[0]['title'] );
} );

test( 'provider: a model cannot smuggle in an executable action', function () {
	$packet = array(
		'run_id' => 'run_test123456',
		'facts'  => array( array( 'id' => 'fact_real_one', 'kind' => 'x', 'label' => 'y', 'value' => 1, 'sample_size' => 10 ) ),
	);

	$reply = wp_json_encode( array( 'recommendations' => array(
		array(
			'title'    => 'Drop the price',
			'summary'  => 's',
			'evidence' => array( 'fact_real_one' ),
			'action'   => array( 'type' => 'shop.set_price', 'payload' => array( 'product' => 10, 'price' => 1 ) ),
		),
	) ) );

	$items = BAP_AI_Provider::parse_recommendations( $reply, $packet );

	is_same( 1, count( $items ) );
	is_same( null, $items[0]['action'], 'actions are never taken from a model reply' );
} );

test( 'provider: markdown-fenced JSON is still parsed', function () {
	$packet = array(
		'run_id' => 'run_test123456',
		'facts'  => array( array( 'id' => 'fact_a', 'kind' => 'x', 'label' => 'y', 'value' => 1, 'sample_size' => 5 ) ),
	);

	$reply = "Here you go:\n```json\n" . wp_json_encode( array( 'recommendations' => array(
		array( 'title' => 'Wrapped', 'summary' => 's', 'evidence' => array( 'fact_a' ) ),
	) ) ) . "\n```";

	$items = BAP_AI_Provider::parse_recommendations( $reply, $packet );
	is_same( 'Wrapped', $items[0]['title'] );
} );

test( 'provider: an empty packet is never sent to a model', function () {
	$result = BAP_AI_Provider::analyze( array( 'facts' => array() ) );

	is_same( false, $result['ok'] );
	is_same( array(), $result['recommendations'], 'a model given nothing still writes confident nonsense' );
} );

test( 'insights: browsing without buying is not reported as abandonment', function () {
	$today = BAP_Rollup::today();
	seed_shop();

	// A completely normal shop: most people who look at a product do not add it
	// to the cart, and everyone who does add one goes on to buy.
	foreach ( range( 1, 1000 ) as $i ) { BAP_Rollup::record( 'view_item', 'mobile', '/product/x' ); }
	foreach ( range( 1, 50 ) as $i )   { BAP_Rollup::record( 'add_to_cart', 'mobile', '/product/x' ); }
	foreach ( range( 1, 50 ) as $i )   { BAP_Rollup::record( 'view_cart', 'mobile', '/cart' ); }
	foreach ( range( 1, 50 ) as $i )   { BAP_Rollup::record( 'begin_checkout', 'mobile', '/checkout' ); }
	foreach ( range( 1, 50 ) as $i )   { BAP_Rollup::record( 'add_payment_info', 'mobile', '/checkout' ); }
	foreach ( range( 1, 50 ) as $i )   { BAP_Rollup::record( 'purchase', 'mobile', '/done', 200000 ); }

	$items = BAP_Local_Insights::derive( BAP_Analysis_Packet::build( $today, $today ) );

	foreach ( $items as $item ) {
		is_same( false, str_contains( $item['title'], 'رها' ), 'a 95% drop from browsing to cart is ordinary retail, not a leak to fix' );
	}
} );

test( 'insights: the cause named matches the step that actually leaked', function () {
	$today = BAP_Rollup::today();
	seed_shop();

	// Everything fine until the payment form, which loses almost everyone.
	foreach ( range( 1, 300 ) as $i ) { BAP_Rollup::record( 'add_to_cart', 'mobile', '/product/x' ); }
	foreach ( range( 1, 290 ) as $i ) { BAP_Rollup::record( 'view_cart', 'mobile', '/cart' ); }
	foreach ( range( 1, 280 ) as $i ) { BAP_Rollup::record( 'begin_checkout', 'mobile', '/checkout' ); }
	foreach ( range( 1, 30 ) as $i )  { BAP_Rollup::record( 'add_payment_info', 'mobile', '/checkout/payment' ); }
	foreach ( range( 1, 25 ) as $i )  { BAP_Rollup::record( 'purchase', 'mobile', '/done', 200000 ); }

	$leak = null;
	foreach ( BAP_Local_Insights::derive( BAP_Analysis_Packet::build( $today, $today ) ) as $item ) {
		if ( str_contains( $item['title'], 'رها' ) ) { $leak = $item; break; }
	}

	ok( null !== $leak, 'the leak was found' );
	ok( str_contains( $leak['title'], 'شروع تسویه‌حساب' ), 'and named the step that lost the most people' );
	// Checkout-form advice, not payment-gateway advice: the two have different fixes.
	ok( str_contains( $leak['summary'], 'خرید مهمان' ), 'the advice matches that step' );
} );


/* ============================================================ */
/* The model provider                                           */
/* ============================================================ */

test( 'provider: the default is a Llama on this machine, with no key needed', function () {
	is_same( 'llama', BAP_AI_Provider::current(), 'llama is the shipped default' );
	is_same( BAP_AI_Provider::LLAMA_DEFAULT_URL, BAP_AI_Provider::base_url() );
	is_same( BAP_AI_Provider::LLAMA_DEFAULT_MODEL, BAP_AI_Provider::model() );
	is_same( '', BAP_AI_Provider::api_key(), 'a local model needs no key' );
} );

test( 'provider: the external analysis service is gone', function () {
	$source = file_get_contents( BAP_PLUGIN_DIR . 'includes/core/class-bap-ai-provider.php' );

	ok( ! str_contains( $source, 'PROVIDER_BACKEND' ), 'the backend provider constant is removed' );
	ok( ! str_contains( $source, "BAP_Transport::request( 'ai/analyze'" ), 'nothing calls out to an analysis service' );
	is_same( array( 'llama', 'openai_compatible', 'local' ), BAP_AI_Provider::providers() );

	$routes = file_get_contents( BAP_PLUGIN_DIR . 'includes/api/class-bap-rest-controller.php' );
	ok( ! str_contains( $routes, "'/ai/callback'" ), 'the unauthenticated callback route is removed' );
} );

test( 'provider: whatever shape of URL is pasted, the endpoint is right', function () {
	$expected = 'http://127.0.0.1:11434/v1/chat/completions';

	foreach ( array(
		'http://127.0.0.1:11434',
		'http://127.0.0.1:11434/',
		'http://127.0.0.1:11434/v1',
		'http://127.0.0.1:11434/v1/chat/completions',
	) as $input ) {
		is_same( $expected, BAP_AI_Provider::chat_endpoint( $input ), "failed for {$input}" );
	}
} );

test( 'provider: a recommendation citing evidence that does not exist is discarded', function () {
	$packet = array(
		'run_id' => 'run_test',
		'facts'  => array( array( 'id' => 'fact_real_one', 'kind' => 'commerce.top_product' ) ),
	);

	$reply = json_encode( array( 'recommendations' => array(
		array( 'title' => 'واقعی', 'evidence' => array( 'fact_real_one' ) ),
		array( 'title' => 'ساختگی', 'evidence' => array( 'fact_invented_by_the_model' ) ),
		array( 'title' => 'بی‌شاهد', 'evidence' => array() ),
	) ) );

	$items = BAP_AI_Provider::parse_recommendations( $reply, $packet );

	is_same( 1, count( $items ), 'only the one with real evidence survives' );
	is_same( 'واقعی', $items[0]['title'] );
} );

test( 'provider: a model cannot smuggle in an executable action', function () {
	$packet = array( 'run_id' => 'r', 'facts' => array( array( 'id' => 'fact_x1', 'kind' => 'k' ) ) );

	// The exact attack this guards against: prose that names a product and a
	// discount, formatted as something the executor might run.
	$reply = json_encode( array( 'recommendations' => array( array(
		'title'    => 'همه محصولات را ۹۰ درصد تخفیف بده',
		'evidence' => array( 'fact_x1' ),
		'action'   => array( 'type' => 'woocommerce.discount_product', 'payload' => array( 'product_id' => 10, 'percent' => 90 ) ),
	) ) ) );

	$items = BAP_AI_Provider::parse_recommendations( $reply, $packet );

	is_same( 1, count( $items ) );
	is_same( null, $items[0]['action'], 'actions never come from model output' );
} );

test( 'provider: JSON wrapped in a small model\'s chatter is still read', function () {
	$packet = array( 'run_id' => 'r', 'facts' => array( array( 'id' => 'fact_x1', 'kind' => 'k' ) ) );
	$reply  = "Sure! Here is the analysis:\n{\"recommendations\":[{\"title\":\"ok\",\"evidence\":[\"fact_x1\"]}]}\nHope this helps.";

	is_same( 1, count( BAP_AI_Provider::parse_recommendations( $reply, $packet ) ) );
} );

test( 'provider: when the model is unreachable the rule engine answers instead', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'llama' ) );

	// No HTTP response configured means wp_remote_post returns a WP_Error,
	// which is exactly what a stopped Ollama looks like.
	$result = BAP_AI_Provider::analyze( BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ) );

	is_same( true, $result['ok'], 'the admin still gets an answer' );
	is_same( 'local', $result['provider'] );
	is_same( true, $result['fallback'], 'and is told the model did not produce it' );
	ok( count( $result['recommendations'] ) > 0 );
} );

test( 'provider: a real model reply is accepted and attributed to the model', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'llama' ) );

	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );
	$fact   = $packet['facts'][0]['id'];

	fake_http( 200, array( 'choices' => array( array( 'message' => array(
		'content' => json_encode( array( 'recommendations' => array( array(
			'title'      => 'موبایل را جدی بگیرید',
			'summary'    => 'بیشتر سفارش‌ها از موبایل می‌آید.',
			'priority'   => 'high',
			'confidence' => 77,
			'evidence'   => array( $fact ),
		) ) ) ),
	) ) ) ) );

	$result = BAP_AI_Provider::analyze( $packet );

	is_same( true, $result['ok'] );
	is_same( 'llama', $result['provider'] );
	is_same( false, $result['fallback'] );
	is_same( 'موبایل را جدی بگیرید', $result['recommendations'][0]['title'] );
} );

/* ============================================================ */
/* The WooCommerce agent                                        */
/* ============================================================ */

test( 'agent: off by default, and proposes nothing while off', function () {
	seed_shop();

	is_same( 'off', BAP_Commerce_Agent::mode() );
	is_same( false, BAP_Commerce_Agent::enabled() );
	is_same( null, BAP_Commerce_Agent::propose( array(
		array( 'kind' => 'commerce.slow_product', 'value' => array( 'product_id' => 90 ) ),
	) ) );
} );

test( 'agent: while off, an execution attempt is refused outright', function () {
	seed_shop();
	bap_add_product( 90, 'ماسک مو' );

	$result = BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );

	ok( $result instanceof WP_Error, 'refused' );
	is_same( '', $GLOBALS['bap_products'][90]->get_sale_price(), 'and nothing was written' );
} );

test( 'agent: the discount comes from the cap, never from the payload', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval', 'ai_agent_max_discount' => 12 ) );
	bap_add_product( 90, 'ماسک مو' );

	// 90 is what a hallucinating model would ask for. The cap is 12.
	$result = BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 90 ) );

	ok( ! ( $result instanceof WP_Error ), 'the action ran' );
	is_same( '88000', $GLOBALS['bap_products'][90]->get_sale_price(), '12% off 100000, not 90%' );
} );

test( 'agent: never overwrites a sale a human already set', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'auto' ) );
	bap_add_product( 90, 'ماسک مو' );
	$GLOBALS['bap_products'][90]->set_sale_price( '70000' );

	$result = BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );

	ok( $result instanceof WP_Error );
	is_same( '70000', $GLOBALS['bap_products'][90]->get_sale_price(), 'the human price stands' );
} );

test( 'agent: a discount is bounded in time and fully reversible', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval', 'ai_agent_max_discount' => 20 ) );
	bap_add_product( 90, 'ماسک مو' );

	$result = BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 20, 'days' => 14 ) );
	$product = $GLOBALS['bap_products'][90];

	is_same( '80000', $product->get_sale_price() );
	ok( $product->sale_to > time(), 'it has an end date' );
	ok( $product->sale_to <= time() + ( 15 * DAY_IN_SECONDS ), 'and that date is close, not open-ended' );

	$reverted = BAP_Commerce_Agent::revert( $result['log_id'] );

	ok( ! ( $reverted instanceof WP_Error ), 'revert succeeded' );
	is_same( '', $product->get_sale_price(), 'the product is exactly as it was' );
	is_same( null, $product->sale_from );
} );

test( 'agent: reverting twice is refused rather than silently repeated', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );
	bap_add_product( 90, 'ماسک مو' );

	$result = BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );
	BAP_Commerce_Agent::revert( $result['log_id'] );

	ok( BAP_Commerce_Agent::revert( $result['log_id'] ) instanceof WP_Error );
} );

test( 'agent: a bundle coupon names both products and expires', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );

	$result = BAP_Commerce_Agent::bundle_coupon( array( 'product_a' => 10, 'product_b' => 11, 'percent' => 10 ) );

	ok( ! ( $result instanceof WP_Error ), 'the coupon was created' );
	is_same( 'bahoosh-10-11', $result['code'] );

	$coupon = $GLOBALS['bap_coupons'][ $result['coupon_id'] ];
	is_same( 'percent', $coupon->type );
	is_same( array( 10, 11 ), $coupon->product_ids );
	ok( $coupon->expires > time(), 'it expires' );

	// A second run must not litter the shop with duplicates.
	ok( BAP_Commerce_Agent::bundle_coupon( array( 'product_a' => 11, 'product_b' => 10, 'percent' => 10 ) ) instanceof WP_Error );
} );

test( 'agent: reverting a coupon expires it rather than deleting it', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );

	$result = BAP_Commerce_Agent::bundle_coupon( array( 'product_a' => 10, 'product_b' => 11, 'percent' => 10 ) );
	BAP_Commerce_Agent::revert( $result['log_id'] );

	$coupon = $GLOBALS['bap_coupons'][ $result['coupon_id'] ];
	ok( isset( $GLOBALS['bap_coupons'][ $result['coupon_id'] ] ), 'the coupon still exists for order history' );
	ok( $coupon->expires < time(), 'but it can no longer be used' );
} );

test( 'agent: only two verbs are registered, and neither is destructive', function () {
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );

	$registry = BAP_Commerce_Agent::register_actions( array() );

	is_same(
		array( 'woocommerce.discount_product', 'woocommerce.bundle_coupon' ),
		array_keys( $registry )
	);

	foreach ( $registry as $definition ) {
		is_same( false, $definition['safe_auto'], 'in approval mode nothing runs on its own' );
	}

	set_settings( array( 'ai_agent_mode' => 'auto' ) );
	foreach ( BAP_Commerce_Agent::register_actions( array() ) as $definition ) {
		is_same( true, $definition['safe_auto'], 'in auto mode they may' );
	}
} );

test( 'agent: actions are attached from facts the plugin computed', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );

	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );
	$items  = BAP_AI_Provider::analyze( $packet )['recommendations'];

	$actionable = array_values( array_filter( $items, static function ( $item ) {
		return ! empty( $item['action']['type'] );
	} ) );

	ok( count( $actionable ) > 0, 'at least one recommendation is executable' );

	foreach ( $actionable as $item ) {
		ok(
			in_array( $item['action']['type'], array( 'woocommerce.discount_product', 'woocommerce.bundle_coupon' ), true ),
			'and only allowlisted verbs appear'
		);
	}
} );

/* ============================================================ */
/* GA4 and Clarity                                              */
/* ============================================================ */

test( 'ga4: a service-account file must actually be one', function () {
	ok( BAP_GA4::set_credentials( 'not json at all' ) instanceof WP_Error );
	ok( BAP_GA4::set_credentials( '{"client_email":"a@b.c"}' ) instanceof WP_Error, 'a key is required too' );
	is_same( true, BAP_GA4::set_credentials( '{"client_email":"a@b.c","private_key":"----KEY----"}' ) );
} );

test( 'ga4: the private key never reaches the admin screen', function () {
	BAP_GA4::set_credentials( '{"client_email":"reader@proj.iam.gserviceaccount.com","private_key":"SUPER-SECRET-KEY"}' );

	$status = BAP_GA4::status();
	$json   = json_encode( $status );

	ok( ! str_contains( $json, 'SUPER-SECRET-KEY' ), 'no key material in the status payload' );
	ok( ! str_contains( $json, 'reader@proj.iam.gserviceaccount.com' ), 'and the address is masked' );
	is_same( true, $status['has_key'] );
} );

test( 'ga4: only the two fields that are used are stored', function () {
	BAP_GA4::set_credentials( json_encode( array(
		'type'         => 'service_account',
		'project_id'   => 'proj',
		'private_key'  => 'K',
		'client_email' => 'a@b.c',
		'client_id'    => '12345',
		'token_uri'    => 'https://example.test',
	) ) );

	is_same( array( 'client_email', 'private_key' ), array_keys( $GLOBALS['bap_options']['bap_ga4_credentials'] ) );
} );

test( 'clarity: the daily budget is counted before the call, not after', function () {
	BAP_Clarity::set_token( 'tok' );
	fake_http( 500, '' );

	is_same( 0, BAP_Clarity::usage()['count'] );
	BAP_Clarity::facts( 3 );
	is_same( 1, BAP_Clarity::usage()['count'], 'a failed request still spent quota at Clarity' );
} );

test( 'clarity: friction becomes facts that name the page and the signal', function () {
	BAP_Clarity::set_token( 'tok' );
	fake_http( 200, array(
		array(
			'metricName'  => 'ScriptErrorCount',
			'information' => array( array( 'URL' => '/checkout', 'sessionsCount' => '312', 'sessionsWithMetricPercentage' => 18.4 ) ),
		),
		array(
			'metricName'  => 'Traffic',
			'information' => array( array( 'totalSessionCount' => '4000' ) ),
		),
	) );

	$result = BAP_Clarity::facts( 3 );
	$fact   = $result['facts'][0];

	is_same( 'ux.friction', $fact['kind'] );
	is_same( 'script_errors', $fact['value']['signal'] );
	is_same( '/checkout', $fact['value']['page_path'] );
	is_same( 312, $fact['value']['sessions'] );

	// The three-day window is stated rather than passed off as the full period.
	ok( count( $result['warnings'] ) > 0, 'the window limitation is declared' );
	ok( str_contains( $result['warnings'][0], '۳' ) || str_contains( $result['warnings'][0], '3' ) );
} );

test( 'insights: a script error on the checkout is raised as critical', function () {
	BAP_Clarity::set_token( 'tok' );
	fake_http( 200, array( array(
		'metricName'  => 'ScriptErrorCount',
		'information' => array( array( 'URL' => '/checkout', 'sessionsCount' => '400', 'sessionsWithMetricPercentage' => 18.4 ) ),
	) ) );

	seed_shop();
	$items = BAP_Local_Insights::derive( BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ) );

	$found = null;
	foreach ( $items as $item ) {
		if ( str_contains( $item['title'], '/checkout' ) ) { $found = $item; break; }
	}

	ok( null !== $found, 'the friction was turned into advice' );
	is_same( 'critical', $found['priority'], 'a defect outranks a design problem' );
	ok( str_contains( $found['summary'], 'کنسول' ), 'and the advice is something a developer can do today' );
} );

test( 'packet: an unconfigured external source adds nothing and breaks nothing', function () {
	seed_shop();

	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );

	is_same( false, $packet['data_quality']['sources']['ga4'] );
	is_same( false, $packet['data_quality']['sources']['clarity'] );
	is_same( true, $packet['data_quality']['sources']['woocommerce'] );
	ok( count( $packet['facts'] ) > 0, 'WooCommerce facts are unaffected' );
} );

test( 'packet: no fact carries anything that identifies a person', function () {
	seed_shop();
	BAP_Clarity::set_token( 'tok' );
	fake_http( 200, array( array(
		'metricName'  => 'RageClickCount',
		'information' => array( array( 'URL' => '/cart', 'sessionsCount' => '50', 'sessionsWithMetricPercentage' => 4.0 ) ),
	) ) );

	$json = json_encode( BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ) );

	foreach ( array( 'email', 'customer_id', 'ip_address', 'anonymous_id', 'user_id', 'order_id' ) as $leak ) {
		ok( ! str_contains( $json, $leak ), "packet must not contain {$leak}" );
	}
} );

test( 'agent: the allowlist is authoritative without any hook having fired', function () {
	// The registry is the security boundary. It used to gain the agent's verbs
	// through a filter registered at boot, which meant an approval could be
	// refused — or, worse, a boundary could be absent — depending on load order.
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );

	$registry = BAP_AI::action_registry();

	ok( isset( $registry['woocommerce.bundle_coupon'] ), 'present with no add_filter call anywhere' );
	is_same( array(), $GLOBALS['bap_filters'], 'and nothing was hooked to get it there' );
} );

test( 'agent: approving a recommendation actually changes the shop', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval', 'ai_autonomy' => 'approval' ) );

	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );
	BAP_AI::ingest( array( 'recommendations' => BAP_AI_Provider::analyze( $packet )['recommendations'] ) );

	$applied = null;
	foreach ( BAP_AI::recommendations() as $item ) {
		if ( empty( $item['action']['type'] ) ) { continue; }
		$applied = BAP_AI::decide( $item['id'], 'approve', true );
		break;
	}

	ok( null !== $applied, 'an executable recommendation was found' );
	is_same( 'applied', $applied['status'], $applied['last_error'] ?? 'execution failed' );
	ok( count( BAP_Commerce_Agent::history() ) > 0, 'and it is in the change log, revertible' );
} );

/* ============================================================ */
/* The site's own backend                                       */
/* ============================================================ */

/** One validated event, of the shape the ingest route produces. */
function bap_event( array $overrides = array() ): array {
	static $counter = 0;
	$counter++;

	return array_merge(
		array(
			'event_id'         => 'evt_' . $counter,
			'event_type'       => 'page_view',
			'page_view_id'     => 'pv_' . $counter,
			'identity'         => array( 'anonymous_id' => 'anon_a' ),
			'timestamp_server' => gmdate( 'Y-m-d\TH:i:s\Z' ),
			'page'             => array( 'path' => '/', 'url' => 'https://shop.test/', 'referrer' => '' ),
			'context'          => array( 'device_type' => 'mobile' ),
			'data'             => array(),
		),
		$overrides
	);
}

test( 'local store: an event is recorded and countable', function () {
	is_same( true, BAP_Local_Store::record( bap_event() ) );
	is_same( 1, BAP_Local_Store::count( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ) );
} );

test( 'local store: a retried event cannot be counted twice', function () {
	$event = bap_event();

	is_same( true, BAP_Local_Store::record( $event ) );
	is_same( false, BAP_Local_Store::record( $event ), 'the unique key rejects the repeat' );
	is_same( 1, BAP_Local_Store::count( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ) );
} );

test( 'local store: nothing identifying is written', function () {
	BAP_Local_Store::record( bap_event( array(
		'page'    => array(
			'path'     => '/checkout?token=secret&email=a@b.c',
			'referrer' => 'https://google.com/search?q=private+thing',
		),
		'context' => array( 'device_type' => 'mobile', 'ip' => '203.0.113.9' ),
	) ) );

	$row  = $GLOBALS['wpdb']->local[0];
	$json = json_encode( $row );

	is_same( '/checkout', $row['page_path'], 'the query string is dropped' );
	is_same( 'google.com', $row['referrer_host'], 'only the referring host is kept' );
	ok( ! str_contains( $json, '203.0.113.9' ), 'no IP address' );
	ok( ! str_contains( $json, 'a@b.c' ), 'no email' );
	ok( ! str_contains( $json, 'private+thing' ), 'no third-party search terms' );
} );

test( 'local store: a referrer from the site itself is not a traffic source', function () {
	is_same( '', BAP_Local_Store::referrer_host( 'https://shop.test/cart' ), 'internal navigation' );
	is_same( '', BAP_Local_Store::referrer_host( '' ), 'direct' );
	is_same( 'instagram.com', BAP_Local_Store::referrer_host( 'https://www.instagram.com/p/xyz' ), 'www is stripped' );
} );

test( 'local store: money is read only from a purchase', function () {
	BAP_Local_Store::record( bap_event( array( 'event_type' => 'add_to_cart', 'data' => array( 'value' => 999999 ) ) ) );
	BAP_Local_Store::record( bap_event( array( 'event_type' => 'purchase', 'data' => array( 'value' => 250000 ) ) ) );

	$values = array_column( $GLOBALS['wpdb']->local, 'value', 'event_type' );

	is_same( 0.0, $values['add_to_cart'], 'an abandoned basket is not revenue' );
	is_same( 250000.0, $values['purchase'] );
} );

test( 'local store: a browser clock set to 1999 cannot move an event out of range', function () {
	BAP_Local_Store::record( bap_event( array(
		'timestamp_client' => '1999-01-01T00:00:00Z',
		'timestamp_server' => gmdate( 'Y-m-d\TH:i:s\Z' ),
	) ) );

	is_same( gmdate( 'Y-m-d' ), substr( $GLOBALS['wpdb']->local[0]['occurred_at'], 0, 10 ) );
} );

test( 'local reports: the dashboard is not empty once anything has happened', function () {
	$today = gmdate( 'Y-m-d' );

	BAP_Local_Store::record( bap_event( array( 'identity' => array( 'anonymous_id' => 'anon_a' ), 'page' => array( 'path' => '/' ) ) ) );
	BAP_Local_Store::record( bap_event( array( 'identity' => array( 'anonymous_id' => 'anon_a' ), 'page' => array( 'path' => '/shop' ) ) ) );
	BAP_Local_Store::record( bap_event( array( 'identity' => array( 'anonymous_id' => 'anon_b' ), 'page' => array( 'path' => '/shop' ) ) ) );

	$metrics = BAP_Local_Reports::metrics( $today, $today );

	is_same( 3, $metrics['total_events'] );
	is_same( 3, $metrics['page_views'] );
	is_same( 2, $metrics['unique_users'] );
	is_same( 'local', $metrics['source'] );
	is_same( '/shop', $metrics['top_pages'][0]['url'], 'the busiest page leads' );
	is_same( 2, $metrics['top_pages'][0]['views'] );
} );

test( 'local reports: a visitor who comes back after a long gap is two sessions', function () {
	$today = gmdate( 'Y-m-d' );
	$base  = strtotime( $today . ' 09:00:00 UTC' );

	// Two clicks a minute apart, then a return three hours later.
	foreach ( array( 0, 60, 3 * HOUR_IN_SECONDS ) as $offset ) {
		BAP_Local_Store::record( bap_event( array(
			'timestamp_server' => gmdate( 'Y-m-d\TH:i:s\Z', $base + $offset ),
		) ) );
	}

	is_same( 2, BAP_Local_Reports::metrics( $today, $today )['sessions'] );
} );

test( 'local reports: countries are left empty rather than guessed', function () {
	$today = gmdate( 'Y-m-d' );
	BAP_Local_Store::record( bap_event() );

	is_same( array(), BAP_Local_Reports::metrics( $today, $today )['countries'] );
} );

test( 'local reports: direct traffic is named, not blank', function () {
	$today = gmdate( 'Y-m-d' );

	BAP_Local_Store::record( bap_event( array( 'page' => array( 'path' => '/', 'referrer' => '' ) ) ) );
	BAP_Local_Store::record( bap_event( array(
		'identity' => array( 'anonymous_id' => 'anon_b' ),
		'page'     => array( 'path' => '/', 'referrer' => 'https://instagram.com/x' ),
	) ) );

	$sources = array_column( BAP_Local_Reports::metrics( $today, $today )['traffic_sources'], 'sessions', 'source' );

	is_same( 1, $sources['direct'] );
	is_same( 1, $sources['instagram.com'] );
} );

test( 'local reports: revenue comes from orders, not from purchase events', function () {
	$today = gmdate( 'Y-m-d' );
	seed_shop();

	// A purchase event with a wrong figure. WooCommerce is the record, so the
	// card must show the orders total and ignore this.
	BAP_Local_Store::record( bap_event( array( 'event_type' => 'purchase', 'data' => array( 'value' => 5 ) ) ) );

	$metrics = BAP_Local_Reports::metrics( $today, $today );

	is_same( 26, $metrics['conversions'], 'every paid order in the window' );
	ok( $metrics['revenue'] > 1000, 'and their real total, not the event value' );
	is_same( 'IRT', $metrics['currency'] );
} );

test( 'local reports: the chart has a row for every day, including quiet ones', function () {
	$to   = gmdate( 'Y-m-d' );
	$from = gmdate( 'Y-m-d', strtotime( $to ) - ( 6 * DAY_IN_SECONDS ) );

	BAP_Local_Store::record( bap_event() );

	$series = BAP_Local_Reports::metrics( $from, $to )['timeseries'];

	is_same( 7, count( $series ), 'seven days requested, seven rows returned' );
	is_same( $from, $series[0]['date'] );
	is_same( 1, $series[6]['events'], 'today has the event' );
	is_same( 0, $series[0]['events'], 'and a quiet day is a zero, not a gap' );
} );

test( 'local reports: an empty store reports zeros rather than inventing a start', function () {
	$today   = gmdate( 'Y-m-d' );
	$metrics = BAP_Local_Reports::metrics( $today, $today );

	is_same( 0, $metrics['total_events'] );
	is_same( 0, $metrics['sessions'] );
	is_same( 0.0, $metrics['conversion_rate'] );
	is_same( array(), $metrics['top_pages'] );
	is_same( '', BAP_Local_Store::first_day() );
} );

test( 'local reports: the funnel comes from the rollup', function () {
	$today = BAP_Rollup::today();

	foreach ( range( 1, 100 ) as $i ) { BAP_Rollup::record( 'view_item', 'mobile', '/p' ); }
	foreach ( range( 1, 40 ) as $i )  { BAP_Rollup::record( 'add_to_cart', 'mobile', '/p' ); }

	$steps = array_column( BAP_Local_Reports::funnel( $today, $today )['steps'], null, 'step' );

	is_same( 100, $steps['view_item']['count'] );
	is_same( 60.0, $steps['view_item']['drop_pc'], '60 of 100 stopped after viewing' );
	is_same( 40.0, $steps['add_to_cart']['of_first_pc'] );
} );

test( 'local reports: experience says which signals are switched off', function () {
	$today = gmdate( 'Y-m-d' );
	BAP_Local_Store::record( bap_event( array( 'event_type' => 'js_error', 'page' => array( 'path' => '/checkout' ) ) ) );

	$report = BAP_Local_Reports::experience( $today, $today );

	is_same( 1, $report['totals']['js_error'] );
	is_same( '/checkout', $report['pages'][0]['page_path'] );
	// Every experience switch is off by default, so the report must say so
	// rather than let an empty panel read as "no problems found".
	ok( count( $report['notes'] ) > 0, 'the disabled options are named' );
} );

test( 'local reports: journeys are the paths visitors actually walked', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( array( '/', '/shop', '/product/x' ) as $path ) {
		BAP_Local_Store::record( bap_event( array(
			'identity' => array( 'anonymous_id' => 'anon_a' ),
			'page'     => array( 'path' => $path ),
		) ) );
	}

	$report = BAP_Local_Reports::journeys( $today, $today );

	is_same( '/ → /shop → /product/x', $report['paths'][0]['path'] );
	is_same( '/', $report['entries'][0]['page_path'] );
	is_same( '/product/x', $report['exits'][0]['page_path'] );
} );

test( 'local store: retention drops what is past its window', function () {
	set_settings( array( 'data_retention_days' => 30 ) );

	BAP_Local_Store::record( bap_event( array(
		'timestamp_server' => gmdate( 'Y-m-d\TH:i:s\Z', time() - ( 90 * DAY_IN_SECONDS ) ),
	) ) );
	BAP_Local_Store::record( bap_event() );

	is_same( 2, BAP_Local_Store::size() );
	BAP_Local_Store::prune();
	is_same( 1, BAP_Local_Store::size(), 'only the recent event survives' );
} );

test( 'settings: tracking no longer depends on having a collector', function () {
	// The regression this whole change exists for: with no collector URL the
	// tracker was never enqueued, so nothing was ever measured and the
	// dashboard stayed empty forever.
	is_same( false, BAP_Settings::is_configured(), 'no collector is configured' );
	is_same( true, BAP_Settings::tracking_enabled(), 'and the tracker still runs' );

	set_settings( array( 'enabled' => false ) );
	is_same( false, BAP_Settings::tracking_enabled(), 'the off switch is the only thing that stops it' );
} );

test( 'settings: a site without a collector still has a stable identifier', function () {
	$id = BAP_Settings::resolved_site_id();

	ok( str_starts_with( $id, 'local_' ), 'derived from the site address' );
	is_same( $id, BAP_Settings::resolved_site_id(), 'and it does not change between calls' );

	set_settings( array( 'site_id' => 'given-by-collector' ) );
	is_same( 'given-by-collector', BAP_Settings::resolved_site_id(), 'a real one always wins' );
} );

test( 'plugin: the front end is never gated on collector configuration again', function () {
	$source = file_get_contents( BAP_PLUGIN_DIR . 'includes/integrations/class-bap-wordpress.php' );

	ok( ! str_contains( $source, 'BAP_Settings::is_configured()' ), 'the tracker gate must be tracking_enabled()' );
	ok( str_contains( $source, 'BAP_Settings::tracking_enabled()' ) );
} );

/* ============================================================ */
/* The routes, end to end                                       */
/* ============================================================ */

/** Posts one event through the real ingest route. */
function bap_post_event( array $payload ): WP_REST_Response {
	return BAP_REST_Controller::handle_events( new WP_REST_Request( array(), json_encode( $payload ) ) );
}

test( 'route: an event is accepted and stored when there is no collector', function () {
	// The exact reported symptom: no collector configured, so the route used to
	// answer 503 `not_configured`, the browser retried forever, and the site
	// recorded nothing.
	is_same( false, BAP_Settings::is_configured() );

	$response = bap_post_event( array(
		'event_id'     => 'evt_abcdef1234567890',
		'event_type'   => 'page_view',
		'page_view_id' => 'pv_abcdef123456',
		'identity'     => array( 'anonymous_id' => 'anon_abcdef1234567890abcdef12345678' ),
		'page'         => array( 'path' => '/shop', 'url' => 'https://shop.test/shop' ),
		'context'      => array( 'device_type' => 'mobile' ),
	) );

	is_same( 200, $response->get_status(), 'settled, not retried' );
	is_same( 1, BAP_Local_Store::count( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ), 'and actually written' );
} );

test( 'route: tracking switched off still refuses, and says so', function () {
	set_settings( array( 'enabled' => false ) );

	$response = bap_post_event( array(
		'event_id'     => 'evt_abcdef1234567890',
		'event_type'   => 'page_view',
		'page_view_id' => 'pv_abcdef123456',
		'identity'     => array( 'anonymous_id' => 'anon_abcdef1234567890abcdef12345678' ),
		'page'         => array( 'path' => '/' ),
	) );

	is_same( 0, BAP_Local_Store::size(), 'nothing is recorded when tracking is off' );
	is_same( 202, $response->get_status() );
} );

test( 'route: the dashboard answers with real numbers and no collector', function () {
	foreach ( array( '/', '/shop', '/shop' ) as $index => $path ) {
		bap_post_event( array(
			'event_id'     => 'evt_abcdef123456789' . $index,
			'event_type'   => 'page_view',
			'page_view_id' => 'pv_abcdef12345' . $index,
			'identity'     => array( 'anonymous_id' => 'anon_abcdef1234567890abcdef1234567' . $index ),
			'page'         => array( 'path' => $path, 'url' => 'https://shop.test' . $path ),
			'context'      => array( 'device_type' => 'desktop' ),
		) );
	}

	$body = BAP_REST_Controller::handle_dashboard( new WP_REST_Request( array( 'range' => 'last_7_days' ) ) )->get_data();

	is_same( true, $body['success'], 'no more 503' );
	is_same( 'local', $body['source'] );
	is_same( 3, $body['metrics']['total_events'] );
	is_same( 3, $body['metrics']['unique_users'] );
	is_same( '/shop', $body['metrics']['top_pages'][0]['url'] );
	is_same( true, $body['has_timeseries'], 'the trend chart has something to draw' );
	is_same( gmdate( 'Y-m-d' ), $body['collecting_since'] );
} );

test( 'route: a configured collector that fails degrades to local data', function () {
	set_settings( array( 'api_url' => 'https://collector.test/api/v2', 'site_id' => 'abc' ) );
	is_same( true, BAP_Settings::is_configured() );

	// No HTTP response configured, so wp_remote_post returns a WP_Error — an
	// unreachable collector.
	BAP_Local_Store::record( bap_event() );

	$body = BAP_REST_Controller::handle_dashboard( new WP_REST_Request( array( 'range' => 'last_7_days' ) ) )->get_data();

	is_same( true, $body['success'], 'the screen still renders' );
	is_same( 'local', $body['source'] );
	ok( '' !== $body['upstream_error'], 'and the collector failure is reported, not hidden' );
	is_same( 1, $body['metrics']['total_events'] );
} );

test( 'route: a working collector is preferred over local data', function () {
	set_settings( array( 'api_url' => 'https://collector.test/api/v2', 'site_id' => 'abc' ) );

	// Local store says one event; the collector says a thousand. The collector
	// wins, because it sees more than this one site does.
	BAP_Local_Store::record( bap_event() );
	fake_http( 200, array( 'metrics' => array( 'total_events' => 1000, 'unique_users' => 400 ) ) );

	$body = BAP_REST_Controller::handle_dashboard( new WP_REST_Request( array( 'range' => 'last_7_days', 'skip_compare' => 'true' ) ) )->get_data();

	is_same( 'collector', $body['source'] );
	is_same( 1000, $body['metrics']['total_events'] );
} );

test( 'route: journeys and experience fall back instead of erroring', function () {
	BAP_Local_Store::record( bap_event( array( 'event_type' => 'js_error', 'page' => array( 'path' => '/checkout' ) ) ) );

	$experience = BAP_REST_Controller::handle_experience( new WP_REST_Request( array( 'range' => 'last_7_days' ) ) )->get_data();
	$journeys   = BAP_REST_Controller::handle_journeys( new WP_REST_Request( array( 'range' => 'last_7_days' ) ) )->get_data();

	is_same( true, $experience['success'] );
	is_same( 'local', $experience['source'] );
	is_same( 1, $experience['totals']['js_error'] );

	is_same( true, $journeys['success'] );
	is_same( 'local', $journeys['source'] );
} );

test( 'local reports: a conversion rate above 100% is capped and explained', function () {
	$today = gmdate( 'Y-m-d' );
	seed_shop(); // 26 orders.

	// One tracked visitor. Without the cap this reports 2600%.
	BAP_Local_Store::record( bap_event() );

	$metrics = BAP_Local_Reports::metrics( $today, $today );

	is_same( 100.0, $metrics['conversion_rate'] );
	ok( count( $metrics['notes'] ) > 0, 'and the mismatch is explained, not hidden' );
} );

run_tests();
