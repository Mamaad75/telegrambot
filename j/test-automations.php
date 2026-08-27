<?php
/**
 * Jarchi automated-ticket regression test.
 *
 * The first section is the important one. A rule listening for "advert
 * published" is triggered by transition_post_status, and creating a ticket is
 * itself a post insert — so the rule's own output can re-trigger it. In
 * production that sent one customer hundreds of tickets and stalled the
 * request that was publishing their advert.
 *
 * @package WPEventPublisherAudit
 */

require __DIR__ . '/boot.php';

use WPEventPublisher\Tickets;
use WPEventPublisher\TicketAutomations;

$automations = wpep()->ticket_automations();

/**
 * Saves one rule directly, bypassing the form.
 *
 * @param array<string,mixed> $rule Rule fields.
 *
 * @return void
 */
function wpep_add_rule( array $rule ): void {
	$rules   = get_option( TicketAutomations::OPTION, array() );
	$rules   = is_array( $rules ) ? $rules : array();
	$rules[] = array_merge(
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

	update_option( TicketAutomations::OPTION, $rules, false );
}

/**
 * Tickets owned by one user.
 *
 * @param int $user_id Owner.
 *
 * @return array<int,\WP_Post> Tickets.
 */
function wpep_tickets_for( int $user_id ): array {
	return array_values(
		array_filter(
			$GLOBALS['posts'],
			static fn( $p ) => Tickets::POST_TYPE === $p->post_type && (int) $p->post_author === $user_id
		)
	);
}

/** Clears rules and per-request state between cases. */
function wpep_reset_rules(): void {
	update_option( TicketAutomations::OPTION, array(), false );
	TicketAutomations::reset_request_state();
}

$GLOBALS['users_store']['30'] = new WP_User_Stub( 30, 'advertiser' );
$GLOBALS['users_store']['31'] = new WP_User_Stub( 31, 'other' );

/* =====================================================================
 * 1. THE FLOOD. A rule must not be re-triggered by its own ticket.
 * ================================================================== */

// Establish that the harness can even see the problem: if wp_insert_post()
// does not announce a status transition, this whole section proves nothing.
$GLOBALS['transition_seen'] = 0;

add_action(
	'transition_post_status',
	static function () {
		++$GLOBALS['transition_seen'];
	}
);

wp_insert_post( array( 'post_type' => 'post', 'post_title' => 'probe', 'post_status' => 'publish', 'post_author' => 30 ) );

check( 'creating a post announces a status transition', $GLOBALS['transition_seen'] > 0, (string) $GLOBALS['transition_seen'] );

wpep_reset_rules();

wpep_add_rule(
	array(
		'name'      => 'تأیید آگهی',
		'trigger'   => 'post_published',
		'post_type' => 'post',
		'subject'   => 'آگهی شما منتشر شد',
		'body'      => 'آگهی «{post_title}» تأیید شد.',
	)
);

$before = count( wpep_tickets_for( 30 ) );

$GLOBALS['posts'][7001] = new WP_Post(
	array( 'ID' => 7001, 'post_type' => 'post', 'post_title' => 'آگهی من', 'post_author' => 30, 'post_status' => 'pending' )
);

do_action( 'transition_post_status', 'publish', 'pending', $GLOBALS['posts'][7001] );

$after = count( wpep_tickets_for( 30 ) ) - $before;

check( 'publishing an advert creates exactly one ticket', 1 === $after, sprintf( '%d tickets created', $after ) );
check( 'the run did not hit the safety ceiling', TicketAutomations::created_this_request() < 20, (string) TicketAutomations::created_this_request() );

// The specific shape of the defect: the ticket itself is a published post.
$ticket = wpep_tickets_for( 30 );
$ticket = end( $ticket );

check( 'the ticket really is a published post', $ticket && 'publish' === $ticket->post_status );
check( 'and creating it did not create another', 1 === $after );

/* --- A rule for adverts must ignore other post types. ------------------- */

wpep_reset_rules();

wpep_add_rule(
    array(
        'trigger'   => 'post_published',
        'post_type' => 'advertisement',
        'subject'   => 'فقط آگهی',
        'body'      => 'متن',
    )
);

$before = count( wpep_tickets_for( 31 ) );

$GLOBALS['posts'][7002] = new WP_Post(
	array( 'ID' => 7002, 'post_type' => 'page', 'post_title' => 'یک برگه', 'post_author' => 31, 'post_status' => 'draft' )
);

do_action( 'transition_post_status', 'publish', 'draft', $GLOBALS['posts'][7002] );

check( 'a rule for adverts ignores a page', count( wpep_tickets_for( 31 ) ) === $before, (string) ( count( wpep_tickets_for( 31 ) ) - $before ) );

// And a rule with no post type configured must not fire for everything.
wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'post_published', 'post_type' => '', 'subject' => 'بدون نوع', 'body' => 'متن' ) );

