<?php
/**
 * Matching failed searches to products the shop already sells.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Turns a search that returned nothing into either a synonym or a gap.
 *
 * When someone searches for «استارز ۱۰۰۰» and the shop sells
 * «۱۰۰۰ استارز تلگرام», the search returns zero results and a ready buyer
 * leaves. The shop did not lack the product; it lacked the word. That is the
 * single most common cause of a zero-result search, and it is invisible in a
 * list of failed terms because the list cannot tell a missing product from a
 * missing name.
 *
 * So each failed term is matched against the catalogue, and the answer is one
 * of two things an administrator can act on:
 *
 * - a product that is probably what they meant, so add the term as a synonym
 * - nothing close enough, so the catalogue really is missing it
 *
 * Saying "nothing close enough" matters as much as the matches. With a small
 * catalogue there is always a nearest product, and presenting it regardless
 * would send someone to add a synonym that sends shoppers to the wrong thing.
 * A match below {@see MIN_CONFIDENCE} is reported as no match.
 *
 * This screen proposes and never applies. Synonyms live in whichever search
 * plugin the shop runs, which this plugin does not know about, and the standing
 * rule holds: prices and coupons can be changed automatically, wording and
 * layout never are.
 *
 * @since 4.14.0
 */
class BAP_Search_Rescue {

	/**
	 * Below this, a match is reported as no match.
	 *
	 * The model returns its own confidence, and this is where "nearest product"
	 * stops being a usable answer.
	 *
	 * @var int
	 */
	const MIN_CONFIDENCE = 55;

	/**
	 * Terms examined in one run.
	 *
	 * @var int
	 */
	const MAX_TERMS = 25;

	/**
	 * Products sent to the model in one run.
	 *
	 * @var int
	 */
	const MAX_PRODUCTS = 300;

	/**
	 * Fewest searches before a term is worth an administrator's attention.
	 *
	 * @var int
	 */
	const MIN_SEARCHES = 2;

	/**
	 * Where the last run is kept, so reopening the screen costs nothing.
	 *
	 * @var string
	 */
	const OPTION_CACHE = 'bap_search_rescue_cache';

	/**
	 * Builds the rescue list.
	 *
	 * @param string $from  Y-m-d.
	 * @param string $to    Y-m-d.
	 * @param bool   $fresh Ignore the cached run.
	 * @return array{terms:array,catalogue:int,provider:string,error:string,notes:array,built_at:string}
	 */
	public static function report( $from, $to, $fresh = false ) {
		$from = BAP_Reports::sanitize_date( $from );
		$to   = BAP_Reports::sanitize_date( $to );

		$terms     = self::failed_terms( $from, $to );
		$catalogue = self::catalogue();
		$notes     = self::notes( $from, $to, $terms, $catalogue );

		if ( ! $terms || ! $catalogue ) {
			return self::result( array(), count( $catalogue ), '', '', $notes );
		}

		$signature = self::signature( $terms, $catalogue );
		$cached    = (array) get_option( self::OPTION_CACHE, array() );

		if ( ! $fresh && isset( $cached['signature'] ) && $cached['signature'] === $signature ) {
			return self::result(
				(array) ( $cached['terms'] ?? array() ),
				count( $catalogue ),
				(string) ( $cached['provider'] ?? '' ),
				'',
				$notes,
				(string) ( $cached['built_at'] ?? '' )
			);
		}

		$matched = self::match( $terms, $catalogue );

		update_option(
			self::OPTION_CACHE,
			array(
				'signature' => $signature,
				'terms'     => $matched['terms'],
				'provider'  => $matched['provider'],
				'built_at'  => gmdate( 'c' ),
			),
			false
		);

		return self::result( $matched['terms'], count( $catalogue ), $matched['provider'], $matched['error'], $notes );
	}

