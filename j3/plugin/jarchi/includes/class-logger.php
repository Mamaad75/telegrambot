<?php
/**
 * Request/response logger backed by a custom database table.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Persists the whole event lifecycle — detection, queueing, scheduling,
 * transport and retries — into the `{$prefix}wpep_logs` table and provides
 * query, pagination, export and cleanup capabilities for the admin UI and
 * the REST API.
 *
 * Two things are guaranteed:
 *
 * - Failures are always recorded, even with logging switched off, so a
 *   problem never disappears silently.
 * - Secrets never reach the table. Request headers are not stored and
 *   context arrays are redacted before they are encoded.
 *
 * @since 1.0.0
 */
class Logger {

	/**
	 * Database schema version, bump when the table changes.
	 *
	 * @var string
	 */
	private const DB_VERSION = '1.2.0';

	/**
	 * Option storing the installed schema version.
	 *
	 * @var string
	 */
	private const DB_VERSION_OPTION = 'wpep_db_version';

	/**
	 * Log status: request accepted by the remote service.
	 *
	 * @var string
	 */
	public const STATUS_SUCCESS = 'success';

	/**
	 * Log status: request failed.
	 *
	 * @var string
	 */
	public const STATUS_FAILED = 'failed';

	/**
	 * Log status: request queued and awaiting execution.
	 *
	 * @var string
	 */
	public const STATUS_PENDING = 'pending';

	/**
	 * Log status: informational lifecycle entry.
	 *
	 * @var string
	 */
	public const STATUS_INFO = 'info';

	/**
	 * Log status: an event was deliberately not created.
	 *
	 * @var string
	 */
	public const STATUS_SKIPPED = 'skipped';

	/**
	 * Log status: a failed delivery was rescheduled.
	 *
	 * @var string
	 */
	public const STATUS_RETRY = 'retry';

	/**
	 * Every status the UI offers as a filter.
	 *
	 * @var string[]
	 */
	public const STATUSES = array(
		self::STATUS_SUCCESS,
		self::STATUS_FAILED,
		self::STATUS_PENDING,
		self::STATUS_INFO,
		self::STATUS_SKIPPED,
		self::STATUS_RETRY,
	);

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Constructor.
	 *
	 * @since 1.0.0
	 *
	 * @param Settings $settings Settings service.
	 */
	public function __construct( Settings $settings ) {
		$this->settings = $settings;
	}

	/**
	 * Returns the fully qualified log table name.
	 *
	 * @since 1.0.0
	 *
	 * @return string Table name including the WordPress prefix.
	 */
	public function table(): string {
		global $wpdb;

		return $wpdb->prefix . 'wpep_logs';
	}