$before = count( wpep_tickets_for( 31 ) );

$GLOBALS['posts'][7003] = new WP_Post(
	array( 'ID' => 7003, 'post_type' => 'post', 'post_title' => 'نوشته', 'post_author' => 31, 'post_status' => 'draft' )
);

do_action( 'transition_post_status', 'publish', 'draft', $GLOBALS['posts'][7003] );

check( 'a rule with no post type fires for nothing', count( wpep_tickets_for( 31 ) ) === $before, (string) ( count( wpep_tickets_for( 31 ) ) - $before ) );

/* --- The plugin's own records can never trigger a rule. ----------------- */

wpep_reset_rules();

foreach ( array( Tickets::POST_TYPE, 'shop_order', 'revision', 'attachment' ) as $wpep_type ) {
	wpep_add_rule( array( 'trigger' => 'post_published', 'post_type' => $wpep_type, 'subject' => 'نباید', 'body' => 'متن' ) );
}

// The fixtures are built first and the snapshot taken afterwards, because one
// of the post types under test IS a ticket: counting before creating it would
// score the fixture itself as a rule firing.
foreach ( array( Tickets::POST_TYPE, 'shop_order', 'revision', 'attachment' ) as $i => $wpep_type ) {
	$id                      = 7100 + $i;
	$GLOBALS['posts'][ $id ] = new WP_Post(
		array( 'ID' => $id, 'post_type' => $wpep_type, 'post_title' => 'x', 'post_author' => 31, 'post_status' => 'draft' )
	);
}

$before = count( wpep_tickets_for( 31 ) );

foreach ( array( Tickets::POST_TYPE, 'shop_order', 'revision', 'attachment' ) as $i => $wpep_type ) {
	do_action( 'transition_post_status', 'publish', 'draft', $GLOBALS['posts'][ 7100 + $i ] );
}

check( 'the plugin\'s own post types never trigger a rule', count( wpep_tickets_for( 31 ) ) === $before, (string) ( count( wpep_tickets_for( 31 ) ) - $before ) );

/* --- The ceiling holds even against a rule that fights back. ------------ */

wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'custom_hook', 'hook_slug' => 'loop_probe', 'subject' => 'حلقه', 'body' => 'متن' ) );

// A rule whose ticket re-announces the same custom event. Nothing in the
// plugin does this, which is the point: the ceiling has to hold against the
// path nobody predicted, not only the one already fixed.
add_action(
	'wp_insert_post',
	static function ( $post_id, $post ) {
		if ( Tickets::POST_TYPE === ( $post->post_type ?? '' ) ) {
			do_action( 'jarchi_automation_event', 'loop_probe', 31, array() );
		}
	},
	10,
	2
);

$before = count( wpep_tickets_for( 31 ) );

do_action( 'jarchi_automation_event', 'loop_probe', 31, array() );

$made = count( wpep_tickets_for( 31 ) ) - $before;

check( 'a rule that re-announces its own event still terminates', $made >= 1 && $made <= 20, sprintf( '%d tickets', $made ) );
check( 'and it did not run away', $made <= 2, sprintf( '%d tickets — re-entrancy guard should stop it at one', $made ) );

/* =====================================================================
 * 2. Only the person the event concerns is messaged.
 * ================================================================== */

wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'post_published', 'post_type' => 'post', 'subject' => 'آگهی', 'body' => 'متن' ) );

$before_30 = count( wpep_tickets_for( 30 ) );
$before_31 = count( wpep_tickets_for( 31 ) );

$GLOBALS['posts'][7200] = new WP_Post(
	array( 'ID' => 7200, 'post_type' => 'post', 'post_title' => 'آگهی ۳۰', 'post_author' => 30, 'post_status' => 'draft' )
);

