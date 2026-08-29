<?php
/**
 * Durable delivery queue.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Stores events awaiting delivery in a dedicated database table.
 *
 * Until version 1.3.0 in-flight events lived in transients. That works on a
 * plain installation and fails intermittently on a real one: with a
 * persistent object cache (Redis, Memcached) transients are cache entries,
 * not rows. They are evicted under memory pressure, dropped by a cache
 * flush and lost on a cache restart — so an advertisement queued a second
 * before a flush simply disappeared, with nothing to sweep and nothing to
 * report. That is the shape of "publishing does not always trigger
 * delivery, and it differs per site".
 *
 * A table has none of those properties. A queued event survives page
 * reloads, cache flushes, object cache restarts and PHP fatals, and the
 * only thing that removes it is this class.
 *
 * Concurrency is handled with a claim: a worker atomically flips rows from
 * `pending` to `reserved` with its own token, then reads back only what it
 * owns. Two cron runs, an inline dispatch and a manual "process queue" can
 * therefore run at the same moment without ever sending an event twice.
 *
 * The claim also counts the attempt. That matters for an event that kills the
 * process while its payload is being built — a fatal, a memory limit, an
 * execution timeout — because such a death never reaches the failure handler
 * that would normally count it. Counting at claim time means a poisoned event
 * exhausts its retries and is recorded as failed, instead of being retried
 * forever every five minutes.
 *
 * @since 1.3.0
 */
class Queue {

	/**
	 * Row is waiting to be delivered.
	 *
	 * @var string
	 */
	public const STATUS_PENDING = 'pending';

	/**
	 * Row is claimed by a worker right now.
	 *
	 * @var string
	 */
	public const STATUS_RESERVED = 'reserved';

	/**
	 * Row was accepted by the endpoint.
	 *
	 * @var string
	 */
	public const STATUS_DONE = 'done';

	/**
	 * Row exhausted its retries or was rejected permanently.
	 *
	 * @var string
	 */
	public const STATUS_FAILED = 'failed';

	/**
	 * Schema version for the queue table.
	 *
	 * @var string
	 */
	private const DB_VERSION = '1.3.0';

	/**
	 * Option storing the installed queue schema version.
	 *
	 * @var string
	 */
	private const DB_VERSION_OPTION = 'wpep_queue_db_version';

	/**
	 * Autoloaded flag recording whether the queue holds deliverable work.
	 *
	 * @since 1.3.1
	 *
	 * @var string
	 */
	public const WORK_FLAG = 'wpep_queue_has_work';

	/**
	 * Token identifying this PHP process while it holds reservations.
	 *
	 * @var string
	 */
	private string $worker;

	/**
	 * Constructor.
	 *
	 * @since 1.3.0
	 */
	public function __construct() {
		$this->worker = substr( md5( uniqid( (string) getmypid(), true ) ), 0, 32 );
	}

	/**
	 * Returns the fully qualified queue table name.
	 *
	 * @since 1.3.0
	 *
	 * @return string Table name including the WordPress prefix.
	 */
	public function table(): string {
		global $wpdb;

		return $wpdb->prefix . 'wpep_queue';
	}

