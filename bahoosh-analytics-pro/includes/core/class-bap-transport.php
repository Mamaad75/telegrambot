<?php
/**
 * HTTP client for the Bahoosh collector.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Sends batches to the collector and normalises the acknowledgement.
 *
 * This is the only place the secret API key is used, and it never leaves the
 * server: the browser talks to the WordPress REST proxy, the proxy talks to
 * the collector through this class.
 */
class BAP_Transport {

	// ---------- v2 backend compatibility ----------

	/**
	 * Sends one v3 event to a collector that still speaks v2.
	 *
	 * TEMPORARY. This whole section exists because the plugin was refactored to
	 * the v3 model before the collector was. The tracker now posts single
	 * events with a `page_view_id` and no session; the deployed collector still
	 * expects a batch envelope and still rejects any event without a
	 * `session_id`. Rather than hold the plugin back, the translation happens
	 * here — in one place, on the server, where it can be deleted in a single
	 * commit.
	 *
	 * **What removes this:** the collector's own v3 refactor. When
	 * `POST /events` accepts a single v3 event, delete `send_event()`,
	 * `to_v2_batch()` and `synthetic_session_id()`, and have the REST
	 * controller call `request( 'events', $event )` directly.
	 *
	 * @param array $event One validated v3 event envelope.
	 * @return array Normalised result, already reduced to a single-event answer.
	 */
	public static function send_event( array $event ) {
		$result = self::request( 'events', self::to_v2_batch( $event ) );

		// The v2 collector answers per batch; the v3 client expects an answer
		// about one event. With exactly one event in the batch the reduction is
		// unambiguous.
		$ack = isset( $result['ack'] ) && is_array( $result['ack'] ) ? $result['ack'] : array();
		$id  = isset( $event['event_id'] ) ? (string) $event['event_id'] : '';

		if ( ! empty( $result['ok'] ) ) {
			$duplicates = isset( $ack['duplicate_event_ids'] ) ? (array) $ack['duplicate_event_ids'] : array();
			$rejected   = isset( $ack['rejected_events'] ) ? (array) $ack['rejected_events'] : array();

			if ( in_array( $id, $duplicates, true ) || ( empty( $duplicates ) && ! empty( $ack['duplicates'] ) ) ) {
				$result['settlement'] = 'duplicate';
			} elseif ( ! empty( $rejected ) ) {
				$result['settlement'] = 'rejected';
			} else {
				$result['settlement'] = 'ذخیره‌شده';
			}
		} else {
			$result['settlement'] = self::is_retryable( isset( $result['status'] ) ? (int) $result['status'] : 0 )
				? 'retry'
				: 'rejected';
		}

		return $result;
	}

	/**
	 * Wraps one v3 event in the v2 batch envelope the deployed collector wants.
	 *
	 * @param array $event One v3 event.
	 * @return array A one-event v2 batch.
	 */
	private static function to_v2_batch( array $event ) {
		$legacy = $event;

		// The v2 collector rejects an event with no session. Deriving the
		// synthetic id from `page_view_id` rather than minting a random one per
		// request means every event of one page view still groups together
		// upstream — the closest thing to correct that the old schema can
		// express, and stable across retries because the input is.
		$legacy['session'] = array(
			'session_id' => self::synthetic_session_id( $event ),
		);

		unset( $legacy['page_view_id'] );

		return array(
			'schema_version' => 2,
			'batch_id'       => 'batch_' . substr( md5( (string) $event['event_id'] ), 0, 24 ),
			'site_id'        => isset( $event['site_id'] ) ? $event['site_id'] : BAP_Settings::get( 'site_id' ),
			'sent_at'        => gmdate( 'Y-m-d\TH:i:s.v\Z' ),
			'transport'      => 'wordpress',
			'events'         => array( $legacy ),
		);
	}

	/**
	 * Builds the session id the v2 collector still demands.
	 *
	 * Deterministic on `page_view_id`, so a retry of the same event presents the
	 * same session and the collector's own grouping stays stable.
	 *
	 * @param array $event One v3 event.
	 * @return string
	 */
	private static function synthetic_session_id( array $event ) {
		$seed = isset( $event['page_view_id'] ) && '' !== $event['page_view_id']
			? (string) $event['page_view_id']
			: (string) ( isset( $event['event_id'] ) ? $event['event_id'] : wp_generate_uuid4() );

		return 'sess_' . substr( hash( 'sha256', $seed ), 0, 32 );
	}

	// ---------- End of v2 compatibility ----------

	/**
	 * Requests an identity link.
	 *
	 * @param array $payload Link payload.
	 * @return array
	 */
	public static function link_identity( array $payload ) {
		return self::request( 'identity/link', $payload );
	}

