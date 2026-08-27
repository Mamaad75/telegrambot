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

		try {
			$engine = jet_engine();

			if ( ! is_object( $engine ) || ! isset( $engine->meta_boxes ) || ! is_object( $engine->meta_boxes ) ) {
				return array();
			}

			$boxes = $engine->meta_boxes;

			if ( method_exists( $boxes, 'get_registered_fields' ) ) {
				$registered = $boxes->get_registered_fields();

				if ( isset( $registered[ $post_type ] ) && is_array( $registered[ $post_type ] ) ) {
					return array_values( $registered[ $post_type ] );
				}

				return array();
			}

			if ( method_exists( $boxes, 'get_meta_fields_for_object' ) ) {
				$found = $boxes->get_meta_fields_for_object( 'post/' . $post_type );

				return is_array( $found ) ? array_values( $found ) : array();
			}
		} catch ( \Throwable $e ) {
			return array();
		}

		return array();
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
