<?php
/**
 * Local tables for ML results, actions and their audit trail.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Owns the plugin's ML tables.
 *
 * WordPress keeps its own copy of segments, assignments and actions because it
 * is the component that executes actions and must be able to prove, without
 * asking anyone else, what it was told, what it decided and what it changed.
 *
 * No table here holds a name, email, phone or address. `bap_ml_identities`
 * maps a pseudonymous key to a user id / last order id so a coupon can be
 * restricted to the right customers at execution time; the email itself is
 * read from WooCommerce at that moment and not copied.
 *
 * @since 4.8.0
 */
class BAP_ML_Store {

	const KEEP_RUNS = 10;

	/**
	 * Table name helper.
	 *
	 * @param string $name Short name.
	 * @return string
	 */
	public static function table( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'bap_ml_' . $name;
	}

	/**
	 * Creates or updates all ML tables.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$collate = $wpdb->get_charset_collate();

		dbDelta(
			'CREATE TABLE ' . self::table( 'identities' ) . " (
			customer_key VARCHAR(40) NOT NULL,
			user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			last_order_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY  (customer_key),
			KEY user_id (user_id)
		) {$collate};"
		);

		dbDelta(
			'CREATE TABLE ' . self::table( 'segments' ) . " (
			run_id VARCHAR(36) NOT NULL,
			segment_key VARCHAR(64) NOT NULL,
			label VARCHAR(190) NOT NULL DEFAULT '',
			profile LONGTEXT NOT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY  (run_id, segment_key)
		) {$collate};"
		);

		dbDelta(
			'CREATE TABLE ' . self::table( 'assignments' ) . " (
			run_id VARCHAR(36) NOT NULL,
			customer_key VARCHAR(40) NOT NULL,
			segment_key VARCHAR(64) NOT NULL,
			repeat_probability DECIMAL(6,5) NULL,
			churn_probability DECIMAL(6,5) NULL,
			PRIMARY KEY  (run_id, customer_key),
			KEY run_segment (run_id, segment_key)
		) {$collate};"
		);

		dbDelta(
			'CREATE TABLE ' . self::table( 'actions' ) . " (
			action_id VARCHAR(36) NOT NULL,
			run_id VARCHAR(36) NOT NULL DEFAULT '',
			action_type VARCHAR(64) NOT NULL,
			target LONGTEXT NOT NULL,
			parameters LONGTEXT NOT NULL,
			reason LONGTEXT NOT NULL,
			confidence DECIMAL(5,4) NULL,
			source VARCHAR(16) NOT NULL DEFAULT 'llm',
			status VARCHAR(32) NOT NULL,
			policy LONGTEXT NOT NULL,
			created_at DATETIME NOT NULL,
			approved_at DATETIME NULL,
			approved_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
			executed_at DATETIME NULL,
			result LONGTEXT NULL,
			error TEXT NULL,
			rollback LONGTEXT NULL,
			rolled_back_at DATETIME NULL,
			clicks INT UNSIGNED NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY  (action_id),
			KEY status (status),
			KEY run_id (run_id)
		) {$collate};"
		);

		dbDelta(
			'CREATE TABLE ' . self::table( 'action_results' ) . " (
			action_id VARCHAR(36) NOT NULL,
			measured_at DATETIME NOT NULL,
			metrics LONGTEXT NOT NULL,
			PRIMARY KEY  (action_id, measured_at)
		) {$collate};"
		);

		dbDelta(
			'CREATE TABLE ' . self::table( 'audit' ) . " (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			action_id VARCHAR(36) NOT NULL DEFAULT '',
			event VARCHAR(40) NOT NULL,
			actor BIGINT UNSIGNED NOT NULL DEFAULT 0,
			data LONGTEXT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			KEY action_id (action_id),
			KEY created_at (created_at)
		) {$collate};"
		);
	}

	/**
	 * Tables dropped on uninstall.
	 *
	 * @return string[]
	 */
	public static function table_suffixes() {
		return array( 'bap_ml_identities', 'bap_ml_segments', 'bap_ml_assignments', 'bap_ml_actions', 'bap_ml_action_results', 'bap_ml_audit' );
	}

