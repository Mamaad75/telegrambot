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

test( 'provider: the default is a Llama server, addressed explicitly', function () {
	is_same( 'llama', BAP_AI_Provider::current(), 'llama is the shipped default' );
	is_same( BAP_AI_Provider::LLAMA_DEFAULT_MODEL, BAP_AI_Provider::model(), 'the model name still has a default' );
	is_same( '', BAP_AI_Provider::api_key(), 'an unauthenticated model server needs no key' );

	// The address does not. A plugin runs on hosting that cannot run a model,
	// so the server is elsewhere and has to be named.
	is_same( '', BAP_AI_Provider::base_url() );
} );

test( 'provider: the external analysis service is gone', function () {
	$source = file_get_contents( BAP_PLUGIN_DIR . 'includes/core/class-bap-ai-provider.php' );

	ok( ! str_contains( $source, 'PROVIDER_BACKEND' ), 'the backend provider constant is removed' );
	ok( ! str_contains( $source, "BAP_Transport::request( 'ai/analyze'" ), 'nothing calls out to an analysis service' );
	is_same( array( 'llama', 'gemini', 'webhook', 'openai_compatible', 'local' ), BAP_AI_Provider::providers() );

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
	set_settings( array( 'ai_provider' => 'llama', 'ai_provider_url' => 'http://10.0.0.5:11434/v1' ) );

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
	set_settings( array( 'ai_provider' => 'llama', 'ai_provider_url' => 'http://10.0.0.5:11434/v1' ) );

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

test( 'gemini: address and model fill themselves in, the key does not', function () {
	set_settings( array( 'ai_provider' => 'gemini' ) );

	is_same( 'gemini', BAP_AI_Provider::current() );
	is_same( BAP_AI_Provider::GEMINI_DEFAULT_URL, BAP_AI_Provider::base_url(), 'there is only one Gemini address' );
	is_same( BAP_AI_Provider::GEMINI_DEFAULT_MODEL, BAP_AI_Provider::model() );
	is_same( '', BAP_AI_Provider::api_key(), 'but the key is the one thing only the shop owner has' );
} );

test( 'gemini: whatever shape of root is pasted, the method URL is right', function () {
	$expected = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

	foreach ( array(
		'',
		'https://generativelanguage.googleapis.com',
		'https://generativelanguage.googleapis.com/',
		'https://generativelanguage.googleapis.com/v1beta',
		'https://generativelanguage.googleapis.com/v1beta/',
		'https://generativelanguage.googleapis.com/v1beta/models',
	) as $base ) {
		is_same( $expected, BAP_AI_Provider::gemini_endpoint( $base, 'gemini-2.5-flash', 'generateContent' ), "failed for root '{$base}'" );
	}

	// Google's own listing prints model names with a `models/` prefix, so that
	// is what gets copied into the field.
	is_same( $expected, BAP_AI_Provider::gemini_endpoint( '', 'models/gemini-2.5-flash', 'generateContent' ) );
} );

test( 'gemini: without a key nothing is sent anywhere', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'gemini' ) );

	$result = BAP_AI_Provider::analyze( BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ) );

	is_same( null, $GLOBALS['bap_http_request'], 'no request is attempted without a key' );
	is_same( 'local', $result['provider'], 'the rule engine answers instead' );
	is_same( true, $result['fallback'] );
} );

test( 'gemini: the key travels in a header, never in the URL', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'gemini' ) );
	BAP_AI_Provider::set_api_key( 'AIzaSyFAKEKEYFORTESTSONLY00000000000' );

	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );
	$fact   = $packet['facts'][0]['id'];

	fake_http( 200, array( 'candidates' => array( array( 'content' => array( 'parts' => array(
		array( 'text' => json_encode( array( 'recommendations' => array( array(
			'title'    => 'موبایل را جدی بگیرید',
			'summary'  => 'بیشتر سفارش‌ها از موبایل می‌آید.',
			'evidence' => array( $fact ),
		) ) ) ) ),
	) ) ) ) ) );

	$result  = BAP_AI_Provider::analyze( $packet );
	$request = $GLOBALS['bap_http_request'];

	is_same( true, $result['ok'] );
	is_same( 'gemini', $result['provider'] );
	is_same( false, $result['fallback'] );

	// A key in a query string is copied into every access log and proxy log it
	// passes through. This assertion is the whole reason the stub records URLs.
	ok( ! str_contains( $request['url'], 'AIzaSy' ), 'the key is not in the URL' );
	ok( ! str_contains( $request['url'], 'key=' ), 'not even as an empty-looking parameter' );
	is_same( 'AIzaSyFAKEKEYFORTESTSONLY00000000000', $request['args']['headers']['x-goog-api-key'] );
	ok( str_ends_with( $request['url'], ':generateContent' ), 'the native API, not the compatibility shim' );

	$body = json_decode( $request['args']['body'], true );
	is_same( 'application/json', $body['generationConfig']['responseMimeType'] );
	ok( isset( $body['system_instruction']['parts'][0]['text'] ), 'the rules go in system_instruction' );
	ok( ! str_contains( $request['args']['body'], 'AIzaSy' ), 'nor is the key in the body' );
} );

test( 'gemini: a reply split across parts is reassembled, not truncated', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'gemini' ) );
	BAP_AI_Provider::set_api_key( 'AIzaSyFAKEKEYFORTESTSONLY00000000000' );

	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );
	$fact   = $packet['facts'][0]['id'];
	$whole  = json_encode( array( 'recommendations' => array( array(
		'title'    => 'دو تکه',
		'summary'  => 'پاسخ در دو قطعه آمد.',
		'evidence' => array( $fact ),
	) ) ) );

	// Taking only parts[0] would leave half a JSON document and no
	// recommendations at all — a silent failure that looks like a bad model.
	fake_http( 200, array( 'candidates' => array( array( 'content' => array( 'parts' => array(
		array( 'text' => substr( $whole, 0, 20 ) ),
		array( 'text' => substr( $whole, 20 ) ),
	) ) ) ) ) );

	$result = BAP_AI_Provider::analyze( $packet );

	is_same( true, $result['ok'] );
	is_same( 'دو تکه', $result['recommendations'][0]['title'] );
} );

test( 'gemini: a spent free quota says to wait, not to check the settings', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'gemini' ) );
	BAP_AI_Provider::set_api_key( 'AIzaSyFAKEKEYFORTESTSONLY00000000000' );

	fake_http( 429, array( 'error' => array( 'status' => 'RESOURCE_EXHAUSTED', 'message' => 'Quota exceeded' ) ) );

	$result = BAP_AI_Provider::analyze( BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ) );

	// The analysis still produces something; the reason is kept alongside it.
	is_same( 'local', $result['provider'] );
	is_same( true, $result['fallback'] );
	ok( str_contains( $result['error'], 'سهمیه' ), 'the message names the quota: ' . $result['error'] );
	ok( ! str_contains( $result['error'], '429' ), 'a status code is not an explanation' );
} );

test( 'gemini: a rejected key and an unknown model do not get the same message', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'gemini', 'ai_provider_model' => 'gemini-9-imaginary' ) );
	BAP_AI_Provider::set_api_key( 'AIzaSyFAKEKEYFORTESTSONLY00000000000' );
	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );

	fake_http( 400, array( 'error' => array( 'status' => 'INVALID_ARGUMENT', 'message' => 'API key not valid' ) ) );
	$bad_key = BAP_AI_Provider::analyze( $packet )['error'];

	fake_http( 404, array( 'error' => array( 'status' => 'NOT_FOUND', 'message' => 'models/gemini-9-imaginary is not found' ) ) );
	$bad_model = BAP_AI_Provider::analyze( $packet )['error'];

	ok( str_contains( $bad_key, 'aistudio.google.com' ), 'the key error says where to get a new one' );
	ok( str_contains( $bad_model, 'gemini-9-imaginary' ), 'the model error names the model: ' . $bad_model );
	ok( $bad_key !== $bad_model, 'two different problems, two different messages' );
} );

test( 'gemini: a 403 says which of its three causes it was', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'gemini' ) );
	BAP_AI_Provider::set_api_key( 'AIzaSyFAKEKEYFORTESTSONLY00000000000' );
	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );

	// Reporting all three as "check the API is enabled and the key is not
	// restricted" sends two of them to inspect settings that were never wrong.
	fake_http( 403, array( 'error' => array( 'status' => 'PERMISSION_DENIED', 'message' => 'Generative Language API has not been used in project 12345 before or it is disabled.' ) ) );
	$disabled = BAP_AI_Provider::analyze( $packet )['error'];

	fake_http( 403, array( 'error' => array( 'status' => 'PERMISSION_DENIED', 'message' => 'Requests from referer https://shop.test/ are blocked.' ) ) );
	$restricted = BAP_AI_Provider::analyze( $packet )['error'];

	fake_http( 400, array( 'error' => array( 'status' => 'FAILED_PRECONDITION', 'message' => 'User location is not supported for the API use.' ) ) );
	$located = BAP_AI_Provider::analyze( $packet )['error'];

	ok( str_contains( $disabled, 'Enable' ), 'enablement: ' . $disabled );
	ok( str_contains( $restricted, 'محدود' ), 'restriction: ' . $restricted );
	ok( str_contains( $located, 'موقعیت جغرافیایی' ), 'location: ' . $located );
	ok( $disabled !== $restricted && $restricted !== $located, 'three causes, three messages' );

	// A server-location refusal is not fixable by changing settings, so the
	// message has to name the two things that actually work.
	ok( str_contains( $located, 'وبهوک' ) && str_contains( $located, 'لاما' ), 'location error offers the two real options' );
} );

test( 'gemini: google own words are shown, with anything key-shaped removed', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'gemini' ) );
	BAP_AI_Provider::set_api_key( 'AIzaSyFAKEKEYFORTESTSONLY00000000000' );
	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );

	// Dropping this sentence is what made a 403 undiagnosable.
	fake_http( 403, array( 'error' => array( 'status' => 'PERMISSION_DENIED', 'message' => 'Some reason only Google knows' ) ) );
	$shown = BAP_AI_Provider::analyze( $packet )['error'];
	ok( str_contains( $shown, 'Some reason only Google knows' ), 'the detail survives: ' . $shown );

	// But this text reaches a screen and a log that gets pasted into support
	// threads, so a key echoed back must not travel with it.
	fake_http( 403, array( 'error' => array( 'status' => 'PERMISSION_DENIED', 'message' => 'Key AIzaSyFAKEKEYFORTESTSONLY00000000000 is blocked' ) ) );
	$scrubbed = BAP_AI_Provider::analyze( $packet )['error'];
	ok( ! str_contains( $scrubbed, 'AIzaSy' ), 'the key is scrubbed: ' . $scrubbed );
	ok( str_contains( $scrubbed, 'حذف شد' ), 'and the removal is visible rather than silent' );

	// A reply with no message at all must not leave a dangling separator.
	fake_http( 403, array( 'error' => array( 'status' => 'PERMISSION_DENIED' ) ) );
	$bare = BAP_AI_Provider::analyze( $packet )['error'];
	ok( ! str_contains( $bare, 'پاسخ گوگل:' ), 'no empty detail is appended: ' . $bare );
} );

test( 'gemini: a blocked prompt and a truncated reply are told apart', function () {
	seed_shop();
	set_settings( array( 'ai_provider' => 'gemini' ) );
	BAP_AI_Provider::set_api_key( 'AIzaSyFAKEKEYFORTESTSONLY00000000000' );
	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );

	// Both arrive as HTTP 200 with no text, and they need opposite fixes.
	fake_http( 200, array( 'promptFeedback' => array( 'blockReason' => 'SAFETY' ), 'candidates' => array() ) );
	$blocked = BAP_AI_Provider::analyze( $packet )['error'];

	fake_http( 200, array( 'candidates' => array( array( 'finishReason' => 'MAX_TOKENS', 'content' => array( 'parts' => array() ) ) ) ) );
	$truncated = BAP_AI_Provider::analyze( $packet )['error'];

	ok( str_contains( $blocked, 'فیلتر' ), 'blocked: ' . $blocked );
	ok( str_contains( $truncated, 'کوتاه‌تر' ), 'truncated says to shrink the range: ' . $truncated );
} );

test( 'gemini: the connection test lists only models that can answer a prompt', function () {
	set_settings( array( 'ai_provider' => 'gemini' ) );
	BAP_AI_Provider::set_api_key( 'AIzaSyFAKEKEYFORTESTSONLY00000000000' );

	fake_http( 200, array( 'models' => array(
		array( 'name' => 'models/gemini-2.5-flash', 'supportedGenerationMethods' => array( 'generateContent' ) ),
		array( 'name' => 'models/text-embedding-004', 'supportedGenerationMethods' => array( 'embedContent' ) ),
	) ) );

	$probe = BAP_AI_Provider::probe();

	is_same( true, $probe['ok'] );
	is_same( array( 'gemini-2.5-flash' ), $probe['models'], 'the embedding model is not something to choose' );
	ok( str_ends_with( $GLOBALS['bap_http_request']['url'], '/v1beta/models' ), 'listing, not generating — it does not spend a free analysis' );
	ok( ! str_contains( $GLOBALS['bap_http_request']['url'], 'AIzaSy' ), 'the key is not in the URL here either' );
} );

/* ============================================================ */
/* Search rescue                                                */
/* ============================================================ */

/** A search event with a known result count. */
function bap_search( string $term, int $results, string $visitor = 'anon_a' ): void {
	$event = bap_event(
		array(
			'event_type' => 'search',
			'identity'   => array( 'anonymous_id' => $visitor ),
			'data'       => array( 'query' => $term, 'results_count' => $results ),
		)
	);

	BAP_Local_Store::record( $event );
}

