<?php
/**
 * Webhook event value object.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Immutable description of a single webhook event.
 *
 * An Event carries the identity of something that happened (its stable
 * `event_id`, its `event_type` and the post it refers to) plus an
 * optional pre-built payload snapshot used when the source post can no
 * longer be read at delivery time — the `deleted` lifecycle.
 *
 * The object deliberately contains no delivery logic: transport lives in
 * {@see Webhook}, retry orchestration in {@see Dispatcher} and payload
 * shaping in {@see Contract}.
 *
 * @since 1.1.0
 */
final class Event {

	/**
	 * Event type: post entered the publish status for the first time.
	 *
	 * @var string
	 */
	public const TYPE_CREATED = 'created';

	/**
	 * Event type: already published post was modified.
	 *
	 * @var string
	 */
	public const TYPE_UPDATED = 'updated';

	/**
	 * Event type: previously published post was permanently deleted.
	 *
	 * @var string
	 */
	public const TYPE_DELETED = 'deleted';

	/**
	 * Diagnostic event type used by the connection test.
	 *
	 * Not part of the post lifecycle; the Node.js service may acknowledge
	 * and discard it.
	 *
	 * @var string
	 */
	public const TYPE_TEST = 'test';

	/**
	 * Diagnostic event type used by the "Send Sample Payload" tool.
	 *
	 * Carries a real, fully normalized post so the Node.js service can be
	 * developed against production-shaped data without treating it as a
	 * publish event.
	 *
	 * @var string
	 */
	public const TYPE_SAMPLE = 'sample';

	/**
	 * Stable, globally unique event identifier.
	 *
	 * @var string
	 */
	private string $id;

	/**
	 * Event type; one of the TYPE_* constants.
	 *
	 * @var string
	 */
	private string $type;

	/**
	 * Related post ID (0 for diagnostics).
	 *
	 * @var int
	 */
	private int $post_id;

	/**
	 * Delivery attempt number, 1-based.
	 *
	 * @var int
	 */
	private int $attempt;

	/**
	 * Pre-built contract payload, used when the post cannot be re-read.
	 *
	 * @var array<string,mixed>|null
	 */
	private ?array $snapshot;

	/**
	 * Unix timestamp of the moment the event was detected.
	 *
	 * @var int
	 */
	private int $created_at;

	/**
	 * Constructor.
	 *
	 * @since 1.1.0
	 *
	 * @param string                   $id         Stable event identifier.
	 * @param string                   $type       Event type (TYPE_* constant).
	 * @param int                      $post_id    Related post ID.
	 * @param int                      $attempt    Delivery attempt, 1-based.
	 * @param array<string,mixed>|null $snapshot   Pre-built payload snapshot.
	 * @param int|null                 $created_at Detection time (Unix); defaults to now.
	 */
	public function __construct(
		string $id,
		string $type,
		int $post_id = 0,
		int $attempt = 1,
		?array $snapshot = null,
		?int $created_at = null
	) {
		$this->id         = $id;
		$this->type       = $type;
		$this->post_id    = $post_id;
		$this->attempt    = max( 1, $attempt );
		$this->snapshot   = $snapshot;
		$this->created_at = $created_at ?? time();
	}

	/**
	 * Returns the stable event identifier.
	 *
	 * @since 1.1.0
	 *
	 * @return string Event ID.
	 */
	public function id(): string {
		return $this->id;
	}

	/**
	 * Returns the event type.
	 *
	 * @since 1.1.0
	 *
	 * @return string Event type.
	 */
	public function type(): string {
		return $this->type;
	}

	/**
	 * Returns the related post ID.
	 *
	 * @since 1.1.0
	 *
	 * @return int Post ID, 0 for diagnostics.
	 */
	public function post_id(): int {
		return $this->post_id;
	}

	/**
	 * Returns the delivery attempt number.
	 *
	 * @since 1.1.0
	 *
	 * @return int Attempt number, 1-based.
	 */
	public function attempt(): int {
		return $this->attempt;
	}

	/**
	 * Returns the payload snapshot captured at detection time.
	 *
	 * @since 1.1.0
	 *
	 * @return array<string,mixed>|null Snapshot payload or null.
	 */
	public function snapshot(): ?array {
		return $this->snapshot;
	}

	/**
	 * Whether a payload snapshot is available.
	 *
	 * @since 1.1.0
	 *
	 * @return bool True when a snapshot exists.
	 */
	public function has_snapshot(): bool {
		return is_array( $this->snapshot ) && ! empty( $this->snapshot );
	}

	/**
	 * Returns the detection time.
	 *
	 * @since 1.1.0
	 *
	 * @return int Unix timestamp.
	 */
	public function created_at(): int {
		return $this->created_at;
	}

	/**
	 * Whether this event describes a permanent deletion.
	 *
	 * @since 1.1.0
	 *
	 * @return bool True for deleted events.
	 */
	public function is_delete(): bool {
		return self::TYPE_DELETED === $this->type;
	}

	/**
	 * Whether this event is a diagnostic (test/sample) event.
	 *
	 * @since 1.1.0
	 *
	 * @return bool True for diagnostic events.
	 */
	public function is_diagnostic(): bool {
		return in_array( $this->type, array( self::TYPE_TEST, self::TYPE_SAMPLE ), true );
	}

	/**
	 * Returns a copy of the event for the given attempt number.
	 *
	 * The event ID is intentionally preserved so the Node.js service can
	 * use it as an idempotency key across retries.
	 *
	 * @since 1.1.0
	 *
	 * @param int $attempt Attempt number, 1-based.
	 *
	 * @return Event New instance with the same identity.
	 */
	public function with_attempt( int $attempt ): Event {
		return new self( $this->id, $this->type, $this->post_id, $attempt, $this->snapshot, $this->created_at );
	}

	/**
	 * Returns a copy of the event carrying the given payload snapshot.
	 *
	 * @since 1.1.0
	 *
	 * @param array<string,mixed>|null $snapshot Snapshot payload.
	 *
	 * @return Event New instance with the same identity.
	 */
	public function with_snapshot( ?array $snapshot ): Event {
		return new self( $this->id, $this->type, $this->post_id, $this->attempt, $snapshot, $this->created_at );
	}

	/**
	 * Exports the event as a plain array for persistence.
	 *
	 * @since 1.1.0
	 *
	 * @return array<string,mixed> Serializable representation.
	 */
	public function to_array(): array {
		return array(
			'id'         => $this->id,
			'type'       => $this->type,
			'post_id'    => $this->post_id,
			'attempt'    => $this->attempt,
			'snapshot'   => $this->snapshot,
			'created_at' => $this->created_at,
		);
	}

	/**
	 * Rebuilds an event from its array representation.
	 *
	 * @since 1.1.0
	 *
	 * @param array<string,mixed> $data Array produced by to_array().
	 *
	 * @return Event|null Event instance or null when the data is unusable.
	 */
	public static function from_array( array $data ): ?Event {
		$id   = isset( $data['id'] ) ? (string) $data['id'] : '';
		$type = isset( $data['type'] ) ? (string) $data['type'] : '';

		if ( '' === $id || '' === $type ) {
			return null;
		}

		$snapshot = isset( $data['snapshot'] ) && is_array( $data['snapshot'] ) ? $data['snapshot'] : null;

		return new self(
			$id,
			$type,
			isset( $data['post_id'] ) ? (int) $data['post_id'] : 0,
			isset( $data['attempt'] ) ? (int) $data['attempt'] : 1,
			$snapshot,
			isset( $data['created_at'] ) ? (int) $data['created_at'] : null
		);
	}
}
