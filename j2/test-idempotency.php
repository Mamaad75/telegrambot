<?php
/**
 * Jarchi automation idempotency test.
 *
 * The reported failure was a single customer receiving hundreds of copies of
 * one automated message. The recursion that caused the first round was fixed;
 * what remained was a check-then-act guard — get_user_meta() followed by
 * update_user_meta() — which two simultaneous requests both pass.
 *
 * These checks are about the claim being atomic, and about "once" meaning the
 * right thing for each kind of event.
 *
 * @package WPEventPublisherAudit
 */

require __DIR__ . '/boot.php';

use WPEventPublisher\AutomationLedger;
use WPEventPublisher\Tickets;
use WPEventPublisher\TicketAutomations;

$automations = wpep()->ticket_automations();

/**
 * Saves one rule.
 *
 * @param array<string,mixed> $rule Fields.
 *
 * @return string Rule id.
 */
function wpep_rule( array $rule ): string {
	$rules = get_option( TicketAutomations::OPTION, array() );
	$rules = is_array( $rules ) ? $rules : array();

	$row = array_merge(
		array(
			'id'              => 'rule_' . wp_generate_uuid4(),
			'name'            => 'test',
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
			'order_status'    => '',
			'hook_slug'       => '',
			'from_preset'     => '',
		),
		$rule
	);

	$rules[] = $row;

	update_option( TicketAutomations::OPTION, $rules, false );

	return (string) $row['id'];
}

/** Clears rules, ledger and per-request state. */
function wpep_reset(): void {
	update_option( TicketAutomations::OPTION, array(), false );
	$GLOBALS['ledger'] = array();
	TicketAutomations::reset_request_state();
}

/**
 * Tickets owned by one user.
 *
 * @param int $user_id Owner.
 *
 * @return int Count.
 */
function wpep_count( int $user_id ): int {
	return count(
		array_filter(
			$GLOBALS['posts'],
			static fn( $p ) => Tickets::POST_TYPE === $p->post_type && (int) $p->post_author === $user_id
		)
	);
}

/* =====================================================================
 * 1. The ledger's claim is atomic.
 *
 * Everything else rests on this, so it is established directly before any
 * automation is involved.
 * ================================================================== */

$GLOBALS['ledger'] = array();

check( 'a first claim succeeds', AutomationLedger::reserve( 'r1', 7, 'post_published', '456' ) );
check( 'the same claim a second time fails', ! AutomationLedger::reserve( 'r1', 7, 'post_published', '456' ) );

// The parts of the key each matter.
check( 'a different object is a different event', AutomationLedger::reserve( 'r1', 7, 'post_published', '457' ) );
check( 'a different user is a different event', AutomationLedger::reserve( 'r1', 8, 'post_published', '456' ) );
check( 'a different rule is a different event', AutomationLedger::reserve( 'r2', 7, 'post_published', '456' ) );
check( 'a different event type is a different event', AutomationLedger::reserve( 'r1', 7, 'post_unpublished', '456' ) );

// Ten simultaneous callers: exactly one may win.
$GLOBALS['ledger'] = array();
$won               = 0;

for ( $i = 0; $i < 10; $i++ ) {
	if ( AutomationLedger::reserve( 'concurrent', 42, 'order_created', '900' ) ) {
		++$won;
	}
}

check( 'ten simultaneous claims produce exactly one winner', 1 === $won, sprintf( '%d winners', $won ) );

// Releasing hands it back; confirming does not.
AutomationLedger::release( 'concurrent', 42, 'order_created', '900' );

check( 'a released claim can be taken again', AutomationLedger::reserve( 'concurrent', 42, 'order_created', '900' ) );

AutomationLedger::confirm( 'concurrent', 42, 'order_created', '900', 123 );
AutomationLedger::release( 'concurrent', 42, 'order_created', '900' );

check( 'a confirmed claim is not released', ! AutomationLedger::reserve( 'concurrent', 42, 'order_created', '900' ) );

/* =====================================================================
 * 2. The same event cannot create two tickets, through the real path.
 * ================================================================== */

$GLOBALS['users_store']['300'] = new WP_User_Stub( 300, 'seller' );

wpep_reset();
wpep_rule( array( 'trigger' => 'post_published', 'post_type' => 'post', 'subject' => 'منتشر شد', 'body' => '{post_title}' ) );

$GLOBALS['posts'][9001] = new WP_Post(
	array( 'ID' => 9001, 'post_type' => 'post', 'post_title' => 'آگهی', 'post_author' => 300, 'post_status' => 'pending' )
);

