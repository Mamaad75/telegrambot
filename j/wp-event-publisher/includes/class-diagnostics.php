<?php
/**
 * Self-check suite for the delivery pipeline.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Answers "why did my advertisement not arrive?" without reading code.
 *
 * Each check is independent and reports one of three states, so the first
 * red row is the thing to fix. The checks run in pipeline order — URL,
 * DNS, TLS, health, authentication, queue, hooks, post types — because
 * that is the order in which a publication can fail.
 *
 * @since 1.3.0
 */
class Diagnostics {

	/**
	 * Check passed.
	 *
	 * @var string
	 */
	public const OK = 'ok';

	/**
	 * Check passed but something deserves attention.
	 *
	 * @var string
	 */
	public const WARN = 'warn';

	/**
	 * Check failed; delivery cannot work until it is resolved.
	 *
	 * @var string
	 */
	public const FAIL = 'fail';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Webhook transport dependency.
	 *
	 * @var Webhook
	 */
	private Webhook $webhook;

	/**
	 * Queue dependency.
	 *
	 * @var Queue
	 */
	private Queue $queue;

	/**
	 * Dispatcher dependency.
	 *
	 * @var Dispatcher
	 */
	private Dispatcher $dispatcher;

	/**
	 * Validator dependency.
	 *
	 * @var Validator
	 */
	private Validator $validator;

	/**
	 * Constructor.
	 *
	 * @since 1.3.0
	 *
	 * @param Settings   $settings   Settings service.
	 * @param Webhook    $webhook    Webhook transport.
	 * @param Queue      $queue      Delivery queue.
	 * @param Dispatcher $dispatcher Dispatcher.
	 * @param Validator  $validator  Validator service.
	 */
	public function __construct(
		Settings $settings,
		Webhook $webhook,
		Queue $queue,
		Dispatcher $dispatcher,
		Validator $validator
	) {
		$this->settings   = $settings;
		$this->webhook    = $webhook;
		$this->queue      = $queue;
		$this->dispatcher = $dispatcher;
		$this->validator  = $validator;
	}

	/**
	 * Runs every check.
	 *
	 * @since 1.3.0
	 *
	 * @param bool $include_remote Whether to perform network requests.
	 *
	 * @return array<int,array{id:string,label:string,status:string,detail:string}> Check results.
	 */
	public function run( bool $include_remote = true ): array {
		$checks = array(
			$this->check_configuration(),
			$this->check_url(),
			$this->check_secret(),
			$this->check_post_types(),
			$this->check_hooks(),
			$this->check_deliveries(),
			$this->check_queue(),
			$this->check_cron(),
		);

		if ( $include_remote ) {
			$checks[] = $this->check_dns();
			$checks[] = $this->check_health();
			$checks[] = $this->check_webhook();
		}

		/**
		 * Filters the diagnostics results.
		 *
		 * @since 1.3.0
		 *
		 * @param array<int,array<string,string>> $checks Check results.
		 */
		return (array) apply_filters( 'wpep_diagnostics', array_values( array_filter( $checks ) ) );
	}

	/**
	 * Builds one result row.
	 *
	 * @since 1.3.0
	 *
	 * @param string $id     Machine readable check name.
	 * @param string $label  Human readable check name.
	 * @param string $status One of the OK / WARN / FAIL constants.
	 * @param string $detail Explanation shown to the administrator.
	 *
	 * @return array{id:string,label:string,status:string,detail:string} Result row.
	 */
	private function result( string $id, string $label, string $status, string $detail ): array {
		return compact( 'id', 'label', 'status', 'detail' );
	}

