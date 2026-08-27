<?php
/**
 * WordPress event listeners.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Connects WordPress lifecycle hooks to the event pipeline.
 *
 * This class is wiring and nothing else. It listens, asks
 * {@see EventDetector} what happened, and hands the answer to
 * {@see Dispatcher}. Lifecycle rules, identifier generation, payload
 * shaping, signing and retrying all live in their own classes.
 *
 * Four listeners cover the contract:
 *
 * - `transition_post_status` — a post entering a publish status. Covers
 *   draft, pending, future (scheduled) and auto-draft origins, plus posts
 *   inserted directly as published by front-end submission forms.
 * - `wp_after_insert_post`   — a published post being modified, checked
 *   after terms and meta are written so the change is complete.
 * - `wp_trash_post`          — optional: an advertisement being trashed.
 * - `before_delete_post`     — permanent deletion, snapshotted while the
 *   post can still be read.
 *
 * Every hook writes what it saw to the log, so the first question when a
 * publish produced nothing ("did the hook fire at all?") is answerable
 * without touching the code.
 *
 * @since 1.0.0
 */
class Hooks {

	/**
	 * Cron hook used by version 1.0.0.
	 *
	 * Retained so integrations referencing this constant keep resolving.
	 * New work is scheduled on {@see Dispatcher::CRON_HOOK}.
	 *
	 * @deprecated 1.1.0 Use Dispatcher::CRON_HOOK.
	 *
	 * @var string
	 */
	public const CRON_HOOK = 'wpep_dispatch_webhook';

	/**
	 * Post meta key storing the delivery state for a post.
	 *
	 * @var string
	 */
	public const META_STATE = '_wpep_webhook_state';

	/**
	 * Post meta key storing the time of the last successful delivery.
	 *
	 * @var string
	 */
	public const META_SENT_AT = '_wpep_webhook_sent_at';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Event detector dependency.
	 *
	 * @var EventDetector
	 */
	private EventDetector $detector;

	/**
	 * Dispatcher dependency.
	 *
	 * @var Dispatcher
	 */
	private Dispatcher $dispatcher;

	/**
	 * Normalizer dependency.
	 *
	 * @var Normalizer
	 */
	private Normalizer $normalizer;

	/**
	 * Contract builder dependency.
	 *
	 * @var Contract
	 */
	private Contract $contract;

	/**
	 * Signature service, used for snapshot timestamps.
	 *
	 * @var Signer
	 */
	private Signer $signer;

	/**
	 * Logger dependency.
	 *
	 * @var Logger
	 */
	private Logger $logger;

	/**
	 * Constructor.
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Detection and dispatch were extracted into dedicated services.
	 * @since 1.2.0 Added the logger dependency.
	 *
	 * @param Settings      $settings   Settings service.
	 * @param EventDetector $detector   Event detector.
	 * @param Dispatcher    $dispatcher Delivery dispatcher.
	 * @param Normalizer    $normalizer Normalizer service.
	 * @param Contract      $contract   Contract builder.
	 * @param Signer        $signer     Signature service.
	 * @param Logger        $logger     Logger service.
	 */
	public function __construct(
		Settings $settings,
		EventDetector $detector,
		Dispatcher $dispatcher,
		Normalizer $normalizer,
		Contract $contract,
		Signer $signer,
		Logger $logger
	) {
		$this->settings   = $settings;
		$this->detector   = $detector;
		$this->dispatcher = $dispatcher;
		$this->normalizer = $normalizer;
		$this->contract   = $contract;
		$this->signer     = $signer;
		$this->logger     = $logger;
	}

	/**
	 * Registers the WordPress listeners.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function register(): void {
		// Registration moved to HookRouter in 1.3.0, which subscribes to
		// every publishing hook instead of three. This method stays so
		// existing integrations calling it keep working.
		_deprecated_function( __METHOD__, '1.3.0', 'WPEventPublisher\\HookRouter::register()' );
	}

	/**
	 * Handles a post entering a publish status.
	 *
	 * @since 1.0.0
	 *
	 * @param string  $new_status New post status.
	 * @param string  $old_status Previous post status.
	 * @param WP_Post $post       Post object.
	 *
	 * @return void
	 */
	public function on_transition_post_status( string $new_status, string $old_status, WP_Post $post ): void {
		$this->handle_transition( $new_status, $old_status, $post );
	}

