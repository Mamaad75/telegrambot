<?php
/**
 * Shared provider behaviour.
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
 * Behaviour every field provider needs, implemented once.
 *
 * Providers differ only in where they look; reading meta, guessing a type
 * from a key name and turning a machine key into a readable label are the
 * same job for all of them.
 *
 * @since 1.4.0
 */
abstract class BaseProvider implements FieldProvider {

	/**
	 * Key fragments that reveal a field's type when the framework does not
	 * declare one, longest and most specific first.
	 *
	 * @var array<string,string[]>
	 */
	private const TYPE_HINTS = array(
		Field::TYPE_GALLERY => array( 'gallery', 'images', 'photos', 'slider', 'attachments' ),
		Field::TYPE_IMAGE   => array( 'image', 'thumbnail', 'photo', 'logo', 'avatar', 'banner', 'cover' ),
		Field::TYPE_EMAIL   => array( 'email', 'e_mail' ),
		Field::TYPE_URL     => array( 'url', 'link', 'website', 'permalink', 'webpage' ),
		Field::TYPE_DATE    => array( 'date', 'time', 'expiry', 'expires', 'deadline', 'published', 'tarikh' ),
		Field::TYPE_NUMBER  => array( 'price', 'cost', 'amount', 'count', 'qty', 'quantity', 'year', 'mileage', 'area', 'size', 'weight', 'floor', 'rooms', 'bedrooms', 'salary', 'gheymat', 'metraj' ),
		Field::TYPE_BOOLEAN => array( 'is_', 'has_', 'enabled', 'active', 'featured', 'urgent' ),
	);

	/**
	 * Reads a post meta value, unserialized.
	 *
	 * @since 1.4.0
	 *
	 * @param int    $post_id Post ID.
	 * @param string $key     Meta key.
	 *
	 * @return mixed Meta value, null when absent.
	 */
	protected function meta( int $post_id, string $key ): mixed {
		if ( '' === $key ) {
			return null;
		}

		$value = get_post_meta( $post_id, $key, true );

		if ( '' === $value || null === $value || array() === $value ) {
			return null;
		}

		return maybe_unserialize( $value );
	}

	/**
	 * Turns a machine key into a readable label.
	 *
	 * `ad_fuel_type` becomes "Ad Fuel Type", `_price` becomes "Price".
	 * Non-Latin keys are left exactly as they are, because a Persian meta
	 * key is already the label a Persian administrator wants to read.
	 *
	 * @since 1.4.0
	 *
	 * @param string $key Machine key.
	 *
	 * @return string Label.
	 */
	protected function humanize( string $key ): string {
		$key = ltrim( trim( $key ), '_' );

		if ( '' === $key ) {
			return '';
		}

		if ( ! preg_match( '/^[a-z0-9_\-\s]+$/i', $key ) ) {
			return $key;
		}

		return ucwords( trim( str_replace( array( '_', '-' ), ' ', $key ) ) );
	}

	/**
	 * Guesses a field type from its key name and a sample value.
	 *
	 * Used only when the framework does not declare a type. Getting it
	 * wrong costs formatting, never data: every type falls back to reading
	 * the raw value.
	 *
	 * @since 1.4.0
	 *
	 * @param string $key   Machine key.
	 * @param mixed  $value Sample value, when one is available.
	 *
	 * @return string One of the Field::TYPE_* constants.
	 */
	protected function guess_type( string $key, mixed $value = null ): string {
		$normalized = strtolower( $key );

		foreach ( self::TYPE_HINTS as $type => $hints ) {
			foreach ( $hints as $hint ) {
				if ( str_contains( $normalized, $hint ) ) {
					return $type;
				}
			}
		}

		$value = maybe_unserialize( $value );

		if ( is_array( $value ) ) {
			return Field::TYPE_REPEATER;
		}

		if ( is_bool( $value ) ) {
			return Field::TYPE_BOOLEAN;
		}

		if ( is_string( $value ) ) {
			if ( preg_match( '#^https?://#i', $value ) ) {
				return Field::TYPE_URL;
			}

			if ( is_email( $value ) ) {
				return Field::TYPE_EMAIL;
			}

			if ( mb_strlen( $value ) > 200 ) {
				return Field::TYPE_TEXTAREA;
			}
		}

		if ( is_numeric( $value ) ) {
			return Field::TYPE_NUMBER;
		}

		return Field::TYPE_TEXT;
	}

	/**
	 * Reads one recently published post of a type, for sample values.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return WP_Post|null Sample post, null when the type has no content.
	 */
	protected function sample_post( string $post_type ): ?WP_Post {
		$cached = wp_cache_get( 'wpep_sample_' . $post_type, 'wpep' );

		if ( $cached instanceof WP_Post ) {
			return $cached;
		}

		$posts = get_posts(
			array(
				'post_type'              => $post_type,
				'post_status'            => array( 'publish', 'draft', 'pending', 'private' ),
				'posts_per_page'         => 1,
				'orderby'                => 'date',
				'order'                  => 'DESC',
				'suppress_filters'       => true,
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
			)
		);

		$post = ( is_array( $posts ) && isset( $posts[0] ) && $posts[0] instanceof WP_Post ) ? $posts[0] : null;

		if ( $post instanceof WP_Post ) {
			wp_cache_set( 'wpep_sample_' . $post_type, $post, 'wpep', MINUTE_IN_SECONDS );
		}

		return $post;
	}

	/**
	 * Default signature: the provider id plus whether it is available.
	 *
	 * Providers whose field definitions live in the database (ACF field
	 * groups, JetEngine meta boxes) override this with something that
	 * tracks those definitions.
	 *
	 * @since 1.4.0
	 *
	 * @return string Signature.
	 */
	public function signature(): string {
		return $this->id() . ':' . ( $this->is_available() ? '1' : '0' );
	}
}
