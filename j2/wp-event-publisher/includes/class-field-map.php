<?php
/**
 * Advertisement field resolution across field frameworks.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Finds the price, location, phone and gallery of an advertisement no
 * matter which plugin stored them.
 *
 * The same listing is `_price` under WooCommerce, `ad-price` under a
 * JetEngine meta box, `price` under ACF and `listing_price` in a bespoke
 * theme. Hardcoding any one of those makes the plugin work on exactly one
 * site, so resolution is a chain instead:
 *
 * 1. the meta keys the administrator mapped in Settings — always wins;
 * 2. the conventional keys of the known frameworks, in order;
 * 3. a fuzzy match on the key name, so an unknown convention still lands;
 * 4. an empty value, which is a value and never an error.
 *
 * Nothing here is specific to a single site's plugin stack: JetEngine is
 * one entry in a list, not a dependency.
 *
 * @since 1.3.0
 */
class FieldMap {

	/**
	 * Conventional meta keys per logical field, most specific first.
	 *
	 * @var array<string,string[]>
	 */
	private const CONVENTIONS = array(
		'price'    => array( '_price', 'price', 'ad_price', 'ad-price', '_regular_price', '_sale_price', 'product_price', 'listing_price', 'item_price', 'gheymat', 'ghimat', 'قیمت' ),
		'location' => array( 'location', 'city', 'ad_city', 'ad-city', 'ad_location', 'listing_city', 'listing_location', 'address', 'province', 'state', 'region', 'shahr', 'ostan', 'شهر', 'استان' ),
		'phone'    => array( 'phone', 'mobile', 'telephone', 'tel', 'ad_phone', 'ad-phone', 'contact_phone', 'contact_number', 'whatsapp', 'mobile_number', 'billing_phone', 'tamas', 'تلفن', 'موبایل' ),
		'gallery'  => array( 'gallery', 'images', 'ad_gallery', 'ad-gallery', 'product_gallery', '_product_image_gallery', 'listing_gallery', 'image_gallery', 'photos', 'slider_images' ),
	);

	/**
	 * Key fragments used when no conventional key matched.
	 *
	 * @var array<string,string[]>
	 */
	private const HINTS = array(
		'price'    => array( 'price', 'cost', 'amount', 'fee', 'gheymat', 'ghimat' ),
		'location' => array( 'city', 'town', 'location', 'region', 'province', 'address', 'shahr', 'ostan' ),
		'phone'    => array( 'phone', 'mobile', 'tel', 'whatsapp', 'contact_number', 'mobail', 'hamrah' ),
		'gallery'  => array( 'gallery', 'images', 'photos', 'slider' ),
	);

	/**
	 * Settings dependency.
	 *
	 * @var Settings|null
	 */
	private ?Settings $settings;

	/**
	 * Constructor.
	 *
	 * @since 1.3.0
	 *
	 * @param Settings|null $settings Settings service, when available.
	 */
	public function __construct( ?Settings $settings = null ) {
		$this->settings = $settings;
	}

	/**
	 * Returns the full candidate key chain for a logical field.
	 *
	 * @since 1.3.0
	 *
	 * @param string $field Logical field: price, location, phone or gallery.
	 *
	 * @return string[] Candidate meta keys, in priority order.
	 */
	public function candidates( string $field ): array {
		$configured = array();

		if ( $this->settings instanceof Settings ) {
			// The gallery setting kept its historic name so existing
			// installations do not lose their mapping on upgrade.
			$setting = 'gallery' === $field ? 'image_meta_keys' : $field . '_meta_keys';

			$configured = $this->settings->meta_keys( $setting );
		}

		$chain = array_merge( $configured, self::CONVENTIONS[ $field ] ?? array() );

		/**
		 * Filters the candidate meta keys for a logical advertisement field.
		 *
		 * Use this to teach the plugin a field framework it does not know,
		 * without touching plugin files.
		 *
		 * @since 1.3.0
		 *
		 * @param string[] $chain Candidate meta keys, in priority order.
		 * @param string   $field Logical field name.
		 */
		$chain = (array) apply_filters( 'wpep_field_candidates', $chain, $field );

		return array_values( array_unique( array_filter( array_map( 'strval', $chain ) ) ) );
	}

