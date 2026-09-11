<?php
/**
 * Publish fields: grouped by meaning, with a suggested starting point.
 *
 * The screen grouped fields by which plugin supplied them — "JetEngine",
 * "ACF", "Core". That answers "where did this come from", which is not the
 * question anybody opens the screen with. Somebody deciding what an advert
 * should show is thinking about price and phone, and those sat in whichever
 * provider group they belonged to, screens apart.
 *
 * @package WPEventPublisherAudit
 */

require __DIR__ . '/boot.php';

use WPEventPublisher\Field;
use WPEventPublisher\FieldSemantics;

/* =====================================================================
 * 1. Classification, by name first.
 *
 * The name is what the site's own author chose. The storage type is a much
 * weaker signal: `text` holds a price, a city and a licence number alike.
 * ================================================================== */

$cases = array(
	// Persian names, which is what these sites are actually built with.
	array( 'qeymat', 'قیمت', 'text', FieldSemantics::PRICE ),
	array( 'ad_price', 'مبلغ کل', 'text', FieldSemantics::PRICE ),
	array( 'mablagh_ejare', 'اجاره ماهانه', 'text', FieldSemantics::PRICE ),
	array( 'shahr', 'شهر', 'text', FieldSemantics::LOCATION ),
	array( 'ostan', 'استان', 'select', FieldSemantics::LOCATION ),
	array( 'address', 'نشانی دقیق', 'textarea', FieldSemantics::LOCATION ),
	array( 'tel', 'تلفن تماس', 'text', FieldSemantics::CONTACT ),
	array( 'mobile_number', 'شماره همراه', 'text', FieldSemantics::CONTACT ),
	array( 'company_email', 'ایمیل شرکت', 'text', FieldSemantics::CONTACT ),
	array( 'ad_title', 'عنوان آگهی', 'text', FieldSemantics::IDENTITY ),
	array( 'tozihat', 'توضیحات', 'textarea', FieldSemantics::IDENTITY ),
	array( 'company_name', 'نام شرکت', 'text', FieldSemantics::IDENTITY ),
	array( 'main_image', 'تصویر اصلی', 'image', FieldSemantics::MEDIA ),
	array( 'gallery', 'گالری تصاویر', 'gallery', FieldSemantics::MEDIA ),
	array( 'expire_date', 'تاریخ انقضا', 'date', FieldSemantics::TIME ),

	// English names, since plenty of fields are named in English on the same
	// sites.
	array( 'price', 'Price', 'number', FieldSemantics::PRICE ),
	array( 'city', 'City', 'text', FieldSemantics::LOCATION ),
	array( 'whatsapp', 'WhatsApp', 'text', FieldSemantics::CONTACT ),
);

foreach ( $cases as $case ) {
	list( $key, $label, $type, $expected ) = $case;

	check(
		'«' . $label . '» is filed under ' . $expected,
		$expected === FieldSemantics::classify( $key, $label, $type ),
		FieldSemantics::classify( $key, $label, $type )
	);
}

/*
 * Arabic letter forms. A site built on an Arabic keyboard writes ي and ك where
 * a Persian one writes ی and ک, and the two look identical on screen. Matching
 * the literal characters would miss every one of those fields and quietly file
 * them under "other".
 */
check( 'an Arabic yeh in a field name still matches', FieldSemantics::PRICE === FieldSemantics::classify( 'x', 'قيمت', 'text' ), FieldSemantics::classify( 'x', 'قيمت', 'text' ) );
check( 'and an Arabic kaf', FieldSemantics::LOCATION === FieldSemantics::classify( 'x', 'كشور', 'text' ), FieldSemantics::classify( 'x', 'كشور', 'text' ) );

// Zero-width non-joiner, which Persian uses constantly and keyboards emit
// inconsistently.
check( 'a zero-width non-joiner does not break the match', FieldSemantics::CONTACT === FieldSemantics::classify( 'x', 'وب‌سایت', 'url' ), FieldSemantics::classify( 'x', 'وب‌سایت', 'url' ) );

/* --- Falling back on type, and then on sense. ---------------------------- */

