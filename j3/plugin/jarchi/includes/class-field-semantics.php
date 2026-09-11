<?php
/**
 * What a field is *for*, as opposed to which plugin supplies it.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Sorts discovered fields into sections an operator recognises.
 *
 * The fields screen grouped by provider: "JetEngine", "ACF", "Core". That is
 * the right answer to "where did this come from" and the wrong answer to every
 * question anybody actually opens the screen with. Somebody deciding what an
 * advert should show is thinking "does the price go out, does the phone go
 * out" — and price and phone were in whichever group their storage plugin
 * happened to put them, several screens apart, next to fields that have
 * nothing to do with them.
 *
 * Classification is by name first and type second, because the name is what
 * the site's own author chose and is far more reliable than a storage type
 * that is `text` for a price, a city and a licence number alike.
 *
 * Nothing here is guessed at publish time: this only decides how the screen is
 * laid out and what the suggested preset picks. A field's actual behaviour is
 * whatever the administrator saved.
 *
 * @since 1.26.7
 */
final class FieldSemantics {

	/**
	 * Section identifiers, in the order they should be shown.
	 *
	 * Identity first because that is the top of every message, then the two
	 * things a classifieds reader looks for — what it costs and where it is —
	 * then how to reach the seller.
	 *
	 * @var string
	 */
	public const IDENTITY = 'identity';
	public const PRICE    = 'price';
	public const LOCATION = 'location';
	public const CONTACT  = 'contact';
	public const MEDIA    = 'media';
	public const TIME     = 'time';
	public const SPEC     = 'spec';
	public const OTHER    = 'other';

	/**
	 * Word fragments that identify each section, most specific first.
	 *
	 * Persian and English both, because a site's field names are written in
	 * whichever the person building it reached for, and frequently in both
	 * within the same post type.
	 *
	 * @var array<string,string[]>
	 */
	private const HINTS = array(
		self::CONTACT  => array(
			'phone', 'mobile', 'tel', 'whatsapp', 'telegram', 'email', 'mail', 'contact', 'website',
			'site_url', 'instagram', 'eitaa', 'bale', 'fax',
			'تلفن', 'موبایل', 'همراه', 'تماس', 'ایمیل', 'پست الکترونیک', 'واتساپ', 'واتس‌اپ',
			'تلگرام', 'اینستاگرام', 'وبسایت', 'وب‌سایت', 'نمابر', 'فکس',
		),
		self::PRICE    => array(
			'price', 'cost', 'amount', 'salary', 'wage', 'fee', 'budget', 'rent', 'deposit',
			'discount', 'currency', 'payment', 'toman', 'rial',
			'قیمت', 'مبلغ', 'هزینه', 'حقوق', 'دستمزد', 'اجاره', 'رهن', 'ودیعه', 'تخفیف',
			'تومان', 'ریال', 'پرداخت', 'بودجه',
		),
		self::LOCATION => array(
			'city', 'province', 'state', 'address', 'location', 'region', 'district', 'area',
			'country', 'postcode', 'zip', 'map', 'lat', 'lng', 'neighbourhood', 'neighborhood',
			'شهر', 'استان', 'آدرس', 'نشانی', 'منطقه', 'محله', 'کشور', 'کد پستی', 'موقعیت', 'نقشه',
		),
		self::MEDIA    => array(
			'image', 'photo', 'picture', 'gallery', 'thumbnail', 'logo', 'banner', 'video', 'file',
			'attachment', 'document', 'catalog', 'brochure',
			'تصویر', 'عکس', 'گالری', 'لوگو', 'بنر', 'ویدیو', 'فایل', 'سند', 'کاتالوگ', 'بروشور',
		),
		self::TIME     => array(
			'date', 'time', 'deadline', 'expire', 'expiry', 'duration', 'year', 'month', 'schedule',
			'start', 'end', 'published',
			'تاریخ', 'زمان', 'مهلت', 'انقضا', 'مدت', 'سال', 'ماه', 'شروع', 'پایان',
		),
		self::IDENTITY => array(
			'title', 'name', 'subject', 'headline', 'description', 'content', 'summary', 'excerpt',
			'about', 'brand', 'company', 'permalink', 'url', 'slug',
			'عنوان', 'نام', 'موضوع', 'توضیح', 'توضیحات', 'شرح', 'معرفی', 'برند', 'شرکت', 'لینک',
		),
	);

	/**
	 * Section labels, in display order.
	 *
	 * @since 1.26.7
	 *
	 * @return array<string,string> Section id => Persian label.
	 */
	public static function sections(): array {
		return array(
			self::IDENTITY => __( 'عنوان و معرفی', 'wp-event-publisher' ),
			self::PRICE    => __( 'قیمت و مبلغ', 'wp-event-publisher' ),
			self::LOCATION => __( 'مکان', 'wp-event-publisher' ),
			self::CONTACT  => __( 'راه‌های تماس', 'wp-event-publisher' ),
			self::SPEC     => __( 'مشخصات', 'wp-event-publisher' ),
			self::TIME     => __( 'تاریخ و زمان', 'wp-event-publisher' ),
			self::MEDIA    => __( 'تصویر و فایل', 'wp-event-publisher' ),
			self::OTHER    => __( 'سایر', 'wp-event-publisher' ),
		);
	}

