<?php
/**
 * Procedural helper functions.
 *
 * Thin wrappers around the object oriented core so themes and other
 * plugins can integrate without touching plugin internals.
 *
 * @package WPEventPublisher
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'wpep_get_settings' ) ) {
	/**
	 * Returns all plugin settings merged with defaults.
	 *
	 * @since 1.0.0
	 *
	 * @return array<string,mixed> Plugin settings.
	 */
	function wpep_get_settings(): array {
		return wpep()->settings()->all();
	}
}

if ( ! function_exists( 'wpep_get_setting' ) ) {
	/**
	 * Returns a single plugin setting.
	 *
	 * @since 1.0.0
	 *
	 * @param string $key      Setting key.
	 * @param mixed  $fallback Value returned when the key is unknown.
	 *
	 * @return mixed Setting value.
	 */
	function wpep_get_setting( string $key, mixed $fallback = null ): mixed {
		return wpep()->settings()->get( $key, $fallback );
	}
}

if ( ! function_exists( 'wpep_is_enabled' ) ) {
	/**
	 * Whether the plugin is globally enabled.
	 *
	 * @since 1.0.0
	 *
	 * @return bool True when enabled.
	 */
	function wpep_is_enabled(): bool {
		return (bool) wpep()->settings()->get( 'enabled' );
	}
}

if ( ! function_exists( 'wpep_site_id' ) ) {
	/**
	 * Returns the site identifier sent to the Node.js service.
	 *
	 * @since 1.1.0
	 *
	 * @return string Site identifier.
	 */
	function wpep_site_id(): string {
		return wpep()->settings()->site_id();
	}
}

if ( ! function_exists( 'wpep_send_webhook' ) ) {
	/**
	 * Programmatically dispatches a webhook for a post.
	 *
	 * The request is executed synchronously and receives a fresh event
	 * identifier. Use `wpep_queue_event()` to go through the asynchronous
	 * pipeline instead.
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Sends the versioned event contract.
	 *
	 * @param int    $post_id    Post ID.
	 * @param string $event_type Event type; defaults to `updated`.
	 *
	 * @return bool True when the remote endpoint accepted the payload.
	 */
	function wpep_send_webhook( int $post_id, string $event_type = 'updated' ): bool {
		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			return false;
		}

		$plugin = wpep();

		$event = new WPEventPublisher\Event(
			$plugin->event_id()->issue( $post_id, $event_type ),
			$event_type,
			$post_id
		);

		$payload = $plugin->contract()->build(
			$event,
			$plugin->normalizer()->normalize( $post, $event_type ),
			$plugin->signer()->timestamp()
		);

		$result = $plugin->webhook()->send_event( $event, $payload );

		return (bool) $result['success'];
	}
}

if ( ! function_exists( 'wpep_queue_event' ) ) {
	/**
	 * Queues an event for asynchronous delivery.
	 *
	 * Preferred over `wpep_send_webhook()`: the caller is not blocked by
	 * network I/O and the event gains automatic retries, all sharing one
	 * stable event identifier.
	 *
	 * @since 1.1.0
	 *
	 * @param int    $post_id    Post ID.
	 * @param string $event_type One of `created`, `updated` or `deleted`.
	 *
	 * @return string Issued event identifier, empty string when the post does not exist.
	 */
	function wpep_queue_event( int $post_id, string $event_type = 'updated' ): string {
		if ( ! get_post( $post_id ) instanceof WP_Post ) {
			return '';
		}

		return wpep()->dispatcher()->queue( $post_id, $event_type )->id();
	}
}