do_action( 'transition_post_status', 'publish', 'draft', $GLOBALS['posts'][7200] );

check( 'the author of the advert is messaged', count( wpep_tickets_for( 30 ) ) === $before_30 + 1 );
check( 'nobody else is', count( wpep_tickets_for( 31 ) ) === $before_31 );

/* =====================================================================
 * 3. Automated tickets cannot be replied to, and are not "answered".
 * ================================================================== */

$made = wpep_tickets_for( 30 );
$made = end( $made );

check( 'an automated ticket is closed, not awaiting a reply', 'closed' === wpep()->tickets()->status( (int) $made->ID ), wpep()->tickets()->status( (int) $made->ID ) );
check( 'an automated ticket refuses replies', ! wpep()->tickets()->replies_allowed( (int) $made->ID ) );
check( 'an automated ticket is marked as automated', wpep()->tickets()->is_automated( (int) $made->ID ) );
check( 'no first-response time is recorded for it', '' === (string) get_post_meta( (int) $made->ID, '_jarchi_ticket_first_response_at', true ) );

// A rule that invites a reply produces an open, answerable thread.
wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'user_register', 'allow_reply' => true, 'subject' => 'خوش آمدید', 'body' => 'متن' ) );

$GLOBALS['users_store']['32'] = new WP_User_Stub( 32, 'newcomer' );

do_action( 'user_register', 32 );

$open = wpep_tickets_for( 32 );
$open = end( $open );

check( 'a rule may invite a reply', $open && wpep()->tickets()->replies_allowed( (int) $open->ID ) );
check( 'and that thread stays open', $open && 'closed' !== wpep()->tickets()->status( (int) $open->ID ), $open ? wpep()->tickets()->status( (int) $open->ID ) : '' );

/* =====================================================================
 * 4. once_per_user, and what "once" means for repeatable events.
 * ================================================================== */

wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'user_register', 'once_per_user' => true, 'subject' => 'یک بار', 'body' => 'متن' ) );

$GLOBALS['users_store']['33'] = new WP_User_Stub( 33, 'repeat' );

do_action( 'user_register', 33 );
TicketAutomations::reset_request_state();
do_action( 'user_register', 33 );

check( 'a once-per-user rule fires once', 1 === count( wpep_tickets_for( 33 ) ), (string) count( wpep_tickets_for( 33 ) ) );

// But "once" for an advert means once per advert, not once per lifetime.
wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'post_published', 'post_type' => 'post', 'once_per_user' => true, 'subject' => 'آگهی', 'body' => '{post_title}' ) );

$GLOBALS['users_store']['34'] = new WP_User_Stub( 34, 'seller' );

foreach ( array( 7300, 7301 ) as $i => $wpep_post_id ) {
	$GLOBALS['posts'][ $wpep_post_id ] = new WP_Post(
		array( 'ID' => $wpep_post_id, 'post_type' => 'post', 'post_title' => 'آگهی ' . $i, 'post_author' => 34, 'post_status' => 'draft' )
	);

	TicketAutomations::reset_request_state();
	do_action( 'transition_post_status', 'publish', 'draft', $GLOBALS['posts'][ $wpep_post_id ] );
}

check( 'two adverts produce two notices, not one', 2 === count( wpep_tickets_for( 34 ) ), (string) count( wpep_tickets_for( 34 ) ) );

/* =====================================================================
 * 5. Rejection is distinguished from starting a draft.
 * ================================================================== */

wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'post_unpublished', 'post_type' => 'post', 'subject' => 'رد شد', 'body' => '{post_title} — {reject_reason}' ) );

$GLOBALS['users_store']['35'] = new WP_User_Stub( 35, 'rejected' );

$GLOBALS['posts'][7400] = new WP_Post(
	array( 'ID' => 7400, 'post_type' => 'post', 'post_title' => 'پیش‌نویس تازه', 'post_author' => 35, 'post_status' => 'draft' )
);

do_action( 'transition_post_status', 'draft', 'auto-draft', $GLOBALS['posts'][7400] );

check( 'starting a draft notifies nobody', 0 === count( wpep_tickets_for( 35 ) ), (string) count( wpep_tickets_for( 35 ) ) );

