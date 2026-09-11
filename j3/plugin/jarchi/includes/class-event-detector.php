<?php
/**
 * Event lifecycle detection.
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
 * Decides which lifecycle event, if any, a WordPress state change
 * represents.
 *
 * The rules are deliberately conservative, because every false positive
 * becomes a message the downstream service has to publish:
 *
 * - `created` fires once, the first time a post enters a configured
 *   publish status. A post that is unpublished and published again is an
 *   update, never a second creation.
 * - `updated` fires only when an already published post is saved, stays
 *   published, and its content fingerprint actually changed. Routine
 *   internal saves that touch nothing observable are ignored.
 * - `deleted` fires only for the removal of a post that had been
 *   published at some point. Drafts that never went live are ignored.
 *
 * Every decision that suppresses an event is written to the log with the
 * exact reason, so "I published an advertisement and nothing happened"
 * is always answerable from the Logs screen.
 *
 * @since 1.1.0
 */
class EventDetector {

	/**
	 * Post meta key recording the first time a post was published.
	 *
	 * @var string
	 */
	public const META_FIRST_PUBLISHED = '_wpep_first_published_at';

	/**
	 * Post meta key storing the content fingerprint of the last event.
	 *
	 * @var string
	 */
	public const META_FINGERPRINT = '_wpep_content_hash';

	/**
	 * Post meta key marking that a deletion event was already emitted.
	 *
	 * Trashing and then permanently deleting the same advertisement must
	 * not produce two `deleted` events.
	 *
	 * @var string
	 */
	public const META_DELETE_SENT = '_wpep_delete_announced';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Logger dependency.
	 *
	 * @var Logger
	 */
	private Logger $logger;

	/**
	 * Events already emitted in this request, keyed by "post:type".
	 *
	 * @var array<string,bool>
	 */
	private array $emitted = array();

	/**
	 * Constructor.
	 *
	 * @since 1.1.0
	 * @since 1.2.0 Added the logger dependency.
	 *
	 * @param Settings $settings Settings service.
	 * @param Logger   $logger   Logger service.
	 */
	public function __construct( Settings $settings, Logger $logger ) {
		$this->settings = $settings;
		$this->logger   = $logger;
	}

	/**
	 * Reason codes that describe a configuration problem rather than a
	 * routine, uninteresting save.
	 *
	 * Only these are worth a log entry when logging is not in debug mode:
	 * they are the answers to "I published an advertisement and nothing
	 * happened". Revisions and autosaves are ordinary and stay quiet.
	 *
	 * @var string[]
	 */
	private const ACTIONABLE_REASONS = array( 'plugin_disabled', 'webhooks_disabled', 'post_type', 'filtered' );

	/**
	 * Whether the plugin should look at this post at all.
	 *
	 * @since 1.1.0
	 *
	 * @param WP_Post $post      Post object.
	 * @param string  $context   Calling hook, used for log context.
	 * @param bool    $announced Whether this save was a real publish attempt,
	 *                           which makes a skip worth logging outside debug mode.
	 *
	 * @return bool True when the post is in scope.
	 */
	public function is_eligible( WP_Post $post, string $context = '', bool $announced = false ): bool {
		$reason = $this->ineligibility_reason( $post );

		if ( null === $reason ) {
			return true;
		}

		$this->log_skip(
			$post,
			(string) $reason['message'],
			$context,
			$announced && in_array( (string) $reason['code'], self::ACTIONABLE_REASONS, true )
		);

		return false;
	}

