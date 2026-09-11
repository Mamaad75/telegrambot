<?php
/**
 * Webhook HTTP client.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Delivers signed JSON payloads to the Node.js service.
 *
 * Responsibility stops at transport: this class encodes the body, asks
 * {@see Signer} to authenticate it, performs the HTTP request and records
 * the outcome. It does not decide what to send ({@see Contract}), when to
 * send it ({@see Dispatcher}) or whether anything happened at all
 * ({@see EventDetector}).
 *
 * The endpoint and the credentials come from one place, {@see Settings},
 * for every kind of request — connection test, sample payload and real
 * advertisement alike — so a green test button cannot mean something
 * different from a live publish.
 *
 * The signature covers the exact bytes that go over the wire. The body is
 * encoded once, signed and handed to `wp_remote_post()` unchanged, so the
 * consumer can recompute the digest from the raw request body it reads.
 *
 * @since 1.0.0
 */
class Webhook {

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
	 * Validator dependency.
	 *
	 * @var Validator
	 */
	private Validator $validator;

	/**
	 * Signature service.
	 *
	 * @var Signer
	 */
	private Signer $signer;

	/**
	 * Contract builder.
	 *
	 * @var Contract
	 */
	private Contract $contract;

	/**
	 * Event identifier service.
	 *
	 * @var EventId
	 */
	private EventId $event_id;

	/**
	 * Timeout WordPress actually handed to the HTTP transport.
	 *
	 * Captured per request so the log can prove which budget cURL used,
	 * rather than which budget was configured.
	 *
	 * @var int
	 */
	private int $effective_timeout = 0;

	/**
	 * Timeout a third party tried to impose on our request.
	 *
	 * @var int
	 */
	private int $clamped_timeout = 0;

	/**
	 * Constructor.
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Added the signer, contract and event identifier dependencies.
	 *
	 * @param Settings  $settings  Settings service.
	 * @param Logger    $logger    Logger service.
	 * @param Validator $validator Validator service.
	 * @param Signer    $signer    Signature service.
	 * @param Contract  $contract  Contract builder.
	 * @param EventId   $event_id  Event identifier service.
	 */
	public function __construct(
		Settings $settings,
		Logger $logger,
		Validator $validator,
		Signer $signer,
		Contract $contract,
		EventId $event_id
	) {
		$this->settings  = $settings;
		$this->logger    = $logger;
		$this->validator = $validator;
		$this->signer    = $signer;
		$this->contract  = $contract;
		$this->event_id  = $event_id;
	}

	/**
	 * Returns the signature service.
	 *
	 * Exposed so callers can mint a timestamp with the same formatting
	 * the signature uses instead of building one themselves.
	 *
	 * @since 1.1.0
	 *
	 * @return Signer Signature service.
	 */
	public function signer(): Signer {
		return $this->signer;
	}

	/**
	 * Delivers an event payload.
	 *
	 * @since 1.1.0
	 *
	 * @param Event               $event   Event being delivered.
	 * @param array<string,mixed> $payload Payload built by the contract.
	 *
	 * @return array{success:bool,code:int,message:string,body:string} Delivery result.
	 */
	public function send_event( Event $event, array $payload, string $endpoint = '' ): array {
		return $this->transport( $event, $payload, null, $endpoint );
	}

	/**
	 * Sends a payload and returns detailed result information.
	 *
	 * Retained from version 1.0.0. Payloads that already carry an
	 * `event_id` keep it, so a caller replaying an event does not break
	 * the consumer's idempotency; anything else is given a fresh
	 * identifier.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $payload Payload to deliver.
	 * @param int                 $post_id Related post ID (0 for diagnostics).
	 *
	 * @return array{success:bool,code:int,message:string,body:string} Delivery result.
	 */
	public function dispatch( array $payload, int $post_id = 0 ): array {
		$event_id   = isset( $payload['event_id'] ) ? (string) $payload['event_id'] : '';
		$event_type = (string) ( $payload['event_type'] ?? $payload['event'] ?? Event::TYPE_UPDATED );

		if ( '' === $event_id ) {
			$event_id = $this->event_id->generate();
		}

		$event = new Event( $event_id, $event_type, $post_id );

		$payload['event_id']   = $event_id;
		$payload['event_type'] = $event_type;

		return $this->transport( $event, $payload );
	}