	/**
	 * UTC now in MySQL format.
	 *
	 * @return string
	 */
	public static function now() {
		return gmdate( 'Y-m-d H:i:s' );
	}

	// ------------------------------------------------------------ identities

	/**
	 * Remembers which user / order a key belongs to.
	 *
	 * @param array $rows customer_key => array(user_id, last_order_id).
	 * @return void
	 */
	public static function remember_identities( array $rows ) {
		global $wpdb;
		if ( ! $rows ) {
			return;
		}
		$table  = self::table( 'identities' );
		$now    = self::now();
		$values = array();
		$args   = array();
		foreach ( $rows as $key => $row ) {
			$values[] = '(%s,%d,%d,%s)';
			array_push( $args, $key, (int) $row['user_id'], (int) $row['last_order_id'], $now );
		}
		// GREATEST keeps the newest order when pages arrive out of order.
		$sql = "INSERT INTO {$table} (customer_key,user_id,last_order_id,updated_at) VALUES " . implode( ',', $values )
			. ' ON DUPLICATE KEY UPDATE user_id=GREATEST(user_id,VALUES(user_id)), last_order_id=GREATEST(last_order_id,VALUES(last_order_id)), updated_at=VALUES(updated_at)';
		$wpdb->query( $wpdb->prepare( $sql, $args ) ); // phpcs:ignore WordPress.DB
	}

