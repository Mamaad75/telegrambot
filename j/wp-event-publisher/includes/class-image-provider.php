<?php
/**
 * Image and gallery fields.
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
 * The pictures of an advertisement, wherever they live.
 *
 * Three fields, always offered: the featured image on its own, the gallery
 * on its own, and the combined list. Which of the three a site sends is a
 * mapping decision, not a code decision — that is the "only featured image
 * / only gallery / both" choice, expressed as three placeholders instead of
 * a setting.
 *
 * The gallery itself is assembled from every place a WordPress site puts
 * images: Gutenberg blocks, the classic shortcode, meta fields under any of
 * the framework conventions, and attachments.
 *
 * @since 1.4.0
 */
class ImageProvider extends BaseProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'images';

	/**
	 * Field key of the featured image.
	 *
	 * @var string
	 */
	public const FEATURED = 'featured_image';

	/**
	 * Field key of the gallery.
	 *
	 * @var string
	 */
	public const GALLERY = 'gallery';

	/**
	 * Field key of the combined list.
	 *
	 * @var string
	 */
	public const IMAGES = 'images';

	/**
	 * Normalizer, used to turn attachment IDs into absolute URLs.
	 *
	 * @var Normalizer
	 */
	private Normalizer $normalizer;

	/**
	 * Constructor.
	 *
	 * @since 1.4.0
	 *
	 * @param Normalizer $normalizer Normalizer service.
	 */
	public function __construct( Normalizer $normalizer ) {
		$this->normalizer = $normalizer;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @return string Provider id.
	 */
	public function id(): string {
		return self::ID;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @return string Provider label.
	 */
	public function label(): string {
		return __( 'Images', 'wp-event-publisher' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @return bool Always true.
	 */
	public function is_available(): bool {
		return true;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return Field[] Image fields.
	 */
	public function discover( string $post_type ): array {
		$fields = array();

		if ( post_type_supports( $post_type, 'thumbnail' ) ) {
			$fields[] = new Field(
				array(
					'key'         => self::FEATURED,
					'label'       => __( 'Featured image', 'wp-event-publisher' ),
					'storage_key' => self::FEATURED,
					'source'      => self::ID,
					'type'        => Field::TYPE_IMAGE,
				)
			);
		}

		$fields[] = new Field(
			array(
				'key'         => self::GALLERY,
				'label'       => __( 'Gallery (all images except the featured one)', 'wp-event-publisher' ),
				'storage_key' => self::GALLERY,
				'source'      => self::ID,
				'type'        => Field::TYPE_GALLERY,
				'repeatable'  => true,
			)
		);

		$fields[] = new Field(
			array(
				'key'         => self::IMAGES,
				'label'       => __( 'All images (featured first, then gallery)', 'wp-event-publisher' ),
				'storage_key' => self::IMAGES,
				'source'      => self::ID,
				'type'        => Field::TYPE_GALLERY,
				'repeatable'  => true,
			)
		);

		return $fields;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Post to read it from.
	 *
	 * @return mixed Image URL, list of URLs, or null.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed {
		switch ( $field->storage_key() ) {
			case self::FEATURED:
				$url = $this->featured_url( $post );

				return '' === $url ? null : $url;

			case self::GALLERY:
				$urls = $this->gallery_urls( $post );

				return empty( $urls ) ? null : $urls;

			case self::IMAGES:
				$urls = array_values( array_unique( array_merge( array_filter( array( $this->featured_url( $post ) ) ), $this->gallery_urls( $post ) ) ) );

				return empty( $urls ) ? null : $urls;
		}

		return null;
	}

	/**
	 * Returns the featured image URL.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string Absolute URL, empty when there is none.
	 */
	public function featured_url( WP_Post $post ): string {
		$id = (int) get_post_thumbnail_id( $post );

		if ( $id <= 0 ) {
			return '';
		}

		return $this->normalizer->absolute_url( (string) wp_get_attachment_url( $id ) );
	}

	/**
	 * Collects every gallery image URL, excluding the featured image.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string[] Absolute URLs.
	 */
	public function gallery_urls( WP_Post $post ): array {
		$featured = $this->featured_url( $post );

		// The normalizer already knows every place a WordPress site keeps
		// images; this provider must not grow a second copy of that.
		$urls = $this->normalizer->gallery_urls( $post );

		if ( '' !== $featured ) {
			$urls = array_values( array_diff( $urls, array( $featured ) ) );
		}

		return $urls;
	}
}
