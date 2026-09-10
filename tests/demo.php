<?php
/**
 * Prints what an administrator actually sees, for a sample cosmetics shop.
 *
 * Not a test: a way to look at real rendered output without a WordPress install.
 *
 * @package Bahoosh_Analytics_Pro
 */

// phpcs:disable

require __DIR__ . '/bootstrap.php';
reset_state();

// --- a small cosmetics shop -------------------------------------------------

for ( $i = 1; $i <= 12; $i++ ) {
	bap_add_order( $i, array(
		array( 10, 'رژ لب مات', 1, 200000 ),
		array( 11, 'تینت لب', 1, 150000 ),
	), $i % 3 === 0 ? 'desktop' : 'mobile' );
}
for ( $i = 13; $i <= 20; $i++ ) {
	bap_add_order( $i, array( array( 10, 'رژ لب مات', 1, 200000 ) ), 'mobile' );
}
for ( $i = 21; $i <= 26; $i++ ) {
	bap_add_order( $i, array( array( 12, 'سرم ویتامین C', 1, 900000 ) ), 'desktop' );
}
bap_add_product( 90, 'ماسک مو' );
bap_add_product( 91, 'لاک ناخن' );

// --- behaviour: the checkout leaks ------------------------------------------

foreach ( range( 1, 300 ) as $i ) { BAP_Rollup::record( 'add_to_cart', 'mobile', '/product/lipstick' ); }
foreach ( range( 1, 290 ) as $i ) { BAP_Rollup::record( 'view_cart', 'mobile', '/cart' ); }
foreach ( range( 1, 280 ) as $i ) { BAP_Rollup::record( 'begin_checkout', 'mobile', '/checkout' ); }
foreach ( range( 1, 30 ) as $i )  { BAP_Rollup::record( 'add_payment_info', 'mobile', '/checkout/payment' ); }
foreach ( range( 1, 26 ) as $i )  { BAP_Rollup::record( 'purchase', 'mobile', '/done', 200000 ); }

// --- Clarity is connected ---------------------------------------------------

BAP_Clarity::set_token( 'demo-token' );
fake_http( 200, array(
	array(
		'metricName'  => 'ScriptErrorCount',
		'information' => array( array( 'URL' => '/checkout', 'sessionsCount' => '312', 'sessionsWithMetricPercentage' => 18.4 ) ),
	),
	array(
		'metricName'  => 'DeadClickCount',
		'information' => array( array( 'URL' => '/cart', 'sessionsCount' => '95', 'sessionsWithMetricPercentage' => 7.1 ) ),
	),
	array( 'metricName' => 'Traffic', 'information' => array( array( 'totalSessionCount' => '4200' ) ) ),
) );

// --- the agent is on, waiting for approval ----------------------------------

set_settings( array(
	'ai_enabled'            => true,
	'ai_provider'           => 'local',
	'ai_agent_mode'         => 'approval',
	'ai_agent_max_discount' => 15,
) );

$today  = gmdate( 'Y-m-d' );
$packet = BAP_Analysis_Packet::build( $today, $today );
$result = BAP_AI_Provider::analyze( $packet );

echo "\n=== بسته تحلیل ===\n";
echo 'کیفیت داده: ' . $packet['data_quality']['score'] . "%\n";
echo 'تعداد Fact: ' . count( $packet['facts'] ) . "\n";
echo 'منابع: ' . implode( '، ', array_keys( array_filter( $packet['data_quality']['sources'] ) ) ) . "\n";
foreach ( $packet['data_quality']['warnings'] as $warning ) {
	echo "  ⚠ {$warning}\n";
}

echo "\n=== پیشنهادها (منبع: {$result['provider']}) ===\n";
foreach ( $result['recommendations'] as $item ) {
	echo "\n[{$item['priority']} · {$item['confidence']}%] {$item['title']}\n";
	echo '  ' . $item['summary'] . "\n";
	echo '  شواهد: ' . implode( '، ', $item['evidence'] ) . "\n";
	if ( ! empty( $item['action']['type'] ) ) {
		echo '  ⚙ اقدام قابل اجرا: ' . $item['action']['type'] . ' ' . json_encode( $item['action']['payload'], JSON_UNESCAPED_UNICODE ) . "\n";
	}
}

// --- approve the first executable one ---------------------------------------

BAP_AI::ingest( array( 'recommendations' => $result['recommendations'] ) );

foreach ( BAP_AI::recommendations() as $item ) {
	if ( empty( $item['action']['type'] ) ) { continue; }

	$decision = BAP_AI::decide( $item['id'], 'approve', true );

	echo "\n=== پس از تأیید مدیر ===\n";
	echo 'وضعیت: ' . $decision['status'] . "\n";
	if ( ! empty( $decision['result']['message'] ) ) {
		echo 'نتیجه: ' . $decision['result']['message'] . "\n";
	}
	break;
}

echo "\n=== گزارش تغییرات ایجنت ===\n";
foreach ( BAP_Commerce_Agent::history() as $entry ) {
	echo "  · {$entry['label']}  (پایان: " . substr( (string) ( $entry['data']['ends_at'] ?? '' ), 0, 10 ) . ")\n";
}
echo "\n";