$GLOBALS['posts'][7401] = new WP_Post(
	array( 'ID' => 7401, 'post_type' => 'post', 'post_title' => 'آگهی برگشتی', 'post_author' => 35, 'post_status' => 'draft' )
);

update_post_meta( 7401, '_jarchi_reject_reason', 'تصویر نامناسب است.' );

TicketAutomations::reset_request_state();
do_action( 'transition_post_status', 'draft', 'pending', $GLOBALS['posts'][7401] );

check( 'a post sent back from review does notify', 1 === count( wpep_tickets_for( 35 ) ), (string) count( wpep_tickets_for( 35 ) ) );

$rejected = wpep_tickets_for( 35 );
$rejected = end( $rejected );
$messages = wpep()->tickets()->messages( (int) $rejected->ID );
$body     = $messages ? (string) $messages[0]->comment_content : '';

check( 'the rejection reason reaches the customer', str_contains( $body, 'تصویر نامناسب است.' ), $body );
check( 'no placeholder is left unreplaced', ! str_contains( $body, '{' ), $body );

/* =====================================================================
 * 6. Comment replies go to the comment's author, once.
 * ================================================================== */

wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'comment_reply', 'subject' => 'پاسخ', 'body' => '{post_title}' ) );

$GLOBALS['users_store']['36'] = new WP_User_Stub( 36, 'commenter' );
$GLOBALS['users_store']['37'] = new WP_User_Stub( 37, 'replier' );

$GLOBALS['posts'][7500] = new WP_Post( array( 'ID' => 7500, 'post_type' => 'post', 'post_title' => 'آگهی دیدگاه‌دار', 'post_author' => 30 ) );

$parent = wp_insert_comment( array( 'comment_post_ID' => 7500, 'user_id' => 36, 'comment_content' => 'سؤال' ) );

TicketAutomations::reset_request_state();

wp_insert_comment( array( 'comment_post_ID' => 7500, 'user_id' => 37, 'comment_parent' => $parent, 'comment_content' => 'پاسخ' ) );

check( 'the comment author is told about the reply', 1 === count( wpep_tickets_for( 36 ) ), (string) count( wpep_tickets_for( 36 ) ) );
check( 'the replier is not told about their own reply', 0 === count( wpep_tickets_for( 37 ) ), (string) count( wpep_tickets_for( 37 ) ) );

// A ticket message is a comment too, and must not raise a ticket about itself.
wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'comment_reply', 'subject' => 'نباید', 'body' => 'متن' ) );

$ticket_id     = (int) wpep()->tickets()->create_local_automated_ticket( 36, 'یک تیکت', 'متن اولیه' );
$first_message = wpep()->tickets()->messages( $ticket_id );
$before_36     = count( wpep_tickets_for( 36 ) );

TicketAutomations::reset_request_state();

wp_insert_comment(
	array(
		'comment_post_ID' => $ticket_id,
		'user_id'         => 1,
		'comment_parent'  => (int) ( $first_message[0]->comment_ID ?? 0 ),
		'comment_type'    => Tickets::COMMENT_TYPE,
		'comment_content' => 'پاسخ پشتیبانی',
	)
);

check( 'replying inside a ticket does not raise a ticket', count( wpep_tickets_for( 36 ) ) === $before_36, (string) ( count( wpep_tickets_for( 36 ) ) - $before_36 ) );

/* =====================================================================
 * 7. Conditions are checked, and are describable in words.
 * ================================================================== */

wpep_reset_rules();

wpep_add_rule( array( 'trigger' => 'user_register', 'condition' => 'role', 'condition_value' => 'customer', 'subject' => 'مشتری', 'body' => 'متن' ) );

$GLOBALS['users_store']['40'] = new WP_User_Stub( 40, 'plain', '', array( 'subscriber' ) );
$GLOBALS['users_store']['41'] = new WP_User_Stub( 41, 'buyer', '', array( 'customer' ) );

do_action( 'user_register', 40 );
TicketAutomations::reset_request_state();
do_action( 'user_register', 41 );

check( 'a role condition excludes the wrong role', 0 === count( wpep_tickets_for( 40 ) ), (string) count( wpep_tickets_for( 40 ) ) );
check( 'and includes the right one', 1 === count( wpep_tickets_for( 41 ) ), (string) count( wpep_tickets_for( 41 ) ) );

