<?php
/**
 * Asynchronous delivery and retry orchestration.
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
 * Moves detected events off the request thread and retries transient
 * delivery failures.
 *
 * Scope is deliberately narrow. This is a hand-off buffer: it gets the
 * event out of the publish request and gives the endpoint a few chances
 * to accept it. Durable queueing, backpressure, scheduling and fan-out
 * belong to the Node.js worker tier (BullMQ on Redis); WordPress must not
 * grow into the system of record for delivery state.
 *
 * Delivery never depends on WP-Cron alone. An event is scheduled on cron
 * first, but three safety nets stand behind it:
 *
 * 1. If `wp_schedule_single_event()` refuses the job, or the installation
 *    has `DISABLE_WP_CRON` set, the event is delivered inline at the end
 *    of the current request instead.
 * 2. A sweeper re-runs anything whose scheduled moment passed without the
 *    job executing, so a missed cron tick delays an advertisement instead
 *    of losing it.
 * 3. Everything a delivery does — queueing, scheduling, running, retrying
 *    — is written to the log with its outcome.
 *
 * Every retry re-uses the event identifier it was issued, so the consumer
 * can deduplicate on `event_id` no matter how many attempts it sees.
 *
 * @since 1.1.0
 */
class Dispatcher {

	/**
	 * Cron hook executing a queued event.
	 *
	 * @var string
	 */
	public const CRON_HOOK = 'wpep_dispatch_event';

	/**
	 * Cron hook used by version 1.0.0.
	 *
	 * Still registered so jobs scheduled before the upgrade keep running.
	 *
	 * @var string
	 */
	public const LEGACY_CRON_HOOK = 'wpep_dispatch_webhook';

	/**
	 * Recurring cron hook that re-runs stuck events.
	 *
	 * @var string
	 */
	public const SWEEP_HOOK = 'wpep_sweep_queue';

	/**
	 * Custom cron schedule used by the sweeper.
	 *
	 * @var string
	 */
	public const SWEEP_SCHEDULE = 'wpep_five_minutes';

	/**
	 * Option holding the lifetime delivery counters.
	 *
	 * The queue table only keeps terminal rows for the retention window, so
	 * it cannot answer "how many advertisements has this site delivered".
	 * These counters can, in one autoloaded-off option.
	 *
	 * @var string
	 */
	public const OPTION_STATS = 'wpep_delivery_stats';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

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
	 * Webhook transport dependency.
	 *
	 * @var Webhook
	 */
	private Webhook $webhook;

	/**
	 * Logger dependency.
	 *
	 * @var Logger
	 */
	private Logger $logger;

	/**
	 * Event identifier service.
	 *
	 * @var EventId
	 */
	private EventId $event_id;

	/**
	 * Durable delivery queue.
	 *
	 * @var Queue
	 */
	private Queue $queue;

	/**
	 * Retry policy.
	 *
	 * @var RetryPolicy
	 */
	private RetryPolicy $retry;

	/**
	 * Event detector dependency.
	 *
	 * @var EventDetector
	 */
	private EventDetector $detector;

	/**
	 * Mapped field payload assembler.
	 *
	 * @var DynamicPayload|null
	 */
	private ?DynamicPayload $dynamic;

	/**
	 * Publication workflow, when the platform layer is available.
	 *
	 * @var Publisher|null
	 */
	private ?Publisher $publisher = null;

	/**
	 * Events already queued for inline delivery in this request.
	 *
	 * @var array<string,bool>
	 */
	private array $deferred = array();

	/**
	 * Constructor.
	 *
	 * @since 1.1.0
	 *
	 * @param Settings      $settings   Settings service.
	 * @param Normalizer    $normalizer Normalizer service.
	 * @param Contract      $contract   Contract builder.
	 * @param Webhook       $webhook    Webhook transport.
	 * @param Logger        $logger     Logger service.
	 * @param EventId       $event_id   Event identifier service.
	 * @param Queue         $queue      Durable delivery queue.
	 * @param EventDetector       $detector   Event detector.
	 * @param RetryPolicy         $retry      Retry policy.
	 * @param DynamicPayload|null $dynamic    Mapped field assembler, when available.
	 */
	public function __construct(
		Settings $settings,
		Normalizer $normalizer,
		Contract $contract,
		Webhook $webhook,
		Logger $logger,
		EventId $event_id,
		Queue $queue,
		EventDetector $detector,
		RetryPolicy $retry,
		?DynamicPayload $dynamic = null
	) {
		$this->settings   = $settings;
		$this->normalizer = $normalizer;
		$this->contract   = $contract;
		$this->webhook    = $webhook;
		$this->logger     = $logger;
		$this->event_id   = $event_id;
		$this->queue      = $queue;
		$this->detector   = $detector;
		$this->retry      = $retry;
		$this->dynamic    = $dynamic;
	}

	/**
	 * Gives the dispatcher the publication workflow.
	 *
	 * Injected after construction rather than through the constructor
	 * because the publisher needs the dispatcher's own collaborators; the
	 * container wires it once, and a dispatcher without one keeps behaving
	 * exactly as it did before the platform layer existed.
	 *
	 * @since 1.5.0
	 *
	 * @param Publisher $publisher Publication workflow.
	 *
	 * @return void
	 */
	public function set_publisher( Publisher $publisher ): void {
		$this->publisher = $publisher;
	}

