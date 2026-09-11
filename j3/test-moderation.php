<?php
/**
 * Advert approval and rejection tickets.
 *
 * The site moderates adverts with its own screen (iranexim-ad-moderation.php).
 * Approving writes `_iex_moderation_status = approved` and publishes; rejecting
 * writes `_iex_moderation_status = rejected`, `_iex_rejection_reason` and an
 * optional `_iex_rejection_note`, moves the advert to draft, and fires
 * `iex_ad_rejected`.
 *
 * The plugin was reading `_jarchi_reject_reason` — a key nothing writes. So
 * `{reject_reason}` was always empty and every rejection ticket asked the
 * advertiser to read a reason it did not state.
 *
 * @package WPEventPublisherAudit
 */

require __DIR__ . '/boot.php';

use WPEventPublisher\TicketAutomations;
use WPEventPublisher\Tickets;

$automations = wpep()->ticket_automations();

/**
 * Installs one rule and returns its id.
 *
 * @param array<string,mixed> $rule Overrides.
 *
 * @return string Rule id.
 */
function wpep_rule( array $rule ): string {
	$rules = (array) get_option( TicketAutomations::OPTION, array() );

	$row = array_merge(
		array(
			'id'              => 'rule_' . wp_generate_uuid4(),
			'name'            => 'test',
			'enabled'         => true,
			'trigger'         => 'post_published',
			'condition'       => 'none',
			'condition_value' => '',
			'condition_key'   => '',
			'subject'         => 'موضوع',
			'body'            => 'متن',
			'department'      => 0,
			'category'        => 0,
			'priority'        => 'normal',
			'once_per_user'   => false,
			'allow_reply'     => true,
			'delay_minutes'   => 0,
			'post_type'       => TicketAutomations::POST_TYPE_CUSTOM_PUBLIC,
		),
		$rule
	);

	$rules[] = $row;
	update_option( TicketAutomations::OPTION, $rules, false );

	return (string) $row['id'];
}

/** Clears rules, the ledger and per-request state. */
function wpep_reset(): void {
	update_option( TicketAutomations::OPTION, array(), false );
	$GLOBALS['ledger'] = array();
	TicketAutomations::reset_request_state();
}

/**
 * Tickets owned by one user, newest last.
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

/**
 * The body of the most recent ticket for one user.
 *
 * @param int $user_id Owner.
 *
 * @return string Message body.
 */
function wpep_last_body( int $user_id ): string {
	$tickets = wpep_tickets_for( $user_id );

	if ( ! $tickets ) {
		return '';
	}

	$ticket = end( $tickets );
	$out    = '';

	foreach ( (array) get_comments( array( 'post_id' => (int) $ticket->ID ) ) as $comment ) {
		$out .= (string) ( $comment->comment_content ?? '' );
	}

	return $out;
}

/**
 * Registers an advert post type the moderation screen covers.
 *
 * These are public, non-builtin types, which is what the presets target.
 *
 * @param string $slug Post type.
 *
 * @return void
 */
function wpep_register_advert_type( string $slug ): void {
	register_post_type( $slug, array( 'public' => true, 'label' => $slug ) );
}

/**
 * The callback method names registered on one action.
 *
 * @param string $hook Action name.
 *
 * @return string[] Method names.
 */
function wpep_hook_names( string $hook ): array {
	$out = array();

	foreach ( (array) ( $GLOBALS['actions'][ $hook ] ?? $GLOBALS['filters'][ $hook ] ?? array() ) as $priority ) {
		foreach ( (array) $priority as $entry ) {
			$cb = is_array( $entry ) ? ( $entry['function'] ?? $entry ) : $entry;
			$out[] = is_array( $cb ) ? (string) ( $cb[1] ?? '' ) : ( is_string( $cb ) ? $cb : 'closure' );
		}
	}

	return $out;
}

/**
 * Whether one method is registered on one action.
 *
 * @param string $hook   Action name.
 * @param string $method Method name.
 *
 * @return bool True when hooked.
 */
function wpep_hook_has( string $hook, string $method ): bool {
	return in_array( $method, wpep_hook_names( $hook ), true );
}

wpep_register_advert_type( 'jobs' );
wpep_register_advert_type( 'events-training' );

/* =====================================================================
 * 1. The ready-made presets exist and target the right events.
 * ================================================================== */

$presets = array();

foreach ( $automations->presets() as $preset ) {
	$presets[ (string) ( $preset['slug'] ?? '' ) ] = $preset;
}

check( 'an advert-approved preset ships', isset( $presets['post-approved'] ) );
check( 'an advert-rejected preset ships', isset( $presets['post-rejected'] ) );
check( 'approval listens for publication', 'post_published' === ( $presets['post-approved']['trigger'] ?? '' ) );
check( 'rejection listens for un-publication', 'post_unpublished' === ( $presets['post-rejected']['trigger'] ?? '' ) );

