<?php
/**
 * Mapped field payload assembly.
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
 * Turns a post plus its effective mapping into the dynamic half of the
 * payload: the `fields` map, the category summary and the rendered
 * message.
 *
 * It is a separate step on purpose. {@see Normalizer} collects what
 * WordPress knows, this class applies what the administrator decided, and
 * {@see Contract} writes the wire format. Keeping them apart is also what
 * avoids a dependency cycle: the image provider needs the normalizer, so
 * the normalizer must not need the registry.
 *
 * @since 1.4.0
 */
class DynamicPayload {

	/**
	 * Field registry.
	 *
	 * @var FieldRegistry
	 */
	private FieldRegistry $registry;

	/**
	 * Field resolver.
	 *
	 * @var FieldResolver
	 */
	private FieldResolver $resolver;

	/**
	 * Mapping store.
	 *
	 * @var FieldMapping
	 */
	private FieldMapping $mapping;

	/**
	 * Message renderer.
	 *
	 * @var MessageTemplate
	 */
	private MessageTemplate $template;

	/**
	 * Constructor.
	 *
	 * @since 1.4.0
	 *
	 * @param FieldRegistry   $registry Field registry.
	 * @param FieldResolver   $resolver Field resolver.
	 * @param FieldMapping    $mapping  Mapping store.
	 * @param MessageTemplate $template Message renderer.
	 */
	public function __construct( FieldRegistry $registry, FieldResolver $resolver, FieldMapping $mapping, MessageTemplate $template ) {
		$this->registry = $registry;
		$this->resolver = $resolver;
		$this->mapping  = $mapping;
		$this->template = $template;
	}

	/**
	 * Adds the mapped fields, the category summary and the message to a
	 * normalized payload.
	 *
	 * Never throws. A field that cannot be read is omitted; the
	 * advertisement is still delivered with everything that could.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $flat Normalized payload.
	 * @param WP_Post             $post Source post.
	 *
	 * @return array<string,mixed> Payload with the dynamic block merged in.
	 */
	public function extend( array $flat, WP_Post $post ): array {
		try {
			$resolution = $this->mapping->for_post( $post );
		} catch ( \Throwable $e ) {
			return $flat;
		}

		$mapping = (array) $resolution['mapping'];
		$term    = $resolution['term'] instanceof WP_Term ? $resolution['term'] : null;

		$described = $this->describe( $post, $mapping );

		$flat['mapped_fields']     = $described['fields'];
		$flat['mapped_field_meta'] = $described['field_meta'];
		$flat['mapped_scope']      = FieldMapping::scope(
			$post->post_type,
			(string) $resolution['taxonomy'],
			$term instanceof WP_Term ? (int) $term->term_id : 0
		);
		$flat['mapped_taxonomy']   = $this->category_summary( (string) $resolution['taxonomy'], $term );

		$explicit_template = $this->mapping->template(
			$post->post_type,
			(string) $resolution['taxonomy'],
			$term instanceof WP_Term ? (int) $term->term_id : 0
		);

		$flat['rendering'] = array(
			'mode' => '' !== trim( (string) $explicit_template ) ? 'custom' : 'structured',
			'title' => array( 'enabled' => true, 'icon' => '', 'bold' => true ),
			'fields' => array( 'enabled' => true, 'showLabels' => true, 'bullet' => '', 'separator' => ': ', 'compact' => false ),
			'category' => array( 'enabled' => true, 'label' => __( 'دسته‌بندی', 'wp-event-publisher' ), 'icon' => '' ),
			'description' => array( 'enabled' => true, 'heading' => false, 'label' => '', 'icon' => '' ),
			'divider' => array( 'enabled' => true, 'character' => '─', 'length' => 28 ),
		);

		try {
			$flat['message'] = $this->template->render( $post );
		} catch ( \Throwable $e ) {
			$flat['message'] = '';
		}

		return $flat;
	}

	/**
	 * Builds the `fields` map.
	 *
	 * Only enabled fields whose visibility transmits them are included, so
	 * disabling a field in the admin genuinely stops sending it rather than
	 * only hiding it from the message.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Post                           $post    Source post.
	 * @param array<string,array<string,mixed>> $mapping Effective mapping.
	 *
	 * @return array<string,mixed> Field key to structured value.
	 */
	public function fields( WP_Post $post, array $mapping ): array {
		return $this->describe( $post, $mapping )['fields'];
	}