test( 'rescue: a zero-result search is told apart from one nobody clicked', function () {
	$today = gmdate( 'Y-m-d' );

	// Three searches that returned nothing: a catalogue or naming problem.
	bap_search( 'استارز ۱۰۰۰', 0, 'anon_a' );
	bap_search( 'استارز ۱۰۰۰', 0, 'anon_b' );
	bap_search( 'استارز ۱۰۰۰', 0, 'anon_c' );

	// Three that returned results. Nobody clicked, but that is a different
	// problem with an opposite fix, and the old proxy could not see the
	// difference.
	bap_search( 'اشتراک', 12, 'anon_d' );
	bap_search( 'اشتراک', 12, 'anon_e' );
	bap_search( 'اشتراک', 12, 'anon_f' );

	$searches = array();
	foreach ( BAP_Local_Reports::explorer( $today, $today )['searches'] as $row ) {
		$searches[ $row['term'] ] = $row;
	}

	is_same( true, $searches['استارز ۱۰۰۰']['no_results'], 'a measured zero is a zero' );
	is_same( false, $searches['اشتراک']['no_results'], 'twelve results is not a catalogue gap' );
	is_same( true, $searches['اشتراک']['no_click'], 'but nobody clicked it either' );
	is_same( false, $searches['استارز ۱۰۰۰']['unmeasured'] );
} );

test( 'rescue: a search whose count was never reported is not called a failure', function () {
	$today = gmdate( 'Y-m-d' );

	// No results_count at all: the site's search is not WordPress's own, or the
	// row predates the column. Calling that zero would invent a problem.
	foreach ( range( 1, 3 ) as $i ) {
		BAP_Local_Store::record(
			bap_event( array( 'event_type' => 'search', 'data' => array( 'query' => 'نامشخص' ) ) )
		);
	}

	$row = BAP_Local_Reports::explorer( $today, $today )['searches'][0];

	is_same( true, $row['unmeasured'] );
	is_same( false, $row['no_results'], 'unmeasured is not zero' );
	is_same( array(), BAP_Search_Rescue::failed_terms( $today, $today ), 'and it never reaches the rescue list' );
} );

test( 'rescue: the two search problems become two tasks with opposite advice', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 4 ) as $i ) {
		bap_search( 'استارز ۱۰۰۰', 0, 'anon_' . $i );
	}
	foreach ( range( 5, 8 ) as $i ) {
		bap_search( 'اشتراک', 9, 'anon_' . $i );
	}

	$kinds = wp_list_pluck( BAP_UX_Tasks::build( $today, $today )['tasks'], 'kind' );

	ok( in_array( 'search_no_results', $kinds, true ), 'the zero-result task exists' );
	ok( in_array( 'search_barren', $kinds, true ), 'the no-click task is still separate' );

	$tasks = array();
	foreach ( BAP_UX_Tasks::build( $today, $today )['tasks'] as $task ) {
		$tasks[ $task['kind'] ] = $task;
	}

	// Adding a product is the fix for one and useless for the other; the two
	// messages must not be interchangeable.
	ok( str_contains( $tasks['search_no_results']['what'], 'ندارید' ), 'zero-result advice: ' . $tasks['search_no_results']['what'] );
	ok( str_contains( $tasks['search_barren']['what'], 'کمکی نمی‌کند' ), 'no-click advice says adding a product will not help' );
	is_same( 'high', $tasks['search_no_results']['severity'] );
	is_same( 'medium', $tasks['search_barren']['severity'] );
} );

test( 'rescue: a product id the model invented is discarded', function () {
	$catalogue = array(
		array( 'id' => 10, 'name' => '۱۰۰۰ استارز تلگرام' ),
		array( 'id' => 11, 'name' => 'اشتراک یوتیوب' ),
	);

	// 999 is not in the catalogue we sent. A model naming inventory the shop
	// does not have is the one failure this feature must never pass on.
	$reply = json_encode(
		array(
			'matches' => array(
				array( 'term' => 'استارز ۱۰۰۰', 'product_id' => 10, 'confidence' => 92, 'reason' => 'همان محصول' ),
				array( 'term' => 'چیز دیگر', 'product_id' => 999, 'confidence' => 95, 'reason' => 'ساختگی' ),
			),
		)
	);

	$parsed = BAP_Search_Rescue::parse( $reply, $catalogue );

	is_same( 10, $parsed['استارز ۱۰۰۰']['product_id'] );
	is_same( 0, $parsed['چیز دیگر']['product_id'], 'an unknown id becomes no match, not a suggestion' );
} );

test( 'rescue: a low-confidence nearest product is reported as no match', function () {
	$catalogue = array( array( 'id' => 10, 'name' => '۱۰۰۰ استارز تلگرام' ) );

	// With a small catalogue there is always a nearest product. Showing it
	// anyway would send someone to add a synonym pointing at the wrong thing.
	$reply = json_encode(
		array( 'matches' => array( array( 'term' => 'کفش ورزشی', 'product_id' => 10, 'confidence' => 20, 'reason' => 'نزدیک‌ترین' ) ) )
	);

	$parsed = BAP_Search_Rescue::parse( $reply, $catalogue );

	is_same( 0, $parsed['کفش ورزشی']['product_id'] );
	is_same( 20, $parsed['کفش ورزشی']['confidence'], 'the score is kept so the screen can explain itself' );
} );

test( 'rescue: json wrapped in prose is still read', function () {
	$catalogue = array( array( 'id' => 7, 'name' => 'گیفت کارت' ) );
	$reply     = "باشه، این نتیجه:\n```json\n" . json_encode( array( 'matches' => array( array( 'term' => 'گیفت', 'product_id' => 7, 'confidence' => 80 ) ) ) ) . "\n```";

	is_same( 7, BAP_Search_Rescue::parse( $reply, $catalogue )['گیفت']['product_id'] );
	is_same( array(), BAP_Search_Rescue::parse( 'سلام، چیزی پیدا نکردم.', $catalogue ), 'and a reply with no json at all is not guessed at' );
} );

test( 'rescue: persian spellings of the same word fold together', function () {
	// The characters that make identical words unequal to a string comparison:
	// Arabic ya and kaf, the zero-width non-joiner, and Persian digits.
	is_same(
		BAP_Search_Rescue::normalize( 'كيف' ),
		BAP_Search_Rescue::normalize( 'کیف' ),
		'Arabic kaf and ya fold to Persian'
	);
	is_same(
		BAP_Search_Rescue::normalize( 'می‌خواهم' ),
		BAP_Search_Rescue::normalize( 'می خواهم' ),
		'the zero-width non-joiner is a space'
	);
	is_same( '1000 استارز', BAP_Search_Rescue::normalize( '۱۰۰۰ استارز' ), 'Persian digits become Latin' );
	is_same( 'استارز تلگرام', BAP_Search_Rescue::normalize( '  استارز،  تلگرام!  ' ), 'punctuation and runs of space collapse' );
} );

test( 'rescue: the offline matcher catches spelling, and admits when it cannot', function () {
	$catalogue = array(
		array( 'id' => 10, 'name' => '۱۰۰۰ استارز تلگرام' ),
		array( 'id' => 11, 'name' => 'اشتراک یوتیوب پریمیوم' ),
	);

	$matches = BAP_Search_Rescue::local_matches(
		array(
			array( 'term' => 'استارز ۱۰۰۰ تلگرام', 'searches' => 3, 'visitors' => 3 ),
			array( 'term' => 'دوچرخه کوهستان', 'searches' => 3, 'visitors' => 3 ),
		),
		$catalogue
	);

	// Same words, different order and digit script: this is what the offline
	// matcher is for, and it needs no model.
	is_same( 10, $matches['استارز ۱۰۰۰ تلگرام']['product_id'] );
	ok( $matches['استارز ۱۰۰۰ تلگرام']['confidence'] >= BAP_Search_Rescue::MIN_CONFIDENCE );

	// Nothing in the catalogue is close, and it says so rather than returning
	// the least-bad row.
	is_same( 0, $matches['دوچرخه کوهستان']['product_id'] );
} );

test( 'rescue: without a model the report still answers, and says which matcher ran', function () {
	$today = gmdate( 'Y-m-d' );
	set_settings( array( 'ai_provider' => 'local' ) );

	bap_add_product( 10, '۱۰۰۰ استارز تلگرام' );

	foreach ( range( 1, 3 ) as $i ) {
		bap_search( 'استارز ۱۰۰۰', 0, 'anon_' . $i );
	}

	$report = BAP_Search_Rescue::report( $today, $today, true );

	is_same( 'local', $report['provider'], 'the rule engine has no model, so the text matcher answered' );
	is_same( 1, count( $report['terms'] ) );
	is_same( 10, $report['terms'][0]['product_id'] );
	is_same( 'synonym', $report['terms'][0]['verdict'] );
	is_same( 3, $report['counts']['lost_searches'] );
	ok( '' !== $report['error'], 'and the reason the model was not used is reported' );
} );

test( 'rescue: a real model reply is used and attributed to the provider', function () {
	$today = gmdate( 'Y-m-d' );
	set_settings( array( 'ai_provider' => 'llama', 'ai_provider_url' => 'http://10.0.0.5:11434/v1' ) );

	bap_add_product( 42, 'اشتراک یوتیوب پریمیوم' );

	foreach ( range( 1, 3 ) as $i ) {
		// Nothing a string comparison would match: only meaning connects
		// "YouTube without ads" to "YouTube Premium subscription".
		bap_search( 'یوتیوب بدون تبلیغ', 0, 'anon_' . $i );
	}

	fake_http( 200, array( 'choices' => array( array( 'message' => array(
		'content' => json_encode(
			array( 'matches' => array( array( 'term' => 'یوتیوب بدون تبلیغ', 'product_id' => 42, 'confidence' => 88, 'reason' => 'پریمیوم همان بدون تبلیغ است.' ) ) )
		),
	) ) ) ) );

	$report = BAP_Search_Rescue::report( $today, $today, true );

	is_same( 'llama', $report['provider'] );
	is_same( 42, $report['terms'][0]['product_id'] );
	is_same( 88, $report['terms'][0]['confidence'] );
	is_same( 'synonym', $report['terms'][0]['verdict'] );
	is_same( 1, $report['counts']['synonyms'] );
	is_same( '', $report['error'] );
} );

test( 'rescue: the catalogue sent to the model carries no prices or stock', function () {
	bap_add_product( 10, 'استارز تلگرام' );

	$catalogue = BAP_Search_Rescue::catalogue();

	// Deciding whether a word means a product needs the name and nothing else.
	// Sending more would put more of the shop's data in front of a third party
	// for no gain.
	is_same( array( array( 'id' => 10, 'name' => 'استارز تلگرام' ) ), $catalogue );
} );

test( 'rescue: building the report writes no events and changes no products', function () {
	$today = gmdate( 'Y-m-d' );
	set_settings( array( 'ai_provider' => 'local' ) );

	bap_add_product( 10, 'استارز تلگرام' );
	foreach ( range( 1, 3 ) as $i ) {
		bap_search( 'استارز', 0, 'anon_' . $i );
	}

	$products_before = $GLOBALS['bap_products'];
	$GLOBALS['wpdb']->log = array();

	BAP_Search_Rescue::report( $today, $today, true );

	foreach ( $GLOBALS['wpdb']->log as $sql ) {
		ok( ! str_contains( $sql, 'INSERT INTO' ), 'no event was written: ' . substr( $sql, 0, 60 ) );
		ok( ! str_contains( $sql, 'DELETE FROM' ), 'nothing was deleted: ' . substr( $sql, 0, 60 ) );
	}

	is_same( $products_before, $GLOBALS['bap_products'], 'no product was touched' );
} );

/* ============================================================ */
/* Importing a results file                                     */
/* ============================================================ */

test( 'import: a file is held to the same rules as a signed request', function () {
	$good = array( 'run_id' => '0f3a9c1e-2b44-4d77-8a10-5e6f7c8d9a0b', 'segments' => array() );

	is_same( null, BAP_ML_REST::reject_payload( $good ), 'a well-formed payload is accepted' );

	// The gate both entry points run. A second way in that forgot one of these
	// would be a hole, which is why the check lives in one place.
	is_same( array( 'invalid_json', 400 ), BAP_ML_REST::reject_payload( 'nonsense' ) );
	is_same( array( 'invalid_json', 400 ), BAP_ML_REST::reject_payload( null ), 'a file that did not parse is not an empty run' );
	is_same( array( 'invalid_run_id', 422 ), BAP_ML_REST::reject_payload( array( 'segments' => array() ) ) );
	is_same( array( 'invalid_run_id', 422 ), BAP_ML_REST::reject_payload( array( 'run_id' => 'not-a-uuid' ) ) );
} );

test( 'import: a run built on synthetic data is refused however it arrives', function () {
	$synthetic = array(
		'run_id'       => '0f3a9c1e-2b44-4d77-8a10-5e6f7c8d9a0b',
		'is_synthetic' => true,
		'segments'     => array( array( 'segment_key' => 'loyal', 'label' => 'وفادار', 'customer_count' => 40 ) ),
	);

	// Made-up numbers driving a real shop's prices and emails is the failure
	// this refusal exists to prevent, and carrying the file by hand must not be
	// a way around it.
	is_same( array( 'synthetic_results_refused', 422 ), BAP_ML_REST::reject_payload( $synthetic ) );

	// Truthy in any of the shapes JSON can produce it.
	foreach ( array( 1, '1', 'true', array( 'x' ) ) as $truthy ) {
		$synthetic['is_synthetic'] = $truthy;
		is_same( array( 'synthetic_results_refused', 422 ), BAP_ML_REST::reject_payload( $synthetic ), 'failed for ' . var_export( $truthy, true ) );
	}

	// And accepted once it is genuinely absent or false.
	$synthetic['is_synthetic'] = false;
	is_same( null, BAP_ML_REST::reject_payload( $synthetic ) );
} );