check(
	'both target public custom post types, which is what an advert is',
	TicketAutomations::POST_TYPE_CUSTOM_PUBLIC === ( $presets['post-approved']['post_type'] ?? '' )
	&& TicketAutomations::POST_TYPE_CUSTOM_PUBLIC === ( $presets['post-rejected']['post_type'] ?? '' )
);

/*
 * The rejection body must not promise a reason it cannot print. The shipped
 * copy said "please review the stated reason" and then printed an empty token.
 */
check(
	'the rejection body places the reason on its own line',
	str_contains( (string) ( $presets['post-rejected']['body'] ?? '' ), "\n{reject_reason}\n" ),
	(string) ( $presets['post-rejected']['body'] ?? '' )
);

/* =====================================================================
 * 2. THE REPORTED DEFECT: the reason was read from a key nothing writes.
 * ================================================================== */

$keys = TicketAutomations::rejection_meta_keys();

check(
	'the reason is read from the key the moderation screen writes',
	in_array( '_iex_rejection_reason', $keys['reason'], true ),
	implode( ', ', $keys['reason'] )
);

check(
	'and the note beside it',
	in_array( '_iex_rejection_note', $keys['note'], true ),
	implode( ', ', $keys['note'] )
);

check(
	'the key the plugin used to read alone is still honoured',
	in_array( '_jarchi_reject_reason', $keys['reason'], true )
);

/* --- Composition. ------------------------------------------------------- */

$GLOBALS['posts'][7001] = new WP_Post( array( 'ID' => 7001, 'post_type' => 'jobs', 'post_title' => 'آگهی الف', 'post_author' => 500, 'post_status' => 'pending' ) );

check( 'no reason recorded yields nothing rather than a stray label', '' === $automations->reject_reason_for( 7001 ) );

update_post_meta( 7001, '_iex_rejection_reason', 'تصویر نامناسب' );

check(
	'a reason alone is labelled',
	'دلیل: تصویر نامناسب' === $automations->reject_reason_for( 7001 ),
	$automations->reject_reason_for( 7001 )
);

update_post_meta( 7001, '_iex_rejection_note', 'لطفاً عکس واضح‌تری بگذارید' );

check(
	'a reason and a note are joined',
	'دلیل: تصویر نامناسب — لطفاً عکس واضح‌تری بگذارید' === $automations->reject_reason_for( 7001 ),
	$automations->reject_reason_for( 7001 )
);

// A note with no reason is still worth saying — it is the part written for
// this particular person.
delete_post_meta( 7001, '_iex_rejection_reason' );

check(
	'a note on its own is not thrown away',
	'دلیل: لطفاً عکس واضح‌تری بگذارید' === $automations->reject_reason_for( 7001 ),
	$automations->reject_reason_for( 7001 )
);

/* =====================================================================
 * 3. Rejecting an advert, exactly as the moderation screen does it.
 * ================================================================== */

wpep_reset();

$GLOBALS['users_store']['501'] = new WP_User_Stub( 501, 'seller-a' );

wpep_rule(
	array(
		'trigger' => 'post_unpublished',
		'subject' => 'آگهی شما تأیید نشد',
		'body'    => "آگهی «{post_title}» تأیید نشد.\n{reject_reason}",
	)
);

$GLOBALS['posts'][7100] = new WP_Post( array( 'ID' => 7100, 'post_type' => 'jobs', 'post_title' => 'استخدام حسابدار', 'post_author' => 501, 'post_status' => 'pending' ) );

$before = count( wpep_tickets_for( 501 ) );

/*
 * The moderation screen's order of operations, reproduced: meta first, then
 * the status change, then the announcement. The meta being written first is
 * what makes the reason available to the status-transition detector.
 */
update_post_meta( 7100, '_iex_moderation_status', 'rejected' );
update_post_meta( 7100, '_iex_rejection_reason', 'عنوان آگهی نامفهوم است' );
update_post_meta( 7100, '_iex_rejection_note', 'لطفاً عنوان را کوتاه و روشن بنویسید' );

TicketAutomations::reset_request_state();
do_action( 'transition_post_status', 'draft', 'pending', $GLOBALS['posts'][7100] );
do_action( 'iex_ad_rejected', 7100, 'عنوان آگهی نامفهوم است', 'لطفاً عنوان را کوتاه و روشن بنویسید' );

$made = count( wpep_tickets_for( 501 ) ) - $before;

check( 'rejecting an advert creates one ticket', 1 === $made, (string) $made );

$body = wpep_last_body( 501 );

check( 'the ticket names the advert', str_contains( $body, 'استخدام حسابدار' ), $body );
check( 'and states the reason', str_contains( $body, 'عنوان آگهی نامفهوم است' ), $body );
check( 'and the moderator’s note', str_contains( $body, 'لطفاً عنوان را کوتاه و روشن بنویسید' ), $body );

