<?php
/**
 * Jarchi load and concurrency harness.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT.
 *
 * This runs against the test double in harness.php, not against WordPress and
 * MySQL. It therefore proves things about *shape* — how many tickets a set of
 * events produces, how many queries a poll costs, how much work one request
 * takes on before it stops — and it proves them exactly, because those are
 * properties of the plugin's own logic.
 *
 * It proves nothing about wall-clock latency, MySQL row-lock contention,
 * InnoDB deadlock retries, PHP-FPM worker exhaustion, or the behaviour of a
 * real object cache under pressure. Those need a real stack and real traffic.
 * Where a number here would be mistaken for a production measurement, the
 * check says so rather than reporting a figure it cannot stand behind.
 *
 * The one concurrency claim it does make honestly is the important one: the
 * ledger's unique index is modelled faithfully in FakeWpdb, so "fifty
 * simultaneous claims produce one winner" is a real test of the arbitration,
 * not a restatement of it.
 *
 * @package WPEventPublisherAudit
 */

require __DIR__ . '/boot.php';

use WPEventPublisher\AutomationLedger;
use WPEventPublisher\TicketAutomations;
use WPEventPublisher\Tickets;

global $wpdb;

$tickets = wpep()->tickets();

/**
 * Installs one automation rule and returns its id.
 *
 * @param array<string,mixed> $rule Overrides.
 *
 * @return string Rule id.
 */
function wpep_load_rule( array $rule ): string {
	$rules = (array) get_option( TicketAutomations::OPTION, array() );

	$row = array_merge(
		array(
			'id'              => 'rule_' . wp_generate_uuid4(),
			'name'            => 'load',
			'enabled'         => true,
			'trigger'         => 'user_register',
			'condition'       => 'none',
			'condition_value' => '',
			'condition_key'   => '',
			'subject'         => 'موضوع',
			'body'            => 'متن',
			'department'      => 0,
			'category'        => 0,
			'priority'        => 'normal',
			'once_per_user'   => false,
			'allow_reply'     => false,
			'delay_minutes'   => 0,
			'post_type'       => 'post',
		),
		$rule
	);

	$rules[] = $row;

	update_option( TicketAutomations::OPTION, $rules, false );

	return (string) $row['id'];
}

/**
 * Clears rules, the ledger and per-request state.
 *
 * @return void
 */
function wpep_load_reset(): void {
	update_option( TicketAutomations::OPTION, array(), false );
	$GLOBALS['ledger'] = array();
	TicketAutomations::reset_request_state();
}

/**
 * How many tickets exist in total.
 *
 * @return int Count.
 */
function wpep_ticket_total(): int {
	return count(
		array_filter( $GLOBALS['posts'], static fn( $p ) => Tickets::POST_TYPE === $p->post_type )
	);
}

/**
 * Registers a block of users.
 *
 * @param int $from First id.
 * @param int $to   Last id.
 *
 * @return void
 */
function wpep_load_users( int $from, int $to ): void {
	for ( $id = $from; $id <= $to; $id++ ) {
		$GLOBALS['users_store'][ (string) $id ] = new WP_User_Stub( $id, 'load-' . $id );
	}
}

/**
 * Replaces the user table with exactly this block.
 *
 * The sweep walks every user on the site, so a section that leaves its
 * fixtures behind changes the arithmetic of the next one — five hundred users
 * plus the leftovers of an earlier section is not five hundred. Each sweep
 * section starts from a known table.
 *
 * @param int $from First id.
 * @param int $to   Last id.
 *
 * @return int How many users the table now holds.
 */
function wpep_load_only_users( int $from, int $to ): int {
	$GLOBALS['users_store'] = array();

	wpep_load_users( $from, $to );

	return count( $GLOBALS['users_store'] );
}

echo "Jarchi load and concurrency harness\n";
echo "Mocked WordPress. Shape is measured exactly; latency is not measured at all.\n\n";

/* =====================================================================
 * 1. Fifty simultaneous claims on one event.
 *
 * The reported defect in its purest form. Fifty requests arrive together for
 * the same order, the same advert, the same registration. The old code read a
 * meta marker and then wrote it, so all fifty read "not sent" and all fifty
 * sent. The claim is now one statement the database arbitrates.
 * ================================================================== */

