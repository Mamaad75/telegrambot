<?php
/**
 * Batch ticket cleanup.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Deletes tickets in batches, with a pause on automation while it runs.
 *
 * Deleting ten thousand posts in one request does not work: PHP's time limit
 * ends it partway through, and there is no record of how far it got. So the
 * work is a job with state — a target, a cursor, a tally — that each batch
 * advances by a hundred and then stops.
 *
 * The pause matters as much as the batching. Cleanup exists because an
 * automation produced tickets nobody wanted; deleting them while that same
 * automation is still enabled means racing something that is actively
 * refilling the table.
 *
 * @since 1.19.2
 */
final class TicketCleanup {

	/**
	 * Option holding the running job.
	 *
	 * @var string
	 */
	public const OPTION = '_jarchi_ticket_cleanup_job';

	/**
	 * Option that pauses automation while a job runs.
	 *
	 * @var string
	 */
	public const PAUSE_OPTION = '_jarchi_automation_paused';

	/**
	 * Tickets deleted per batch.
	 *
	 * @var int
	 */
	public const BATCH = 100;

	/**
	 * Delete only tickets an automation produced.
	 *
	 * @var string
	 */
	public const SCOPE_AUTOMATED = 'automated';

	/**
	 * Delete every ticket.
	 *
	 * @var string
	 */
	public const SCOPE_ALL = 'all';

	/**
	 * Registers the hooks.
	 *
	 * @since 1.19.2
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( 'admin_post_wpep_ticket_cleanup_start', array( $this, 'handle_start' ) );
		add_action( 'admin_post_wpep_ticket_cleanup_cancel', array( $this, 'handle_cancel' ) );
		add_action( 'wp_ajax_wpep_ticket_cleanup_step', array( $this, 'ajax_step' ) );
	}

	/**
	 * Whether automation is paused by a running cleanup.
	 *
	 * @since 1.19.2
	 *
	 * @return bool True when paused.
	 */
	public static function automation_paused(): bool {
		return (bool) get_option( self::PAUSE_OPTION, false );
	}

	/**
	 * The running job, if there is one.
	 *
	 * @since 1.19.2
	 *
	 * @return array<string,mixed>|null Job state.
	 */
	public function job(): ?array {
		$job = get_option( self::OPTION, null );

		return is_array( $job ) && ! empty( $job['scope'] ) ? $job : null;
	}