	/**
	 * Which section one field belongs in.
	 *
	 * @since 1.26.7
	 *
	 * @param string $key     Field key.
	 * @param string $label   Human label, which is often the more descriptive of the two.
	 * @param string $type    Field type.
	 * @param string $storage Storage key, when it differs from the field key.
	 *
	 * @return string Section id.
	 */
	public static function classify( string $key, string $label = '', string $type = '', string $storage = '' ): string {
		$haystack = self::normalise( $key . ' ' . $label . ' ' . $storage );

		foreach ( self::HINTS as $section => $hints ) {
			foreach ( $hints as $hint ) {
				if ( str_contains( $haystack, self::normalise( $hint ) ) ) {
					return $section;
				}
			}
		}

		/*
		 * No name matched. The type is a weaker signal — plenty of prices are
		 * stored as text — so it is only consulted for the types that are
		 * unambiguous about what they hold.
		 */
		$by_type = array(
			Field::TYPE_IMAGE   => self::MEDIA,
			Field::TYPE_GALLERY => self::MEDIA,
			Field::TYPE_FILE    => self::MEDIA,
			Field::TYPE_DATE    => self::TIME,
			Field::TYPE_EMAIL   => self::CONTACT,
		);

		if ( isset( $by_type[ $type ] ) ) {
			return $by_type[ $type ];
		}

		/*
		 * A select, a checkbox, a taxonomy or a number that named itself after
		 * nothing recognisable is almost always an attribute of the thing being
		 * advertised — the rooms, the mileage, the grade. "Other" is reserved
		 * for fields that are genuinely unclassifiable, so that section staying
		 * small is a sign the rest is working.
		 */
		if ( in_array( $type, array( Field::TYPE_SELECT, Field::TYPE_CHECKBOX, Field::TYPE_TAXONOMY, Field::TYPE_NUMBER, Field::TYPE_BOOLEAN ), true ) ) {
			return self::SPEC;
		}

		return self::OTHER;
	}

	/**
	 * Lowercases and strips the characters that make matching miss.
	 *
	 * Underscores, hyphens and Arabic/Persian letter variants: a site writing
	 * `ﻱ` or `ك` from an Arabic keyboard would otherwise never match a hint
	 * written with the Persian forms.
	 *
	 * @since 1.26.7
	 *
	 * @param string $value Raw text.
	 *
	 * @return string Normalised text.
	 */
	private static function normalise( string $value ): string {
		$value = strtr(
			$value,
			array(
				'_' => ' ',
				'-' => ' ',
				'ي' => 'ی',
				'ك' => 'ک',
				'ۀ' => 'ه',
				'ة' => 'ه',
				'أ' => 'ا',
				'إ' => 'ا',
				'آ' => 'ا',
				'‌' => ' ',
			)
		);

		return trim( preg_replace( '/\s+/u', ' ', mb_strtolower( $value ) ) ?? '' );
	}

	/**
	 * The fields Jarchi would switch on for this post type, in order.
	 *
	 * A classifieds message that works is short and always in the same shape:
	 * what it is, what it costs, where it is, how to reach them, and a link.
	 * An operator opening a fresh post type with forty discovered fields has
	 * no way to arrive at that by clicking, so this is the shape offered in
	 * one press — as a starting point they then edit, not a lock.
	 *
	 * Sections, not individual keys: a site's price field may be called
	 * `_ad_price`, `qeymat` or `salary`, and naming them all would be a list
	 * that is wrong on the next site.
	 *
	 * @since 1.26.7
	 *
	 * @param array<int,array<string,mixed>> $fields Discovered fields with key, label, type, storage.
	 *
	 * @return array{keys:string[],order:array<string,int>,skipped:string[]} Suggestion.
	 */
	public static function suggest( array $fields ): array {
		// How many of each section are worth sending. One price is
		// informative; six price-ish fields is a spreadsheet.
		$budget = array(
			self::IDENTITY => 2,
			self::PRICE    => 2,
			self::LOCATION => 2,
			self::CONTACT  => 2,
			self::SPEC     => 6,
			self::TIME     => 1,
			self::MEDIA    => 0,
			self::OTHER    => 0,
		);

		$taken   = array_fill_keys( array_keys( $budget ), 0 );
		$chosen  = array();
		$skipped = array();

		// Grouped in the section order the screen uses, so the suggested
		// message reads top to bottom the way the screen does.
		$by_section = array_fill_keys( array_keys( self::sections() ), array() );

		foreach ( $fields as $field ) {
			$key = (string) ( $field['key'] ?? '' );

			if ( '' === $key ) {
				continue;
			}

			$section = self::classify(
				$key,
				(string) ( $field['label'] ?? '' ),
				(string) ( $field['type'] ?? '' ),
				(string) ( $field['storage'] ?? '' )
			);

			$by_section[ $section ][] = $field;
		}

		foreach ( $by_section as $section => $rows ) {
			foreach ( $rows as $field ) {
				$key = (string) $field['key'];

				if ( $taken[ $section ] >= $budget[ $section ] ) {
					$skipped[] = $key;
					continue;
				}

				$chosen[] = $key;
				++$taken[ $section ];
			}
		}

		$order = array();

		foreach ( $chosen as $index => $key ) {
			$order[ $key ] = ( $index + 1 ) * 10;
		}

		return array(
			'keys'    => $chosen,
			'order'   => $order,
			'skipped' => $skipped,
		);
	}
}
