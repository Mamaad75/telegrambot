<?php
/**
 * Field value resolution and formatting.
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
 * Turns a field plus a post into the two things the plugin needs: a
 * structured value for the payload, and a string for the message.
 *
 * The two are produced from one reading, so they can never disagree. Two
 * rules apply throughout:
 *
 * - **A stored value is never shown raw when a label exists.** A select
 *   holding `diesel` reads "Diesel" wherever the choice list says so.
 * - **A missing value is empty, never an error.** Every framework returns
 *   absence differently; all of them mean the same thing here.
 *
 * @since 1.4.0
 */
class FieldResolver {

	/**
	 * List formatting: values joined with a separator.
	 *
	 * @var string
	 */
	public const FORMAT_INLINE = 'inline';

	/**
	 * List formatting: one bulleted line per value.
	 *
	 * @var string
	 */
	public const FORMAT_BULLETS = 'bullets';

	/**
	 * List formatting: one numbered line per value.
	 *
	 * @var string
	 */
	public const FORMAT_NUMBERED = 'numbered';

	/**
	 * List formatting: one plain line per value.
	 *
	 * @var string
	 */
	public const FORMAT_LINES = 'lines';

	/**
	 * Every recognised list format.
	 *
	 * @var string[]
	 */
	public const FORMATS = array(
		self::FORMAT_INLINE,
		self::FORMAT_BULLETS,
		self::FORMAT_NUMBERED,
		self::FORMAT_LINES,
	);

	/**
	 * Field registry.
	 *
	 * @var FieldRegistry
	 */
	private FieldRegistry $registry;

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Per-request value cache, keyed by post and field.
	 *
	 * A field can be read by the payload builder and again by the template
	 * renderer; reading meta twice for one delivery is pure waste.
	 *
	 * @var array<string,mixed>
	 */
	private array $cache = array();

	/**
	 * Constructor.
	 *
	 * @since 1.4.0
	 *
	 * @param FieldRegistry $registry Field registry.
	 * @param Settings      $settings Settings service.
	 */
	public function __construct( FieldRegistry $registry, Settings $settings ) {
		$this->registry = $registry;
		$this->settings = $settings;
	}

	/**
	 * Reads a field's raw value through its provider.
	 *
	 * @since 1.4.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Post to read it from.
	 *
	 * @return mixed Raw value, null when absent.
	 */
	public function raw( Field $field, WP_Post $post ): mixed {
		$key = $post->ID . '|' . $field->key();

		if ( array_key_exists( $key, $this->cache ) ) {
			return $this->cache[ $key ];
		}

		$provider = $this->registry->provider( $field->source() );
		$value    = null;

		if ( $provider instanceof FieldProvider && $provider->is_available() ) {
			try {
				$value = $provider->resolve( $field, $post );
			} catch ( \Throwable $e ) {
				$value = null;
			}
		}

		// A provider that vanished after the mapping was made — ACF
		// deactivated, JetEngine removed — must not take the advertisement
		// with it. The data is still in the meta table.
		if ( null === $value && '' !== $field->storage_key() ) {
			$fallback = get_post_meta( $post->ID, $field->storage_key(), true );

			if ( '' !== $fallback && null !== $fallback && array() !== $fallback ) {
				$value = maybe_unserialize( $fallback );
			}
		}

		$this->cache[ $key ] = $value;

		return $value;
	}

	/**
	 * Produces the structured value that travels in the payload.
	 *
	 * Scalars stay scalars, lists stay lists and taxonomies keep their
	 * hierarchy, so a consumer can render whatever it likes.
	 *
	 * @since 1.4.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Post to read it from.
	 *
	 * @return mixed Structured value, null when absent.
	 */
	public function value( Field $field, WP_Post $post ): mixed {
		$raw = $this->raw( $field, $post );

		if ( null === $raw ) {
			return null;
		}

		switch ( $field->type() ) {
			case Field::TYPE_TAXONOMY:
				return $this->taxonomy_value( $field, $raw );

			case Field::TYPE_IMAGE:
				$urls = $this->image_urls( $raw );

				return $urls[0] ?? null;

			case Field::TYPE_GALLERY:
				$urls = $this->image_urls( $raw );

				return empty( $urls ) ? null : $this->cap_images( $urls );

			case Field::TYPE_BOOLEAN:
				return $this->to_bool( $raw );

			case Field::TYPE_NUMBER:
				$scalar = $this->first_scalar( $raw );

				return is_numeric( $scalar ) ? ( 0 === (int) $scalar - (float) $scalar ? (int) $scalar : (float) $scalar ) : $scalar;

			case Field::TYPE_REPEATER:
				return $this->repeater_value( $field, $raw );

			case Field::TYPE_CHECKBOX:
				return array_values( array_map( fn( $item ) => $field->choice_label( (string) $item ), $this->to_list( $raw ) ) );
		}

		if ( is_array( $raw ) ) {
			$list = array_map( fn( $item ) => $field->choice_label( (string) $item ), $this->to_list( $raw ) );

			if ( empty( $list ) ) {
				return null;
			}

			return $field->is_repeatable() || count( $list ) > 1 ? array_values( $list ) : $list[0];
		}

		return $field->choice_label( (string) $raw );
	}