	/**
	 * Fetches dashboard metrics.
	 *
	 * @param array $query Query arguments.
	 * @return array
	 */
	public static function dashboard( array $query ) {
		$endpoint = BAP_Settings::endpoint( 'dashboard' );
		if ( '' === $endpoint ) {
			return self::error_result( 'not_configured', __( 'Collector URL is not configured.', 'bahoosh-analytics-pro' ) );
		}

		$query['site_id'] = BAP_Settings::get( 'site_id' );
		$url              = add_query_arg( array_map( 'rawurlencode', $query ), $endpoint );

		$response = wp_remote_get(
			$url,
			array(
				'timeout'     => 20,
				'redirection' => 2,
				'headers'     => self::headers(),
			)
		);

		return self::normalize( $response, null );
	}

	/**
	 * Performs an authenticated GET request against the collector.
	 *
	 * @param string $path  Path relative to the API root.
	 * @param array  $query Query parameters. site_id is always server-owned.
	 * @return array
	 */
	public static function get( $path, array $query = array() ) {
		$endpoint = BAP_Settings::endpoint( $path );
		if ( '' === $endpoint ) {
			return self::error_result( 'not_configured', __( 'Collector URL is not configured.', 'bahoosh-analytics-pro' ) );
		}

		$query['site_id'] = BAP_Settings::get( 'site_id' );
		$url = add_query_arg( $query, $endpoint );
		$response = wp_remote_get(
			$url,
			array(
				'timeout'     => 25,
				'redirection' => 2,
				'headers'     => self::headers(),
			)
		);

		return self::normalize( $response, null );
	}

	/**
	 * Performs a POST request against the collector.
	 *
	 * @param string $path    Path relative to the API root.
	 * @param array  $payload JSON body.
	 * @return array
	 */
	public static function request( $path, array $payload ) {
		$endpoint = BAP_Settings::endpoint( $path );
		if ( '' === $endpoint ) {
			return self::error_result( 'not_configured', __( 'Collector URL is not configured.', 'bahoosh-analytics-pro' ) );
		}

		$body = wp_json_encode( $payload );
		if ( false === $body ) {
			return self::error_result( 'encode_failed', __( 'Could not encode payload.', 'bahoosh-analytics-pro' ) );
		}

		$timeout = max( 1, (int) round( BAP_Settings::get( 'request_timeout_ms', 15000 ) / 1000 ) );

		$response = wp_remote_post(
			$endpoint,
			array(
				'timeout'     => $timeout,
				'redirection' => 2,
				'blocking'    => true,
				'headers'     => array_merge(
					self::headers(),
					array( 'Content-Type' => 'application/json; charset=utf-8' )
				),
				'body'        => $body,
			)
		);

		$result = self::normalize( $response, $payload );

		// Remembered so Diagnostics can report real reachability rather than
		// only what an explicit test button produced.
		update_option(
			'bap_last_transport_result',
			array(
				'ok'     => ! empty( $result['ok'] ),
				'status' => (int) $result['status'],
				'error'  => substr( (string) $result['error'], 0, 300 ),
				'at'     => time(),
			),
			false
		);

		BAP_Debug_Log::log(
			'api',
			sprintf( 'POST %s → %s', $path, $result['ok'] ? 'ok' : 'failed' ),
			array(
				'status'     => $result['status'],
				'retryable'  => ! empty( $result['retryable'] ),
				'error'      => isset( $result['error'] ) ? $result['error'] : '',
				'accepted'   => isset( $result['ack']['accepted'] ) ? $result['ack']['accepted'] : null,
				'duplicates' => isset( $result['ack']['duplicates'] ) ? $result['ack']['duplicates'] : null,
			)
		);

		return $result;
	}

	/**
	 * Authentication and identification headers.
	 *
	 * @return array
	 */
	private static function headers() {
		$headers = array(
			'Accept'               => 'application/json',
			'X-BAP-Site-Id'        => (string) BAP_Settings::get( 'site_id' ),
			'X-BAP-Schema-Version' => (string) BAP_SCHEMA_VERSION,
			'X-BAP-Plugin-Version' => BAP_VERSION,
		);

		$key = BAP_Settings::get_api_key();
		if ( '' !== $key ) {
			$headers['X-Api-Key'] = $key;   // v1 header, still honoured by the collector.
			$headers['X-BAP-Key'] = $key;   // v2 header.
		}

		return $headers;
	}