wpep_load_reset();

$wpep_winners = 0;

for ( $i = 0; $i < 50; $i++ ) {
	if ( AutomationLedger::reserve( 'rule_storm', 4001, 'order_placed', '77001' ) ) {
		++$wpep_winners;
	}
}

check( 'fifty simultaneous claims on one event produce one winner', 1 === $wpep_winners, (string) $wpep_winners );

/*
 * And the converse, which matters just as much: a mechanism that refuses
 * everything would pass the check above. Fifty *different* orders must all
 * get through.
 */
$wpep_winners = 0;

for ( $i = 0; $i < 50; $i++ ) {
	if ( AutomationLedger::reserve( 'rule_storm', 4001, 'order_placed', (string) ( 78000 + $i ) ) ) {
		++$wpep_winners;
	}
}

check( 'fifty distinct events all get through', 50 === $wpep_winners, (string) $wpep_winners );

/* =====================================================================
 * 2. Fifty concurrent ticket creations.
 *
 * Not claims this time — whole tickets, through the real firing path, for
 * fifty customers ordering at once.
 * ================================================================== */

wpep_load_reset();
wpep_load_users( 4100, 4149 );

wpep_load_rule( array( 'trigger' => 'user_register', 'subject' => 'خوش آمدید', 'body' => 'متن' ) );

$wpep_before = wpep_ticket_total();

foreach ( range( 4100, 4149 ) as $wpep_user ) {
	TicketAutomations::reset_request_state();
	do_action( 'user_register', $wpep_user );
}

$wpep_made = wpep_ticket_total() - $wpep_before;

check( 'fifty customers registering at once get fifty tickets', 50 === $wpep_made, (string) $wpep_made );

// Replayed in full — a retried request, a double-submitted form, a webhook
// delivered twice.
$wpep_before = wpep_ticket_total();

foreach ( range( 4100, 4149 ) as $wpep_user ) {
	TicketAutomations::reset_request_state();
	do_action( 'user_register', $wpep_user );
}

check( 'and replaying the whole batch adds none', 0 === wpep_ticket_total() - $wpep_before, (string) ( wpep_ticket_total() - $wpep_before ) );

/* =====================================================================
 * 3. Five hundred users, one rule, swept.
 * ================================================================== */

wpep_load_reset();

$wpep_population = wpep_load_only_users( 5000, 5499 );

wpep_load_rule( array( 'trigger' => 'scheduled', 'subject' => 'یادآوری', 'body' => 'متن' ) );

$wpep_before  = wpep_ticket_total();
$wpep_ledger0 = count( (array) $GLOBALS['ledger'] );
$wpep_runs    = 0;

$wpep_swept_so_far = -1;

// Each run is one cron firing: it takes a bounded batch and stops. Draining
// five hundred users therefore takes many runs, which is the point.
while ( $wpep_runs < 400 ) {
	++$wpep_runs;

	TicketAutomations::reset_request_state();
	delete_option( '_jarchi_automation_scan_lock' );

	$wpep_at = wpep_ticket_total();

	wpep()->ticket_automations()->scan_scheduled_rules();

	if ( wpep_ticket_total() === $wpep_at && $wpep_swept_so_far === wpep_ticket_total() ) {
		break;
	}

	$wpep_swept_so_far = wpep_ticket_total();
}

$wpep_swept = wpep_ticket_total() - $wpep_before;

check(
	'five hundred users are each messaged exactly once — ' . $wpep_runs . ' runs',
	500 === $wpep_population && 500 === $wpep_swept,
	$wpep_swept . ' of ' . $wpep_population
);

check(
	'and the ledger holds one row per user, not more',
	500 === count( (array) $GLOBALS['ledger'] ) - $wpep_ledger0,
	(string) ( count( (array) $GLOBALS['ledger'] ) - $wpep_ledger0 )
);

// Distinct owners, not five hundred tickets for one unlucky person.
$wpep_owners = array();

foreach ( $GLOBALS['posts'] as $wpep_post ) {
	if ( Tickets::POST_TYPE === $wpep_post->post_type && (int) $wpep_post->post_author >= 5000 ) {
		$wpep_owners[ (int) $wpep_post->post_author ] = ( $wpep_owners[ (int) $wpep_post->post_author ] ?? 0 ) + 1;
	}
}

