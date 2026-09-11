<?php
/**
 * Native WordPress post fields.
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
 * The fields every post has, whatever plugins are installed.
 *
 * Always available, and deliberately first in the provider order, so the
 * title of an advertisement is `title` rather than being shadowed by a meta
 * key that happens to be called the same thing.
 *
 * Named `CoreProvider` rather than `CoreProvider` because the
 * autoloader turns a class name into a file name by splitting on capitals:
 * `CoreProvider` would have to live in `class-word-press-provider.php`.
 * The provider's own identifier is still `wordpress`, so nothing stored on
 * a site had to change.
 *
 * @since 1.4.0
 * @since 1.5.0 Renamed from `CoreProvider`; the `wordpress` id is unchanged.
 */
class CoreProvider extends BaseProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'wordpress';

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
		return __( 'WordPress', 'wp-event-publisher' );
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
	 * Normalizer used to resolve the contact fields.
	 *
	 * Optional so a provider constructed standalone — by a test, or by a
	 * consumer of the public provider API — still works; the contact fields
	 * simply resolve empty, which is the same answer as "no number here".
	 *
	 * @since 1.6.0
	 * @var Normalizer|null
	 */
	private ?Normalizer $normalizer;

	/**
	 * Constructor.
	 *
	 * @since 1.6.0
	 *
	 * @param Normalizer|null $normalizer Normalizer, when available.
	 */
	public function __construct( ?Normalizer $normalizer = null ) {
		$this->normalizer = $normalizer;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return Field[] Native post fields.
	 */
	public function discover( string $post_type ): array {
		$object   = get_post_type_object( $post_type );
		$supports = array();

		foreach ( array( 'title', 'editor', 'excerpt', 'author', 'thumbnail' ) as $feature ) {
			$supports[ $feature ] = post_type_supports( $post_type, $feature );
		}

		$definitions = array(
			array(
				'key'      => 'id',
				'label'    => __( 'Post ID', 'wp-event-publisher' ),
				'type'     => Field::TYPE_NUMBER,
				'required' => true,
			),
			array(
				'key'      => 'title',
				'label'    => __( 'Title', 'wp-event-publisher' ),
				'type'     => Field::TYPE_TEXT,
				'required' => true,
				'skip'     => ! $supports['title'],
			),
			array(
				'key'   => 'description',
				'label' => __( 'Description (plain text)', 'wp-event-publisher' ),
				'type'  => Field::TYPE_TEXTAREA,
				'skip'  => ! $supports['editor'] && ! $supports['excerpt'],
			),
			array(
				'key'   => 'content',
				'label' => __( 'Content (raw)', 'wp-event-publisher' ),
				'type'  => Field::TYPE_HTML,
				'skip'  => ! $supports['editor'],
			),
			array(
				'key'   => 'excerpt',
				'label' => __( 'Excerpt', 'wp-event-publisher' ),
				'type'  => Field::TYPE_TEXTAREA,
				'skip'  => ! $supports['excerpt'],
			),
			array(
				'key'      => 'permalink',
				'label'    => __( 'Permalink', 'wp-event-publisher' ),
				'type'     => Field::TYPE_URL,
				'required' => true,
			),
			array(
				'key'   => 'slug',
				'label' => __( 'Slug', 'wp-event-publisher' ),
				'type'  => Field::TYPE_TEXT,
			),
			array(
				'key'   => 'status',
				'label' => __( 'Status', 'wp-event-publisher' ),
				'type'  => Field::TYPE_TEXT,
			),
			array(
				'key'   => 'post_type',
				'label' => __( 'Post type', 'wp-event-publisher' ),
				'type'  => Field::TYPE_TEXT,
			),
			array(
				'key'   => 'author',
				'label' => __( 'Author', 'wp-event-publisher' ),
				'type'  => Field::TYPE_USER,
				'skip'  => ! $supports['author'],
			),
			array(
				'key'   => 'published_at',
				'label' => __( 'Published date', 'wp-event-publisher' ),
				'type'  => Field::TYPE_DATE,
			),
			array(
				'key'   => 'updated_at',
				'label' => __( 'Modified date', 'wp-event-publisher' ),
				'type'  => Field::TYPE_DATE,
			),
			array(
				'key'   => 'menu_order',
				'label' => __( 'Menu order', 'wp-event-publisher' ),
				'type'  => Field::TYPE_NUMBER,
				'skip'  => ! ( $object && ! empty( $object->hierarchical ) ),
			),
			// The two contact fields are declared here rather than discovered,
			// because they must exist on the mapping screen whether or not the
			// site happens to store a meta key by that name. Without a row to
			// switch on, "the phone field is enabled" would be a condition no
			// administrator could ever satisfy — and the privacy gate that
			// depends on it would be permanently shut on some sites and
			// meaningless on others. Both start off; see FieldMapping.
			array(
				'key'         => 'phone',
				'label'       => __( 'شماره تماس', 'wp-event-publisher' ),
				'type'        => Field::TYPE_TEXT,
				'description' => __( 'شماره تماس آگهی‌دهنده. تا وقتی این فیلد و پلتفرم مقصد هر دو روشن نباشند، در پیام عمومی فرستاده نمی‌شود.', 'wp-event-publisher' ),
			),
			array(
				'key'         => 'contact_advertiser',
				'label'       => __( 'تماس با آگهی‌دهنده', 'wp-event-publisher' ),
				'type'        => Field::TYPE_TEXT,
				'description' => __( 'دکمه یا لینک تماس با آگهی‌دهنده. برای کار کردن، به شماره تماس منتشرشده نیاز دارد.', 'wp-event-publisher' ),
			),
		);

		$fields = array();

		foreach ( $definitions as $definition ) {
			if ( ! empty( $definition['skip'] ) ) {
				continue;
			}

			unset( $definition['skip'] );

			$definition['source']      = self::ID;
			$definition['storage_key'] = $definition['key'];

			$fields[] = new Field( $definition );
		}

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
	 * @return mixed Raw value.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed {
		switch ( $field->storage_key() ) {
			case 'id':
				return (int) $post->ID;

			case 'title':
				return (string) get_the_title( $post );

			case 'content':
				return (string) $post->post_content;

			case 'excerpt':
				return (string) $post->post_excerpt;

			case 'description':
				// The plain-text description the message is built from. It
				// never runs `the_content`; see Normalizer::render_content().
				return $this->plain_description( $post );

			case 'permalink':
				return (string) get_permalink( $post );

			case 'slug':
				return (string) $post->post_name;

			case 'status':
				return (string) $post->post_status;

			case 'post_type':
				return (string) $post->post_type;

			case 'author':
				$author = get_userdata( (int) $post->post_author );

				return $author ? (string) $author->display_name : '';

			case 'published_at':
				return (string) get_post_time( 'c', true, $post );

			case 'updated_at':
				return (string) get_post_modified_time( 'c', true, $post );

			case 'menu_order':
				return (int) $post->menu_order;

			case 'phone':
				// Resolved through the normaliser's existing detection chain —
				// the administrator's mapped meta keys first, then the
				// conventional names — so this field reports the same number
				// the flat payload has always carried, rather than inventing a
				// second, divergent way of finding it.
				return $this->normalizer instanceof Normalizer
					? $this->normalizer->phone_for( $post )
					: '';

			case 'contact_advertiser':
				// A marker, not a datum: its value says only whether this post
				// has a number worth offering to contact. Whether the button is
				// actually drawn is the buttons block's decision.
				$number = $this->normalizer instanceof Normalizer
					? $this->normalizer->phone_for( $post )
					: '';

				return '' !== $number ? '1' : '';
		}

		return null;
	}

	/**
	 * Builds the plain-text description.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string Plain text.
	 */
	private function plain_description( WP_Post $post ): string {
		$excerpt = trim( (string) $post->post_excerpt );
		$raw     = '' !== $excerpt ? $excerpt : (string) $post->post_content;

		return trim( wp_strip_all_tags( strip_shortcodes( $raw ) ) );
	}
}