	/**
	 * Converts a WP_Http response into the shape the outbox expects.
	 *
	 * @param array|WP_Error $response Raw response.
	 * @param array|null     $payload  Request payload, used to infer ids.
	 * @return array
	 */
	private static function normalize( $response, $payload ) {
		if ( is_wp_error( $response ) ) {
			// Includes timeouts. The caller must retry — the collector may or
			// may not have processed the batch, and only event_id idempotency
			// can settle that.
			return array(
				'ok'            => false,
				'status'        => 0,
				'network_error' => true,
				'retryable'     => true,
				'error'         => $response->get_error_message(),
				'ack'           => null,
			);
		}

		$status  = (int) wp_remote_retrieve_response_code( $response );
		$raw     = wp_remote_retrieve_body( $response );
		$decoded = json_decode( $raw, true );
		$ok      = $status >= 200 && $status < 300;

		$retry_after = 0;
		$header      = wp_remote_retrieve_header( $response, 'retry-after' );
		if ( $header ) {
			$retry_after = is_numeric( $header )
				? (int) $header
				: max( 0, strtotime( $header ) - time() );
		}

		return array(
			'ok'            => $ok,
			'status'        => $status,
			'network_error' => false,
			'retryable'     => self::is_retryable( $status ),
			'retry_after'   => $retry_after,
			'error'         => $ok ? '' : self::extract_error( $decoded, $raw ),
			'body'          => is_array( $decoded ) ? $decoded : null,
			'ack'           => $ok ? self::parse_ack( $decoded, $payload ) : null,
		);
	}

	/**
	 * Whether a status code warrants a retry.
	 *
	 * @param int $status HTTP status.
	 * @return bool
	 */
	public static function is_retryable( $status ) {
		if ( 0 === $status ) {
			return true;
		}
		if ( in_array( $status, array( 408, 425, 429 ), true ) ) {
			return true;
		}
		if ( $status >= 500 ) {
			return true;
		}
		return false;
	}

	/**
	 * Normalises the acknowledgement body.
	 *
	 * A 2xx without a parseable body is treated as full acceptance so a v1-era
	 * collector (which answered `{"received": n}`) keeps working.
	 *
	 * @param array|null $decoded Decoded body.
	 * @param array|null $payload Request payload.
	 * @return array
	 */
	public static function parse_ack( $decoded, $payload ) {
		$sent_ids = array();
		if ( is_array( $payload ) && ! empty( $payload['events'] ) && is_array( $payload['events'] ) ) {
			foreach ( $payload['events'] as $event ) {
				if ( isset( $event['event_id'] ) ) {
					$sent_ids[] = $event['event_id'];
				}
			}
		}

		if ( ! is_array( $decoded ) ) {
			return array(
				'success'             => true,
				'inferred'            => true,
				'accepted'            => count( $sent_ids ),
				'duplicates'          => 0,
				'rejected'            => 0,
				'event_ids'           => $sent_ids,
				'duplicate_event_ids' => array(),
				'rejected_events'     => array(),
			);
		}

		$named = isset( $decoded['event_ids'] ) && is_array( $decoded['event_ids'] );
		// Counts-only acknowledgement: without ids we cannot tell which events
		// landed, so the whole batch is treated as settled. Safe, because a
		// re-send would be deduplicated anyway.
		$event_ids = $named ? $decoded['event_ids'] : $sent_ids;

		$duplicates = isset( $decoded['duplicate_event_ids'] ) && is_array( $decoded['duplicate_event_ids'] )
			? $decoded['duplicate_event_ids']
			: array();

		$rejected = isset( $decoded['rejected_events'] ) && is_array( $decoded['rejected_events'] )
			? $decoded['rejected_events']
			: array();

		return array(
			'success'             => ! isset( $decoded['success'] ) || false !== $decoded['success'],
			'inferred'            => ! $named,
			'accepted'            => isset( $decoded['accepted'] ) ? (int) $decoded['accepted'] : count( $event_ids ),
			'duplicates'          => isset( $decoded['duplicates'] ) ? (int) $decoded['duplicates'] : count( $duplicates ),
			'rejected'            => isset( $decoded['rejected'] ) ? (int) $decoded['rejected'] : count( $rejected ),
			'event_ids'           => $event_ids,
			'duplicate_event_ids' => $duplicates,
			'rejected_events'     => $rejected,
		);
	}

	/**
	 * Pulls a human-readable error out of a failure response.
	 *
	 * @param array|null $decoded Decoded body.
	 * @param string     $raw     Raw body.
	 * @return string
	 */
	private static function extract_error( $decoded, $raw ) {
		if ( is_array( $decoded ) ) {
			foreach ( array( 'error', 'message', 'title', 'detail' ) as $key ) {
				if ( ! empty( $decoded[ $key ] ) && is_string( $decoded[ $key ] ) ) {
					return $decoded[ $key ];
				}
			}
		}
		return substr( (string) $raw, 0, 300 );
	}

	/**
	 * Builds a local error result.
	 *
	 * @param string $code    Error code.
	 * @param string $message Message.
	 * @return array
	 */
	private static function error_result( $code, $message ) {
		return array(
			'ok'            => false,
			'status'        => 0,
			'network_error' => false,
			'retryable'     => false,
			'error'         => $message,
			'code'          => $code,
			'ack'           => null,
		);
	}
}