$before = wpep_count( 300 );

// The same publish announced five times — a double-clicked button, an
// overlapping hook, a plugin re-saving the post.
for ( $i = 0; $i < 5; $i++ ) {
	TicketAutomations::reset_request_state();
	do_action( 'transition_post_status', 'publish', 'pending', $GLOBALS['posts'][9001] );
}

check( 'five announcements of one publish create one ticket', 1 === wpep_count( 300 ) - $before, sprintf( '%d created', wpep_count( 300 ) - $before ) );

// A second advert is a different event and must not be swallowed.
$GLOBALS['posts'][9002] = new WP_Post(
	array( 'ID' => 9002, 'post_type' => 'post', 'post_title' => 'آگهی دوم', 'post_author' => 300, 'post_status' => 'pending' )
);

TicketAutomations::reset_request_state();
do_action( 'transition_post_status', 'publish', 'pending', $GLOBALS['posts'][9002] );

check( 'a second advert still gets its own ticket', 2 === wpep_count( 300 ) - $before, sprintf( '%d total', wpep_count( 300 ) - $before ) );

/* =====================================================================
 * 3. publish -> publish is not a new event.
 * ================================================================== */

wpep_reset();
wpep_rule( array( 'trigger' => 'post_published', 'post_type' => 'post', 'subject' => 'منتشر', 'body' => 'متن' ) );

$GLOBALS['users_store']['301'] = new WP_User_Stub( 301, 'editor' );

$GLOBALS['posts'][9010] = new WP_Post(
	array( 'ID' => 9010, 'post_type' => 'post', 'post_title' => 'ویرایش', 'post_author' => 301, 'post_status' => 'publish' )
);

$before = wpep_count( 301 );

// Editing an already published post fires the hook with publish on both
// sides. That is a save, not a publication.
for ( $i = 0; $i < 3; $i++ ) {
	TicketAutomations::reset_request_state();
	do_action( 'transition_post_status', 'publish', 'publish', $GLOBALS['posts'][9010] );
}

check( 'editing a published post announces nothing', 0 === wpep_count( 301 ) - $before, sprintf( '%d created', wpep_count( 301 ) - $before ) );

// The legitimate transitions still work.
foreach ( array( 'draft', 'pending', 'future', 'auto-draft' ) as $i => $from ) {
	$id                      = 9020 + $i;
	$GLOBALS['posts'][ $id ] = new WP_Post(
		array( 'ID' => $id, 'post_type' => 'post', 'post_title' => 'از ' . $from, 'post_author' => 301, 'post_status' => $from )
	);

	TicketAutomations::reset_request_state();
	do_action( 'transition_post_status', 'publish', $from, $GLOBALS['posts'][ $id ] );
}

check( 'every real transition into publish does announce', 4 === wpep_count( 301 ) - $before, sprintf( '%d created', wpep_count( 301 ) - $before ) );

// Restoring from the bin, or flipping a private post public, is not the
// moment an advert was approved — the equality guard above does not catch
// these because the statuses genuinely differ.
$mid = wpep_count( 301 );

foreach ( array( 'trash', 'private' ) as $i => $from ) {
	$id                      = 9040 + $i;
	$GLOBALS['posts'][ $id ] = new WP_Post(
		array( 'ID' => $id, 'post_type' => 'post', 'post_title' => 'از ' . $from, 'post_author' => 301, 'post_status' => $from )
	);

	TicketAutomations::reset_request_state();
	do_action( 'transition_post_status', 'publish', $from, $GLOBALS['posts'][ $id ] );
}

check( 'restoring or unhiding a post does not announce it as new', 0 === wpep_count( 301 ) - $mid, sprintf( '%d created', wpep_count( 301 ) - $mid ) );

/* =====================================================================
 * 4. WooCommerce: overlapping hooks are one event.
 * ================================================================== */

wpep_reset();

$GLOBALS['users_store']['310'] = new WP_User_Stub( 310, 'buyer' );

$GLOBALS['wc_orders'][555] = new class() {
	public function get_user_id() { return 310; }
	public function get_order_number() { return '555'; }
	public function get_total() { return 250000; }
	public function get_status() { return 'completed'; }
	public function get_items() { return array(); }
};

wpep_rule( array( 'trigger' => 'order_completed', 'subject' => 'تکمیل شد', 'body' => '{order_id}' ) );

$before = wpep_count( 310 );

