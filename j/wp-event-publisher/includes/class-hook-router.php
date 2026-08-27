<?php
/**
 * Central registrar for every publishing hook.
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
 * Subscribes to every hook WordPress can fire around a publication and
 * funnels all of them into one decision point.
 *
 * Relying on a single hook is the reason a plugin works on one site and
 * not on another. `transition_post_status` misses a post that was already
 * published when the plugin could not yet see it; `wp_after_insert_post`
 * does not exist for code paths that call `wp_update_post()` on an
 * existing row; a front-end submission form, a JetEngine form, an import
 * or a REST client each take a different route through the same publish.
 *
 * So the router listens to all of them — transitions, the specific
 * `{old}_to_{new}` aliases, `save_post`, `post_updated`,
 * `wp_after_insert_post`, trashing, restoring and deletion — logs which
 * one fired, and hands the post to {@see EventDetector}. Firing five times
 * for one publication is expected and harmless: the idempotency claim in
 * the detector collapses them into a single event, and the queue's unique
 * event identifier is the second guarantee behind it.
 *
 * @since 1.3.0
 */
class HookRouter {

	/**
	 * Status transition aliases WordPress fires alongside the generic hook.
	 *
	 * They are redundant by design: if a plugin or a theme suppresses the
	 * generic transition hook, these still arrive.
	 *
	 * @var string[]
	 */
	private const TRANSITION_ALIASES = array(
		'draft_to_publish',
		'pending_to_publish',
		'future_to_publish',
		'new_to_publish',
		'private_to_publish',
		'auto-draft_to_publish',
	);

	/**
	 * Hook handlers.
	 *
	 * @var Hooks
	 */
	private Hooks $hooks;

	/**
	 * Logger dependency.
	 *
	 * @var Logger
	 */
	private Logger $logger;

	/**
	 * Hook names observed during this request, for diagnostics.
	 *
	 * @var array<string,int>
	 */
	private array $observed = array();

	/**
	 * Constructor.
	 *
	 * @since 1.3.0
	 *
	 * @param Hooks  $hooks  Hook handlers.
	 * @param Logger $logger Logger service.
	 */
	public function __construct( Hooks $hooks, Logger $logger ) {
		$this->hooks  = $hooks;
		$this->logger = $logger;
	}

	/**
	 * Registers every listener.
	 *
	 * @since 1.3.0
	 *
	 * @return void
	 */
	public function register(): void {
		// Primary: the canonical publish signal.
		add_action( 'transition_post_status', array( $this, 'on_transition' ), 10, 3 );

		// Redundant aliases for the same transition.
		foreach ( self::TRANSITION_ALIASES as $alias ) {
			add_action( $alias, array( $this, 'on_transition_alias' ), 10, 1 );
		}

		// Runs after terms and meta are written, so the payload is complete.
		add_action( 'wp_after_insert_post', array( $this, 'on_after_insert' ), 20, 4 );

		// Covers wp_update_post() on an existing row.
		add_action( 'post_updated', array( $this, 'on_post_updated' ), 20, 3 );

		// Last safety net: any save of a published post that was never
		// announced, whatever route created it.
		add_action( 'save_post', array( $this, 'on_save_post' ), 30, 3 );

		// Removal and restoration.
		add_action( 'wp_trash_post', array( $this, 'on_trash' ), 10, 1 );
		add_action( 'before_delete_post', array( $this, 'on_delete' ), 10, 2 );
		add_action( 'untrashed_post', array( $this, 'on_untrashed' ), 10, 1 );

		/**
		 * Fires after the plugin registered its publishing listeners.
		 *
		 * @since 1.3.0
		 *
		 * @param HookRouter $router Router instance.
		 */
		do_action( 'wpep_hooks_registered', $this );
	}

	/**
	 * Returns which hooks were observed during this request.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,int> Hook name to observation count.
	 */
	public function observed(): array {
		return $this->observed;
	}

	/**
	 * Records that a hook fired, for diagnostics and debug logging.
	 *
	 * @since 1.3.0
	 *
	 * @param string       $hook    Hook name.
	 * @param WP_Post|null $post    Post the hook carried, when any.
	 * @param array<string,mixed> $context Extra context for the log.
	 *
	 * @return void
	 */
	private function note( string $hook, ?WP_Post $post, array $context = array() ): void {
		$this->observed[ $hook ] = ( $this->observed[ $hook ] ?? 0 ) + 1;

		update_option( 'wpep_last_hook', array( 'hook' => $hook, 'at' => time() ), false );

		$this->logger->event(
			'hook.fired',
			Logger::STATUS_INFO,
			sprintf(
				/* translators: 1: hook name, 2: post type. */
				__( 'Hook %1$s fired for post type "%2$s".', 'wp-event-publisher' ),
				$hook,
				$post instanceof WP_Post ? $post->post_type : '-'
			),
			array(
				'post_id' => $post instanceof WP_Post ? $post->ID : 0,
				'data'    => array_merge(
					array(
						'hook'      => $hook,
						'post_type' => $post instanceof WP_Post ? $post->post_type : null,
						'status'    => $post instanceof WP_Post ? $post->post_status : null,
						'autosave'  => defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE,
						'cron'      => (bool) wp_doing_cron(),
						'rest'      => defined( 'REST_REQUEST' ) && REST_REQUEST,
					),
					$context
				),
			),
			true
		);
	}