test( 'import: the upload screen explains each refusal rather than echoing a code', function () {
	$page = file_get_contents( BAP_PLUGIN_DIR . 'includes/admin/class-bap-segments-page.php' );

	ok( str_contains( $page, 'bap_ml_import_results' ), 'the handler is registered' );
	ok( str_contains( $page, 'is_uploaded_file' ), 'a real upload is told from a supplied path' );
	ok( str_contains( $page, 'MAX_IMPORT_BYTES' ), 'the file size is bounded' );

	// The three refusal codes each need their own sentence; a shop owner
	// holding a file needs to know which file to pick, not a status code.
	foreach ( array( 'invalid_json', 'synthetic_results_refused', 'invalid_run_id' ) as $code ) {
		ok( str_contains( $page, "case '{$code}'" ), "no message for {$code}" );
	}

	ok( ! str_contains( $page, 'reject_payload' ) || str_contains( $page, 'BAP_ML_REST::reject_payload' ), 'the shared gate is used, not reimplemented' );
	ok( str_contains( $page, 'BAP_ML_REST::store_payload' ), 'and so is the shared storage path' );
} );

test( 'import: the signed route still answers with a status code, not an array', function () {
	// store_payload() returning a plain array is what let the upload reuse it;
	// the REST route has to keep wrapping that in a response.
	$rest = file_get_contents( BAP_PLUGIN_DIR . 'includes/ml/class-bap-ml-rest.php' );

	ok( str_contains( $rest, 'return new WP_REST_Response( self::store_payload( $body ) );' ), 'the route wraps the shared result' );
	ok( str_contains( $rest, "array( 'error' => \$refusal[0] ), \$refusal[1]" ), 'and reports the shared refusal with its status' );
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

/* ============================================================ */
/* The explorer                                                 */
/* ============================================================ */

test( 'explorer: search terms are recorded, not just counted', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( array( 'رژ لب قرمز', 'رژ لب قرمز', 'ماسک مو' ) as $term ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'search',
			'page'       => array( 'path' => '/' ),
			'data'       => array( 'query' => $term ),
		) ) );
	}

	$searches = BAP_Local_Reports::explorer( $today, $today )['searches'];

	is_same( 'رژ لب قرمز', $searches[0]['term'], 'the most-searched term leads' );
	is_same( 2, $searches[0]['count'] );
	is_same( 'ماسک مو', $searches[1]['term'] );
} );

test( 'explorer: with no searches the empty panel explains itself', function () {
	$today = gmdate( 'Y-m-d' );
	BAP_Local_Store::record( bap_event() );

	$report = BAP_Local_Reports::explorer( $today, $today );

	is_same( array(), $report['searches'] );
	ok( count( $report['notes'] ) > 0, 'an empty panel must not read as a bug' );
} );

test( 'explorer: each page carries its own event mix', function () {
	$today = gmdate( 'Y-m-d' );

	BAP_Local_Store::record( bap_event( array( 'page' => array( 'path' => '/product/lipstick' ) ) ) );
	BAP_Local_Store::record( bap_event( array( 'event_type' => 'add_to_cart', 'page' => array( 'path' => '/product/lipstick' ) ) ) );
	BAP_Local_Store::record( bap_event( array( 'event_type' => 'rage_click', 'page' => array( 'path' => '/product/lipstick' ) ) ) );

	$page = BAP_Local_Reports::explorer( $today, $today )['pages'][0];

	is_same( '/product/lipstick', $page['page_path'] );
	is_same( 1, $page['views'], 'only page_view counts as a view' );
	is_same( 3, $page['events'], 'but every event counts as an event' );
	is_same( 1, $page['by_type']['add_to_cart'] );
	is_same( 1, $page['by_type']['rage_click'] );
} );

test( 'explorer: the event breakdown names every type in Persian', function () {
	$today = gmdate( 'Y-m-d' );

	BAP_Local_Store::record( bap_event( array( 'event_type' => 'begin_checkout' ) ) );

	$types = BAP_Local_Reports::explorer( $today, $today )['types'];

	is_same( 'begin_checkout', $types[0]['event_type'] );
	is_same( 'رفتن به صفحه پرداخت', $types[0]['label'] );
	is_same( 1, $types[0]['visitors'] );
} );

test( 'explorer: no visitor identifier survives into the response', function () {
	$today = gmdate( 'Y-m-d' );

	BAP_Local_Store::record( bap_event( array( 'identity' => array( 'anonymous_id' => 'anon_traceable_person_id' ) ) ) );

	$json = json_encode( BAP_Local_Reports::explorer( $today, $today ) );

	ok( ! str_contains( $json, 'anon_traceable_person_id' ), 'visitor ids are counted, never listed' );
} );

test( 'explorer: the live feed is newest first', function () {
	$today = gmdate( 'Y-m-d' );
	$base  = strtotime( $today . ' 09:00:00 UTC' );

	foreach ( array( 0, 60, 120 ) as $offset ) {
		BAP_Local_Store::record( bap_event( array(
			'page'             => array( 'path' => '/p' . $offset ),
			'timestamp_server' => gmdate( 'Y-m-d\TH:i:s\Z', $base + $offset ),
		) ) );
	}

	$feed = BAP_Local_Reports::explorer( $today, $today )['feed'];

	is_same( '/p120', $feed[0]['page_path'], 'the most recent event is at the top' );
	is_same( '/p0', $feed[2]['page_path'] );
} );

test( 'route: the standard purchase funnel needs no saved definition', function () {
	$today = BAP_Rollup::today();

	foreach ( range( 1, 80 ) as $i ) { BAP_Rollup::record( 'view_item', 'mobile', '/p' ); }
	foreach ( range( 1, 20 ) as $i ) { BAP_Rollup::record( 'add_to_cart', 'mobile', '/p' ); }

	$request = new WP_REST_Request( array( 'range' => 'last_7_days' ) );
	$request->params['id'] = 'standard';

	$body = BAP_REST_Controller::handle_funnel_report( $request )->get_data();

	is_same( true, $body['success'] );
	$steps = array_column( $body['steps'], null, 'step' );
	is_same( 80, $steps['view_item']['count'] );
	is_same( 25.0, $steps['add_to_cart']['of_first_pc'] );
} );

test( 'route: the explorer answers over REST', function () {
	BAP_Local_Store::record( bap_event( array( 'event_type' => 'search', 'data' => array( 'query' => 'کرم دست' ) ) ) );

	$body = BAP_REST_Controller::handle_explore( new WP_REST_Request( array( 'range' => 'last_7_days' ) ) )->get_data();

	is_same( true, $body['success'] );
	is_same( 1, $body['stored_events'] );
	is_same( 'کرم دست', $body['searches'][0]['term'] );
} );

test( 'admin: the screens that only proxied a collector are gone', function () {
	$source = file_get_contents( BAP_PLUGIN_DIR . 'includes/admin/class-bap-admin.php' );

	ok( ! str_contains( $source, 'EXPERIENCE_SLUG' ), 'the experience screen is merged into the funnel screen' );
	ok( ! str_contains( $source, 'JOURNEYS_SLUG' ), 'the journeys screen is merged into the explorer' );
	ok( str_contains( $source, 'EXPLORER_SLUG' ), 'and the explorer replaces them' );

	$studio = file_get_contents( BAP_PLUGIN_DIR . 'includes/admin/class-bap-studio-page.php' );
	ok( ! str_contains( $studio, 'render_experience' ) );
	ok( ! str_contains( $studio, 'render_journeys' ) );
} );

/* ============================================================ */
/* The automation-webhook provider                              */
/* ============================================================ */

test( 'webhook: a workflow reply is read from whatever shape it arrives in', function () {
	$wanted = '{"recommendations":[{"title":"ok","evidence":["fact_a"]}]}';

	// Every one of these is a real n8n Respond-node configuration.
	is_same( $wanted, BAP_AI_Provider::webhook_content( $wanted ), 'raw JSON' );
	is_same( $wanted, BAP_AI_Provider::webhook_content( json_encode( array( 'output' => $wanted ) ) ), 'wrapped in output' );
	is_same( $wanted, BAP_AI_Provider::webhook_content( json_encode( array( 'text' => $wanted ) ) ), 'wrapped in text' );
	is_same( $wanted, BAP_AI_Provider::webhook_content( json_encode( array( array( 'content' => $wanted ) ) ) ), 'single-item array' );

	// Already the right shape, nested: re-encoded rather than lost.
	$nested = BAP_AI_Provider::webhook_content( json_encode( array( 'recommendations' => array( array( 'title' => 'ok' ) ) ) ) );
	ok( str_contains( $nested, 'recommendations' ) );
} );

test( 'webhook: a workflow cannot cite evidence that was never sent', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_provider' => 'webhook', 'ai_provider_url' => 'https://example.test/webhook/x' ) );

	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );

	fake_http( 200, json_encode( array( 'output' => json_encode( array( 'recommendations' => array(
		array( 'title' => 'ساختگی', 'evidence' => array( 'fact_invented_by_the_workflow' ) ),
	) ) ) ) ) );

	$result = BAP_AI_Provider::analyze( $packet );

	// Nothing survived verification, so the rule engine answered instead and
	// said so — an automation the shop owner built is not more trusted.
	is_same( 'local', $result['provider'] );
	is_same( true, $result['fallback'] );
} );

test( 'webhook: a valid workflow reply is accepted and attributed', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_provider' => 'webhook', 'ai_provider_url' => 'https://example.test/webhook/x' ) );

	$packet = BAP_Analysis_Packet::build( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) );
	$fact   = $packet['facts'][0]['id'];

	fake_http( 200, json_encode( array( 'output' => json_encode( array( 'recommendations' => array(
		array( 'title' => 'پیشنهاد از n8n', 'priority' => 'high', 'confidence' => 70, 'evidence' => array( $fact ) ),
	) ) ) ) ) );

	$result = BAP_AI_Provider::analyze( $packet );

	is_same( true, $result['ok'] );
	is_same( 'webhook', $result['provider'] );
	is_same( 'پیشنهاد از n8n', $result['recommendations'][0]['title'] );
} );

test( 'provider: the llama default no longer assumes a model on this machine', function () {
	// A plugin is installed on shared hosting where nothing listens on 11434.
	// Silently pointing at 127.0.0.1 produced "connection refused" and sent the
	// shop owner hunting for a service that was never meant to be local.
	set_settings( array( 'ai_provider' => 'llama', 'ai_provider_url' => '' ) );
	is_same( '', BAP_AI_Provider::base_url(), 'an address must be given' );

	set_settings( array( 'ai_provider_url' => 'http://10.0.0.5:11434' ) );
	is_same( 'http://10.0.0.5:11434/v1/chat/completions', BAP_AI_Provider::chat_endpoint( BAP_AI_Provider::base_url() ) );
} );

test( 'explorer: a search shows which product was clicked afterwards', function () {
	$today = gmdate( 'Y-m-d' );

	// One page view: the visitor searched, then clicked a result. Both events
	// carry the same page_view_id, which is what ties them together.
	BAP_Local_Store::record( bap_event( array(
		'event_type'   => 'search',
		'page_view_id' => 'pv_search_1',
		'page'         => array( 'path' => '/' ),
		'data'         => array( 'query' => 'رژ لب قرمز' ),
	) ) );

	BAP_Local_Store::record( bap_event( array(
		'event_type'   => 'click',
		'page_view_id' => 'pv_search_1',
		'page'         => array( 'path' => '/' ),
		'data'         => array( 'text' => 'رژ لب مات شماره ۱۲' ),
	) ) );

	$search = BAP_Local_Reports::explorer( $today, $today )['searches'][0];

	is_same( 'رژ لب قرمز', $search['term'] );
	is_same( 'رژ لب مات شماره ۱۲', $search['clicked'][0]['product'] );
	is_same( false, $search['no_click'] );
} );

test( 'explorer: a search nobody clicks is flagged as the opportunity it is', function () {
	$today = gmdate( 'Y-m-d' );

	BAP_Local_Store::record( bap_event( array(
		'event_type'   => 'search',
		'page_view_id' => 'pv_search_2',
		'data'         => array( 'query' => 'کرم ضد آفتاب' ),
	) ) );

	$search = BAP_Local_Reports::explorer( $today, $today )['searches'][0];

	is_same( array(), $search['clicked'] );
	is_same( true, $search['no_click'], 'searched and never clicked — the shop has nothing for it' );
} );

test( 'explorer: a click in a different page view is not attributed to a search', function () {
	$today = gmdate( 'Y-m-d' );

	BAP_Local_Store::record( bap_event( array(
		'event_type'   => 'search',
		'page_view_id' => 'pv_one',
		'data'         => array( 'query' => 'رژ لب' ),
	) ) );

	// A click on a completely different page, later. Attributing it would
	// invent a journey that never happened.
	BAP_Local_Store::record( bap_event( array(
		'event_type'   => 'click',
		'page_view_id' => 'pv_two',
		'page'         => array( 'path' => '/about' ),
		'data'         => array( 'text' => 'تماس با ما' ),
	) ) );

	is_same( true, BAP_Local_Reports::explorer( $today, $today )['searches'][0]['no_click'] );
} );

test( 'labels: event names read as Persian, not as translated English', function () {
	// The old labels were field names rendered word for word. These are what a
	// shopkeeper would say.
	is_same( 'گذاشتن در سبد خرید', BAP_Local_Reports::event_label( 'add_to_cart' ) );
	is_same( 'ثبت سفارش', BAP_Local_Reports::event_label( 'purchase' ) );
	is_same( 'مدت ماندن در صفحه', BAP_Local_Reports::event_label( 'time_on_page' ) );
	is_same( 'کلیک روی چیزی که دکمه نبوده', BAP_Local_Reports::event_label( 'dead_click' ) );

	// An unknown type falls back to its raw name rather than to an empty cell.
	is_same( 'something_new', BAP_Local_Reports::event_label( 'something_new' ) );
} );