	/**
	 * Sends a payload to the configured endpoint and logs the result.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $payload Payload to deliver.
	 * @param int                 $post_id Related post ID (0 for diagnostics).
	 *
	 * @return bool True when the endpoint returned a 2xx response.
	 */
	public function send( array $payload, int $post_id = 0 ): bool {
		$result = $this->dispatch( $payload, $post_id );

		return $result['success'];
	}

	/**
	 * Performs a connection test against the configured endpoint.
	 *
	 * Sends a `test` event: same URL, headers, signature and encoding as
	 * a real delivery, but no advertisement data, so the Node.js service
	 * verifies its authentication path without publishing to Telegram.
	 *
	 * @since 1.0.0
	 *
	 * @return array{success:bool,code:int,message:string,body:string} Delivery result.
	 */
	public function test_connection(): array {
		$event     = new Event( $this->event_id->generate(), Event::TYPE_TEST );
		$timestamp = $this->signer->timestamp();

		return $this->transport( $event, $this->contract->build_diagnostic( $event, $timestamp ), $timestamp );
	}

	/**
	 * Encodes, signs, sends and logs one request.
	 *
	 * @since 1.1.0
	 *
	 * @param Event               $event     Event being delivered.
	 * @param array<string,mixed> $payload   Payload to encode.
	 * @param string|null         $timestamp Request timestamp; generated when omitted.
	 *
	 * @return array{success:bool,code:int,message:string,body:string} Delivery result.
	 */
	private function transport( Event $event, array $payload, ?string $timestamp = null, string $endpoint = '' ): array {
		$site_id = $this->settings->site_id();

		// A destination may publish through a different Telegram Publisher
		// instance. It is validated by the caller and re-validated here, so
		// an override can never widen what the settings endpoint allows.
		$url = '' !== $endpoint ? $this->validator->validate_url( $endpoint ) : $this->settings->endpoint();

		if ( '' === $url ) {
			return $this->abort(
				$event,
				$site_id,
				'',
				__( 'Webhook aborted: no valid HTTPS endpoint URL is configured. Set it under Settings → Webhook URL.', 'wp-event-publisher' )
			);
		}

		if ( ! $this->settings->get( 'webhooks_enabled' ) ) {
			$message = __( 'Webhooks are disabled in Settings, so nothing was sent.', 'wp-event-publisher' );

			$this->logger->event(
				'webhook.disabled',
				Logger::STATUS_SKIPPED,
				$message,
				array(
					'event_id'    => $event->id(),
					'event_type'  => $event->type(),
					'post_id'     => $event->post_id(),
					'attempt'     => $event->attempt(),
					'request_url' => $url,
				)
			);

			return array(
				'success' => false,
				'code'    => 0,
				'message' => $message,
				'body'    => '',
			);
		}

		// Every attempt carries a fresh timestamp so it survives the
		// consumer's replay window, while the event identifier stays the
		// one issued at detection time.
		$timestamp             = $timestamp ?? $this->signer->timestamp();
		$payload['timestamp']  = $timestamp;
		$payload['event_id']   = $event->id();
		$payload['event_type'] = $event->type();
		$payload['attempt']    = $event->attempt();

		// JSON_UNESCAPED_UNICODE keeps Persian text readable on the wire
		// instead of turning it into \uXXXX escapes.
		$raw_body = wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );

		if ( false === $raw_body || null === $raw_body ) {
			return $this->abort(
				$event,
				$site_id,
				$url,
				sprintf(
					/* translators: %s: JSON error message. */
					__( 'Webhook aborted: the payload could not be encoded as JSON (%s).', 'wp-event-publisher' ),
					json_last_error_msg()
				)
			);
		}