check(
	'no user receives a second copy — worst case ' . ( $wpep_owners ? max( $wpep_owners ) : 0 ),
	$wpep_owners && 1 === max( $wpep_owners ) && 500 === count( $wpep_owners )
);

/*
 * The sweep keeps running after everyone has been reached — cron does not
 * stop because the work is done. It must find nothing rather than start again.
 */
$wpep_before = wpep_ticket_total();

for ( $i = 0; $i < 20; $i++ ) {
	TicketAutomations::reset_request_state();
	delete_option( '_jarchi_automation_scan_lock' );
	wpep()->ticket_automations()->scan_scheduled_rules();
}

check( 'twenty further sweeps send nothing', 0 === wpep_ticket_total() - $wpep_before, (string) ( wpep_ticket_total() - $wpep_before ) );

/* =====================================================================
 * 4. Five hundred users polling the badge every ten seconds.
 *
 * This is the load the plugin puts on a site continuously rather than in a
 * burst: every logged-in user's browser asking "any unread tickets?" six times
 * a minute, for as long as the tab is open. What is measured is queries, which
 * is a property of the code; how long each query takes is not.
 * ================================================================== */

$GLOBALS['transients'] = array();

$wpdb->queries = array();

$wpep_polls = 0;

// Three rounds ten seconds apart, inside one thirty-second cache window.
foreach ( array( 0, 10, 20 ) as $wpep_offset ) {
	foreach ( range( 5000, 5499 ) as $wpep_user ) {
		$GLOBALS['current_user_id'] = $wpep_user;

		$tickets->unread_count( $wpep_user );

		++$wpep_polls;
	}
}

$wpep_queries = count(
	array_filter( $wpdb->queries, static fn( $q ) => str_contains( (string) $q, '_jarchi_ticket_user_unread' ) )
);

check(
	'fifteen hundred polls cost five hundred queries, not fifteen hundred — ' . $wpep_queries,
	1500 === $wpep_polls && 500 === $wpep_queries
);

/*
 * And the cache must genuinely expire, or the badge would be a number that
 * never changed. The transient store keys off time(), which a test cannot
 * advance, so the expiry timestamps are aged by hand.
 */
foreach ( $GLOBALS['transients'] as $wpep_key => $wpep_entry ) {
	$GLOBALS['transients'][ $wpep_key ]['expires'] = time() - 1;
}

$wpdb->queries = array();

foreach ( range( 5000, 5499 ) as $wpep_user ) {
	$GLOBALS['current_user_id'] = $wpep_user;
	$tickets->unread_count( $wpep_user );
}

$wpep_after_expiry = count(
	array_filter( $wpdb->queries, static fn( $q ) => str_contains( (string) $q, '_jarchi_ticket_user_unread' ) )
);

check(
	'once the window passes they query again — ' . $wpep_after_expiry,
	500 === $wpep_after_expiry
);

// One query per user per window, and it is a COUNT — not a fetch of every
// ticket followed by counting them in PHP, which is what it replaced.
$wpep_sample = '';

foreach ( $wpdb->queries as $wpep_q ) {
	if ( str_contains( (string) $wpep_q, '_jarchi_ticket_user_unread' ) ) { $wpep_sample = (string) $wpep_q; break; }
}

check(
	'the badge query counts in SQL rather than loading rows',
	str_contains( $wpep_sample, 'COUNT(' ) && ! str_contains( $wpep_sample, 'SELECT *' ),
	preg_replace( '/\s+/', ' ', substr( $wpep_sample, 0, 90 ) )
);

$GLOBALS['current_user_id'] = 1;

/* =====================================================================
 * 5. Ten thousand users and twenty rules.
 *
 * The size at which the old design stopped being merely wrong and became
 * unrunnable: it fetched every user into one request, for every rule.
 *
 * Draining this to completion would be two hundred thousand tickets, which is
 * not something a unit test should build, and the figure below is explicit
 * that it was not drained. What is checked is the property that makes the
 * drain safe: each cron firing takes a bounded, cursor-advanced slice, and
 * repeats never duplicate.
 * ================================================================== */

