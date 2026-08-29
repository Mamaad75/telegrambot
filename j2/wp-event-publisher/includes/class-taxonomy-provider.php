<?php
/**
 * Taxonomy fields.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;
use WP_Term;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Every taxonomy registered for a post type.
 *
 * A hierarchical taxonomy also produces the derived fields a classifieds
 * site actually wants — the top-level category, the deepest term, and the
 * full path — so a template can print "Cars → SUV" without the site having
 * to store that anywhere.
 *
 * @since 1.4.0
 */
class TaxonomyProvider extends BaseProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'taxonomy';

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
		return __( 'Taxonomies', 'wp-event-publisher' );
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
	 * @return Field[] Taxonomy fields.
	 */
	public function discover( string $post_type ): array {
		$fields = array();

		foreach ( get_object_taxonomies( $post_type, 'objects' ) as $taxonomy ) {
			if ( ! $taxonomy instanceof \WP_Taxonomy ) {
				continue;
			}

			$name  = (string) $taxonomy->name;
			$label = $taxonomy->labels->singular_name ?? $name;

			$fields[] = new Field(
				array(
					'key'         => 'tax_' . $name,
					'label'       => (string) $label,
					'storage_key' => $name,
					'source'      => self::ID,
					'type'        => Field::TYPE_TAXONOMY,
					'repeatable'  => true,
					'meta'        => array(
						'taxonomy'     => $name,
						'hierarchical' => (bool) $taxonomy->hierarchical,
						'part'         => 'names',
					),
				)
			);

			if ( ! $taxonomy->hierarchical ) {
				continue;
			}

			// The parts a hierarchical taxonomy makes possible. They are the
			// reason "Cars" and "Cars → SUV" can be different placeholders.
			$parts = array(
				'top'  => __( '%s — top level', 'wp-event-publisher' ),
				'leaf' => __( '%s — deepest term', 'wp-event-publisher' ),
				'path' => __( '%s — full path', 'wp-event-publisher' ),
			);

			foreach ( $parts as $part => $pattern ) {
				$fields[] = new Field(
					array(
						'key'         => 'tax_' . $name . '_' . $part,
						/* translators: %s: taxonomy name. */
						'label'       => sprintf( $pattern, (string) $label ),
						'storage_key' => $name,
						'source'      => self::ID,
						'type'        => Field::TYPE_TAXONOMY,
						'repeatable'  => 'path' !== $part,
						'meta'        => array(
							'taxonomy'     => $name,
							'hierarchical' => true,
							'part'         => $part,
						),
					)
				);
			}
		}

		return $fields;
	}

	/**
	 * {@inheritDoc}
	 *
	 * Returns a list of term descriptors. {@see FieldResolver} decides
	 * whether the payload carries names, slugs or the whole structure.
	 *
	 * @since 1.4.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Post to read it from.
	 *
	 * @return mixed List of term arrays, or null when the post has none.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed {
		$taxonomy = (string) $field->meta( 'taxonomy', $field->storage_key() );
		$terms    = get_the_terms( $post, $taxonomy );

		if ( ! is_array( $terms ) || empty( $terms ) ) {
			return null;
		}

		$part = (string) $field->meta( 'part', 'names' );

		if ( 'path' === $part ) {
			$deepest = $this->deepest( $terms );

			return null === $deepest ? null : array( $this->describe( $deepest, $taxonomy ) );
		}

		if ( 'leaf' === $part ) {
			$deepest = $this->deepest( $terms );

			return null === $deepest ? null : array( $this->describe( $deepest, $taxonomy ) );
		}

		if ( 'top' === $part ) {
			$deepest = $this->deepest( $terms );

			if ( null === $deepest ) {
				return null;
			}

			$ancestors = get_ancestors( (int) $deepest->term_id, $taxonomy, 'taxonomy' );
			$top_id    = empty( $ancestors ) ? (int) $deepest->term_id : (int) end( $ancestors );
			$top       = get_term( $top_id, $taxonomy );

			return $top instanceof WP_Term ? array( $this->describe( $top, $taxonomy ) ) : null;
		}

		$described = array();

		foreach ( $terms as $term ) {
			if ( $term instanceof WP_Term ) {
				$described[] = $this->describe( $term, $taxonomy );
			}
		}

		return empty( $described ) ? null : $described;
	}

	/**
	 * Returns the most deeply nested of a post's terms.
	 *
	 * A post filed under "Cars" and "Cars → SUV" is really an SUV; the
	 * parent is implied. Depth is measured by ancestor count.
	 *
	 * @since 1.4.0
	 *
	 * @param array<int,mixed> $terms Terms assigned to the post.
	 *
	 * @return WP_Term|null Deepest term, null when the list is empty.
	 */
	public function deepest( array $terms ): ?WP_Term {
		$best  = null;
		$depth = -1;

		foreach ( $terms as $term ) {
			if ( ! $term instanceof WP_Term ) {
				continue;
			}

			$current = count( get_ancestors( (int) $term->term_id, (string) $term->taxonomy, 'taxonomy' ) );

			if ( $current > $depth ) {
				$depth = $current;
				$best  = $term;
			}
		}

		return $best;
	}

	/**
	 * Describes one term, including its ancestry and children.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Term $term     Term object.
	 * @param string  $taxonomy Taxonomy name.
	 *
	 * @return array<string,mixed> Term descriptor.
	 */
	private function describe( WP_Term $term, string $taxonomy ): array {
		$ancestor_ids = get_ancestors( (int) $term->term_id, $taxonomy, 'taxonomy' );
		$ancestors    = array();

		// get_ancestors() returns closest first; a readable path reads from
		// the root down.
		foreach ( array_reverse( (array) $ancestor_ids ) as $ancestor_id ) {
			$ancestor = get_term( (int) $ancestor_id, $taxonomy );

			if ( $ancestor instanceof WP_Term ) {
				$ancestors[] = array(
					'id'   => (int) $ancestor->term_id,
					'name' => (string) $ancestor->name,
					'slug' => (string) $ancestor->slug,
				);
			}
		}

		$children = array();

		foreach ( (array) get_term_children( (int) $term->term_id, $taxonomy ) as $child_id ) {
			$child = get_term( (int) $child_id, $taxonomy );

			if ( $child instanceof WP_Term ) {
				$children[] = array(
					'id'   => (int) $child->term_id,
					'name' => (string) $child->name,
					'slug' => (string) $child->slug,
				);
			}
		}

		$path = array_merge( array_column( $ancestors, 'name' ), array( (string) $term->name ) );

		$parent = null;

		if ( ! empty( $ancestors ) ) {
			$parent = $ancestors[ count( $ancestors ) - 1 ];
		}

		return array(
			'id'        => (int) $term->term_id,
			'name'      => (string) $term->name,
			'slug'      => (string) $term->slug,
			'taxonomy'  => $taxonomy,
			'parent'    => $parent,
			'ancestors' => $ancestors,
			'children'  => $children,
			'path'      => $path,
			'depth'     => count( $ancestors ),
		);
	}
}