	/**
	 * Returns why a post is out of scope, or null when it is in scope.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return array{code:string,message:string}|null Reason, null when eligible.
	 */
	public function ineligibility_reason( WP_Post $post ): ?array {
		if ( ! $this->settings->get( 'enabled' ) ) {
			return array(
				'code'    => 'plugin_disabled',
				'message' => __( 'The plugin is disabled in Settings (Enable Plugin is off).', 'wp-event-publisher' ),
			);
		}

		if ( ! $this->settings->get( 'webhooks_enabled' ) ) {
			return array(
				'code'    => 'webhooks_disabled',
				'message' => __( 'Webhook delivery is disabled in Settings (Enable Webhooks is off).', 'wp-event-publisher' ),
			);
		}

		if ( wp_is_post_revision( $post ) || wp_is_post_autosave( $post ) ) {
			return array(
				'code'    => 'revision',
				'message' => __( 'The post is a revision or an autosave.', 'wp-event-publisher' ),
			);
		}

		if ( 'auto-draft' === $post->post_status ) {
			return array(
				'code'    => 'auto_draft',
				'message' => __( 'The post is still an auto-draft.', 'wp-event-publisher' ),
			);
		}

		$allowed = $this->settings->allowed_post_types();

		if ( ! in_array( $post->post_type, $allowed, true ) ) {
			return array(
				'code'    => 'post_type',
				'message' => sprintf(
					/* translators: 1: post type of the saved post, 2: comma separated list of enabled post types. */
					__( 'The post type "%1$s" is not enabled. Enabled post types: %2$s. Enable it under Settings → Allowed Post Types.', 'wp-event-publisher' ),
					$post->post_type,
					empty( $allowed ) ? __( '(none)', 'wp-event-publisher' ) : implode( ', ', $allowed )
				),
			);
		}

		/**
		 * Filters whether a post is eligible for event detection.
		 *
		 * @since 1.1.0
		 *
		 * @param bool    $eligible Whether the post is in scope.
		 * @param WP_Post $post     Post object.
		 */
		if ( ! apply_filters( 'wpep_is_eligible', true, $post ) ) {
			return array(
				'code'    => 'filtered',
				'message' => __( 'A wpep_is_eligible filter callback rejected the post.', 'wp-event-publisher' ),
			);
		}

		return null;
	}

	/**
	 * Whether a status counts as published for this installation.
	 *
	 * @since 1.1.0
	 *
	 * @param string $status Post status.
	 *
	 * @return bool True when the status is configured as publishable.
	 */
	public function is_published_status( string $status ): bool {
		$allowed = (array) $this->settings->get( 'allowed_post_statuses', array( 'publish' ) );

		return in_array( $status, $allowed, true );
	}

	/**
	 * Whether an event type may be dispatched at all.
	 *
	 * @since 1.2.0
	 *
	 * @param string $type Event type.
	 *
	 * @return bool True when the type is enabled in Settings.
	 */
	public function is_event_type_allowed( string $type ): bool {
		return in_array( $type, $this->settings->allowed_event_types(), true );
	}

	/**
	 * Detects a `created` (or re-publish `updated`) event from a status
	 * transition.
	 *
	 * @since 1.1.0
	 *
	 * @param string  $new_status New post status.
	 * @param string  $old_status Previous post status.
	 * @param WP_Post $post       Post object.
	 *
	 * @return string|null Event type, or null when nothing should be sent.
	 */
	public function detect_transition( string $new_status, string $old_status, WP_Post $post ): ?string {
		// A skip only deserves an always-on log entry when the post was
		// actually being published; ordinary draft saves stay quiet.
		if ( ! $this->is_eligible( $post, 'transition_post_status', $this->is_published_status( $new_status ) ) ) {
			return null;
		}

		// The post must be entering a publish status, not already in one.
		if ( ! $this->is_published_status( $new_status ) ) {
			$this->logger->event(
				'detect.transition',
				Logger::STATUS_SKIPPED,
				sprintf(
					/* translators: 1: new status, 2: enabled statuses. */
					__( 'Status "%1$s" is not one of the enabled publish statuses (%2$s).', 'wp-event-publisher' ),
					$new_status,
					implode( ', ', (array) $this->settings->get( 'allowed_post_statuses', array( 'publish' ) ) )
				),
				array(
					'post_id' => $post->ID,
					'data'    => array(
						'post_type'  => $post->post_type,
						'old_status' => $old_status,
						'new_status' => $new_status,
					),
				),
				true
			);

			return null;
		}

		if ( $this->is_published_status( $old_status ) ) {
			// Already live; the update path owns this save.
			return null;
		}

		// A post that has gone live before can only be updated, never re-created.
		$type = $this->has_been_published( $post->ID ) ? Event::TYPE_UPDATED : Event::TYPE_CREATED;

		return $this->finalize(
			$type,
			$post,
			array(
				'new_status' => $new_status,
				'old_status' => $old_status,
				'hook'       => 'transition_post_status',
			)
		);
	}