	/**
	 * Creates or upgrades the log table using dbDelta().
	 *
	 * Running it again on an existing table only appends the columns and
	 * indexes that are missing, so upgrading preserves every historic row.
	 *
	 * SQL creation code:
	 *
	 *     CREATE TABLE {$prefix}wpep_logs (
	 *         id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
	 *         event_id VARCHAR(64) NOT NULL DEFAULT '',
	 *         event_type VARCHAR(20) NOT NULL DEFAULT '',
	 *         site_id VARCHAR(64) NOT NULL DEFAULT '',
	 *         post_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
	 *         stage VARCHAR(40) NOT NULL DEFAULT '',
	 *         attempt SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
	 *         message TEXT NULL,
	 *         request_url VARCHAR(2048) NOT NULL DEFAULT '',
	 *         payload LONGTEXT NULL,
	 *         response_code SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
	 *         response_body LONGTEXT NULL,
	 *         status VARCHAR(20) NOT NULL DEFAULT 'pending',
	 *         created_at DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
	 *         PRIMARY KEY  (id),
	 *         KEY event_id (event_id),
	 *         KEY event_type (event_type),
	 *         KEY site_id (site_id),
	 *         KEY post_id (post_id),
	 *         KEY stage (stage),
	 *         KEY status (status),
	 *         KEY created_at (created_at)
	 *     ) {$charset_collate};
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Added the event_id, event_type and site_id columns.
	 * @since 1.2.0 Added the stage, attempt and message columns.
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
			site_id VARCHAR(64) NOT NULL DEFAULT '',
			post_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
			stage VARCHAR(40) NOT NULL DEFAULT '',
			attempt SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
			message TEXT NULL,
			request_url VARCHAR(2048) NOT NULL DEFAULT '',
			payload LONGTEXT NULL,
			response_code SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
			response_body LONGTEXT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			created_at DATETIME NOT NULL DEFAULT '0000-00-00 00:00:00',
			PRIMARY KEY  (id),
			KEY event_id (event_id),
			KEY event_type (event_type),
			KEY site_id (site_id),
			KEY post_id (post_id),
			KEY stage (stage),
			KEY status (status),
			KEY created_at (created_at)
		) {$charset_collate};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Re-runs the installer when the stored schema version is outdated.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function maybe_upgrade(): void {
		if ( get_option( self::DB_VERSION_OPTION ) !== self::DB_VERSION ) {
			$this->install();
		}
	}

	/**
	 * Records one step of the event lifecycle.
	 *
	 * This is the method the detector, the dispatcher and the transport
	 * use. It keeps the log readable by classifying every entry with a
	 * stage name (`hook.transition`, `event.queued`, `cron.scheduled`,
	 * `webhook.response`, …) so a single publish can be followed from the
	 * WordPress hook all the way to the HTTP status code.
	 *
	 * @since 1.2.0
	 *
	 * @param string              $stage   Machine readable lifecycle stage.
	 * @param string              $status  One of the STATUS_* constants.
	 * @param string              $message Human readable summary.
	 * @param array<string,mixed> $context {
	 *     Optional. Contextual data.
	 *
	 *     @type string $event_id      Stable event identifier.
	 *     @type string $event_type    Lifecycle event type.
	 *     @type int    $post_id       Related post ID.
	 *     @type int    $attempt       Delivery attempt.
	 *     @type string $request_url   Endpoint URL.
	 *     @type string $payload       Request body, already encoded.
	 *     @type int    $response_code HTTP status code.
	 *     @type string $response_body Response body or error text.
	 *     @type mixed  $data          Arbitrary context, JSON encoded and redacted.
	 * }
	 * @param bool                $verbose Only write this entry in debug mode.
	 *
	 * @return int Inserted log ID, 0 when skipped.
	 */
	public function event( string $stage, string $status, string $message, array $context = array(), bool $verbose = false ): int {
		if ( $verbose && ! $this->settings->debug() ) {
			return 0;
		}

		$context['stage']   = $stage;
		$context['status']  = $status;
		$context['message'] = $message;

		return $this->log( $context );
	}

