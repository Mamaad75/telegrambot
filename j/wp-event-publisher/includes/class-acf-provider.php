<?php
/**
 * Advanced Custom Fields provider.
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
 * Reads field definitions from Advanced Custom Fields, when it is present.
 *
 * ACF is never required. Every call into it is guarded, so the file loads
 * and the class instantiates on a site that has never heard of ACF; it
 * simply reports itself unavailable and contributes nothing.
 *
 * @since 1.4.0
 */
class AcfProvider extends BaseProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'acf';

	/**
	 * ACF field types that hold several values.
	 *
	 * @var string[]
	 */
	private const REPEATING = array( 'repeater', 'gallery', 'flexible_content', 'group', 'relationship', 'checkbox' );

	/**
	 * ACF field type to plugin field type.
	 *
	 * @var array<string,string>
	 */
	private const TYPE_MAP = array(
		'text'             => Field::TYPE_TEXT,
		'textarea'         => Field::TYPE_TEXTAREA,
		'wysiwyg'          => Field::TYPE_HTML,
		'number'           => Field::TYPE_NUMBER,
		'range'            => Field::TYPE_NUMBER,
		'email'            => Field::TYPE_EMAIL,
		'url'              => Field::TYPE_URL,
		'link'             => Field::TYPE_URL,
		'password'         => Field::TYPE_TEXT,
		'image'            => Field::TYPE_IMAGE,
		'gallery'          => Field::TYPE_GALLERY,
		'file'             => Field::TYPE_FILE,
		'select'           => Field::TYPE_SELECT,
		'checkbox'         => Field::TYPE_CHECKBOX,
		'radio'            => Field::TYPE_SELECT,
		'button_group'     => Field::TYPE_SELECT,
		'true_false'       => Field::TYPE_BOOLEAN,
		'date_picker'      => Field::TYPE_DATE,
		'date_time_picker' => Field::TYPE_DATE,
		'time_picker'      => Field::TYPE_DATE,
		'taxonomy'         => Field::TYPE_TAXONOMY,
		'post_object'      => Field::TYPE_POST,
		'page_link'        => Field::TYPE_URL,
		'relationship'     => Field::TYPE_POST,
		'user'             => Field::TYPE_USER,
		'repeater'         => Field::TYPE_REPEATER,
		'flexible_content' => Field::TYPE_REPEATER,
		'group'            => Field::TYPE_REPEATER,
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
		return __( 'Advanced Custom Fields', 'wp-event-publisher' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @return bool True when ACF is active.
	 */
	public function is_available(): bool {
		return function_exists( 'acf_get_field_groups' ) && function_exists( 'acf_get_fields' );
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
			$groups = acf_get_field_groups( array( 'post_type' => $post_type ) );
		} catch ( \Throwable $e ) {
			return array();
		}

		if ( ! is_array( $groups ) ) {
			return array();
		}

		$fields = array();

		foreach ( $groups as $group ) {
			$key = is_array( $group ) ? ( $group['key'] ?? '' ) : '';

			if ( '' === $key ) {
				continue;
			}

			try {
				$group_fields = acf_get_fields( $key );
			} catch ( \Throwable $e ) {
				continue;
			}

			if ( ! is_array( $group_fields ) ) {
				continue;
			}

			foreach ( $group_fields as $definition ) {
				$field = $this->convert( (array) $definition, is_array( $group ) ? (string) ( $group['title'] ?? '' ) : '' );

				if ( $field instanceof Field ) {
					$fields[] = $field;
				}
			}
		}

		return $fields;
	}

	/**
	 * Converts one ACF definition into a plugin field.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $definition ACF field definition.
	 * @param string              $group      Field group title.
	 *
	 * @return Field|null Field, or null when the definition is unusable.
	 */
	private function convert( array $definition, string $group = '' ): ?Field {
		$name = (string) ( $definition['name'] ?? '' );

		if ( '' === $name ) {
			return null;
		}

		$acf_type = (string) ( $definition['type'] ?? 'text' );

		// Layout-only field types carry no data.
		if ( in_array( $acf_type, array( 'tab', 'message', 'accordion', 'clone' ), true ) ) {
			return null;
		}

		$children = array();

		foreach ( (array) ( $definition['sub_fields'] ?? array() ) as $sub ) {
			$child = $this->convert( (array) $sub );

			if ( $child instanceof Field ) {
				$children[] = $child;
			}
		}

		return new Field(
			array(
				'key'         => $name,
				'label'       => (string) ( $definition['label'] ?? $this->humanize( $name ) ),
				'storage_key' => $name,
				'source'      => self::ID,
				'type'        => self::TYPE_MAP[ $acf_type ] ?? $this->guess_type( $name ),
				'repeatable'  => in_array( $acf_type, self::REPEATING, true ) || ! empty( $definition['multiple'] ),
				'required'    => ! empty( $definition['required'] ),
				'choices'     => (array) ( $definition['choices'] ?? array() ),
				'children'    => $children,
				'meta'        => array(
					'acf_type'  => $acf_type,
					'acf_key'   => (string) ( $definition['key'] ?? '' ),
					'group'     => $group,
					'return'    => (string) ( $definition['return_format'] ?? '' ),
					'taxonomy'  => (string) ( $definition['taxonomy'] ?? '' ),
				),
			)
		);
	}

	/**
	 * {@inheritDoc}
	 *
	 * Uses ACF's own reader when available, because it resolves return
	 * formats, sub-fields and relationships that raw meta does not express.
	 * Falls back to the meta table if ACF disappeared between discovery and
	 * delivery.
	 *
	 * @since 1.4.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Post to read it from.
	 *
	 * @return mixed Raw value.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed {
		if ( function_exists( 'get_field' ) ) {
			try {
				// `false` keeps stored values rather than formatted HTML, so
				// a select yields `diesel` and the choice map still applies.
				$value = get_field( $field->storage_key(), $post->ID, false );

				if ( null !== $value && '' !== $value && array() !== $value ) {
					return $value;
				}
			} catch ( \Throwable $e ) {
				// Fall through to the meta table.
				unset( $e );
			}
		}

		return $this->meta( (int) $post->ID, $field->storage_key() );
	}

	/**
	 * {@inheritDoc}
	 *
	 * Tracks the field groups themselves, so editing a group in the ACF UI
	 * invalidates discovery.
	 *
	 * @since 1.4.0
	 *
	 * @return string Signature.
	 */
	public function signature(): string {
		if ( ! $this->is_available() ) {
			return self::ID . ':0';
		}

		try {
			$groups = acf_get_field_groups();
		} catch ( \Throwable $e ) {
			return self::ID . ':1';
		}

		$parts = array();

		foreach ( (array) $groups as $group ) {
			if ( is_array( $group ) ) {
				$parts[] = (string) ( $group['key'] ?? '' ) . ':' . (string) ( $group['modified'] ?? '' );
			}
		}

		sort( $parts );

		return self::ID . ':' . md5( implode( '|', $parts ) );
	}
}