	/**
	 * Detects an `updated` event from a post save.
	 *
	 * Runs on `wp_after_insert_post`, i.e. after terms and meta have been
	 * written, so the fingerprint sees the complete post.
	 *
	 * @since 1.1.0
	 *
	 * @param WP_Post      $post        Post after the save.
	 * @param WP_Post|null $post_before Post before the save, when available.
	 *
	 * @return string|null Event type, or null when nothing should be sent.
	 */
	public function detect_update( WP_Post $post, ?WP_Post $post_before ): ?string {
		if ( ! $this->is_eligible( $post, 'wp_after_insert_post' ) ) {
			return null;
		}

		// Only posts that are live right now can produce an update.
		if ( ! $this->is_published_status( $post->post_status ) ) {
			return null;
		}

		$fingerprint = $this->fingerprint( $post );
		$previous    = (string) get_post_meta( $post->ID, self::META_FINGERPRINT, true );

		// Always record the current state; the comparison happens first.
		$this->remember_fingerprint( $post, $fingerprint );

		// The transition handler owns the publish moment.
		if ( null !== $post_before && ! $this->is_published_status( $post_before->post_status ) ) {
			return null;
		}

		if ( ! $this->has_been_published( $post->ID ) ) {
			return null;
		}

		// First fingerprint ever recorded: nothing to compare against.
		if ( '' === $previous ) {
			return null;
		}

		// Nothing observable changed — this was an internal save.
		if ( hash_equals( $previous, $fingerprint ) ) {
			$this->logger->event(
				'detect.update',
				Logger::STATUS_SKIPPED,
				__( 'The save did not change anything the payload exposes.', 'wp-event-publisher' ),
				array(
					'post_id' => $post->ID,
					'data'    => array( 'post_type' => $post->post_type ),
				),
				true
			);

			return null;
		}

		// Suppress the update that immediately follows a publish, which
		// editors emit when they save meta or terms in a second request.
		if ( $this->within_publish_cooldown( $post->ID ) ) {
			$this->logger->event(
				'detect.update',
				Logger::STATUS_SKIPPED,
				__( 'The save happened inside the post-publish cooldown window.', 'wp-event-publisher' ),
				array(
					'post_id' => $post->ID,
					'data'    => array( 'post_type' => $post->post_type ),
				),
				true
			);

			return null;
		}

		return $this->finalize(
			Event::TYPE_UPDATED,
			$post,
			array(
				'fingerprint' => substr( $fingerprint, 0, 12 ),
				'hook'        => 'wp_after_insert_post',
			)
		);
	}

	/**
	 * Detects a first announcement for a post that is already live.
	 *
	 * Runs on `save_post`, behind every other hook. It fires only when the
	 * post is in a publish status and the plugin has never emitted an
	 * event for it — the case where an advertisement went live while the
	 * plugin was disabled, misconfigured, or before its post type was
	 * enabled. On an ordinary publish the transition handler has already
	 * marked the post, so this returns null and no duplicate is possible.
	 *
	 * @since 1.3.0
	 *
	 * @param WP_Post $post Post being saved.
	 *
	 * @return string|null Event type, or null when nothing should be sent.
	 */
	public function detect_unannounced( WP_Post $post ): ?string {
		if ( ! $this->is_eligible( $post, 'save_post' ) ) {
			return null;
		}

		if ( ! $this->is_published_status( $post->post_status ) ) {
			return null;
		}

		if ( $this->has_been_published( $post->ID ) ) {
			// Already announced once; modifications are the update path's job.
			return null;
		}

		// Bounded on purpose. Without this, editing — or bulk editing — an
		// advertisement that went live long before the plugin existed would
		// announce it as new, and a site with a back catalogue would empty
		// that catalogue into the channel on the first bulk edit. Only
		// content published since the plugin was installed is eligible.
		if ( ! $this->published_since_install( $post ) ) {
			$this->logger->event(
				'detect.pre_install',
				Logger::STATUS_SKIPPED,
				__( 'This advertisement was published before the plugin was installed, so it is treated as back catalogue and not announced. Use Tools → Send One Advertisement Now to send it deliberately.', 'wp-event-publisher' ),
				array(
					'post_id' => $post->ID,
					'data'    => array( 'post_type' => $post->post_type ),
				),
				true
			);

			return null;
		}

		$this->logger->event(
			'detect.unannounced',
			Logger::STATUS_INFO,
			__( 'This post is published but was never announced, so it is being sent now.', 'wp-event-publisher' ),
			array(
				'post_id' => $post->ID,
				'data'    => array( 'post_type' => $post->post_type ),
			)
		);

		return $this->finalize(
			Event::TYPE_CREATED,
			$post,
			array(
				'hook'   => 'save_post',
				'reason' => 'unannounced',
			)
		);
	}