	/**
	 * Builds the `fields` map and the `field_meta` map that describes it,
	 * in one pass.
	 *
	 * The two are produced together on purpose. A consumer receiving
	 * `fields` gets an internal key and a value and nothing else — which is
	 * why a Telegram formatter reading only that has to fall back to a
	 * generic label. Everything it actually needs is already known here:
	 * the administrator's label, the order they dragged the field into, the
	 * type the framework declared, its choices. Emitting the description
	 * alongside the value makes WordPress the source of truth for what a
	 * field *is*, so no consumer ever has to hardcode a mapping.
	 *
	 * `field_meta` describes exactly the keys in `fields` and no others: a
	 * field that is disabled, admin-only, hidden, or resolved to nothing is
	 * absent from both.
	 *
	 * @since 1.5.1
	 *
	 * @param WP_Post                           $post    Source post.
	 * @param array<string,array<string,mixed>> $mapping Effective mapping.
	 *
	 * @return array{fields:array<string,mixed>,field_meta:array<string,array<string,mixed>>} Values and their descriptions.
	 */
	public function describe( WP_Post $post, array $mapping ): array {
		$discovered = $this->registry->discover( $post->post_type );
		$fields     = array();
		$meta       = array();

		foreach ( $mapping as $key => $settings ) {
			if ( empty( $settings['enabled'] ) ) {
				continue;
			}

			$visibility = (string) ( $settings['visibility'] ?? Field::VISIBILITY_BACKEND );

			// Admin-only and hidden fields are for the mapping screen; they
			// never leave the site, in either map.
			if ( ! in_array( $visibility, array( Field::VISIBILITY_TELEGRAM, Field::VISIBILITY_BACKEND ), true ) ) {
				continue;
			}

			$field = $discovered[ $key ] ?? null;

			if ( ! $field instanceof Field ) {
				continue;
			}

			try {
				$value = $this->resolver->value( $field, $post );
			} catch ( \Throwable $e ) {
				continue;
			}

			if ( null === $value || '' === $value || array() === $value ) {
				continue;
			}

			$fields[ $key ] = $value;
			$meta[ $key ]   = $this->field_meta( $field, (array) $settings );
		}

		/**
		 * Filters the mapped field values sent with an advertisement.
		 *
		 * @since 1.4.0
		 *
		 * @param array<string,mixed>               $fields  Field key to value.
		 * @param WP_Post                           $post    Source post.
		 * @param array<string,array<string,mixed>> $mapping Effective mapping.
		 */
		$fields = (array) apply_filters( 'wpep_mapped_fields', $fields, $post, $mapping );

		// A filter may have added or removed a value. The two maps describe
		// each other, so they are reconciled rather than allowed to drift.
		$meta = array_intersect_key( $meta, $fields );

		/**
		 * Filters the metadata describing the mapped fields.
		 *
		 * Only keys present in `$fields` should be described; anything else
		 * is discarded before the payload is built.
		 *
		 * @since 1.5.1
		 *
		 * @param array<string,array<string,mixed>> $meta    Field key to description.
		 * @param array<string,mixed>               $fields  Field key to value.
		 * @param WP_Post                           $post    Source post.
		 * @param array<string,array<string,mixed>> $mapping Effective mapping.
		 */
		$meta = (array) apply_filters( 'wpep_mapped_field_meta', $meta, $fields, $post, $mapping );

		return array(
			'fields'     => $fields,
			'field_meta' => array_intersect_key( $meta, $fields ),
		);
	}

	/**
	 * Describes one field.
	 *
	 * Presentation comes from the effective mapping, because that is what
	 * the administrator controls and what category inheritance overrides.
	 * Structure comes from the {@see Field} the provider discovered,
	 * because that is what the framework declared. Neither is guessed and
	 * neither is derived from the key.
	 *
	 * @since 1.5.1
	 *
	 * @param Field               $field    Discovered field.
	 * @param array<string,mixed> $settings Effective mapping entry.
	 *
	 * @return array<string,mixed> Field description.
	 */
	private function field_meta( Field $field, array $settings ): array {
		$label = trim( (string) ( $settings['label'] ?? '' ) );

		return array(
			// Optional presentation tokens are data, not hardcoded knowledge.
			// Future builders can set them without changing the Node formatter.
			'icon'        => sanitize_text_field( (string) ( $settings['icon'] ?? '' ) ),
			'prefix'      => sanitize_text_field( (string) ( $settings['prefix'] ?? '' ) ),
			'suffix'      => sanitize_text_field( (string) ( $settings['suffix'] ?? '' ) ),

			// Presentation: the administrator's decision wins, then whatever
			// the provider called the field. The internal key is a last
			// resort and only happens when a provider supplied no label.
			'label'       => '' !== $label ? $label : $field->label(),
			'order'       => (int) ( $settings['order'] ?? 0 ),
			'visibility'  => (string) ( $settings['visibility'] ?? Field::VISIBILITY_BACKEND ),
			'format'      => (string) ( $settings['format'] ?? FieldResolver::FORMAT_INLINE ),
			'separator'   => (string) ( $settings['separator'] ?? '، ' ),

			// Which platforms this field may be shown on. The plugin does not
			// build a separate payload per platform — one event is sent and
			// the backend renders it per destination — so the per-platform
			// decision has to travel with the field rather than be applied by
			// omitting it here. Always complete, so a consumer never has to
			// distinguish "not allowed" from "key missing".
			'platforms'   => $this->platform_visibility( (array) $settings ),

			// Structure: what the provider discovered.
			'type'        => $field->type(),
			'source'      => $field->source(),
			'storage_key' => $field->storage_key(),
			'repeatable'  => $field->is_repeatable(),
			'required'    => $field->is_required(),
			'choices'     => $this->jsonable( $field->choices() ),
			'meta'        => $this->jsonable( $field->meta_all() ),
		);
	}