	/**
	 * Writes a log entry.
	 *
	 * Honours the "Enable Logging" setting except for failed requests,
	 * which are always recorded so problems never disappear silently.
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Accepts event_id, event_type and site_id.
	 * @since 1.2.0 Accepts stage, attempt, message and free-form data.
	 *
	 * @param array<string,mixed> $entry Log entry data; see {@see self::event()}.
	 *
	 * @return int Inserted log ID, 0 when skipped or failed.
	 */
	public function log( array $entry ): int {
		global $wpdb;

		$status = (string) ( $entry['status'] ?? self::STATUS_PENDING );

		if ( ! $this->settings->get( 'logging_enabled' ) && self::STATUS_FAILED !== $status ) {
			return 0;
		}

		$message = (string) ( $entry['message'] ?? '' );

		if ( isset( $entry['data'] ) ) {
			$encoded = wp_json_encode( $this->redact( (array) $entry['data'] ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

			if ( is_string( $encoded ) ) {
				$message = '' === $message ? $encoded : $message . ' ' . $encoded;
			}
		}

		$data = array(
			'event_id'      => substr( (string) ( $entry['event_id'] ?? '' ), 0, 64 ),
			'event_type'    => substr( sanitize_key( (string) ( $entry['event_type'] ?? '' ) ), 0, 20 ),
			'site_id'       => substr( (string) ( $entry['site_id'] ?? $this->settings->site_id() ), 0, 64 ),
			'post_id'       => absint( $entry['post_id'] ?? 0 ),
			'stage'         => substr( (string) ( $entry['stage'] ?? '' ), 0, 40 ),
			'attempt'       => absint( $entry['attempt'] ?? 0 ),
			'message'       => mb_substr( $message, 0, 5000 ),
			'request_url'   => esc_url_raw( (string) ( $entry['request_url'] ?? '' ) ),
			'payload'       => (string) ( $entry['payload'] ?? '' ),
			'response_code' => absint( $entry['response_code'] ?? 0 ),
			'response_body' => (string) ( $entry['response_body'] ?? '' ),
			'status'        => sanitize_key( $status ),
			'created_at'    => current_time( 'mysql', true ),
		);

		/**
		 * Filters a log entry before it is written to the database.
		 *
		 * Returning an empty array short-circuits the write.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string,mixed> $data Prepared row data.
		 */
		$data = apply_filters( 'wpep_log_entry', $data );

		if ( empty( $data ) ) {
			return 0;
		}

		$this->mirror_to_error_log( $data );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- custom table.
		$inserted = $wpdb->insert(
			$this->table(),
			$data,
			array( '%s', '%s', '%s', '%d', '%s', '%d', '%s', '%s', '%s', '%d', '%s', '%s', '%s' )
		);

		$log_id = $inserted ? (int) $wpdb->insert_id : 0;

		/**
		 * Fires after a log entry has been written.
		 *
		 * @since 1.0.0
		 *
		 * @param int                 $log_id Inserted row ID (0 on failure).
		 * @param array<string,mixed> $data   Row data.
		 */
		do_action( 'wpep_logged', $log_id, $data );

		return $log_id;
	}

	/**
	 * Mirrors an entry into the PHP error log while debugging.
	 *
	 * Only active when both the plugin debug mode and WP_DEBUG_LOG are on,
	 * so production sites never gain unexpected disk writes.
	 *
	 * @since 1.2.0
	 *
	 * @param array<string,mixed> $data Prepared row data.
	 *
	 * @return void
	 */
	private function mirror_to_error_log( array $data ): void {
		if ( ! $this->settings->debug() ) {
			return;
		}

		if ( ! defined( 'WP_DEBUG_LOG' ) || ! WP_DEBUG_LOG ) {
			return;
		}

		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- opt-in debugging aid.
		error_log(
			sprintf(
				'[WPEP] %s | %s | event=%s type=%s post=%d attempt=%d code=%d | %s',
				(string) $data['stage'],
				(string) $data['status'],
				(string) $data['event_id'],
				(string) $data['event_type'],
				(int) $data['post_id'],
				(int) $data['attempt'],
				(int) $data['response_code'],
				(string) $data['message']
			)
		);
	}

	/**
	 * Removes credential-looking values from a context array.
	 *
	 * @since 1.2.0
	 *
	 * @param array<string,mixed> $data Context data.
	 *
	 * @return array<string,mixed> Redacted context data.
	 */
	public function redact( array $data ): array {
		$secret_hints = array( 'secret', 'token', 'password', 'api_key', 'apikey', 'authorization', 'signature', 'x-api-key' );

		$clean = array();

		foreach ( $data as $key => $value ) {
			$normalized = strtolower( (string) $key );

			foreach ( $secret_hints as $hint ) {
				if ( str_contains( $normalized, $hint ) ) {
					$clean[ $key ] = '[redacted]';
					continue 2;
				}
			}

			$clean[ $key ] = is_array( $value ) ? $this->redact( $value ) : $value;
		}

		return $clean;
	}

	/**
	 * Queries log entries with search, filtering and pagination.
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Added the event_id, event_type and site_id filters.
	 * @since 1.2.0 Added the stage filter.
	 *
	 * @param array<string,mixed> $args {
	 *     Query arguments.
	 *
	 *     @type string $search     Free-text search over url/payload/response/message.
	 *     @type string $status     Filter by status.
	 *     @type string $stage      Filter by lifecycle stage.
	 *     @type string $event_id   Filter by exact event identifier.
	 *     @type string $event_type Filter by lifecycle event type.
	 *     @type string $site_id    Filter by site identifier.
	 *     @type int    $post_id    Filter by post ID.
	 *     @type int    $page       1-based page number.
	 *     @type int    $per_page   Items per page (max 200).
	 * }
	 *
	 * @return array{items:array<int,object>,total:int,pages:int} Result set.
	 */
	public function query( array $args = array() ): array {
		global $wpdb;

		$args = wp_parse_args(
			$args,
			array(
				'search'     => '',
				'status'     => '',
				'stage'      => '',
				'event_id'   => '',
				'event_type' => '',
				'site_id'    => '',
				'post_id'    => 0,
				'page'       => 1,
				'per_page'   => 20,
			)
		);

		$per_page = max( 1, min( 200, absint( $args['per_page'] ) ) );
		$page     = max( 1, absint( $args['page'] ) );
		$offset   = ( $page - 1 ) * $per_page;

		$where  = array( '1=1' );
		$params = array();

		if ( '' !== $args['status'] ) {
			$where[]  = 'status = %s';
			$params[] = sanitize_key( (string) $args['status'] );
		}

		if ( '' !== (string) $args['stage'] ) {
			$where[]  = 'stage = %s';
			$params[] = substr( (string) $args['stage'], 0, 40 );
		}

		if ( '' !== trim( (string) $args['event_id'] ) ) {
			$where[]  = 'event_id = %s';
			$params[] = trim( (string) $args['event_id'] );
		}

		if ( '' !== (string) $args['event_type'] ) {
			$where[]  = 'event_type = %s';
			$params[] = sanitize_key( (string) $args['event_type'] );
		}

		if ( '' !== trim( (string) $args['site_id'] ) ) {
			$where[]  = 'site_id = %s';
			$params[] = trim( (string) $args['site_id'] );
		}

		if ( absint( $args['post_id'] ) > 0 ) {
			$where[]  = 'post_id = %d';
			$params[] = absint( $args['post_id'] );
		}

		if ( '' !== trim( (string) $args['search'] ) ) {
			$like     = '%' . $wpdb->esc_like( trim( (string) $args['search'] ) ) . '%';
			$where[]  = '(request_url LIKE %s OR payload LIKE %s OR response_body LIKE %s OR message LIKE %s OR event_id LIKE %s)';
			$params[] = $like;
			$params[] = $like;
			$params[] = $like;
			$params[] = $like;
			$params[] = $like;
		}

		$table        = $this->table();
		$where_clause = implode( ' AND ', $where );

		$count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where_clause}";
		$items_sql = "SELECT * FROM {$table} WHERE {$where_clause} ORDER BY id DESC LIMIT %d OFFSET %d";

		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- table name is internal, clauses are placeholders.
		$total = empty( $params )
			? (int) $wpdb->get_var( $count_sql )
			: (int) $wpdb->get_var( $wpdb->prepare( $count_sql, $params ) );

		$items = $wpdb->get_results(
			$wpdb->prepare( $items_sql, array_merge( $params, array( $per_page, $offset ) ) )
		);
		// phpcs:enable

		return array(
			'items' => is_array( $items ) ? $items : array(),
			'total' => $total,
			'pages' => (int) ceil( $total / $per_page ),
		);
	}

	/**
	 * Returns a single log row.
	 *
	 * @since 1.0.0
	 *
	 * @param int $log_id Log row ID.
	 *
	 * @return object|null Row object or null.
	 */
	public function find( int $log_id ): ?object {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table name.
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . $this->table() . ' WHERE id = %d', $log_id ) );

