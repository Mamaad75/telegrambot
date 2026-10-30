<?php
/**
 * Click and scroll density, aggregated into a grid.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * The store behind the heatmap.
 *
 * The tracker has always sent click coordinates — `page_x`, `page_y` and the
 * viewport width that makes them comparable — and `BAP_Local_Store::record()`
 * has always dropped them, because its table has no column for them. So the
 * data existed on the wire and nowhere else. This class is the missing half.
 *
 * It does not keep clicks. It keeps a *count grid*: the page is divided into
 * {@see self::COLS} columns across its width and bands of {@see self::BAND_PX}
 * pixels down its length, and one cell's counter is incremented per click. That
 * choice is deliberate on three grounds:
 *
 * - Size. One click row per click would grow without limit on a busy shop, and
 *   would be pruned away with everything else exactly when the heatmap became
 *   worth looking at. A grid is bounded by the page's own dimensions: a very
 *   long page tops out in the low thousands of cells per device, and most pages
 *   touch a few hundred.
 * - Speed. Each click is one upsert with no read first, so concurrent visitors
 *   increment the same cell correctly instead of racing.
 * - Privacy. A single visitor's click path cannot be reconstructed from a
 *   counter. There is no visitor id in this table and no timestamp per click,
 *   only a cell and how many times anyone landed in it.
 *
 * The x axis is stored as a *fraction* of the viewport width, because a click
 * 300px from the left edge is near the middle of a phone and in the gutter of a
 * desktop. The y axis is stored in absolute document pixels, because a page
 * flows downward and content 2000px down is 2000px down. Reflow does move things
 * vertically between widths, which is why every cell is also filed under a
 * device class and the admin screen only ever draws one class at a time.
 *
 * @since 4.19.0
 */
class BAP_Heatmap {

	/**
	 * Table name, without the site prefix.
	 *
	 * @var string
	 */
	const TABLE = 'bap_heatmap';

	/**
	 * Columns the page width is divided into.
	 *
	 * Forty gives 2.5% per column, which at a 1280px render is 32px — finer
	 * than a finger and about the width of an icon button. Going finer spreads
	 * the same clicks over more cells and makes a quiet page look empty.
	 *
	 * @var int
	 */
	const COLS = 40;

	/**
	 * Height of one y band, in document pixels.
	 *
	 * @var int
	 */
	const BAND_PX = 40;

	/**
	 * Highest document position recorded, in pixels.
	 *
	 * Past this a click is ignored rather than clamped into the last band:
	 * 60,000px is longer than any real page, so a coordinate beyond it is a
	 * broken client or a forged payload, and piling those into one cell would
	 * paint a hotspot at the bottom of the page that nobody ever clicked.
	 *
	 * @var int
	 */
	const MAX_Y = 60000;

	/**
	 * Scroll depths the tracker reports.
	 *
	 * @var int[]
	 */
	const DEPTHS = array( 25, 50, 75, 100 );

	/**
	 * Row ceiling, past which the least-visited pages are dropped.
	 *
	 * @var int
	 */
	const MAX_ROWS = 400000;

	/**
	 * Pages kept when pruning.
	 *
	 * @var int
	 */
	const MAX_PAGES = 200;

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
	 * Creates or updates the table.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$collate = $wpdb->get_charset_collate();

