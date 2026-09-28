<?php
/**
 * Pre-computed daily totals.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Closes each day's books once, so reports stop re-reading raw events.
 *
 * The event table answers every question exactly, and that is the problem: a
 * shop with ten thousand visits a day fills it faster than any report can read
 * it. Two months in, a thirty-day range exceeds the hundred-thousand-row cap
 * that keeps a report from exhausting PHP's memory, and the dashboard starts
 * telling the owner to pick a shorter window — on the very shop that has enough
 * traffic to be worth analysing.
 *
 * This class writes one row per finished day and lets a range be answered by
 * adding those rows together. The point to be careful about is that **the
 * numbers must not change.** A summary that quietly approximates is worse than
 * a slow report, because nobody can tell it is wrong.
 *
 * Two of the dashboard's figures cannot simply be added across days, and each
 * is handled rather than rounded off:
 *
 * - **Unique visitors.** Somebody who came on Monday and again on Tuesday is
 *   one visitor over the week and two if the daily counts are summed. So the
 *   identifiers are kept, one row per visitor per day, and a range counts the
 *   distinct ones. That table is roughly a thousandth the size of the event
 *   table on a busy shop, because it holds a visitor once a day rather than
 *   once an event.
 *
 * - **Sessions.** A session is a visitor's events split wherever they went
 *   quiet for longer than the inactivity gap, and one that starts at 23:50 and
 *   ends at 00:10 belongs to both days. Each visitor-day therefore records both
 *   its own session count and whether its first event merely continued the
 *   previous day's last session. A range is then the sum of the counts minus
 *   the continuations inside it, which is exactly what counting the raw
 *   timeline would have produced.
 *
 * Today is never summarised: it is not over, so it is always computed live and
 * merged with the closed days behind it.
 *
 * @since 4.10.0
 */
class BAP_Daily_Summary {

	const TABLE_DAYS     = 'bap_daily_summary';
	const TABLE_VISITORS = 'bap_daily_visitors';

	/**
	 * Days summarised in one pass.
	 *
	 * A site that has been collecting for months before this table existed
	 * backfills a fortnight per run rather than trying to rebuild a year inside
	 * one cron tick.
	 *
	 * @var int
	 */
	const BACKFILL_DAYS = 14;

	/**
	 * Rows kept in each breakdown.
	 *
	 * @var int
	 */
	const BREAKDOWN_ROWS = 40;

	/**
	 * Table name for the daily totals.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;

		return $wpdb->prefix . self::TABLE_DAYS;
	}

	/**
	 * Table name for the visitor-day index.
	 *
	 * @return string
	 */
	public static function visitors_table() {
		global $wpdb;

		return $wpdb->prefix . self::TABLE_VISITORS;
	}