check( 'an unnamed image is still media', FieldSemantics::MEDIA === FieldSemantics::classify( 'f1', 'ف۱', Field::TYPE_IMAGE ) );
check( 'an unnamed date is still time', FieldSemantics::TIME === FieldSemantics::classify( 'f2', 'ف۲', Field::TYPE_DATE ) );

/*
 * A select or a number nobody named recognisably is almost always an attribute
 * of the thing being advertised — rooms, mileage, grade. "Other" is reserved
 * for the genuinely unclassifiable, so it staying small is the signal that the
 * rest is working.
 */
check( 'an unnamed select is treated as a specification', FieldSemantics::SPEC === FieldSemantics::classify( 'f3', 'ف۳', Field::TYPE_SELECT ) );
check( 'and an unnamed number too', FieldSemantics::SPEC === FieldSemantics::classify( 'f4', 'ف۴', Field::TYPE_NUMBER ) );
check( 'a genuinely unidentifiable text field lands in other', FieldSemantics::OTHER === FieldSemantics::classify( 'zzz', 'qqq', Field::TYPE_TEXT ) );

/* --- The sections the screen renders. ------------------------------------ */

$sections = FieldSemantics::sections();

check( 'every section a field can be classified into has a label', count( $sections ) >= 8, (string) count( $sections ) );

foreach ( $cases as $case ) {
	$section = FieldSemantics::classify( $case[0], $case[1], $case[2] );

	if ( ! isset( $sections[ $section ] ) ) {
		check( 'the section ' . $section . ' has a label', false, 'missing' );
	}
}

check( 'identity leads, because it is the top of every message', FieldSemantics::IDENTITY === array_key_first( $sections ) );

/* =====================================================================
 * 2. The suggestion.
 *
 * A fresh post type arrives with dozens of discovered fields and no way to
 * reach a sensible message by clicking. This is the shape offered in one
 * press: what it is, what it costs, where it is, how to reach them.
 * ================================================================== */

$discovered = array(
	array( 'key' => 'ad_title', 'label' => 'عنوان آگهی', 'type' => 'text' ),
	array( 'key' => 'tozihat', 'label' => 'توضیحات', 'type' => 'textarea' ),
	array( 'key' => 'qeymat', 'label' => 'قیمت', 'type' => 'text' ),
	array( 'key' => 'shahr', 'label' => 'شهر', 'type' => 'text' ),
	array( 'key' => 'tel', 'label' => 'تلفن', 'type' => 'text' ),
	array( 'key' => 'rooms', 'label' => 'تعداد اتاق', 'type' => 'number' ),
	array( 'key' => 'gallery', 'label' => 'گالری', 'type' => 'gallery' ),
	array( 'key' => 'internal_ref', 'label' => 'کد داخلی', 'type' => 'text' ),
);

$suggestion = FieldSemantics::suggest( $discovered );

check( 'the suggestion picks something', ! empty( $suggestion['keys'] ), implode( ', ', $suggestion['keys'] ) );

foreach ( array( 'ad_title', 'qeymat', 'shahr', 'tel' ) as $wpep_expected ) {
	check(
		'the suggestion includes ' . $wpep_expected,
		in_array( $wpep_expected, $suggestion['keys'], true ),
		implode( ', ', $suggestion['keys'] )
	);
}

/*
 * Images are not in the text. The gallery travels as photos on the message
 * itself, so listing it as a line of text would print a URL where a picture
 * already is.
 */
check(
	'the gallery is not suggested as a line of text',
	! in_array( 'gallery', $suggestion['keys'], true ),
	implode( ', ', $suggestion['keys'] )
);

/*
 * The order has to be the reading order of a classified advert, not the order
 * the storage plugin happened to return.
 */
$positions = $suggestion['order'];

check(
	'the title comes before the price',
	( $positions['ad_title'] ?? 999 ) < ( $positions['qeymat'] ?? 0 ),
	sprintf( 'title=%d price=%d', $positions['ad_title'] ?? -1, $positions['qeymat'] ?? -1 )
);