	/**
	 * How many tickets match one scope.
	 *
	 * Counted in SQL: the point of the tool is that the table is too big to
	 * load, so counting it by loading it would defeat the exercise.
	 *
	 * @since 1.19.2
	 *
	 * @param string $scope automated|all.
	 *
	 * @return int Ticket count.
	 */
	public function count_matching( string $scope ): int {
		global $wpdb;

		if ( self::SCOPE_ALL === $scope ) {
			// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
			return (int) $wpdb->get_var(
				$wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = %s", Tickets::POST_TYPE )
			);
			// phpcs:enable
		}

		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->posts} p
				 INNER JOIN {$wpdb->postmeta} m ON m.post_id = p.ID
				 WHERE p.post_type = %s AND m.meta_key = %s AND m.meta_value = '1'",
				Tickets::POST_TYPE,
				Tickets::META_AUTOMATED
			)
		);
		// phpcs:enable
	}

	/**
	 * The next batch of ticket ids to delete.
	 *
	 * @since 1.19.2
	 *
	 * @param string $scope automated|all.
	 * @param int    $limit Batch size.
	 *
	 * @return int[] Ticket ids.
	 */
	private function next_batch( string $scope, int $limit ): array {
		global $wpdb;

		/*
		 * No offset. Each batch deletes what it finds, so the next batch's
		 * "first hundred" is a hundred different rows — paging with an offset
		 * over a shrinking table skips records.
		 */
		if ( self::SCOPE_ALL === $scope ) {
			// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
			return array_map(
				'intval',
				(array) $wpdb->get_col(
					$wpdb->prepare(
						"SELECT ID FROM {$wpdb->posts} WHERE post_type = %s ORDER BY ID ASC LIMIT %d",
						Tickets::POST_TYPE,
						$limit
					)
				)
			);
			// phpcs:enable
		}

		// phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT p.ID FROM {$wpdb->posts} p
					 INNER JOIN {$wpdb->postmeta} m ON m.post_id = p.ID
					 WHERE p.post_type = %s AND m.meta_key = %s AND m.meta_value = '1'
					 ORDER BY p.ID ASC LIMIT %d",
					Tickets::POST_TYPE,
					Tickets::META_AUTOMATED,
					$limit
				)
			)
		);
		// phpcs:enable
	}

	/**
	 * Starts a cleanup job.
	 *
	 * @since 1.19.2
	 *
	 * @return void
	 */
	public function handle_start(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) );
		}

		check_admin_referer( Tickets::NONCE );

		$scope = sanitize_key( wp_unslash( $_POST['scope'] ?? '' ) );

		if ( ! in_array( $scope, array( self::SCOPE_AUTOMATED, self::SCOPE_ALL ), true ) ) {
			wp_safe_redirect( Admin::app_url( 'ticket-cleanup' ) );
			exit;
		}

		// Deleting everything is not something to do by mis-clicking, so it
		// requires typing the word as well as pressing the button.
		if ( self::SCOPE_ALL === $scope ) {
			$typed = sanitize_text_field( wp_unslash( $_POST['confirm'] ?? '' ) );

			if ( 'DELETE' !== strtoupper( $typed ) ) {
				wp_safe_redirect( add_query_arg( 'cleanup', 'unconfirmed', Admin::app_url( 'ticket-cleanup' ) ) );
				exit;
			}
		}

		$total = $this->count_matching( $scope );

		update_option(
			self::OPTION,
			array(
				'scope'      => $scope,
				'total'      => $total,
				'deleted'    => 0,
				'failed'     => 0,
				'started_at' => current_time( 'mysql' ),
			),
			false
		);

		// Automation stops while the job runs, so it cannot refill the table
		// behind the deletion.
		update_option( self::PAUSE_OPTION, '1', false );

		wp_safe_redirect( add_query_arg( 'cleanup', 'started', Admin::app_url( 'ticket-cleanup' ) ) );
		exit;
	}

	/**
	 * Cancels a running job.
	 *
	 * @since 1.19.2
	 *
	 * @return void
	 */
	public function handle_cancel(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) );
		}

		check_admin_referer( Tickets::NONCE );

		$this->finish();

		wp_safe_redirect( add_query_arg( 'cleanup', 'cancelled', Admin::app_url( 'ticket-cleanup' ) ) );
		exit;
	}

	/**
	 * Ends the job and lets automation run again.
	 *
	 * @since 1.19.2
	 *
	 * @return void
	 */
	private function finish(): void {
		delete_option( self::OPTION );
		delete_option( self::PAUSE_OPTION );
	}

	/**
	 * Deletes one batch and reports progress.
	 *
	 * @since 1.19.2
	 *
	 * @return void
	 */
	public function ajax_step(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => __( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) ), 403 );
		}

		check_ajax_referer( Tickets::AJAX_NONCE, 'nonce' );

		wp_send_json_success( $this->run_batch() );
	}

	/**
	 * Deletes the next batch.
	 *
	 * @since 1.19.2
	 *
	 * @return array<string,mixed> Progress.
	 */
	public function run_batch(): array {
		$job = $this->job();

		if ( null === $job ) {
			return array( 'running' => false, 'deleted' => 0, 'remaining' => 0, 'total' => 0, 'failed' => 0 );
		}

		$scope = (string) $job['scope'];
		$ids   = $this->next_batch( $scope, self::BATCH );

		foreach ( $ids as $ticket_id ) {
			if ( $this->delete_ticket( $ticket_id ) ) {
				++$job['deleted'];
			} else {
				++$job['failed'];
			}
		}

		$remaining = $this->count_matching( $scope );

		if ( empty( $ids ) || $remaining <= 0 ) {
			$done = array(
				'running'   => false,
				'deleted'   => (int) $job['deleted'],
				'failed'    => (int) $job['failed'],
				'remaining' => 0,
				'total'     => (int) $job['total'],
			);

			/*
			 * The ledger has to forget the events too. It exists to stop the
			 * same event producing a second ticket — so after deleting the
			 * tickets, leaving the ledger intact would mean those automations
			 * could never send again.
			 */
			if ( self::SCOPE_AUTOMATED === $scope || self::SCOPE_ALL === $scope ) {
				AutomationLedger::forget();
			}

			$this->finish();

			return $done;
		}

		update_option( self::OPTION, $job, false );

		return array(
			'running'   => true,
			'deleted'   => (int) $job['deleted'],
			'failed'    => (int) $job['failed'],
			'remaining' => $remaining,
			'total'     => (int) $job['total'],
		);
	}

	/**
	 * Deletes one ticket and everything hanging off it.
	 *
	 * @since 1.19.2
	 *
	 * @param int $ticket_id Ticket.
	 *
	 * @return bool True when it was removed.
	 */
	private function delete_ticket( int $ticket_id ): bool {
		$ticket = get_post( $ticket_id );

		// Refuses to touch anything that is not a Jarchi ticket, however the
		// id arrived. A cleanup tool that can be pointed at a post type is a
		// data-loss incident waiting for a typo.
		if ( ! $ticket || Tickets::POST_TYPE !== $ticket->post_type ) {
			return false;
		}

		// Before the messages go, not after: half the attachment ids live in
		// comment meta, and once the comments are deleted there is nothing
		// left to say which uploads belonged to this ticket.
		wpep()->tickets()->delete_ticket_attachments( $ticket_id );

		foreach ( (array) get_comments( array( 'post_id' => $ticket_id, 'type' => Tickets::COMMENT_TYPE ) ) as $comment ) {
			wp_delete_comment( (int) $comment->comment_ID, true );
		}

		$deleted = wp_delete_post( $ticket_id, true );

		return (bool) $deleted;
	}

	/**
	 * Renders the screen.
	 *
	 * @since 1.19.2
	 *
	 * @return void
	 */
	public function render(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		$job       = $this->job();
		$automated = $this->count_matching( self::SCOPE_AUTOMATED );
		$all       = $this->count_matching( self::SCOPE_ALL );

		include WPEP_PLUGIN_DIR . 'admin/views/ticket-cleanup.php';
	}
}
