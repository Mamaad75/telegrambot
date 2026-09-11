<?php
/**
 * The automation event ledger.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Records which automation events have already produced a ticket.
 *
 * WHY THIS IS A TABLE AND NOT USER META
 * -------------------------------------
 * The previous guard was:
 *
 *     if ( get_user_meta( $user, $marker ) ) { return; }
 *     … create the ticket …
 *     update_user_meta( $user, $marker, time() );
 *
 * Two requests arriving together both read "not yet", both pass, and both
 * create. That is not a rare interleaving: WooCommerce fires overlapping
 * status hooks, cron can run while a page request is in flight, and a
 * double-clicked publish button is two requests milliseconds apart. It is
 * exactly how one customer ends up with hundreds of copies of one message.
 *
 * The fix has to be a single atomic operation that both asks and answers.
 * `INSERT` against a `UNIQUE` index is that operation: the database decides
 * the winner, and the loser is told it lost. Nothing in WordPress's options
 * or meta API offers that guarantee — `add_option()` reads and then writes,
 * so it has the same race one layer down.
 *
 * The ledger therefore stores one row per logical event:
 *
 *     rule id + user id + event type + object id
 *
 * The object id is what makes "once" mean the right thing. Keyed on the rule
 * and user alone, a customer's second order would be silently swallowed
 * because their first one had already used the key up.
 *
 * @since 1.19.2
 */
final class AutomationLedger {

	/**
	 * Schema version, so an upgrade knows to run dbDelta again.
	 *
	 * @var string
	 */
	private const SCHEMA_VERSION = '1';

	/**
	 * Option holding the installed schema version.
	 *
	 * @var string
	 */
	private const SCHEMA_OPTION = 'wpep_automation_ledger_schema';

	/**
	 * A reservation that has been made but not yet confirmed.
	 *
	 * @var string
	 */
	public const STATE_PENDING = 'pending';

	/**
	 * A reservation whose ticket was created.
	 *
	 * @var string
	 */
	public const STATE_DONE = 'done';

	/**
	 * How long a pending reservation may sit before it is considered abandoned.
	 *
	 * A request that reserves and then dies — a fatal, a timeout, a deploy —
	 * must not block that event for ever. Fifteen minutes is far longer than
	 * any legitimate ticket creation and short enough that a genuine failure
	 * can be retried the same day.
	 *
	 * @var int
	 */
	private const PENDING_TTL = 900;

	/**
	 * The table name.
	 *
	 * @since 1.19.2
	 *
	 * @return string Prefixed table name.
	 */
	public static function table(): string {
		global $wpdb;

		return $wpdb->prefix . 'wpep_automation_events';
	}

	/**
	 * Creates or updates the table.
	 *
	 * @since 1.19.2
	 *
	 * @return void
	 */
	public static function install(): void {
		global $wpdb;

		if ( self::SCHEMA_VERSION === (string) get_option( self::SCHEMA_OPTION, '' ) ) {
			return;
		}

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$collate = $wpdb->get_charset_collate();

		/*
		 * event_key is a hash rather than the raw parts, so the UNIQUE index
		 * has a fixed, short width. A composite index over four columns of
		 * unknown length runs into MySQL's key-length limit on utf8mb4.
		 */
		$sql = "CREATE TABLE {$table} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_key CHAR(64) NOT NULL,
			rule_id VARCHAR(64) NOT NULL DEFAULT '',
			user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			event_type VARCHAR(40) NOT NULL DEFAULT '',
			object_id VARCHAR(64) NOT NULL DEFAULT '',
			state VARCHAR(16) NOT NULL DEFAULT 'pending',
			ticket_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY event_key (event_key),
			KEY rule_user (rule_id(32), user_id),
			KEY created_at (created_at)
		) {$collate};";

		dbDelta( $sql );