		$secret = (string) $this->settings->get( 'api_secret' );

		// Signed after encoding and never re-encoded afterwards: the
		// digest covers the exact bytes the consumer will read.
		$signature = $this->signer->sign( $timestamp, $raw_body, $secret );

		$headers = array_merge(
			array(
				'Content-Type' => 'application/json; charset=utf-8',
				'Accept'       => 'application/json',
			),
			$this->signer->auth_headers(
				$event,
				$site_id,
				$timestamp,
				$signature,
				$secret,
				(string) $this->settings->get( 'auth_style', Signer::AUTH_ALL ),
				$raw_body
			),
			array(
				'X-Event-Type'     => $event->type(),
				'X-Attempt'        => (string) $event->attempt(),
				'X-Plugin-Version' => WPEP_VERSION,
				'X-Site'           => home_url(),
			),
			// Anything the backend needs that this plugin does not know
			// about, configured in Settings.
			$this->settings->custom_headers()
		);

		/**
		 * Filters the HTTP headers sent with every webhook request.
		 *
		 * The signature is already computed at this point. Adding or
		 * changing headers is safe; changing the body is not, because the
		 * digest would no longer match. Use `wpep_event_payload` to
		 * change the body.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string,string> $headers Request headers.
		 * @param array<string,mixed>  $payload Payload being delivered.
		 * @param int                  $post_id Related post ID.
		 * @param Event                $event   Event being delivered.
		 */
		$headers = apply_filters( 'wpep_webhook_headers', $headers, $payload, $event->post_id(), $event );

		$timeout = max( Validator::TIMEOUT_MIN, (int) $this->settings->get( 'webhook_timeout', 15 ) );
		$connect = max( 1, min( $timeout, (int) $this->settings->get( 'connect_timeout', 10 ) ) );

		$request_args = array(
			'method'      => 'POST',
			'timeout'     => $timeout,
			'redirection' => 0,
			'blocking'    => true,
			'headers'     => $headers,
			'body'        => $raw_body,
			'data_format' => 'body',
			'sslverify'   => true,
			// The old token is kept alongside the new one on purpose. A
			// User-Agent is a wire identifier, and a backend or a WAF rule
			// somewhere may be matching on the 1.5.x string; dropping it to
			// look tidier could stop delivery for an existing customer.
			'user-agent'  => 'Jarchi/' . WPEP_VERSION . ' (WP Event Publisher/' . WPEP_VERSION . '); ' . home_url(),
			// Consumed by the cURL transport below: the connection phase
			// gets its own budget, so a slow DNS or TLS handshake fails
			// fast and distinguishably instead of eating the whole window.
			'wpep_connect_timeout' => $connect,
		);

		/**
		 * Filters the full wp_remote_post() argument array.
		 *
		 * Replacing `body` invalidates the signature; the consumer will
		 * reject the request.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string,mixed> $request_args Request arguments.
		 * @param string              $url          Endpoint URL.
		 * @param int                 $post_id      Related post ID.
		 * @param Event               $event        Event being delivered.
		 */
		$request_args = apply_filters( 'wpep_webhook_request_args', $request_args, $url, $event->post_id(), $event );

		$this->logger->event(
			'webhook.sending',
			Logger::STATUS_INFO,
			sprintf(
				/* translators: 1: endpoint URL, 2: payload size in bytes. */
				__( 'POSTing %2$d bytes of JSON to %1$s.', 'wp-event-publisher' ),
				$url,
				strlen( $raw_body )
			),
			array(
				'event_id'    => $event->id(),
				'event_type'  => $event->type(),
				'post_id'     => $event->post_id(),
				'attempt'     => $event->attempt(),
				'request_url' => $url,
				'data'        => array(
					'auth_style'  => (string) $this->settings->get( 'auth_style', Signer::AUTH_ALL ),
					'signed'      => '' !== $signature,
					'timeout'     => (int) $request_args['timeout'],
					'header_keys' => array_keys( (array) $request_args['headers'] ),
				),
			),
			true
		);