	/**
	 * Registers the cron callbacks and the queue sweeper.
	 *
	 * @since 1.1.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( self::CRON_HOOK, array( $this, 'run_event' ), 10, 4 );
		add_action( self::LEGACY_CRON_HOOK, array( $this, 'run_legacy_job' ), 10, 2 );
		add_action( self::SWEEP_HOOK, array( $this, 'sweep' ) );

		add_filter( 'cron_schedules', array( $this, 'register_schedule' ) );

		add_action( 'wp_loaded', array( $this, 'ensure_sweep_scheduled' ) );
		add_action( 'shutdown', array( $this, 'maybe_sweep' ), 100 );
	}

	/**
	 * Adds the five minute schedule used by the sweeper.
	 *
	 * @since 1.2.0
	 *
	 * @param array<string,array<string,mixed>> $schedules Registered schedules.
	 *
	 * @return array<string,array<string,mixed>> Schedules including the sweeper interval.
	 */
	public function register_schedule( array $schedules ): array {
		$schedules[ self::SWEEP_SCHEDULE ] = array(
			'interval' => 5 * MINUTE_IN_SECONDS,
			'display'  => __( 'هر پنج دقیقه (جارچی)', 'wp-event-publisher' ),
		);

		return $schedules;
	}

	/**
	 * Makes sure the recurring sweeper is scheduled.
	 *
	 * @since 1.2.0
	 *
	 * @return void
	 */
	public function ensure_sweep_scheduled(): void {
		if ( ! wp_next_scheduled( self::SWEEP_HOOK ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, self::SWEEP_SCHEDULE, self::SWEEP_HOOK );
		}
	}

	/**
	 * Creates an event for a post and queues it for delivery.
	 *
	 * @since 1.1.0
	 *
	 * @param int                      $post_id    Post ID.
	 * @param string                   $event_type Event type.
	 * @param array<string,mixed>|null $snapshot   Payload snapshot for deletions.
	 *
	 * @return Event Queued event.
	 */
	public function queue( int $post_id, string $event_type, ?array $snapshot = null ): Event {
		$event = $this->create_event( $post_id, $event_type )->with_snapshot( $snapshot );

		$this->enqueue( $event );

		return $event;
	}

	/**
	 * Issues an identifier and builds an event without queueing it.
	 *
	 * Callers that must capture a payload snapshot before the source
	 * disappears need the identifier first, because it is part of the
	 * payload. They build the snapshot and then call {@see self::enqueue()}.
	 *
	 * @since 1.1.0
	 *
	 * @param int    $post_id    Post ID.
	 * @param string $event_type Event type.
	 *
	 * @return Event Event with a freshly issued, persisted identifier.
	 */
	public function create_event( int $post_id, string $event_type ): Event {
		return new Event( $this->event_id->issue( $post_id, $event_type ), $event_type, $post_id );
	}

	/**
	 * Queues an already constructed event.
	 *
	 * @since 1.1.0
	 *
	 * @param Event $event Event to deliver.
	 *
	 * @return void
	 */
	public function enqueue( Event $event ): void {
		/**
		 * Filters the delay before a queued event is delivered.
		 *
		 * @since 1.0.0
		 *
		 * @param int $delay   Delay in seconds. Default 0 (next cron tick).
		 * @param int $post_id Post ID.
		 * @param int $attempt Attempt number.
		 */
		$delay = max( 0, (int) apply_filters( 'wpep_dispatch_delay', 0, $event->post_id(), $event->attempt() ) );

		$this->queue->push( $event, $delay );

		if ( $event->post_id() > 0 && ! $event->is_delete() ) {
			// Preserve the version 1.0.0 delivery state so existing
			// integrations reading this meta keep working.
			update_post_meta( $event->post_id(), Hooks::META_STATE, 'queued' );
		}

		$this->logger->event(
			'event.queued',
			Logger::STATUS_PENDING,
			sprintf(
				/* translators: 1: event type, 2: delay in seconds. */
				__( 'Event queued for delivery (type "%1$s", delay %2$d s).', 'wp-event-publisher' ),
				$event->type(),
				$delay
			),
			array(
				'event_id'    => $event->id(),
				'event_type'  => $event->type(),
				'post_id'     => $event->post_id(),
				'attempt'     => $event->attempt(),
				'request_url' => $this->settings->endpoint(),
				'data'        => array(
					'dispatch_mode' => $this->settings->dispatch_mode(),
					'has_snapshot'  => $event->has_snapshot(),
				),
			)
		);

		$this->dispatch( $event, $delay );

		/**
		 * Fires after an event has been queued for delivery.
		 *
		 * @since 1.0.0
		 * @since 1.1.0 Added the `$event` argument.
		 *
		 * @param int   $post_id Post ID.
		 * @param int   $attempt Attempt number.
		 * @param Event $event   Queued event.
		 */
		do_action( 'wpep_job_enqueued', $event->post_id(), $event->attempt(), $event );
	}

	/**
	 * Chooses how a queued event reaches the endpoint.
	 *
	 * @since 1.2.0
	 *
	 * @param Event $event Event to deliver.
	 * @param int   $delay Delay in seconds.
	 *
	 * @return void
	 */
	private function dispatch( Event $event, int $delay ): void {
		$mode = $this->settings->dispatch_mode();

		if ( Settings::DISPATCH_IMMEDIATE === $mode ) {
			if ( ! $this->defer( $event, __( 'Dispatch mode is set to Immediate.', 'wp-event-publisher' ) ) ) {
				// This request has spent its inline budget, so the event needs
				// a carrier other than the current page load.
				$this->schedule( $event, $delay );
			}

			return;
		}

		$scheduled = $this->schedule( $event, $delay );

		if ( Settings::DISPATCH_CRON === $mode ) {
			return;
		}

		if ( ! $scheduled ) {
			$this->defer( $event, __( 'WP-Cron refused the job, so the event is delivered inline.', 'wp-event-publisher' ) );

			return;
		}

		// Automatic mode does not wait for a cron tick that may never come.
		// An advertisement is delivered at the end of the publish request,
		// after the response has been handed back, and the scheduled job
		// stays behind purely as a backstop: it finds the event already
		// finished and stops. Delayed events (retries, filtered delays)
		// are left to cron and to the sweeper.
		if ( $delay <= 0 ) {
			$this->defer(
				$event,
				$this->cron_healthy()
					? __( 'Delivering inline at the end of this request; the scheduled cron job remains as a backstop.', 'wp-event-publisher' )
					: __( 'WP-Cron is unavailable or overdue on this site, so the event is delivered inline.', 'wp-event-publisher' )
			);
		}
	}