check(
	'the price comes before the city',
	( $positions['qeymat'] ?? 999 ) < ( $positions['shahr'] ?? 0 ),
	sprintf( 'price=%d city=%d', $positions['qeymat'] ?? -1, $positions['shahr'] ?? -1 )
);

check(
	'and the phone comes after both',
	( $positions['tel'] ?? 0 ) > ( $positions['shahr'] ?? 999 ),
	sprintf( 'city=%d phone=%d', $positions['shahr'] ?? -1, $positions['tel'] ?? -1 )
);

check( 'every suggested field has a position', count( $positions ) === count( $suggestion['keys'] ) );

/* --- A site with far too many fields. ------------------------------------ */

$many = array();

for ( $i = 0; $i < 12; $i++ ) {
	$many[] = array( 'key' => 'price_' . $i, 'label' => 'قیمت ' . $i, 'type' => 'text' );
	$many[] = array( 'key' => 'spec_' . $i, 'label' => 'ویژگی ' . $i, 'type' => 'select' );
}

$big = FieldSemantics::suggest( $many );

/*
 * One price is informative; twelve price-ish fields is a spreadsheet nobody
 * reads. The suggestion is capped per section, and says what it left out
 * rather than silently dropping it.
 */
check( 'the suggestion caps how many of one kind it takes', count( $big['keys'] ) < count( $many ), count( $big['keys'] ) . ' of ' . count( $many ) );
check( 'and it stays a readable length', count( $big['keys'] ) <= 16, (string) count( $big['keys'] ) );
check( 'what it left out is reported, not discarded quietly', ! empty( $big['skipped'] ), (string) count( $big['skipped'] ) );
check( 'nothing is both taken and skipped', array() === array_intersect( $big['keys'], $big['skipped'] ) );
check( 'every field is accounted for', count( $big['keys'] ) + count( $big['skipped'] ) === count( $many ) );

/* --- Degenerate input. --------------------------------------------------- */

$empty = FieldSemantics::suggest( array() );

check( 'a post type with no fields suggests nothing rather than failing', array() === $empty['keys'] );

$nameless = FieldSemantics::suggest( array( array( 'key' => '', 'label' => '', 'type' => '' ) ) );

check( 'a field with no key is ignored', array() === $nameless['keys'] );

/* =====================================================================
 * 3. The screen is wired to all of it.
 * ================================================================== */

$js = (string) file_get_contents( $GLOBALS['wpep_root'] . 'admin/js/field-mapping.js' );

check( 'the screen groups by section rather than by provider', str_contains( $js, 'bySection' ) );
check( 'and reads the section the server classified', str_contains( $js, 'field.section' ) );
check( 'the suggest button is bound', str_contains( $js, '$( \'#wpep-suggest\' ).on( \'click\'' ) );

check(
	'it reads the key the card actually carries',
	str_contains( $js, '$card.attr( \'data-key\' )' ),
	'a card stores its key in data-key; data-field would silently match nothing'
);

check(
	'applying the suggestion does not save on its own',
	! preg_match( "/#wpep-suggest.*?\\}\\s*\\);/s", $js ) || ! str_contains( substr( $js, strpos( $js, "#wpep-suggest" ), 1400 ), 'persist(' ),
	'a suggestion the administrator has not looked at must not be written'
);

$view = (string) file_get_contents( $GLOBALS['wpep_root'] . 'admin/views/field-mapping.php' );

check( 'the button exists on the screen', str_contains( $view, 'id="wpep-suggest"' ) );
check( 'and the screen explains the new grouping', str_contains( $view, 'نه بر اساس افزونه‌ای که ذخیره‌شان می‌کند' ) );

$admin = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-field-mapping-admin.php' );

check( 'the server sends the section on every field', str_contains( $admin, "'section'    => FieldSemantics::classify(" ) );
check( 'and the section labels', str_contains( $admin, "'sections'     => FieldSemantics::sections()" ) );
check( 'and the suggestion itself', str_contains( $admin, "'suggested'    => FieldSemantics::suggest(" ) );

wpep_report( 'FIELDS' );