	/**
	 * Creates or upgrades the queue table.
	 *
	 * SQL creation code:
	 *
	 *     CREATE TABLE {$prefix}wpep_queue (
	 *         id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
	 *         event_id VARCHAR(64) NOT NULL DEFAULT '',
	 *         event_type VARCHAR(20) NOT NULL DEFAULT '',
	 *         post_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
	 *         status VARCHAR(20) NOT NULL DEFAULT 'pending',
	 *         attempt SMALLINT(5) UNSIGNED NOT NULL DEFAULT 1,
	 *         available_at DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
	 *         reserved_at DATETIME NULL,
	 *         reserved_by VARCHAR(32) NOT NULL DEFAULT '',
	 *         payload LONGTEXT NULL,
	 *         last_error TEXT NULL,
	 *         created_at DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
	 *         updated_at DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
	 *         PRIMARY KEY  (id),
	 *         UNIQUE KEY event_id (event_id),
	 *         KEY status_available (status,available_at),
	 *         KEY post_id (post_id),
	 *         KEY updated_at (updated_at)
	 *     ) {$charset_collate};
	 *
	 * @since 1.3.0
	 *
	 * @return void
	 */
	public function install(): void {
		global $wpdb;

		$table           = $this->table();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id VARCHAR(64) NOT NULL DEFAULT '',
			event_type VARCHAR(20) NOT NULL DEFAULT '',
			post_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			attempt SMALLINT(5) UNSIGNED NOT NULL DEFAULT 1,
			available_at DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
			reserved_at DATETIME NULL,
			reserved_by VARCHAR(32) NOT NULL DEFAULT '',
			payload LONGTEXT NULL,
			last_error TEXT NULL,
			created_at DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
			updated_at DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
			PRIMARY KEY  (id),
			UNIQUE KEY event_id (event_id),
			KEY status_available (status,available_at),
			KEY post_id (post_id),
			KEY updated_at (updated_at)
		) {$charset_collate};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Creates the table when it is missing or outdated.
	 *
	 * @since 1.3.0
	 *
	 * @return void
	 */
	public function maybe_install(): void {
		if ( get_option( self::DB_VERSION_OPTION ) !== self::DB_VERSION ) {
			$this->install();
		}
	}

