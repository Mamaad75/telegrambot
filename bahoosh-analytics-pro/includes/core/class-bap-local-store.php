<?php
/**
 * The site's own event store.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Keeps a bounded copy of the site's events in the site's own database.
 *
 * Until now the plugin was a pipe: it validated events and forwarded them to a
 * collector, and every report was a proxied question to that collector. With no
 * collector configured the pipe had nowhere to lead — the ingest route answered
 * 502, browsers retried forever, nothing was ever recorded, and every dashboard
 * card read `——`. The plugin was not measuring anything on its own.
 *
 * This class is the missing half. It is a small, ordinary analytics table:
 * one row per event, written at ingest, pruned on a schedule. That is enough to
 * answer every question the dashboard asks, from data the site already has,
 * with no external service involved.
 *
 * It does not replace the collector. When one is configured, events go to it as
 * before and its answers are preferred, because a central collector sees things
 * one site cannot — cross-device identity, long retention, heavier modelling.
 * The local store is what makes the plugin work *without* one, and what keeps
 * the dashboard populated when one is unreachable.
 *
 * What is deliberately not stored: no IP address, no email, no name, no user id,
 * no full URL with its query string. The visitor identifier is the same random
 * `anon_*` token the tracker already generates, which identifies a browser and
 * nothing about a person, and it never leaves this database.
 *
 * @since 4.3.1
 */
class BAP_Local_Store {

	const TABLE = 'bap_local_events';

	/**
	 * Rows kept before the oldest are dropped, regardless of retention days.
	 *
	 * A hard ceiling rather than a soft one: a site that suddenly gets a
	 * hundred times its usual traffic must not be able to fill its host's disk
	 * through an analytics plugin.
	 *
	 * @var int
	 */
	const MAX_ROWS = 500000;

	/**
	 * Days kept when the site has not set its own retention.
	 *
	 * @var int
	 */
	const DEFAULT_RETENTION_DAYS = 180;

	/**
	 * Most rows a single report will load into memory.
	 *
	 * Reports aggregate in PHP rather than in SQL, which keeps the number of
	 * distinct query shapes small and the whole thing readable. The trade is
	 * memory, so it is bounded — and when the bound is hit the report says so
	 * instead of quietly describing a slice as if it were the whole.
	 *
	 * @var int
	 */
	const MAX_REPORT_ROWS = 100000;

	/**
	 * Minutes an event counts as "now" for the realtime figure.
	 *
	 * @var int
	 */
	const REALTIME_MINUTES = 5;

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