	/**
	 * Handles the canonical status transition.
	 *
	 * @since 1.3.0
	 *
	 * @param string  $new_status New post status.
	 * @param string  $old_status Previous post status.
	 * @param WP_Post $post       Post object.
	 *
	 * @return void
	 */
	public function on_transition( string $new_status, string $old_status, WP_Post $post ): void {
		$this->note(
			'transition_post_status',
			$post,
			array(
				'old_status' => $old_status,
				'new_status' => $new_status,
			)
		);

		$this->hooks->handle_transition( $new_status, $old_status, $post );
	}

	/**
	 * Handles a `{old}_to_{new}` alias hook.
	 *
	 * These carry only the post, so the previous status is unknown here.
	 * The alias name itself supplies it.
	 *
	 * @since 1.3.0
	 *
	 * @param WP_Post|int $post Post object, or ID on unusual callers.
	 *
	 * @return void
	 */
	public function on_transition_alias( $post ): void {
		$post = $post instanceof WP_Post ? $post : get_post( (int) $post );

		if ( ! $post instanceof WP_Post ) {
			return;
		}

		$hook = (string) current_action();
		$from = str_replace( '_to_publish', '', $hook );

		$this->note( $hook, $post, array( 'old_status' => $from ) );

		$this->hooks->handle_transition( 'publish', $from, $post );
	}

	/**
	 * Handles a completed insert, after terms and meta were written.
	 *
	 * @since 1.3.0
	 *
	 * @param int          $post_id     Post ID.
	 * @param WP_Post      $post        Post after the save.
	 * @param bool         $update      Whether an existing post was updated.
	 * @param WP_Post|null $post_before Post before the save, when known.
	 *
	 * @return void
	 */
	public function on_after_insert( int $post_id, WP_Post $post, bool $update, ?WP_Post $post_before = null ): void {
		$this->note(
			'wp_after_insert_post',
			$post,
			array(
				'is_update'     => $update,
				'status_before' => $post_before instanceof WP_Post ? $post_before->post_status : null,
			)
		);

		$this->hooks->handle_update( $post, $post_before );
	}

	/**
	 * Handles `post_updated`, which fires for `wp_update_post()` calls.
	 *
	 * @since 1.3.0
	 *
	 * @param int     $post_id     Post ID.
	 * @param WP_Post $post_after  Post after the update.
	 * @param WP_Post $post_before Post before the update.
	 *
	 * @return void
	 */
	public function on_post_updated( int $post_id, WP_Post $post_after, WP_Post $post_before ): void {
		$this->note(
			'post_updated',
			$post_after,
			array( 'status_before' => $post_before->post_status )
		);

		// A status change is a transition even when the transition hook was
		// suppressed by another plugin.
		if ( $post_before->post_status !== $post_after->post_status ) {
			$this->hooks->handle_transition( $post_after->post_status, $post_before->post_status, $post_after );

			return;
		}

		$this->hooks->handle_update( $post_after, $post_before );
	}

	/**
	 * Handles any save, as the final safety net.
	 *
	 * This exists for one specific case that every other hook misses: a
	 * post that is already published but was never announced — because the
	 * plugin was disabled, misconfigured, or its post type was registered
	 * after the publish happened. Saving it again announces it once.
	 *
	 * @since 1.3.0
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post object.
	 * @param bool    $update  Whether an existing post was updated.
	 *
	 * @return void
	 */
	public function on_save_post( int $post_id, WP_Post $post, bool $update ): void {
		$this->note( 'save_post', $post, array( 'is_update' => $update ) );

		$this->hooks->handle_save( $post );
	}

	/**
	 * Handles an advertisement moving to the trash.
	 *
	 * @since 1.3.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return void
	 */
	public function on_trash( int $post_id ): void {
		$post = get_post( $post_id );

		$this->note( 'wp_trash_post', $post instanceof WP_Post ? $post : null );

		$this->hooks->on_trash_post( $post_id );
	}

	/**
	 * Handles permanent deletion.
	 *
	 * @since 1.3.0
	 *
	 * @param int          $post_id Post ID.
	 * @param WP_Post|null $post    Post about to be deleted.
	 *
	 * @return void
	 */
	public function on_delete( int $post_id, ?WP_Post $post = null ): void {
		$this->note( 'before_delete_post', $post instanceof WP_Post ? $post : get_post( $post_id ) );

		$this->hooks->on_before_delete_post( $post_id, $post );
	}

	/**
	 * Handles a post being restored from the trash.
	 *
	 * @since 1.3.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return void
	 */
	public function on_untrashed( int $post_id ): void {
		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			return;
		}

		$this->note( 'untrashed_post', $post );

		$this->hooks->handle_restore( $post );
	}
}
