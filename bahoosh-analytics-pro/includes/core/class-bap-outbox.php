<?php
/**
 * Durable server-side event outbox.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- see the class note below.
// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- see the class note below.
// phpcs:disable WordPress.DB.DirectDatabaseQuery.NoCaching -- see the class note below.

/**
 * The server-side twin of the browser's IndexedDB queue.
 *
 * Server events (WooCommerce purchases and refunds above all) must not depend
 * on the collector being reachable at the exact moment an order completes. They
 * are written to a local table first, then delivered by cron with exponential
 * backoff, and removed only once acknowledged.
 *
 * `event_id` carries a UNIQUE index, so re-enqueuing the same logical event —
 * for instance because WooCommerce fires both `woocommerce_thankyou` and an
 * order-status transition for the same order — inserts nothing the second time.
 *
 * A note on the file-level sniff exclusions above: every statement in this
 * class targets `{prefix}bap_outbox`, a table the plugin owns. A table name
 * cannot be a `$wpdb->prepare()` placeholder, and no WordPress API covers a
 * custom queue table, so direct queries with an interpolated table name are
 * unavoidable here. All *values* are prepared, and the only other interpolated
 * fragments are placeholder lists built from counted arrays. Caching is
 * deliberately absent: this is a work queue whose whole purpose is to reflect
 * current state.
 */
class BAP_Outbox {

	const TABLE          = 'bap_outbox';
	const CRON_HOOK      = 'bap_process_outbox';
	const STATUS_PENDING = 'pending';
	const STATUS_SENDING = 'sending';
	const STATUS_FAILED  = 'failed';
	const STATUS_DONE    = 'done';
	const MAX_ATTEMPTS   = 12;
	const BATCH_SIZE     = 25;
	const LEASE_SECONDS  = 300;

	/**
	 * Backoff schedule in seconds, indexed by attempt number.
	 *
	 * @var int[]
	 */
	private static $backoff = array( 2, 5, 15, 60, 300, 900, 1800, 3600 );

