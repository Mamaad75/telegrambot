<?php
/**
 * Backward compatible facade over the durable queue.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Keeps the 1.1.0 event store API working on top of {@see Queue}.
 *
 * Versions 1.1.0 to 1.2.1 stored in-flight events in transients through
 * this class. Transients are the wrong home for them: with a persistent
 * object cache they are cache entries, so an eviction or a flush silently
 * deleted queued advertisements. Version 1.3.0 moved the queue into its
 * own table.
 *
 * The class stays because integrations may call it — `wpep()->event_store()`
 * is public API — but every method now delegates to the queue. No data
 * lives here any more.
 *
 * @since 1.1.0
 * @deprecated 1.3.0 Use {@see Queue} instead.
 */
class EventStore {

	/**
	 * Delivery queue.
	 *
	 * @var Queue
	 */
	private Queue $queue;

	/**
	 * Constructor.
	 *
	 * @since 1.1.0
	 * @since 1.3.0 Backed by the queue table.
	 *
	 * @param Queue|null $queue Delivery queue; created when omitted.
	 */
	public function __construct( ?Queue $queue = null ) {
		$this->queue = $queue ?? new Queue();
	}

	/**
	 * Returns the retention window for stored events.
	 *
	 * @since 1.1.0
	 *
	 * @return int Time to live in seconds.
	 */
	public function ttl(): int {
		/** This filter is documented in includes/class-event-store.php */
		return (int) apply_filters( 'wpep_event_store_ttl', DAY_IN_SECONDS );
	}

	/**
	 * Stores an event.
	 *
	 * @since 1.1.0
	 *
	 * @param Event    $event Event to persist.
	 * @param int|null $due   Unix timestamp the event is expected to run at.
	 *
	 * @return void
	 */
	public function put( Event $event, ?int $due = null ): void {
		$delay = null === $due ? 0 : max( 0, $due - time() );

		$this->queue->push( $event, $delay );
	}

	/**
	 * Retrieves a stored event.
	 *
	 * @since 1.1.0
	 *
	 * @param string $event_id Event identifier.
	 *
	 * @return Event|null Event instance, or null when it is not stored.
	 */
	public function get( string $event_id ): ?Event {
		return $this->queue->find( $event_id );
	}

	/**
	 * Marks an event as delivered.
	 *
	 * @since 1.1.0
	 *
	 * @param string $event_id Event identifier.
	 *
	 * @return void
	 */
	public function forget( string $event_id ): void {
		$this->queue->finish( $event_id );
	}

	/**
	 * Re-queues an event for a given moment.
	 *
	 * @since 1.2.0
	 *
	 * @param Event $event Event in flight.
	 * @param int   $due   Unix timestamp the event should run at.
	 *
	 * @return void
	 */
	public function remember( Event $event, int $due ): void {
		$this->put( $event, $due );
	}

	/**
	 * Returns how many events are currently in flight.
	 *
	 * @since 1.2.0
	 *
	 * @return int Number of tracked events.
	 */
	public function count_pending(): int {
		return $this->queue->count_pending();
	}

	/**
	 * Returns the queue this facade delegates to.
	 *
	 * @since 1.3.0
	 *
	 * @return Queue Delivery queue.
	 */
	public function queue(): Queue {
		return $this->queue;
	}

	/**
	 * Deletes every stored event.
	 *
	 * @since 1.1.0
	 *
	 * @return void
	 */
	public function flush(): void {
		$this->queue->clear();
	}
}