		// The unique key is the cell's whole identity, which is what lets a
		// click be recorded as one statement with no read-modify-write.
		$sql = "CREATE TABLE {$table} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			page_path VARCHAR(190) NOT NULL DEFAULT '',
			device VARCHAR(16) NOT NULL DEFAULT 'unknown',
			kind VARCHAR(8) NOT NULL DEFAULT 'click',
			grid_x SMALLINT UNSIGNED NOT NULL DEFAULT 0,
			grid_y SMALLINT UNSIGNED NOT NULL DEFAULT 0,
			hits BIGINT UNSIGNED NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY cell (page_path, device, kind, grid_x, grid_y),
			KEY page_kind (page_path, kind, device),
			KEY kind_hits (kind, hits)
		) {$collate};";

		dbDelta( $sql );
	}

	/**
	 * Records a validated event, if it carries anything the heatmap can use.
	 *
	 * Three event types matter. A click contributes a cell. A scroll milestone
	 * contributes a depth counter. A page view contributes the denominator
	 * without which a depth counter means nothing — "180 visitors reached
	 * halfway" is a fact; "60% of visitors reached halfway" is the answer, and
	 * it needs the page's view count held in the same table so the two are
	 * pruned together and can never drift apart.
	 *
	 * Everything else is ignored silently. This is a density grid, not a log.
	 *
	 * @param array $event Validated event envelope.
	 * @return bool True when a cell was incremented.
	 */
	public static function observe( array $event ) {
		if ( ! BAP_Settings::get( 'module_heatmap', true ) ) {
			return false;
		}

		$type = isset( $event['event_type'] ) ? (string) $event['event_type'] : '';
		if ( ! in_array( $type, array( 'click', 'scroll', 'page_view' ), true ) ) {
			return false;
		}

		$page = isset( $event['page'] ) && is_array( $event['page'] ) ? $event['page'] : array();
		$path = isset( $page['path'] ) && '' !== $page['path']
			? (string) $page['path']
			: (string) ( $page['url'] ?? '' );
		$path = BAP_Rollup::normalize_path( $path );

		// A cell with no page to belong to cannot be drawn on anything.
		if ( '' === $path ) {
			return false;
		}

		$context = isset( $event['context'] ) && is_array( $event['context'] ) ? $event['context'] : array();
		$device  = BAP_Rollup::normalize_device( (string) ( $context['device_type'] ?? '' ) );
		$data    = isset( $event['data'] ) && is_array( $event['data'] ) ? $event['data'] : array();

		if ( 'page_view' === $type ) {
			return self::bump( $path, $device, 'view', 0, 0 );
		}

		if ( 'scroll' === $type ) {
			$depth = isset( $data['depth_percent'] ) ? (int) $data['depth_percent'] : 0;
			if ( ! in_array( $depth, self::DEPTHS, true ) ) {
				return false;
			}

			return self::bump( $path, $device, 'scroll', 0, $depth );
		}

		return self::record_click( $path, $device, $context, $data );
	}

	/**
	 * Places one click in its cell.
	 *
	 * @param string $path    Normalised page path.
	 * @param string $device  Device class.
	 * @param array  $context Event context.
	 * @param array  $data    Event data.
	 * @return bool
	 */
	private static function record_click( $path, $device, array $context, array $data ) {
		$width = isset( $context['viewport_width'] ) ? (int) $context['viewport_width'] : 0;

		// Without the width the click was measured against, an x coordinate
		// cannot be placed: 300px is the middle of a phone and the margin of a
		// desktop. A click that arrives without one is dropped rather than
		// assigned a width that was guessed, which would move a real hotspot to
		// somewhere nobody clicked.
		if ( $width < 1 ) {
			return false;
		}

		$x = self::coordinate( $data, 'page_x', 'mouse_x' );
		$y = self::coordinate( $data, 'page_y', 'mouse_y' );

		if ( null === $x || null === $y ) {
			return false;
		}

		// Negative coordinates come from clicks dispatched by scripts rather
		// than people — a synthetic `click()` reports 0,0 — and from the odd
		// browser quirk. Neither is a place on the page.
		if ( $x < 0 || $y < 0 || $y > self::MAX_Y ) {
			return false;
		}

		$col = (int) floor( ( $x / $width ) * self::COLS );
		$col = max( 0, min( self::COLS - 1, $col ) );
		$row = (int) floor( $y / self::BAND_PX );

		return self::bump( $path, $device, 'click', $col, $row );
	}

	/**
	 * Reads a coordinate, preferring the document-relative one.
	 *
	 * `page_y` is measured from the top of the document and `mouse_y` from the
	 * top of the viewport. The heatmap is drawn over a whole page, so the
	 * document-relative value is the one that belongs in it; the viewport one is
	 * only a fallback for a client that sent nothing else, and for a visitor who
	 * had not scrolled the two are the same number anyway.
	 *
	 * @param array  $data      Event data.
	 * @param string $preferred Document-relative key.
	 * @param string $fallback  Viewport-relative key.
	 * @return int|null Null when neither is a number.
	 */
	private static function coordinate( array $data, $preferred, $fallback ) {
		foreach ( array( $preferred, $fallback ) as $key ) {
			if ( isset( $data[ $key ] ) && is_numeric( $data[ $key ] ) ) {
				return (int) round( (float) $data[ $key ] );
			}
		}

		return null;
	}

	/**
	 * Increments one cell.
	 *
	 * @param string $path   Normalised page path.
	 * @param string $device Device class.
	 * @param string $kind   `click`, `scroll` or `view`.
	 * @param int    $x      Column index, or 0.
	 * @param int    $y      Band index or scroll depth, or 0.
	 * @return bool
	 */
	private static function bump( $path, $device, $kind, $x, $y ) {
		global $wpdb;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the table name is the plugin's own.
		// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom table, and a counter must not be cached.
		$table = self::table();
		$now   = current_time( 'mysql', true );

		$rows = $wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$table} (page_path, device, kind, grid_x, grid_y, hits, updated_at)
				VALUES (%s, %s, %s, %d, %d, 1, %s)
				ON DUPLICATE KEY UPDATE hits = hits + 1, updated_at = %s",
				$path,
				$device,
				$kind,
				$x,
				$y,
				$now,
				$now
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		return false !== $rows;
	}

	/**
	 * Pages with click data, busiest first.
	 *
	 * @param int $limit Maximum pages.
	 * @return array<int,array> Each row: path, clicks, views, devices.
	 */
	public static function pages( $limit = 50 ) {
		global $wpdb;

		$limit = max( 1, min( 200, (int) $limit ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$table = self::table();

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT page_path,
					SUM(CASE WHEN kind = 'click' THEN hits ELSE 0 END) AS clicks,
					SUM(CASE WHEN kind = 'view'  THEN hits ELSE 0 END) AS views
				FROM {$table}
				GROUP BY page_path
				HAVING clicks > 0
				ORDER BY clicks DESC
				LIMIT %d",
				$limit
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		$out = array();
		foreach ( (array) $rows as $row ) {
			$out[] = array(
				'path'   => (string) $row['page_path'],
				'clicks' => (int) $row['clicks'],
				'views'  => (int) $row['views'],
			);
		}

		return $out;
	}

	/**
	 * Device classes that have clicks on a page, busiest first.
	 *
	 * The admin screen draws one class at a time, so it needs to know which
	 * ones exist before offering a choice between them.
	 *
	 * @param string $path Page path.
	 * @return array<int,array> Each row: device, clicks.
	 */
	public static function devices( $path ) {
		global $wpdb;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$table = self::table();

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT device, SUM(hits) AS clicks
				FROM {$table}
				WHERE page_path = %s AND kind = 'click'
				GROUP BY device
				ORDER BY clicks DESC",
				BAP_Rollup::normalize_path( $path )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		$out = array();
		foreach ( (array) $rows as $row ) {
			$out[] = array(
				'device' => (string) $row['device'],
				'clicks' => (int) $row['clicks'],
			);
		}

		return $out;
	}

	/**
	 * The click grid for one page and device.
	 *
	 * Returned as flat cells rather than a dense matrix. A long page is mostly
	 * empty, and sending the zeroes would be most of the payload.
	 *
	 * @param string $path   Page path.
	 * @param string $device Device class.
	 * @return array {
	 *     @type array $cells   Each: x (column), y (band), n (hits).
	 *     @type int   $cols    Columns the width is divided into.
	 *     @type int   $band    Band height in pixels.
	 *     @type int   $peak    Hits in the busiest cell.
	 *     @type int   $clicks  Total clicks.
	 *     @type int   $views   Page views for the same page and device.
	 * }
	 */
	public static function clicks( $path, $device ) {
		global $wpdb;

		$path   = BAP_Rollup::normalize_path( $path );
		$device = BAP_Rollup::normalize_device( $device );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$table = self::table();

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT grid_x, grid_y, hits
				FROM {$table}
				WHERE page_path = %s AND device = %s AND kind = 'click'
				ORDER BY grid_y ASC, grid_x ASC",
				$path,
				$device
			),
			ARRAY_A
		);

		$views = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT hits FROM {$table}
				WHERE page_path = %s AND device = %s AND kind = 'view' AND grid_x = 0 AND grid_y = 0",
				$path,
				$device
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		$cells  = array();
		$peak   = 0;
		$clicks = 0;

		foreach ( (array) $rows as $row ) {
			$n       = (int) $row['hits'];
			$peak    = max( $peak, $n );
			$clicks += $n;
			$cells[] = array(
				'x' => (int) $row['grid_x'],
				'y' => (int) $row['grid_y'],
				'n' => $n,
			);
		}

		return array(
			'cells'  => $cells,
			'cols'   => self::COLS,
			'band'   => self::BAND_PX,
			'peak'   => $peak,
			'clicks' => $clicks,
			'views'  => $views,
		);
	}

	/**
	 * How far down the page visitors got.
	 *
	 * Reported as the share of page views that reached each depth. The tracker
	 * fires a milestone once per page view, so the two counters are comparable;
	 * where there are no views recorded the percentage is withheld rather than
	 * computed against a denominator of zero.
	 *
	 * @param string $path   Page path.
	 * @param string $device Device class.
	 * @return array {
	 *     @type array $reach Each: depth, visitors, percent (null when unknown).
	 *     @type int   $views Page views for the page and device.
	 * }
	 */
	public static function scroll( $path, $device ) {
		global $wpdb;

		$path   = BAP_Rollup::normalize_path( $path );
		$device = BAP_Rollup::normalize_device( $device );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$table = self::table();

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT grid_y AS depth, hits
				FROM {$table}
				WHERE page_path = %s AND device = %s AND kind = 'scroll'",
				$path,
				$device
			),
			ARRAY_A
		);

		$views = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT hits FROM {$table}
				WHERE page_path = %s AND device = %s AND kind = 'view' AND grid_x = 0 AND grid_y = 0",
				$path,
				$device
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		$hits = array();
		foreach ( (array) $rows as $row ) {
			$hits[ (int) $row['depth'] ] = (int) $row['hits'];
		}

		$reach = array();
		foreach ( self::DEPTHS as $depth ) {
			$visitors = isset( $hits[ $depth ] ) ? $hits[ $depth ] : 0;
			$reach[]  = array(
				'depth'    => $depth,
				'visitors' => $visitors,
				'percent'  => $views > 0 ? round( min( 100, ( $visitors / $views ) * 100 ), 1 ) : null,
			);
		}

		return array(
			'reach' => $reach,
			'views' => $views,
		);
	}

	/**
	 * Total cells held.
	 *
	 * @return int
	 */
	public static function size() {
		global $wpdb;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
		return (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table() );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * Drops the quietest pages once the table outgrows its ceiling.
	 *
	 * Pruned by page rather than by age, which is the opposite of how the event
	 * log is pruned and deliberately so. A grid cell has no age worth keeping —
	 * it is a running total — and dropping the oldest cells would eat the top of
	 * a page that has been live for a year while sparing a page nobody visits.
	 * What a shop does not need is a heatmap for every URL it has ever served,
	 * most of which were seen twice.
	 *
	 * @return int Cells removed.
	 */
	public static function prune() {
		global $wpdb;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:disable WordPress.DB.DirectDatabaseQuery
		$table = self::table();

		if ( self::size() <= self::MAX_ROWS ) {
			return 0;
		}

		$keep = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT page_path FROM {$table}
				GROUP BY page_path
				ORDER BY SUM(hits) DESC
				LIMIT %d",
				self::MAX_PAGES
			)
		);

		if ( empty( $keep ) ) {
			return 0;
		}

		$slots   = implode( ', ', array_fill( 0, count( $keep ), '%s' ) );
		$removed = (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE page_path NOT IN ({$slots})", // phpcs:ignore WordPress.DB.PreparedSQLPlaceholders
				$keep
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery

		return $removed;
	}

	/**
	 * Empties the table.
	 *
	 * @return void
	 */
	public static function reset() {
		global $wpdb;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
		$wpdb->query( 'DELETE FROM ' . self::table() );
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
	}
}