/* ============================================================ */
/* Collection modes and the per-product funnel                  */
/* ============================================================ */

test( 'collection: both sources run by default', function () {
	is_same( 'hybrid', BAP_Settings::collection_mode() );
	is_same( true, BAP_Settings::collects_in_browser() );
	is_same( true, BAP_Settings::collects_on_server() );
} );

test( 'collection: each mode switches off exactly one half', function () {
	set_settings( array( 'collection_mode' => 'browser' ) );
	is_same( true, BAP_Settings::collects_in_browser() );
	is_same( false, BAP_Settings::collects_on_server(), 'no server-side order events' );

	set_settings( array( 'collection_mode' => 'server' ) );
	is_same( false, BAP_Settings::collects_in_browser(), 'the tracker is not loaded' );
	is_same( true, BAP_Settings::collects_on_server() );

	// An unknown value must not silently disable collection.
	set_settings( array( 'collection_mode' => 'nonsense' ) );
	is_same( 'hybrid', BAP_Settings::collection_mode() );
} );

test( 'collection: server-only mode still refuses to load the tracker', function () {
	set_settings( array( 'collection_mode' => 'server' ) );

	$source = file_get_contents( BAP_PLUGIN_DIR . 'includes/integrations/class-bap-wordpress.php' );
	ok( str_contains( $source, 'BAP_Settings::collects_in_browser()' ), 'the enqueue gate consults the mode' );

	is_same( false, BAP_WooCommerce::should_track(), 'and browser-side shop tracking is off with it' );
} );

test( 'product funnel: a product that is seen but never carted is named', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 40 ) as $i ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'view_item',
			'page'       => array( 'path' => '/product/serum' ),
			'data'       => array( 'item_name' => 'سرم ویتامین C' ),
		) ) );
	}
	BAP_Local_Store::record( bap_event( array(
		'event_type' => 'add_to_cart',
		'data'       => array( 'item_name' => 'سرم ویتامین C' ),
	) ) );

	$product = BAP_Local_Reports::product_funnel( $today, $today )['products'][0];

	is_same( 'سرم ویتامین C', $product['name'] );
	is_same( 40, $product['view_item'] );
	is_same( 1, $product['add_to_cart'] );
	is_same( 'view_item', $product['lost_at'], 'the loss is at the product page, not the checkout' );
	is_same( 39, $product['lost_people'] );
	is_same( 2.5, $product['cart_rate'] );
	ok( str_contains( $product['advice'], 'عکس' ), 'and the advice matches that step' );
} );

test( 'product funnel: a product carted and abandoned is diagnosed differently', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 30 ) as $i ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'add_to_cart',
			'data'       => array( 'item_name' => 'ماسک مو' ),
		) ) );
	}

	$product = BAP_Local_Reports::product_funnel( $today, $today )['products'][0];

	is_same( 'add_to_cart', $product['lost_at'] );
	// Cart abandonment has a different usual cause than page abandonment, and
	// saying "improve your photos" here would send someone to the wrong job.
	ok( str_contains( $product['advice'], 'ارسال' ), 'postage, not photography' );
} );

test( 'product funnel: purchases are counted from orders, not from events', function () {
	$today = gmdate( 'Y-m-d' );
	seed_shop();

	foreach ( range( 1, 5 ) as $i ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'view_item',
			'data'       => array( 'item_name' => 'رژ لب' ),
		) ) );
	}

	$products = array_column( BAP_Local_Reports::product_funnel( $today, $today )['products'], null, 'name' );

	// seed_shop() places 20 orders containing the lipstick; no purchase event
	// was ever recorded for it, and the funnel still knows it sold.
	is_same( 20, $products['رژ لب']['purchase'] );
	is_same( 5, $products['رژ لب']['view_item'] );
} );

test( 'product funnel: ranked by people lost, not by percentage', function () {
	$today = gmdate( 'Y-m-d' );

	// A product two people abandoned at a 100% rate, and one that fifty did at
	// a lower rate. Ranking by rate would put the trivial one first.
	foreach ( range( 1, 2 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'view_item', 'data' => array( 'item_name' => 'کوچک' ) ) ) );
	}
	foreach ( range( 1, 60 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'view_item', 'data' => array( 'item_name' => 'بزرگ' ) ) ) );
	}
	foreach ( range( 1, 10 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'add_to_cart', 'data' => array( 'item_name' => 'بزرگ' ) ) ) );
	}

	$products = BAP_Local_Reports::product_funnel( $today, $today )['products'];

	is_same( 'بزرگ', $products[0]['name'], '50 people lost outranks 2' );
} );

test( 'dashboard: every metric card explains what it counts', function () {
	foreach ( BAP_Dashboard_Page::cards() as $metric => $card ) {
		ok( ! empty( $card['hint'] ), "card {$metric} must say what it counts" );
		// Long enough to explain, short enough to read at a glance. The first
		// version ran to three lines per card and became a wall of text.
		ok( mb_strlen( $card['hint'] ) > 25, "card {$metric} needs a real explanation, not a word" );
		ok( mb_strlen( $card['hint'] ) < 95, "card {$metric} hint is too long to scan" );
	}

	$cards = BAP_Dashboard_Page::cards();

	// The three the shop owner asked about by name.
	ok( str_contains( $cards['conversions']['hint'], 'ووکامرس' ), 'conversions names its source' );
	ok( str_contains( $cards['revenue']['hint'], 'مرجوعی' ), 'revenue says what it excludes' );
	ok( str_contains( $cards['conversion_rate']['hint'], '÷' ), 'the rate shows its arithmetic' );
} );

test( 'ios: the exit flush beacons synchronously, before touching storage', function () {
	// The iPhone bug in one assertion. `flushWithBeacon` runs inside `pagehide`,
	// and on iOS the page freezes when that handler returns — a promise callback
	// scheduled inside it never runs. Any storage read before the first
	// `sendBeacon` call means nothing is ever sent from an iPhone.
	$source = file_get_contents( BAP_PLUGIN_DIR . 'assets/js/core/11-queue-manager.js' );
	$start  = strpos( $source, 'QueueManager.prototype.flushWithBeacon' );
	$body   = substr( $source, $start, 1600 );

	$beacon = strpos( $body, '_beaconPending()' );
	$read   = strpos( $body, 'claimBatch' );

	ok( false !== $beacon, 'the exit path beacons what it holds in memory' );
	ok( false !== $read && $beacon < $read, 'and does so before any storage read' );
} );

test( 'ios: a wrong navigator.onLine cannot silence a real event', function () {
	// In-app browsers on iOS report `onLine: false` on a working connection.
	// That used to veto every send for the whole page view.
	$source = file_get_contents( BAP_PLUGIN_DIR . 'assets/js/core/11-queue-manager.js' );

	ok(
		str_contains( $source, '!this.isOnline() && "interval" === options.reason' ),
		'the offline flag is trusted only for the background timer'
	);
} );

test( 'ios: the tracker bundle is rebuilt from the modules it ships', function () {
	// The bundle is the file browsers load. It was gitignored and could drift
	// from assets/js/core/ with nothing to catch it.
	$bundle = file_get_contents( BAP_PLUGIN_DIR . 'assets/js/dist/bahoosh-tracker.js' );

	ok( str_contains( $bundle, '_beaconPending' ), 'the iOS exit fix is in the shipped file' );
	ok( str_contains( $bundle, 'IDB_OPEN_TIMEOUT_MS' ), 'and so is the IndexedDB timeout' );
	ok( str_contains( $bundle, 'attachOnScreenDebug' ), 'and the on-screen diagnostic' );
} );

test( 'dashboard: a conversion rate is rendered as a percentage, not multiplied again', function () {
	$source = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/admin.js' );

	// 7.69 must render as 7.7٪, not 769%. The old formatter multiplied an
	// already-percentage value by 100.
	ok( ! str_contains( $source, 'value * 1000' ), 'the double multiplication is gone' );
	ok( str_contains( $source, 'Math.round(Number(value) * 10) / 10' ) );
} );

test( 'packet: a second analysis in the same window reuses the facts', function () {
	seed_shop();

	$today = gmdate( 'Y-m-d' );
	$first = BAP_Analysis_Packet::cached( $today, $today );
	$again = BAP_Analysis_Packet::cached( $today, $today );

	is_same( $first['facts'], $again['facts'], 'the expensive part is computed once' );
	// But not the run id: two analyses are two analyses, and recommendation ids
	// are derived from it.
	ok( $first['run_id'] !== $again['run_id'], 'each run is still distinct' );
} );

test( 'outbox: a dead collector does not burn a whole cron pass', function () {
	$source = file_get_contents( BAP_PLUGIN_DIR . 'includes/core/class-bap-outbox.php' );

	ok( str_contains( $source, 'FAILURE_CUTOFF' ), 'consecutive failures end the pass' );
	is_same( 3, BAP_Outbox::FAILURE_CUTOFF );
} );

/* ============================================================ */
/* Speed                                                        */
/* ============================================================ */

test( 'speed: one admin screen reads the event table once, not four times', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 40 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'data' => array( 'item_name' => 'کالا' ) ) ) );
	}

	// The funnel screen builds three reports, and the explorer builds a fourth
	// internally. Each used to scan the whole window again.
	$GLOBALS['wpdb']->log = array();

	BAP_Local_Reports::funnel( $today, $today );
	BAP_Local_Reports::product_funnel( $today, $today );
	BAP_Local_Reports::explorer( $today, $today );

	$scans = 0;
	foreach ( $GLOBALS['wpdb']->log as $sql ) {
		if ( str_contains( $sql, 'SELECT event_type' ) ) { $scans++; }
	}

	is_same( 1, $scans, 'the window is read once and reused' );
} );

test( 'speed: a write invalidates what the request already read', function () {
	$today = gmdate( 'Y-m-d' );

	BAP_Local_Store::record( bap_event() );
	is_same( 1, count( BAP_Local_Store::events( $today, $today )['rows'] ) );

	// Cheap speed is worthless if it serves a stale answer: a cron pass that
	// records an event and then builds a report must see it.
	BAP_Local_Store::record( bap_event() );
	is_same( 2, count( BAP_Local_Store::events( $today, $today )['rows'] ) );
} );

test( 'speed: a guest costs no user lookup on the ingest path', function () {
	$GLOBALS['bap_users'][7] = (object) array( 'user_email' => 'a@b.c' );

	BAP_Local_Store::record( bap_event() );
	is_same( '', $GLOBALS['wpdb']->local[0]['customer_key'], 'guests are the common case and cost nothing' );

	// And a signed-in visitor is resolved once, however many events they fire.
	foreach ( range( 1, 5 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'identity' => array( 'anonymous_id' => 'anon_a', 'wp_user_id' => 7 ) ) ) );
	}

	$keys = array_unique( array_column( array_slice( $GLOBALS['wpdb']->local, 1 ), 'customer_key' ) );
	is_same( 1, count( $keys ), 'one key, computed once' );
	ok( '' !== reset( $keys ) );
} );

test( 'ingest: a batch settles each event on its own terms', function () {
	$body = array(
		'events' => array(
			array(
				'event_id'     => 'evt_batch_good_0001',
				'event_type'   => 'page_view',
				'page_view_id' => 'pv_batch_0000001',
				'identity'     => array( 'anonymous_id' => 'anon_abcdef1234567890abcdef12345678' ),
				'page'         => array( 'path' => '/shop' ),
			),
			// Malformed: must not cost the others.
			array( 'event_id' => 'evt_batch_bad_00001', 'event_type' => 'not_a_real_type' ),
			array(
				'event_id'     => 'evt_batch_good_0002',
				'event_type'   => 'search',
				'page_view_id' => 'pv_batch_0000002',
				'identity'     => array( 'anonymous_id' => 'anon_abcdef1234567890abcdef12345678' ),
				'page'         => array( 'path' => '/' ),
				'data'         => array( 'query' => 'رژ لب' ),
			),
		),
	);

	$response = BAP_REST_Controller::handle_events( new WP_REST_Request( array(), json_encode( $body ) ) );
	$data     = $response->get_data();

	is_same( 200, $response->get_status(), 'the batch was understood' );
	is_same( 3, count( $data['results'] ) );

	$verdicts = array_column( $data['results'], 'status', 'event_id' );
	is_same( 'stored', $verdicts['evt_batch_good_0001'] );
	is_same( 'stored', $verdicts['evt_batch_good_0002'] );
	is_same( 'rejected', $verdicts['evt_batch_bad_00001'] );

	is_same( 2, BAP_Local_Store::count( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ), 'the good two were stored' );
} );

test( 'ingest: a batch is bounded', function () {
	$events = array();
	foreach ( range( 1, 60 ) as $i ) {
		$events[] = array(
			'event_id'     => 'evt_bounded_' . str_pad( (string) $i, 8, '0', STR_PAD_LEFT ),
			'event_type'   => 'page_view',
			'page_view_id' => 'pv_bounded_' . str_pad( (string) $i, 6, '0', STR_PAD_LEFT ),
			'identity'     => array( 'anonymous_id' => 'anon_abcdef1234567890abcdef12345678' ),
			'page'         => array( 'path' => '/' ),
		);
	}

	$data = BAP_REST_Controller::handle_events( new WP_REST_Request( array(), json_encode( array( 'events' => $events ) ) ) )->get_data();

	is_same( BAP_REST_Controller::MAX_BATCH, count( $data['results'] ), 'one request cannot be made arbitrarily expensive' );
} );

test( 'ingest: a single event still works exactly as before', function () {
	$response = BAP_REST_Controller::handle_events( new WP_REST_Request( array(), json_encode( array(
		'event_id'     => 'evt_single_00000001',
		'event_type'   => 'page_view',
		'page_view_id' => 'pv_single_000001',
		'identity'     => array( 'anonymous_id' => 'anon_abcdef1234567890abcdef12345678' ),
		'page'         => array( 'path' => '/' ),
	) ) ) );

	is_same( 200, $response->get_status() );
	is_same( 1, BAP_Local_Store::count( gmdate( 'Y-m-d' ), gmdate( 'Y-m-d' ) ) );
} );