		/**
		 * Fires immediately before a webhook request is sent.
		 *
		 * @since 1.0.0
		 * @since 1.1.0 Added the `$event` argument.
		 *
		 * @param string              $url     Endpoint URL.
		 * @param array<string,mixed> $payload Payload being delivered.
		 * @param int                 $post_id Related post ID.
		 * @param Event               $event   Event being delivered.
		 */
		do_action( 'wpep_before_webhook', $url, $payload, $event->post_id(), $event );

		$started  = microtime( true );
		$response = $this->execute( $url, $request_args, $timeout );
		$duration = round( microtime( true ) - $started, 3 );

		if ( is_wp_error( $response ) ) {
			$message = sprintf(
				/* translators: 1: error code, 2: error message, 3: duration in seconds, 4: effective timeout in seconds. */
				__( 'The request never completed (%1$s): %2$s — after %3$s s with a %4$d s timeout.', 'wp-event-publisher' ),
				$response->get_error_code(),
				$response->get_error_message(),
				number_format_i18n( $duration, 3 ),
				$this->effective_timeout > 0 ? $this->effective_timeout : $timeout
			);

			$message .= $this->timeout_advice( $timeout );

			$this->record( $event, $site_id, $url, $raw_body, 0, $response->get_error_message(), Logger::STATUS_FAILED, $message );

			/**
			 * Fires when a webhook request failed.
			 *
			 * @since 1.0.0
			 * @since 1.1.0 Added the `$event` argument.
			 *
			 * @param string              $message Error message.
			 * @param array<string,mixed> $payload Payload being delivered.
			 * @param int                 $post_id Related post ID.
			 * @param Event               $event   Event being delivered.
			 */
			do_action( 'wpep_webhook_failed', $message, $payload, $event->post_id(), $event );

			return array(
				'success' => false,
				'code'    => 0,
				'message' => $message,
				'body'    => '',
			);
		}

		$code          = (int) wp_remote_retrieve_response_code( $response );
		$response_body = (string) wp_remote_retrieve_body( $response );
		$success       = $code >= 200 && $code < 300;
		$retry_after   = $this->retry_after( $response );

		$message = $success
			? sprintf(
				/* translators: 1: HTTP status code, 2: duration in seconds. */
				__( 'The endpoint accepted the payload (HTTP %1$d) in %2$s s.', 'wp-event-publisher' ),
				$code,
				number_format_i18n( $duration, 3 )
			)
			: sprintf(
				/* translators: 1: HTTP status code, 2: response body excerpt. */
				__( 'The endpoint rejected the payload (HTTP %1$d): %2$s', 'wp-event-publisher' ),
				$code,
				mb_substr( trim( wp_strip_all_tags( $response_body ) ), 0, 300 )
			);

		$this->record(
			$event,
			$site_id,
			$url,
			$raw_body,
			$code,
			mb_substr( $response_body, 0, 10000 ),
			$success ? Logger::STATUS_SUCCESS : Logger::STATUS_FAILED,
			$message
		);

		if ( $success ) {
			/**
			 * Fires after a webhook request has been accepted (HTTP 2xx).
			 *
			 * @since 1.0.0
			 * @since 1.1.0 Added the `$event` argument.
			 *
			 * @param int                 $code    HTTP status code.
			 * @param string              $body    Response body.
			 * @param array<string,mixed> $payload Payload delivered.
			 * @param int                 $post_id Related post ID.
			 * @param Event               $event   Event delivered.
			 */
			do_action( 'wpep_webhook_sent', $code, $response_body, $payload, $event->post_id(), $event );
		} else {
			/** This action is documented above in the transport error branch. */
			do_action( 'wpep_webhook_failed', sprintf( 'HTTP %d', $code ), $payload, $event->post_id(), $event );
		}