	/**
	 * Resolves a scalar field (price, location, phone) for a post.
	 *
	 * @since 1.3.0
	 *
	 * @param WP_Post             $post   Post object.
	 * @param string              $field  Logical field name.
	 * @param array<string,mixed> $public Public custom fields already collected.
	 *
	 * @return string Resolved value, empty when nothing matched.
	 */
	public function scalar( WP_Post $post, string $field, array $public = array() ): string {
		foreach ( $this->candidates( $field ) as $key ) {
			$value = $this->first_scalar( get_post_meta( $post->ID, $key, true ) );

			if ( '' !== $value ) {
				return $value;
			}
		}

		// WooCommerce keeps the effective price on the product object, not
		// only in meta.
		if ( 'price' === $field && function_exists( 'wc_get_product' ) ) {
			$product = wc_get_product( $post->ID );

			if ( $product && method_exists( $product, 'get_price' ) ) {
				$price = (string) $product->get_price();

				if ( '' !== $price ) {
					return $price;
				}
			}
		}

		// Anything the site calls something else entirely.
		foreach ( $public as $key => $value ) {
			$normalized = strtolower( (string) $key );

			foreach ( self::HINTS[ $field ] ?? array() as $hint ) {
				if ( str_contains( $normalized, $hint ) ) {
					$scalar = $this->first_scalar( $value );

					if ( '' !== $scalar ) {
						return $scalar;
					}
				}
			}
		}

		return '';
	}

	/**
	 * Collects gallery attachment IDs and image URLs for a post.
	 *
	 * Handles the storage shapes the common frameworks use:
	 *
	 * - WooCommerce: comma separated attachment IDs in `_product_image_gallery`.
	 * - JetEngine: comma separated IDs or URLs, or a repeater array.
	 * - ACF: an array of IDs, of URLs, or of attachment arrays.
	 * - Bespoke: a single ID, a single URL, or a serialized list of either.
	 *
	 * @since 1.3.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return array{ids:int[],urls:string[]} Attachment IDs and direct URLs.
	 */
	public function gallery( WP_Post $post ): array {
		$ids  = array();
		$urls = array();

		$keys = $this->candidates( 'gallery' );

		// Also look at any meta key whose name suggests a gallery, so an
		// unknown framework still contributes its images.
		$meta = get_post_meta( $post->ID );

		if ( is_array( $meta ) ) {
			foreach ( array_keys( $meta ) as $key ) {
				$normalized = strtolower( (string) $key );

				foreach ( self::HINTS['gallery'] as $hint ) {
					if ( str_contains( $normalized, $hint ) ) {
						$keys[] = (string) $key;
						break;
					}
				}
			}
		}

		foreach ( array_unique( $keys ) as $key ) {
			foreach ( $this->flatten( get_post_meta( $post->ID, (string) $key, true ) ) as $value ) {
				if ( is_numeric( $value ) ) {
					$ids[] = (int) $value;
					continue;
				}

				$value = trim( (string) $value );

				if ( '' === $value ) {
					continue;
				}

				// Comma separated identifier lists, as WooCommerce and
				// JetEngine both store them.
				if ( preg_match( '/^[\d,\s]+$/', $value ) ) {
					$ids = array_merge( $ids, wp_parse_id_list( $value ) );
					continue;
				}

				if ( preg_match( '#^(https?:)?//#i', $value ) || str_starts_with( $value, '/' ) ) {
					$urls[] = $value;
				}
			}
		}

		return array(
			'ids'  => array_values( array_unique( array_filter( array_map( 'absint', $ids ) ) ) ),
			'urls' => array_values( array_unique( $urls ) ),
		);
	}

	/**
	 * Returns the first usable scalar inside any meta value shape.
	 *
	 * @since 1.3.0
	 *
	 * @param mixed $value Raw meta value.
	 *
	 * @return string First non-empty scalar, empty string when none.
	 */
	private function first_scalar( mixed $value ): string {
		foreach ( $this->flatten( $value ) as $candidate ) {
			$candidate = trim( (string) $candidate );

			if ( '' !== $candidate ) {
				return $candidate;
			}
		}

		return '';
	}

	/**
	 * Flattens a meta value into a list of scalars.
	 *
	 * ACF fields arrive as nested arrays, JetEngine repeaters as arrays of
	 * arrays, and everything else as a string.
	 *
	 * @since 1.3.0
	 *
	 * @param mixed $value Raw meta value.
	 *
	 * @return array<int,mixed> Scalar values in document order.
	 */
	public function flatten( mixed $value ): array {
		$value = maybe_unserialize( $value );

		if ( is_scalar( $value ) ) {
			return array( $value );
		}

		if ( ! is_array( $value ) ) {
			return array();
		}

		$flat = array();

		array_walk_recursive(
			$value,
			static function ( $item ) use ( &$flat ): void {
				if ( is_scalar( $item ) ) {
					$flat[] = $item;
				}
			}
		);

		return $flat;
	}
}
