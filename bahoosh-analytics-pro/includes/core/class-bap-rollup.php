<?php
/**
 * Local behavioural rollups.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * A small, bounded table of daily counters — never raw events.
 *
 * The outbox is a delivery queue: it holds an event until the collector
 * acknowledges it and then discards it. That is correct for delivery and
 * useless for analysis, so until now the plugin could not answer "where do
 * people abandon checkout?" without asking the collector.
 *
 * This table closes that gap without becoming a second analytics database.
 * Nothing individual is stored. One row is one bucket:
 *
 *     day × device × step × page
 *
 * and the only column that changes is a counter. A busy shop produces a few
 * thousand rows a month rather than millions, the table is cheap to query, and
 * no personal data reaches it at all — there is no visitor id, no session, no
 * IP, nothing that could identify a person even in principle. That is the point
 * of aggregating at write time rather than at read time: the privacy property
 * is structural, not a promise.
 *
 * @since 4.3.0
 */
class BAP_Rollup {

	const TABLE = 'bap_rollup';

	/**
	 * Funnel steps, in the order a shopper passes through them.
	 *
	 * Deliberately short. A funnel with twenty steps measures nothing, and every
	 * step here maps to an event the tracker already emits.
	 *
	 * @var string[]
	 */
	const STEPS = array(
		'view_item',
		'add_to_cart',
		'view_cart',
		'begin_checkout',
		'add_payment_info',
		'purchase',
	);

	/**
	 * Device classes. Anything unrecognised becomes `unknown` rather than being
	 * guessed into one of the real buckets.
	 *
	 * @var string[]
	 */
	const DEVICES = array( 'mobile', 'tablet', 'desktop', 'unknown' );

	/**
	 * Rows kept before pruning. Roughly two years for a typical shop.
	 *
	 * @var int
	 */
	const MAX_ROWS = 200000;

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
	 * Creates the table.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;

		$table   = self::table();
		$charset = $wpdb->get_charset_collate();

