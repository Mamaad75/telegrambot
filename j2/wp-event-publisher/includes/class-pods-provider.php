<?php
/**
 * Pods provider.
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
 * Reads field definitions from Pods, when it is present.
 *
 * Pods exposes a pod's fields through `pods_api()->load_pod()`. Never a
 * dependency; unavailable means zero fields.
 *
 * @since 1.4.0
 */
class PodsProvider extends BaseProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'pods';

	/**
	 * Pods field type to plugin field type.
	 *
	 * @var array<string,string>
	 */
	private const TYPE_MAP = array(
		'text'      => Field::TYPE_TEXT,
		'paragraph' => Field::TYPE_TEXTAREA,
		'wysiwyg'   => Field::TYPE_HTML,
		'number'    => Field::TYPE_NUMBER,
		'currency'  => Field::TYPE_NUMBER,
		'email'     => Field::TYPE_EMAIL,
		'website'   => Field::TYPE_URL,
		'phone'     => Field::TYPE_TEXT,
		'password'  => Field::TYPE_TEXT,
		'boolean'   => Field::TYPE_BOOLEAN,
		'pick'      => Field::TYPE_SELECT,
		'date'      => Field::TYPE_DATE,
		'datetime'  => Field::TYPE_DATE,
		'time'      => Field::TYPE_DATE,
		'file'      => Field::TYPE_FILE,
		'avatar'    => Field::TYPE_IMAGE,
		'oembed'    => Field::TYPE_URL,
		'color'     => Field::TYPE_TEXT,
		'code'      => Field::TYPE_TEXTAREA,
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
		return __( 'Pods', 'wp-event-publisher' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @return bool True when Pods is active.
	 */
	public function is_available(): bool {
		return function_exists( 'pods_api' );
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
		if ( ! $this->is_available() ) {
			return array();
		}

		try {
			$pod = pods_api()->load_pod( array( 'name' => $post_type ) );
		} catch ( \Throwable $e ) {
			return array();
		}

		$definitions = array();

		if ( is_array( $pod ) && ! empty( $pod['fields'] ) && is_array( $pod['fields'] ) ) {
			$definitions = $pod['fields'];
		} elseif ( is_object( $pod ) && method_exists( $pod, 'get_fields' ) ) {
			try {
				$definitions = (array) $pod->get_fields();
			} catch ( \Throwable $e ) {
				return array();
			}
		}

		$fields = array();

		foreach ( $definitions as $name => $definition ) {
			$field = $this->convert( (string) $name, $definition );

			if ( $field instanceof Field ) {
				$fields[] = $field;
			}
		}

		return $fields;
	}

	/**
	 * Converts one Pods definition into a plugin field.
	 *
	 * @since 1.4.0
	 *
	 * @param string $name       Field name.
	 * @param mixed  $definition Pods field definition, array or object.
	 *
	 * @return Field|null Field, or null when the definition is unusable.
	 */
	private function convert( string $name, mixed $definition ): ?Field {
		$data = array();

		if ( is_array( $definition ) ) {
			$data = $definition;
		} elseif ( is_object( $definition ) ) {
			// Pods\Whatsit\Field implements ArrayAccess in current versions;
			// older ones expose plain properties.
			foreach ( array( 'name', 'label', 'type', 'required', 'pick_object' ) as $key ) {
				if ( isset( $definition->$key ) ) {
					$data[ $key ] = $definition->$key;
				}
			}
		}

		$key = (string) ( $data['name'] ?? $name );

		if ( '' === $key ) {
			return null;
		}

		$pods_type = (string) ( $data['type'] ?? 'text' );

		return new Field(
			array(
				'key'         => $key,
				'label'       => (string) ( $data['label'] ?? $this->humanize( $key ) ),
				'storage_key' => $key,
				'source'      => self::ID,
				'type'        => self::TYPE_MAP[ $pods_type ] ?? $this->guess_type( $key ),
				'repeatable'  => 'pick' === $pods_type && ! empty( $data['pick_format_type'] ) && 'multi' === $data['pick_format_type'],
				'required'    => ! empty( $data['required'] ),
				'meta'        => array( 'pods_type' => $pods_type ),
			)
		);
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
		if ( function_exists( 'pods' ) ) {
			try {
				$pod = pods( $post->post_type, $post->ID );

				if ( is_object( $pod ) && method_exists( $pod, 'field' ) ) {
					$value = $pod->field( $field->storage_key() );

					if ( null !== $value && '' !== $value && array() !== $value ) {
						return $value;
					}
				}
			} catch ( \Throwable $e ) {
				unset( $e );
			}
		}

		return $this->meta( (int) $post->ID, $field->storage_key() );
	}
}
