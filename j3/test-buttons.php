<?php
/**
 * Contact button modes, and the phone in the message body.
 *
 * Two separate requests that had been one setting:
 *
 * 1. A contact button that points at one fixed support account and appears on
 *    every advert, rather than revealing the advertiser's own number and
 *    appearing only where there is one.
 *
 * 2. Printing the number in the body of the message, on its own switch. It had
 *    been welded to the button, so a site that wanted the button had to publish
 *    the number too — which is backwards once a support desk sits in between.
 *
 * @package WPEventPublisherAudit
 */

require __DIR__ . '/boot.php';

use WPEventPublisher\Field;
use WPEventPublisher\Validator;

$validator = new Validator();

/**
 * Runs one platform configuration through validation.
 *
 * @param array<string,mixed> $telegram Telegram configuration.
 *
 * @return array<string,mixed> Cleaned Telegram configuration.
 */
function wpep_clean( array $telegram ): array {
	$out = ( new Validator() )->sanitize_platforms( array( Field::PLATFORM_TELEGRAM => $telegram ) );

	return (array) ( $out[ Field::PLATFORM_TELEGRAM ] ?? array() );
}

/* =====================================================================
 * 1. The defaults are the behaviour that already shipped.
 * ================================================================== */

$defaults = wpep()->settings()->platform_defaults();
$telegram = (array) ( $defaults[ Field::PLATFORM_TELEGRAM ] ?? array() );

check( 'contact defaults to the advertiser, as before', 'author' === ( $telegram['contact_mode'] ?? '' ), (string) ( $telegram['contact_mode'] ?? 'missing' ) );
check( 'with no support account set', '' === ( $telegram['contact_target'] ?? 'x' ) );

/*
 * The phone switch defaults ON. A site that upgrades has never seen this
 * control, and a new switch that silently stops publishing a field the site
 * was publishing yesterday is a regression wearing a feature's clothes.
 */
check( 'the phone still appears in the text by default', ! empty( $telegram['show_phone'] ) );

$upgraded = wpep_clean( array( 'enabled' => '1' ) );

check(
	'and an existing configuration that predates the switch keeps printing it',
	! empty( $upgraded['show_phone'] ),
	var_export( $upgraded['show_phone'] ?? null, true )
);

/* =====================================================================
 * 2. The support account, however it was pasted.
 * ================================================================== */

$accepted = array(
	'@iranexim_support'                 => 'iranexim_support',
	'iranexim_support'                  => 'iranexim_support',
	'https://t.me/iranexim_support'     => 'iranexim_support',
	't.me/iranexim_support'             => 'iranexim_support',
	'https://ble.ir/iranexim_support'   => 'iranexim_support',
	'https://wa.me/989120000000'        => 'https://wa.me/989120000000',
	'https://example.ir/support'        => 'https://example.ir/support',
);

foreach ( $accepted as $wpep_input => $wpep_expected ) {
	$clean = wpep_clean( array( 'contact_target' => $wpep_input ) );

	check(
		'accepted: ' . $wpep_input,
		$wpep_expected === ( $clean['contact_target'] ?? '' ),
		(string) ( $clean['contact_target'] ?? '' )
	);
}

/*
 * The value ends up inside a button URL. A button is a poor place to discover
 * that a string was not what it looked like, so anything that is not one of
 * the shapes above is refused outright rather than passed through.
 */
$refused = array(
	'javascript:alert(1)',
	'<script>alert(1)</script>',
	'ab',
	'has spaces',
	'user name@thing',
	'ftp://example.ir/x',
	str_repeat( 'a', 200 ),
);

foreach ( $refused as $wpep_bad ) {
	$clean = wpep_clean( array( 'contact_target' => $wpep_bad ) );

	check(
		'refused: ' . substr( $wpep_bad, 0, 30 ),
		'' === ( $clean['contact_target'] ?? 'x' ),
		(string) ( $clean['contact_target'] ?? '' )
	);
}

check( 'an unknown mode falls back to the advertiser rather than to support', 'author' === ( wpep_clean( array( 'contact_mode' => 'nonsense' ) )['contact_mode'] ?? '' ) );
check( 'and a real one is kept', 'support' === ( wpep_clean( array( 'contact_mode' => 'support' ) )['contact_mode'] ?? '' ) );

/* =====================================================================
 * 3. What the payload carries.
 * ================================================================== */

/**
 * Builds a payload for one post under one platform configuration.
 *
 * @param array<string,mixed> $telegram Telegram configuration.
 * @param int                 $post_id  Post.
 *
 * @return array<string,mixed> Payload.
 */
function wpep_payload( array $telegram, int $post_id ): array {
	$platforms = wpep()->settings()->platforms();
	$platforms[ Field::PLATFORM_TELEGRAM ] = array_merge(
		(array) ( $platforms[ Field::PLATFORM_TELEGRAM ] ?? array() ),
		array( 'enabled' => true, 'channel_id' => '@testchannel' ),
		$telegram
	);

	$all = (array) get_option( \WPEventPublisher\Settings::OPTION, array() );
	$all['platforms'] = $platforms;

	update_option( \WPEventPublisher\Settings::OPTION, $all );

	// The settings object memoises, so a test writing straight to the option
	// would be read back from the copy taken before the write.
	wpep()->settings()->flush_cache();

	return (array) wpep()->normalizer()->normalize( $GLOBALS['posts'][ $post_id ] );
}