	/**
	 * Search terms that returned nothing.
	 *
	 * Only measured zeros. A term whose result count was never reported — a
	 * site whose search is not WordPress's own, or rows recorded before the
	 * column existed — is not a failure and is left out.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	public static function failed_terms( $from, $to ) {
		$out = array();

		foreach ( BAP_Local_Reports::explorer( $from, $to )['searches'] as $search ) {
			if ( empty( $search['no_results'] ) || (int) $search['count'] < self::MIN_SEARCHES ) {
				continue;
			}

			$out[] = array(
				'term'     => (string) $search['term'],
				'searches' => (int) $search['count'],
				'visitors' => (int) $search['visitors'],
			);

			if ( count( $out ) >= self::MAX_TERMS ) {
				break;
			}
		}

		return $out;
	}

	/**
	 * The products a match may point at.
	 *
	 * Ids and names only. Prices, stock and descriptions are not needed to
	 * decide whether a word means a product, and sending them would put more of
	 * the shop's data in front of a third-party model for no gain.
	 *
	 * @return array<int,array{id:int,name:string}>
	 */
	public static function catalogue() {
		if ( ! BAP_WooCommerce::is_active() || ! function_exists( 'wc_get_products' ) ) {
			return array();
		}

		$products = wc_get_products(
			array(
				'status'  => 'publish',
				'limit'   => self::MAX_PRODUCTS,
				'orderby' => 'ID',
				'order'   => 'ASC',
				'return'  => 'objects',
			)
		);

		$out = array();

		foreach ( (array) $products as $product ) {
			if ( ! is_object( $product ) || ! method_exists( $product, 'get_id' ) ) {
				continue;
			}

			$name = trim( (string) $product->get_name() );

			if ( '' === $name ) {
				continue;
			}

			$out[] = array( 'id' => (int) $product->get_id(), 'name' => $name );
		}

		return $out;
	}

	/**
	 * Matches terms to products, by model where there is one.
	 *
	 * @param array $terms     Failed terms.
	 * @param array $catalogue Products.
	 * @return array{terms:array,provider:string,error:string}
	 */
	private static function match( array $terms, array $catalogue ) {
		$answer = BAP_AI_Provider::complete( self::system_prompt(), self::payload( $terms, $catalogue ) );

		if ( empty( $answer['ok'] ) ) {
			// The deterministic matcher is not a placeholder: it is what answers
			// when no model is configured, and it is reproducible, which a
			// model is not.
			return array(
				'terms'    => self::apply( $terms, self::local_matches( $terms, $catalogue ), $catalogue ),
				'provider' => 'local',
				'error'    => (string) $answer['error'],
			);
		}

		$parsed = self::parse( (string) $answer['text'], $catalogue );

		if ( ! $parsed ) {
			return array(
				'terms'    => self::apply( $terms, self::local_matches( $terms, $catalogue ), $catalogue ),
				'provider' => 'local',
				'error'    => __( 'پاسخ مدل قابل استفاده نبود؛ تطبیق متنی داخلی انجام شد.', 'bahoosh-analytics-pro' ),
			);
		}

		return array(
			'terms'    => self::apply( $terms, $parsed, $catalogue ),
			'provider' => (string) $answer['provider'],
			'error'    => '',
		);
	}