	/**
	 * Produces the string a Telegram message shows.
	 *
	 * @since 1.4.0
	 *
	 * @param Field               $field   Field to read.
	 * @param WP_Post             $post    Post to read it from.
	 * @param array<string,mixed> $options Formatting options: `format`,
	 *                                     `separator`, `taxonomy_part`.
	 *
	 * @return string Formatted text, empty when the field has no value.
	 */
	public function text( Field $field, WP_Post $post, array $options = array() ): string {
		$value = $this->value( $field, $post );

		if ( null === $value ) {
			return '';
		}

		$format    = (string) ( $options['format'] ?? self::FORMAT_INLINE );
		$separator = (string) ( $options['separator'] ?? '، ' );

		if ( is_bool( $value ) ) {
			return $value ? __( 'Yes', 'wp-event-publisher' ) : __( 'No', 'wp-event-publisher' );
		}

		if ( is_scalar( $value ) ) {
			return trim( (string) $value );
		}

		if ( ! is_array( $value ) ) {
			return '';
		}

		return $this->format_list( $this->stringify( $value, $field, (string) ( $options['taxonomy_part'] ?? '' ) ), $format, $separator );
	}

	/**
	 * Flattens a structured value into display strings.
	 *
	 * @since 1.4.0
	 *
	 * @param array<int|string,mixed> $value         Structured value.
	 * @param Field                   $field         Source field.
	 * @param string                  $taxonomy_part Which part of a term to show.
	 *
	 * @return string[] Display strings.
	 */
	private function stringify( array $value, Field $field, string $taxonomy_part = '' ): array {
		$out = array();

		foreach ( $value as $item ) {
			if ( is_scalar( $item ) ) {
				$text = trim( (string) $item );

				if ( '' !== $text ) {
					$out[] = $text;
				}

				continue;
			}

			if ( ! is_array( $item ) ) {
				continue;
			}

			// A taxonomy term descriptor.
			if ( isset( $item['name'], $item['slug'] ) ) {
				$out[] = $this->term_text( $item, $taxonomy_part );

				continue;
			}

			// A repeater row: label the columns so the line reads.
			$parts = array();

			foreach ( $item as $column => $cell ) {
				if ( is_scalar( $cell ) && '' !== trim( (string) $cell ) ) {
					$parts[] = trim( (string) $cell );
				} elseif ( is_array( $cell ) ) {
					$nested = $this->stringify( $cell, $field, $taxonomy_part );

					if ( ! empty( $nested ) ) {
						$parts[] = implode( '، ', $nested );
					}
				}

				unset( $column );
			}

			if ( ! empty( $parts ) ) {
				$out[] = implode( ' — ', $parts );
			}
		}

		return $out;
	}

	/**
	 * Renders one term descriptor as text.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $term Term descriptor.
	 * @param string              $part Requested part: name, slug, path, parent.
	 *
	 * @return string Term text.
	 */
	private function term_text( array $term, string $part = '' ): string {
		switch ( $part ) {
			case 'slug':
				return (string) ( $term['slug'] ?? '' );

			case 'path':
				$path = (array) ( $term['path'] ?? array() );

				return implode( ' › ', array_map( 'strval', $path ) );

			case 'parent':
				$parent = $term['parent'] ?? null;

				return is_array( $parent ) ? (string) ( $parent['name'] ?? '' ) : '';

			case 'children':
				$children = (array) ( $term['children'] ?? array() );

				return implode( '، ', array_map( static fn( $child ) => (string) ( $child['name'] ?? '' ), $children ) );
		}

		return (string) ( $term['name'] ?? '' );
	}