$described = $automations->describe(
	array( 'trigger' => 'user_register', 'condition' => 'role', 'condition_value' => 'customer', 'subject' => 'سلام' )
);

check( 'a rule can be described in one sentence', str_contains( $described, 'ثبت‌نام کاربر' ) && str_contains( $described, 'customer' ), $described );
check( 'the sentence contains no raw keys', ! str_contains( $described, 'user_register' ), $described );

// Every condition must declare what kind of value it needs, or the screen
// cannot render the right control for it.
$untyped = array();

foreach ( $automations->conditions() as $key => $meta ) {
	if ( ! in_array( (string) ( $meta['value'] ?? '' ), array( 'none', 'text', 'number', 'role', 'meta' ), true ) ) {
		$untyped[] = $key;
	}
}

check( 'every condition declares its value type', empty( $untyped ), implode( ', ', $untyped ) );

/* =====================================================================
 * 8. Presets.
 * ================================================================== */

$presets  = $automations->presets();
$triggers = $automations->triggers();

check( 'presets are offered', count( $presets ) >= 9, (string) count( $presets ) );

$bad = array();

foreach ( $presets as $preset ) {
	if ( ! isset( $triggers[ $preset['trigger'] ] ) ) {
		$bad[] = $preset['slug'] . ' => unknown trigger ' . $preset['trigger'];
	}

	foreach ( array( 'ایران اگزیم', 'Iran Exim', 'iranexim', 'Loot Loop' ) as $needle ) {
		if ( str_contains( (string) $preset['subject'] . (string) $preset['body'], $needle ) ) {
			$bad[] = $preset['slug'] . ' hardcodes ' . $needle;
		}
	}
}

check( 'every preset names a real trigger and no customer', empty( $bad ), implode( '; ', $bad ) );

$has_order_created = false;
$has_order_status  = false;

foreach ( $presets as $preset ) {
	if ( 'order_created' === $preset['trigger'] ) { $has_order_created = true; }
	if ( 'order_status_changed' === $preset['trigger'] ) { $has_order_status = true; }
}

check( 'an order-placed preset ships', $has_order_created );
check( 'an order-status preset ships', $has_order_status );

/* =====================================================================
 * 9. Every trigger says whether it targets one person or scans everybody.
 * ================================================================== */

$scan_triggers = array();
$bad_scope     = array();

foreach ( $triggers as $key => $meta ) {
	if ( ! in_array( (string) ( $meta['scope'] ?? '' ), array( 'actor', 'scan' ), true ) ) {
		$bad_scope[] = $key;
	}

	if ( 'scan' === ( $meta['scope'] ?? '' ) ) {
		$scan_triggers[] = $key;
	}
}

check( 'every trigger declares its scope', empty( $bad_scope ), implode( ', ', $bad_scope ) );
check( 'only the two periodic events scan every user', array( 'profile_completed', 'scheduled' ) === $scan_triggers, implode( ', ', $scan_triggers ) );

/* =====================================================================
 * 10. The screen renders and reads in words, not keys.
 * ================================================================== */

$_GET = array( 'page' => 'wp-event-publisher', 'jarchi_view' => 'ticket-automations' );

ob_start();
$automations->render();
$html = (string) ob_get_clean();

check( 'the automations screen renders', str_contains( $html, 'jarchi-preset-grid' ) );
check( 'it presents every preset', substr_count( $html, 'jarchi-preset__subject' ) === count( $presets ), (string) substr_count( $html, 'jarchi-preset__subject' ) );
check( 'it offers each condition with a declared value type', substr_count( $html, 'data-value-type' ) === count( $automations->conditions() ), (string) substr_count( $html, 'data-value-type' ) );
check( 'it names events in words', str_contains( $html, 'ثبت‌نام کاربر' ) );
check( 'it does not print raw trigger keys as labels', ! str_contains( $html, '>user_register<' ) );
check( 'it explains the reply setting', str_contains( $html, 'کاربر بتواند به این تیکت پاسخ دهد' ) );
check( 'it warns about rules that scan every user', str_contains( $html, 'data-jarchi-scan-warning' ) );

wpep_report( 'AUTOMATION' );