/* ============================================================ */
/* Persian                                                      */
/* ============================================================ */

test( 'persian: no user-facing string is left in English', function () {
	$offenders = array();

	$files = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( BAP_PLUGIN_DIR . 'includes' ) );
	foreach ( $files as $file ) {
		if ( 'php' !== $file->getExtension() ) { continue; }

		$source = (string) file_get_contents( $file->getPathname() );
		preg_match_all(
			"/(?:esc_html_e|esc_attr_e|esc_html__|esc_attr__|__)\(\s*'((?:[^'\\\\]|\\\\.)*)'\s*,\s*'bahoosh-analytics-pro'\s*\)/",
			$source,
			$matches
		);

		foreach ( $matches[1] as $text ) {
			// A string with no Persian character at all is untranslated. Pure
			// identifiers and version strings are exempt.
			if ( preg_match( '/[\x{0600}-\x{06FF}]/u', $text ) ) { continue; }
			if ( ! preg_match( '/[A-Za-z]{3,}/', $text ) ) { continue; }

			$offenders[] = str_replace( BAP_PLUGIN_DIR, '', $file->getPathname() ) . ': ' . $text;
		}
	}

	is_same( array(), $offenders, "English UI strings found:\n      " . implode( "\n      ", $offenders ) );
} );

/* ============================================================ */
/* The stylesheet                                               */
/* ============================================================ */

test( 'ui: there is one authority on the design tokens', function () {
	$system = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/design-system.css' );
	$screen = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/admin.css' );

	ok( str_contains( $system, '--bap-accent:' ), 'the design system defines the tokens' );

	// admin.css used to carry three separate `.bap-wrap` blocks, each
	// redefining the same variables and each overriding the last. The earlier
	// version of this test looked for a formatting the minified file never
	// used, so it passed while all three were still there.
	is_same( 0, preg_match_all( '/\.bap-wrap\s*\{[^}]*--bap-(?:bg|surface|text|border|accent)\b[^}]*:/', $screen ), 'screen styles no longer define surface tokens' );

	// The 2px accent outline on every card was the loudest "unfinished" signal.
	ok( ! str_contains( $system, 'border: 2px solid var(--bap-accent)' ) );
} );

test( 'ui: the shell — margin, padding, background — is declared once', function () {
	$system = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/design-system.css' );
	$screen = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/admin.css' );

	// Outside a media query, exactly one rule may set the panel's margin. Three
	// did, each with !important and a different value, and the gap between the
	// WordPress menu and the panel was whichever one won plus WordPress's own
	// gutter on top of it.
	$outside = preg_replace( '/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/', '', $system . "\n" . $screen );

	is_same( 1, preg_match_all( '/\.bap-wrap\s*\{[^}]*\bmargin\s*:/', $outside ), 'one shell rule owns the margin' );
	ok( str_contains( $screen, 'padding-inline-start:0!important' ), 'and WordPress’s own gutter is removed' );
} );

test( 'ui: no colour literal is left outside the token block', function () {
	// The precondition for a light theme: a value with no name cannot be
	// re-themed. admin.css carried 142 distinct colour literals for about
	// fifteen ideas.
	$screen = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/admin.css' );
	$screen = preg_replace( '#/\*.*?\*/#s', '', $screen );

	preg_match_all( '/#[0-9a-fA-F]{3,8}\b|rgba?\([0-9][^)]*\)/', $screen, $found );

	is_same( array(), $found[0], 'every colour in the screen styles is a token' );
} );

test( 'ui: no custom property is defined in terms of itself', function () {
	// `--bap-border:var(--bap-border)` is a self-reference, which CSS treats as
	// invalid — it does not fall back, it voids the token for everything
	// downstream. Two such blocks were produced while tokenising.
	foreach ( array( 'design-system.css', 'admin.css' ) as $file ) {
		$css = preg_replace( '#/\*.*?\*/#s', '', file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/' . $file ) );

		preg_match_all( '/(--bap-[a-z0-9-]+)\s*:([^;]+);/', $css, $rules, PREG_SET_ORDER );

		foreach ( $rules as $rule ) {
			ok( ! str_contains( $rule[2], 'var(' . $rule[1] ), $file . ': ' . $rule[1] . ' refers to itself' );
		}
	}
} );

test( 'ui: every token used is defined', function () {
	$defined = array();
	$used    = array();

	foreach ( array( 'design-system.css', 'admin.css' ) as $file ) {
		$css = preg_replace( '#/\*.*?\*/#s', '', file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/' . $file ) );

		preg_match_all( '/(--bap-[a-z0-9-]+)\s*:/', $css, $d );
		preg_match_all( '/var\((--bap-[a-z0-9-]+)/', $css, $u );

		$defined = array_merge( $defined, $d[1] );
		$used    = array_merge( $used, $u[1] );
	}

	is_same( array(), array_values( array_diff( array_unique( $used ), $defined ) ) );
} );

test( 'ui: the primary button outranks the generic button rule', function () {
	// `.bap-wrap button.button` is (0,2,1) and `.bap-wrap .button-primary` is
	// (0,2,0). Both carry !important, so the generic rule won and every
	// call-to-action rendered as a plain grey button — identical to the
	// secondary one beside it. Invisible in dark, obvious in light.
	$css = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/admin.css' );

	// The negative lookahead keeps `.bap-primary-nav` — a different thing
	// entirely — out of the match.
	preg_match_all( '/([^{}]*\.(?:button-primary|bap-primary)(?![\w-])[^{}]*)\{/', $css, $rules );

	ok( $rules[1], 'the primary button is styled somewhere' );

	foreach ( $rules[1] as $selector ) {
		if ( ! str_contains( $selector, '.bap-wrap' ) ) {
			continue;
		}

		ok(
			str_contains( $selector, 'button.button-primary' ) || str_contains( $selector, 'button.bap-primary' ),
			'names the element so it ties with .bap-wrap button.button: ' . trim( $selector )
		);
	}
} );

test( 'ui: nothing is set smaller than Persian can be read at', function () {
	// 53 declarations sat at 10px or below, 20 of them at 9px or smaller.
	// Persian has more per glyph than Latin — dots, descenders, and the
	// zero-width non-joiner gaps inside a single word — and those stop
	// resolving below about 10.5px.
	foreach ( array( 'admin.css', 'design-system.css' ) as $file ) {
		$css = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/' . $file );

		preg_match_all( '/font-size:\s*(\d+(?:\.\d+)?)px/', $css, $sizes );

		foreach ( $sizes[1] as $size ) {
			ok( (float) $size >= 10.5, $file . ' sets ' . $size . 'px' );
		}
	}
} );

/* ============================================================ */
/* Light and dark                                               */
/* ============================================================ */

test( 'theme: light redefines every token that describes a surface', function () {
	$css = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/design-system.css' );

	// A token with a dark value and no light counterpart is a near-black
	// surface on a white page — the classic half-finished light theme.
	$light = substr( $css, strpos( $css, 'html[data-bap-theme="light"]' ) );
	$light = substr( $light, 0, strpos( $light, 'color-scheme: light' ) );

	$surfaces = array(
		'--bap-bg', '--bap-bg-2', '--bap-surface', '--bap-surface-2', '--bap-surface-3',
		'--bap-surface-4', '--bap-text', '--bap-text-2', '--bap-muted', '--bap-faint',
		'--bap-border', '--bap-border-soft', '--bap-border-strong',
		'--bap-tint-1', '--bap-tint-2', '--bap-tint-3', '--bap-tint-4',
		'--bap-ink-1', '--bap-ink-2', '--bap-ink-3',
		'--bap-success', '--bap-warning', '--bap-danger', '--bap-focus-ring', '--bap-canvas',
	);

	foreach ( $surfaces as $token ) {
		ok( str_contains( $light, $token . ':' ), $token . ' has no light value' );
	}
} );

test( 'theme: the text on a filled accent does not flip', function () {
	$css   = file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/design-system.css' );
	$light = substr( $css, strpos( $css, 'html[data-bap-theme="light"]' ) );

	// White on violet in both themes. Flipping it is how the label inside the
	// primary button disappears when the page turns white.
	ok( ! str_contains( $light, '--bap-on-accent:' ), 'the on-accent colour is theme-independent' );
	ok( str_contains( $css, '--bap-on-accent: #ffffff;' ) );
} );

test( 'theme: a preference round-trips, and junk falls back to auto', function () {
	is_same( 'auto', BAP_Admin_Theme::preference(), 'auto until the user chooses' );

	is_same( 'light', BAP_Admin_Theme::remember( 'light' ) );
	is_same( 'light', BAP_Admin_Theme::preference() );

	is_same( 'dark', BAP_Admin_Theme::remember( 'dark' ) );
	is_same( 'auto', BAP_Admin_Theme::remember( 'sepia' ), 'an unknown value is not stored' );
	is_same( 'auto', BAP_Admin_Theme::preference() );
} );

test( 'theme: the resolved theme is applied before the body is parsed', function () {
	BAP_Admin_Theme::remember( 'light' );

	ob_start();
	BAP_Admin_Theme::head_script();
	$head = ob_get_clean();

	ok( str_contains( $head, '"light"' ), 'the stored preference reaches the page' );
	ok( str_contains( $head, 'documentElement' ), 'and lands on <html>, not on the body class' );
	ok( str_contains( $head, 'prefers-color-scheme' ), 'auto consults the operating system' );

	// The attribute the stylesheet keys on. If these two ever disagree the
	// tokens silently stop applying.
	ok( str_contains( $head, 'data-bap-theme' ) );
	ok( str_contains( file_get_contents( BAP_PLUGIN_DIR . 'assets/admin/design-system.css' ), 'html[data-bap-theme="light"]' ) );
} );

/* ============================================================ */
/* Features waiting on a backend that does not exist yet        */
/* ============================================================ */

test( 'roadmap: the two backend-dependent features are hidden', function () {
	is_same( true, BAP_Roadmap::pending( 'licensing' ) );
	is_same( true, BAP_Roadmap::pending( 'collector' ) );
	is_same( false, BAP_Roadmap::available( 'licensing' ) );
} );

test( 'roadmap: everything that runs on this site’s own data stays', function () {
	foreach ( array( 'ai', 'search_rescue', 'ux_tasks', 'segments', 'reports' ) as $feature ) {
		is_same( false, BAP_Roadmap::pending( $feature ), $feature . ' needs no backend' );
	}
} );

test( 'roadmap: configuring a collector un-hides the queue screen', function () {
	set_settings( array( 'api_url' => 'https://collector.example', 'site_id' => 'shop-1' ) );

	is_same( false, BAP_Roadmap::pending( 'collector' ), 'a real collector answers the flag itself' );
	is_same( true, BAP_Roadmap::pending( 'licensing' ), 'the other feature is unaffected' );
} );

test( 'roadmap: nothing hidden is still advertised in the navigation', function () {
	$hidden = array(
		BAP_Admin::ACCOUNT_SLUG   => 'licensing',
		BAP_Admin::INSPECTOR_SLUG => 'collector',
	);

	foreach ( BAP_Admin::navigation_items() as $item ) {
		if ( isset( $hidden[ $item['slug'] ] ) && BAP_Roadmap::pending( $hidden[ $item['slug'] ] ) ) {
			is_same( false, (bool) $item['enabled'], $item['slug'] . ' is still in the sidebar' );
		}
	}
} );

test( 'roadmap: the settings screen explains where the screens went', function () {
	$notes = BAP_Roadmap::notes();

	is_same( array( 'licensing', 'collector' ), array_keys( $notes ) );

	foreach ( $notes as $note ) {
		ok( mb_strlen( $note ) > 40, 'a sentence, not a status code' );
	}

	set_settings( array( 'api_url' => 'https://collector.example', 'site_id' => 'shop-1' ) );
	is_same( array( 'licensing' ), array_keys( BAP_Roadmap::notes() ), 'a feature that works is not explained away' );
} );

test( 'menu: every submenu page is registered with a callable callback', function () {
	// `add_submenu_page( $parent, $title, $menu_title, $cap, $slug, $callback )`
	// — one call passed a slug string in the callback position and pushed the
	// real callback into $position, leaving the Events and Pages screen with
	// nothing to render.
	$source = file_get_contents( BAP_PLUGIN_DIR . 'includes/admin/class-bap-admin.php' );

	preg_match_all( '/add_submenu_page\(\s*(.*?)\s*\);/s', $source, $calls );

	ok( count( $calls[1] ) >= 8, 'the calls were found at all' );

	foreach ( $calls[1] as $args ) {
		// Split on the commas that separate top-level arguments.
		$depth = 0;
		$parts = array( '' );
		foreach ( str_split( $args ) as $char ) {
			if ( '(' === $char ) { $depth++; }
			if ( ')' === $char ) { $depth--; }
			if ( ',' === $char && 0 === $depth ) { $parts[] = ''; continue; }
			$parts[ count( $parts ) - 1 ] .= $char;
		}

		$parts = array_values( array_filter( array_map( 'trim', $parts ), 'strlen' ) );

		is_same( 6, count( $parts ), 'six arguments: ' . substr( preg_replace( '/\s+/', ' ', $args ), 0, 70 ) );
		ok( str_starts_with( $parts[5], 'array(' ), 'the sixth is the callback, not a slug: ' . $parts[5] );
	}
} );

/* ============================================================ */
/* The daily summary                                            */
/* ============================================================ */

/** Records one event at an explicit moment. */
function bap_event_at( string $day, string $time, string $visitor, string $type = 'page_view', array $extra = array() ): void {
	static $n = 0;
	$n++;

	BAP_Local_Store::record( array_merge(
		array(
			'event_id'         => 'evs_' . $n,
			'event_type'       => $type,
			'page_view_id'     => 'pvs_' . $n,
			'identity'         => array( 'anonymous_id' => $visitor ),
			'timestamp_server' => $day . 'T' . $time . 'Z',
			'page'             => array( 'path' => '/p', 'referrer' => '' ),
			'context'          => array( 'device_type' => 'mobile' ),
			'data'             => array(),
		),
		$extra
	) );
}

test( 'summary: the totals match what reading the raw events produces', function () {
	$a = gmdate( 'Y-m-d', strtotime( '-3 days' ) );
	$b = gmdate( 'Y-m-d', strtotime( '-2 days' ) );

	// A visitor on both days, one only on the first, one only on the second.
	bap_event_at( $a, '09:00:00', 'anon_one' );
	bap_event_at( $a, '09:05:00', 'anon_one', 'search', array( 'data' => array( 'query' => 'x' ) ) );
	bap_event_at( $a, '14:00:00', 'anon_one' );
	bap_event_at( $a, '10:00:00', 'anon_two' );
	bap_event_at( $b, '11:00:00', 'anon_one' );
	bap_event_at( $b, '11:30:00', 'anon_three' );

	$live = BAP_Local_Reports::metrics( $a, $b );

	BAP_Daily_Summary::build_day( $a );
	BAP_Daily_Summary::build_day( $b );

	$summarised = BAP_Local_Reports::metrics( $a, $b );

	// The whole point: the fast path and the slow path agree, figure for
	// figure. A summary that approximates is worse than a slow report.
	foreach ( array( 'total_events', 'unique_users', 'sessions', 'page_views', 'searches' ) as $metric ) {
		is_same( $live[ $metric ], $summarised[ $metric ], "«{$metric}» must be identical" );
	}

	is_same( 3, $summarised['unique_users'], 'a visitor on both days is one person, not two' );
} );

test( 'summary: a visit spanning midnight is one session, not two', function () {
	$a = gmdate( 'Y-m-d', strtotime( '-3 days' ) );
	$b = gmdate( 'Y-m-d', strtotime( '-2 days' ) );

	// 23:50 then 00:10 — twenty minutes apart, inside the inactivity gap.
	bap_event_at( $a, '23:50:00', 'anon_night' );
	bap_event_at( $b, '00:10:00', 'anon_night' );

	$live = BAP_Local_Reports::metrics( $a, $b );

	BAP_Daily_Summary::build_day( $a );
	BAP_Daily_Summary::build_day( $b );

	$summarised = BAP_Local_Reports::metrics( $a, $b );

	is_same( 1, $live['sessions'], 'reading the raw timeline sees one session' );
	is_same( 1, $summarised['sessions'], 'and so does the summary' );
} );

test( 'summary: a continuation from outside the range still counts as a start', function () {
	$a = gmdate( 'Y-m-d', strtotime( '-3 days' ) );
	$b = gmdate( 'Y-m-d', strtotime( '-2 days' ) );

	bap_event_at( $a, '23:50:00', 'anon_edge' );
	bap_event_at( $b, '00:10:00', 'anon_edge' );

	BAP_Daily_Summary::build_day( $a );
	BAP_Daily_Summary::build_day( $b );

	// Asking only for the second day: the session did begin before the window,
	// but within this window it is a session that starts here.
	is_same( 1, BAP_Local_Reports::metrics( $b, $b )['sessions'] );
} );

test( 'summary: an unsummarised day falls back to raw events rather than under-reporting', function () {
	$a = gmdate( 'Y-m-d', strtotime( '-3 days' ) );
	$b = gmdate( 'Y-m-d', strtotime( '-2 days' ) );

	bap_event_at( $a, '09:00:00', 'anon_one' );
	bap_event_at( $b, '09:00:00', 'anon_two' );

	// Only the first day is closed. A summary that answered anyway would drop
	// a whole day of traffic with nothing to show the reader.
	BAP_Daily_Summary::build_day( $a );

	is_same( 2, BAP_Local_Reports::metrics( $a, $b )['total_events'], 'both days are still counted' );
} );

test( 'summary: today is never frozen into the table', function () {
	$today = gmdate( 'Y-m-d' );

	is_same( false, BAP_Daily_Summary::build_day( $today ), 'today is not over' );
	is_same( false, BAP_Daily_Summary::has_day( $today ) );
} );

test( 'summary: closed days and today are added together', function () {
	$yesterday = gmdate( 'Y-m-d', strtotime( '-1 day' ) );
	$today     = gmdate( 'Y-m-d' );

	bap_event_at( $yesterday, '10:00:00', 'anon_old' );
	bap_event_at( $yesterday, '10:01:00', 'anon_old' );
	BAP_Daily_Summary::build_day( $yesterday );

	bap_event_at( $today, '10:00:00', 'anon_new' );

	$metrics = BAP_Local_Reports::metrics( $yesterday, $today );

	is_same( 3, $metrics['total_events'], 'two summarised plus one live' );
	is_same( 2, $metrics['unique_users'] );
} );

test( 'summary: breakdowns add up across days', function () {
	$a = gmdate( 'Y-m-d', strtotime( '-3 days' ) );
	$b = gmdate( 'Y-m-d', strtotime( '-2 days' ) );

	foreach ( array( $a, $b ) as $day ) {
		bap_event_at( $day, '09:00:00', 'anon_' . $day, 'page_view', array( 'page' => array( 'path' => '/shop' ) ) );
	}
	bap_event_at( $a, '09:10:00', 'anon_x', 'page_view', array( 'page' => array( 'path' => '/cart' ) ) );

	BAP_Daily_Summary::build_day( $a );
	BAP_Daily_Summary::build_day( $b );

	$pages = array_column( BAP_Local_Reports::metrics( $a, $b )['top_pages'], 'views', 'url' );

	is_same( 2, $pages['/shop'], 'one view on each day' );
	is_same( 1, $pages['/cart'] );
} );

test( 'summary: rebuilding a day replaces it rather than doubling it', function () {
	$a = gmdate( 'Y-m-d', strtotime( '-2 days' ) );

	bap_event_at( $a, '09:00:00', 'anon_one' );

	BAP_Daily_Summary::build_day( $a );
	BAP_Daily_Summary::build_day( $a );

	is_same( 1, BAP_Local_Reports::metrics( $a, $a )['total_events'] );
	is_same( 1, BAP_Local_Reports::metrics( $a, $a )['unique_users'] );
} );

/* ============================================================ */
/* The UX fix list                                              */
/* ============================================================ */

test( 'tasks: a page throwing script errors becomes a critical job', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 15 ) as $i ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'js_error',
			'page'       => array( 'path' => '/checkout' ),
			'data'       => array( 'message' => 'undefined is not a function' ),
		) ) );
	}

	$tasks = BAP_UX_Tasks::build( $today, $today )['tasks'];
	$found = null;

	foreach ( $tasks as $task ) {
		if ( 'js_error' === $task['kind'] ) { $found = $task; break; }
	}

	ok( null !== $found, 'the error became a task' );
	is_same( 'critical', $found['severity'], 'a defect outranks a design problem' );
	is_same( '/checkout', $found['page_path'] );
	ok( str_contains( $found['what'], 'کنسول' ), 'and says what to actually do' );
} );