	/**
	 * Whether the queue table exists.
	 *
	 * Used by diagnostics: a missing table is the one failure this class
	 * cannot work around, and it must be visible rather than silent.
	 *
	 * @since 1.3.0
	 *
	 * @return bool True when the table is present.
	 */
	public function is_installed(): bool {
		global $wpdb;

		$table = $this->table();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- schema probe.
		return (bool) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );
	}

	/**
	 * Adds an event to the queue, or updates the one already there.
	 *
	 * The event identifier is unique in the table, so re-queueing the same
	 * event (a retry, or a second hook observing the same publish) can
	 * never create a second row.
	 *
	 * @since 1.3.0
	 *
	 * @param Event $event Event to store.
	 * @param int   $delay Seconds before the event may be delivered.
	 *
	 * @return bool True when the row was written.
	 */
	public function push( Event $event, int $delay = 0 ): bool {
		global $wpdb;

		$now       = time();
		$available = gmdate( 'Y-m-d H:i:s', $now + max( 0, $delay ) );
		$snapshot  = $event->has_snapshot() ? (string) wp_json_encode( $event->snapshot() ) : null;

		$data = array(
			'event_id'     => substr( $event->id(), 0, 64 ),
			'event_type'   => substr( $event->type(), 0, 20 ),
			'post_id'      => $event->post_id(),
			'status'       => self::STATUS_PENDING,
			'attempt'      => $event->attempt(),
			'available_at' => $available,
			'reserved_at'  => null,
			'reserved_by'  => '',
			'payload'      => $snapshot,
			'created_at'   => gmdate( 'Y-m-d H:i:s', $event->created_at() ),
			'updated_at'   => gmdate( 'Y-m-d H:i:s', $now ),
		);

		$this->set_work_flag( true );

		$existing = $this->row( $event->id() );

		if ( $existing ) {
			// A snapshot is only captured once, at detection time; never
			// overwrite it with null on a retry.
			if ( null === $snapshot ) {
				unset( $data['payload'] );
			}

			unset( $data['created_at'] );

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- custom table.
			return false !== $wpdb->update( $this->table(), $data, array( 'event_id' => $event->id() ) );
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- custom table.
		return false !== $wpdb->insert( $this->table(), $data );
	}

	/**
	 * Records that the queue holds work, in an autoloaded flag.
	 *
	 * The sweeper asks "is there anything to do?" on every request. Asking
	 * the database would mean a COUNT on every page view of the site; this
	 * flag is part of the autoloaded option bundle, so the common answer
	 * ("no") costs nothing at all.
	 *
	 * @since 1.3.1
	 *
	 * @param bool $has_work Whether the queue holds deliverable events.
	 *
	 * @return void
	 */
	public function set_work_flag( bool $has_work ): void {
		if ( (bool) get_option( self::WORK_FLAG, false ) === $has_work ) {
			return;
		}

		update_option( self::WORK_FLAG, $has_work ? 1 : 0, true );
	}

	/**
	 * Whether the queue is known to hold work.
	 *
	 * @since 1.3.1
	 *
	 * @return bool True when something may be waiting.
	 */
	public function has_work(): bool {
		return (bool) get_option( self::WORK_FLAG, false );
	}

	/**
	 * Claims up to `$limit` due events for this worker.
	 *
	 * The claim is a single conditional UPDATE, so two processes racing for
	 * the same row cannot both win it.
	 *
	 * @since 1.3.0
	 *
	 * @param int $limit    Maximum number of events to claim.
	 * @param int $lock_ttl Seconds after which an abandoned claim is retaken.
	 * @param int $grace    Seconds an event must already be overdue before it
	 *                      is claimed. The sweeper uses this so it only
	 *                      rescues what the primary path failed to deliver;
	 *                      the manual "process queue" tool passes 0.
	 *
	 * @return Event[] Claimed events, in due order.
	 */
	public function reserve( int $limit = 5, int $lock_ttl = 300, int $grace = 0 ): array {
		global $wpdb;

		$this->recover_stale( $lock_ttl );

		$table = $this->table();
		$now   = gmdate( 'Y-m-d H:i:s' );
		$due   = gmdate( 'Y-m-d H:i:s', time() - max( 0, $grace ) );

		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table, values are placeholders.
		$claimed = $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$table}
				SET status = %s, reserved_at = %s, reserved_by = %s, updated_at = %s,
					attempt = attempt + 1
				WHERE status = %s AND available_at <= %s
				ORDER BY available_at ASC
				LIMIT %d",
				self::STATUS_RESERVED,
				$now,
				$this->worker,
				$now,
				self::STATUS_PENDING,
				$due,
				max( 1, $limit )
			)
		);

		if ( ! $claimed ) {
			return array();
		}

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$table} WHERE status = %s AND reserved_by = %s ORDER BY available_at ASC",
				self::STATUS_RESERVED,
				$this->worker
			)
		);
		// phpcs:enable

		$events = array();

		foreach ( (array) $rows as $row ) {
			$event = $this->to_event( $row );

			if ( $event instanceof Event ) {
				$events[] = $event;
			}
		}

		return $events;
	}

	/**
	 * Fails events that have used up their attempt budget.
	 *
	 * A delivery that kills the process — a fatal in a content filter, a
	 * memory limit, an execution timeout — never reaches the failure
	 * handler, so nothing would ever mark it finished. The claim counts
	 * every attempt, and this sweep retires whatever exceeded the budget,
	 * which is what guarantees such an event stops instead of being
	 * reserved and recovered forever.
	 *
	 * @since 1.3.1
	 *
	 * @param int    $max_attempts Attempt budget.
	 * @param string $reason       Message stored on the retired rows.
	 *
	 * @return int Number of retired rows.
	 */
	public function fail_exhausted( int $max_attempts, string $reason ): int {
		global $wpdb;

		$table = $this->table();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		$retired = (int) $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$table}
				SET status = %s, reserved_by = '', reserved_at = NULL, payload = NULL,
					last_error = %s, updated_at = %s
				WHERE status IN (%s,%s) AND attempt > %d",
				self::STATUS_FAILED,
				mb_substr( $reason, 0, 2000 ),
				gmdate( 'Y-m-d H:i:s' ),
				self::STATUS_PENDING,
				self::STATUS_RESERVED,
				max( 1, $max_attempts )
			)
		);

		if ( $retired > 0 && 0 === $this->count_pending() ) {
			$this->set_work_flag( false );
		}

		return $retired;
	}

	/**
	 * Returns claims older than the lock lifetime to the pending pool.
	 *
	 * A worker that died mid-delivery — a PHP fatal, a killed FPM child, a
	 * deploy — leaves its rows reserved. Without this they would sit there
	 * forever; with it they are simply late.
	 *
	 * @since 1.3.0
	 *
	 * @param int $lock_ttl Seconds a reservation may be held.
	 *
	 * @return int Number of recovered rows.
	 */
	public function recover_stale( int $lock_ttl = 300 ): int {
		global $wpdb;

		$table  = $this->table();
		$cutoff = gmdate( 'Y-m-d H:i:s', time() - max( 60, $lock_ttl ) );
		$now    = gmdate( 'Y-m-d H:i:s' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		return (int) $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$table}
				SET status = %s, reserved_by = '', reserved_at = NULL, updated_at = %s
				WHERE status = %s AND reserved_at IS NOT NULL AND reserved_at < %s",
				self::STATUS_PENDING,
				$now,
				self::STATUS_RESERVED,
				$cutoff
			)
		);
	}

	/**
	 * Puts an event back in the queue for a later attempt.
	 *
	 * @since 1.3.0
	 *
	 * @param Event  $event Event being retried.
	 * @param int    $delay Seconds before the next attempt.
	 * @param string $error Last error, stored for the admin screens.
	 *
	 * @return void
	 */
	public function release( Event $event, int $delay, string $error = '' ): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- custom table.
		$wpdb->update(
			$this->table(),
			array(
				'status'       => self::STATUS_PENDING,
				'attempt'      => $event->attempt(),
				'available_at' => gmdate( 'Y-m-d H:i:s', time() + max( 0, $delay ) ),
				'reserved_at'  => null,
				'reserved_by'  => '',
				'last_error'   => mb_substr( $error, 0, 2000 ),
				'updated_at'   => gmdate( 'Y-m-d H:i:s' ),
			),
			array( 'event_id' => $event->id() )
		);
	}

	/**
	 * Marks an event as delivered.
	 *
	 * The row is kept, not deleted: it is the record that this event
	 * already reached a terminal state, which is what stops a late cron
	 * tick from sending it a second time. {@see self::purge()} removes it
	 * once it is old enough to be irrelevant.
	 *
	 * @since 1.3.0
	 *
	 * @param string $event_id Event identifier.
	 * @param string $status   Terminal status.
	 * @param string $error    Final error, for failures.
	 *
	 * @return void
	 */
	public function finish( string $event_id, string $status = self::STATUS_DONE, string $error = '' ): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- custom table.
		$wpdb->update(
			$this->table(),
			array(
				'status'      => self::STATUS_FAILED === $status ? self::STATUS_FAILED : self::STATUS_DONE,
				'reserved_at' => null,
				'reserved_by' => '',
				'payload'     => null,
				'last_error'  => mb_substr( $error, 0, 2000 ),
				'updated_at'  => gmdate( 'Y-m-d H:i:s' ),
			),
			array( 'event_id' => $event_id )
		);

		if ( 0 === $this->count_pending() ) {
			$this->set_work_flag( false );
		}
	}

	/**
	 * Whether an event already reached a terminal state.
	 *
	 * @since 1.3.0
	 *
	 * @param string $event_id Event identifier.
	 *
	 * @return bool True when the event is done or permanently failed.
	 */
	public function is_finished( string $event_id ): bool {
		$row = $this->row( $event_id );

		if ( ! $row ) {
			return false;
		}

		return in_array( (string) $row->status, array( self::STATUS_DONE, self::STATUS_FAILED ), true );
	}

	/**
	 * Returns a queued event by identifier.
	 *
	 * @since 1.3.0
	 *
	 * @param string $event_id Event identifier.
	 *
	 * @return Event|null Event, or null when unknown.
	 */
	public function find( string $event_id ): ?Event {
		$row = $this->row( $event_id );

		return $row ? $this->to_event( $row ) : null;
	}

	/**
	 * Returns the raw row for an event.
	 *
	 * @since 1.3.0
	 *
	 * @param string $event_id Event identifier.
	 *
	 * @return object|null Row object or null.
	 */
	private function row( string $event_id ): ?object {
		global $wpdb;

		$table = $this->table();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE event_id = %s", $event_id ) );

		return $row ?: null;
	}

	/**
	 * Rebuilds an Event from a queue row.
	 *
	 * @since 1.3.0
	 *
	 * @param object $row Queue row.
	 *
	 * @return Event|null Event, or null when the row is unusable.
	 */
	private function to_event( object $row ): ?Event {
		$snapshot = null;

		if ( ! empty( $row->payload ) ) {
			$decoded = json_decode( (string) $row->payload, true );

			if ( is_array( $decoded ) ) {
				$snapshot = $decoded;
			}
		}

		$id   = (string) ( $row->event_id ?? '' );
		$type = (string) ( $row->event_type ?? '' );

		if ( '' === $id || '' === $type ) {
			return null;
		}

		$created = strtotime( (string) ( $row->created_at ?? '' ) . ' UTC' );

		return new Event(
			$id,
			$type,
			(int) ( $row->post_id ?? 0 ),
			max( 1, (int) ( $row->attempt ?? 1 ) ),
			$snapshot,
			false === $created ? null : $created
		);
	}

	/**
	 * Counts events still waiting for delivery.
	 *
	 * @since 1.3.0
	 *
	 * @return int Pending and reserved rows.
	 */
	public function count_pending(): int {
		global $wpdb;

		$table = $this->table();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$table} WHERE status IN (%s,%s)",
				self::STATUS_PENDING,
				self::STATUS_RESERVED
			)
		);
	}

	/**
	 * Returns queue counters and the most recent outcomes.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,mixed> Queue statistics.
	 */
	public function stats(): array {
		global $wpdb;

		$table = $this->table();

		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		$counts = $wpdb->get_results( "SELECT status, COUNT(*) AS total FROM {$table} GROUP BY status" );

		$last_ok = $wpdb->get_row(
			$wpdb->prepare( "SELECT * FROM {$table} WHERE status = %s ORDER BY updated_at DESC LIMIT 1", self::STATUS_DONE )
		);

		$last_fail = $wpdb->get_row(
			$wpdb->prepare( "SELECT * FROM {$table} WHERE status = %s ORDER BY updated_at DESC LIMIT 1", self::STATUS_FAILED )
		);

		$next = $wpdb->get_var(
			$wpdb->prepare( "SELECT MIN(available_at) FROM {$table} WHERE status = %s", self::STATUS_PENDING )
		);

		$retrying = (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE status = %s AND attempt > 1", self::STATUS_PENDING )
		);
		// phpcs:enable

		$by_status = array(
			self::STATUS_PENDING  => 0,
			self::STATUS_RESERVED => 0,
			self::STATUS_DONE     => 0,
			self::STATUS_FAILED   => 0,
		);

		foreach ( (array) $counts as $row ) {
			$by_status[ (string) $row->status ] = (int) $row->total;
		}

		return array(
			'counts'       => $by_status,
			'waiting'      => $by_status[ self::STATUS_PENDING ] + $by_status[ self::STATUS_RESERVED ],
			'retrying'     => $retrying,
			'next_due'     => (string) $next,
			'last_success' => $last_ok ? (string) $last_ok->updated_at : '',
			'last_failure' => $last_fail ? (string) $last_fail->updated_at : '',
			'last_error'   => $last_fail ? (string) $last_fail->last_error : '',
		);
	}

	/**
	 * Deletes finished rows older than the retention window.
	 *
	 * @since 1.3.0
	 *
	 * @param int $days Days to keep terminal rows.
	 *
	 * @return int Number of deleted rows.
	 */
	public function purge( int $days = 7 ): int {
		global $wpdb;

		$table  = $this->table();
		$cutoff = gmdate( 'Y-m-d H:i:s', time() - max( 1, $days ) * DAY_IN_SECONDS );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		return (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE status IN (%s,%s) AND updated_at < %s",
				self::STATUS_DONE,
				self::STATUS_FAILED,
				$cutoff
			)
		);
	}

	/**
	 * Removes every row. Used by the admin tools and by uninstall.
	 *
	 * @since 1.3.0
	 *
	 * @return void
	 */
	public function clear(): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		$wpdb->query( 'TRUNCATE TABLE ' . $this->table() );

		$this->set_work_flag( false );
	}

	/**
	 * Drops the queue table. Used exclusively by uninstall.php.
	 *
	 * @since 1.3.0
	 *
	 * @return void
	 */
	public function drop(): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.SchemaChange -- uninstall cleanup.
		$wpdb->query( 'DROP TABLE IF EXISTS ' . $this->table() );

		delete_option( self::DB_VERSION_OPTION );
		delete_option( self::WORK_FLAG );
	}
}
