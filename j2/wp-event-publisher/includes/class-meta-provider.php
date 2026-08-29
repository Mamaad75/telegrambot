<?php
/**
 * Raw post meta fields.
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
 * Every meta key a post type actually uses.
 *
 * This is the provider that makes the plugin work on a site whose fields
 * come from a theme, a bespoke meta box or a plugin nobody has heard of: it
 * asks the database which keys exist on this post type and offers all of
 * them. A field framework's own provider describes the same key better —
 * with a real label, a type and its choices — and the registry prefers that
 * description, so nothing appears twice.
 *
 * @since 1.4.0
 */
class MetaProvider extends BaseProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'meta';

	/**
	 * Meta keys that are bookkeeping rather than content.
	 *
	 * @var string[]
	 */
	private const INTERNAL_PREFIXES = array(
		'_edit_',
		'_wp_',
		'_oembed_',
		'_wpep_',
		'_thumbnail_id',
		'_pingme',
		'_encloseme',
		'_menu_item_',
		'_transient_',
	);

	/**
	 * Maximum number of distinct meta keys offered for one post type.
	 *
	 * @var int
	 */
	private const MAX_KEYS = 300;

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
		return __( 'Custom fields (post meta)', 'wp-event-publisher' );
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
	 * Runs one grouped query against the meta table restricted to the post
	 * type. The result is cached by the registry, so this executes on a
	 * cache miss only — never on a publish request.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return Field[] Discovered meta fields.
	 */
	public function discover( string $post_type ): array {
		global $wpdb;

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- discovery is cached by FieldRegistry.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT m.meta_key AS meta_key, COUNT(*) AS uses
				FROM {$wpdb->postmeta} m
				INNER JOIN {$wpdb->posts} p ON p.ID = m.post_id
				WHERE p.post_type = %s
					AND p.post_status NOT IN ( 'auto-draft', 'trash' )
				GROUP BY m.meta_key
				ORDER BY uses DESC, m.meta_key ASC
				LIMIT %d",
				$post_type,
				self::MAX_KEYS
			)
		);
		// phpcs:enable

		if ( ! is_array( $rows ) ) {
			return array();
		}

		$sample = $this->sample_post( $post_type );
		$fields = array();

		foreach ( $rows as $row ) {
			$key = (string) ( $row->meta_key ?? '' );

			if ( '' === $key || $this->is_internal( $key ) ) {
				continue;
			}

			$value = $sample instanceof WP_Post ? $this->meta( (int) $sample->ID, $key ) : null;

			$fields[] = new Field(
				array(
					'key'         => $key,
					'label'       => $this->humanize( $key ),
					'storage_key' => $key,
					'source'      => self::ID,
					'type'        => $this->guess_type( $key, $value ),
					'repeatable'  => is_array( maybe_unserialize( $value ) ),
					'meta'        => array( 'uses' => (int) ( $row->uses ?? 0 ) ),
				)
			);
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
	 * @return mixed Raw meta value.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed {
		return $this->meta( (int) $post->ID, $field->storage_key() );
	}

	/**
	 * Whether a meta key is WordPress bookkeeping rather than content.
	 *
	 * @since 1.4.0
	 *
	 * @param string $key Meta key.
	 *
	 * @return bool True when the key should not be offered.
	 */
	private function is_internal( string $key ): bool {
		foreach ( self::INTERNAL_PREFIXES as $prefix ) {
			if ( str_starts_with( $key, $prefix ) ) {
				return true;
			}
		}

		/**
		 * Filters whether a meta key is hidden from field discovery.
		 *
		 * @since 1.4.0
		 *
		 * @param bool   $internal Whether the key is internal bookkeeping.
		 * @param string $key      Meta key.
		 */
		return (bool) apply_filters( 'wpep_is_internal_meta_key', false, $key );
	}
}