	/**
	 * Returns a field's per-platform visibility, always complete.
	 *
	 * A mapping saved before 1.6.0 has no `platforms` key at all. Those
	 * fields were being sent to Telegram, which was the only platform that
	 * existed, so that is what they resolve to — reading a missing key as
	 * "allowed everywhere" would start publishing an upgraded site's fields
	 * to Bale and WhatsApp the moment those were switched on.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed> $settings Mapping entry.
	 *
	 * @return array<string,bool> Visibility keyed by platform.
	 */
	private function platform_visibility( array $settings ): array {
		$stored  = isset( $settings['platforms'] ) && is_array( $settings['platforms'] ) ? $settings['platforms'] : null;
		$visible = array();

		foreach ( Field::PLATFORMS as $platform ) {
			if ( null === $stored ) {
				$visible[ $platform ] = Field::PLATFORM_TELEGRAM === $platform
					&& Field::VISIBILITY_TELEGRAM === (string) ( $settings['visibility'] ?? '' );

				continue;
			}

			$visible[ $platform ] = ! empty( $stored[ $platform ] );
		}

		return $visible;
	}

	/**
	 * Reduces a value to something JSON can carry.
	 *
	 * Provider metadata is arbitrary — a framework may put an object or a
	 * closure in it — and the payload is signed over its encoded bytes, so
	 * anything that cannot be encoded has to be dropped here rather than
	 * discovered at `wp_json_encode()` time.
	 *
	 * @since 1.5.1
	 *
	 * @param mixed $value Raw value.
	 * @param int   $depth Recursion guard.
	 *
	 * @return mixed Scalar, array, or null.
	 */
	private function jsonable( mixed $value, int $depth = 0 ): mixed {
		if ( null === $value || is_scalar( $value ) ) {
			return $value;
		}

		if ( $depth > 5 ) {
			return null;
		}

		if ( is_object( $value ) ) {
			// An object that describes itself is kept as its own array form;
			// anything else is not payload material.
			$value = method_exists( $value, 'to_array' ) ? $value->to_array() : get_object_vars( $value );
		}

		if ( ! is_array( $value ) ) {
			return null;
		}

		$clean = array();

		foreach ( $value as $key => $item ) {
			$item = $this->jsonable( $item, $depth + 1 );

			if ( null !== $item ) {
				$clean[ (string) $key ] = $item;
			}
		}

		return $clean;
	}

	/**
	 * Summarises where a post sits in its category tree.
	 *
	 * `category` is the top-level term, `subcategory` the one below it, and
	 * `term` the deepest — so "Cars → SUV → Compact" reports Cars, SUV and
	 * Compact respectively, and a flat "Jobs" reports Jobs with no
	 * subcategory.
	 *
	 * @since 1.4.0
	 *
	 * @param string       $taxonomy Taxonomy name.
	 * @param WP_Term|null $term     Deepest assigned term.
	 *
	 * @return array<string,mixed> Category summary.
	 */
	public function category_summary( string $taxonomy, ?WP_Term $term ): array {
		$summary = array(
			'taxonomy'    => $taxonomy,
			'category'    => null,
			'subcategory' => null,
			'term'        => null,
			'path'        => array(),
		);

		if ( ! $term instanceof WP_Term || '' === $taxonomy ) {
			return $summary;
		}

		$describe = static fn( WP_Term $t ): array => array(
			'id'   => (int) $t->term_id,
			'name' => (string) $t->name,
			'slug' => (string) $t->slug,
		);

		// get_ancestors() is closest-first; a path reads root-first.
		$ancestors = array_reverse( (array) get_ancestors( (int) $term->term_id, $taxonomy, 'taxonomy' ) );
		$lineage   = array();

		foreach ( $ancestors as $ancestor_id ) {
			$ancestor = get_term( (int) $ancestor_id, $taxonomy );

			if ( $ancestor instanceof WP_Term ) {
				$lineage[] = $ancestor;
			}
		}

		$lineage[] = $term;

		$summary['term']        = $describe( $term );
		$summary['category']    = $describe( $lineage[0] );
		$summary['subcategory'] = isset( $lineage[1] ) ? $describe( $lineage[1] ) : null;
		$summary['path']        = array_map( static fn( WP_Term $t ): string => (string) $t->name, $lineage );

		return $summary;
	}
}
