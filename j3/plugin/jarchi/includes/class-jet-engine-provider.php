<?php
/**
 * JetEngine provider.
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
 * Reads meta box definitions from JetEngine, when it is present.
 *
 * JetEngine is one provider among several and never a dependency. On a site
 * without it this class reports itself unavailable and the rest of the
 * plugin behaves exactly as if the file did not exist — the meta provider
 * still finds the same keys, just with generated labels instead of the ones
 * JetEngine stores.
 *
 * @since 1.4.0
 */
class JetEngineProvider extends BaseProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'jetengine';

	/**
	 * JetEngine field type to plugin field type.
	 *
	 * @var array<string,string>
	 */
	private const TYPE_MAP = array(
		'text'        => Field::TYPE_TEXT,
		'textarea'    => Field::TYPE_TEXTAREA,
		'wysiwyg'     => Field::TYPE_HTML,
		'number'      => Field::TYPE_NUMBER,
		'switcher'    => Field::TYPE_BOOLEAN,
		'checkbox'    => Field::TYPE_CHECKBOX,
		'iconpicker'  => Field::TYPE_TEXT,
		'select'      => Field::TYPE_SELECT,
		'radio'       => Field::TYPE_SELECT,
		'media'       => Field::TYPE_IMAGE,
		'gallery'     => Field::TYPE_GALLERY,
		'date'        => Field::TYPE_DATE,
		'time'        => Field::TYPE_DATE,
		'datetime'    => Field::TYPE_DATE,
		'colorpicker' => Field::TYPE_TEXT,
		'repeater'    => Field::TYPE_REPEATER,
		'posts'       => Field::TYPE_POST,
	);

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
		return __( 'JetEngine', 'wp-event-publisher' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @return bool True when JetEngine is active.
	 */
	public function is_available(): bool {
		return function_exists( 'jet_engine' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return Field[] Discovered fields.
	 */
	public function discover( string $post_type ): array {
		$fields = array();

		foreach ( $this->raw_definitions( $post_type ) as $definition ) {
			$field = $this->convert( (array) $definition );

			if ( $field instanceof Field ) {
				$fields[] = $field;
			}
		}

		return $fields;
	}

	/**
	 * Reads JetEngine's meta box definitions for a post type.
	 *
	 * JetEngine has moved this API between releases, so every access is
	 * defensive: an unexpected shape yields no fields rather than a fatal.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return array<int,array<string,mixed>> Raw field definitions.
	 */
	private function raw_definitions( string $post_type ): array {
		if ( ! $this->is_available() ) {
			return array();
		}

		$found = array();

		try {
			$engine = jet_engine();

			if ( is_object( $engine ) && isset( $engine->meta_boxes ) && is_object( $engine->meta_boxes ) ) {
				$boxes = $engine->meta_boxes;

				if ( method_exists( $boxes, 'get_registered_fields' ) ) {
					$registered = $boxes->get_registered_fields();
					if ( isset( $registered[ $post_type ] ) && is_array( $registered[ $post_type ] ) ) {
						$found = array_values( $registered[ $post_type ] );
					}
				}

				if ( empty( $found ) && method_exists( $boxes, 'get_meta_fields_for_object' ) ) {
					$runtime = $boxes->get_meta_fields_for_object( 'post/' . $post_type );
					if ( is_array( $runtime ) ) {
						$found = array_values( $runtime );
					}
				}
			}
		} catch ( \Throwable $e ) {
			// Fall through to JetEngine's persisted definitions.
		}

		if ( $found ) {
			return $this->dedupe_definitions( $found );
		}

		// JetEngine has changed the runtime meta-box API multiple times. Its
		// persistent option is much more stable, so use it as a final fallback
		// instead of showing an empty field screen.
		$stored = get_option( 'jet_engine_meta_boxes', array() );
		if ( ! is_array( $stored ) ) {
			return array();
		}

		$definitions = array();

		foreach ( $stored as $box ) {
			if ( ! is_array( $box ) || ! $this->box_matches_post_type( $box, $post_type ) ) {
				continue;
			}

			$this->collect_field_definitions( $box, $definitions );
		}

		return $this->dedupe_definitions( $definitions );
	}

	/**
	 * Whether a persisted JetEngine meta box targets this post type.
	 */
	private function box_matches_post_type( array $box, string $post_type ): bool {
		$keys = array(
			'post_type',
			'post_types',
			'allowed_post_type',
			'allowed_post_types',
			'object_sub_type',
			'object_sub_types',
		);

		$haystacks = array( $box );
		if ( isset( $box['args'] ) && is_array( $box['args'] ) ) {
			$haystacks[] = $box['args'];
		}
		if ( isset( $box['meta_box'] ) && is_array( $box['meta_box'] ) ) {
			$haystacks[] = $box['meta_box'];
		}

		$saw_target = false;

		foreach ( $haystacks as $haystack ) {
			foreach ( $keys as $key ) {
				if ( ! array_key_exists( $key, $haystack ) ) {
					continue;
				}

				$saw_target = true;
				$value = $haystack[ $key ];
				$values = is_array( $value ) ? $value : preg_split( '/[\s,|]+/', (string) $value );

				foreach ( (array) $values as $candidate ) {
					$candidate = trim( (string) $candidate );
					if ( $candidate === $post_type || $candidate === 'post/' . $post_type ) {
						return true;
					}
				}
			}
		}

		// Some JetEngine releases store only an object selector.
		$encoded = wp_json_encode( $box );
		if ( is_string( $encoded ) && str_contains( $encoded, 'post/' . $post_type ) ) {
			return true;
		}

		return ! $saw_target && isset( $box['post_type'] ) && (string) $box['post_type'] === $post_type;
	}

	/**
	 * Recursively finds JetEngine field-like arrays.
	 *
	 * The recursion is intentionally shape-based: field containers have
	 * changed names between JetEngine releases, but an actual field still has
	 * a name plus a type/title.
	 *
	 * @param array<string,mixed>              $node Node.
	 * @param array<int,array<string,mixed>>   $out  Collected definitions.
	 */
	private function collect_field_definitions( array $node, array &$out ): void {
		if (
			isset( $node['name'] )
			&& is_scalar( $node['name'] )
			&& '' !== trim( (string) $node['name'] )
			&& ( isset( $node['type'] ) || isset( $node['title'] ) )
		) {
			$out[] = $node;
		}

		foreach ( $node as $value ) {
			if ( ! is_array( $value ) ) {
				continue;
			}

			if ( array_is_list( $value ) ) {
				foreach ( $value as $child ) {
					if ( is_array( $child ) ) {
						$this->collect_field_definitions( $child, $out );
					}
				}
			} else {
				$this->collect_field_definitions( $value, $out );
			}
		}
	}

	/**
	 * Deduplicates definitions by their actual JetEngine storage name.
	 *
	 * @param array<int,array<string,mixed>> $definitions Definitions.
	 * @return array<int,array<string,mixed>>
	 */
	private function dedupe_definitions( array $definitions ): array {
		$out = array();

		foreach ( $definitions as $definition ) {
			if ( ! is_array( $definition ) ) {
				continue;
			}
			$name = trim( (string) ( $definition['name'] ?? '' ) );
			if ( '' === $name ) {
				continue;
			}
			$out[ $name ] = $definition;
		}

		return array_values( $out );
	}

	/**
	 * Converts one JetEngine definition into a plugin field.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $definition JetEngine field definition.
	 *
	 * @return Field|null Field, or null when the definition is unusable.
	 */
	private function convert( array $definition ): ?Field {
		$name = (string) ( $definition['name'] ?? '' );

		if ( '' === $name ) {
			return null;
		}

		$jet_type = (string) ( $definition['type'] ?? 'text' );

		$children = array();

		foreach ( (array) ( $definition['repeater-fields'] ?? array() ) as $sub ) {
			$child = $this->convert( (array) $sub );

			if ( $child instanceof Field ) {
				$children[] = $child;
			}
		}

		return new Field(
			array(
				'key'         => $name,
				'label'       => (string) ( $definition['title'] ?? $this->humanize( $name ) ),
				'storage_key' => $name,
				'source'      => self::ID,
				'type'        => self::TYPE_MAP[ $jet_type ] ?? $this->guess_type( $name ),
				'repeatable'  => 'repeater' === $jet_type || 'gallery' === $jet_type || 'checkbox' === $jet_type,
				'required'    => ! empty( $definition['is_required'] ),
				'choices'     => $this->choices( $definition ),
				'children'    => $children,
				'meta'        => array( 'jet_type' => $jet_type ),
			)
		);
	}

	/**
	 * Extracts the value/label pairs of a JetEngine choice field.
	 *
	 * JetEngine stores options either as a list of `{value,label}` rows or
	 * as a plain value-keyed map, depending on how they were entered.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $definition Field definition.
	 *
	 * @return array<string,string> Choice map.
	 */
	private function choices( array $definition ): array {
		$options = $definition['options'] ?? array();

		if ( ! is_array( $options ) ) {
			return array();
		}

		$choices = array();

		foreach ( $options as $key => $option ) {
			if ( is_array( $option ) && array_key_exists( 'value', $option ) ) {
				$choices[ (string) $option['value'] ] = (string) ( $option['label'] ?? $option['value'] );
				continue;
			}

			if ( is_scalar( $option ) ) {
				$choices[ (string) $key ] = (string) $option;
			}
		}

		return $choices;
	}

	/**
	 * {@inheritDoc}
	 *
	 * JetEngine stores everything in ordinary post meta, so reading it
	 * needs nothing from JetEngine itself. That is deliberate: an
	 * advertisement still delivers correctly if JetEngine is deactivated
	 * between the moment a field was mapped and the moment it is sent.
	 *
	 * @since 1.4.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Post to read it from.
	 *
	 * @return mixed Raw value.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed {
		return $this->meta( (int) $post->ID, $field->storage_key() );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @return string Signature.
	 */
	public function signature(): string {
		if ( ! $this->is_available() ) {
			return self::ID . ':0';
		}

		$meta_boxes = get_option( 'jet_engine_meta_boxes', array() );

		return self::ID . ':' . md5( (string) wp_json_encode( $meta_boxes ) );
	}
}