	/**
	 * Checks the toggles that silently stop everything.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_configuration(): array {
		$problems = array();

		if ( ! $this->settings->get( 'enabled' ) ) {
			$problems[] = __( 'Enable Plugin is off', 'wp-event-publisher' );
		}

		if ( ! $this->settings->get( 'webhooks_enabled' ) ) {
			$problems[] = __( 'Enable Webhooks is off', 'wp-event-publisher' );
		}

		if ( empty( $this->settings->allowed_event_types() ) ) {
			$problems[] = __( 'no event types are enabled', 'wp-event-publisher' );
		}

		if ( ! empty( $problems ) ) {
			return $this->result(
				'configuration',
				__( 'Plugin configuration', 'wp-event-publisher' ),
				self::FAIL,
				implode( '، ', $problems )
			);
		}

		return $this->result(
			'configuration',
			__( 'Plugin configuration', 'wp-event-publisher' ),
			self::OK,
			__( 'Event detection and webhook delivery are both enabled.', 'wp-event-publisher' )
		);
	}

	/**
	 * Checks the webhook URL.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_url(): array {
		$raw = (string) $this->settings->get( 'node_api_url' );
		$url = $this->settings->endpoint();

		if ( '' === $raw ) {
			return $this->result(
				'url',
				__( 'Webhook URL', 'wp-event-publisher' ),
				self::FAIL,
				__( 'No webhook URL is configured.', 'wp-event-publisher' )
			);
		}

		if ( '' === $url ) {
			return $this->result(
				'url',
				__( 'Webhook URL', 'wp-event-publisher' ),
				self::FAIL,
				__( 'The configured URL was rejected. Only HTTPS URLs are accepted, and link-local addresses are refused.', 'wp-event-publisher' )
			);
		}

		return $this->result( 'url', __( 'Webhook URL', 'wp-event-publisher' ), self::OK, $url );
	}

	/**
	 * Checks that a credential is configured.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_secret(): array {
		$secret = (string) $this->settings->get( 'api_secret' );

		if ( '' === $secret ) {
			return $this->result(
				'secret',
				__( 'Webhook authentication', 'wp-event-publisher' ),
				self::FAIL,
				__( 'No webhook secret is configured, so the service answers "Missing webhook authentication" to every request.', 'wp-event-publisher' )
			);
		}

		if ( strlen( $secret ) < 16 ) {
			return $this->result(
				'secret',
				__( 'Webhook authentication', 'wp-event-publisher' ),
				self::WARN,
				__( 'A secret is configured but it is shorter than 16 characters.', 'wp-event-publisher' )
			);
		}

		return $this->result(
			'secret',
			__( 'Webhook authentication', 'wp-event-publisher' ),
			self::OK,
			sprintf(
				/* translators: %s: authentication style. */
				__( 'A secret is configured. Authentication style: %s. The value is never displayed or logged.', 'wp-event-publisher' ),
				(string) $this->settings->get( 'auth_style', Signer::AUTH_ALL )
			)
		);
	}

	/**
	 * Checks the post type selection against what is registered.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_post_types(): array {
		$selected   = $this->settings->allowed_post_types();
		$registered = get_post_types( array(), 'names' );

		if ( empty( $selected ) ) {
			return $this->result(
				'post_types',
				__( 'Advertisement post types', 'wp-event-publisher' ),
				self::FAIL,
				__( 'No post type is enabled, so publishing is always ignored. Select one in Settings, or switch Post Type Detection to automatic.', 'wp-event-publisher' )
			);
		}

		$missing = array_values( array_diff( $selected, array_keys( $registered ) ) );

		if ( ! empty( $missing ) ) {
			return $this->result(
				'post_types',
				__( 'Advertisement post types', 'wp-event-publisher' ),
				self::WARN,
				sprintf(
					/* translators: 1: selected post types, 2: unregistered ones. */
					__( 'Enabled: %1$s. These are not registered on this site right now: %2$s. If they come from a plugin that registers late, that is expected.', 'wp-event-publisher' ),
					implode( '، ', $selected ),
					implode( '، ', $missing )
				)
			);
		}

		return $this->result(
			'post_types',
			__( 'Advertisement post types', 'wp-event-publisher' ),
			self::OK,
			sprintf(
				/* translators: 1: enabled post types, 2: total registered count. */
				__( 'Enabled: %1$s (out of %2$d registered post types).', 'wp-event-publisher' ),
				implode( '، ', $selected ),
				count( $registered )
			)
		);
	}

	/**
	 * Checks that the publishing hooks are actually attached.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_hooks(): array {
		$expected = array( 'transition_post_status', 'wp_after_insert_post', 'save_post', 'post_updated', 'before_delete_post' );
		$missing  = array();

		foreach ( $expected as $hook ) {
			if ( ! has_action( $hook ) ) {
				$missing[] = $hook;
			}
		}

		$last = get_option( 'wpep_last_hook', array() );
		$seen = is_array( $last ) && ! empty( $last['hook'] )
			? sprintf(
				/* translators: 1: hook name, 2: human readable time difference. */
				__( 'Last hook seen: %1$s, %2$s ago.', 'wp-event-publisher' ),
				(string) $last['hook'],
				human_time_diff( (int) ( $last['at'] ?? time() ) )
			)
			: __( 'No publishing hook has fired since the plugin was updated.', 'wp-event-publisher' );

		if ( ! empty( $missing ) ) {
			return $this->result(
				'hooks',
				__( 'Publishing hooks', 'wp-event-publisher' ),
				self::FAIL,
				sprintf(
					/* translators: %s: hook names. */
					__( 'These hooks have no listener: %s. Another plugin may have removed them.', 'wp-event-publisher' ),
					implode( '، ', $missing )
				)
			);
		}

		return $this->result(
			'hooks',
			__( 'Publishing hooks', 'wp-event-publisher' ),
			self::OK,
			sprintf(
				/* translators: 1: number of hooks, 2: last hook sentence. */
				__( 'All %1$d publishing hooks are attached. %2$s', 'wp-event-publisher' ),
				count( $expected ),
				$seen
			)
		);
	}

	/**
	 * Reports the lifetime delivery record.
	 *
	 * @since 1.3.2
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_deliveries(): array {
		$stats = $this->dispatcher->delivery_stats();
		$label = __( 'Delivery record', 'wp-event-publisher' );

		if ( 0 === $stats['success_total'] && 0 === $stats['failed_total'] ) {
			return $this->result(
				'deliveries',
				$label,
				self::WARN,
				__( 'No advertisement has been delivered yet. Publish one, or use Tools → Send One Advertisement Now.', 'wp-event-publisher' )
			);
		}

		$detail = sprintf(
			/* translators: 1: successful deliveries, 2: failed deliveries. */
			__( 'Delivered: %1$d. Failed: %2$d.', 'wp-event-publisher' ),
			$stats['success_total'],
			$stats['failed_total']
		);

		if ( '' !== $stats['last_success'] ) {
			$detail .= ' ' . sprintf(
				/* translators: %s: UTC timestamp. */
				__( 'Last success: %s UTC.', 'wp-event-publisher' ),
				$stats['last_success']
			);
		}

		if ( '' !== $stats['last_failure'] ) {
			$detail .= ' ' . sprintf(
				/* translators: %s: UTC timestamp. */
				__( 'Last failure: %s UTC.', 'wp-event-publisher' ),
				$stats['last_failure']
			);
		}

		if ( $stats['last_code'] > 0 ) {
			$detail .= ' ' . sprintf(
				/* translators: %d: HTTP status code. */
				__( 'Last response code: HTTP %d.', 'wp-event-publisher' ),
				$stats['last_code']
			);
		}

		return $this->result(
			'deliveries',
			$label,
			'' !== $stats['last_error'] ? self::WARN : self::OK,
			'' !== $stats['last_error'] ? $detail . ' ' . $stats['last_error'] : $detail
		);
	}

	/**
	 * Checks the queue table and its contents.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_queue(): array {
		if ( ! $this->queue->is_installed() ) {
			return $this->result(
				'queue',
				__( 'Delivery queue', 'wp-event-publisher' ),
				self::FAIL,
				__( 'The queue table is missing. Deactivate and reactivate the plugin to create it.', 'wp-event-publisher' )
			);
		}

		$stats = $this->queue->stats();

		$detail = sprintf(
			/* translators: 1: waiting count, 2: retrying count, 3: delivered count, 4: failed count. */
			__( 'Waiting: %1$d. Retrying: %2$d. Delivered: %3$d. Failed: %4$d.', 'wp-event-publisher' ),
			(int) $stats['waiting'],
			(int) $stats['retrying'],
			(int) ( $stats['counts'][ Queue::STATUS_DONE ] ?? 0 ),
			(int) ( $stats['counts'][ Queue::STATUS_FAILED ] ?? 0 )
		);

		if ( '' !== $stats['last_success'] ) {
			$detail .= ' ' . sprintf(
				/* translators: %s: UTC timestamp. */
				__( 'Last successful delivery: %s UTC.', 'wp-event-publisher' ),
				$stats['last_success']
			);
		}

		if ( '' !== $stats['last_failure'] ) {
			$detail .= ' ' . sprintf(
				/* translators: 1: UTC timestamp, 2: error. */
				__( 'Last failure: %1$s UTC — %2$s', 'wp-event-publisher' ),
				$stats['last_failure'],
				$stats['last_error']
			);
		}

		$status = (int) $stats['waiting'] > 20 ? self::WARN : self::OK;

		return $this->result( 'queue', __( 'Delivery queue', 'wp-event-publisher' ), $status, $detail );
	}

	/**
	 * Checks whether WP-Cron can be relied upon.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_cron(): array {
		if ( ! $this->settings->cron_available() ) {
			return $this->result(
				'cron',
				__( 'Scheduling', 'wp-event-publisher' ),
				self::WARN,
				__( 'DISABLE_WP_CRON is defined. Delivery does not depend on it: events are sent at the end of the publish request and the queue sweeper catches the rest.', 'wp-event-publisher' )
			);
		}

		if ( ! $this->dispatcher->cron_healthy() ) {
			return $this->result(
				'cron',
				__( 'Scheduling', 'wp-event-publisher' ),
				self::WARN,
				__( 'WP-Cron is enabled but overdue, so it is not running reliably on this site. Delivery falls back to inline sending.', 'wp-event-publisher' )
			);
		}

		return $this->result(
			'cron',
			__( 'Scheduling', 'wp-event-publisher' ),
			self::OK,
			__( 'WP-Cron is running. It is the backstop; delivery does not depend on it.', 'wp-event-publisher' )
		);
	}

	/**
	 * Resolves the webhook host name.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_dns(): array {
		$host = $this->host();

		if ( '' === $host ) {
			return $this->result( 'dns', __( 'DNS resolution', 'wp-event-publisher' ), self::WARN, __( 'No host to resolve.', 'wp-event-publisher' ) );
		}

		$ip = gethostbyname( $host );

		if ( $ip === $host ) {
			return $this->result(
				'dns',
				__( 'DNS resolution', 'wp-event-publisher' ),
				self::FAIL,
				sprintf(
					/* translators: %s: host name. */
					__( '%s could not be resolved from this server. This is a DNS problem on the WordPress host.', 'wp-event-publisher' ),
					$host
				)
			);
		}

		return $this->result(
			'dns',
			__( 'DNS resolution', 'wp-event-publisher' ),
			self::OK,
			sprintf(
				/* translators: 1: host name, 2: IP address. */
				__( '%1$s resolves to %2$s.', 'wp-event-publisher' ),
				$host,
				$ip
			)
		);
	}

	/**
	 * Probes the service health endpoint on the webhook's own origin.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_health(): array {
		$health = $this->health_url();

		if ( '' === $health ) {
			return $this->result( 'health', __( 'Service health endpoint', 'wp-event-publisher' ), self::WARN, __( 'No endpoint to probe.', 'wp-event-publisher' ) );
		}

		$started  = microtime( true );
		$response = wp_remote_get(
			$health,
			array(
				'timeout'   => max( Validator::TIMEOUT_MIN, (int) $this->settings->get( 'webhook_timeout', 15 ) ),
				'sslverify' => true,
			)
		);
		$duration = round( microtime( true ) - $started, 3 );

		if ( is_wp_error( $response ) ) {
			return $this->result(
				'health',
				__( 'Service health endpoint', 'wp-event-publisher' ),
				self::FAIL,
				sprintf(
					/* translators: 1: health URL, 2: error message. */
					__( '%1$s is unreachable: %2$s', 'wp-event-publisher' ),
					$health,
					$response->get_error_message()
				)
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $response );

		return $this->result(
			'health',
			__( 'Service health endpoint', 'wp-event-publisher' ),
			$code >= 200 && $code < 400 ? self::OK : self::WARN,
			sprintf(
				/* translators: 1: health URL, 2: HTTP status, 3: duration in seconds. */
				__( '%1$s answered HTTP %2$d in %3$s s. TLS verification succeeded.', 'wp-event-publisher' ),
				$health,
				$code,
				number_format_i18n( $duration, 3 )
			)
		);
	}

	/**
	 * Sends a real authenticated test event.
	 *
	 * @since 1.3.0
	 *
	 * @return array<string,string> Result row.
	 */
	private function check_webhook(): array {
		$result = $this->webhook->test_connection();

		return $this->result(
			'webhook',
			__( 'Authenticated webhook request', 'wp-event-publisher' ),
			$result['success'] ? self::OK : self::FAIL,
			trim( $result['message'] . ' ' . mb_substr( wp_strip_all_tags( (string) $result['body'] ), 0, 300 ) )
		);
	}

	/**
	 * Returns the configured endpoint host.
	 *
	 * @since 1.3.0
	 *
	 * @return string Host name, empty when unavailable.
	 */
	private function host(): string {
		$parts = wp_parse_url( $this->settings->endpoint() );

		return isset( $parts['host'] ) ? (string) $parts['host'] : '';
	}

	/**
	 * Builds the health URL on the endpoint's own origin.
	 *
	 * No caller-supplied URL is ever fetched: scheme, host and port all
	 * come from the validated endpoint setting.
	 *
	 * @since 1.3.0
	 *
	 * @return string Health URL, empty when unavailable.
	 */
	private function health_url(): string {
		$parts = wp_parse_url( $this->settings->endpoint() );

		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}

		/**
		 * Filters the path of the service health probe.
		 *
		 * @since 1.3.0
		 *
		 * @param string $path Health path. Default `/health`.
		 */
		$path = (string) apply_filters( 'wpep_health_path', '/health' );

		return $parts['scheme'] . '://' . $parts['host']
			. ( empty( $parts['port'] ) ? '' : ':' . (int) $parts['port'] )
			. '/' . ltrim( $path, '/' );
	}
}