check(
	'the reason is not left as a raw token',
	! str_contains( $body, '{reject_reason}' ),
	$body
);

/*
 * The transition and the explicit action both fired above. Both are wanted —
 * the action is the only signal that says a human pressed reject — and the
 * ledger has to make the pair produce one ticket rather than two.
 */
check( 'the status change and the announcement do not both send', 1 === $made );

/* =====================================================================
 * 4. Approving an advert.
 * ================================================================== */

wpep_reset();

$GLOBALS['users_store']['502'] = new WP_User_Stub( 502, 'seller-b' );

wpep_rule(
	array(
		'trigger' => 'post_published',
		'subject' => 'آگهی شما منتشر شد',
		'body'    => 'آگهی «{post_title}» تأیید شد.',
	)
);

$GLOBALS['posts'][7200] = new WP_Post( array( 'ID' => 7200, 'post_type' => 'events-training', 'post_title' => 'دورهٔ صادرات', 'post_author' => 502, 'post_status' => 'pending' ) );

$before = count( wpep_tickets_for( 502 ) );

update_post_meta( 7200, '_iex_moderation_status', 'approved' );

TicketAutomations::reset_request_state();
do_action( 'transition_post_status', 'publish', 'pending', $GLOBALS['posts'][7200] );
do_action( 'iex_ad_approved', 7200 );

$made = count( wpep_tickets_for( 502 ) ) - $before;

check( 'approving an advert creates one ticket', 1 === $made, (string) $made );
check( 'which names the advert', str_contains( wpep_last_body( 502 ), 'دورهٔ صادرات' ), wpep_last_body( 502 ) );

// Re-approving, or any later save that reaches publish again, must not repeat.
TicketAutomations::reset_request_state();
do_action( 'iex_ad_approved', 7200 );
do_action( 'iex_ad_approved', 7200 );

check(
	'and approving twice does not send twice',
	1 === count( wpep_tickets_for( 502 ) ) - $before,
	(string) ( count( wpep_tickets_for( 502 ) ) - $before )
);

/* =====================================================================
 * 4b. The announcement on its own.
 *
 * Above, the transition and the action both fired and the ledger collapsed
 * them into one ticket — which is right, but it means the transition alone
 * would satisfy those checks and the action could be unhooked without any of
 * them noticing. An advert already sitting in `draft` that a moderator
 * rejects a second time changes no status at all: the action is then the only
 * signal there is.
 * ================================================================== */

wpep_reset();

$GLOBALS['users_store']['510'] = new WP_User_Stub( 510, 'seller-e' );

wpep_rule( array( 'trigger' => 'post_unpublished', 'subject' => 'رد', 'body' => 'رد: {reject_reason}' ) );

$GLOBALS['posts'][7600] = new WP_Post( array( 'ID' => 7600, 'post_type' => 'jobs', 'post_title' => 'آگهی پیش‌نویس', 'post_author' => 510, 'post_status' => 'draft' ) );

$before = count( wpep_tickets_for( 510 ) );

// No transition. Only the announcement.
TicketAutomations::reset_request_state();
do_action( 'iex_ad_rejected', 7600, 'اطلاعات تماس در متن', 'شماره را از متن حذف کنید' );

check(
	'rejecting without a status change still reaches the advertiser',
	1 === count( wpep_tickets_for( 510 ) ) - $before,
	(string) ( count( wpep_tickets_for( 510 ) ) - $before )
);

check(
	'and the reason came from the announcement, not from meta',
	str_contains( wpep_last_body( 510 ), 'اطلاعات تماس در متن' )
	&& str_contains( wpep_last_body( 510 ), 'شماره را از متن حذف کنید' ),
	wpep_last_body( 510 )
);

// The same for approval.
wpep_reset();

$GLOBALS['users_store']['511'] = new WP_User_Stub( 511, 'seller-f' );

wpep_rule( array( 'trigger' => 'post_published', 'subject' => 'تأیید', 'body' => 'تأیید «{post_title}»' ) );

$GLOBALS['posts'][7700] = new WP_Post( array( 'ID' => 7700, 'post_type' => 'jobs', 'post_title' => 'آگهی تأییدی', 'post_author' => 511, 'post_status' => 'publish' ) );

$before = count( wpep_tickets_for( 511 ) );

TicketAutomations::reset_request_state();
do_action( 'iex_ad_approved', 7700 );

check(
	'approving without a status change still reaches the advertiser',
	1 === count( wpep_tickets_for( 511 ) ) - $before,
	(string) ( count( wpep_tickets_for( 511 ) ) - $before )
);

/* A site with its own moderation code can name its own actions. */
check(
	'the approval action list is filterable',
	wpep_hook_has( 'jarchi_advert_approved', 'on_moderation_approved' ),
	implode( ', ', wpep_hook_names( 'jarchi_advert_approved' ) )
);