	/**
	 * Whether WP-Cron looks like it is actually running.
	 *
	 * `DISABLE_WP_CRON` is the obvious case, but a site can also have cron
	 * enabled and still never execute it — no traffic, a caching layer
	 * that never reaches PHP, or a blocked loopback request. The recurring
	 * sweeper doubles as the probe: if its own scheduled run is long
	 * overdue, cron is not running and delivery must not depend on it.
	 *
	 * @since 1.2.0
	 *
	 * @return bool True when cron can be trusted with a delivery.
	 */
	public function cron_healthy(): bool {
		if ( ! $this->settings->cron_available() ) {
			return false;
		}

		$next = wp_next_scheduled( self::SWEEP_HOOK );

		if ( ! $next ) {
			// Nothing scheduled yet (first request after activation).
			return true;
		}

		/**
		 * Filters how far the sweeper may fall behind before WP-Cron is
		 * considered broken.
		 *
		 * @since 1.2.0
		 *
		 * @param int $seconds Allowed lateness. Default 600.
		 */
		$tolerance = (int) apply_filters( 'wpep_cron_health_tolerance', 10 * MINUTE_IN_SECONDS );

		return ( time() - (int) $next ) < max( MINUTE_IN_SECONDS, $tolerance );
	}

	/**
	 * Schedules the cron event carrying an event's identity.
	 *
	 * Only scalars travel through cron arguments; the payload itself
	 * stays in the event store so the `cron` option remains small.
	 *
	 * @since 1.1.0
	 *
	 * @param Event $event Event to schedule.
	 * @param int   $delay Delay in seconds.
	 *
	 * @return bool True when WP-Cron accepted the job.
	 */
	private function schedule( Event $event, int $delay ): bool {
		$timestamp = time() + max( 0, $delay );

		$scheduled = wp_schedule_single_event(
			$timestamp,
			self::CRON_HOOK,
			array( $event->id(), $event->type(), $event->post_id(), $event->attempt() ),
			true
		);

		if ( is_wp_error( $scheduled ) ) {
			$this->logger->event(
				'cron.schedule_failed',
				Logger::STATUS_FAILED,
				sprintf(
					/* translators: %s: error message. */
					__( 'WP-Cron rejected the delivery job: %s', 'wp-event-publisher' ),
					$scheduled->get_error_message()
				),
				array(
					'event_id'   => $event->id(),
					'event_type' => $event->type(),
					'post_id'    => $event->post_id(),
					'attempt'    => $event->attempt(),
				)
			);

			return false;
		}

		if ( false === $scheduled ) {
			$this->logger->event(
				'cron.schedule_failed',
				Logger::STATUS_FAILED,
				__( 'WP-Cron did not accept the delivery job (a pre_schedule_event filter returned false).', 'wp-event-publisher' ),
				array(
					'event_id'   => $event->id(),
					'event_type' => $event->type(),
					'post_id'    => $event->post_id(),
					'attempt'    => $event->attempt(),
				)
			);

			return false;
		}

		$this->logger->event(
			'cron.scheduled',
			Logger::STATUS_INFO,
			sprintf(
				/* translators: %s: UTC time the job is due. */
				__( 'Delivery scheduled with WP-Cron for %s UTC.', 'wp-event-publisher' ),
				gmdate( 'Y-m-d H:i:s', $timestamp )
			),
			array(
				'event_id'   => $event->id(),
				'event_type' => $event->type(),
				'post_id'    => $event->post_id(),
				'attempt'    => $event->attempt(),
				'data'       => array( 'cron_enabled' => $this->settings->cron_available() ),
			),
			true
		);

		return true;
	}

	/**
	 * Registers an event for inline delivery at the end of the request.
	 *
	 * One request delivers at most a handful of events itself. Bulk Edit
	 * publishing fifty advertisements would otherwise chain fifty serial
	 * HTTP round trips onto a single shutdown, which is how a bulk action
	 * hits the PHP execution time limit and takes the last events down with
	 * it. Past the limit the event simply stays in the queue: the scheduled
	 * cron job, or the sweeper, delivers it moments later.
	 *
	 * @since 1.2.0
	 * @since 1.3.2 Returns whether the event was accepted for inline delivery.
	 *
	 * @param Event  $event  Event to deliver.
	 * @param string $reason Why inline delivery was chosen.
	 *
	 * @return bool True when this request will deliver the event itself.
	 */
	private function defer( Event $event, string $reason ): bool {
		$key = $event->id() . ':' . $event->attempt();

		if ( isset( $this->deferred[ $key ] ) ) {
			return true;
		}

		/**
		 * Filters how many events a single request may deliver inline.
		 *
		 * Anything beyond the limit is left to the queue. Set 0 to remove
		 * the cap and deliver every event of a bulk action inline.
		 *
		 * @since 1.3.2
		 *
		 * @param int $limit Maximum inline deliveries per request. Default 3.
		 */
		$limit = (int) apply_filters( 'wpep_inline_batch_limit', 3 );

		if ( $limit > 0 && count( $this->deferred ) >= $limit ) {
			$this->logger->event(
				'dispatch.batched',
				Logger::STATUS_INFO,
				sprintf(
					/* translators: %d: number of inline deliveries already registered. */
					__( 'This request already delivers %d advertisements itself, so this one waits in the queue and is delivered by the scheduler or the queue sweeper instead. Publishing many advertisements at once therefore never chains a long series of HTTP requests onto one page load.', 'wp-event-publisher' ),
					$limit
				),
				array(
					'event_id'   => $event->id(),
					'event_type' => $event->type(),
					'post_id'    => $event->post_id(),
					'attempt'    => $event->attempt(),
				)
			);

			return false;
		}

		$this->deferred[ $key ] = true;

		$this->logger->event(
			'dispatch.inline',
			Logger::STATUS_INFO,
			$reason,
			array(
				'event_id'   => $event->id(),
				'event_type' => $event->type(),
				'post_id'    => $event->post_id(),
				'attempt'    => $event->attempt(),
			),
			true
		);

		add_action(
			'shutdown',
			function () use ( $event ): void {
				$this->run_inline( $event );
			},
			20
		);

		return true;
	}