	/**
	 * Decides and queues the event for a status transition.
	 *
	 * Called by {@see HookRouter} for the generic transition hook, for the
	 * `{old}_to_publish` aliases and for `post_updated` when the status
	 * changed. Any of them arriving first is fine; the duplicate guard in
	 * the detector keeps the result to one event.
	 *
	 * @since 1.3.0
	 *
	 * @param string  $new_status New post status.
	 * @param string  $old_status Previous post status.
	 * @param WP_Post $post       Post object.
	 *
	 * @return void
	 */
	public function handle_transition( string $new_status, string $old_status, WP_Post $post ): void {
		$event_type = $this->detector->detect_transition( $new_status, $old_status, $post );

		if ( null === $event_type ) {
			return;
		}

		// Recorded before queueing so a second transition in the same
		// request cannot produce a second `created` event, and so a
		// scheduled post that never runs through wp_after_insert_post
		// still gets a change baseline.
		$this->detector->mark_published( $post->ID );
		$this->detector->remember_fingerprint( $post );

		$this->dispatcher->queue( $post->ID, $event_type );
	}

	/**
	 * Handles modifications to an already published post.
	 *
	 * Runs after terms and meta have been saved, so a change to either is
	 * visible to the fingerprint comparison.
	 *
	 * @since 1.1.0
	 *
	 * @param int          $post_id     Post ID.
	 * @param WP_Post      $post        Post after the save.
	 * @param bool         $update      Whether this was an update of an existing post.
	 * @param WP_Post|null $post_before Post before the save, null on creation.
	 *
	 * @return void
	 */
	public function on_after_insert_post( int $post_id, WP_Post $post, bool $update, ?WP_Post $post_before = null ): void {
		$this->handle_update( $post, $post_before );
	}

	/**
	 * Decides and queues the event for a modification of a live post.
	 *
	 * @since 1.3.0
	 *
	 * @param WP_Post      $post        Post after the save.
	 * @param WP_Post|null $post_before Post before the save, when known.
	 *
	 * @return void
	 */
	public function handle_update( WP_Post $post, ?WP_Post $post_before = null ): void {
		$event_type = $this->detector->detect_update( $post, $post_before );

		if ( null === $event_type ) {
			return;
		}

		$this->dispatcher->queue( $post->ID, $event_type );
	}

	/**
	 * Announces a published post that was never announced.
	 *
	 * The safety net behind every other hook: if an advertisement is live
	 * but the plugin never emitted an event for it — it was published
	 * while the plugin was disabled, misconfigured, or before its post
	 * type was enabled — the next save sends it once.
	 *
	 * @since 1.3.0
	 *
	 * @param WP_Post $post Post being saved.
	 *
	 * @return void
	 */
	public function handle_save( WP_Post $post ): void {
		$event_type = $this->detector->detect_unannounced( $post );

		if ( null === $event_type ) {
			return;
		}

		$this->detector->mark_published( $post->ID );
		$this->detector->remember_fingerprint( $post );

		$this->dispatcher->queue( $post->ID, $event_type );
	}

	/**
	 * Handles an advertisement restored from the trash.
	 *
	 * A restore returns the listing to the channel, so it is announced as
	 * a creation when it was never delivered and as an update when it was.
	 *
	 * @since 1.3.0
	 *
	 * @param WP_Post $post Restored post.
	 *
	 * @return void
	 */
	public function handle_restore( WP_Post $post ): void {
		$event_type = $this->detector->detect_restore( $post );

		if ( null === $event_type ) {
			return;
		}

		$this->detector->mark_published( $post->ID );
		$this->detector->remember_fingerprint( $post );

		$this->dispatcher->queue( $post->ID, $event_type );
	}