check(
	'and so is the rejection one',
	wpep_hook_has( 'jarchi_advert_rejected', 'on_moderation_rejected' ),
	implode( ', ', wpep_hook_names( 'jarchi_advert_rejected' ) )
);

/* =====================================================================
 * 5. A rejection past the expiry date is still a rejection.
 *
 * The transition handler treats a move out of `publish` near an expiry
 * timestamp as an expiry. An advert whose expiry had already passed was
 * therefore told "your advert expired" when a moderator refused it — wrong,
 * and unanswerable, since the real reason was in post meta at the time.
 * ================================================================== */

wpep_reset();

$GLOBALS['users_store']['503'] = new WP_User_Stub( 503, 'seller-c' );

wpep_rule( array( 'trigger' => 'post_unpublished', 'subject' => 'رد شد', 'body' => 'رد: {reject_reason}' ) );
wpep_rule( array( 'trigger' => 'post_expired', 'subject' => 'منقضی شد', 'body' => 'آگهی «{post_title}» منقضی شد.' ) );

$GLOBALS['posts'][7300] = new WP_Post( array( 'ID' => 7300, 'post_type' => 'jobs', 'post_title' => 'آگهی قدیمی', 'post_author' => 503, 'post_status' => 'publish' ) );

// Expired a day ago, and now rejected by a moderator.
update_post_meta( 7300, '_expiration-date', time() - DAY_IN_SECONDS );
update_post_meta( 7300, '_iex_moderation_status', 'rejected' );
update_post_meta( 7300, '_iex_rejection_reason', 'محتوای تکراری' );

$before = count( wpep_tickets_for( 503 ) );

TicketAutomations::reset_request_state();
do_action( 'transition_post_status', 'draft', 'publish', $GLOBALS['posts'][7300] );

$body = wpep_last_body( 503 );

check( 'a moderator rejection past the expiry date sends one ticket', 1 === count( wpep_tickets_for( 503 ) ) - $before, (string) ( count( wpep_tickets_for( 503 ) ) - $before ) );
check( 'and it is the rejection, not the expiry notice', str_contains( $body, 'محتوای تکراری' ), $body );
check( 'the expiry notice is not sent', ! str_contains( $body, 'منقضی شد' ), $body );

// And a genuine expiry, with no moderation decision, is still an expiry.
wpep_reset();

$GLOBALS['users_store']['504'] = new WP_User_Stub( 504, 'seller-d' );

wpep_rule( array( 'trigger' => 'post_unpublished', 'subject' => 'رد شد', 'body' => 'رد شد' ) );
wpep_rule( array( 'trigger' => 'post_expired', 'subject' => 'منقضی شد', 'body' => 'آگهی «{post_title}» منقضی شد.' ) );

$GLOBALS['posts'][7400] = new WP_Post( array( 'ID' => 7400, 'post_type' => 'jobs', 'post_title' => 'آگهی منقضی', 'post_author' => 504, 'post_status' => 'publish' ) );
update_post_meta( 7400, '_expiration-date', time() - DAY_IN_SECONDS );

TicketAutomations::reset_request_state();
do_action( 'transition_post_status', 'draft', 'publish', $GLOBALS['posts'][7400] );

check(
	'an expiry with no moderation decision is still reported as expiry',
	str_contains( wpep_last_body( 504 ), 'منقضی' ),
	wpep_last_body( 504 )
);

/* =====================================================================
 * 6. Sites whose moderation code differs.
 * ================================================================== */

$GLOBALS['filters']['jarchi_rejection_meta_keys'][10][] = static function ( $keys ) {
	$keys['reason'][] = '_my_custom_reason';

	return $keys;
};

$GLOBALS['posts'][7500] = new WP_Post( array( 'ID' => 7500, 'post_type' => 'jobs', 'post_title' => 'ت', 'post_author' => 505 ) );
update_post_meta( 7500, '_my_custom_reason', 'دلیل سفارشی' );

check(
	'a site can point the reason at its own meta key',
	str_contains( $automations->reject_reason_for( 7500 ), 'دلیل سفارشی' ),
	$automations->reject_reason_for( 7500 )
);

/* The composed sentence itself can be replaced wholesale. */
$GLOBALS['filters']['jarchi_reject_reason'][10][] = static function ( $text, $post_id, $reason ) {
	return '' === $reason ? $text : 'چرا رد شد؟ ' . $reason;
};

update_post_meta( 7500, '_iex_rejection_reason', 'متن ناقص' );

check(
	'a site can rewrite the whole sentence',
	'چرا رد شد؟ متن ناقص' === $automations->reject_reason_for( 7500 ),
	$automations->reject_reason_for( 7500 )
);

wpep_report( 'MODERATION' );