		update_option( self::SCHEMA_OPTION, self::SCHEMA_VERSION, false );
	}

	/**
	 * Builds the key for one logical event.
	 *
	 * Deterministic, so the same event always produces the same key however
	 * many code paths reach it — which is what stops WooCommerce's overlapping
	 * status hooks from being counted as two different things.
	 *
	 * @since 1.19.2
	 *
	 * @param string $rule_id    Rule.
	 * @param int    $user_id    Recipient.
	 * @param string $event_type Trigger name.
	 * @param string $object_id  The thing it happened to, if any.
	 *
	 * @return string 64-character key.
	 */
	public static function key( string $rule_id, int $user_id, string $event_type, string $object_id = '' ): string {
		return hash(
			'sha256',
			implode(
				'|',
				array(
					sanitize_key( $rule_id ),
					(string) $user_id,
					sanitize_key( $event_type ),
					(string) $object_id,
				)
			)
		);
	}

	/**
	 * Claims one event, atomically.
	 *
	 * Returns true to exactly one caller for a given key. Everyone else — a
	 * concurrent request, a duplicate hook, a retried cron run — gets false
	 * and must not create anything.
	 *
	 * @since 1.19.2
	 *
	 * @param string $rule_id    Rule.
	 * @param int    $user_id    Recipient.
	 * @param string $event_type Trigger name.
	 * @param string $object_id  Event object.
	 *
	 * @return bool True when this caller won the claim.
	 */
	public static function reserve( string $rule_id, int $user_id, string $event_type, string $object_id = '' ): bool {
		global $wpdb;

		$key   = self::key( $rule_id, $user_id, $event_type, $object_id );
		$table = self::table();

		/*
		 * INSERT IGNORE, not "SELECT then INSERT".
		 *
		 * The unique index makes the database the arbiter: the row either
		 * appears because of this statement or it does not. rows_affected is
		 * then a truthful answer to "did I win?", and it is impossible for two
		 * callers to both be told yes.
		 */
		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table, prepared below.
		$inserted = $wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO {$table}
					( event_key, rule_id, user_id, event_type, object_id, state, created_at )
				 VALUES ( %s, %s, %d, %s, %s, %s, %s )",
				$key,
				sanitize_key( $rule_id ),
				$user_id,
				sanitize_key( $event_type ),
				(string) $object_id,
				self::STATE_PENDING,
				current_time( 'mysql', true )
			)
		);
		// phpcs:enable

		if ( $inserted ) {
			return true;
		}

		/*
		 * The row already exists. It is a duplicate — unless it is a stale
		 * pending reservation from a request that died before it finished, in
		 * which case this caller may take it over. The takeover is itself a
		 * conditional UPDATE, so two requests racing to adopt the same corpse
		 * still produce exactly one winner.
		 */
		$adopted = $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$table}
				    SET created_at = %s
				  WHERE event_key = %s
				    AND state = %s
				    AND created_at < %s",
				current_time( 'mysql', true ),
				$key,
				self::STATE_PENDING,
				gmdate( 'Y-m-d H:i:s', time() - self::PENDING_TTL )
			)
		);

		return (bool) $adopted;
	}

	/**
	 * Marks a reservation as having produced a ticket.
	 *
	 * @since 1.19.2
	 *
	 * @param string $rule_id    Rule.
	 * @param int    $user_id    Recipient.
	 * @param string $event_type Trigger name.
	 * @param string $object_id  Event object.
	 * @param int    $ticket_id  The ticket that was created.
	 *
	 * @return void
	 */
	public static function confirm( string $rule_id, int $user_id, string $event_type, string $object_id, int $ticket_id ): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- internal table.
		$wpdb->update(
			self::table(),
			array( 'state' => self::STATE_DONE, 'ticket_id' => $ticket_id ),
			array( 'event_key' => self::key( $rule_id, $user_id, $event_type, $object_id ) ),
			array( '%s', '%d' ),
			array( '%s' )
		);
	}

	/**
	 * Gives a reservation back.
	 *
	 * Called when the ticket could not be created after all. Without this a
	 * transient failure — the mail server refusing, a validation error — would
	 * permanently consume the event and the customer would never be told.
	 *
	 * @since 1.19.2
	 *
	 * @param string $rule_id    Rule.
	 * @param int    $user_id    Recipient.
	 * @param string $event_type Trigger name.
	 * @param string $object_id  Event object.
	 *
	 * @return void
	 */
	public static function release( string $rule_id, int $user_id, string $event_type, string $object_id = '' ): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- internal table.
		$wpdb->delete(
			self::table(),
			array(
				'event_key' => self::key( $rule_id, $user_id, $event_type, $object_id ),
				'state'     => self::STATE_PENDING,
			),
			array( '%s', '%s' )
		);
	}

	/**
	 * Whether an event has already been handled.
	 *
	 * For dry runs and reporting only. Never use this to decide whether to
	 * create — that decision must go through reserve(), or the check and the
	 * act are two steps again and the race is back.
	 *
	 * @since 1.19.2
	 *
	 * @param string $rule_id    Rule.
	 * @param int    $user_id    Recipient.
	 * @param string $event_type Trigger name.
	 * @param string $object_id  Event object.
	 *
	 * @return bool True when a row exists.
	 */
	public static function seen( string $rule_id, int $user_id, string $event_type, string $object_id = '' ): bool {
		global $wpdb;

		$table = self::table();

		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		return (bool) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT id FROM {$table} WHERE event_key = %s LIMIT 1",
				self::key( $rule_id, $user_id, $event_type, $object_id )
			)
		);
		// phpcs:enable
	}

	/**
	 * Forgets every reservation for one rule.
	 *
	 * Used when a rule is deleted, and by the cleanup tool: after deleting the
	 * tickets an automation produced, the ledger must forget them too, or the
	 * rule can never send them again.
	 *
	 * @since 1.19.2
	 *
	 * @param string $rule_id Rule, or an empty string for every rule.
	 *
	 * @return int Rows removed.
	 */
	public static function forget( string $rule_id = '' ): int {
		global $wpdb;

		$table = self::table();

		if ( '' === $rule_id ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
			return (int) $wpdb->query( "DELETE FROM {$table}" );
		}

		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		return (int) $wpdb->query(
			$wpdb->prepare( "DELETE FROM {$table} WHERE rule_id = %s", sanitize_key( $rule_id ) )
		);
		// phpcs:enable
	}

	/**
	 * Drops rows older than the retention window.
	 *
	 * The ledger grows by one row per delivered message and would otherwise
	 * outlive its usefulness. A year is well past the point where re-sending
	 * an old notification would be correct rather than confusing.
	 *
	 * @since 1.19.2
	 *
	 * @param int $days Retention in days.
	 *
	 * @return int Rows removed.
	 */
	public static function prune( int $days = 365 ): int {
		global $wpdb;

		$table = self::table();

		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		return (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE created_at < %s",
				gmdate( 'Y-m-d H:i:s', time() - ( max( 1, $days ) * DAY_IN_SECONDS ) )
			)
		);
		// phpcs:enable
	}

	/**
	 * How many events the ledger is holding.
	 *
	 * @since 1.19.2
	 *
	 * @return int Row count.
	 */
	public static function count(): int {
		global $wpdb;

		$table = self::table();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared -- internal table.
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
	}
}