	/**
	 * Joins a list of strings according to the chosen format.
	 *
	 * @since 1.4.0
	 *
	 * @param string[] $items     Display strings.
	 * @param string   $format    One of the FORMAT_* constants.
	 * @param string   $separator Separator for the inline format.
	 *
	 * @return string Formatted list.
	 */
	public function format_list( array $items, string $format = self::FORMAT_INLINE, string $separator = '، ' ): string {
		$items = array_values( array_filter( array_map( 'trim', $items ), static fn( $item ): bool => '' !== $item ) );

		if ( empty( $items ) ) {
			return '';
		}

		switch ( $format ) {
			case self::FORMAT_BULLETS:
				return implode( "\n", array_map( static fn( $item ): string => '• ' . $item, $items ) );

			case self::FORMAT_NUMBERED:
				$lines = array();

				foreach ( $items as $index => $item ) {
					$lines[] = number_format_i18n( $index + 1 ) . '. ' . $item;
				}

				return implode( "\n", $lines );

			case self::FORMAT_LINES:
				return implode( "\n", $items );
		}

		return implode( '' === $separator ? '، ' : $separator, $items );
	}

	/**
	 * Builds the structured value of a taxonomy field.
	 *
	 * @since 1.4.0
	 *
	 * @param Field $field Taxonomy field.
	 * @param mixed $raw   Raw provider value.
	 *
	 * @return mixed Term descriptors, or null.
	 */
	private function taxonomy_value( Field $field, mixed $raw ): mixed {
		if ( ! is_array( $raw ) ) {
			return null;
		}

		// A framework taxonomy field returns term IDs, not descriptors.
		if ( ! isset( $raw[0] ) || ! is_array( $raw[0] ) ) {
			$taxonomy = (string) $field->meta( 'taxonomy', '' );
			$terms    = array();

			foreach ( $this->to_list( $raw ) as $item ) {
				$term = is_numeric( $item ) && '' !== $taxonomy
					? get_term( (int) $item, $taxonomy )
					: null;

				$terms[] = $term instanceof \WP_Term
					? array(
						'id'   => (int) $term->term_id,
						'name' => (string) $term->name,
						'slug' => (string) $term->slug,
					)
					: array(
						'id'   => 0,
						'name' => (string) $item,
						'slug' => '',
					);
			}

			return empty( $terms ) ? null : $terms;
		}

		return $raw;
	}

	/**
	 * Builds the structured value of a repeater.
	 *
	 * Rows keep their column names, and nested repeaters keep their shape,
	 * so `fields.features` is a list a consumer can iterate rather than a
	 * pre-joined string.
	 *
	 * @since 1.4.0
	 *
	 * @param Field $field Repeater field.
	 * @param mixed $raw   Raw provider value.
	 *
	 * @return array<int,mixed>|null Rows, or null when empty.
	 */
	private function repeater_value( Field $field, mixed $raw ): ?array {
		$raw = maybe_unserialize( $raw );

		if ( ! is_array( $raw ) ) {
			$text = trim( (string) $raw );

			return '' === $text ? null : array( $field->choice_label( $text ) );
		}

		$children = $field->children();
		$rows     = array();

		foreach ( $raw as $row ) {
			if ( is_scalar( $row ) ) {
				$text = trim( (string) $row );

				if ( '' !== $text ) {
					$rows[] = $field->choice_label( $text );
				}

				continue;
			}

			if ( ! is_array( $row ) ) {
				continue;
			}

			$columns = array();

			foreach ( $row as $name => $cell ) {
				$name  = (string) $name;
				$child = $children[ Field::sanitize_key( $name ) ] ?? null;

				if ( is_array( $cell ) ) {
					$nested = array_values( array_filter( array_map( 'strval', $this->to_list( $cell ) ), static fn( $v ): bool => '' !== $v ) );

					if ( ! empty( $nested ) ) {
						$columns[ $name ] = $nested;
					}

					continue;
				}

				$text = trim( (string) $cell );

				if ( '' === $text ) {
					continue;
				}

				$columns[ $name ] = $child instanceof Field ? $child->choice_label( $text ) : $text;
			}

			if ( ! empty( $columns ) ) {
				$rows[] = $columns;
			}
		}

		return empty( $rows ) ? null : $rows;
	}