// WooCommerce reaches completion through more than one hook, and a site may
// fire both. They describe one event.
TicketAutomations::reset_request_state();
do_action( 'woocommerce_order_status_completed', 555 );
TicketAutomations::reset_request_state();
do_action( 'woocommerce_order_status_completed', 555 );

check( 'one completed order produces one ticket', 1 === wpep_count( 310 ) - $before, sprintf( '%d created', wpep_count( 310 ) - $before ) );

// A second order by the same customer is a different event.
$GLOBALS['wc_orders'][556] = new class() {
	public function get_user_id() { return 310; }
	public function get_order_number() { return '556'; }
	public function get_total() { return 90000; }
	public function get_status() { return 'completed'; }
	public function get_items() { return array(); }
};

TicketAutomations::reset_request_state();
do_action( 'woocommerce_order_status_completed', 556 );

check( 'a second order is not swallowed by the first', 2 === wpep_count( 310 ) - $before, sprintf( '%d total', wpep_count( 310 ) - $before ) );

/* =====================================================================
 * 5. What "once" is counted against.
 *
 * The unit is the event, and for a trigger that carries an object the object
 * is the event. Three adverts are three events; one advert republished ten
 * times is still one. Keying on the user alone was the bug in the other
 * direction: the seller's second advert vanished silently.
 * ================================================================== */

wpep_reset();

$GLOBALS['users_store']['320'] = new WP_User_Stub( 320, 'onceonly' );

wpep_rule( array( 'trigger' => 'post_published', 'post_type' => 'post', 'once_per_user' => true, 'subject' => 'یک بار', 'body' => 'متن' ) );

$before = wpep_count( 320 );

foreach ( array( 9101, 9102, 9103 ) as $id ) {
	$GLOBALS['posts'][ $id ] = new WP_Post(
		array( 'ID' => $id, 'post_type' => 'post', 'post_title' => 'آگهی', 'post_author' => 320, 'post_status' => 'draft' )
	);

	TicketAutomations::reset_request_state();
	do_action( 'transition_post_status', 'publish', 'draft', $GLOBALS['posts'][ $id ] );
}

check( 'three adverts are three events', 3 === wpep_count( 320 ) - $before, sprintf( '%d created', wpep_count( 320 ) - $before ) );

// The same advert, published over and over — a double-clicked button, a
// plugin re-saving the post, an editor toggling it back and forth.
$before = wpep_count( 320 );

for ( $wpep_again = 0; $wpep_again < 10; $wpep_again++ ) {
	$GLOBALS['posts'][9101]->post_status = 'draft';
	TicketAutomations::reset_request_state();
	do_action( 'transition_post_status', 'publish', 'draft', $GLOBALS['posts'][9101] );
}

check( 'the same advert never sends twice', 0 === wpep_count( 320 ) - $before, sprintf( '%d created', wpep_count( 320 ) - $before ) );

/*
 * A trigger with no object of its own is the case once_per_user exists for:
 * registration happens to a user, not to a thing, so the key collapses to the
 * user and the rule and the message goes out exactly once.
 */
wpep_reset();

$GLOBALS['users_store']['321'] = new WP_User_Stub( 321, 'newcomer' );

wpep_rule( array( 'trigger' => 'user_register', 'once_per_user' => true, 'subject' => 'خوش آمدید', 'body' => 'متن' ) );

$before = wpep_count( 321 );

for ( $wpep_again = 0; $wpep_again < 5; $wpep_again++ ) {
	TicketAutomations::reset_request_state();
	do_action( 'user_register', 321 );
}

check( 'an event with no object sends once ever', 1 === wpep_count( 321 ) - $before, sprintf( '%d created', wpep_count( 321 ) - $before ) );

/* =====================================================================
 * 6. Comment replies are deduplicated per comment.
 * ================================================================== */

wpep_reset();

$GLOBALS['users_store']['330'] = new WP_User_Stub( 330, 'commenter' );
$GLOBALS['users_store']['331'] = new WP_User_Stub( 331, 'replier' );

$GLOBALS['posts'][9200] = new WP_Post( array( 'ID' => 9200, 'post_type' => 'post', 'post_title' => 'آگهی', 'post_author' => 300 ) );

wpep_rule( array( 'trigger' => 'comment_reply', 'subject' => 'پاسخ', 'body' => 'متن' ) );

$parent = wp_insert_comment( array( 'comment_post_ID' => 9200, 'user_id' => 330, 'comment_content' => 'سؤال' ) );