	/**
	 * Whether a post went live after this plugin was installed.
	 *
	 * @since 1.3.2
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return bool True when the post is newer than the installation.
	 */
	private function published_since_install( WP_Post $post ): bool {
		$installed = (int) get_option( 'wpep_installed_at', 0 );

		/**
		 * Filters the cutoff for announcing a post that was never announced.
		 *
		 * Return 0 to announce any published post the first time it is
		 * saved, whatever its age.
		 *
		 * @since 1.3.2
		 *
		 * @param int     $installed Unix timestamp of the installation.
		 * @param WP_Post $post      Post being considered.
		 */
		$installed = (int) apply_filters( 'wpep_backfill_cutoff', $installed, $post );

		if ( $installed <= 0 ) {
			return true;
		}

		$published = strtotime( (string) $post->post_date_gmt . ' UTC' );

		if ( false === $published ) {
			return true;
		}

		return $published >= $installed;
	}

	/**
	 * Detects an event for a post restored from the trash.
	 *
	 * @since 1.3.0
	 *
	 * @param WP_Post $post Restored post.
	 *
	 * @return string|null Event type, or null when nothing should be sent.
	 */
	public function detect_restore( WP_Post $post ): ?string {
		if ( ! $this->is_eligible( $post, 'untrashed_post', true ) ) {
			return null;
		}

		if ( ! $this->is_published_status( $post->post_status ) ) {
			return null;
		}

		// The listing is back, so a later removal is news again.
		delete_post_meta( $post->ID, self::META_DELETE_SENT );

		$type = $this->has_been_published( $post->ID ) ? Event::TYPE_UPDATED : Event::TYPE_CREATED;

		return $this->finalize(
			$type,
			$post,
			array(
				'hook'  => 'untrashed_post',
				'group' => 'restore',
			)
		);
	}

	/**
	 * Detects a `deleted` event from a deletion or a trashing.
	 *
	 * @since 1.1.0
	 *
	 * @param WP_Post $post Post being removed.
	 * @param string  $hook Hook that observed the removal.
	 *
	 * @return string|null Event type, or null when nothing should be sent.
	 */
	public function detect_delete( WP_Post $post, string $hook = 'before_delete_post' ): ?string {
		if ( ! $this->is_eligible( $post, $hook, true ) ) {
			return null;
		}

		// Content that never went live was never announced, so its
		// removal is not news either.
		if ( ! $this->has_been_published( $post->ID ) ) {
			return null;
		}

		// A trashed advertisement that is later purged must not be
		// announced twice.
		if ( '' !== (string) get_post_meta( $post->ID, self::META_DELETE_SENT, true ) ) {
			$this->logger->event(
				'detect.delete',
				Logger::STATUS_SKIPPED,
				__( 'A deletion event was already emitted for this post.', 'wp-event-publisher' ),
				array( 'post_id' => $post->ID ),
				true
			);

			return null;
		}

		return $this->finalize( Event::TYPE_DELETED, $post, array( 'hook' => $hook ) );
	}