		// `event_id` is unique so a retried delivery cannot be counted twice.
		// The client resends the same id after a timeout, and without this a
		// flaky connection would inflate every number on the dashboard.
		$sql = "CREATE TABLE {$table} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_id VARCHAR(64) NOT NULL DEFAULT '',
			event_type VARCHAR(64) NOT NULL DEFAULT '',
			anonymous_id VARCHAR(64) NOT NULL DEFAULT '',
			page_view_id VARCHAR(64) NOT NULL DEFAULT '',
			page_path VARCHAR(190) NOT NULL DEFAULT '',
			referrer_host VARCHAR(190) NOT NULL DEFAULT '',
			device VARCHAR(16) NOT NULL DEFAULT '',
			browser VARCHAR(60) NOT NULL DEFAULT '',
			label VARCHAR(190) NOT NULL DEFAULT '',
			value DECIMAL(18,4) NOT NULL DEFAULT 0,
			occurred_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY event_id (event_id),
			KEY occurred_at (occurred_at),
			KEY type_time (event_type, occurred_at),
			KEY visitor (anonymous_id, occurred_at)
		) {$collate};";

		dbDelta( $sql );
	}

	/**
	 * Records one validated event.
	 *
	 * @param array $event Validated v3 event envelope.
	 * @return bool Whether a row was written.
	 */
	public static function record( array $event ) {
		global $wpdb;

		$type = isset( $event['event_type'] ) ? (string) $event['event_type'] : '';

		if ( '' === $type ) {
			return false;
		}

		$page    = isset( $event['page'] ) && is_array( $event['page'] ) ? $event['page'] : array();
		$context = isset( $event['context'] ) && is_array( $event['context'] ) ? $event['context'] : array();
		$data    = isset( $event['data'] ) && is_array( $event['data'] ) ? $event['data'] : array();

		$path = isset( $page['path'] ) && '' !== $page['path'] ? (string) $page['path'] : (string) ( $page['url'] ?? '' );

		// Money is read only from a purchase. A cart subtotal is not revenue,
		// and summing one into the revenue card would overstate takings by
		// however much was abandoned.
		$value = 'purchase' === $type && isset( $data['value'] ) && is_numeric( $data['value'] )
			? (float) $data['value']
			: 0.0;

		$row = array(
			'event_id'      => substr( (string) ( $event['event_id'] ?? '' ), 0, 64 ),
			'event_type'    => substr( $type, 0, 64 ),
			'anonymous_id'  => substr( (string) ( $event['identity']['anonymous_id'] ?? '' ), 0, 64 ),
			'page_view_id'  => substr( (string) ( $event['page_view_id'] ?? '' ), 0, 64 ),
			'page_path'     => BAP_Rollup::normalize_path( $path ),
			'referrer_host' => self::referrer_host( (string) ( $page['referrer'] ?? '' ) ),
			'device'        => BAP_Rollup::normalize_device( (string) ( $context['device_type'] ?? '' ) ),
			'browser'       => substr( sanitize_text_field( (string) ( $context['browser'] ?? '' ) ), 0, 60 ),
			'label'         => self::label( $type, $data ),
			'value'         => $value,
			'occurred_at'   => self::occurred_at( $event ),
		);

		// A duplicate event id trips the unique key and the insert fails, which
		// is the intended outcome — the row is already there. Suppressed so a
		// retry does not fill the error log with a working defence.
		$previous = $wpdb->suppress_errors( true );
		$written  = $wpdb->insert( self::table(), $row ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$wpdb->suppress_errors( $previous );

		return (bool) $written;
	}

	/**
	 * Events in a window, oldest first.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d, inclusive.
	 * @return array{rows:array,truncated:bool}
	 */
	public static function events( $from, $to ) {
		global $wpdb;

		$table = self::table();
		$limit = self::MAX_REPORT_ROWS;

		$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				"SELECT event_type, anonymous_id, page_view_id, page_path, referrer_host, device, browser, label, value, occurred_at
				 FROM {$table}
				 WHERE occurred_at >= %s AND occurred_at <= %s
				 ORDER BY occurred_at ASC
				 LIMIT %d",
				$from . ' 00:00:00',
				$to . ' 23:59:59',
				$limit + 1
			),
			ARRAY_A
		);

		$rows      = is_array( $rows ) ? $rows : array();
		$truncated = count( $rows ) > $limit;

		return array(
			'rows'      => $truncated ? array_slice( $rows, 0, $limit ) : $rows,
			'truncated' => $truncated,
		);
	}

	/**
	 * Exact event count for a window, unaffected by the report row cap.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return int
	 */
	public static function count( $from, $to ) {
		global $wpdb;

		$table = self::table();

		return (int) $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				"SELECT COUNT(*) FROM {$table} WHERE occurred_at >= %s AND occurred_at <= %s",
				$from . ' 00:00:00',
				$to . ' 23:59:59'
			)
		);
	}

	/**
	 * Distinct visitors seen in the last few minutes.
	 *
	 * @return int
	 */
	public static function realtime_visitors() {
		global $wpdb;

		$table = self::table();

		return (int) $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				"SELECT COUNT(DISTINCT anonymous_id) FROM {$table} WHERE occurred_at >= %s",
				gmdate( 'Y-m-d H:i:s', time() - ( self::REALTIME_MINUTES * MINUTE_IN_SECONDS ) )
			)
		);
	}

	/**
	 * Total rows held.
	 *
	 * @return int
	 */
	public static function size() {
		global $wpdb;

		$table = self::table();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
	}

	/**
	 * The earliest event held, as Y-m-d, or an empty string when there are none.
	 *
	 * Used to tell an administrator "collecting since 12 Mordad" rather than
	 * leaving them to wonder why a 30-day range looks thin on a plugin they
	 * installed last week.
	 *
	 * @return string
	 */
	public static function first_day() {
		global $wpdb;

		$table = self::table();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
		$value = (string) $wpdb->get_var( "SELECT MIN(occurred_at) FROM {$table}" );

		return '' === $value ? '' : substr( $value, 0, 10 );
	}

	/**
	 * Deletes rows past their retention.
	 *
	 * @return int Rows removed.
	 */
	public static function prune() {
		global $wpdb;

		$table = self::table();
		$days  = (int) BAP_Settings::get( 'data_retention_days', 0 );
		$days  = $days > 0 ? $days : self::DEFAULT_RETENTION_DAYS;

		$removed = (int) $wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
				"DELETE FROM {$table} WHERE occurred_at < %s",
				gmdate( 'Y-m-d H:i:s', time() - ( $days * DAY_IN_SECONDS ) )
			)
		);

		// The ceiling is enforced after the age rule, because a site busy enough
		// to hit it is exactly the site whose retention window is already short.
		$size = self::size();

		if ( $size > self::MAX_ROWS ) {
			$removed += (int) $wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
					"DELETE FROM {$table} ORDER BY id ASC LIMIT %d",
					$size - self::MAX_ROWS
				)
			);
		}

		return $removed;
	}

	/**
	 * A short, human-readable descriptor for one event.
	 *
	 * Without this a shop owner can see that eleven searches happened and not
	 * what anybody searched for, which is the half of the number that is
	 * actually useful — a search with no results is a product they could stock.
	 *
	 * Only a few event types get one, and only from fields the site itself
	 * produced: a search term, a product name, an error message. Never free
	 * text a visitor typed into a form, and never anything from a field the
	 * plugin does not control the meaning of.
	 *
	 * @param string $type Event type.
	 * @param array  $data Event data.
	 * @return string
	 */
	private static function label( $type, array $data ) {
		$source = '';

		switch ( $type ) {
			case 'search':
				$source = (string) ( $data['query'] ?? '' );
				break;

			case 'view_item':
			case 'add_to_cart':
			case 'remove_from_cart':
				$source = (string) ( $data['item_name'] ?? ( $data['name'] ?? '' ) );
				break;

			case 'click':
				// The link text, which on a search results page is the product
				// name — the other half of "they searched for X and clicked Y".
				$source = (string) ( $data['text'] ?? '' );
				break;

			case 'js_error':
				$source = (string) ( $data['message'] ?? '' );
				break;

			case 'web_vital':
				$source = (string) ( $data['metric'] ?? '' );
				break;
		}

		return substr( sanitize_text_field( $source ), 0, 190 );
	}

	/**
	 * The host part of a referrer, or an empty string for direct traffic.
	 *
	 * Only the host: a full referring URL can carry a search query or a private
	 * path from another site, and the dashboard question is "which site sent
	 * them", not "what were they reading".
	 *
	 * @param string $referrer Referrer URL.
	 * @return string
	 */
	public static function referrer_host( $referrer ) {
		$referrer = trim( (string) $referrer );

		if ( '' === $referrer ) {
			return '';
		}

		$host = (string) wp_parse_url( $referrer, PHP_URL_HOST );
		$host = strtolower( preg_replace( '/^www\./', '', $host ) );

		// A referrer from the site itself is internal navigation, not a source.
		$own = strtolower( preg_replace( '/^www\./', '', (string) wp_parse_url( home_url(), PHP_URL_HOST ) ) );

		if ( '' === $host || $host === $own ) {
			return '';
		}

		return substr( $host, 0, 190 );
	}

	/**
	 * When an event happened, as a UTC datetime string.
	 *
	 * The server timestamp is used rather than the client's. A browser clock can
	 * be wrong by years, and one visitor with a misconfigured device must not be
	 * able to put rows outside every window the dashboard can ask about.
	 *
	 * @param array $event Event.
	 * @return string
	 */
	private static function occurred_at( array $event ) {
		$server = (string) ( $event['timestamp_server'] ?? '' );
		$time   = '' !== $server ? strtotime( $server ) : false;

		return gmdate( 'Y-m-d H:i:s', $time ? $time : time() );
	}
}