$before = wpep_count( 330 );

TicketAutomations::reset_request_state();
$reply = wp_insert_comment( array( 'comment_post_ID' => 9200, 'user_id' => 331, 'comment_parent' => $parent, 'comment_content' => 'پاسخ' ) );

// The same comment announced again — some plugins re-fire this on approval.
TicketAutomations::reset_request_state();
do_action( 'wp_insert_comment', $reply, get_comment( $reply ) );

check( 'one comment reply produces one ticket', 1 === wpep_count( 330 ) - $before, sprintf( '%d created', wpep_count( 330 ) - $before ) );

/* =====================================================================
 * 7. Delayed jobs are claimed at scheduling time, not at delivery.
 * ================================================================== */

wpep_reset();

$GLOBALS['users_store']['340'] = new WP_User_Stub( 340, 'delayed' );

$rule_id = wpep_rule( array( 'trigger' => 'user_register', 'delay_minutes' => 10, 'subject' => 'با تأخیر', 'body' => 'متن' ) );

$before = wpep_count( 340 );

for ( $i = 0; $i < 4; $i++ ) {
	TicketAutomations::reset_request_state();
	do_action( 'user_register', 340 );
}

check( 'a delayed rule creates nothing immediately', 0 === wpep_count( 340 ) - $before );
check( 'and four attempts queue only one job', 1 === count( $GLOBALS['ledger'] ), (string) count( $GLOBALS['ledger'] ) );

// Now let the job run.
$rules   = get_option( TicketAutomations::OPTION, array() );
$context = array();

TicketAutomations::reset_request_state();
wpep()->ticket_automations()->fire_delayed( $rules[0], 340, $context );

check( 'the delayed job delivers once', 1 === wpep_count( 340 ) - $before, sprintf( '%d created', wpep_count( 340 ) - $before ) );

// A rule switched off during the delay must not deliver.
wpep_reset();

$GLOBALS['users_store']['341'] = new WP_User_Stub( 341, 'cancelled' );

wpep_rule( array( 'trigger' => 'user_register', 'delay_minutes' => 10, 'enabled' => true, 'subject' => 'لغو', 'body' => 'متن' ) );

TicketAutomations::reset_request_state();
do_action( 'user_register', 341 );

$rules             = get_option( TicketAutomations::OPTION, array() );
$queued            = $rules[0];
$rules[0]['enabled'] = false;
update_option( TicketAutomations::OPTION, $rules, false );

$before = wpep_count( 341 );

TicketAutomations::reset_request_state();
wpep()->ticket_automations()->fire_delayed( $queued, 341, array() );

check( 'a rule switched off during the delay does not deliver', 0 === wpep_count( 341 ) - $before, sprintf( '%d created', wpep_count( 341 ) - $before ) );

/* =====================================================================
 * 8. The ledger is a real table, installed on upgrade as well as activation.
 * ================================================================== */

$plugin_src = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-plugin.php' );

check( 'the ledger is installed on activation', str_contains( $plugin_src, 'AutomationLedger::install' ) );
check( 'and on upgrade too', 2 === substr_count( $plugin_src, 'AutomationLedger::install' ), (string) substr_count( $plugin_src, 'AutomationLedger::install' ) );

$ledger_src = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-automation-ledger.php' );

check( 'the claim uses an atomic insert', str_contains( $ledger_src, 'INSERT IGNORE' ) );
check( 'against a unique index', str_contains( $ledger_src, 'UNIQUE KEY event_key' ) );

// The old racy guard must be gone from the firing path.
$auto_src = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-ticket-automations.php' );

preg_match( '/private function fire_rule\( array \$rule, int \$user_id, array \$context \): void \{.*?\n\t\}/s', $auto_src, $m );

check( 'firing no longer reads a meta marker to decide', ! str_contains( $m[0] ?? '', 'get_user_meta' ), 'get_user_meta is still the gate' );
check( 'firing reserves through the ledger', str_contains( $m[0] ?? '', 'AutomationLedger::reserve' ) );

/* =====================================================================
 * 9. The scheduled pass: batched, cursored, and locked.
 * ================================================================== */

wpep_reset();
$GLOBALS['cron'] = array();

// No scheduled rule means no cron job at all — an empty hourly job still
// wakes PHP and loads the plugin to discover it has nothing to do.
wpep_rule( array( 'trigger' => 'user_register', 'subject' => 'س', 'body' => 'م' ) );
wpep()->ticket_automations()->schedule();