	/**
	 * Identity rows for keys.
	 *
	 * @param string[] $keys Customer keys.
	 * @return array customer_key => row.
	 */
	public static function identities( array $keys ) {
		global $wpdb;
		$out = array();
		foreach ( array_chunk( array_values( array_unique( $keys ) ), 500 ) as $chunk ) {
			$placeholders = implode( ',', array_fill( 0, count( $chunk ), '%s' ) );
			$table        = self::table( 'identities' );
			$rows         = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} WHERE customer_key IN ({$placeholders})", $chunk ), ARRAY_A ); // phpcs:ignore WordPress.DB
			foreach ( (array) $rows as $row ) {
				$out[ $row['customer_key'] ] = $row;
			}
		}
		return $out;
	}

	// ------------------------------------------------------------- segments

	/**
	 * Stores one run's segments and assignments, then prunes old runs.
	 *
	 * @param string $run_id      Run id.
	 * @param array  $segments    Segment profiles.
	 * @param array  $assignments Rows with customer_key, segment_key, probabilities.
	 * @return int Assignments stored.
	 */
	public static function save_run( $run_id, array $segments, array $assignments ) {
		global $wpdb;
		$now = self::now();
		foreach ( $segments as $segment ) {
			$key = sanitize_key( (string) ( $segment['segment_key'] ?? '' ) );
			if ( '' === $key ) {
				continue;
			}
			unset( $segment['cluster_id'] ); // internal to the ML service.
			$wpdb->replace(
				self::table( 'segments' ),
				array(
					'run_id'      => $run_id,
					'segment_key' => $key,
					'label'       => sanitize_text_field( (string) ( $segment['label'] ?? $key ) ),
					'profile'     => wp_json_encode( BAP_Event_Validator::sanitize_data( $segment ) ),
					'created_at'  => $now,
				)
			);
		}

		$table  = self::table( 'assignments' );
		$stored = 0;
		foreach ( array_chunk( $assignments, 500 ) as $chunk ) {
			$values = array();
			$args   = array();
			foreach ( $chunk as $row ) {
				$key = (string) ( $row['customer_key'] ?? '' );
				if ( ! preg_match( '/^c_[a-f0-9]{32}$/', $key ) ) {
					continue;
				}
				$values[] = '(%s,%s,%s,%s,%s)';
				array_push(
					$args,
					$run_id,
					$key,
					sanitize_key( (string) ( $row['segment_key'] ?? '' ) ),
					self::probability( $row['repeat_purchase_probability'] ?? null ),
					self::probability( $row['churn_probability'] ?? null )
				);
			}
			if ( ! $values ) {
				continue;
			}
			$sql = "REPLACE INTO {$table} (run_id,customer_key,segment_key,repeat_probability,churn_probability) VALUES " . implode( ',', $values );
			// NULL probabilities are passed as the string 'NULL' and restored below.
			$wpdb->query( str_replace( "'NULL'", 'NULL', $wpdb->prepare( $sql, $args ) ) ); // phpcs:ignore WordPress.DB
			$stored += count( $values );
		}

		update_option( 'bap_ml_latest_run', $run_id, false );
		self::prune_runs();
		return $stored;
	}

	/**
	 * Formats a probability for SQL.
	 *
	 * @param mixed $value Value.
	 * @return string
	 */
	private static function probability( $value ) {
		if ( null === $value || '' === $value || ! is_numeric( $value ) ) {
			return 'NULL';
		}
		return number_format( max( 0.0, min( 1.0, (float) $value ) ), 5, '.', '' );
	}

	/**
	 * Keeps the newest runs plus any run an unfinished action still points to.
	 *
	 * @return void
	 */
	private static function prune_runs() {
		global $wpdb;
		$segments = self::table( 'segments' );
		$actions  = self::table( 'actions' );
		$runs     = $wpdb->get_col( "SELECT run_id FROM {$segments} GROUP BY run_id ORDER BY MAX(created_at) DESC" ); // phpcs:ignore WordPress.DB
		$keep     = array_slice( (array) $runs, 0, self::KEEP_RUNS );
		$active   = $wpdb->get_col( "SELECT DISTINCT run_id FROM {$actions} WHERE status IN ('pending_approval','approved','auto_approved','scheduled','sending','executed')" ); // phpcs:ignore WordPress.DB
		foreach ( array_diff( (array) $runs, $keep, (array) $active ) as $old ) {
			$wpdb->delete( $segments, array( 'run_id' => $old ) );
			$wpdb->delete( self::table( 'assignments' ), array( 'run_id' => $old ) );
		}
	}

	/**
	 * Latest run id.
	 *
	 * @return string
	 */
	public static function latest_run() {
		return (string) get_option( 'bap_ml_latest_run', '' );
	}

	/**
	 * Segments of a run, with profile decoded.
	 *
	 * @param string $run_id Run id (latest when empty).
	 * @return array
	 */
	public static function segments( $run_id = '' ) {
		global $wpdb;
		$run_id = '' !== $run_id ? $run_id : self::latest_run();
		if ( '' === $run_id ) {
			return array();
		}
		$table = self::table( 'segments' );
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} WHERE run_id = %s", $run_id ), ARRAY_A ); // phpcs:ignore WordPress.DB
		$out   = array();
		foreach ( (array) $rows as $row ) {
			$profile = json_decode( (string) $row['profile'], true );
			$out[ $row['segment_key'] ] = array_merge( is_array( $profile ) ? $profile : array(), array( 'segment_key' => $row['segment_key'], 'label' => $row['label'] ) );
		}
		uasort(
			$out,
			static function ( $a, $b ) {
				return ( $b['total_revenue'] ?? 0 ) <=> ( $a['total_revenue'] ?? 0 );
			}
		);
		return $out;
	}

	/**
	 * Customer keys in one segment of one run.
	 *
	 * @param string $run_id      Run id.
	 * @param string $segment_key Segment key.
	 * @return string[]
	 */
	public static function members( $run_id, $segment_key ) {
		global $wpdb;
		$table = self::table( 'assignments' );
		return array_map( 'strval', (array) $wpdb->get_col( $wpdb->prepare( "SELECT customer_key FROM {$table} WHERE run_id = %s AND segment_key = %s", $run_id, $segment_key ) ) ); // phpcs:ignore WordPress.DB
	}

	// -------------------------------------------------------------- actions

	/**
	 * Decodes JSON columns of an action row.
	 *
	 * @param array|null $row Row.
	 * @return array|null
	 */
	private static function decode( $row ) {
		if ( ! is_array( $row ) ) {
			return null;
		}
		foreach ( array( 'target', 'parameters', 'reason', 'policy', 'result', 'rollback' ) as $col ) {
			$decoded     = isset( $row[ $col ] ) ? json_decode( (string) $row[ $col ], true ) : null;
			$row[ $col ] = is_array( $decoded ) ? $decoded : array();
		}
		$row['confidence'] = null === $row['confidence'] ? null : (float) $row['confidence'];
		return $row;
	}

	/**
	 * One action.
	 *
	 * @param string $action_id Id.
	 * @return array|null
	 */
	public static function action( $action_id ) {
		global $wpdb;
		$table = self::table( 'actions' );
		return self::decode( $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE action_id = %s", $action_id ), ARRAY_A ) ); // phpcs:ignore WordPress.DB
	}

	/**
	 * Actions, newest first.
	 *
	 * @param array $args status, since (Y-m-d H:i:s), limit.
	 * @return array
	 */
	public static function actions( array $args = array() ) {
		global $wpdb;
		$table = self::table( 'actions' );
		$where = array( '1=1' );
		$vals  = array();
		if ( ! empty( $args['status'] ) ) {
			$where[] = 'status = %s';
			$vals[]  = (string) $args['status'];
		}
		if ( ! empty( $args['since'] ) ) {
			$where[] = 'updated_at >= %s';
			$vals[]  = (string) $args['since'];
		}
		$limit  = max( 1, min( 1000, (int) ( $args['limit'] ?? 200 ) ) );
		$sql    = "SELECT * FROM {$table} WHERE " . implode( ' AND ', $where ) . " ORDER BY created_at DESC LIMIT {$limit}";
		$rows   = $vals ? $wpdb->get_results( $wpdb->prepare( $sql, $vals ), ARRAY_A ) : $wpdb->get_results( $sql, ARRAY_A ); // phpcs:ignore WordPress.DB
		return array_map( array( __CLASS__, 'decode' ), (array) $rows );
	}

	/**
	 * Inserts a new action. Existing ids are never overwritten: once WordPress
	 * has an action, its state is WordPress's, not the sender's.
	 *
	 * @param array $action Action.
	 * @return bool Whether it was inserted.
	 */
	public static function insert_action( array $action ) {
		global $wpdb;
		if ( self::action( $action['action_id'] ) ) {
			return false;
		}
		$now = self::now();
		return (bool) $wpdb->insert(
			self::table( 'actions' ),
			array(
				'action_id'   => $action['action_id'],
				'run_id'      => (string) ( $action['run_id'] ?? '' ),
				'action_type' => $action['action_type'],
				'target'      => wp_json_encode( $action['target'] ?? array() ),
				'parameters'  => wp_json_encode( $action['parameters'] ?? array() ),
				'reason'      => wp_json_encode( array_values( (array) ( $action['reason'] ?? array() ) ) ),
				'confidence'  => isset( $action['confidence'] ) ? (float) $action['confidence'] : null,
				'source'      => (string) ( $action['source'] ?? 'llm' ),
				'status'      => $action['status'],
				'policy'      => wp_json_encode( $action['policy'] ?? array() ),
				'created_at'  => $now,
				'updated_at'  => $now,
			)
		);
	}

	/**
	 * Updates columns of an action (arrays are JSON-encoded).
	 *
	 * @param string $action_id Id.
	 * @param array  $fields    Columns.
	 * @return void
	 */
	public static function update_action( $action_id, array $fields ) {
		global $wpdb;
		foreach ( array( 'target', 'parameters', 'reason', 'policy', 'result', 'rollback' ) as $col ) {
			if ( array_key_exists( $col, $fields ) && is_array( $fields[ $col ] ) ) {
				$fields[ $col ] = wp_json_encode( $fields[ $col ] );
			}
		}
		$fields['updated_at'] = self::now();
		$wpdb->update( self::table( 'actions' ), $fields, array( 'action_id' => $action_id ) );
	}

	/**
	 * Atomically moves an action from one status to another.
	 *
	 * Two cron runs or a double click cannot both execute the same action: only
	 * the caller whose UPDATE changed the row proceeds.
	 *
	 * @param string   $action_id Id.
	 * @param string[] $from      Allowed current statuses.
	 * @param string   $to        New status.
	 * @return bool
	 */
	public static function transition( $action_id, array $from, $to ) {
		global $wpdb;
		$table        = self::table( 'actions' );
		$placeholders = implode( ',', array_fill( 0, count( $from ), '%s' ) );
		$args         = array_merge( array( $to, self::now(), $action_id ), $from );
		$changed      = $wpdb->query( $wpdb->prepare( "UPDATE {$table} SET status = %s, updated_at = %s WHERE action_id = %s AND status IN ({$placeholders})", $args ) ); // phpcs:ignore WordPress.DB
		return 1 === (int) $changed;
	}

	/**
	 * Increments the click counter of a campaign.
	 *
	 * @param string $action_id Id.
	 * @return void
	 */
	public static function count_click( $action_id ) {
		global $wpdb;
		$table = self::table( 'actions' );
		$wpdb->query( $wpdb->prepare( "UPDATE {$table} SET clicks = clicks + 1 WHERE action_id = %s", $action_id ) ); // phpcs:ignore WordPress.DB
	}

	/**
	 * Stores a measurement from the ML service.
	 *
	 * @param string $action_id   Id.
	 * @param string $measured_at Y-m-d H:i:s.
	 * @param array  $metrics     Metrics.
	 * @return void
	 */
	public static function save_result( $action_id, $measured_at, array $metrics ) {
		global $wpdb;
		$wpdb->replace(
			self::table( 'action_results' ),
			array(
				'action_id'   => $action_id,
				'measured_at' => $measured_at,
				'metrics'     => wp_json_encode( BAP_Event_Validator::sanitize_data( $metrics ) ),
			)
		);
	}

	/**
	 * Latest measurement per action.
	 *
	 * @param string[] $action_ids Ids.
	 * @return array action_id => metrics.
	 */
	public static function latest_results( array $action_ids ) {
		global $wpdb;
		if ( ! $action_ids ) {
			return array();
		}
		$table        = self::table( 'action_results' );
		$placeholders = implode( ',', array_fill( 0, count( $action_ids ), '%s' ) );
		$rows         = $wpdb->get_results( $wpdb->prepare( "SELECT action_id, metrics FROM {$table} WHERE action_id IN ({$placeholders}) ORDER BY measured_at ASC", $action_ids ), ARRAY_A ); // phpcs:ignore WordPress.DB
		$out          = array();
		foreach ( (array) $rows as $row ) {
			$out[ $row['action_id'] ] = json_decode( (string) $row['metrics'], true );
		}
		return $out;
	}

	// ---------------------------------------------------------------- audit

	/**
	 * Appends to the audit trail.
	 *
	 * @param string $action_id Action id ('' for run-level events).
	 * @param string $event     Event name.
	 * @param array  $data      Details.
	 * @return void
	 */
	public static function audit( $action_id, $event, array $data = array() ) {
		global $wpdb;
		$wpdb->insert(
			self::table( 'audit' ),
			array(
				'action_id'  => (string) $action_id,
				'event'      => substr( (string) $event, 0, 40 ),
				'actor'      => get_current_user_id(),
				'data'       => wp_json_encode( $data ),
				'created_at' => self::now(),
			)
		);
	}

	/**
	 * Recent audit rows.
	 *
	 * @param int $limit Rows.
	 * @return array
	 */
	public static function audit_log( $limit = 50 ) {
		global $wpdb;
		$table = self::table( 'audit' );
		return (array) $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$table} ORDER BY id DESC LIMIT %d", max( 1, min( 500, (int) $limit ) ) ), ARRAY_A ); // phpcs:ignore WordPress.DB
	}
}