	/**
	 * Applies the extensibility filters, the event type setting and the
	 * duplicate guard to a detected type.
	 *
	 * @since 1.2.0
	 *
	 * @param string              $type    Detected event type.
	 * @param WP_Post             $post    Post object.
	 * @param array<string,mixed> $context Detection context.
	 *
	 * @return string|null Final event type, or null to suppress.
	 */
	private function finalize( string $type, WP_Post $post, array $context ): ?string {
		$type = $this->filter_type( $type, $post, $context );

		if ( null === $type ) {
			$this->logger->event(
				'detect.filtered',
				Logger::STATUS_SKIPPED,
				__( 'A filter callback suppressed the detected event.', 'wp-event-publisher' ),
				array(
					'post_id' => $post->ID,
					'data'    => $context,
				)
			);

			return null;
		}

		if ( ! $this->is_event_type_allowed( $type ) ) {
			$this->logger->event(
				'detect.type_disabled',
				Logger::STATUS_SKIPPED,
				sprintf(
					/* translators: 1: event type, 2: enabled event types. */
					__( 'The event type "%1$s" is disabled in Settings. Enabled types: %2$s.', 'wp-event-publisher' ),
					$type,
					implode( ', ', $this->settings->allowed_event_types() )
				),
				array(
					'event_type' => $type,
					'post_id'    => $post->ID,
				)
			);

			return null;
		}

		if ( ! $this->claim( $post->ID, $type, (string) ( $context['group'] ?? '' ) ) ) {
			$this->logger->event(
				'detect.duplicate',
				Logger::STATUS_SKIPPED,
				__( 'An identical event for this post was already created moments ago; the duplicate was dropped.', 'wp-event-publisher' ),
				array(
					'event_type' => $type,
					'post_id'    => $post->ID,
					'data'       => $context,
				)
			);

			return null;
		}

		$this->logger->event(
			'detect.matched',
			Logger::STATUS_INFO,
			sprintf(
				/* translators: 1: event type, 2: post type. */
				__( 'Detected a "%1$s" event for post type "%2$s".', 'wp-event-publisher' ),
				$type,
				$post->post_type
			),
			array(
				'event_type' => $type,
				'post_id'    => $post->ID,
				'data'       => array_merge( $context, array( 'post_type' => $post->post_type ) ),
			)
		);

		if ( Event::TYPE_DELETED === $type ) {
			update_post_meta( $post->ID, self::META_DELETE_SENT, gmdate( 'Y-m-d H:i:s' ) );
		}

		return $type;
	}

	/**
	 * Claims a post/type pair so concurrent hooks cannot both emit it.
	 *
	 * `transition_post_status` and `wp_after_insert_post` both fire for a
	 * single publish, and some editors save twice in quick succession.
	 * The claim collapses those into one event; retries are unaffected
	 * because they re-use an already issued event identifier instead of
	 * going through detection again.
	 *
	 * @since 1.2.0
	 *
	 * @param int    $post_id Post ID.
	 * @param string $type    Event type.
	 * @param string $group   Logical group; derived from the type when empty.
	 *
	 * @return bool True when this caller may emit the event.
	 */
	private function claim( int $post_id, string $type, string $group = '' ): bool {
		// Keyed on the logical publication, not on the derived type. Five
		// hooks observing one publish can classify it differently — the
		// first sees "created", a later one sees an already-published post
		// and would say "updated" — so a per-type key would let the second
		// through. One publication is one event, whatever it ends up being
		// called. Removal is its own group, because deleting a post that
		// was just updated is a genuinely separate event.
		if ( '' === $group ) {
			$group = Event::TYPE_DELETED === $type ? 'removal' : 'lifecycle';
		}

		$key = $post_id . ':' . $group;

		if ( isset( $this->emitted[ $key ] ) ) {
			return false;
		}

		/**
		 * Filters how long a second event for the same post is treated as a
		 * duplicate.
		 *
		 * @since 1.2.0
		 *
		 * @param int    $window  Window in seconds. Default 30.
		 * @param int    $post_id Post ID.
		 * @param string $type    Event type that reached the guard first.
		 */
		$window = (int) apply_filters( 'wpep_duplicate_window', 30, $post_id, $type );

		if ( $window > 0 ) {
			$transient = 'wpep_emit_' . md5( $key );

			if ( false !== get_transient( $transient ) ) {
				return false;
			}

			set_transient( $transient, time(), $window );
		}

		$this->emitted[ $key ] = true;

		return true;
	}