	/**
	 * Delivers an event after the response has been handed to the browser.
	 *
	 * @since 1.2.0
	 *
	 * @param Event $event Event to deliver.
	 *
	 * @return void
	 */
	private function run_inline( Event $event ): void {
		if ( function_exists( 'ignore_user_abort' ) ) {
			ignore_user_abort( true );
		}

		// Close the connection first where the SAPI allows it, so the
		// editor never waits for the Node.js round trip.
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			fastcgi_finish_request();
		}

		$this->run_event( $event->id(), $event->type(), $event->post_id(), $event->attempt() );
	}

	/**
	 * Cron callback: delivers one event.
	 *
	 * @since 1.1.0
	 *
	 * @param string $event_id   Stable event identifier.
	 * @param string $event_type Event type.
	 * @param int    $post_id    Related post ID.
	 * @param int    $attempt    Attempt number, 1-based.
	 *
	 * @return void
	 */
	public function run_event( string $event_id, string $event_type, int $post_id = 0, int $attempt = 1 ): void {
		$attempt = max( 1, $attempt );

		if ( $this->queue->is_finished( $event_id ) ) {
			// The inline fallback (or an earlier run) already delivered
			// this event; a late cron tick must not send it twice.
			$this->logger->event(
				'dispatch.already_done',
				Logger::STATUS_INFO,
				__( 'The event reached a terminal state earlier; this duplicate run was ignored.', 'wp-event-publisher' ),
				array(
					'event_id'   => $event_id,
					'event_type' => $event_type,
					'post_id'    => $post_id,
					'attempt'    => $attempt,
				),
				true
			);

			return;
		}

		if ( ! $this->lock( $event_id, $attempt ) ) {
			$this->logger->event(
				'dispatch.locked',
				Logger::STATUS_INFO,
				__( 'Another process is already delivering this attempt; skipping.', 'wp-event-publisher' ),
				array(
					'event_id'   => $event_id,
					'event_type' => $event_type,
					'post_id'    => $post_id,
					'attempt'    => $attempt,
				),
				true
			);

			return;
		}

		$stored = $this->queue->find( $event_id );

		// The identity always comes from the cron arguments, so a lost or
		// expired store entry can never cause a new identifier to appear.
		$event = new Event(
			$event_id,
			$event_type,
			$post_id,
			$attempt,
			$stored instanceof Event ? $stored->snapshot() : null,
			$stored instanceof Event ? $stored->created_at() : null
		);

		$this->logger->event(
			'dispatch.started',
			Logger::STATUS_INFO,
			sprintf(
				/* translators: %d: attempt number. */
				__( 'Delivery started (attempt %d).', 'wp-event-publisher' ),
				$attempt
			),
			array(
				'event_id'   => $event_id,
				'event_type' => $event_type,
				'post_id'    => $post_id,
				'attempt'    => $attempt,
				'data'       => array( 'doing_cron' => (bool) wp_doing_cron() ),
			),
			true
		);

		try {
			$payload = $this->build_payload( $event );
		} catch ( \Throwable $e ) {
			$this->log_exception( $event, $e );
			$this->fail(
				$event,
				array(
					'success' => false,
					'code'    => 0,
					'message' => $e->getMessage(),
					'body'    => '',
				)
			);

			return;
		}

		if ( null === $payload ) {
			// The post left the publishable set before delivery: the event
			// is obsolete rather than failed.
			$this->logger->event(
				'dispatch.obsolete',
				Logger::STATUS_SKIPPED,
				__( 'The post is gone or no longer published, so the event was dropped instead of delivered.', 'wp-event-publisher' ),
				array(
					'event_id'   => $event_id,
					'event_type' => $event_type,
					'post_id'    => $post_id,
					'attempt'    => $attempt,
				)
			);

			$this->finish( $event );

			return;
		}

		try {
			$result = $this->publish( $event, $payload );
		} catch ( \Throwable $e ) {
			$this->log_exception( $event, $e );

			$result = array(
				'success' => false,
				'code'    => 0,
				'message' => $e->getMessage(),
				'body'    => '',
			);
		}

		if ( ! empty( $result['success'] ) ) {
			$this->succeed( $event, $result );

			return;
		}

		$this->fail( $event, $result );
	}

	/**
	 * Sends one event, through the platform layer when it is available.
	 *
	 * With no publisher, no rules and no extra destinations this is the
	 * 1.4.0 call it replaced. With them, it is the same call to the primary
	 * destination plus a fan-out to the rest — the retry budget still keys
	 * off the primary, because that is the delivery an advertisement cannot
	 * afford to lose.
	 *
	 * @since 1.5.0
	 *
	 * @param Event               $event   Event being delivered.
	 * @param array<string,mixed> $payload Contract payload.
	 *
	 * @return array{success:bool,code:int,message:string,body:string} Delivery result.
	 */
	private function publish( Event $event, array $payload ): array {
		$post = $event->post_id() > 0 ? get_post( $event->post_id() ) : null;

		if ( ! $this->publisher instanceof Publisher || ! $post instanceof WP_Post ) {
			// Deletions carry a snapshot rather than a post, and an
			// installation without the platform layer has nothing to add.
			return $this->webhook->send_event( $event, $payload );
		}

		$plan = $this->publisher->build( $event, $post, $payload );

		if ( ! empty( $plan['skipped'] ) ) {
			$this->logger->event(
				'publish.skipped',
				Logger::STATUS_SKIPPED,
				'' !== (string) $plan['reason'] ? (string) $plan['reason'] : __( 'A rule stopped this advertisement from being published.', 'wp-event-publisher' ),
				array(
					'event_id'   => $event->id(),
					'event_type' => $event->type(),
					'post_id'    => $event->post_id(),
					'data'       => array(
						'profile' => $plan['profile']->id(),
						'rules'   => $plan['outcome']->matched(),
					),
				)
			);

			// Deliberately not a failure: the event reached a terminal state
			// exactly as the administrator asked, so it must not be retried.
			return array(
				'success' => true,
				'code'    => 204,
				'message' => (string) $plan['reason'],
				'body'    => '',
			);
		}

		$publication  = $plan['publication'];
		$destinations = (array) $plan['destinations'];

		if ( ! $publication instanceof Publication ) {
			return $this->webhook->send_event( $event, $payload );
		}

		if ( empty( $destinations ) ) {
			// Nothing configured yet: the settings endpoint is still the
			// destination, which is what an upgraded site expects.
			return $this->webhook->send_event( $event, $publication->payload() );
		}

		$primary = null;
		$result  = null;

		foreach ( $destinations as $id => $destination ) {
			$delay = max( (int) ( $destination['delay'] ?? 0 ), $plan['outcome']->delay() );

			if ( $delay > 0 && $this->publisher->schedule( $publication, (string) $id, $delay ) ) {
				continue;
			}

			$outcome = $this->publisher->deliver( $publication, $destination );

			// The first destination attempted owns the retry decision.
			if ( null === $primary ) {
				$primary = $outcome;
			}
		}

		$result = $primary ?? array(
			'success' => true,
			'code'    => 202,
			'message' => __( 'Every destination was scheduled for later delivery.', 'wp-event-publisher' ),
			'body'    => '',
		);

		return array(
			'success' => ! empty( $result['success'] ),
			'code'    => (int) ( $result['code'] ?? 0 ),
			'message' => (string) ( $result['message'] ?? '' ),
			'body'    => (string) ( $result['body'] ?? '' ),
		);
	}

	/**
	 * Cron callback for jobs scheduled by version 1.0.0.
	 *
	 * Converts the legacy argument shape into an event and runs it
	 * through the current pipeline, so an upgrade never strands work that
	 * was already queued.
	 *
	 * @since 1.1.0
	 *
	 * @param int $post_id Post ID.
	 * @param int $attempt Attempt number.
	 *
	 * @return void
	 */
	public function run_legacy_job( int $post_id, int $attempt = 1 ): void {
		$existing = $this->event_id->last( $post_id );
		$type     = $this->detector->has_been_published( $post_id ) ? Event::TYPE_UPDATED : Event::TYPE_CREATED;

		$event_id = '' !== $existing ? $existing : $this->event_id->issue( $post_id, $type );

		$this->run_event( $event_id, $type, $post_id, max( 1, $attempt ) );
	}

	/**
	 * Re-runs events whose scheduled delivery never happened.
	 *
	 * @since 1.2.0
	 *
	 * @param int $limit Maximum number of events processed in one pass.
	 *
	 * @return int Number of events processed.
	 */
	public function sweep( int $limit = 5, ?int $grace = null ): int {
		if ( null === $grace ) {
			/**
			 * Filters how late an event may be before the sweeper picks it up.
			 *
			 * The primary delivery path — inline, or the scheduled cron job —
			 * gets this long to do its job before the sweeper steps in, so
			 * the two never race for the same fresh event.
			 *
			 * @since 1.2.0
			 *
			 * @param int $grace Grace period in seconds. Default 120.
			 */
			$grace = (int) apply_filters( 'wpep_sweep_grace', 2 * MINUTE_IN_SECONDS );
		}

		// Retire anything that used up its budget without ever reaching the
		// failure handler, so a delivery that kills the process cannot be
		// retried forever.
		$retired = $this->queue->fail_exhausted(
			(int) $this->settings->get( 'retry_count', 3 ) + 1,
			__( 'The delivery used up its attempts without completing. This usually means building the payload killed the request — a fatal in a content filter, the memory limit, or the execution time limit. The event was retired so it cannot loop.', 'wp-event-publisher' )
		);

		if ( $retired > 0 ) {
			$this->logger->event(
				'queue.retired',
				Logger::STATUS_FAILED,
				sprintf(
					/* translators: %d: number of retired events. */
					__( '%d queued events used up their attempts without completing and were retired.', 'wp-event-publisher' ),
					$retired
				)
			);
		}

		$due = $this->queue->reserve(
			max( 1, $limit ),
			(int) apply_filters( 'wpep_lock_ttl', 5 * MINUTE_IN_SECONDS ),
			max( 0, $grace )
		);

		if ( empty( $due ) ) {
			return 0;
		}

		$processed = 0;

		foreach ( $due as $event ) {
			$this->logger->event(
				'queue.swept',
				Logger::STATUS_INFO,
				sprintf(
					/* translators: %d: attempt number. */
					__( 'A queued event was picked up from the queue for delivery (attempt %d).', 'wp-event-publisher' ),
					$event->attempt()
				),
				array(
					'event_id'   => $event->id(),
					'event_type' => $event->type(),
					'post_id'    => $event->post_id(),
					'attempt'    => $event->attempt(),
				)
			);

			$this->run_event( $event->id(), $event->type(), $event->post_id(), $event->attempt() );

			++$processed;
		}

		// Terminal rows are the duplicate guard, but they do not need to be
		// kept forever.
		if ( 1 === wp_rand( 1, 20 ) ) {
			$this->queue->purge( (int) $this->settings->get( 'queue_retention_days', 7 ) );
		}

		return $processed;
	}

	/**
	 * Runs the sweeper at most once per minute per site.
	 *
	 * Hooked on `shutdown`, so any request — admin, front end or REST —
	 * can rescue a stuck queue even on installations where WP-Cron never
	 * fires.
	 *
	 * @since 1.2.0
	 *
	 * @return void
	 */
	public function maybe_sweep(): void {
		if ( ! $this->settings->get( 'enabled' ) || ! $this->settings->get( 'webhooks_enabled' ) ) {
			return;
		}

		if ( wp_doing_cron() ) {
			// The scheduled sweeper already covers cron requests.
			return;
		}

		// Cheapest check first: an autoloaded flag, so a quiet queue costs no
		// query at all on the front end.
		if ( ! $this->queue->has_work() ) {
			return;
		}

		if ( false !== get_transient( 'wpep_sweep_throttle' ) ) {
			return;
		}

		set_transient( 'wpep_sweep_throttle', time(), MINUTE_IN_SECONDS );

		if ( function_exists( 'fastcgi_finish_request' ) ) {
			fastcgi_finish_request();
		}

		$this->sweep( 3 );
	}

	/**
	 * Acquires a short lived lock for one delivery attempt.
	 *
	 * Prevents a cron run and the inline fallback from sending the same
	 * attempt twice. Locks expire on their own, so a fatal error during
	 * delivery cannot block the retry.
	 *
	 * @since 1.2.0
	 *
	 * @param string $event_id Event identifier.
	 * @param int    $attempt  Attempt number.
	 *
	 * @return bool True when the caller owns the attempt.
	 */
	private function lock( string $event_id, int $attempt ): bool {
		$name = 'wpep_lock_' . md5( $event_id . ':' . $attempt );
		$now  = time();

		/**
		 * Filters how long a delivery lock is held.
		 *
		 * @since 1.2.0
		 *
		 * @param int $ttl Lock lifetime in seconds. Default 300.
		 */
		$ttl = (int) apply_filters( 'wpep_lock_ttl', 5 * MINUTE_IN_SECONDS );

		// add_option() is atomic at the database level: a second process
		// racing for the same lock gets false.
		if ( add_option( $name, $now, '', false ) ) {
			return true;
		}

		$held = (int) get_option( $name, 0 );

		if ( $held > 0 && ( $now - $held ) < max( 60, $ttl ) ) {
			return false;
		}

		// Stale lock from an interrupted run: take it over.
		update_option( $name, $now, false );

		return true;
	}

	/**
	 * Releases a delivery lock.
	 *
	 * @since 1.2.0
	 *
	 * @param string $event_id Event identifier.
	 * @param int    $attempt  Attempt number.
	 *
	 * @return void
	 */
	private function unlock( string $event_id, int $attempt ): void {
		delete_option( 'wpep_lock_' . md5( $event_id . ':' . $attempt ) );
	}

	/**
	 * Builds the payload for an event.
	 *
	 * @since 1.1.0
	 *
	 * @param Event $event Event being delivered.
	 *
	 * @return array<string,mixed>|null Payload, or null when the event is obsolete.
	 */
	private function build_payload( Event $event ): ?array {
		$timestamp = $this->webhook->signer()->timestamp();

		// Two kinds of event carry their payload with them rather than
		// rebuilding it from a post: a deletion, where the post is gone, and a
		// WooCommerce order, which under HPOS was never a post to begin with.
		// Both are already-complete payloads, so both take the same path.
		if ( $event->is_delete() || $event->has_snapshot() ) {
			if ( $event->has_snapshot() ) {
				return $this->contract->refresh( (array) $event->snapshot(), $event, $timestamp );
			}

			return $this->contract->build_minimal( $event, $timestamp );
		}

		$post = get_post( $event->post_id() );

		if ( ! $post instanceof WP_Post ) {
			return null;
		}

		if ( ! $this->detector->is_published_status( $post->post_status ) ) {
			return null;
		}

		$flat = $this->normalizer->normalize( $post, $event->type() );

		// The administrator's field mapping and message template are applied
		// here, between collection and the wire format, so neither the
		// normalizer nor the contract has to know they exist.
		if ( $this->dynamic instanceof DynamicPayload ) {
			$flat = $this->dynamic->extend( $flat, $post );
		}

		return $this->contract->build( $event, $flat, $timestamp );
	}

	/**
	 * Handles a successful delivery.
	 *
	 * @since 1.1.0
	 * @since 1.3.2 Added the `$result` argument.
	 *
	 * @param Event                                                  $event  Delivered event.
	 * @param array{success:bool,code:int,message:string,body:string} $result Delivery result.
	 *
	 * @return void
	 */
	private function succeed( Event $event, array $result = array() ): void {
		if ( $event->post_id() > 0 && ! $event->is_delete() ) {
			update_post_meta( $event->post_id(), Hooks::META_STATE, 'sent' );
			update_post_meta( $event->post_id(), Hooks::META_SENT_AT, time() );
		}

		$this->record_outcome( $event, true, (int) ( $result['code'] ?? 0 ), '', true );

		$this->finish( $event );

		/**
		 * Fires after an event has been accepted by the endpoint.
		 *
		 * @since 1.1.0
		 *
		 * @param Event $event Delivered event.
		 */
		do_action( 'wpep_event_delivered', $event );
	}

	/**
	 * Handles a failed delivery, retrying while attempts remain.
	 *
	 * @since 1.1.0
	 *
	 * @param Event                                                  $event  Failed event.
	 * @param array{success:bool,code:int,message:string,body:string} $result Delivery result.
	 *
	 * @return void
	 */
	private function fail( Event $event, array $result ): void {
		$max_retries = (int) $this->settings->get( 'retry_count', 3 );
		$code        = (int) ( $result['code'] ?? 0 );
		$message     = (string) ( $result['message'] ?? '' );
		$error_class = $this->retry->classify( $code, $message . ' ' . (string) ( $result['body'] ?? '' ) );
		$explanation = $this->retry->explain( $error_class, $code );

		if ( $this->retry->should_retry( $code, $error_class, $event->attempt(), $max_retries ) ) {
			$delay = $this->retry->delay( $event->attempt(), isset( $result['retry_after'] ) ? (int) $result['retry_after'] : null );

			/**
			 * Filters the delay before the next delivery attempt.
			 *
			 * @since 1.0.0
			 *
			 * @param int $delay   Delay in seconds.
			 * @param int $attempt Attempt number that just failed.
			 * @param int $post_id Post ID.
			 */
			$delay = max( 0, (int) apply_filters( 'wpep_retry_delay', $delay, $event->attempt(), $event->post_id() ) );

			// The claim already counted this attempt, so the row keeps its
			// number; only the schedule changes. The outcome is recorded
			// without counting a failure: an attempt that is about to be
			// retried is not yet a failed delivery.
			$this->record_outcome( $event, false, $code, $message, false );

			$this->queue->release( $event, $delay, $message );

			$retry = $event->with_attempt( $event->attempt() + 1 );

			if ( $retry->post_id() > 0 && ! $retry->is_delete() ) {
				update_post_meta( $retry->post_id(), Hooks::META_STATE, 'queued' );
			}

			$this->logger->event(
				'delivery.retry',
				Logger::STATUS_RETRY,
				sprintf(
					/* translators: 1: failed attempt number, 2: retry delay in seconds, 3: plain explanation. */
					__( 'Attempt %1$d failed; retrying in %2$d seconds. %3$s', 'wp-event-publisher' ),
					$event->attempt(),
					$delay,
					$explanation
				),
				array(
					'event_id'      => $event->id(),
					'event_type'    => $event->type(),
					'post_id'       => $event->post_id(),
					'attempt'       => $event->attempt(),
					'response_code' => (int) ( $result['code'] ?? 0 ),
					'request_url'   => $this->settings->endpoint(),
				)
			);

			$this->schedule( $retry, $delay );

			// A retry that cron cannot carry still needs a way out; the
			// sweeper picks it up once its delay has elapsed.
			$this->unlock( $event->id(), $event->attempt() );

			/**
			 * Fires when a failed delivery has been rescheduled.
			 *
			 * @since 1.0.0
			 * @since 1.1.0 Added the `$event` argument.
			 *
			 * @param int   $post_id Post ID.
			 * @param int   $attempt Attempt number that just failed.
			 * @param int   $delay   Delay before the next attempt.
			 * @param Event $event   Event being retried, identity preserved.
			 */
			do_action( 'wpep_job_rescheduled', $event->post_id(), $event->attempt(), $delay, $event );

			return;
		}

		if ( $event->post_id() > 0 && ! $event->is_delete() ) {
			update_post_meta( $event->post_id(), Hooks::META_STATE, 'failed' );
		}

		$permanent = $event->attempt() <= $max_retries;

		$this->record_outcome( $event, false, $code, '' !== $message ? $message : $explanation, true );

		$this->logger->event(
			$permanent ? 'delivery.permanent' : 'delivery.exhausted',
			Logger::STATUS_FAILED,
			$permanent
				? sprintf(
					/* translators: 1: plain explanation, 2: transport message. */
					__( 'Not retried: %1$s (%2$s)', 'wp-event-publisher' ),
					$explanation,
					$message
				)
				: sprintf(
					/* translators: 1: number of attempts, 2: plain explanation. */
					__( 'Giving up after %1$d attempts. %2$s', 'wp-event-publisher' ),
					$event->attempt(),
					$explanation
				),
			array(
				'event_id'      => $event->id(),
				'event_type'    => $event->type(),
				'post_id'       => $event->post_id(),
				'attempt'       => $event->attempt(),
				'response_code' => (int) ( $result['code'] ?? 0 ),
				'response_body' => mb_substr( (string) ( $result['body'] ?? '' ), 0, 2000 ),
				'request_url'   => $this->settings->endpoint(),
			)
		);

		$this->finish( $event, Queue::STATUS_FAILED, $explanation );

		/**
		 * Fires when an event has permanently failed.
		 *
		 * @since 1.0.0
		 * @since 1.1.0 Added the `$event` argument.
		 *
		 * @param int                                                    $post_id Post ID.
		 * @param array{success:bool,code:int,message:string,body:string} $result  Last delivery result.
		 * @param Event                                                  $event   Failed event.
		 */
		do_action( 'wpep_job_failed', $event->post_id(), $result, $event );
	}

	/**
	 * Releases the bookkeeping for an event that reached a terminal state.
	 *
	 * @since 1.1.0
	 *
	 * @param Event $event Event to release.
	 *
	 * @return void
	 */
	private function finish( Event $event, string $status = Queue::STATUS_DONE, string $error = '' ): void {
		$this->queue->finish( $event->id(), $status, $error );
		$this->unlock( $event->id(), $event->attempt() );

		// A cron job that is still queued for this event finds nothing to
		// do; clearing it keeps the cron array tidy.
		wp_clear_scheduled_hook(
			self::CRON_HOOK,
			array( $event->id(), $event->type(), $event->post_id(), $event->attempt() )
		);

		if ( $event->post_id() > 0 && ! $event->is_delete() ) {
			$this->event_id->release( $event->post_id(), $event->id() );
		}
	}

	/**
	 * Records the outcome of one delivery attempt.
	 *
	 * The counters answer the two questions an administrator asks first —
	 * "is it working" and "when did it last work" — and they survive the
	 * queue retention window, which the queue table's own rows do not.
	 *
	 * Nothing secret is stored: only a timestamp, an HTTP status code and
	 * the transport's own error text, which never contains the webhook
	 * secret because the secret only ever travels in a request header.
	 *
	 * @since 1.3.2
	 *
	 * @param Event  $event    Event that was delivered.
	 * @param bool   $success  Whether the endpoint accepted it.
	 * @param int    $code     HTTP status code, 0 when there was no response.
	 * @param string $error    Error message, empty on success.
	 * @param bool   $terminal Whether this outcome is final for the event.
	 *
	 * @return void
	 */
	private function record_outcome( Event $event, bool $success, int $code, string $error, bool $terminal ): void {
		$stats = get_option( self::OPTION_STATS, array() );
		$stats = is_array( $stats ) ? $stats : array();
		$now   = gmdate( 'Y-m-d H:i:s' );

		if ( $terminal ) {
			if ( $success ) {
				$stats['success_total'] = (int) ( $stats['success_total'] ?? 0 ) + 1;
				$stats['last_success']  = $now;
			} else {
				$stats['failed_total'] = (int) ( $stats['failed_total'] ?? 0 ) + 1;
				$stats['last_failure'] = $now;
			}
		}

		$stats['last_code']       = $code;
		$stats['last_at']         = $now;
		$stats['last_event_type'] = $event->type();
		$stats['last_post_id']    = $event->post_id();
		$stats['last_error']      = $success ? '' : mb_substr( $error, 0, 300 );

		// Never autoloaded: this is written on delivery, read on one screen.
		update_option( self::OPTION_STATS, $stats, false );
	}

	/**
	 * Returns the lifetime delivery counters.
	 *
	 * @since 1.3.2
	 *
	 * @return array{success_total:int,failed_total:int,last_success:string,last_failure:string,last_code:int,last_at:string,last_event_type:string,last_post_id:int,last_error:string} Counters.
	 */
	public function delivery_stats(): array {
		$stats = get_option( self::OPTION_STATS, array() );
		$stats = is_array( $stats ) ? $stats : array();

		return array(
			'success_total'   => (int) ( $stats['success_total'] ?? 0 ),
			'failed_total'    => (int) ( $stats['failed_total'] ?? 0 ),
			'last_success'    => (string) ( $stats['last_success'] ?? '' ),
			'last_failure'    => (string) ( $stats['last_failure'] ?? '' ),
			'last_code'       => (int) ( $stats['last_code'] ?? 0 ),
			'last_at'         => (string) ( $stats['last_at'] ?? '' ),
			'last_event_type' => (string) ( $stats['last_event_type'] ?? '' ),
			'last_post_id'    => (int) ( $stats['last_post_id'] ?? 0 ),
			'last_error'      => (string) ( $stats['last_error'] ?? '' ),
		);
	}

	/**
	 * Returns the durable delivery queue.
	 *
	 * Named `storage()` because `queue()` is the verb: it enqueues a post.
	 *
	 * @since 1.3.0
	 *
	 * @return Queue Delivery queue.
	 */
	public function storage(): Queue {
		return $this->queue;
	}

	/**
	 * Records an exception raised while delivering an event.
	 *
	 * @since 1.1.0
	 *
	 * @param Event      $event     Event being delivered.
	 * @param \Throwable $exception Raised exception.
	 *
	 * @return void
	 */
	private function log_exception( Event $event, \Throwable $exception ): void {
		$this->logger->event(
			'dispatch.exception',
			Logger::STATUS_FAILED,
			sprintf(
				/* translators: %s: exception message. */
				__( 'An exception interrupted the delivery: %s', 'wp-event-publisher' ),
				$exception->getMessage()
			),
			array(
				'event_id'      => $event->id(),
				'event_type'    => $event->type(),
				'post_id'       => $event->post_id(),
				'attempt'       => $event->attempt(),
				'request_url'   => $this->settings->endpoint(),
				'response_body' => $exception->getMessage(),
			)
		);

		/**
		 * Fires when an exception interrupted a delivery.
		 *
		 * @since 1.1.0
		 *
		 * @param \Throwable $exception Raised exception.
		 * @param Event      $event     Event being delivered.
		 */
		do_action( 'wpep_event_exception', $exception, $event );
	}
}