	/**
	 * Fully-qualified table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE;
	}

	/**
	 * Registers hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::CRON_HOOK, array( __CLASS__, 'process' ) );
		// phpcs:ignore WordPress.WP.CronInterval.CronSchedulesInterval -- a purchase event waiting 15 minutes is a worse outcome than a light one-minute check; see add_schedule().
		add_filter( 'cron_schedules', array( __CLASS__, 'add_schedule' ) );
	}

	/**
	 * Adds the one-minute schedule used by the outbox worker.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public static function add_schedule( $schedules ) {
		if ( ! isset( $schedules['bap_minute'] ) ) {
			$schedules['bap_minute'] = array(
				'interval' => 60,
				'display'  => __( 'Every minute (Bahoosh Analytics)', 'bahoosh-analytics-pro' ),
			);
		}
		return $schedules;
	}

	/**
	 * Creates or upgrades the outbox table.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;

		$table   = self::table();
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id VARCHAR(64) NOT NULL,
			event_type VARCHAR(64) NOT NULL DEFAULT '',
			payload LONGTEXT NOT NULL,
			status VARCHAR(16) NOT NULL DEFAULT 'pending',
			attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL,
			next_attempt_at DATETIME NOT NULL,
			lease_expires_at DATETIME NULL DEFAULT NULL,
			worker_token VARCHAR(32) NULL DEFAULT NULL,
			delivered_at DATETIME NULL DEFAULT NULL,
			outcome VARCHAR(16) NULL DEFAULT NULL,
			last_error TEXT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY event_id (event_id),
			KEY status_next (status, next_attempt_at),
			KEY created_at (created_at)
		) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Queues an event for delivery.
	 *
	 * @param array $event Event envelope.
	 * @return bool True when newly queued, false when already present or on error.
	 */
	public static function enqueue( array $event ) {
		global $wpdb;

		if ( empty( $event['event_id'] ) ) {
			return false;
		}

		/**
		 * Filters a server-side event immediately before it is queued.
		 *
		 * Return an empty array to drop the event entirely — useful for
		 * suppressing internal or test orders.
		 *
		 * @param array $event Event envelope.
		 */
		$event = (array) apply_filters( 'bap_before_enqueue', $event );
		if ( empty( $event ) || empty( $event['event_id'] ) ) {
			return false;
		}

		$payload = wp_json_encode( $event );
		if ( false === $payload ) {
			BAP_Logger::error( 'outbox: could not encode event ' . $event['event_id'] );
			return false;
		}

		$now = current_time( 'mysql', true );

		// INSERT IGNORE against the UNIQUE(event_id) index: the database, not
		// application logic, is what guarantees a single row per event.
		$table    = self::table();
		$inserted = $wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO {$table}
					(event_id, event_type, payload, status, attempts, created_at, next_attempt_at)
				VALUES (%s, %s, %s, %s, 0, %s, %s)",
				$event['event_id'],
				isset( $event['event_type'] ) ? $event['event_type'] : '',
				$payload,
				self::STATUS_PENDING,
				$now,
				$now
			)
		);

		if ( false === $inserted ) {
			BAP_Logger::error( 'outbox: insert failed for ' . $event['event_id'] . ' — ' . $wpdb->last_error );
			return false;
		}

		if ( 0 === (int) $inserted ) {
			BAP_Logger::debug( 'outbox: duplicate suppressed for ' . $event['event_id'] );
			BAP_Debug_Log::log(
				'queue',
				'Duplicate suppressed by the unique index',
				array(
					'event_id'   => $event['event_id'],
					'event_type' => isset( $event['event_type'] ) ? $event['event_type'] : '',
				)
			);
			return false;
		}

		BAP_Debug_Log::log(
			'queue',
			'Server-side event queued',
			array(
				'event_id'   => $event['event_id'],
				'event_type' => isset( $event['event_type'] ) ? $event['event_type'] : '',
			)
		);

		/**
		 * Fires after a server-side event is queued for delivery.
		 *
		 * @param array $event The full event envelope.
		 */
		do_action( 'bap_event_queued', $event );

		self::schedule_soon();
		return true;
	}

	/**
	 * Ensures the worker runs shortly.
	 *
	 * @return void
	 */
	public static function schedule_soon() {
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_single_event( time() + 10, self::CRON_HOOK );
		}
	}

	/**
	 * Delivers queued events.
	 *
	 * Claims a bounded batch with a lease so two overlapping cron runs cannot
	 * ship the same rows twice; even if they did, the collector would
	 * deduplicate them.
	 *
	 * @return array Summary counts.
	 */
	public static function process() {
		global $wpdb;

		$summary = array(
			'claimed'   => 0,
			'delivered' => 0,
			'retried'   => 0,
			'failed'    => 0,
			'purged'    => 0,
		);

		if ( ! BAP_Settings::is_configured() ) {
			return $summary;
		}

		// Housekeeping runs at most once an hour, not on every worker pass.
		if ( false === get_transient( 'bap_outbox_purged' ) ) {
			set_transient( 'bap_outbox_purged', 1, HOUR_IN_SECONDS );
			$summary['purged'] = self::purge_stale();
		}

		$table    = self::table();
		$now      = current_time( 'mysql', true );
		$lease_at = gmdate( 'Y-m-d H:i:s', time() + self::LEASE_SECONDS );
		$worker   = wp_generate_password( 12, false );

		// Claim: mark rows as sending and stamp them with this worker's token,
		// then read back exactly what we claimed.
		$claimed = $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$table}
				SET status = %s, lease_expires_at = %s, worker_token = %s
				WHERE (status = %s AND next_attempt_at <= %s)
				   OR (status = %s AND lease_expires_at IS NOT NULL AND lease_expires_at <= %s)
				ORDER BY created_at ASC
				LIMIT %d",
				self::STATUS_SENDING,
				$lease_at,
				$worker,
				self::STATUS_PENDING,
				$now,
				self::STATUS_SENDING,
				$now,
				self::BATCH_SIZE
			)
		);

		if ( ! $claimed ) {
			return $summary;
		}

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, event_id, payload, attempts FROM {$table}
				WHERE status = %s AND worker_token = %s
				ORDER BY created_at ASC",
				self::STATUS_SENDING,
				$worker
			),
			ARRAY_A
		);

		if ( empty( $rows ) ) {
			return $summary;
		}

		$summary['claimed'] = count( $rows );

		// One request per event, mirroring the browser queue. The rows were
		// claimed as a group because that is one database round trip; delivery
		// is individual because that is what the v3 wire contract is.
		foreach ( $rows as $row ) {
			$event = json_decode( $row['payload'], true );
			if ( ! is_array( $event ) ) {
				// Unreadable payload: nothing to retry, drop it rather than
				// looping forever.
				self::delete_ids( array( $row['event_id'] ) );
				continue;
			}
			self::deliver_one( $event, $row, $summary );
		}

		return $summary;
	}

	/**
	 * Sends one event and applies the answer.
	 *
	 * The settlement rule is the browser's, exactly: `stored`, `duplicate` and a
	 * non-retryable `rejected` all mean the row is finished with. Anything else
	 * keeps it, with the same `event_id` it has always had, so a repeat is
	 * recognisable rather than a second record.
	 *
	 * @param array $event   Decoded event envelope.
	 * @param array $row     The outbox row it came from.
	 * @param array $summary Running counters, modified in place.
	 * @return void
	 */
	private static function deliver_one( array $event, array $row, array &$summary ) {
		$event_id = (string) $row['event_id'];
		$by_id    = array( $event_id => $row );

		$result     = BAP_Transport::send_event( $event );
		$settlement = isset( $result['settlement'] ) ? $result['settlement'] : 'retry';

		if ( 'ذخیره‌شده' === $settlement || 'duplicate' === $settlement ) {
			/**
			 * Fires after events are acknowledged by the collector.
			 *
			 * @param string[] $settled Event ids the collector settled.
			 * @param array    $ack     The full acknowledgement.
			 */
			do_action( 'bap_events_delivered', array( $event_id ), isset( $result['ack'] ) ? $result['ack'] : array() );

			self::mark_delivered( array( $event_id ), $settlement );
			++$summary['delivered'];
			return;
		}

		if ( 'rejected' === $settlement ) {
			// Permanently invalid. Parked as failed rather than deleted so an
			// operator can see what the collector refused and why.
			$summary['failed'] += self::mark_failed( array( $event_id ), (string) $result['error'] );
			return;
		}

		/**
		 * Fires when a delivery attempt fails and will be retried.
		 *
		 * @param string[] $event_ids Event ids that stay queued.
		 * @param array    $result    Normalised transport result.
		 */
		do_action( 'bap_events_delivery_failed', array( $event_id ), $result );

		$summary['retried'] += self::reschedule(
			array( $event_id ),
			$by_id,
			(string) $result['error'],
			isset( $result['retry_after'] ) ? (int) $result['retry_after'] : 0
		);
	}

	/**
	 * Returns rows to the pending state with backoff.
	 *
	 * @param string[] $event_ids   Event ids.
	 * @param array    $by_id       Row data keyed by event id.
	 * @param string   $error       Failure description.
	 * @param int      $retry_after Server-requested delay in seconds.
	 * @return int Number of rows rescheduled.
	 */
	private static function reschedule( array $event_ids, array $by_id, $error, $retry_after ) {
		global $wpdb;
		$table = self::table();
		$count = 0;

		foreach ( $event_ids as $event_id ) {
			$attempts = isset( $by_id[ $event_id ] ) ? (int) $by_id[ $event_id ]['attempts'] + 1 : 1;

			if ( $attempts >= self::MAX_ATTEMPTS ) {
				self::mark_failed( array( $event_id ), $error );
				continue;
			}

			$index = min( $attempts - 1, count( self::$backoff ) - 1 );
			$delay = $retry_after > 0 ? $retry_after : self::$backoff[ $index ];

			$wpdb->update(
				$table,
				array(
					'status'           => self::STATUS_PENDING,
					'attempts'         => $attempts,
					'next_attempt_at'  => gmdate( 'Y-m-d H:i:s', time() + $delay ),
					'lease_expires_at' => null,
					'worker_token'     => null,
					'last_error'       => substr( (string) $error, 0, 500 ),
				),
				array( 'event_id' => $event_id ),
				array( '%s', '%d', '%s', '%s', '%s', '%s' ),
				array( '%s' )
			);
			++$count;
		}

		if ( $count ) {
			self::schedule_soon();
		}

		return $count;
	}

	/**
	 * Marks rows as permanently failed.
	 *
	 * @param string[] $event_ids Event ids.
	 * @param string   $error     Failure description.
	 * @return int
	 */
	private static function mark_failed( array $event_ids, $error ) {
		global $wpdb;
		$table = self::table();
		$count = 0;

		foreach ( $event_ids as $event_id ) {
			$wpdb->update(
				$table,
				array(
					'status'           => self::STATUS_FAILED,
					'lease_expires_at' => null,
					'worker_token'     => null,
					'last_error'       => substr( (string) $error, 0, 500 ),
				),
				array( 'event_id' => $event_id ),
				array( '%s', '%s', '%s', '%s' ),
				array( '%s' )
			);
			++$count;
		}

		if ( $count ) {
			BAP_Logger::error( 'outbox: ' . $count . ' event(s) failed permanently — ' . $error );
		}

		return $count;
	}

	/**
	 * Marks acknowledged rows as delivered.
	 *
	 * They are kept rather than deleted, for two reasons. The Event Inspector
	 * can then show what was actually sent instead of only what is stuck; and
	 * the UNIQUE(event_id) index keeps protecting against a re-fired hook for
	 * as long as the row survives, which deleting immediately would give up.
	 * `purge_stale()` clears them out later.
	 *
	 * @param string[] $event_ids Event ids.
	 * @param string   $outcome   `accepted` or `duplicate`.
	 * @return int
	 */
	private static function mark_delivered( array $event_ids, $outcome = 'accepted' ) {
		global $wpdb;
		if ( empty( $event_ids ) ) {
			return 0;
		}

		$table        = self::table();
		$placeholders = implode( ',', array_fill( 0, count( $event_ids ), '%s' ) );
		$args         = array_merge(
			array( self::STATUS_DONE, current_time( 'mysql', true ), $outcome ),
			$event_ids
		);

		return (int) $wpdb->query(
			// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $placeholders is one %s per id, and $args holds exactly those ids after the three leading values.
			$wpdb->prepare(
				"UPDATE {$table}
				SET status = %s, delivered_at = %s, outcome = %s,
				    lease_expires_at = NULL, worker_token = NULL
				WHERE event_id IN ({$placeholders})",
				$args
			)
		);
	}

	/**
	 * Deletes rows outright. Used for unreadable payloads and explicit purges.
	 *
	 * @param string[] $event_ids Event ids.
	 * @return int
	 */
	private static function delete_ids( array $event_ids ) {
		global $wpdb;
		if ( empty( $event_ids ) ) {
			return 0;
		}

		$table        = self::table();
		$placeholders = implode( ',', array_fill( 0, count( $event_ids ), '%s' ) );

		// phpcs:disable WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $placeholders is one %s per id, built from count( $event_ids ); the sniff cannot see them through the variable.
		return (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE event_id IN ({$placeholders})",
				$event_ids
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
	}

	/**
	 * Returns parked events to the queue.
	 *
	 * Events reach `failed` after exhausting their attempts, which almost
	 * always means the collector was misconfigured rather than the events being
	 * bad. Once an operator fixes the key or the URL, the data is still here and
	 * still deliverable — the attempt counter is reset so the backoff starts
	 * over.
	 *
	 * @return int Number of events requeued.
	 */
	public static function retry_failed() {
		global $wpdb;
		$table = self::table();

		$requeued = (int) $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$table}
				SET status = %s, attempts = 0, next_attempt_at = %s,
				    lease_expires_at = NULL, worker_token = NULL
				WHERE status = %s",
				self::STATUS_PENDING,
				current_time( 'mysql', true ),
				self::STATUS_FAILED
			)
		);

		if ( $requeued > 0 ) {
			self::schedule_soon();
			BAP_Logger::warn( 'outbox: ' . $requeued . ' failed event(s) requeued by an administrator' );
		}

		return $requeued;
	}

	/**
	 * Removes delivered-and-forgotten rows and anything past its useful life.
	 *
	 * Without this, a site that was misconfigured for a month keeps a month of
	 * undeliverable rows in `wp_bap_outbox` forever.
	 *
	 * @param int $max_age_days       Age beyond which a failed row is discarded.
	 * @param int $delivered_age_days Age beyond which a delivered row is discarded.
	 * @return int Rows removed.
	 */
	public static function purge_stale( $max_age_days = 30, $delivered_age_days = 7 ) {
		global $wpdb;
		$table = self::table();

		$failed_cutoff = gmdate( 'Y-m-d H:i:s', time() - ( (int) $max_age_days * DAY_IN_SECONDS ) );
		$done_cutoff   = gmdate( 'Y-m-d H:i:s', time() - ( (int) $delivered_age_days * DAY_IN_SECONDS ) );

		$removed = (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE status = %s AND created_at < %s",
				self::STATUS_FAILED,
				$failed_cutoff
			)
		);

		// Delivered rows keep protecting against a re-fired hook while they
		// live, so they are held for a week before being cleared.
		$removed += (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE status = %s AND delivered_at < %s",
				self::STATUS_DONE,
				$done_cutoff
			)
		);

		return $removed;
	}

	/**
	 * Recent events for the Event Inspector.
	 *
	 * @param array $filters `status`, `event_type`, `since`, `search`, `limit`, `offset`.
	 * @return array{rows:array,total:int}
	 */
	public static function recent( array $filters = array() ) {
		global $wpdb;
		$table = self::table();

		$where  = array( '1=1' );
		$params = array();

		if ( ! empty( $filters['status'] ) ) {
			$where[]  = 'status = %s';
			$params[] = $filters['status'];
		}
		if ( ! empty( $filters['event_type'] ) ) {
			$where[]  = 'event_type = %s';
			$params[] = $filters['event_type'];
		}
		if ( ! empty( $filters['since'] ) ) {
			$where[]  = 'created_at >= %s';
			$params[] = $filters['since'];
		}
		if ( ! empty( $filters['search'] ) ) {
			$where[]  = 'payload LIKE %s';
			$params[] = '%' . $wpdb->esc_like( $filters['search'] ) . '%';
		}

		$clause = implode( ' AND ', $where );
		$limit  = isset( $filters['limit'] ) ? max( 1, min( 200, (int) $filters['limit'] ) ) : 50;
		$offset = isset( $filters['offset'] ) ? max( 0, (int) $filters['offset'] ) : 0;

		// `$clause` is assembled above from literal fragments only — every value
		// the caller supplied went into `$params` as a placeholder — so the
		// composed strings are safe to hand to prepare(). PHPCS cannot follow
		// the composition through a variable, hence the narrow exclusions.
		// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared
		$count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$clause}";
		$total     = (int) ( $params
			? $wpdb->get_var( $wpdb->prepare( $count_sql, $params ) )
			: $wpdb->get_var( $count_sql ) );

		$rows_sql = "SELECT event_id, event_type, status, attempts, created_at, next_attempt_at,
			            delivered_at, outcome, last_error, payload
			     FROM {$table} WHERE {$clause}
			     ORDER BY created_at DESC LIMIT %d OFFSET %d";

		$rows = $wpdb->get_results(
			$wpdb->prepare( $rows_sql, array_merge( $params, array( $limit, $offset ) ) ),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.NotPrepared

		return array(
			'rows'  => is_array( $rows ) ? $rows : array(),
			'total' => $total,
		);
	}

	/**
	 * Distinct event types currently held, for the inspector's filter.
	 *
	 * @return string[]
	 */
	public static function known_event_types() {
		global $wpdb;
		$table = self::table();
		$types = $wpdb->get_col( "SELECT DISTINCT event_type FROM {$table} ORDER BY event_type ASC" );
		return is_array( $types ) ? array_filter( $types ) : array();
	}

	/**
	 * Queue statistics for the admin screen.
	 *
	 * @return array
	 */
	public static function stats() {
		global $wpdb;
		$table = self::table();

		$rows = $wpdb->get_results(
			"SELECT status, COUNT(*) AS total FROM {$table} GROUP BY status",
			ARRAY_A
		);

		$stats = array(
			self::STATUS_PENDING => 0,
			self::STATUS_SENDING => 0,
			self::STATUS_FAILED  => 0,
			self::STATUS_DONE    => 0,
		);
		foreach ( (array) $rows as $row ) {
			$stats[ $row['status'] ] = (int) $row['total'];
		}
		return $stats;
	}
}