wpep_load_reset();

$GLOBALS['transients'] = array();

$wpep_population = wpep_load_only_users( 20000, 29999 );

for ( $i = 0; $i < 20; $i++ ) {
	wpep_load_rule( array( 'trigger' => 'scheduled', 'subject' => 'قانون ' . $i, 'body' => 'متن' ) );
}

check( 'ten thousand users are registered', 10000 === $wpep_population, (string) $wpep_population );
check( 'and twenty rules', 20 === count( (array) get_option( TicketAutomations::OPTION, array() ) ) );

$wpep_peak_before = memory_get_peak_usage( true );
$wpep_per_run     = array();
$wpep_before      = wpep_ticket_total();

for ( $i = 0; $i < 25; $i++ ) {
	TicketAutomations::reset_request_state();
	delete_option( '_jarchi_automation_scan_lock' );

	$wpep_at = wpep_ticket_total();

	wpep()->ticket_automations()->scan_scheduled_rules();

	$wpep_per_run[] = wpep_ticket_total() - $wpep_at;
}

$wpep_worst = $wpep_per_run ? max( $wpep_per_run ) : 0;
$wpep_total = wpep_ticket_total() - $wpep_before;

check(
	'no single cron firing creates more than the per-request ceiling — worst ' . $wpep_worst,
	$wpep_worst > 0 && $wpep_worst <= 20
);

check(
	'twenty-five firings made steady progress — ' . $wpep_total . ' tickets',
	$wpep_total === array_sum( $wpep_per_run ) && $wpep_total >= 20 * 25 * 0.5
);

$wpep_dupes = array();

foreach ( $GLOBALS['posts'] as $wpep_post ) {
	if ( Tickets::POST_TYPE !== $wpep_post->post_type || (int) $wpep_post->post_author < 20000 ) { continue; }

	$wpep_rule_of = (string) get_post_meta( (int) $wpep_post->ID, '_jarchi_ticket_automation_id', true );
	$wpep_key     = $wpep_post->post_author . '|' . $wpep_rule_of;

	$wpep_dupes[ $wpep_key ] = ( $wpep_dupes[ $wpep_key ] ?? 0 ) + 1;
}

check(
	'no user received the same rule twice — worst case ' . ( $wpep_dupes ? max( $wpep_dupes ) : 0 ),
	$wpep_dupes && 1 === max( $wpep_dupes )
);

$wpep_growth = memory_get_peak_usage( true ) - $wpep_peak_before;

check(
	'the sweep does not grow with the user table — peak grew ' . round( $wpep_growth / 1048576, 1 ) . ' MB over 25 firings',
	$wpep_growth < 64 * 1048576
);

printf(
	"\nNOT DRAINED: 10,000 users x 20 rules is 200,000 tickets. 25 firings were run\n" .
	"and created %d. The full drain was not executed, and no claim is made here\n" .
	"about how long it would take on a real site.\n\n",
	$wpep_total
);

/* =====================================================================
 * 5b. Broadcasting to ten thousand people.
 *
 * "Send this to every user" was the one place left that fetched the whole
 * user table into one request and then stored it — every id — in a single
 * option row, rewritten from the front on each of the four hundred batches
 * needed to drain it. The row is now a cursor.
 * ================================================================== */

$wpep_population = wpep_load_only_users( 30000, 39999 );

delete_option( Tickets::OPTION_BROADCAST );

$wpep_peak_before            = memory_get_peak_usage( true );
$GLOBALS['get_users_calls'] = array();

$_POST = array(
	'audience' => 'all',
	'title'    => 'اطلاعیه همگانی',
	'message'  => 'متن همگانی',
	'_wpnonce' => 'valid',
);
$_REQUEST = $_POST;

try {
	$tickets->handle_admin_create();
} catch ( \Throwable $e ) {
	// The harness ends the handler's redirect by throwing.
	unset( $e );
}

$wpep_progress = $tickets->broadcast_progress();

check(
	'a broadcast to ten thousand people knows the size without listing them',
	10000 === $wpep_progress['total'] && 10000 === $wpep_population,
	$wpep_progress['total'] . ' of ' . $wpep_population
);