test( 'tasks: a handful of stray clicks is not a job', function () {
	$today = gmdate( 'Y-m-d' );

	// Below the threshold: two rage clicks is somebody's trackpad.
	foreach ( range( 1, 3 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'rage_click', 'page' => array( 'path' => '/x' ) ) ) );
	}

	is_same( array(), BAP_UX_Tasks::build( $today, $today )['tasks'] );
} );

test( 'tasks: an id survives the next run so a tick stays ticked', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 15 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'dead_click', 'page' => array( 'path' => '/cart' ) ) ) );
	}

	$first = BAP_UX_Tasks::build( $today, $today )['tasks'][0];
	BAP_UX_Tasks::decide( $first['id'], 'done' );

	// More of the same problem arrives; the task must not come back as new.
	foreach ( range( 1, 10 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'dead_click', 'page' => array( 'path' => '/cart' ) ) ) );
	}

	$again = BAP_UX_Tasks::build( $today, $today )['tasks'][0];

	is_same( $first['id'], $again['id'], 'same problem, same page, same id' );
	is_same( 'done', $again['status'], 'and the tick survived' );
} );

test( 'tasks: reopening clears the decision', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 15 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'rage_click', 'page' => array( 'path' => '/cart' ) ) ) );
	}

	$task = BAP_UX_Tasks::build( $today, $today )['tasks'][0];

	BAP_UX_Tasks::decide( $task['id'], 'dismissed' );
	is_same( 'dismissed', BAP_UX_Tasks::build( $today, $today )['tasks'][0]['status'] );

	BAP_UX_Tasks::decide( $task['id'], 'open' );
	is_same( 'open', BAP_UX_Tasks::build( $today, $today )['tasks'][0]['status'] );

	is_same( false, BAP_UX_Tasks::decide( $task['id'], 'nonsense' ), 'an unknown status is refused' );
} );

test( 'tasks: worst first, measured in people rather than percentage', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 12 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'rage_click', 'page' => array( 'path' => '/small' ) ) ) );
	}
	foreach ( range( 1, 90 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'rage_click', 'page' => array( 'path' => '/big' ) ) ) );
	}

	is_same( '/big', BAP_UX_Tasks::build( $today, $today )['tasks'][0]['page_path'] );
} );

test( 'tasks: searches that find nothing become one job, not twenty', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( array( 'کرم ضد آفتاب', 'ماسک مو' ) as $term ) {
		foreach ( range( 1, 4 ) as $i ) {
			BAP_Local_Store::record( bap_event( array(
				'event_type'   => 'search',
				'page_view_id' => 'pv_' . md5( $term . $i ),
				'data'         => array( 'query' => $term ),
			) ) );
		}
	}

	$found = null;
	foreach ( BAP_UX_Tasks::build( $today, $today )['tasks'] as $task ) {
		if ( 'search_barren' === $task['kind'] ) { $found = $task; break; }
	}

	ok( null !== $found, 'one task covering every fruitless term' );
	ok( str_contains( $found['what'], 'کرم ضد آفتاب' ) );
	ok( str_contains( $found['what'], 'ماسک مو' ) );
} );

test( 'tasks: the list is read-only — building it writes nothing', function () {
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 15 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'js_error', 'page' => array( 'path' => '/checkout' ) ) ) );
	}

	$options_before = $GLOBALS['bap_options'];
	$posts_before   = $GLOBALS['bap_posts'] ?? array();

	$GLOBALS['wpdb']->log = array();
	BAP_UX_Tasks::build( $today, $today );

	// The whole premise of this screen: it says what to change and changes
	// nothing. A regression here would be the plugin silently editing pages.
	foreach ( $GLOBALS['wpdb']->log as $sql ) {
		ok( ! str_contains( $sql, 'INSERT INTO' ), 'no writes: ' . substr( $sql, 0, 60 ) );
		ok( ! str_contains( $sql, 'UPDATE ' ), 'no writes: ' . substr( $sql, 0, 60 ) );
		ok( ! str_contains( $sql, 'DELETE FROM' ), 'no writes: ' . substr( $sql, 0, 60 ) );
	}

	is_same( $options_before, $GLOBALS['bap_options'], 'no option was touched' );
	is_same( $posts_before, $GLOBALS['bap_posts'] ?? array(), 'no post was touched' );
} );

test( 'pages: an Elementor page gets the Elementor editor, not the block one', function () {
	$GLOBALS['bap_posts'][42]     = array( 'title' => 'سبد خرید', 'type' => 'page', 'post_content' => '' );
	$GLOBALS['bap_post_meta'][42] = array( '_elementor_edit_mode' => 'builder' );
	$GLOBALS['bap_url_posts']['https://shop.test/cart'] = 42;

	$page = BAP_Page_Resolver::resolve( '/cart' );

	is_same( 42, $page['post_id'] );
	is_same( 'elementor', $page['builder'] );
	ok( str_contains( $page['edit_url'], 'action=elementor' ), 'sending someone to the block editor would show them a placeholder' );
} );

test( 'pages: a block page gets the ordinary editor', function () {
	$GLOBALS['bap_posts'][43]     = array( 'title' => 'درباره ما', 'type' => 'page', 'post_content' => '<!-- wp:paragraph -->' );
	$GLOBALS['bap_url_posts']['https://shop.test/about'] = 43;

	$page = BAP_Page_Resolver::resolve( '/about' );

	is_same( 'block', $page['builder'] );
	ok( str_contains( $page['edit_url'], 'action=edit' ) );
} );

test( 'pages: a collapsed product id is reported as unresolvable, not guessed', function () {
	// The rollup collapses numeric ids so one product is not a thousand
	// buckets. Guessing which product `/product/{id}` meant would be inventing.
	$page = BAP_Page_Resolver::resolve( '/product/{id}' );

	is_same( 0, $page['post_id'] );
	is_same( '', $page['edit_url'], 'no button beats a button that goes somewhere wrong' );
	ok( str_contains( $page['view_url'], '/product/' ) );
} );

test( 'pages: a rebuild sees a page that did not exist during the last one', function () {
	// The resolver caches within a run. A cron pass or a WP-CLI process lives
	// long enough for that cache to outlast the truth, so a rebuild has to start
	// from nothing — otherwise a page created yesterday stays "unknown" forever.
	$today = gmdate( 'Y-m-d' );

	foreach ( range( 1, 15 ) as $i ) {
		BAP_Local_Store::record( bap_event( array( 'event_type' => 'js_error', 'page' => array( 'path' => '/checkout' ) ) ) );
	}

	$first = BAP_UX_Tasks::build( $today, $today );
	is_same( 0, $first['tasks'][0]['page']['post_id'], 'nothing is published yet' );

	$GLOBALS['bap_posts'][44] = array( 'title' => 'تسویه حساب', 'type' => 'page', 'post_content' => '' );
	$GLOBALS['bap_url_posts']['https://shop.test/checkout'] = 44;

	$second = BAP_UX_Tasks::build( $today, $today );
	is_same( 44, $second['tasks'][0]['page']['post_id'], 'the second run still had the first run’s answer cached' );
} );