		return array(
			'success'     => $success,
			'code'        => $code,
			'message'     => $message,
			'body'        => $response_body,
			'retry_after' => $retry_after,
		);
	}

	/**
	 * Reads a `Retry-After` header, in seconds.
	 *
	 * A rate limited service tells us exactly when to come back; honouring
	 * it is better than any backoff we could invent.
	 *
	 * @since 1.3.0
	 *
	 * @param array<string,mixed> $response Response from wp_remote_post().
	 *
	 * @return int|null Seconds to wait, or null when not supplied.
	 */
	private function retry_after( array $response ): ?int {
		$header = wp_remote_retrieve_header( $response, 'retry-after' );

		if ( is_array( $header ) ) {
			$header = reset( $header );
		}

		$header = trim( (string) $header );

		if ( '' === $header ) {
			return null;
		}

		if ( ctype_digit( $header ) ) {
			return (int) $header;
		}

		$moment = strtotime( $header );

		return false === $moment ? null : max( 0, $moment - time() );
	}

	/**
	 * Performs the HTTP request with our timeout protected end to end.
	 *
	 * WordPress runs every outgoing request through `http_request_args`,
	 * and security or performance plugins commonly clamp `timeout` there
	 * to a very small value. Because that filter runs after the caller has
	 * built its arguments, a plugin-level 15 second budget can silently
	 * become 3 seconds — which surfaces as "cURL error 28: Operation timed
	 * out after 3002 milliseconds", indistinguishable from a dead
	 * endpoint. We re-assert our own budget last, for our endpoint only,
	 * and record what the transport was finally given so the log can name
	 * the cause instead of guessing.
	 *
	 * @since 1.2.1
	 *
	 * @param string              $url     Endpoint URL.
	 * @param array<string,mixed> $args    Request arguments.
	 * @param int                 $timeout Timeout this plugin requires.
	 *
	 * @return array<string,mixed>|\WP_Error Response or error.
	 */
	private function execute( string $url, array $args, int $timeout ) {
		$this->effective_timeout = 0;
		$this->clamped_timeout   = 0;

		$guard = function ( $parsed_args, $request_url = '' ) use ( $url, $timeout ) {
			if ( ! is_array( $parsed_args ) || $request_url !== $url ) {
				return $parsed_args;
			}

			$requested = isset( $parsed_args['timeout'] ) ? (float) $parsed_args['timeout'] : 0.0;

			if ( $requested > 0 && $requested < $timeout ) {
				$this->clamped_timeout    = (int) ceil( $requested );
				$parsed_args['timeout']   = $timeout;
			}

			return $parsed_args;
		};

		$observer = function ( $response, $context, $transport, $parsed_args, $request_url = '' ) use ( $url ) {
			unset( $response, $transport );

			if ( 'response' === $context && $request_url === $url && is_array( $parsed_args ) ) {
				$this->effective_timeout = (int) ceil( (float) ( $parsed_args['timeout'] ?? 0 ) );
			}
		};

		/**
		 * Filters whether the plugin re-asserts its timeout against other
		 * plugins that shorten outgoing requests.
		 *
		 * @since 1.2.1
		 *
		 * @param bool   $protect Whether to protect the timeout. Default true.
		 * @param string $url     Endpoint URL.
		 */
		$protect = (bool) apply_filters( 'wpep_protect_timeout', true, $url );

		if ( $protect ) {
			add_filter( 'http_request_args', $guard, PHP_INT_MAX, 2 );
		}

		$connect = isset( $args['wpep_connect_timeout'] ) ? (int) $args['wpep_connect_timeout'] : 0;

		$curl = static function ( $handle, $parsed_args, $request_url = '' ) use ( $url, $connect ): void {
			unset( $parsed_args );

			if ( $connect <= 0 || $request_url !== $url || ! function_exists( 'curl_setopt' ) ) {
				return;
			}

			curl_setopt( $handle, CURLOPT_CONNECTTIMEOUT, $connect );
		};

		add_action( 'http_api_debug', $observer, PHP_INT_MAX, 5 );
		add_action( 'http_api_curl', $curl, PHP_INT_MAX, 3 );

		unset( $args['wpep_connect_timeout'] );

		try {
			return wp_remote_post( $url, $args );
		} finally {
			remove_action( 'http_api_curl', $curl, PHP_INT_MAX );
			if ( $protect ) {
				remove_filter( 'http_request_args', $guard, PHP_INT_MAX );
			}

			remove_action( 'http_api_debug', $observer, PHP_INT_MAX );
		}
	}

	/**
	 * Explains a timeout when the budget was not the one we asked for.
	 *
	 * @since 1.2.1
	 *
	 * @param int $timeout Timeout this plugin requested.
	 *
	 * @return string Advice to append to the log message, empty when none applies.
	 */
	private function timeout_advice( int $timeout ): string {
		if ( $this->effective_timeout > 0 && $this->effective_timeout < $timeout ) {
			return ' ' . sprintf(
				/* translators: 1: effective timeout, 2: configured timeout. */
				__( 'Another plugin shortened this request to %1$d s despite the configured %2$d s; that is the cause, not the endpoint.', 'wp-event-publisher' ),
				$this->effective_timeout,
				$timeout
			);
		}

		if ( $this->clamped_timeout > 0 ) {
			return ' ' . sprintf(
				/* translators: 1: timeout another plugin asked for, 2: timeout restored by this plugin. */
				__( 'Another plugin tried to shorten this request to %1$d s; it was restored to %2$d s.', 'wp-event-publisher' ),
				$this->clamped_timeout,
				$timeout
			);
		}

		if ( $timeout < 10 ) {
			return ' ' . __( 'Raise the Webhook Timeout setting: a remote TLS handshake rarely fits into a very short budget.', 'wp-event-publisher' );
		}

		return '';
	}

	/**
	 * Records a request that could not even be attempted.
	 *
	 * @since 1.1.0
	 *
	 * @param Event  $event   Event being delivered.
	 * @param string $site_id Site identifier.
	 * @param string $url     Endpoint URL, may be empty.
	 * @param string $message Reason the request was aborted.
	 *
	 * @return array{success:bool,code:int,message:string,body:string} Delivery result.
	 */
	private function abort( Event $event, string $site_id, string $url, string $message ): array {
		$this->record( $event, $site_id, $url, '', 0, $message, Logger::STATUS_FAILED, $message );

		return array(
			'success' => false,
			'code'    => 0,
			'message' => $message,
			'body'    => '',
		);
	}

	/**
	 * Writes one delivery attempt to the log.
	 *
	 * The request body is stored because it is the evidence of what the
	 * consumer received. Headers are not, because they carry the API
	 * secret — no credential ever reaches the log table.
	 *
	 * @since 1.1.0
	 *
	 * @param Event  $event         Event being delivered.
	 * @param string $site_id       Site identifier.
	 * @param string $url           Endpoint URL.
	 * @param string $raw_body      Raw request body.
	 * @param int    $code          HTTP response code, 0 for transport errors.
	 * @param string $response_body Response body or error message.
	 * @param string $status        Logger STATUS_* constant.
	 * @param string $message       Human readable summary.
	 *
	 * @return void
	 */
	private function record(
		Event $event,
		string $site_id,
		string $url,
		string $raw_body,
		int $code,
		string $response_body,
		string $status,
		string $message = ''
	): void {
		$this->logger->log(
			array(
				'event_id'      => $event->id(),
				'event_type'    => $event->type(),
				'site_id'       => $site_id,
				'post_id'       => $event->post_id(),
				'stage'         => 'webhook.response',
				'attempt'       => $event->attempt(),
				'message'       => $message,
				'request_url'   => $url,
				'payload'       => $raw_body,
				'response_code' => $code,
				'response_body' => $response_body,
				'status'        => $status,
			)
		);
	}
}