$GLOBALS['posts'][6100] = new WP_Post(
	array( 'ID' => 6100, 'post_type' => 'post', 'post_title' => 'آگهی آزمایشی', 'post_author' => 1, 'post_status' => 'publish' )
);

$payload = wpep_payload(
	array( 'contact_button' => true, 'contact_mode' => 'support', 'contact_target' => 'iranexim_support', 'contact_label' => 'تماس با پشتیبانی' ),
	6100
);

$contact = (array) ( $payload['buttons']['contact'] ?? array() );

check( 'a support button is enabled without the advert having a number', ! empty( $contact['enabled'] ), var_export( $contact, true ) );
check( 'it is marked as the support mode', 'support' === ( $contact['mode'] ?? '' ), (string) ( $contact['mode'] ?? '' ) );

check(
	'and a username becomes a Telegram link',
	'https://t.me/iranexim_support' === ( $contact['url'] ?? '' ),
	(string) ( $contact['url'] ?? '' )
);

check( 'the label the administrator wrote is carried', 'تماس با پشتیبانی' === ( $contact['label'] ?? '' ) );

/* A support mode with nothing behind it must not render a dead button. */
$payload = wpep_payload(
	array( 'contact_button' => true, 'contact_mode' => 'support', 'contact_target' => '' ),
	6100
);

check(
	'a support button with no destination is left off',
	empty( $payload['buttons']['contact']['enabled'] ),
	var_export( $payload['buttons']['contact'] ?? null, true )
);

/* The advertiser mode is unchanged. */
$payload = wpep_payload(
	array( 'contact_button' => true, 'contact_mode' => 'author', 'contact_target' => 'iranexim_support' ),
	6100
);

$contact = (array) ( $payload['buttons']['contact'] ?? array() );

check( 'the advertiser mode is still reported as such', 'author' === ( $contact['mode'] ?? '' ) );
check( 'and carries no support link', '' === ( $contact['url'] ?? 'x' ), (string) ( $contact['url'] ?? '' ) );

/* =====================================================================
 * 4. The phone in the body is its own decision.
 *
 * This needs an advert that would otherwise publish its number: a real number
 * to find, and a phone mapping that permits it on this platform. Without both,
 * `phone_published` is false for reasons that have nothing to do with the new
 * switch, and the check below would pass against a switch that does nothing.
 * ================================================================== */

$GLOBALS['posts'][6200] = new WP_Post(
	array( 'ID' => 6200, 'post_type' => 'post', 'post_title' => 'آگهی با شماره', 'post_author' => 1, 'post_status' => 'publish' )
);

/*
 * The two things that have to be true before the new switch is what decides
 * anything: the advert carries a number, and the phone field is mapped and
 * permitted on this platform. Both are set through the plugin's own documented
 * filters rather than by rebuilding the field-discovery registry in a stub.
 */
$GLOBALS['filters']['wpep_phone'][10][] = static fn() => '09120000000';

$GLOBALS['filters']['wpep_field_mapping'][10][] = static function ( $mapping ) {
	$mapping['phone'] = array(
		'enabled'   => true,
		'label'     => 'تلفن',
		'order'     => 1,
		'format'    => 'text',
		'platforms' => array( Field::PLATFORM_TELEGRAM => true, Field::PLATFORM_BALE => true, Field::PLATFORM_WHATSAPP => true ),
	);

	return $mapping;
};

// The baseline: with the switch on, this advert does publish its number. If
// this fails, the check below proves nothing — it would be reporting "not
// published" for a reason unrelated to the switch.
$with = wpep_payload( array( 'show_phone' => true ), 6200 );

check(
	'an advert whose number is permitted publishes it',
	! empty( $with['phone_published'] ),
	'phone=[' . ( $with['phone'] ?? '' ) . '] published=' . var_export( $with['phone_published'] ?? null, true )
);

$without = wpep_payload( array( 'show_phone' => false ), 6200 );

check(
	'switching the phone out of the text does not publish it',
	empty( $without['phone_published'] ),
	var_export( $without['phone_published'] ?? null, true )
);

/*
 * And the two are genuinely independent: the button survives the text switch
 * being off, which is the arrangement the site asked for.
 */
$both = wpep_payload(
	array(
		'show_phone'     => false,
		'contact_button' => true,
		'contact_mode'   => 'support',
		'contact_target' => 'iranexim_support',
	),
	6200
);

check(
	'the contact button survives the phone being kept out of the text',
	! empty( $both['buttons']['contact']['enabled'] ) && empty( $both['phone_published'] ),
	'button=' . var_export( $both['buttons']['contact']['enabled'] ?? null, true ) . ' phone=' . var_export( $both['phone_published'] ?? null, true )
);

wpep_report( 'BUTTONS' );