	/**
	 * Creates both tables.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$collate  = $wpdb->get_charset_collate();
		$days     = self::table();
		$visitors = self::visitors_table();

		$sql = "CREATE TABLE {$days} (
			bucket_date DATE NOT NULL,
			events BIGINT UNSIGNED NOT NULL DEFAULT 0,
			page_views BIGINT UNSIGNED NOT NULL DEFAULT 0,
			searches BIGINT UNSIGNED NOT NULL DEFAULT 0,
			purchases BIGINT UNSIGNED NOT NULL DEFAULT 0,
			revenue DECIMAL(18,4) NOT NULL DEFAULT 0,
			visitors INT UNSIGNED NOT NULL DEFAULT 0,
			sessions INT UNSIGNED NOT NULL DEFAULT 0,
			continued INT UNSIGNED NOT NULL DEFAULT 0,
			breakdowns LONGTEXT NULL,
			built_at DATETIME NOT NULL,
			PRIMARY KEY  (bucket_date)
		) {$collate};";

		dbDelta( $sql );

		// One row per visitor per day. The unique key is what makes rebuilding a
		// day idempotent, and what lets a range count distinct people exactly.
		$sql = "CREATE TABLE {$visitors} (
			bucket_date DATE NOT NULL,
			anonymous_id VARCHAR(64) NOT NULL,
			sessions SMALLINT UNSIGNED NOT NULL DEFAULT 0,
			continued TINYINT UNSIGNED NOT NULL DEFAULT 0,
			PRIMARY KEY  (bucket_date, anonymous_id),
			KEY visitor (anonymous_id)
		) {$collate};";

		dbDelta( $sql );
	}

	/**
	 * Summarises one finished day.
	 *
	 * @param string $date Y-m-d.
	 * @return bool Whether a row was written.
	 */
	public static function build_day( $date ) {
		global $wpdb;

		$date = BAP_Reports::sanitize_date( $date );

		if ( '' === $date || $date >= gmdate( 'Y-m-d' ) ) {
			// Today is still being written to. Summarising it would freeze a
			// partial day into a table the reports treat as final.
			return false;
		}

		$totals = self::compute( $date );

		$wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				'INSERT INTO ' . self::table() . ' (bucket_date, events, page_views, searches, purchases, revenue, visitors, sessions, continued, breakdowns, built_at)
				 VALUES (%s, %d, %d, %d, %d, %f, %d, %d, %d, %s, %s)
				 ON DUPLICATE KEY UPDATE events = VALUES(events), page_views = VALUES(page_views),
				   searches = VALUES(searches), purchases = VALUES(purchases), revenue = VALUES(revenue),
				   visitors = VALUES(visitors), sessions = VALUES(sessions), continued = VALUES(continued),
				   breakdowns = VALUES(breakdowns), built_at = VALUES(built_at)',
				$date,
				$totals['events'],
				$totals['page_views'],
				$totals['searches'],
				$totals['purchases'],
				$totals['revenue'],
				$totals['visitors'],
				$totals['sessions'],
				$totals['continued'],
				wp_json_encode( $totals['breakdowns'] ),
				gmdate( 'Y-m-d H:i:s' )
			)
		);

		self::store_visitors( $date, $totals['per_visitor'] );

		return true;
	}

	/**
	 * Computes one day's totals from raw events.
	 *
	 * Deliberately the same arithmetic {@see BAP_Local_Reports::metrics()} does
	 * live, because the whole value of this table rests on the two agreeing.
	 *
	 * @param string $date Y-m-d.
	 * @return array
	 */
	private static function compute( $date ) {
		$rows = BAP_Local_Store::events( $date, $date )['rows'];

		$pages      = array();
		$sources    = array();
		$devices    = array();
		$types      = array();
		$timeline   = array();
		$events     = 0;
		$page_views = 0;
		$searches   = 0;
		$purchases  = 0;
		$revenue    = 0.0;

		foreach ( $rows as $row ) {
			$type    = (string) $row['event_type'];
			$visitor = (string) $row['anonymous_id'];

			$events++;
			$types[ $type ] = ( $types[ $type ] ?? 0 ) + 1;

			$device             = '' !== $row['device'] ? (string) $row['device'] : 'unknown';
			$devices[ $device ] = ( $devices[ $device ] ?? 0 ) + 1;

			if ( '' !== $visitor ) {
				$timeline[ $visitor ][] = strtotime( (string) $row['occurred_at'] . ' UTC' );
			}

			if ( 'page_view' === $type ) {
				$page_views++;

				$path           = '' !== $row['page_path'] ? (string) $row['page_path'] : '/';
				$pages[ $path ] = ( $pages[ $path ] ?? 0 ) + 1;

				$source = '' !== $row['referrer_host'] ? (string) $row['referrer_host'] : 'direct';
				if ( ! isset( $sources[ $source ] ) ) {
					$sources[ $source ] = array();
				}
				if ( '' !== $visitor ) {
					$sources[ $source ][ $visitor ] = true;
				}
			}

			if ( 'search' === $type ) {
				$searches++;
			}

			if ( 'purchase' === $type ) {
				$purchases++;
				$revenue += (float) $row['value'];
			}
		}

		$previous    = self::visitor_last_seen( gmdate( 'Y-m-d', strtotime( $date . ' -1 day' ) ) );
		$gap         = BAP_Local_Reports::SESSION_GAP_MINUTES * MINUTE_IN_SECONDS;
		$per_visitor = array();
		$sessions    = 0;
		$continued   = 0;

		foreach ( $timeline as $visitor => $stamps ) {
			sort( $stamps );

			$count = 0;
			$last  = null;

			foreach ( $stamps as $stamp ) {
				if ( null === $last || ( $stamp - $last ) > $gap ) {
					$count++;
				}
				$last = $stamp;
			}

			// Did this visitor's first event today simply continue what they
			// were doing before midnight? If so the two days share a session,
			// and a range covering both must not count it twice.
			$carried = isset( $previous[ $visitor ] ) && ( $stamps[0] - $previous[ $visitor ] ) <= $gap ? 1 : 0;

			$per_visitor[ $visitor ] = array(
				'sessions'  => $count,
				'continued' => $carried,
			);

			$sessions  += $count;
			$continued += $carried;
		}

		arsort( $pages );
		arsort( $devices );
		arsort( $types );

		$source_counts = array_map( 'count', $sources );
		arsort( $source_counts );

		return array(
			'events'      => $events,
			'page_views'  => $page_views,
			'searches'    => $searches,
			'purchases'   => $purchases,
			'revenue'     => round( $revenue, 4 ),
			'visitors'    => count( $timeline ),
			'sessions'    => $sessions,
			'continued'   => $continued,
			'per_visitor' => $per_visitor,
			'breakdowns'  => array(
				'pages'   => array_slice( $pages, 0, self::BREAKDOWN_ROWS, true ),
				'sources' => array_slice( $source_counts, 0, self::BREAKDOWN_ROWS, true ),
				'devices' => $devices,
				'types'   => array_slice( $types, 0, self::BREAKDOWN_ROWS, true ),
			),
		);
	}

	/**
	 * The last moment each visitor was seen on a day.
	 *
	 * @param string $date Y-m-d.
	 * @return array<string,int>
	 */
	private static function visitor_last_seen( $date ) {
		$last = array();

		foreach ( BAP_Local_Store::events( $date, $date )['rows'] as $row ) {
			$visitor = (string) $row['anonymous_id'];

			if ( '' === $visitor ) {
				continue;
			}

			$stamp = strtotime( (string) $row['occurred_at'] . ' UTC' );

			if ( ! isset( $last[ $visitor ] ) || $stamp > $last[ $visitor ] ) {
				$last[ $visitor ] = $stamp;
			}
		}

		return $last;
	}

	/**
	 * Replaces a day's visitor rows.
	 *
	 * @param string $date        Y-m-d.
	 * @param array  $per_visitor Visitor => {sessions, continued}.
	 * @return void
	 */
	private static function store_visitors( $date, array $per_visitor ) {
		global $wpdb;

		$table = self::visitors_table();

		// Cleared first so rebuilding a day cannot leave behind a visitor who is
		// no longer in it — after a retention prune, for instance.
		$wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
			$wpdb->prepare( "DELETE FROM {$table} WHERE bucket_date = %s", $date )
		);

		if ( ! $per_visitor ) {
			return;
		}

		// Written in chunks: one statement per visitor would be thousands of
		// round trips for a single day on a busy shop.
		foreach ( array_chunk( $per_visitor, 200, true ) as $chunk ) {
			$values = array();
			$args   = array();

			foreach ( $chunk as $visitor => $counts ) {
				$values[] = '(%s, %s, %d, %d)';
				array_push( $args, $date, (string) $visitor, (int) $counts['sessions'], (int) $counts['continued'] );
			}

			$wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- placeholders are built from a counted array.
					"INSERT INTO {$table} (bucket_date, anonymous_id, sessions, continued) VALUES " . implode( ', ', $values ) .
					' ON DUPLICATE KEY UPDATE sessions = VALUES(sessions), continued = VALUES(continued)',
					$args
				)
			);
		}
	}

	/**
	 * Totals for a range of finished days.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d, inclusive.
	 * @return array|null Null when the range is not fully summarised.
	 */
	public static function range( $from, $to ) {
		global $wpdb;

		$from = BAP_Reports::sanitize_date( $from );
		$to   = BAP_Reports::sanitize_date( $to );

		if ( '' === $from || '' === $to || $to < $from ) {
			return null;
		}

		$table = self::table();

		$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				"SELECT * FROM {$table} WHERE bucket_date >= %s AND bucket_date <= %s ORDER BY bucket_date ASC",
				$from,
				$to
			),
			ARRAY_A
		);

		$rows = is_array( $rows ) ? $rows : array();

		// Every day in the window must be present. A missing day is not a small
		// error: it silently removes a whole day's traffic from the totals, and
		// the reader has no way to notice.
		$expected = (int) round( ( strtotime( $to . ' UTC' ) - strtotime( $from . ' UTC' ) ) / DAY_IN_SECONDS ) + 1;

		if ( count( $rows ) < $expected ) {
			return null;
		}

		$totals = array(
			'events'     => 0,
			'page_views' => 0,
			'searches'   => 0,
			'purchases'  => 0,
			'revenue'    => 0.0,
			'sessions'   => 0,
			'continued'  => 0,
			'pages'      => array(),
			'sources'    => array(),
			'devices'    => array(),
			'types'      => array(),
			'daily'      => array(),
		);

		$first = true;

		foreach ( $rows as $row ) {
			$totals['events']     += (int) $row['events'];
			$totals['page_views'] += (int) $row['page_views'];
			$totals['searches']   += (int) $row['searches'];
			$totals['purchases']  += (int) $row['purchases'];
			$totals['revenue']    += (float) $row['revenue'];
			$totals['sessions']   += (int) $row['sessions'];

			// A continuation only cancels a session when the day it continues
			// from is inside the range. On the first day the previous day is
			// outside it, so that session genuinely starts here.
			if ( ! $first ) {
				$totals['continued'] += (int) $row['continued'];
			}

			$first = false;

			$breakdowns = json_decode( (string) $row['breakdowns'], true );
			$breakdowns = is_array( $breakdowns ) ? $breakdowns : array();

			foreach ( array( 'pages', 'sources', 'devices', 'types' ) as $key ) {
				foreach ( (array) ( $breakdowns[ $key ] ?? array() ) as $label => $count ) {
					$totals[ $key ][ $label ] = ( $totals[ $key ][ $label ] ?? 0 ) + (int) $count;
				}
			}

			$totals['daily'][ (string) $row['bucket_date'] ] = array(
				'events'     => (int) $row['events'],
				'page_views' => (int) $row['page_views'],
				'users'      => (int) $row['visitors'],
			);
		}

		$totals['sessions'] = max( 0, $totals['sessions'] - $totals['continued'] );
		$totals['visitors'] = self::distinct_visitors( $from, $to );

		return $totals;
	}

	/**
	 * Distinct visitors across a range.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return int
	 */
	private static function distinct_visitors( $from, $to ) {
		global $wpdb;

		$table = self::visitors_table();

		return (int) $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				"SELECT COUNT(DISTINCT anonymous_id) FROM {$table} WHERE bucket_date >= %s AND bucket_date <= %s",
				$from,
				$to
			)
		);
	}

	/**
	 * Builds any finished day that has not been summarised yet.
	 *
	 * @return int Days built.
	 */
	public static function build_pending() {
		$built = 0;

		for ( $age = 1; $age <= self::BACKFILL_DAYS; $age++ ) {
			$date = gmdate( 'Y-m-d', time() - ( $age * DAY_IN_SECONDS ) );

			if ( self::has_day( $date ) ) {
				continue;
			}

			// Nothing to summarise for a day with no events: recording an empty
			// row would still be correct, and it is what stops the range check
			// from rejecting a quiet week.
			self::build_day( $date );
			$built++;
		}

		return $built;
	}

	/**
	 * Whether a day is already summarised.
	 *
	 * @param string $date Y-m-d.
	 * @return bool
	 */
	public static function has_day( $date ) {
		global $wpdb;

		$table = self::table();

		return (bool) $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				"SELECT 1 FROM {$table} WHERE bucket_date = %s",
				BAP_Reports::sanitize_date( $date )
			)
		);
	}

	/**
	 * Drops summaries past their retention.
	 *
	 * Kept for longer than the raw events they came from — that is the point of
	 * them. A shop can lose the individual events of a year ago and still chart
	 * the year.
	 *
	 * @return void
	 */
	public static function prune() {
		global $wpdb;

		$days = (int) BAP_Settings::get( 'summary_retention_days', 730 );
		$days = max( 30, $days );

		$cutoff = gmdate( 'Y-m-d', time() - ( $days * DAY_IN_SECONDS ) );

		foreach ( array( self::table(), self::visitors_table() ) as $table ) {
			$wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				$wpdb->prepare( "DELETE FROM {$table} WHERE bucket_date < %s", $cutoff )
			);
		}
	}

	/**
	 * How many days are summarised, for the diagnostics screen.
	 *
	 * @return array{days:int,first:string}
	 */
	public static function status() {
		global $wpdb;

		$table = self::table();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
		$row = $wpdb->get_row( "SELECT COUNT(*) AS days, MIN(bucket_date) AS first FROM {$table}", ARRAY_A );

		return array(
			'days'  => (int) ( $row['days'] ?? 0 ),
			'first' => (string) ( $row['first'] ?? '' ),
		);
	}
}