		// The unique key is the whole bucket identity, which is what makes
		// recording an event a single upsert with no read-modify-write and no
		// race between concurrent visitors.
		$sql = "CREATE TABLE {$table} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			bucket_date DATE NOT NULL,
			device VARCHAR(16) NOT NULL DEFAULT 'unknown',
			step VARCHAR(32) NOT NULL DEFAULT '',
			page_path VARCHAR(190) NOT NULL DEFAULT '',
			hits BIGINT UNSIGNED NOT NULL DEFAULT 0,
			value_sum DECIMAL(18,4) NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY bucket (bucket_date, device, step, page_path),
			KEY date_step (bucket_date, step),
			KEY step_device (step, device)
		) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Records one observation into its bucket.
	 *
	 * @param string $step      Funnel step.
	 * @param string $device    Device class.
	 * @param string $page_path Page path, already normalised.
	 * @param float  $value     Monetary value, for purchase steps.
	 * @param string $day       Y-m-d in site time. Defaults to today.
	 * @return bool True when a row was written.
	 */
	public static function record( $step, $device, $page_path = '', $value = 0.0, $day = '' ) {
		global $wpdb;

		$step = (string) $step;
		if ( ! in_array( $step, self::STEPS, true ) ) {
			return false;
		}

		$device = self::normalize_device( $device );
		$path   = self::normalize_path( $page_path );
		$day    = '' !== $day ? $day : self::today();
		$value  = max( 0, (float) $value );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the table name is the plugin's own.
		// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom table, and a counter must not be cached.
		$table = self::table();

		// One statement, no read first. Two visitors hitting the same step in
		// the same second increment the same row correctly rather than racing.
		$rows = $wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$table} (bucket_date, device, step, page_path, hits, value_sum, updated_at)
				VALUES (%s, %s, %s, %s, 1, %f, %s)
				ON DUPLICATE KEY UPDATE hits = hits + 1, value_sum = value_sum + %f, updated_at = %s",
				$day,
				$device,
				$step,
				$path,
				$value,
				current_time( 'mysql', true ),
				$value,
				current_time( 'mysql', true )
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		return false !== $rows;
	}

	/**
	 * Records a validated event, if it is one the funnel cares about.
	 *
	 * Called from the ingest route with an event that has already passed
	 * validation, so the shape is known and nothing here needs to re-check it.
	 * Events outside {@see self::STEPS} are ignored silently: this is a funnel,
	 * not a log, and a scroll event has no place in it.
	 *
	 * @since 4.3.0
	 *
	 * @param array $event Validated event envelope.
	 * @return bool True when a bucket was incremented.
	 */
	public static function observe( array $event ) {
		$step = isset( $event['event_type'] ) ? (string) $event['event_type'] : '';

		if ( ! in_array( $step, self::STEPS, true ) ) {
			return false;
		}

		$device = isset( $event['context']['device_type'] ) ? $event['context']['device_type'] : '';
		$path   = isset( $event['page']['path'] ) && '' !== $event['page']['path']
			? $event['page']['path']
			: ( $event['page']['url'] ?? '' );

		// Only a purchase carries money. Reading a "value" from any other step
		// would inflate the totals with cart subtotals that were never paid.
		$value = 0.0;
		if ( 'purchase' === $step && isset( $event['data']['value'] ) && is_numeric( $event['data']['value'] ) ) {
			$value = (float) $event['data']['value'];
		}

		return self::record( $step, $device, $path, $value );
	}

	/**
	 * Funnel totals for a period, optionally split by device.
	 *
	 * @param string $from     Y-m-d.
	 * @param string $to       Y-m-d.
	 * @param bool   $by_device Whether to split by device.
	 * @return array Step => hits, or step => device => hits.
	 */
	public static function funnel( $from, $to, $by_device = false ) {
		global $wpdb;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$table = self::table();

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT step, device, SUM(hits) AS hits, SUM(value_sum) AS value_sum
				FROM {$table}
				WHERE bucket_date BETWEEN %s AND %s
				GROUP BY step, device",
				$from,
				$to
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		$out = array();

		foreach ( self::STEPS as $step ) {
			$out[ $step ] = $by_device ? array_fill_keys( self::DEVICES, 0 ) : 0;
		}

		foreach ( (array) $rows as $row ) {
			$step = (string) $row['step'];
			if ( ! isset( $out[ $step ] ) ) {
				continue;
			}
			if ( $by_device ) {
				$device                  = self::normalize_device( $row['device'] );
				$out[ $step ][ $device ] = ( $out[ $step ][ $device ] ?? 0 ) + (int) $row['hits'];
			} else {
				$out[ $step ] += (int) $row['hits'];
			}
		}

		return $out;
	}

	/**
	 * The pages where a given step happened most often.
	 *
	 * Used to answer "which page did they abandon on": the exit page of the last
	 * step a shopper reached is far more actionable than knowing only that the
	 * funnel narrowed.
	 *
	 * @param string $step  Funnel step.
	 * @param string $from  Y-m-d.
	 * @param string $to    Y-m-d.
	 * @param int    $limit Maximum pages.
	 * @return array<int,array{page_path:string,hits:int}>
	 */
	public static function top_pages_for_step( $step, $from, $to, $limit = 10 ) {
		global $wpdb;

		if ( ! in_array( (string) $step, self::STEPS, true ) ) {
			return array();
		}

		$limit = max( 1, min( 100, (int) $limit ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$table = self::table();

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT page_path, SUM(hits) AS hits
				FROM {$table}
				WHERE step = %s AND bucket_date BETWEEN %s AND %s AND page_path <> ''
				GROUP BY page_path
				ORDER BY hits DESC
				LIMIT %d",
				$step,
				$from,
				$to,
				$limit
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		$out = array();
		foreach ( (array) $rows as $row ) {
			$out[] = array(
				'page_path' => (string) $row['page_path'],
				'hits'      => (int) $row['hits'],
			);
		}

		return $out;
	}

	/**
	 * Whether the table holds enough data to say anything.
	 *
	 * A funnel built from eleven sessions is noise wearing a chart's clothes, so
	 * callers ask this before drawing conclusions.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return int Total observations in the window.
	 */
	public static function volume( $from, $to ) {
		global $wpdb;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$table = self::table();

		$total = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT SUM(hits) FROM {$table} WHERE bucket_date BETWEEN %s AND %s",
				$from,
				$to
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		return (int) $total;
	}

	/**
	 * Drops the oldest buckets once the table exceeds its cap.
	 *
	 * @return int Rows removed.
	 */
	public static function prune() {
		global $wpdb;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$table = self::table();

		$count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );

		if ( $count <= self::MAX_ROWS ) {
			return 0;
		}

		// Oldest days go first: a two-year-old funnel is history, this month's
		// is a decision.
		$removed = (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} ORDER BY bucket_date ASC LIMIT %d",
				$count - self::MAX_ROWS
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		return $removed;
	}

	/**
	 * Today in the site's timezone.
	 *
	 * Site time, not UTC: an administrator comparing "today" against their own
	 * shop's day would otherwise see the wrong bucket for several hours.
	 *
	 * @return string Y-m-d.
	 */
	public static function today() {
		return (string) current_time( 'Y-m-d' );
	}

	/**
	 * Maps anything to one of the known device classes.
	 *
	 * @param mixed $device Raw device value.
	 * @return string
	 */
	public static function normalize_device( $device ) {
		$device = strtolower( trim( (string) $device ) );
		return in_array( $device, self::DEVICES, true ) ? $device : 'unknown';
	}

	/**
	 * Reduces a URL to a storable path.
	 *
	 * Query strings are dropped. They carry session ids, coupon codes and
	 * tracking parameters, none of which belong in a table that is meant to hold
	 * nothing identifying — and `/checkout` is the answer an administrator
	 * wants, not `/checkout?token=…`.
	 *
	 * @param string $value URL or path.
	 * @return string
	 */
	public static function normalize_path( $value ) {
		$value = (string) $value;

		if ( '' === $value ) {
			return '';
		}

		$path = wp_parse_url( $value, PHP_URL_PATH );
		$path = is_string( $path ) && '' !== $path ? $path : $value;

		$path = strtok( $path, '?' );
		$path = strtok( $path, '#' );
		$path = '/' . ltrim( (string) $path, '/' );

		// Numeric ids collapse so that a thousand product URLs do not become a
		// thousand buckets that each say nothing.
		$path = (string) preg_replace( '#/\d+(?=/|$)#', '/{id}', $path );

		return substr( sanitize_text_field( $path ), 0, 190 );
	}
}