		return $row ?: null;
	}

	/**
	 * Deletes a single log entry.
	 *
	 * @since 1.0.0
	 *
	 * @param int $log_id Log row ID.
	 *
	 * @return bool True on success.
	 */
	public function delete( int $log_id ): bool {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- custom table.
		return (bool) $wpdb->delete( $this->table(), array( 'id' => absint( $log_id ) ), array( '%d' ) );
	}

	/**
	 * Deletes all log entries.
	 *
	 * @since 1.0.0
	 *
	 * @return bool True on success.
	 */
	public function clear(): bool {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table name.
		$result = false !== $wpdb->query( 'TRUNCATE TABLE ' . $this->table() );

		/**
		 * Fires after the log table has been cleared.
		 *
		 * @since 1.0.0
		 */
		do_action( 'wpep_logs_cleared' );

		return $result;
	}

	/**
	 * Aggregated statistics for the dashboard.
	 *
	 * @since 1.0.0
	 *
	 * @return array{total:int,success:int,failed:int,pending:int,today:int} Stats.
	 */
	public function stats(): array {
		global $wpdb;

		$table = $this->table();

		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table name.
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT
					COUNT(*) AS total,
					SUM(status = %s) AS success,
					SUM(status = %s) AS failed,
					SUM(status = %s) AS pending,
					SUM(DATE(created_at) = %s) AS today
				FROM {$table}",
				self::STATUS_SUCCESS,
				self::STATUS_FAILED,
				self::STATUS_PENDING,
				current_time( 'Y-m-d', true )
			)
		);
		// phpcs:enable

		return array(
			'total'   => (int) ( $row->total ?? 0 ),
			'success' => (int) ( $row->success ?? 0 ),
			'failed'  => (int) ( $row->failed ?? 0 ),
			'pending' => (int) ( $row->pending ?? 0 ),
			'today'   => (int) ( $row->today ?? 0 ),
		);
	}

	/**
	 * Exports all (or filtered) logs as CSV.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $args Same arguments as query(), pagination ignored.
	 *
	 * @return string CSV document.
	 */
	public function export_csv( array $args = array() ): string {
		$args['per_page'] = 200;
		$args['page']     = 1;

		$handle = fopen( 'php://temp', 'r+' );

		fputcsv(
			$handle,
			array( 'id', 'event_id', 'event_type', 'site_id', 'post_id', 'stage', 'attempt', 'message', 'request_url', 'payload', 'response_code', 'response_body', 'status', 'created_at' ),
			',',
			'"',
			'\\'
		);

		do {
			$result = $this->query( $args );

			foreach ( $result['items'] as $row ) {
				fputcsv(
					$handle,
					array(
						$row->id,
						$row->event_id ?? '',
						$row->event_type ?? '',
						$row->site_id ?? '',
						$row->post_id,
						$row->stage ?? '',
						$row->attempt ?? 0,
						$row->message ?? '',
						$row->request_url,
						$row->payload,
						$row->response_code,
						$row->response_body,
						$row->status,
						$row->created_at,
					),
					',',
					'"',
					'\\'
				);
			}

			++$args['page'];
		} while ( $args['page'] <= $result['pages'] );

		rewind( $handle );
		$csv = (string) stream_get_contents( $handle );
		fclose( $handle );

		return $csv;
	}

	/**
	 * Drops the log table. Used exclusively by uninstall.php.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function drop(): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.SchemaChange -- uninstall cleanup of internal table.
		$wpdb->query( 'DROP TABLE IF EXISTS ' . $this->table() );

		delete_option( self::DB_VERSION_OPTION );
	}
}