/* ============================================================ */
/* Price facts, and the price changes they make possible        */
/* ============================================================ */

test( 'price: a coupon-heavy shop is told its list price is fiction', function () {
	// Ten orders where the line was discounted, four at full price. The fifth
	// element of a line is its subtotal — what it would have cost without the
	// coupon — so the discount given is measurable per product.
	for ( $i = 1; $i <= 10; $i++ ) {
		bap_add_order( $i, array( array( 10, 'رژ لب', 1, 160000, 200000 ) ), 'mobile' );
	}
	for ( $i = 11; $i <= 14; $i++ ) {
		bap_add_order( $i, array( array( 10, 'رژ لب', 1, 200000 ) ), 'mobile' );
	}

	$fact = BAP_Price_Facts::coupon_reliance( BAP_Commerce_Facts::orders( '2020-01-01', gmdate( 'Y-m-d' ) ) );

	is_same( 10, $fact['value']['orders_with_discount'] );
	is_same( 14, $fact['value']['orders_total'] );
	is_same( 71.4, $fact['value']['share_pc'] );
	is_same( 400000.0, $fact['value']['discount_given'], '10 × 40,000 given away' );
	ok( $fact['value']['aov_with'] < $fact['value']['aov_without'], 'the coupons bought cheaper baskets, not bigger ones' );
} );

test( 'price: below the coupon threshold nothing is claimed', function () {
	for ( $i = 1; $i <= 12; $i++ ) {
		bap_add_order( $i, array( array( 10, 'رژ لب', 1, 200000 ) ), 'mobile' );
	}

	$orders = BAP_Commerce_Facts::orders( '2020-01-01', gmdate( 'Y-m-d' ) );

	is_same( null, BAP_Price_Facts::coupon_reliance( $orders ), 'no discounted order, no fact' );
} );

test( 'price: a thin order count produces no coupon fact at all', function () {
	bap_add_order( 1, array( array( 10, 'رژ لب', 1, 100000, 200000 ) ), 'mobile' );

	is_same(
		null,
		BAP_Price_Facts::coupon_reliance( BAP_Commerce_Facts::orders( '2020-01-01', gmdate( 'Y-m-d' ) ) ),
		'one order cannot establish a pattern'
	);
} );

test( 'price: views without purchases become a price-test candidate', function () {
	$today = gmdate( 'Y-m-d' );
	bap_add_product( 90, 'ماسک مو', 250000.0 );

	for ( $i = 0; $i < BAP_Price_Facts::MIN_VIEWS + 5; $i++ ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'view_item',
			'data'       => array( 'item_name' => 'ماسک مو' ),
		) ) );
	}

	$facts = BAP_Price_Facts::price_blocked( $today, $today );

	is_same( 1, count( $facts ) );
	is_same( 'commerce.price_blocked', $facts[0]['kind'] );
	is_same( 90, $facts[0]['value']['product_id'], 'the browser event’s name was mapped to a real catalogue id' );
	is_same( 25, $facts[0]['value']['views'] );
	is_same( 250000.0, $facts[0]['value']['price'] );
} );

test( 'price: a product that did sell is not a price-test candidate', function () {
	$today = gmdate( 'Y-m-d' );
	bap_add_product( 10, 'رژ لب', 200000.0 );
	bap_add_order( 1, array( array( 10, 'رژ لب', 1, 200000 ) ), 'mobile', null, $today );

	for ( $i = 0; $i < 40; $i++ ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'view_item',
			'data'       => array( 'item_name' => 'رژ لب' ),
		) ) );
	}

	is_same( array(), BAP_Price_Facts::price_blocked( $today, $today ), 'demand is converting; price is not the question' );
} );

test( 'price: a handful of views is not evidence of anything', function () {
	$today = gmdate( 'Y-m-d' );
	bap_add_product( 90, 'ماسک مو', 250000.0 );

	for ( $i = 0; $i < BAP_Price_Facts::MIN_VIEWS - 1; $i++ ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'view_item',
			'data'       => array( 'item_name' => 'ماسک مو' ),
		) ) );
	}

	is_same( array(), BAP_Price_Facts::price_blocked( $today, $today ) );
} );

test( 'price: a product named the same as another is dropped, not guessed at', function () {
	$today = gmdate( 'Y-m-d' );
	bap_add_product( 90, 'ماسک مو', 250000.0 );
	bap_add_product( 91, 'ماسک مو', 300000.0 );

	for ( $i = 0; $i < 30; $i++ ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'view_item',
			'data'       => array( 'item_name' => 'ماسک مو' ),
		) ) );
	}

	is_same( array(), BAP_Price_Facts::price_blocked( $today, $today ), 'an ambiguous name must never produce an action' );
} );

test( 'price: a product above its own shelf median and selling less is flagged', function () {
	// One shelf: four ordinary products around 100,000 and one at 300,000.
	bap_add_product( 10, 'رژ لب', 100000.0, array( 7 ) );
	bap_add_product( 11, 'تینت لب', 110000.0, array( 7 ) );
	bap_add_product( 12, 'برق لب', 90000.0, array( 7 ) );
	bap_add_product( 13, 'خط لب', 100000.0, array( 7 ) );
	bap_add_product( 14, 'رژ لب مخملی', 300000.0, array( 7 ) );

	for ( $i = 1; $i <= 6; $i++ ) {
		bap_add_order( $i, array( array( 10, 'رژ لب', 2, 200000 ) ), 'mobile' );
	}
	for ( $i = 7; $i <= 10; $i++ ) {
		bap_add_order( $i, array( array( 11, 'تینت لب', 2, 220000 ) ), 'mobile' );
	}

	$facts = BAP_Price_Facts::price_position( BAP_Commerce_Facts::orders( '2020-01-01', gmdate( 'Y-m-d' ) ) );

	is_same( 1, count( $facts ) );
	is_same( 14, $facts[0]['value']['product_id'] );
	is_same( 100000.0, $facts[0]['value']['peer_median'] );
	is_same( 3.0, $facts[0]['value']['ratio'] );
	is_same( 67, $facts[0]['value']['gap_pc'], 'reaching the shelf median is a 67% cut, not a 300% one' );
} );

test( 'price: an expensive product that outsells its shelf is left alone', function () {
	bap_add_product( 10, 'رژ لب', 100000.0, array( 7 ) );
	bap_add_product( 11, 'تینت لب', 100000.0, array( 7 ) );
	bap_add_product( 12, 'برق لب', 100000.0, array( 7 ) );
	bap_add_product( 13, 'خط لب', 100000.0, array( 7 ) );
	bap_add_product( 14, 'رژ لب مخملی', 300000.0, array( 7 ) );

	// The premium product sells more units than any of its neighbours.
	for ( $i = 1; $i <= 8; $i++ ) {
		bap_add_order( $i, array( array( 14, 'رژ لب مخملی', 3, 900000 ) ), 'desktop' );
	}

	is_same(
		array(),
		BAP_Price_Facts::price_position( BAP_Commerce_Facts::orders( '2020-01-01', gmdate( 'Y-m-d' ) ) ),
		'expensive and selling well is a premium product doing its job'
	);
} );

test( 'price: a shelf too small to have a median is not judged', function () {
	bap_add_product( 10, 'رژ لب', 100000.0, array( 7 ) );
	bap_add_product( 14, 'رژ لب مخملی', 400000.0, array( 7 ) );

	is_same(
		array(),
		BAP_Price_Facts::price_position( BAP_Commerce_Facts::orders( '2020-01-01', gmdate( 'Y-m-d' ) ) ),
		'two products are not a category'
	);
} );

test( 'price: the packet carries price facts and a price for every product', function () {
	seed_shop();

	$packet = BAP_Analysis_Packet::build( '2020-01-01', gmdate( 'Y-m-d' ) );
	$kinds  = array_column( $packet['facts'], 'kind' );
	$top    = array_values( array_filter( $packet['facts'], fn( $f ) => 'commerce.top_product' === $f['kind'] ) );

	ok( in_array( 'commerce.top_product', $kinds, true ), 'the old facts are still there' );
	ok( isset( $top[0]['value']['price'] ), 'and now carry a list price' );
	is_same( 100000.0, $top[0]['value']['price'] );
} );

test( 'agent: the best candidate wins, not the first one listed', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval', 'ai_agent_max_discount' => 25 ) );

	// A slow product first in the array, a strong price-test candidate second.
	// Before ranking existed, array order decided what the shop did.
	$action = BAP_Commerce_Agent::propose( array(
		array( 'kind' => 'commerce.slow_product', 'sample_size' => 0, 'value' => array( 'product_id' => 90 ) ),
		array( 'kind' => 'commerce.price_blocked', 'sample_size' => 120, 'value' => array( 'product_id' => 91 ) ),
	) );

	is_same( 91, $action['payload']['product_id'], 'the product 120 people looked at' );
	is_same( 'price_test', $action['payload']['intent'] );
	is_same( 10, $action['payload']['percent'], 'a measurement, not the maximum the cap allows' );
} );

test( 'agent: reversing the order changes nothing', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );

	$facts = array(
		array( 'kind' => 'commerce.price_blocked', 'sample_size' => 120, 'value' => array( 'product_id' => 91 ) ),
		array( 'kind' => 'commerce.slow_product', 'sample_size' => 0, 'value' => array( 'product_id' => 90 ) ),
	);

	is_same( 91, BAP_Commerce_Agent::propose( $facts )['payload']['product_id'] );
	is_same( 91, BAP_Commerce_Agent::propose( array_reverse( $facts ) )['payload']['product_id'] );
} );

test( 'agent: a price-position proposal aims at the category median, within the cap', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval', 'ai_agent_max_discount' => 25 ) );

	$modest = BAP_Commerce_Agent::propose( array(
		array( 'kind' => 'commerce.price_position', 'sample_size' => 8, 'value' => array( 'product_id' => 90, 'gap_pc' => 18 ) ),
	) );
	is_same( 18, $modest['payload']['percent'], 'the gap down to the median' );
	is_same( 'price_align', $modest['payload']['intent'] );

	$extreme = BAP_Commerce_Agent::propose( array(
		array( 'kind' => 'commerce.price_position', 'sample_size' => 8, 'value' => array( 'product_id' => 90, 'gap_pc' => 67 ) ),
	) );
	is_same( 25, $extreme['payload']['percent'], 'the cap still wins over the gap' );
} );

test( 'agent: a discount that would sell below a recorded cost is refused', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval', 'ai_agent_max_discount' => 40 ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );
	$GLOBALS['bap_products'][90]->update_meta_data( '_wc_cog_cost', '80000' );

	$result = BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 40 ) );

	ok( $result instanceof WP_Error, 'refused' );
	is_same( 'bap_agent_below_cost', $result->get_error_code() );
	is_same( '', $GLOBALS['bap_products'][90]->get_sale_price(), 'and nothing was written' );

	// The same product at a depth that clears the cost goes through.
	ok( ! ( BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 15 ) ) instanceof WP_Error ) );
} );

test( 'agent: without a recorded cost nothing is assumed about margin', function () {
	seed_shop();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval', 'ai_agent_max_discount' => 40 ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );

	ok( ! ( BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 40 ) ) instanceof WP_Error ) );
	is_same( 0.0, BAP_Price_Facts::cost( 90 ), 'an unknown cost is zero, never a guessed markup' );
} );

/* ============================================================ */
/* Effect measurement                                           */
/* ============================================================ */

/**
 * Applies a discount whose log entry is backdated, so the elapsed window is
 * long enough to measure without waiting a week for the test to pass.
 */
function bap_backdate_entry( string $log_id, int $days_ago ): void {
	$rows = get_option( BAP_Commerce_Agent::OPTION_LOG, array() );
	$rows[ $log_id ]['at'] = gmdate( 'c', time() - ( $days_ago * DAY_IN_SECONDS ) );
	update_option( BAP_Commerce_Agent::OPTION_LOG, $rows, false );
}

test( 'effect: applying a discount records what the product was doing before', function () {
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );

	// Four units in the baseline window, and a control product selling too.
	bap_add_order( 1, array( array( 90, 'ماسک مو', 4, 400000 ) ), 'mobile', null, gmdate( 'Y-m-d', time() - ( 10 * DAY_IN_SECONDS ) ) );
	bap_add_order( 2, array( array( 10, 'رژ لب', 20, 4000000 ) ), 'mobile', null, gmdate( 'Y-m-d', time() - ( 10 * DAY_IN_SECONDS ) ) );

	$result = BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );
	$entry  = BAP_Commerce_Agent::history( 5 )[0];

	is_same( array( 90 ), $entry['baseline']['products'] );
	is_same( 4, $entry['baseline']['units'] );
	is_same( 20, $entry['baseline']['control_units'], 'the control excludes the product being changed' );
	is_same( array(), $entry['effect'], 'no verdict on day zero' );
	is_same( 'manual', $entry['data']['intent'] );
	ok( $result['log_id'] === $entry['id'] );
} );

test( 'effect: nothing is judged before the observation window closes', function () {
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );
	bap_add_order( 1, array( array( 90, 'ماسک مو', 4, 400000 ) ), 'mobile', null, gmdate( 'Y-m-d', time() - ( 10 * DAY_IN_SECONDS ) ) );

	BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );

	is_same( array(), BAP_Agent_Effect::measure_all(), 'a change applied today has no result yet' );

	bap_backdate_entry( BAP_Commerce_Agent::history( 1 )[0]['id'], BAP_Agent_Effect::MIN_OBSERVE_DAYS - 1 );
	is_same( array(), BAP_Agent_Effect::measure_all(), 'nor does one applied six days ago' );
} );

