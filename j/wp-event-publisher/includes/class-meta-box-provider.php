<?php
/**
 * Meta Box provider.
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
 * Reads field definitions from Meta Box, when it is present.
 *
 * Meta Box registers its boxes through the `rwmb_meta_boxes` filter, which
 * is the documented and stable way to read them back. Cloneable fields are
 * reported as repeatable so the resolver formats them as a list.
 *
 * Never a dependency; unavailable means zero fields, not an error.
 *
 * @since 1.4.0
 */
class MetaBoxProvider extends BaseProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'metabox';

	/**
	 * Meta Box field type to plugin field type.
	 *
	 * @var array<string,string>
	 */
	private const TYPE_MAP = array(
		'text'            => Field::TYPE_TEXT,
		'textarea'        => Field::TYPE_TEXTAREA,
		'wysiwyg'         => Field::TYPE_HTML,
		'number'          => Field::TYPE_NUMBER,
		'range'           => Field::TYPE_NUMBER,
		'slider'          => Field::TYPE_NUMBER,
		'email'           => Field::TYPE_EMAIL,
		'url'             => Field::TYPE_URL,
		'oembed'          => Field::TYPE_URL,
		'select'          => Field::TYPE_SELECT,
		'select_advanced' => Field::TYPE_SELECT,
		'radio'           => Field::TYPE_SELECT,
		'button_group'    => Field::TYPE_SELECT,
		'checkbox'        => Field::TYPE_BOOLEAN,
		'checkbox_list'   => Field::TYPE_CHECKBOX,
		'switch'          => Field::TYPE_BOOLEAN,
		'date'            => Field::TYPE_DATE,
		'datetime'        => Field::TYPE_DATE,
		'time'            => Field::TYPE_DATE,
		'image'           => Field::TYPE_IMAGE,
		'image_advanced'  => Field::TYPE_GALLERY,
		'image_upload'    => Field::TYPE_GALLERY,
		'single_image'    => Field::TYPE_IMAGE,
		'file'            => Field::TYPE_FILE,
		'file_advanced'   => Field::TYPE_FILE,
		'file_upload'     => Field::TYPE_FILE,
		'taxonomy'        => Field::TYPE_TAXONOMY,
		'post'            => Field::TYPE_POST,
		'user'            => Field::TYPE_USER,
		'group'           => Field::TYPE_REPEATER,
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
		return __( 'Meta Box', 'wp-event-publisher' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.4.0
	 *
	 * @return bool True when Meta Box is active.
	 */
	public function is_available(): bool {
		return class_exists( 'RWMB_Loader' ) || function_exists( 'rwmb_meta' );
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
			$boxes = apply_filters( 'rwmb_meta_boxes', array() );
		} catch ( \Throwable $e ) {
			return array();
		}

		if ( ! is_array( $boxes ) ) {
			return array();
		}

		$fields = array();

		foreach ( $boxes as $box ) {
			if ( ! is_array( $box ) || empty( $box['fields'] ) || ! is_array( $box['fields'] ) ) {
				continue;
			}

			$types = (array) ( $box['post_types'] ?? $box['post_type'] ?? array( 'post' ) );

			if ( ! in_array( $post_type, array_map( 'strval', $types ), true ) ) {
				continue;
			}

			foreach ( $box['fields'] as $definition ) {
				$field = $this->convert( (array) $definition );

				if ( $field instanceof Field ) {
					$fields[] = $field;
				}
			}
		}

		return $fields;
	}

	/**
	 * Converts one Meta Box definition into a plugin field.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $definition Meta Box field definition.
	 *
	 * @return Field|null Field, or null when the definition is unusable.
	 */
	private function convert( array $definition ): ?Field {
		$id = (string) ( $definition['id'] ?? '' );

		if ( '' === $id ) {
			return null;
		}

		$box_type = (string) ( $definition['type'] ?? 'text' );

		if ( in_array( $box_type, array( 'heading', 'divider', 'custom_html' ), true ) ) {
			return null;
		}

		$children = array();

		foreach ( (array) ( $definition['fields'] ?? array() ) as $sub ) {
			$child = $this->convert( (array) $sub );

			if ( $child instanceof Field ) {
				$children[] = $child;
			}
		}

		// `clone` is Meta Box's repeater: any field type becomes a list.
		$cloneable = ! empty( $definition['clone'] ) || ! empty( $definition['multiple'] );

		return new Field(
			array(
				'key'         => $id,
				'label'       => (string) ( $definition['name'] ?? $this->humanize( $id ) ),
				'storage_key' => $id,
				'source'      => self::ID,
				'type'        => self::TYPE_MAP[ $box_type ] ?? $this->guess_type( $id ),
				'repeatable'  => $cloneable || 'group' === $box_type || 'checkbox_list' === $box_type || 'image_advanced' === $box_type,
				'required'    => ! empty( $definition['required'] ),
				'choices'     => (array) ( $definition['options'] ?? array() ),
				'children'    => $children,
				'meta'        => array(
					'metabox_type' => $box_type,
					'clone'        => $cloneable,
					'taxonomy'     => (string) ( $definition['taxonomy'] ?? '' ),
				),
			)
		);
	}

	/**
	 * {@inheritDoc}
	 *
	 * Prefers `rwmb_meta()`, which understands cloned and grouped storage,
	 * and falls back to the meta table when Meta Box is gone.
	 *
	 * @since 1.4.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Post to read it from.
	 *
	 * @return mixed Raw value.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed {
		if ( function_exists( 'rwmb_meta' ) ) {
			try {
				$value = rwmb_meta( $field->storage_key(), array(), $post->ID );

				if ( null !== $value && '' !== $value && array() !== $value ) {
					return $value;
				}
			} catch ( \Throwable $e ) {
				unset( $e );
			}
		}

		return $this->meta( (int) $post->ID, $field->storage_key() );
	}
}