	/**
	 * Writes a "why was this skipped" entry.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post      Post object.
	 * @param string  $reason    Reason the post is out of scope.
	 * @param string  $context   Calling hook.
	 * @param bool    $important Whether to record it outside debug mode.
	 *
	 * @return void
	 */
	private function log_skip( WP_Post $post, string $reason, string $context, bool $important ): void {
		$this->logger->event(
			'detect.skipped',
			Logger::STATUS_SKIPPED,
			$reason,
			array(
				'post_id' => $post->ID,
				'data'    => array(
					'hook'      => $context,
					'post_type' => $post->post_type,
					'status'    => $post->post_status,
				),
			),
			! $important
		);
	}

	/**
	 * Runs the detected type through the extensibility filters.
	 *
	 * @since 1.1.0
	 *
	 * @param string              $type    Detected event type.
	 * @param WP_Post             $post    Post object.
	 * @param array<string,mixed> $context Detection context.
	 *
	 * @return string|null Final event type, or null to suppress.
	 */
	private function filter_type( string $type, WP_Post $post, array $context ): ?string {
		/**
		 * Filters the detected event type.
		 *
		 * Return null to suppress the event entirely, or another
		 * lifecycle type to reclassify it.
		 *
		 * @since 1.1.0
		 *
		 * @param string|null         $type    Detected event type.
		 * @param WP_Post             $post    Post object.
		 * @param array<string,mixed> $context Detection context.
		 */
		$type = apply_filters( 'wpep_detect_event_type', $type, $post, $context );

		if ( null === $type || '' === $type ) {
			return null;
		}

		/**
		 * Filters whether a detected event should be dispatched.
		 *
		 * Retained from version 1.0.0 for backward compatibility; the
		 * fourth argument carries the detected event type.
		 *
		 * @since 1.0.0
		 * @since 1.1.0 Added the `$event_type` argument.
		 *
		 * @param bool    $should_dispatch Whether to dispatch.
		 * @param WP_Post $post            Post object.
		 * @param string  $new_status      New post status.
		 * @param string  $old_status      Previous post status, when known.
		 * @param string  $event_type      Detected event type.
		 */
		$should = apply_filters(
			'wpep_should_dispatch',
			true,
			$post,
			isset( $context['new_status'] ) ? (string) $context['new_status'] : $post->post_status,
			isset( $context['old_status'] ) ? (string) $context['old_status'] : '',
			(string) $type
		);

		return $should ? (string) $type : null;
	}

	/**
	 * Whether the post has ever been published.
	 *
	 * Recognises the version 1.0.0 delivery state as an implicit marker,
	 * so posts published before the upgrade are never re-announced as
	 * newly created.
	 *
	 * @since 1.1.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return bool True when the post went live at least once.
	 */
	public function has_been_published( int $post_id ): bool {
		if ( '' !== (string) get_post_meta( $post_id, self::META_FIRST_PUBLISHED, true ) ) {
			return true;
		}

		return 'sent' === (string) get_post_meta( $post_id, Hooks::META_STATE, true );
	}

	/**
	 * Records that a post has gone live.
	 *
	 * @since 1.1.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return void
	 */
	public function mark_published( int $post_id ): void {
		if ( '' !== (string) get_post_meta( $post_id, self::META_FIRST_PUBLISHED, true ) ) {
			return;
		}

		update_post_meta( $post_id, self::META_FIRST_PUBLISHED, gmdate( 'Y-m-d H:i:s' ) );
	}