	/**
	 * Converts an image field value into absolute URLs.
	 *
	 * Handles every shape the frameworks use: an attachment ID, a list of
	 * IDs, a URL, a list of URLs, an ACF attachment array, and a comma
	 * separated ID list.
	 *
	 * @since 1.4.0
	 *
	 * @param mixed $raw Raw value.
	 *
	 * @return string[] Absolute URLs.
	 */
	private function image_urls( mixed $raw ): array {
		$urls = array();

		foreach ( $this->to_list( $raw ) as $item ) {
			if ( is_array( $item ) ) {
				// ACF returns attachment arrays when the return format asks.
				$candidate = $item['url'] ?? ( $item['ID'] ?? ( $item['id'] ?? null ) );

				if ( null !== $candidate ) {
					$urls = array_merge( $urls, $this->image_urls( $candidate ) );
				}

				continue;
			}

			$value = trim( (string) $item );

			if ( '' === $value ) {
				continue;
			}

			if ( is_numeric( $value ) ) {
				$url = wp_get_attachment_url( (int) $value );

				if ( is_string( $url ) && '' !== $url ) {
					$urls[] = $url;
				}

				continue;
			}

			if ( preg_match( '/^[\d,\s]+$/', $value ) ) {
				foreach ( wp_parse_id_list( $value ) as $id ) {
					$url = wp_get_attachment_url( (int) $id );

					if ( is_string( $url ) && '' !== $url ) {
						$urls[] = $url;
					}
				}

				continue;
			}

			$urls[] = $value;
		}

		$absolute = array();

		foreach ( $urls as $url ) {
			$clean = $this->absolute( (string) $url );

			if ( '' !== $clean ) {
				$absolute[] = $clean;
			}
		}

		return array_values( array_unique( $absolute ) );
	}

	/**
	 * Applies the maximum image count.
	 *
	 * @since 1.4.0
	 *
	 * @param string[] $urls Image URLs.
	 *
	 * @return string[] Capped list.
	 */
	private function cap_images( array $urls ): array {
		$max = (int) $this->settings->get( 'max_images', 10 );

		return $max > 0 && count( $urls ) > $max ? array_slice( $urls, 0, $max ) : $urls;
	}

	/**
	 * Makes a URL absolute and HTTPS where the site allows it.
	 *
	 * @since 1.4.0
	 *
	 * @param string $url Raw URL.
	 *
	 * @return string Absolute URL, empty when unusable.
	 */
	private function absolute( string $url ): string {
		$url = trim( $url );

		if ( '' === $url ) {
			return '';
		}

		if ( str_starts_with( $url, '//' ) ) {
			$url = ( is_ssl() ? 'https:' : 'http:' ) . $url;
		} elseif ( str_starts_with( $url, '/' ) ) {
			$url = home_url( $url );
		} elseif ( ! preg_match( '#^https?://#i', $url ) ) {
			return '';
		}

		if ( str_starts_with( (string) home_url(), 'https://' ) ) {
			$url = set_url_scheme( $url, 'https' );
		}

		return esc_url_raw( $url );
	}

	/**
	 * Normalizes any value into a flat list.
	 *
	 * @since 1.4.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return array<int,mixed> List of items.
	 */
	private function to_list( mixed $value ): array {
		$value = maybe_unserialize( $value );

		if ( null === $value || '' === $value ) {
			return array();
		}

		if ( ! is_array( $value ) ) {
			return array( $value );
		}

		return array_values( $value );
	}

	/**
	 * Returns the first usable scalar inside any value shape.
	 *
	 * @since 1.4.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return string First scalar, empty when there is none.
	 */
	private function first_scalar( mixed $value ): string {
		foreach ( $this->to_list( $value ) as $item ) {
			if ( is_scalar( $item ) && '' !== trim( (string) $item ) ) {
				return trim( (string) $item );
			}

			if ( is_array( $item ) ) {
				$nested = $this->first_scalar( $item );

				if ( '' !== $nested ) {
					return $nested;
				}
			}
		}

		return '';
	}

	/**
	 * Interprets a stored value as a boolean.
	 *
	 * @since 1.4.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return bool Interpreted boolean.
	 */
	private function to_bool( mixed $value ): bool {
		$scalar = strtolower( $this->first_scalar( $value ) );

		return ! in_array( $scalar, array( '', '0', 'false', 'no', 'off', 'null' ), true );
	}

	/**
	 * Clears the per-request value cache.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function reset(): void {
		$this->cache = array();
	}
}