check( 'no cron is booked when no rule needs it', false === wp_next_scheduled( 'jarchi_ticket_automation_scan' ) );

wpep_reset();
$GLOBALS['cron'] = array();

$scan_rule = wpep_rule( array( 'trigger' => 'scheduled', 'condition' => 'none', 'once_per_user' => false, 'subject' => 'دوره‌ای', 'body' => 'متن' ) );

wpep()->ticket_automations()->schedule();

check( 'cron is booked once a scheduled rule exists', false !== wp_next_scheduled( 'jarchi_ticket_automation_scan' ) );

// A hundred users, batches of twenty-five.
for ( $wpep_i = 400; $wpep_i < 500; $wpep_i++ ) {
	$GLOBALS['users_store'][ (string) $wpep_i ] = new WP_User_Stub( $wpep_i, 'scan-' . $wpep_i );
}

$audience = count( get_users( array( 'fields' => 'ID' ) ) );

$reached = static function () {
	$n = 0;

	foreach ( $GLOBALS['ledger'] as $row ) {
		if ( 'scheduled' === $row['event_type'] || 'once' === $row['event_type'] ) { ++$n; }
	}

	return $n;
};

TicketAutomations::reset_request_state();
do_action( 'jarchi_ticket_automation_scan' );

$first = $reached();

check( 'one run examines a batch, not the whole site', $first > 0 && $first <= 25, sprintf( '%d reached', $first ) );

// The next run must continue, not restart.
TicketAutomations::reset_request_state();
do_action( 'jarchi_ticket_automation_scan' );

$second = $reached();

check( 'the next run continues from the cursor', $second > $first, sprintf( '%d then %d', $first, $second ) );

// Enough runs to walk everybody.
$guard = 0;

while ( $reached() < $audience && $guard < 40 ) {
	TicketAutomations::reset_request_state();
	do_action( 'jarchi_ticket_automation_scan' );
	++$guard;
}

check( 'repeated runs eventually reach every user', $reached() >= $audience, sprintf( '%d of %d after %d runs', $reached(), $audience, $guard ) );

// And nobody is reached twice.
$per_user = array();

foreach ( $GLOBALS['ledger'] as $row ) {
	$per_user[ $row['user_id'] ] = ( $per_user[ $row['user_id'] ] ?? 0 ) + 1;
}

check( 'no user is messaged twice by the scan', empty( array_filter( $per_user, static fn( $n ) => $n > 1 ) ), 'duplicates: ' . count( array_filter( $per_user, static fn( $n ) => $n > 1 ) ) );

/* --- The lock. ---------------------------------------------------------- */

wpep_reset();

wpep_rule( array( 'trigger' => 'scheduled', 'subject' => 'قفل', 'body' => 'متن' ) );

// A run already in progress.
update_option( '_jarchi_automation_scan_lock', array( 'owner' => 'someone-else', 'started' => time(), 'expires' => time() + 600 ), false );

$before_ledger = count( $GLOBALS['ledger'] );

TicketAutomations::reset_request_state();
do_action( 'jarchi_ticket_automation_scan' );

check( 'a second overlapping run does nothing', count( $GLOBALS['ledger'] ) === $before_ledger, sprintf( '%d new', count( $GLOBALS['ledger'] ) - $before_ledger ) );

// An expired lock is recovered rather than blocking for ever.
update_option( '_jarchi_automation_scan_lock', array( 'owner' => 'dead', 'started' => time() - 3600, 'expires' => time() - 1800 ), false );

TicketAutomations::reset_request_state();
do_action( 'jarchi_ticket_automation_scan' );

check( 'an abandoned lock is recovered', count( $GLOBALS['ledger'] ) > $before_ledger, sprintf( '%d new', count( $GLOBALS['ledger'] ) - $before_ledger ) );
check( 'and the lock is released when the run finishes', false === get_option( '_jarchi_automation_scan_lock', false ) );

/* --- The per-request ceiling still applies. ----------------------------- */

wpep_reset();

wpep_rule( array( 'trigger' => 'scheduled', 'subject' => 'سقف', 'body' => 'متن' ) );

// A batch far larger than the ceiling.
add_filter( 'wpep_automation_batch_size', static fn() => 500 );

TicketAutomations::reset_request_state();
do_action( 'jarchi_ticket_automation_scan' );

check( 'the per-request ceiling caps a huge batch', TicketAutomations::created_this_request() <= 20, (string) TicketAutomations::created_this_request() );

wpep_report( 'IDEMPOTENCY' );