	/**
	 * Whether a post was published so recently that follow-up saves are
	 * still part of the publish itself.
	 *
	 * @since 1.1.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return bool True while inside the cooldown window.
	 */
	private function within_publish_cooldown( int $post_id ): bool {
		/**
		 * Filters the cooldown after publishing during which update
		 * events are suppressed.
		 *
		 * Block editors commonly persist meta and terms in a second
		 * request right after publishing; without a cooldown that request
		 * would emit an `updated` event moments after `created`.
		 *
		 * @since 1.1.0
		 *
		 * @param int $seconds Cooldown in seconds. Default 60.
		 * @param int $post_id Post ID.
		 */
		$cooldown = (int) apply_filters( 'wpep_update_cooldown', MINUTE_IN_SECONDS, $post_id );

		if ( $cooldown <= 0 ) {
			return false;
		}

		$first_published = (string) get_post_meta( $post_id, self::META_FIRST_PUBLISHED, true );

		if ( '' === $first_published ) {
			return false;
		}

		$published_at = strtotime( $first_published . ' UTC' );

		if ( false === $published_at ) {
			return false;
		}

		return ( time() - $published_at ) < $cooldown;
	}

	/**
	 * Computes a fingerprint of everything the payload exposes.
	 *
	 * Two saves producing the same fingerprint are indistinguishable to
	 * the consumer, so no event is emitted between them.
	 *
	 * @since 1.1.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string Hexadecimal fingerprint.
	 */
	public function fingerprint( WP_Post $post ): string {
		$source = array(
			'title'     => $post->post_title,
			'content'   => $post->post_content,
			'excerpt'   => $post->post_excerpt,
			'slug'      => $post->post_name,
			'status'    => $post->post_status,
			'type'      => $post->post_type,
			'author'    => (int) $post->post_author,
			'parent'    => (int) $post->post_parent,
			'thumbnail' => (int) get_post_thumbnail_id( $post ),
			'meta'      => $this->public_meta( $post ),
			'terms'     => $this->term_ids( $post ),
		);

		/**
		 * Filters the data a change fingerprint is computed from.
		 *
		 * Add fields here to make additional changes trigger an update
		 * event, or remove fields to ignore them.
		 *
		 * @since 1.1.0
		 *
		 * @param array<string,mixed> $source Fingerprint source data.
		 * @param WP_Post             $post   Post object.
		 */
		$source = apply_filters( 'wpep_fingerprint_source', $source, $post );

		return hash( 'sha256', (string) wp_json_encode( $source ) );
	}

	/**
	 * Stores the current fingerprint for a post.
	 *
	 * @since 1.1.0
	 *
	 * @param WP_Post     $post        Post object.
	 * @param string|null $fingerprint Precomputed fingerprint, when available.
	 *
	 * @return void
	 */
	public function remember_fingerprint( WP_Post $post, ?string $fingerprint = null ): void {
		update_post_meta( $post->ID, self::META_FINGERPRINT, $fingerprint ?? $this->fingerprint( $post ) );
	}

	/**
	 * Collects the public meta of a post for fingerprinting.
	 *
	 * Protected keys are excluded, which also keeps the plugin's own
	 * bookkeeping meta from making every post look modified.
	 *
	 * @since 1.1.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return array<string,mixed> Public meta map.
	 */
	private function public_meta( WP_Post $post ): array {
		$meta = get_post_meta( $post->ID );

		if ( ! is_array( $meta ) ) {
			return array();
		}

		$public = array();

		foreach ( $meta as $key => $values ) {
			if ( is_protected_meta( $key, 'post' ) ) {
				continue;
			}

			$public[ $key ] = $values;
		}

		ksort( $public );

		return $public;
	}

	/**
	 * Collects the term IDs assigned to a post across all taxonomies.
	 *
	 * @since 1.1.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return array<string,int[]> Map of taxonomy to term IDs.
	 */
	private function term_ids( WP_Post $post ): array {
		$result = array();

		foreach ( get_object_taxonomies( $post->post_type ) as $taxonomy ) {
			$terms = get_the_terms( $post, $taxonomy );

			if ( ! is_array( $terms ) ) {
				continue;
			}

			$ids = array_map( static fn( $term ) => (int) $term->term_id, $terms );
			sort( $ids );

			$result[ $taxonomy ] = $ids;
		}

		ksort( $result );

		return $result;
	}
}
