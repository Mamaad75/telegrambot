<?php
/**
 * REST routes.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * The plugin's server-side API surface.
 *
 * Routes:
 *   POST bahoosh/v2/events        Ingest proxy (public, rate limited).
 *   POST bahoosh/v2/identity/link Anonymous → authenticated merge.
 *   GET  bahoosh/v2/dashboard     Admin metrics proxy.
 *   GET  bahoosh/v2/status        Admin diagnostics.
 *
 * The ingest proxy exists so the collector's secret API key never reaches a
 * browser. Version 1 shipped that key to every visitor via `wp_localize_script`
 * and again as a query parameter on `sendBeacon` URLs; anyone could read it
 * from page source and write arbitrary analytics data.
 */
class BAP_REST_Controller {

	const NAMESPACE_V2 = 'bahoosh/v2';

	const INGEST_LIMIT  = 120; // Requests per window.
	const INGEST_WINDOW = 60;  // Window length in seconds.
	const LINK_LIMIT    = 10;
	const LINK_WINDOW   = 300;

	/**
	 * Registers hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Registers the routes.
	 *
	 * @return void
	 */
	public static function register_routes() {
		register_rest_route(
			self::NAMESPACE_V2,
			'/events',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle_events' ),
				// Deliberately open: anonymous visitors must be able to post.
				// Protection is rate limiting, origin checking and validation.
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/identity/link',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle_identity_link' ),
				'permission_callback' => array( __CLASS__, 'can_link_identity' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/dashboard',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_dashboard' ),
				'permission_callback' => array( __CLASS__, 'can_view_reports' ),
				'args'                => array(
					'range' => array(
						'type'    => 'string',
						'default' => 'last_7_days',
					),
					'from'  => array( 'type' => 'string' ),
					'to'    => array( 'type' => 'string' ),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/status',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_status' ),
				'permission_callback' => array( __CLASS__, 'can_view_reports' ),
			)
		);


		register_rest_route(
			self::NAMESPACE_V2,
			'/experience',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_experience' ),
				'permission_callback' => array( __CLASS__, 'can_view_reports' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/explore',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_explore' ),
				'permission_callback' => array( __CLASS__, 'can_view_reports' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/journeys',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_journeys' ),
				'permission_callback' => array( __CLASS__, 'can_view_reports' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/funnels',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'handle_funnels_list' ),
					'permission_callback' => array( __CLASS__, 'can_view_reports' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'handle_funnel_save' ),
					'permission_callback' => array( __CLASS__, 'can_manage_settings' ),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/funnels/(?P<id>[A-Za-z0-9_\-]+)',
			array(
				'methods'             => 'DELETE',
				'callback'            => array( __CLASS__, 'handle_funnel_delete' ),
				'permission_callback' => array( __CLASS__, 'can_manage_settings' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/funnels/(?P<id>[A-Za-z0-9_\-]+)/report',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_funnel_report' ),
				'permission_callback' => array( __CLASS__, 'can_view_reports' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/workspace/dashboard',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'handle_dashboard_layout' ),
					'permission_callback' => array( __CLASS__, 'can_view_reports' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'handle_dashboard_layout_save' ),
					'permission_callback' => array( __CLASS__, 'can_manage_settings' ),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/ai/recommendations',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_ai_recommendations' ),
				'permission_callback' => array( __CLASS__, 'can_view_reports' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/ai/analyze',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle_ai_analyze' ),
				'permission_callback' => array( __CLASS__, 'can_manage_settings' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/ai/provider/test',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle_ai_provider_test' ),
				'permission_callback' => array( __CLASS__, 'can_manage_settings' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/ai/agent/log',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'handle_agent_log' ),
				'permission_callback' => array( __CLASS__, 'can_view_reports' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/ai/agent/revert/(?P<id>[A-Za-z0-9_\-]+)',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle_agent_revert' ),
				'permission_callback' => array( __CLASS__, 'can_manage_settings' ),
			)
		);

		register_rest_route(
			self::NAMESPACE_V2,
			'/ai/recommendations/(?P<id>[A-Za-z0-9_\-]+)/decision',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle_ai_decision' ),
				'permission_callback' => array( __CLASS__, 'can_manage_settings' ),
			)
		);

		// There was a public `/ai/callback` route here for the external analysis
		// service to post signed results back to. That service is gone: the
		// analysis now runs inside WordPress. An unauthenticated route kept for
		// a caller that no longer exists is attack surface with no upside, so it
		// was removed rather than left dormant.
	}

	// ---------- Permissions ----------

	/**
	 * Only administrators may read reports.
	 *
	 * @return bool|WP_Error
	 */
	public static function can_view_reports() {
		if ( ! current_user_can( BAP_Admin::reports_capability() ) ) {
			return new WP_Error(
				'bap_forbidden',
				__( 'اجازه مشاهده گزارش‌های تحلیلی را ندارید.', 'bahoosh-analytics-pro' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}
		return true;
	}

	/**
	 * Capability required for definitions and AI decisions.
	 *
	 * @return bool|WP_Error
	 */
	public static function can_manage_settings() {
		if ( ! current_user_can( BAP_Admin::settings_capability() ) ) {
			return new WP_Error(
				'bap_forbidden',
				__( 'اجازه تغییر تنظیمات باهوش را ندارید.', 'bahoosh-analytics-pro' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}
		return true;
	}

	/**
	 * Identity linking requires an authenticated WordPress session.
	 *
	 * The REST cookie handler already validates the `X-WP-Nonce` header before
	 * this runs, so `is_user_logged_in()` here means a genuine, CSRF-checked
	 * session rather than a stray cookie.
	 *
	 * @return bool|WP_Error
	 */
	public static function can_link_identity() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'bap_not_logged_in',
				__( 'Identity linking requires an authenticated session.', 'bahoosh-analytics-pro' ),
				array( 'status' => 401 )
			);
		}
		return true;
	}

	// ---------- Ingest ----------

	/**
	 * Accepts one event and forwards it to the collector.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_events( WP_REST_Request $request ) {
		// Order matters: everything that can reject a request without reading
		// its body comes first, so a flood cannot buy free JSON parsing.
		$limit = BAP_Rate_Limiter::check( 'ingest', self::INGEST_LIMIT, self::INGEST_WINDOW );
		if ( ! $limit['allowed'] ) {
			$response = new WP_REST_Response(
				array(
					'success' => false,
					'error'   => 'rate_limited',
				),
				429
			);
			$response->header( 'Retry-After', (int) $limit['retry_after'] );
			return $response;
		}

		if ( ! self::origin_is_acceptable( $request ) ) {
			return new WP_REST_Response(
				array(
					'success' => false,
					'error'   => 'invalid_origin',
				),
				403
			);
		}

		// There used to be a `not_configured` rejection here, returning 503 with
		// `retryable: true` whenever no collector URL was set. It was the single
		// reason a site without a collector measured nothing at all: every event
		// bounced, every browser kept retrying, the queue never drained, and the
		// dashboard read `——` forever. The plugin has its own store now, so a
		// missing collector is not a reason to refuse an event — only a reason
		// not to forward it, which is decided further down.

		if ( ! BAP_Settings::tracking_enabled() ) {
			return self::settled_response( 'rejected', 'tracking_disabled', 202 );
		}

		// Consent is re-checked here, not just in the browser. A page cached
		// before a visitor withdrew consent still carries a tracker that
		// believes it may collect; the server sees the current cookie and is
		// the authority. The event is answered as settled so the client clears
		// what it will never be allowed to send.
		if ( ! BAP_Consent::allows_analytics() ) {
			BAP_Debug_Log::log( 'consent', 'Event refused: analytics consent withheld' );
			return self::settled_response( 'rejected', 'consent_withheld', 202 );
		}

		$body = self::decode_body( $request );
		if ( null === $body ) {
			return new WP_REST_Response(
				array(
					'status'    => 'rejected',
					'error'     => 'invalid_json',
					'retryable' => false,
				),
				400
			);
		}

		$identity_context = self::resolve_identity_context( $request, $body );

		$event = BAP_Event_Validator::validate_event(
			$body,
			array(
				'site_id'                 => BAP_Settings::resolved_site_id(),
				'wp_user_id'              => $identity_context['wp_user_id'],
				'woocommerce_customer_id' => $identity_context['woocommerce_customer_id'],
				'ip'                      => BAP_Event_Factory::client_ip(),
				'origin'                  => 'browser',
			)
		);

		if ( isset( $event['__error'] ) ) {
			// Malformed beyond repair. 422 and `retryable: false` together tell
			// the client to stop: repeating this request cannot produce a
			// different answer, and a client that kept trying would never drain.
			return new WP_REST_Response(
				array(
					'status'    => 'rejected',
					'error'     => (string) $event['__error'],
					'retryable' => false,
				),
				422
			);
		}

		// Recorded locally before forwarding, and deliberately not conditional on
		// delivery succeeding. The rollup is a counter, not a copy of the event:
		// if the collector is unreachable the shop's own funnel should still be
		// measurable, and a bucket that was incremented for an event which is
		// later retried is off by one on a number in the thousands.
		BAP_Rollup::observe( $event );

		// The full row, which is what makes the dashboard work without a
		// collector. Duplicate ids are rejected by the table's unique key, so a
		// retry cannot inflate anything.
		BAP_Local_Store::record( $event );

		// With no collector configured there is nothing to forward to, and this
		// is a settled outcome rather than a failure. Answering 502 here — as
		// this route used to — told every browser to keep the event and retry
		// forever, so a site without a collector recorded nothing at all and
		// every dashboard card stayed empty. The event is stored; the client is
		// told so; it moves on.
		if ( ! BAP_Settings::is_configured() ) {
			return self::settled_response( 'ذخیره‌شده', '', 200 );
		}

		$result = BAP_Transport::send_event( $event );

		if ( empty( $result['ok'] ) ) {
			// Not acknowledged, so the client keeps the event and retries with
			// the same id. The upstream status is mirrored so its retry policy
			// can tell a transient failure from a permanent one.
			$status   = ! empty( $result['retryable'] ) ? 503 : ( $result['status'] ? (int) $result['status'] : 502 );
			$response = new WP_REST_Response(
				array(
					'status'    => 'error',
					'error'     => 'upstream_error',
					'upstream'  => (int) $result['status'],
					'retryable' => ! empty( $result['retryable'] ),
				),
				$status
			);
			if ( ! empty( $result['retry_after'] ) ) {
				$response->header( 'Retry-After', (int) $result['retry_after'] );
			}
			BAP_Logger::warn( 'ingest proxy upstream failure: ' . $result['error'] );
			return $response;
		}

		$settlement = isset( $result['settlement'] ) ? (string) $result['settlement'] : 'ذخیره‌شده';

		return self::settled_response( $settlement, '', 200 );
	}

	/**
	 * The v3 single-event answer.
	 *
	 * Three settled values only — `stored`, `duplicate`, `rejected` — because
	 * the client's rule is simply "settled means delete". Anything ambiguous
	 * must be an error status instead, so the event stays queued.
	 *
	 * @param string $status Settlement: stored|duplicate|rejected.
	 * @param string $reason Machine-readable reason, for rejections.
	 * @param int    $code   HTTP status.
	 * @return WP_REST_Response
	 */
	private static function settled_response( $status, $reason = '', $code = 200 ) {
		$payload = array(
			'status'         => $status,
			'schema_version' => BAP_SCHEMA_VERSION,
		);

		if ( 'rejected' === $status ) {
			$payload['retryable'] = false;
		}
		if ( '' !== $reason ) {
			$payload['reason'] = $reason;
		}

		return new WP_REST_Response( $payload, $code );
	}

	/**
	 * Reads the request body, tolerating the `text/plain` content type that
	 * `navigator.sendBeacon` must use to stay a CORS-simple request.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return array|null
	 */
	private static function decode_body( WP_REST_Request $request ) {
		$params = $request->get_json_params();
		if ( is_array( $params ) && ! empty( $params ) ) {
			return $params;
		}

		$raw = $request->get_body();
		if ( ! is_string( $raw ) || '' === $raw ) {
			return null;
		}

		$decoded = json_decode( $raw, true );
		return is_array( $decoded ) ? $decoded : null;
	}

	/**
	 * Rejects cross-site posts.
	 *
	 * The route accepts anonymous requests, so the only cheap signal available
	 * is the browser-set `Origin` header. A missing origin is allowed —
	 * `sendBeacon` on same-origin navigations may omit it — but a *present*
	 * foreign origin is refused.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return bool
	 */
	private static function origin_is_acceptable( WP_REST_Request $request ) {
		$origin = $request->get_header( 'origin' );
		if ( empty( $origin ) ) {
			return true;
		}

		$allowed = array( untrailingslashit( home_url() ), untrailingslashit( site_url() ) );

		/**
		 * Filters origins accepted by the ingest proxy, for multi-domain setups.
		 *
		 * @param string[] $allowed Allowed origins.
		 */
		$allowed = apply_filters( 'bap_allowed_origins', $allowed );

		$normalized = untrailingslashit( strtolower( $origin ) );
		foreach ( $allowed as $candidate ) {
			if ( strtolower( (string) $candidate ) === $normalized ) {
				return true;
			}
		}

		// Compare hosts too, so http/https and www differences do not lock a
		// legitimate site out of its own analytics.
		$origin_host = wp_parse_url( $origin, PHP_URL_HOST );
		$home_host   = wp_parse_url( home_url(), PHP_URL_HOST );
		return $origin_host && $home_host && strtolower( $origin_host ) === strtolower( $home_host );
	}

	/**
	 * Determines the authenticated identity for an ingest request.
	 *
	 * Two sources, both server-authoritative:
	 *   1. A live WordPress session (REST cookie auth with a valid nonce).
	 *   2. The signed identity token minted while rendering the page, which
	 *      survives `sendBeacon` and cached-nonce edge cases.
	 *
	 * A `wp_user_id` present in the request body is ignored entirely.
	 *
	 * @param WP_REST_Request $request Request.
	 * @param array           $body    Decoded body.
	 * @return array{wp_user_id:int,woocommerce_customer_id:int,source:string}
	 */
	private static function resolve_identity_context( WP_REST_Request $request, array $body ) {
		$current = get_current_user_id();
		if ( $current > 0 ) {
			return array(
				'wp_user_id'              => (int) $current,
				'woocommerce_customer_id' => BAP_Identity::woocommerce_customer_id(),
				'source'                  => 'session',
			);
		}

		$token = $request->get_header( 'x-bap-identity' );
		if ( empty( $token ) && isset( $body['identity_token'] ) ) {
			$token = $body['identity_token'];
		}

		if ( ! empty( $token ) ) {
			$anonymous_id = self::first_anonymous_id( $body );
			$claims       = BAP_Identity_Token::verify( $token, $anonymous_id );
			if ( $claims ) {
				return array(
					'wp_user_id'              => $claims['wp_user_id'],
					'woocommerce_customer_id' => $claims['woocommerce_customer_id'],
					'source'                  => 'token',
				);
			}
		}

		return array(
			'wp_user_id'              => 0,
			'woocommerce_customer_id' => 0,
			'source'                  => 'anonymous',
		);
	}

	/**
	 * Extracts the anonymous id an event claims, for token binding.
	 *
	 * @param array $body Decoded body.
	 * @return string
	 */
	private static function first_anonymous_id( array $body ) {
		if ( isset( $body['identity']['anonymous_id'] ) ) {
			return (string) $body['identity']['anonymous_id'];
		}
		return '';
	}

	// ---------- Identity linking ----------

	/**
	 * Links an anonymous id to the logged-in WordPress user.
	 *
	 * The caller supplies only the anonymous id; who they are is read from the
	 * authenticated session, so no client can attach its history to somebody
	 * else's account.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_identity_link( WP_REST_Request $request ) {
		$limit = BAP_Rate_Limiter::check( 'identity_link', self::LINK_LIMIT, self::LINK_WINDOW );
		if ( ! $limit['allowed'] ) {
			$response = new WP_REST_Response(
				array(
					'success' => false,
					'error'   => 'rate_limited',
				),
				429
			);
			$response->header( 'Retry-After', (int) $limit['retry_after'] );
			return $response;
		}

		$body         = self::decode_body( $request );
		$anonymous_id = is_array( $body ) && isset( $body['anonymous_id'] ) ? $body['anonymous_id'] : '';

		if ( ! BAP_Identity::is_valid_anonymous_id( $anonymous_id ) ) {
			return new WP_REST_Response(
				array(
					'success' => false,
					'error'   => 'invalid_anonymous_id',
				),
				400
			);
		}

		$user_id = get_current_user_id();

		$payload = array(
			'schema_version' => BAP_SCHEMA_VERSION,
			'site_id'        => BAP_Settings::get( 'site_id' ),
			'anonymous_id'   => $anonymous_id,
			'identity'       => BAP_Identity::payload(
				array(
					'anonymous_id' => $anonymous_id,
					'wp_user_id'   => $user_id,
				)
			),
			'linked_at'      => gmdate( 'Y-m-d\TH:i:s.v\Z' ),
			// Merging must not clone history. The collector is expected to
			// re-point identity rows, never to copy events.
			'merge_strategy' => 'link_only',
		);

		$result = BAP_Transport::link_identity( $payload );

		if ( empty( $result['ok'] ) ) {
			BAP_Logger::warn( 'identity link failed: ' . $result['error'] );
			return new WP_REST_Response(
				array(
					'success'  => false,
					'error'    => 'upstream_error',
					'upstream' => (int) $result['status'],
				),
				! empty( $result['retryable'] ) ? 503 : 502
			);
		}

		/**
		 * Fires after an anonymous identity is linked to a WordPress user.
		 *
		 * @param string $anonymous_id Anonymous id.
		 * @param int    $user_id      WordPress user id.
		 */
		do_action( 'bap_identity_linked', $anonymous_id, $user_id );

		BAP_Debug_Log::log(
			'identity',
			'Anonymous identity linked to a WordPress user',
			array(
				'anonymous_id' => BAP_Debug_Log::mask( $anonymous_id ),
				'wp_user_id'   => $user_id,
			)
		);

		return new WP_REST_Response(
			array(
				'success'      => true,
				'anonymous_id' => $anonymous_id,
				'wp_user_id'   => $user_id,
				'linked_at'    => $payload['linked_at'],
			),
			200
		);
	}

	// ---------- Reporting ----------

	/**
	 * Proxies dashboard metrics.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_dashboard( WP_REST_Request $request ) {
		$range = BAP_Reports::normalize_range(
			$request->get_param( 'range' ),
			$request->get_param( 'from' ),
			$request->get_param( 'to' )
		);

		$previous = BAP_Reports::previous_period( $range['from'], $range['to'] );
		$compare  = 'true' !== $request->get_param( 'skip_compare' );

		$metrics    = null;
		$comparison = null;
		$source     = 'local';
		$upstream   = '';

		// The collector is tried first when one is configured, because a central
		// service sees things a single site cannot — the same visitor on two
		// devices, retention beyond this site's own window, heavier modelling.
		// When there is no collector, or it does not answer, the site's own data
		// answers instead. Either way the shape is identical and the response
		// says which one produced it.
		if ( BAP_Settings::is_configured() ) {
			$result = BAP_Transport::dashboard(
				array(
					'range' => $range['range'],
					'from'  => $range['from'],
					'to'    => $range['to'],
				)
			);

			if ( ! empty( $result['ok'] ) ) {
				$metrics = BAP_Reports::normalize_metrics( $result['body'] );
				$source  = 'collector';

				// Period-over-period comparison is a second real query against
				// the same endpoint — never an estimate. A failure here degrades
				// to "no comparison" rather than failing the whole request.
				if ( $compare ) {
					$previous_result = BAP_Transport::dashboard(
						array(
							'range' => 'custom',
							'from'  => $previous['from'],
							'to'    => $previous['to'],
						)
					);

					if ( ! empty( $previous_result['ok'] ) ) {
						$comparison = array(
							'range'  => $previous,
							'deltas' => BAP_Reports::compare( $metrics, BAP_Reports::normalize_metrics( $previous_result['body'] ) ),
						);
					}
				}
			} else {
				$upstream = (string) $result['error'];
				BAP_Logger::warn( 'dashboard falling back to local data: ' . $upstream );
			}
		}

		if ( null === $metrics ) {
			$metrics = BAP_Local_Reports::metrics( $range['from'], $range['to'] );
			$source  = 'local';

			if ( $compare ) {
				$comparison = array(
					'range'  => $previous,
					'deltas' => BAP_Reports::compare( $metrics, BAP_Local_Reports::metrics( $previous['from'], $previous['to'] ) ),
				);
			}
		}

		return new WP_REST_Response(
			array(
				'success'        => true,
				'range'          => $range,
				'metrics'        => $metrics,
				'comparison'     => $comparison,
				// Stated explicitly so the dashboard never has to guess whether
				// an empty series means "no traffic" or "not supported".
				'has_timeseries' => ! empty( $metrics['timeseries'] ),
				'source'         => $source,
				'collecting_since' => BAP_Local_Store::first_day(),
				'upstream_error' => $upstream,
			),
			200
		);
	}

	/**
	 * Experience analytics, from the collector when there is one.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_experience( WP_REST_Request $request ) {
		$range = BAP_Reports::normalize_range( $request->get_param( 'range' ), $request->get_param( 'from' ), $request->get_param( 'to' ) );
		$query = array(
			'from'   => $range['from'],
			'to'     => $range['to'],
			'url'    => substr( sanitize_text_field( (string) $request->get_param( 'url' ) ), 0, 1024 ),
			'device' => sanitize_key( (string) $request->get_param( 'device' ) ),
		);

		return self::report_with_local_fallback(
			BAP_Settings::is_configured() ? BAP_Transport::get( 'reports/experience', array_filter( $query ) ) : null,
			static function () use ( $range ) {
				return BAP_Local_Reports::experience( $range['from'], $range['to'] );
			},
			$range
		);
	}

	/**
	 * Everything recorded in a window, itemised.
	 *
	 * Always answered from the site's own store. Unlike the metric cards there
	 * is no collector equivalent to prefer: this is the raw record of what this
	 * installation saw, which is exactly the thing an administrator opens when
	 * they want to check that tracking is working at all.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_explore( WP_REST_Request $request ) {
		$range = BAP_Reports::normalize_range( $request->get_param( 'range' ), $request->get_param( 'from' ), $request->get_param( 'to' ) );

		return new WP_REST_Response(
			array_merge(
				array(
					'success'          => true,
					'range'            => $range,
					'collecting_since' => BAP_Local_Store::first_day(),
					'stored_events'    => BAP_Local_Store::size(),
				),
				BAP_Local_Reports::explorer( $range['from'], $range['to'] )
			),
			200
		);
	}

	/**
	 * Journey analytics, from the collector when there is one.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function handle_journeys( WP_REST_Request $request ) {
		$range = BAP_Reports::normalize_range( $request->get_param( 'range' ), $request->get_param( 'from' ), $request->get_param( 'to' ) );

		$upstream = null;

		if ( BAP_Settings::is_configured() ) {
			$upstream = BAP_Transport::get(
				'reports/journeys',
				array(
					'from'       => $range['from'],
					'to'         => $range['to'],
					'entry'      => substr( sanitize_text_field( (string) $request->get_param( 'entry' ) ), 0, 512 ),
					'conversion' => sanitize_key( (string) $request->get_param( 'conversion' ) ),
				)
			);
		}

		return self::report_with_local_fallback(
			$upstream,
			static function () use ( $range ) {
				return BAP_Local_Reports::journeys( $range['from'], $range['to'] );
			},
			$range
		);
	}

	/**
	 * Returns a collector report, or the site's own answer when there is none.
	 *
	 * The three studio reports all had the same shape of bug: with no collector
	 * they returned an error and the screen showed a permanent "the backend does
	 * not provide this yet" message, even though the site had the data to answer
	 * the question itself.
	 *
	 * @param array|null $upstream Collector result, or null when not attempted.
	 * @param callable   $local    Produces the local answer.
	 * @param array      $range    Normalised range.
	 * @return WP_REST_Response
	 */
	private static function report_with_local_fallback( $upstream, callable $local, array $range ) {
		if ( is_array( $upstream ) && ! empty( $upstream['ok'] ) ) {
			$body = is_array( $upstream['body'] ) ? $upstream['body'] : array();

			return new WP_REST_Response(
				array_merge( array( 'success' => true, 'range' => $range, 'source' => 'collector' ), $body ),
				200
			);
		}

		$payload = call_user_func( $local );

		return new WP_REST_Response(
			array_merge(
				array(
					'success'          => true,
					'range'            => $range,
					'collecting_since' => BAP_Local_Store::first_day(),
					'upstream_error'   => is_array( $upstream ) ? (string) $upstream['error'] : '',
				),
				is_array( $payload ) ? $payload : array()
			),
			200
		);
	}

	/** Returns local funnel definitions. */
	public static function handle_funnels_list() {
		return new WP_REST_Response( array( 'success' => true, 'funnels' => BAP_Workspace::funnels() ), 200 );
	}

	/** Saves a local funnel definition. */
	public static function handle_funnel_save( WP_REST_Request $request ) {
		$body = $request->get_json_params();
		$body = is_array( $body ) ? $body : array();
		$funnel = BAP_Workspace::upsert_funnel( $body );
		if ( is_wp_error( $funnel ) ) {
			return new WP_REST_Response( array( 'success' => false, 'error' => $funnel->get_error_code(), 'message' => $funnel->get_error_message() ), 422 );
		}
		return new WP_REST_Response( array( 'success' => true, 'funnel' => $funnel ), 200 );
	}

	/** Deletes a local funnel definition. */
	public static function handle_funnel_delete( WP_REST_Request $request ) {
		$deleted = BAP_Workspace::delete_funnel( $request['id'] );
		return new WP_REST_Response( array( 'success' => (bool) $deleted ), $deleted ? 200 : 404 );
	}

	/** Requests one funnel report, from the collector or from the local rollup. */
	public static function handle_funnel_report( WP_REST_Request $request ) {
		$range = BAP_Reports::normalize_range( $request->get_param( 'range' ), $request->get_param( 'from' ), $request->get_param( 'to' ) );

		// `standard` is the shop's built-in purchase funnel — view, cart,
		// checkout, payment, purchase — which is what the rollup counts and what
		// the funnel screen asks for. It is not a saved definition and never
		// needs to be created, so it is answered directly.
		if ( 'standard' === (string) $request['id'] ) {
			return new WP_REST_Response(
				array_merge(
					array(
						'success'          => true,
						'range'            => $range,
						'collecting_since' => BAP_Local_Store::first_day(),
						// The same funnel broken down by product, which is the
						// level a shop owner can act on.
						'products'         => BAP_Local_Reports::product_funnel( $range['from'], $range['to'] )['products'],
					),
					BAP_Local_Reports::funnel( $range['from'], $range['to'] )
				),
				200
			);
		}

		$funnel = BAP_Workspace::funnel( $request['id'] );
		if ( ! $funnel ) {
			return new WP_REST_Response( array( 'success' => false, 'error' => 'not_found' ), 404 );
		}

		$upstream = null;

		if ( BAP_Settings::is_configured() ) {
			$upstream = BAP_Transport::request(
				'reports/funnel',
				array(
					'site_id' => BAP_Settings::get( 'site_id' ),
					'from'    => $range['from'],
					'to'      => $range['to'],
					'funnel'  => $funnel,
				)
			);
		}

		return self::report_with_local_fallback(
			$upstream,
			static function () use ( $range, $funnel ) {
				// The local answer is the shop's standard commerce funnel, which
				// is the one the rollup counts. A custom funnel over arbitrary
				// events is a collector feature; saying so is better than
				// returning the wrong funnel under the right name.
				return array_merge(
					BAP_Local_Reports::funnel( $range['from'], $range['to'] ),
					array( 'funnel' => $funnel, 'standard_funnel' => true )
				);
			},
			$range
		);
	}

	/** Returns global dashboard layout preferences. */
	public static function handle_dashboard_layout() {
		return new WP_REST_Response( array( 'success' => true, 'layout' => BAP_Workspace::dashboard() ), 200 );
	}

	/** Saves global dashboard layout preferences. */
	public static function handle_dashboard_layout_save( WP_REST_Request $request ) {
		$body = $request->get_json_params();
		$body = is_array( $body ) ? $body : array();
		$layout = BAP_Workspace::update_dashboard( $body );
		return new WP_REST_Response( array( 'success' => true, 'layout' => $layout ), 200 );
	}

	/** Returns locally cached AI recommendations and opportunistically syncs backend output. */
	public static function handle_ai_recommendations() {
		if ( BAP_Settings::get( 'ai_enabled' ) ) {
			$remote = BAP_Transport::get( 'ai/recommendations', array( 'status' => 'pending' ) );
			if ( ! empty( $remote['ok'] ) && isset( $remote['body']['recommendations'] ) && is_array( $remote['body']['recommendations'] ) ) {
				BAP_AI::ingest( array( 'recommendations' => $remote['body']['recommendations'] ) );
			}
		}
		return new WP_REST_Response(
			array(
				'success'         => true,
				'enabled'         => (bool) BAP_Settings::get( 'ai_enabled' ),
				'autonomy'        => BAP_Settings::get( 'ai_autonomy' ),
				'min_confidence'  => (int) BAP_Settings::get( 'ai_min_confidence', 80 ),
				'recommendations' => BAP_AI::recommendations(),
				'action_catalog'  => BAP_AI::action_catalog(),
				'audit'           => BAP_AI::audit_log( 30 ),
				'provider'        => BAP_AI_Provider::current(),
				'agent'           => array(
					'mode'         => BAP_Commerce_Agent::mode(),
					'enabled'      => BAP_Commerce_Agent::enabled(),
					'max_discount' => BAP_Commerce_Agent::max_discount(),
					'log'          => BAP_Commerce_Agent::history( 50 ),
				),
				'sources'         => array(
					'woocommerce' => BAP_Commerce_Facts::available(),
					'ga4'         => BAP_GA4::status(),
					'clarity'     => BAP_Clarity::status(),
				),
				'workspace'       => array(
					'alerts'      => BAP_Workspace::alerts(),
					'annotations' => BAP_Workspace::annotations(),
				),
			),
			200
		);
	}

	/**
	 * Runs an analysis, start to finish, inside WordPress.
	 *
	 * This used to hand the work to an external service. It no longer does:
	 * the facts are computed here from WooCommerce and the local rollup, the
	 * model is whatever the site owner configured (a Llama on this machine by
	 * default), and the recommendations are validated and stored here. The site
	 * is not dependent on anything it does not run.
	 */
	public static function handle_ai_analyze( WP_REST_Request $request ) {
		if ( ! BAP_Settings::get( 'ai_enabled' ) ) {
			return new WP_REST_Response( array( 'success' => false, 'error' => 'ai_disabled' ), 409 );
		}

		$body  = $request->get_json_params();
		$body  = is_array( $body ) ? $body : array();
		$range = BAP_Reports::normalize_range(
			isset( $body['range'] ) ? $body['range'] : 'last_7_days',
			isset( $body['from'] ) ? $body['from'] : '',
			isset( $body['to'] ) ? $body['to'] : ''
		);
		$focus = isset( $body['focus'] ) ? sanitize_key( $body['focus'] ) : 'revenue';
		if ( ! in_array( $focus, array( 'growth', 'conversion', 'ux', 'retention', 'revenue', 'performance' ), true ) ) {
			$focus = 'revenue';
		}

		// Cached: the facts are expensive to compute and cheap to reuse for a few
		// minutes, and a model call is slow enough that an admin will click
		// again while waiting.
		$packet = BAP_Analysis_Packet::cached( $range['from'], $range['to'], $focus );
		$result = BAP_AI_Provider::analyze( $packet );

		if ( ! empty( $result['recommendations'] ) ) {
			BAP_AI::ingest( array( 'recommendations' => $result['recommendations'] ) );
		}

		return new WP_REST_Response(
			array(
				'success'         => (bool) $result['ok'],
				'provider'        => $result['provider'],
				// True when a model was configured but could not answer and the
				// rule engine stood in. Surfaced rather than hidden: an admin
				// reading advice deserves to know what produced it.
				'fallback'        => ! empty( $result['fallback'] ),
				'error'           => $result['error'],
				'recommendations' => BAP_AI::recommendations(),
				'agent'           => array(
					'mode'    => BAP_Commerce_Agent::mode(),
					'enabled' => BAP_Commerce_Agent::enabled(),
				),
				// The facts themselves, so the Studio can show an administrator
				// exactly what the model was given. Every recommendation cites
				// ids from this list and nothing else.
				'packet'          => array(
					'run_id'       => $packet['run_id'],
					'period'       => $packet['period'],
					'data_quality' => $packet['data_quality'],
					'facts'        => $packet['facts'],
				),
			),
			$result['ok'] ? 200 : 422
		);
	}

	/** Checks that the configured model server answers. */
	public static function handle_ai_provider_test( WP_REST_Request $request ) {
		$probe = BAP_AI_Provider::probe();

		return new WP_REST_Response(
			array(
				'success'  => ! empty( $probe['ok'] ),
				'provider' => BAP_AI_Provider::current(),
				'endpoint' => BAP_AI_Provider::base_url(),
				'model'    => BAP_AI_Provider::model(),
				'models'   => $probe['models'],
				'note'     => isset( $probe['note'] ) ? $probe['note'] : '',
				'error'    => $probe['error'],
			),
			200
		);
	}

	/** Lists the changes the agent has made to the shop. */
	public static function handle_agent_log( WP_REST_Request $request ) {
		return new WP_REST_Response(
			array(
				'success' => true,
				'mode'    => BAP_Commerce_Agent::mode(),
				'enabled' => BAP_Commerce_Agent::enabled(),
				'max_discount' => BAP_Commerce_Agent::max_discount(),
				'entries' => BAP_Commerce_Agent::history( 50 ),
			),
			200
		);
	}

	/** Undoes one agent change. */
	public static function handle_agent_revert( WP_REST_Request $request ) {
		$result = BAP_Commerce_Agent::revert( $request['id'] );

		if ( is_wp_error( $result ) ) {
			return new WP_REST_Response(
				array( 'success' => false, 'error' => $result->get_error_code(), 'message' => $result->get_error_message() ),
				422
			);
		}

		return new WP_REST_Response( array( 'success' => true, 'entries' => BAP_Commerce_Agent::history( 50 ) ), 200 );
	}

	/**
	 * Applies an administrator's decision on a recommendation.
	 *
	 * When the recommendation carries an action and the agent is on, this is
	 * the click that changes the shop. The decision is recorded and applied
	 * locally; there is nobody else to tell.
	 */
	public static function handle_ai_decision( WP_REST_Request $request ) {
		$body     = $request->get_json_params();
		$body     = is_array( $body ) ? $body : array();
		$decision = isset( $body['decision'] ) ? sanitize_key( $body['decision'] ) : '';
		$execute  = ! isset( $body['execute'] ) || (bool) $body['execute'];
		$item     = BAP_AI::decide( $request['id'], $decision, $execute );
		if ( is_wp_error( $item ) ) {
			return new WP_REST_Response( array( 'success' => false, 'error' => $item->get_error_code(), 'message' => $item->get_error_message() ), 422 );
		}
		return new WP_REST_Response(
			array(
				'success'        => true,
				'recommendation' => $item,
				'agent_log'      => BAP_Commerce_Agent::history( 50 ),
			),
			200
		);
	}

	/** Normalises an authenticated backend result for admin report routes. */
	private static function proxy_report_result( array $result ) {
		if ( empty( $result['ok'] ) ) {
			return new WP_REST_Response(
				array(
					'success'  => false,
					'error'    => 'upstream_error',
					'message'  => isset( $result['error'] ) ? $result['error'] : '',
					'upstream' => isset( $result['status'] ) ? (int) $result['status'] : 0,
				),
				! empty( $result['retryable'] ) ? 503 : 502
			);
		}
		$body = isset( $result['body'] ) && is_array( $result['body'] ) ? $result['body'] : array();
		$body['success'] = true;
		return new WP_REST_Response( $body, 200 );
	}

	/**
	 * Local diagnostics: configuration state and outbox health.
	 *
	 * @return WP_REST_Response
	 */
	public static function handle_status() {
		return new WP_REST_Response(
			array(
				'success'        => true,
				'version'        => BAP_VERSION,
				'schema_version' => BAP_SCHEMA_VERSION,
				'configured'     => BAP_Settings::is_configured(),
				'has_api_key'    => '' !== BAP_Settings::get_api_key(),
				'transport_mode' => BAP_Settings::get( 'transport_mode' ),
				'woocommerce'    => BAP_WooCommerce::is_active(),
				'modules'        => array(
					'experience' => (bool) BAP_Settings::get( 'module_experience' ),
					'funnels'    => (bool) BAP_Settings::get( 'module_funnels' ),
					'journeys'   => (bool) BAP_Settings::get( 'module_journeys' ),
					'ai'         => (bool) BAP_Settings::get( 'module_ai' ),
				),
				'ai'             => array(
					'enabled'            => (bool) BAP_Settings::get( 'ai_enabled' ),
					'autonomy'           => BAP_Settings::get( 'ai_autonomy' ),
					'min_confidence'     => (int) BAP_Settings::get( 'ai_min_confidence' ),
					'webhook_configured' => '' !== BAP_Settings::get_ai_webhook_secret(),
				),
				'outbox'         => BAP_Outbox::stats(),
			),
			200
		);
	}
}