	/**
	 * Handles an advertisement being moved to the trash.
	 *
	 * Off by default: on most sites trashing is an editorial step rather
	 * than a removal. Enable "Treat trashing as a deletion" in Settings to
	 * announce it, in which case the later permanent deletion is
	 * suppressed so the consumer sees exactly one `deleted` event.
	 *
	 * @since 1.2.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return void
	 */
	public function on_trash_post( int $post_id ): void {
		if ( ! $this->settings->get( 'trash_as_deleted', false ) ) {
			return;
		}

		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			return;
		}

		$this->snapshot_removal( $post, 'wp_trash_post' );
	}

	/**
	 * Handles permanent deletion of a post.
	 *
	 * The payload is built here, while the post, its meta and its terms
	 * still exist. The dispatcher delivers that snapshot afterwards, when
	 * reading the post would no longer be possible.
	 *
	 * @since 1.1.0
	 *
	 * @param int          $post_id Post ID.
	 * @param WP_Post|null $post    Post about to be deleted.
	 *
	 * @return void
	 */
	public function on_before_delete_post( int $post_id, ?WP_Post $post = null ): void {
		if ( ! $post instanceof WP_Post ) {
			$post = get_post( $post_id );
		}

		if ( ! $post instanceof WP_Post ) {
			return;
		}

		$this->snapshot_removal( $post, 'before_delete_post' );
	}

	/**
	 * Builds and queues a `deleted` event with a payload snapshot.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post Post being removed.
	 * @param string  $hook Observing hook name.
	 *
	 * @return void
	 */
	private function snapshot_removal( WP_Post $post, string $hook ): void {
		$event_type = $this->detector->detect_delete( $post, $hook );

		if ( null === $event_type ) {
			return;
		}

		$event = $this->dispatcher->create_event( $post->ID, $event_type );

		$snapshot = $this->contract->build(
			$event,
			$this->normalizer->normalize( $post, $event_type ),
			$this->signer->timestamp()
		);

		$this->dispatcher->enqueue( $event->with_snapshot( $snapshot ) );
	}

	/**
	 * Queues a webhook for a post.
	 *
	 * Retained from version 1.0.0 for integrations that trigger delivery
	 * programmatically. The event type is inferred from the post's
	 * history so the consumer still receives a correct lifecycle event.
	 *
	 * @since 1.0.0
	 *
	 * @param int $post_id Post ID.
	 * @param int $attempt Attempt number, unused; retries are scheduled by the dispatcher.
	 *
	 * @return void
	 */
	public function enqueue( int $post_id, int $attempt = 1 ): void {
		unset( $attempt );

		$event_type = $this->detector->has_been_published( $post_id ) ? Event::TYPE_UPDATED : Event::TYPE_CREATED;

		$this->dispatcher->queue( $post_id, $event_type );
	}

	/**
	 * Executes a queued webhook job.
	 *
	 * Retained from version 1.0.0; delegates to the dispatcher.
	 *
	 * @since 1.0.0
	 *
	 * @param int $post_id Post ID.
	 * @param int $attempt Attempt number, 1-based.
	 *
	 * @return void
	 */
	public function run_job( int $post_id, int $attempt = 1 ): void {
		$this->dispatcher->run_legacy_job( $post_id, $attempt );
	}

	/**
	 * Resets the delivery state for a post so it can be sent again.
	 *
	 * The next delivery is a new event and therefore receives a new
	 * identifier; the consumer will not treat it as a duplicate.
	 *
	 * @since 1.0.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return void
	 */
	public function reset_state( int $post_id ): void {
		delete_post_meta( $post_id, self::META_STATE );
		delete_post_meta( $post_id, self::META_SENT_AT );
		delete_post_meta( $post_id, EventDetector::META_FINGERPRINT );
		delete_post_meta( $post_id, EventDetector::META_DELETE_SENT );
	}

	/**
	 * Returns the settings service.
	 *
	 * @since 1.1.0
	 *
	 * @return Settings Settings service.
	 */
	public function settings(): Settings {
		return $this->settings;
	}
}
