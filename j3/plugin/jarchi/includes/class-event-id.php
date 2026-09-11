<?php
/**
 * Event identifier generation and persistence.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Issues globally unique, persistent event identifiers.
 *
 * The identifier is the idempotency key the Node.js backend will use, so
 * it must satisfy two opposite guarantees:
 *
 * - A brand new event always receives a brand new identifier.
 * - Every retry of the same event reuses the identifier it was issued.
 *
 * Stability across retries is structural: the identifier is issued once
 * at detection time, persisted in post meta and then carried through the
 * WP-Cron arguments of every retry. Nothing regenerates it downstream.
 *
 * @since 1.1.0
 */
class EventId {

	/**
	 * Identifier prefix.
	 *
	 * @var string
	 */
	public const PREFIX = 'evt_';

	/**
	 * Post meta key storing the most recently issued event ID.
	 *
	 * @var string
	 */
	public const META_LAST_ID = '_wpep_last_event_id';

	/**
	 * Post meta key storing the most recently issued event type.
	 *
	 * @var string
	 */
	public const META_LAST_TYPE = '_wpep_last_event_type';

	/**
	 * Post meta key storing events issued but not yet delivered.
	 *
	 * @var string
	 */
	public const META_PENDING = '_wpep_pending_events';

	/**
	 * Maximum number of in-flight events tracked per post.
	 *
	 * Prevents the meta value from growing without bound if a remote
	 * endpoint stays unreachable for a long time.
	 *
	 * @var int
	 */
	private const MAX_PENDING = 20;

	/**
	 * Generates a new globally unique identifier.
	 *
	 * Uses 16 cryptographically secure random bytes rendered as hex,
	 * yielding identifiers such as `evt_9f1c0f2a...` with 128 bits of
	 * entropy — collision-free across sites without coordination.
	 *
	 * @since 1.1.0
	 *
	 * @return string Event identifier.
	 */
	public function generate(): string {
		try {
			$random = bin2hex( random_bytes( 16 ) );
		} catch ( \Throwable $e ) {
			// random_bytes() can only fail if no CSPRNG is available.
			$random = str_replace( '-', '', wp_generate_uuid4() );
		}

		$event_id = self::PREFIX . $random;

		/**
		 * Filters a freshly generated event identifier.
		 *
		 * Allows a deterministic identifier strategy (for example one
		 * derived from an external system's primary key) to replace the
		 * random default. Implementations must guarantee uniqueness per
		 * event, otherwise the Node.js backend will treat distinct events
		 * as duplicates.
		 *
		 * @since 1.1.0
		 *
		 * @param string $event_id Generated identifier.
		 */
		return (string) apply_filters( 'wpep_generate_event_id', $event_id );
	}

	/**
	 * Issues and persists an identifier for a new event.
	 *
	 * @since 1.1.0
	 *
	 * @param int    $post_id    Related post ID (0 for diagnostics).
	 * @param string $event_type Event type.
	 *
	 * @return string Newly issued event identifier.
	 */
	public function issue( int $post_id, string $event_type ): string {
		$event_id = $this->generate();

		if ( $post_id > 0 ) {
			update_post_meta( $post_id, self::META_LAST_ID, $event_id );
			update_post_meta( $post_id, self::META_LAST_TYPE, $event_type );

			$pending = $this->pending( $post_id );

			$pending[ $event_id ] = array(
				'type'       => $event_type,
				'issued_at'  => time(),
				'issued_gmt' => gmdate( 'c' ),
			);

			if ( count( $pending ) > self::MAX_PENDING ) {
				$pending = array_slice( $pending, -self::MAX_PENDING, null, true );
			}

			update_post_meta( $post_id, self::META_PENDING, $pending );
		}

		/**
		 * Fires after an event identifier has been issued and persisted.
		 *
		 * @since 1.1.0
		 *
		 * @param string $event_id   Issued identifier.
		 * @param int    $post_id    Related post ID.
		 * @param string $event_type Event type.
		 */
		do_action( 'wpep_event_id_issued', $event_id, $post_id, $event_type );

		return $event_id;
	}

	/**
	 * Returns the in-flight events recorded for a post.
	 *
	 * @since 1.1.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return array<string,array<string,mixed>> Map of event ID to record.
	 */
	public function pending( int $post_id ): array {
		if ( $post_id <= 0 ) {
			return array();
		}

		$pending = get_post_meta( $post_id, self::META_PENDING, true );

		return is_array( $pending ) ? $pending : array();
	}

	/**
	 * Removes an event from the in-flight list once it reached a terminal
	 * state (delivered, or permanently failed).
	 *
	 * @since 1.1.0
	 *
	 * @param int    $post_id  Post ID.
	 * @param string $event_id Event identifier.
	 *
	 * @return void
	 */
	public function release( int $post_id, string $event_id ): void {
		if ( $post_id <= 0 ) {
			return;
		}

		$pending = $this->pending( $post_id );

		if ( ! isset( $pending[ $event_id ] ) ) {
			return;
		}

		unset( $pending[ $event_id ] );

		if ( empty( $pending ) ) {
			delete_post_meta( $post_id, self::META_PENDING );
		} else {
			update_post_meta( $post_id, self::META_PENDING, $pending );
		}
	}

	/**
	 * Returns the most recently issued identifier for a post.
	 *
	 * @since 1.1.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return string Event identifier, empty string when none was issued.
	 */
	public function last( int $post_id ): string {
		if ( $post_id <= 0 ) {
			return '';
		}

		return (string) get_post_meta( $post_id, self::META_LAST_ID, true );
	}

	/**
	 * Deletes every identifier record stored for a post.
	 *
	 * @since 1.1.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return void
	 */
	public function forget( int $post_id ): void {
		delete_post_meta( $post_id, self::META_LAST_ID );
		delete_post_meta( $post_id, self::META_LAST_TYPE );
		delete_post_meta( $post_id, self::META_PENDING );
	}
}