	/**
	 * What the model is asked.
	 *
	 * @return string
	 */
	public static function system_prompt() {
		return trim(
			"You match failed shop searches to products the shop already sells.

You receive a JSON object with `terms` (search phrases that returned zero results) and `products` (the shop's catalogue as id and name pairs). The shop and its shoppers write in Persian.

RULES, all mandatory:
1. For each term, choose at most ONE product that the shopper most likely meant.
2. `product_id` MUST be an id from the `products` list. Any other value is discarded.
3. If no product is plausibly what they meant, return `product_id: null`. A shop with a small catalogue always has a nearest product; saying so when it is not a real match is worse than saying nothing.
4. `confidence` is 0-100: how sure you are that this term and this product mean the same thing. Different wording for the same item is high. Same category but a different item is low.
5. Match meaning, not spelling. Persian shoppers write the same product many ways: different word order, Arabic vs Persian letters, with or without the zero-width non-joiner, digits in Persian or Latin, brand omitted.
6. `reason` is one short Persian sentence saying why, for the shop owner to read.
7. Do not invent products, do not merge two products, do not suggest creating a product.

Return ONLY JSON: {\"matches\":[{\"term\":\"…\",\"product_id\":123,\"confidence\":0-100,\"reason\":\"…\"}]}"
		);
	}

	/**
	 * The payload the model sees.
	 *
	 * @param array $terms     Failed terms.
	 * @param array $catalogue Products.
	 * @return array
	 */
	private static function payload( array $terms, array $catalogue ) {
		return array(
			'terms'    => wp_list_pluck( $terms, 'term' ),
			'products' => $catalogue,
		);
	}

	/**
	 * Reads the model's answer, discarding anything it made up.
	 *
	 * A product id that was not in the list we sent is the model inventing
	 * inventory, so it is dropped rather than shown. Same discipline as the
	 * evidence-id check on the analysis path.
	 *
	 * @param string $raw       Model text.
	 * @param array  $catalogue Products.
	 * @return array<string,array> Keyed by term.
	 */
	public static function parse( $raw, array $catalogue ) {
		$raw = trim( (string) $raw );

		// Models wrap JSON in prose or fences often enough to be worth handling.
		if ( 0 !== strpos( $raw, '{' ) ) {
			$start = strpos( $raw, '{' );
			$end   = strrpos( $raw, '}' );

			if ( false === $start || false === $end || $end <= $start ) {
				return array();
			}

			$raw = substr( $raw, $start, $end - $start + 1 );
		}

		$decoded = json_decode( $raw, true );

		if ( ! is_array( $decoded ) || ! isset( $decoded['matches'] ) || ! is_array( $decoded['matches'] ) ) {
			return array();
		}

		$known = array();

		foreach ( $catalogue as $product ) {
			$known[ (int) $product['id'] ] = (string) $product['name'];
		}

		$out = array();

		foreach ( $decoded['matches'] as $match ) {
			if ( ! is_array( $match ) ) {
				continue;
			}

			$term = isset( $match['term'] ) ? trim( (string) $match['term'] ) : '';

			if ( '' === $term ) {
				continue;
			}

			$id         = isset( $match['product_id'] ) && is_numeric( $match['product_id'] ) ? (int) $match['product_id'] : 0;
			$confidence = isset( $match['confidence'] ) && is_numeric( $match['confidence'] )
				? max( 0, min( 100, (int) $match['confidence'] ) )
				: 0;

			// Unknown id, or a confidence that does not clear the bar, both
			// become "no match" rather than a suggestion nobody should act on.
			if ( ! isset( $known[ $id ] ) || $confidence < self::MIN_CONFIDENCE ) {
				$out[ $term ] = array( 'product_id' => 0, 'confidence' => $confidence, 'reason' => '' );
				continue;
			}

			$out[ $term ] = array(
				'product_id' => $id,
				'confidence' => $confidence,
				'reason'     => isset( $match['reason'] ) ? sanitize_text_field( (string) $match['reason'] ) : '',
			);
		}

		return $out;
	}

	/**
	 * Deterministic matcher, for when there is no model.
	 *
	 * Normalises the Persian variants that make the same word look different to
	 * a string comparison, then scores character bigram overlap. It will not
	 * understand that «استارز» and «ستاره» are the same idea, which is exactly
	 * what the model is for; it does catch spelling, spacing and digit
	 * differences, which are the bulk of real cases.
	 *
	 * @param array $terms     Failed terms.
	 * @param array $catalogue Products.
	 * @return array<string,array> Keyed by term.
	 */
	public static function local_matches( array $terms, array $catalogue ) {
		$out = array();

		foreach ( $terms as $term ) {
			$needle = self::normalize( $term['term'] );
			$best   = array( 'product_id' => 0, 'confidence' => 0, 'reason' => '' );

			if ( '' === $needle ) {
				$out[ $term['term'] ] = $best;
				continue;
			}

			foreach ( $catalogue as $product ) {
				$score = self::similarity( $needle, self::normalize( $product['name'] ) );

				if ( $score > $best['confidence'] ) {
					$best = array(
						'product_id' => (int) $product['id'],
						'confidence' => $score,
						'reason'     => __( 'شباهت نوشتاری نام محصول با عبارت جست‌وجو (تطبیق متنی داخلی، بدون مدل).', 'bahoosh-analytics-pro' ),
					);
				}
			}

			if ( $best['confidence'] < self::MIN_CONFIDENCE ) {
				$best['product_id'] = 0;
				$best['reason']     = '';
			}

			$out[ $term['term'] ] = $best;
		}

		return $out;
	}

	/**
	 * Folds away the Persian spellings of the same word.
	 *
	 * @param string $text Raw text.
	 * @return string
	 */
	public static function normalize( $text ) {
		$text = (string) $text;

		$map = array(
			// Arabic letters that Persian keyboards produce interchangeably.
			'ي' => 'ی', 'ك' => 'ک', 'ۀ' => 'ه', 'ة' => 'ه', 'أ' => 'ا',
			'إ' => 'ا', 'آ' => 'ا', 'ؤ' => 'و', 'ئ' => 'ی',
			// Zero-width non-joiner and friends: invisible, and fatal to a
			// string comparison.
			"\u{200c}" => ' ', "\u{200d}" => '', "\u{200e}" => '', "\u{200f}" => '',
			// Persian and Arabic-Indic digits to Latin.
			'۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
			'۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
			'٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
			'٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
		);

		$text = strtr( $text, $map );
		// Harakat and tatweel carry no meaning in a product name.
		$text = (string) preg_replace( '/[\x{064B}-\x{0652}\x{0640}]/u', '', $text );
		$text = (string) preg_replace( '/[^\p{L}\p{N}]+/u', ' ', $text );

		return trim( (string) preg_replace( '/\s+/u', ' ', mb_strtolower( $text, 'UTF-8' ) ) );
	}

	/**
	 * Character-bigram similarity, 0-100.
	 *
	 * @param string $a First string.
	 * @param string $b Second string.
	 * @return int
	 */
	private static function similarity( $a, $b ) {
		if ( '' === $a || '' === $b ) {
			return 0;
		}

		if ( $a === $b ) {
			return 100;
		}

		$first  = self::bigrams( $a );
		$second = self::bigrams( $b );

		if ( ! $first || ! $second ) {
			return 0;
		}

		$shared = count( array_intersect( $first, $second ) );

		// Dice coefficient: twice the overlap over the combined size, which
		// does not punish a short query for matching a longer product name as
		// harshly as a plain intersection ratio would.
		return (int) round( 200 * $shared / ( count( $first ) + count( $second ) ) );
	}

	/**
	 * Character bigrams of a string, spaces removed.
	 *
	 * @param string $text Normalised text.
	 * @return string[]
	 */
	private static function bigrams( $text ) {
		$text = str_replace( ' ', '', $text );
		$len  = mb_strlen( $text, 'UTF-8' );

		if ( $len < 2 ) {
			return $len > 0 ? array( $text ) : array();
		}

		$out = array();

		for ( $i = 0; $i < $len - 1; $i++ ) {
			$out[] = mb_substr( $text, $i, 2, 'UTF-8' );
		}

		return array_unique( $out );
	}

	/**
	 * Attaches matches to terms and resolves product links.
	 *
	 * @param array $terms     Failed terms.
	 * @param array $matches   Matches keyed by term.
	 * @param array $catalogue Products.
	 * @return array
	 */
	private static function apply( array $terms, array $matches, array $catalogue ) {
		$names = array();

		foreach ( $catalogue as $product ) {
			$names[ (int) $product['id'] ] = (string) $product['name'];
		}

		$out = array();

		foreach ( $terms as $term ) {
			$match = $matches[ $term['term'] ] ?? array( 'product_id' => 0, 'confidence' => 0, 'reason' => '' );
			$id    = (int) $match['product_id'];

			$out[] = array(
				'term'       => $term['term'],
				'searches'   => $term['searches'],
				'visitors'   => $term['visitors'],
				'verdict'    => $id > 0 ? 'synonym' : 'missing',
				'product_id' => $id,
				'product'    => $id > 0 ? ( $names[ $id ] ?? '' ) : '',
				'confidence' => (int) $match['confidence'],
				'reason'     => (string) $match['reason'],
				'edit_url'   => $id > 0 && current_user_can( 'edit_post', $id ) ? (string) get_edit_post_link( $id, 'raw' ) : '',
				'view_url'   => $id > 0 ? (string) get_permalink( $id ) : '',
			);
		}

		// Worst first, measured in searches: the term that cost the most sales.
		usort( $out, static fn( $a, $b ) => $b['searches'] <=> $a['searches'] );

		return $out;
	}

	/**
	 * What the screen cannot see, said out loud.
	 *
	 * @param string $from      Y-m-d.
	 * @param string $to        Y-m-d.
	 * @param array  $terms     Failed terms.
	 * @param array  $catalogue Products.
	 * @return string[]
	 */
	private static function notes( $from, $to, array $terms, array $catalogue ) {
		$notes = array();

		if ( ! $catalogue ) {
			$notes[] = __( 'محصولی برای تطبیق پیدا نشد. ووکامرس فعال است و محصول منتشرشده دارید؟', 'bahoosh-analytics-pro' );
		}

		$unmeasured = 0;
		$too_few    = 0;
		$searches   = BAP_Local_Reports::explorer( $from, $to )['searches'];

		foreach ( $searches as $search ) {
			if ( ! empty( $search['unmeasured'] ) ) {
				$unmeasured++;
				continue;
			}

			// A measured zero that simply has not been searched often enough.
			// Silent until now, which made the screen look broken: the term is
			// there, it found nothing, and the page said zero with no reason.
			if ( ! empty( $search['no_results'] ) && (int) $search['count'] < self::MIN_SEARCHES ) {
				$too_few++;
			}
		}

		if ( $unmeasured > 0 ) {
			$notes[] = sprintf(
				/* translators: %s: number of search terms. */
				__( 'برای %s عبارت، تعداد نتایج ثبت نشده است. این عبارت‌ها پیش از نسخه ۴.۱۸.۰ ثبت شده‌اند (ایرادی در ردیاب، تعداد صفر را «ثبت‌نشده» ذخیره می‌کرد) یا جست‌وجوی سایتتان از وردپرس نیست. جست‌وجوهای تازه درست ثبت می‌شوند.', 'bahoosh-analytics-pro' ),
				number_format_i18n( $unmeasured )
			);
		}

		if ( $too_few > 0 ) {
			$notes[] = sprintf(
				/* translators: 1: number of terms, 2: minimum searches. */
				__( '%1$s عبارت صفر نتیجه داشته ولی کمتر از %2$s بار جست‌وجو شده است. یک‌بار جست‌وجو می‌تواند اشتباه تایپی باشد؛ از %2$s بار به بالا یک الگوست. همین که دوباره جست‌وجو شوند، اینجا می‌آیند.', 'bahoosh-analytics-pro' ),
				number_format_i18n( $too_few ),
				number_format_i18n( self::MIN_SEARCHES )
			);
		}

		if ( ! $searches ) {
			$notes[] = __( 'در این بازه هیچ جست‌وجویی ثبت نشده است. بازه را بلندتر کنید، یا اگر تازه افزونه را نصب کرده‌اید، چند روز به ردیاب وقت بدهید.', 'bahoosh-analytics-pro' );
		} elseif ( ! $terms && ! $unmeasured && ! $too_few ) {
			$notes[] = __( 'هیچ جست‌وجویی با صفر نتیجه در این بازه ثبت نشده. خبر خوبی است.', 'bahoosh-analytics-pro' );
		}

		return $notes;
	}

	/**
	 * A fingerprint of the inputs, so an unchanged run is not paid for twice.
	 *
	 * @param array $terms     Failed terms.
	 * @param array $catalogue Products.
	 * @return string
	 */
	private static function signature( array $terms, array $catalogue ) {
		return md5(
			wp_json_encode( wp_list_pluck( $terms, 'term' ) ) .
			'|' . wp_json_encode( $catalogue ) .
			'|' . BAP_AI_Provider::current() .
			'|' . BAP_AI_Provider::model()
		);
	}

	/**
	 * Normalises a report.
	 *
	 * @param array  $terms     Matched terms.
	 * @param int    $catalogue Catalogue size.
	 * @param string $provider  Provider that answered.
	 * @param string $error     Error message.
	 * @param array  $notes     Notes.
	 * @param string $built_at  When the run happened.
	 * @return array
	 */
	private static function result( array $terms, $catalogue, $provider, $error, array $notes, $built_at = '' ) {
		$synonyms = 0;
		$missing  = 0;
		$lost     = 0;

		foreach ( $terms as $term ) {
			$lost += (int) $term['searches'];

			if ( 'synonym' === $term['verdict'] ) {
				$synonyms++;
			} else {
				$missing++;
			}
		}

		return array(
			'terms'     => $terms,
			'catalogue' => (int) $catalogue,
			'provider'  => (string) $provider,
			'error'     => (string) $error,
			'notes'     => $notes,
			'built_at'  => '' !== $built_at ? $built_at : gmdate( 'c' ),
			'counts'    => array(
				'synonyms'      => $synonyms,
				'missing'       => $missing,
				'lost_searches' => $lost,
			),
		);
	}
}
