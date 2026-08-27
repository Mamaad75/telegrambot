<?php
/**
 * Field provider contract.
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
 * One source of fields for a post type.
 *
 * A provider knows how one field framework stores its data and nothing
 * else. It answers three questions: is the framework here, what fields does
 * this post type have, and what is this field's value on this post. The
 * registry asks every available provider and merges the answers; nothing in
 * the plugin branches on which framework is installed.
 *
 * Implement this interface and register it with the `wpep_field_providers`
 * filter to teach the plugin a framework it does not know.
 *
 * @since 1.4.0
 */
interface FieldProvider {

	/**
	 * Machine readable identifier, also used as the field group key.
	 *
	 * Must be stable: mappings and cached discovery reference it.
	 *
	 * @since 1.4.0
	 *
	 * @return string Provider id, lower case, no spaces.
	 */
	public function id(): string;

	/**
	 * Human readable name shown as the group heading in the admin.
	 *
	 * @since 1.4.0
	 *
	 * @return string Provider label.
	 */
	public function label(): string;

	/**
	 * Whether the framework this provider reads is present right now.
	 *
	 * Called on every request that touches discovery, so it must be cheap:
	 * a `class_exists()` or `function_exists()` check, never a query.
	 *
	 * @since 1.4.0
	 *
	 * @return bool True when the provider can contribute fields.
	 */
	public function is_available(): bool;

	/**
	 * Lists the fields this provider can offer for a post type.
	 *
	 * Discovery is cached by the registry, so this may be relatively
	 * expensive. It must never write anything.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return Field[] Discovered fields.
	 */
	public function discover( string $post_type ): array;

	/**
	 * Reads the raw value of one of this provider's fields from a post.
	 *
	 * Returns the value in its natural shape — a scalar, a list, or a list
	 * of rows for a repeater. Formatting belongs to {@see FieldResolver}.
	 * Return null when the field has no value.
	 *
	 * @since 1.4.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Post to read it from.
	 *
	 * @return mixed Raw value, or null when absent.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed;

	/**
	 * A short string that changes when this provider's field definitions
	 * could have changed.
	 *
	 * The registry mixes every provider's signature into the discovery
	 * cache key, so a plugin being activated, deactivated or updated
	 * invalidates the cache without anyone clearing it by hand.
	 *
	 * @since 1.4.0
	 *
	 * @return string Signature.
	 */
	public function signature(): string;
}