test( 'effect: a shop-wide slump is not read as the discount failing', function () {
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );

	$before = gmdate( 'Y-m-d', time() - ( 20 * DAY_IN_SECONDS ) );

	// Baseline: 28 units of the product, 280 of everything else, over 28 days.
	bap_add_order( 1, array( array( 90, 'ماسک مو', 28, 2800000 ) ), 'mobile', null, $before );
	bap_add_order( 2, array( array( 10, 'رژ لب', 280, 56000000 ) ), 'mobile', null, $before );

	BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );
	$id = BAP_Commerce_Agent::history( 1 )[0]['id'];
	bap_backdate_entry( $id, 14 );

	// After: the product held its per-day rate while the rest of the shop
	// halved. Flat in isolation, a win against the control.
	$after = gmdate( 'Y-m-d', time() - ( 7 * DAY_IN_SECONDS ) );
	bap_add_order( 3, array( array( 90, 'ماسک مو', 14, 1400000 ) ), 'mobile', null, $after );
	bap_add_order( 4, array( array( 10, 'رژ لب', 70, 14000000 ) ), 'mobile', null, $after );

	$verdicts = BAP_Agent_Effect::measure_all();
	$effect   = BAP_Commerce_Agent::history( 1 )[0]['effect'];

	is_same( 'worked', $verdicts[ $id ] );
	is_same( 0.0, $effect['product_pc'], 'the product itself did not move' );
	is_same( -50.0, $effect['shop_pc'], 'but the shop fell by half' );
	is_same( 50.0, $effect['net_pc'] );
	ok( str_contains( BAP_Agent_Effect::explain( $effect ), 'تفاضلی' ), 'and the sentence says the comparison is differential' );
} );

test( 'effect: a shop-wide boom is not read as the discount working', function () {
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );

	$before = gmdate( 'Y-m-d', time() - ( 20 * DAY_IN_SECONDS ) );
	bap_add_order( 1, array( array( 90, 'ماسک مو', 28, 2800000 ) ), 'mobile', null, $before );
	bap_add_order( 2, array( array( 10, 'رژ لب', 280, 56000000 ) ), 'mobile', null, $before );

	BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );
	$id = BAP_Commerce_Agent::history( 1 )[0]['id'];
	bap_backdate_entry( $id, 14 );

	// Both doubled. In isolation the discount looks like a triumph.
	$after = gmdate( 'Y-m-d', time() - ( 7 * DAY_IN_SECONDS ) );
	bap_add_order( 3, array( array( 90, 'ماسک مو', 28, 2800000 ) ), 'mobile', null, $after );
	bap_add_order( 4, array( array( 10, 'رژ لب', 280, 56000000 ) ), 'mobile', null, $after );

	$verdicts = BAP_Agent_Effect::measure_all();
	$effect   = BAP_Commerce_Agent::history( 1 )[0]['effect'];

	is_same( 'flat', $verdicts[ $id ], 'the product rose exactly as much as everything else' );
	is_same( 100.0, $effect['product_pc'] );
	is_same( 0.0, $effect['net_pc'] );
} );

test( 'effect: a discount that cost sales is called a failure', function () {
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );

	$before = gmdate( 'Y-m-d', time() - ( 20 * DAY_IN_SECONDS ) );
	bap_add_order( 1, array( array( 90, 'ماسک مو', 28, 2800000 ) ), 'mobile', null, $before );
	bap_add_order( 2, array( array( 10, 'رژ لب', 280, 56000000 ) ), 'mobile', null, $before );

	BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );
	$id = BAP_Commerce_Agent::history( 1 )[0]['id'];
	bap_backdate_entry( $id, 14 );

	$after = gmdate( 'Y-m-d', time() - ( 7 * DAY_IN_SECONDS ) );
	bap_add_order( 3, array( array( 90, 'ماسک مو', 3, 270000 ) ), 'mobile', null, $after );
	bap_add_order( 4, array( array( 10, 'رژ لب', 140, 28000000 ) ), 'mobile', null, $after );

	is_same( 'backfired', BAP_Agent_Effect::measure_all()[ $id ] );
	ok( str_contains( BAP_Agent_Effect::explain( BAP_Commerce_Agent::history( 1 )[0]['effect'] ), 'بازگردانی' ), 'and it says to undo it' );
} );

test( 'effect: two sales are never called a result', function () {
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );

	$before = gmdate( 'Y-m-d', time() - ( 20 * DAY_IN_SECONDS ) );
	bap_add_order( 1, array( array( 90, 'ماسک مو', 1, 100000 ) ), 'mobile', null, $before );
	bap_add_order( 2, array( array( 10, 'رژ لب', 50, 10000000 ) ), 'mobile', null, $before );

	BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );
	$id = BAP_Commerce_Agent::history( 1 )[0]['id'];
	bap_backdate_entry( $id, 14 );

	$after = gmdate( 'Y-m-d', time() - ( 7 * DAY_IN_SECONDS ) );
	bap_add_order( 3, array( array( 90, 'ماسک مو', 2, 200000 ) ), 'mobile', null, $after );
	bap_add_order( 4, array( array( 10, 'رژ لب', 50, 10000000 ) ), 'mobile', null, $after );

	is_same( 'thin', BAP_Agent_Effect::measure_all()[ $id ], '1 unit then 2 is a 300% rise and means nothing' );
	ok( str_contains( BAP_Agent_Effect::explain( BAP_Commerce_Agent::history( 1 )[0]['effect'] ), 'نمی‌دانیم' ) );
} );

test( 'effect: a product that sold nothing before is judged on units, not percent', function () {
	// The commonest case the agent creates, and the one a percentage cannot
	// describe: every move away from zero is an infinite improvement.
	is_same( 'worked', BAP_Agent_Effect::verdict( null, 0, 9 ) );
	is_same( 'thin', BAP_Agent_Effect::verdict( null, 0, 2 ) );
	is_same( 'thin', BAP_Agent_Effect::verdict( null, 40, 40 ), 'an undefined net on a real baseline stays unjudged' );
} );

test( 'effect: an entry applied before the feature existed stays unmeasured', function () {
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );

	update_option(
		BAP_Commerce_Agent::OPTION_LOG,
		array(
			'agt_old' => array(
				'id'      => 'agt_old',
				'at'      => gmdate( 'c', time() - ( 40 * DAY_IN_SECONDS ) ),
				'type'    => BAP_Commerce_Agent::ACTION_DISCOUNT,
				'label'   => 'قدیمی',
				'data'    => array( 'product_id' => 90 ),
				'restore' => array(),
				'reverted_at' => '',
			),
		),
		false
	);

	is_same( array(), BAP_Agent_Effect::measure_all(), 'a baseline cannot be invented after the change' );
	is_same( '', BAP_Commerce_Agent::history( 1 )[0]['effect_text'] );
} );

test( 'effect: only the days a reverted change was live are counted', function () {
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );
	bap_add_order( 1, array( array( 90, 'ماسک مو', 28, 2800000 ) ), 'mobile', null, gmdate( 'Y-m-d', time() - ( 20 * DAY_IN_SECONDS ) ) );

	BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );
	$id = BAP_Commerce_Agent::history( 1 )[0]['id'];
	bap_backdate_entry( $id, 30 );

	// Reverted two days in: a 30-day window would be 28 days of measuring a
	// price that was no longer there.
	$rows = get_option( BAP_Commerce_Agent::OPTION_LOG, array() );
	$rows[ $id ]['reverted_at'] = gmdate( 'c', time() - ( 28 * DAY_IN_SECONDS ) );
	update_option( BAP_Commerce_Agent::OPTION_LOG, $rows, false );

	is_same( array(), BAP_Agent_Effect::measure_all(), 'two live days is below the floor, so no verdict' );
} );

test( 'effect: the measurement cron is only scheduled once something is applied', function () {
	$GLOBALS['bap_cron'] = array();
	set_settings( array( 'ai_enabled' => true, 'ai_agent_mode' => 'approval' ) );
	bap_add_product( 90, 'ماسک مو', 100000.0 );

	is_same( false, wp_next_scheduled( BAP_Agent_Effect::CRON ), 'nothing scheduled yet' );

	BAP_Commerce_Agent::discount_product( array( 'product_id' => 90, 'percent' => 10 ) );

	ok( wp_next_scheduled( BAP_Agent_Effect::CRON ) > 0, 'applying a change schedules the measurement' );
} );

test( 'effect: deactivation clears the measurement cron', function () {
	$installer = file_get_contents( BAP_PLUGIN_DIR . 'includes/core/class-bap-installer.php' );

	ok( str_contains( $installer, 'wp_clear_scheduled_hook( BAP_Agent_Effect::CRON )' ) );
} );

test( 'insights: the rule engine asks for a price test when views prove demand', function () {
	$today = gmdate( 'Y-m-d' );
	seed_shop();
	bap_add_product( 90, 'ماسک مو', 250000.0 );

	for ( $i = 0; $i < 30; $i++ ) {
		BAP_Local_Store::record( bap_event( array(
			'event_type' => 'view_item',
			'data'       => array( 'item_name' => 'ماسک مو' ),
		) ) );
	}

	$packet = BAP_Analysis_Packet::build( '2020-01-01', $today );
	$items  = BAP_Local_Insights::derive( $packet );
	$titles = array_column( $items, 'title' );

	$price = array_values( array_filter( $items, fn( $i ) => str_contains( $i['title'], 'قیمت «ماسک مو» را آزمایش کنید' ) ) );

	is_same( 1, count( $price ), 'a price recommendation, with no model involved' );
	ok( str_contains( $price[0]['summary'], '۳۰' ) || str_contains( $price[0]['summary'], '30' ), 'it quotes the real view count' );
	is_same( 'high', $price[0]['priority'] );
} );

test( 'insights: a coupon-heavy shop is told so, with no action attached', function () {
	for ( $i = 1; $i <= 10; $i++ ) {
		bap_add_order( $i, array( array( 10, 'رژ لب', 1, 160000, 200000 ) ), 'mobile' );
	}
	for ( $i = 11; $i <= 14; $i++ ) {
		bap_add_order( $i, array( array( 10, 'رژ لب', 1, 200000 ) ), 'mobile' );
	}

	$packet = BAP_Analysis_Packet::build( '2020-01-01', gmdate( 'Y-m-d' ) );
	$items  = BAP_Local_Insights::derive( $packet );
	$found  = array_values( array_filter( $items, fn( $i ) => str_contains( $i['title'], 'قیمت فهرست شما واقعی نیست' ) ) );

	is_same( 1, count( $found ) );
	is_same( null, $found[0]['action'], 'changing every price in the shop is not an automatic action' );
} );

/* ============================================================ */
/* The notebook round-trip                                      */
/* ============================================================ */

test( 'segments: a notebook result keeps its Persian labels through import', function () {
	// The screen renders $seg['label'] as the card heading. An earlier draft of
	// the notebook sent `title`, so every card fell back to the raw key and the
	// shop owner saw `champions_0` instead of «مشتریان طلایی».
	$payload = array(
		'run_id'   => '11111111-2222-4333-8444-555555555555',
		'segments' => array(
			array( 'segment_key' => 'champions', 'label' => 'مشتریان طلایی', 'customer_count' => 40 ),
			array( 'segment_key' => 'at_risk', 'label' => 'در خطر ریزش', 'customer_count' => 25 ),
		),
	);

	is_same( null, BAP_ML_REST::reject_payload( $payload ), 'the import gate accepts it' );

	foreach ( $payload['segments'] as $segment ) {
		$key   = sanitize_key( $segment['segment_key'] );
		$label = sanitize_text_field( $segment['label'] );

		ok( '' !== $key, 'the key survives sanitize_key()' );
		ok( $label !== $key && '' !== $label, 'the Persian label survives and is not the key' );
	}
} );

test( 'segments: a Persian segment key would be destroyed, so keys stay ASCII', function () {
	// sanitize_key() strips everything outside a-z0-9_-, so a Persian key comes
	// back empty and save_run() skips the row entirely. The notebook must put
	// Persian in `label` and keep `segment_key` ASCII.
	is_same( '', sanitize_key( 'وفادار' ), 'a Persian key is stripped to nothing' );
	is_same( 'champions', sanitize_key( 'champions' ) );
} );

test( 'segments: run quality is stored beside insights, not inside it', function () {
	// `insights` is a list of cards the screen renders one by one. Metrics
	// smuggled into it come out as empty cards, so they get their own key.
	$rest = file_get_contents( BAP_PLUGIN_DIR . 'includes/ml/class-bap-ml-rest.php' );
	$page = file_get_contents( BAP_PLUGIN_DIR . 'includes/admin/class-bap-segments-page.php' );

	ok( str_contains( $rest, "'quality'         => BAP_Event_Validator::sanitize_data" ), 'the payload key is persisted' );
	ok( str_contains( $page, "\$insights['quality']" ), 'and the screen reads it' );
	ok( str_contains( $page, 'silhouette_verdict' ), 'and turns the score into a sentence' );
} );

test( 'segments: every silhouette band gets its own honest verdict', function () {
	$method = new ReflectionMethod( 'BAP_Segments_Page', 'silhouette_verdict' );
	$method->setAccessible( true );

	$strong = $method->invoke( null, 0.62 );
	$middle = $method->invoke( null, 0.30 );
	$weak   = $method->invoke( null, 0.08 );

	is_same( 'is-healthy', $strong['class'] );
	is_same( 'is-warning', $middle['class'] );
	is_same( 'is-neutral', $weak['class'] );

	// A weak score must not be reported as "the segments are wrong".
	ok( str_contains( $weak['note'], 'هنوز نمی‌دانیم' ), 'weak reads as unknown, not as broken' );
	ok( $strong['label'] !== $weak['label'] );
} );

run_tests();