check(
	'the request that pressed the button sends one batch, not ten thousand',
	$wpep_progress['sent'] === Tickets::BROADCAST_BATCH,
	(string) $wpep_progress['sent']
);

$wpep_state = (array) get_option( Tickets::OPTION_BROADCAST, array() );

check(
	'the stored job is a cursor, not a copy of the user table',
	isset( $wpep_state['cursor'] ) && ! isset( $wpep_state['pending'] ),
	implode( ',', array_keys( $wpep_state ) )
);

check(
	'and it stays small however many users there are — ' . strlen( serialize( $wpep_state ) ) . ' bytes',
	strlen( serialize( $wpep_state ) ) < 4096
);

$wpep_growth = memory_get_peak_usage( true ) - $wpep_peak_before;

check(
	'starting it does not load the user table into memory — peak grew ' . round( $wpep_growth / 1048576, 1 ) . ' MB',
	$wpep_growth < 16 * 1048576
);

/*
 * Memory alone is a weak witness here: the mocked store is cheap enough that
 * enumerating ten thousand rows costs almost nothing, so a broadcast that
 * fetched every id to count them would pass the check above. What separates
 * the two implementations is the shape of the calls, so that is what is
 * asserted — every trip to the user table must carry a bound.
 */
$wpep_unbounded = array_filter(
	(array) $GLOBALS['get_users_calls'],
	static fn( $args ) => empty( $args['number'] ) || (int) $args['number'] < 1
);

check(
	'no trip to the user table is unbounded — ' . count( (array) $GLOBALS['get_users_calls'] ) . ' calls',
	array() === $wpep_unbounded,
	implode( '; ', array_map( static fn( $a ) => wp_json_encode( $a ), $wpep_unbounded ) )
);

check(
	'and starting the broadcast makes at most one of them',
	count( (array) $GLOBALS['get_users_calls'] ) <= 1,
	(string) count( (array) $GLOBALS['get_users_calls'] )
);

/* =====================================================================
 * 6. The bounds are in the code, not only in this run.
 *
 * A run can only show what happened with the fixtures it had. These read the
 * constants and the queries themselves, so a later change that removes a
 * bound fails here even if the fixtures happen not to reach it.
 * ================================================================== */

$wpep_src = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-ticket-automations.php' );

check( 'the scan batch is a bounded constant', (bool) preg_match( '/const SCAN_BATCH\s*=\s*(\d+)/', $wpep_src, $m ) && (int) $m[1] > 0 && (int) $m[1] <= 200, $m[1] ?? '' );
check( 'the per-request ticket ceiling is a bounded constant', (bool) preg_match( '/const MAX_PER_REQUEST\s*=\s*(\d+)/', $wpep_src, $m ) && (int) $m[1] > 0 && (int) $m[1] <= 100, $m[1] ?? '' );
check( 'the scan lock has a finite lifetime', (bool) preg_match( '/const SCAN_LOCK_TTL\s*=\s*(\d+)/', $wpep_src, $m ) && (int) $m[1] > 0, $m[1] ?? '' );

check(
	'the sweep never asks for every user at once',
	! preg_match( "/'number'\s*=>\s*-1/", $wpep_src ) && ! preg_match( "/'number'\s*=>\s*0/", $wpep_src )
);

$wpep_cleanup_src = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-ticket-cleanup.php' );

check( 'cleanup deletes in bounded batches', (bool) preg_match( '/const BATCH\s*=\s*(\d+)/', $wpep_cleanup_src, $m ) && (int) $m[1] > 0 && (int) $m[1] <= 500, $m[1] ?? '' );

echo "\nWHAT WAS NOT TESTED\n";
echo "  - Real MySQL: row locks, deadlock retries, index behaviour at scale.\n";
echo "  - Real HTTP concurrency: these 'simultaneous' requests are sequential\n";
echo "    calls that the modelled unique index arbitrates exactly as MySQL's\n";
echo "    would, which tests the logic but not the engine.\n";
echo "  - Wall-clock latency, PHP memory under real WordPress, worker limits.\n";
echo "  - Object-cache backends (Redis, Memcached) under eviction pressure.\n";
echo "  - Browser behaviour of 500 concurrently open tabs.\n";
echo "Production load is NOT certified by this file.\n";

wpep_report( 'LOAD' );
