<?php
/**
 * Internal REST API controller.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers the `wp-event-publisher/v1` REST namespace consumed by the
 * Node.js microservice.
 *
 * Endpoints:
 *  - GET  /health  — liveness probe (public).
 *  - POST /test    — triggers a connection test (API key or admin).
 *  - GET  /logs    — paginated log access (API key or admin).
 *  - GET  /status  — plugin/config status snapshot (API key or admin).
 *
 * @since 1.0.0
 */
class Rest {

	/**
	 * REST namespace.
	 *
	 * @var string
	 */
	public const REST_NAMESPACE = 'wp-event-publisher/v1';

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
	 * Webhook client dependency.
	 *
	 * @var Webhook
	 */
	private Webhook $webhook;

	/**
	 * Normalizer dependency.
	 *
	 * @var Normalizer
	 */
	private Normalizer $normalizer;

	/**
	 * Signature service.
	 *
	 * @var Signer
	 */
	private Signer $signer;

	/**
	 * Constructor.
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Added the signer dependency.
	 *
	 * @param Settings   $settings   Settings service.
	 * @param Logger     $logger     Logger service.
	 * @param Webhook    $webhook    Webhook client.
	 * @param Normalizer $normalizer Normalizer service.
	 * @param Signer     $signer     Signature service.
	 */
	public function __construct(
		Settings $settings,
		Logger $logger,
		Webhook $webhook,
		Normalizer $normalizer,
		Signer $signer
	) {
		$this->settings   = $settings;
		$this->logger     = $logger;
		$this->webhook    = $webhook;
		$this->normalizer = $normalizer;
		$this->signer     = $signer;
	}

	/**
	 * Hooks route registration into rest_api_init.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Registers all REST routes.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function register_routes(): void {
		register_rest_route(
			self::REST_NAMESPACE,
			'/health',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'health' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test' ),
				'permission_callback' => array( $this, 'authorize' ),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/logs',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'logs' ),
				'permission_callback' => array( $this, 'authorize' ),
				'args'                => array(
					'page'     => array(
						'type'              => 'integer',
						'default'           => 1,
						'minimum'           => 1,
						'sanitize_callback' => 'absint',
					),
					'per_page' => array(
						'type'              => 'integer',
						'default'           => 20,
						'minimum'           => 1,
						'maximum'           => 100,
						'sanitize_callback' => 'absint',
					),
					'status'     => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_key',
					),
					'stage'      => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'event_id'   => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'event_type' => array(
						'type'              => 'string',
						'default'           => '',
						'enum'              => array( '', 'created', 'updated', 'deleted', 'test', 'sample' ),
						'sanitize_callback' => 'sanitize_key',
					),
					'site_id'    => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'search'   => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'post_id'  => array(
						'type'              => 'integer',
						'default'           => 0,
						'sanitize_callback' => 'absint',
					),
				),
			)
		);

		register_rest_route( self::REST_NAMESPACE, '/bot/capabilities', array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'bot_capabilities' ), 'permission_callback' => array( $this, 'authorize' ) ) );
		register_rest_route( self::REST_NAMESPACE, '/bot/tickets', array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'bot_tickets' ), 'permission_callback' => array( $this, 'authorize' ) ) );
		register_rest_route( self::REST_NAMESPACE, '/bot/ticket/(?P<ticket_id>\d+)', array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'bot_ticket' ), 'permission_callback' => array( $this, 'authorize' ), 'args' => array( 'ticket_id' => array( 'type' => 'integer', 'sanitize_callback' => 'absint' ) ) ) );
		register_rest_route( self::REST_NAMESPACE, '/bot/ticket/reply', array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => array( $this, 'bot_ticket_reply' ), 'permission_callback' => array( $this, 'authorize' ) ) );
		register_rest_route( self::REST_NAMESPACE, '/bot/ticket/status', array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => array( $this, 'bot_ticket_status' ), 'permission_callback' => array( $this, 'authorize' ) ) );
		register_rest_route( self::REST_NAMESPACE, '/bot/announcement', array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => array( $this, 'bot_announcement' ), 'permission_callback' => array( $this, 'authorize' ) ) );
		register_rest_route( self::REST_NAMESPACE, '/bot/product', array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => array( $this, 'bot_product' ), 'permission_callback' => array( $this, 'authorize' ) ) );

		register_rest_route(
			self::REST_NAMESPACE,
			'/status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'status' ),
				'permission_callback' => array( $this, 'authorize' ),
			)
		);
	}

	/**
	 * Permission callback shared by protected routes.
	 *
	 * Three credentials are accepted, in order of preference:
	 *
	 * 1. A logged-in administrator, for the admin screens.
	 * 2. An `X-Signature` / `X-Timestamp` pair verified with the same
	 *    {@see Signer} that signs outgoing webhooks, so the Node.js
	 *    service can authenticate with the credential it already
	 *    implements. Stale timestamps are rejected using the configured
	 *    tolerance.
	 * 3. An `X-API-Key` header matching the configured secret.
	 *
	 * Both secret comparisons are timing-safe.
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Added HMAC signature authentication.
	 *
	 * @param WP_REST_Request $request Request instance.
	 *
	 * @return bool|WP_Error True when authorized.
	 */
	public function authorize( WP_REST_Request $request ): bool|WP_Error {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}

		$secret = (string) $this->settings->get( 'api_secret' );

		if ( '' === $secret ) {
			return new WP_Error(
				'wpep_unauthorized',
				__( 'No API secret is configured on this site.', 'wp-event-publisher' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}

		$signature = (string) $request->get_header( 'X-Signature' );
		$timestamp = (string) $request->get_header( 'X-Timestamp' );

		if ( '' !== $signature && '' !== $timestamp ) {
			if ( ! $this->signer->is_fresh( $timestamp, $this->settings->signature_tolerance() ) ) {
				return new WP_Error(
					'wpep_stale_request',
					__( 'The request timestamp is outside the allowed tolerance window.', 'wp-event-publisher' ),
					array( 'status' => rest_authorization_required_code() )
				);
			}

			if ( $this->signer->verify( $signature, $timestamp, (string) $request->get_body(), $secret ) ) {
				return true;
			}

			return new WP_Error(
				'wpep_invalid_signature',
				__( 'The request signature could not be verified.', 'wp-event-publisher' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}

		$provided = (string) $request->get_header( 'X-API-Key' );

		if ( '' !== $provided && hash_equals( $secret, $provided ) ) {
			return true;
		}

		return new WP_Error(
			'wpep_unauthorized',
			__( 'Invalid or missing API key.', 'wp-event-publisher' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	public function bot_capabilities( WP_REST_Request $request ): WP_REST_Response {
		$ticket_settings = wpep()->tickets()->ticket_bot_settings();
		return new WP_REST_Response( array(
			'success' => true,
			'features' => array(
				'ticket_reply' => array( 'enabled' => ! empty( $ticket_settings['enabled'] ), 'platforms' => array_values( (array) $ticket_settings['platforms'] ) ),
				'announcement_create' => true,
				'product_create' => class_exists( '\\WooCommerce' ) || function_exists( 'wc_get_product' ),
			),
		), 200 );
	}

	public function bot_tickets( WP_REST_Request $request ): WP_REST_Response {
		$status = sanitize_key( (string) $request->get_param( 'status' ) );
		$limit = min( 50, max( 1, absint( $request->get_param( 'limit' ) ?: 20 ) ) );
		$args = array( 'post_type' => Tickets::POST_TYPE, 'post_status' => array( 'publish', 'draft', 'pending' ), 'posts_per_page' => $limit, 'orderby' => 'modified', 'order' => 'DESC' );
		if ( in_array( $status, array( 'waiting', 'reviewing', 'answered', 'closed' ), true ) ) { $args['meta_query'] = array( array( 'key' => '_jarchi_ticket_status', 'value' => $status ) ); }
		$query = new \WP_Query( $args ); $tickets = array();
		foreach ( $query->posts as $ticket ) {
			$terms = wp_get_post_terms( $ticket->ID, Tickets::TAXONOMY ); $cats = wp_get_post_terms( $ticket->ID, Tickets::CATEGORY );
			$tickets[] = array( 'id' => (int) $ticket->ID, 'number' => (int) $ticket->ID, 'subject' => $ticket->post_title, 'status' => wpep()->tickets()->canonical_status_public( wpep()->tickets()->status( $ticket->ID ) ), 'department' => ! empty( $terms ) && ! is_wp_error( $terms ) ? $terms[0]->name : '', 'category' => ! empty( $cats ) && ! is_wp_error( $cats ) ? $cats[0]->name : '', 'url' => add_query_arg( array( 'jarchi_ticket' => $ticket->ID ), wpep()->tickets()->ticket_page_url() ) );
		}
		return new WP_REST_Response( array( 'success' => true, 'tickets' => $tickets ), 200 );
	}

	public function bot_ticket( WP_REST_Request $request ): WP_REST_Response {
		$ticket_id = absint( $request['ticket_id'] );
		$ticket = get_post( $ticket_id );
		if ( ! $ticket || Tickets::POST_TYPE !== $ticket->post_type ) { return new WP_REST_Response( array( 'success' => false, 'message' => __( 'تیکت پیدا نشد.', 'wp-event-publisher' ) ), 404 ); }
		$messages = array();
		foreach ( wpep()->tickets()->messages( $ticket_id ) as $message ) {
			$messages[] = array(
				'id' => (int) $message->comment_ID,
				'sender' => (string) get_comment_meta( $message->comment_ID, '_jarchi_ticket_sender', true ),
				'author' => get_comment_author( $message ),
				'date' => get_comment_date( 'c', $message ),
				'body' => wp_strip_all_tags( $message->comment_content ),
			);
		}
		return new WP_REST_Response( array( 'success' => true, 'ticket' => array( 'id' => $ticket_id, 'number' => $ticket_id, 'subject' => $ticket->post_title, 'status' => wpep()->tickets()->canonical_status_public( wpep()->tickets()->status( $ticket_id ) ), 'messages' => $messages ) ), 200 );
	}

	public function bot_ticket_reply( WP_REST_Request $request ): WP_REST_Response {
		$source = sanitize_key( (string) $request->get_param( 'source' ) );
		if ( ! in_array( $source, array( 'telegram', 'bale' ), true ) || ! wpep()->tickets()->bot_source_allowed( $source ) ) { return new WP_REST_Response( array( 'success' => false, 'message' => __( 'پاسخ‌گویی ربات برای این پلتفرم فعال نیست.', 'wp-event-publisher' ) ), 403 ); }
		$result = wpep()->tickets()->reply_from_remote( absint( $request->get_param( 'ticket_id' ) ), (string) $request->get_param( 'message' ), $source, sanitize_text_field( (string) $request->get_param( 'agent_name' ) ) );
		if ( is_wp_error( $result ) ) { return new WP_REST_Response( array( 'success' => false, 'message' => $result->get_error_message() ), 400 ); }
		return new WP_REST_Response( array( 'success' => true, 'comment_id' => (int) $result ), 200 );
	}

	public function bot_ticket_status( WP_REST_Request $request ): WP_REST_Response {
		$source = sanitize_key( (string) $request->get_param( 'source' ) );
		if ( ! in_array( $source, array( 'telegram', 'bale' ), true ) || ! wpep()->tickets()->bot_source_allowed( $source ) ) { return new WP_REST_Response( array( 'success' => false, 'message' => __( 'پاسخ‌گویی ربات برای این پلتفرم فعال نیست.', 'wp-event-publisher' ) ), 403 ); }
		$result = wpep()->tickets()->set_status_from_remote( absint( $request->get_param( 'ticket_id' ) ), sanitize_key( (string) $request->get_param( 'status' ) ) );
		if ( is_wp_error( $result ) ) { return new WP_REST_Response( array( 'success' => false, 'message' => $result->get_error_message() ), 400 ); }
		return new WP_REST_Response( array( 'success' => true, 'status' => $result ), 200 );
	}

	public function bot_announcement( WP_REST_Request $request ): WP_REST_Response {
		$title = sanitize_text_field( (string) $request->get_param( 'title' ) ); $content = wp_kses_post( (string) $request->get_param( 'content' ) );
		if ( '' === $title || '' === trim( wp_strip_all_tags( $content ) ) ) { return new WP_REST_Response( array( 'success' => false, 'message' => 'title and content are required' ), 400 ); }
		$id = wp_insert_post( array( 'post_type' => Announcements::POST_TYPE, 'post_status' => 'publish', 'post_title' => $title, 'post_content' => $content, 'post_author' => get_current_user_id() ?: 1 ), true );
		if ( is_wp_error( $id ) ) { return new WP_REST_Response( array( 'success' => false, 'message' => $id->get_error_message() ), 400 ); }
		$placement = sanitize_key( (string) $request->get_param( 'placement' ) );
		if ( $placement && class_exists( AnnouncementPlacements::class ) && array_key_exists( $placement, AnnouncementPlacements::all() ) ) { update_post_meta( $id, AnnouncementPlacements::META_PLACEMENT, $placement ); }
		if ( filter_var( $request->get_param( 'homepage' ), FILTER_VALIDATE_BOOLEAN ) ) { update_post_meta( $id, AnnouncementPlacements::META_CONDITIONS, array( 'match' => 'all', 'rules' => array( array( 'subject' => 'is_front_page', 'operator' => 'equals', 'value' => 'yes' ) ) ) ); }
		return new WP_REST_Response( array( 'success' => true, 'id' => (int) $id, 'url' => get_permalink( $id ) ), 201 );
	}

	public function bot_product( WP_REST_Request $request ): WP_REST_Response {
		if ( ! class_exists( '\WooCommerce' ) || ! function_exists( 'wc_get_product' ) ) { return new WP_REST_Response( array( 'success' => false, 'message' => 'WooCommerce is not active.' ), 503 ); }
		$name = sanitize_text_field( (string) $request->get_param( 'name' ) ); $description = wp_kses_post( (string) $request->get_param( 'description' ) );
		if ( '' === $name ) { return new WP_REST_Response( array( 'success' => false, 'message' => 'name is required' ), 400 ); }
		$product = new \WC_Product_Simple(); $product->set_name( $name ); $product->set_description( $description );
		$status = (string) $request->get_param( 'status' ); $product->set_status( in_array( $status, array( 'publish', 'draft', 'pending' ), true ) ? $status : 'draft' );
		$sku = sanitize_text_field( (string) $request->get_param( 'sku' ) ); if ( $sku ) { $product->set_sku( $sku ); }
		$price = (string) $request->get_param( 'price' ); if ( '' !== $price && is_numeric( $price ) ) { $product->set_regular_price( $price ); }
		$id = $product->save(); return new WP_REST_Response( array( 'success' => true, 'id' => (int) $id, 'url' => get_permalink( $id ) ), 201 );
	}

	/**
	 * GET /health — liveness probe.
	 *
	 * Intentionally public and free of sensitive data so load balancers
	 * and the Node.js service can poll it cheaply.
	 *
	 * @since 1.0.0
	 *
	 * @return WP_REST_Response Health payload.
	 */
	public function health(): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'status'   => 'ok',
				'plugin'   => 'wp-event-publisher',
				'version'  => WPEP_VERSION,
				'contract' => Contract::VERSION,
				'time'     => $this->signer->timestamp(),
			),
			200
		);
	}

	/**
	 * POST /test — executes a connection test against the Node endpoint.
	 *
	 * @since 1.0.0
	 *
	 * @return WP_REST_Response Test result.
	 */
	public function test(): WP_REST_Response {
		$result = $this->webhook->test_connection();

		return new WP_REST_Response(
			array(
				'success' => $result['success'],
				'code'    => $result['code'],
				'message' => $result['message'],
			),
			$result['success'] ? 200 : 502
		);
	}

	/**
	 * GET /logs — paginated, filterable log access.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_REST_Request $request Request instance.
	 *
	 * @return WP_REST_Response Log collection.
	 */
	public function logs( WP_REST_Request $request ): WP_REST_Response {
		$result = $this->logger->query(
			array(
				'page'       => (int) $request->get_param( 'page' ),
				'per_page'   => (int) $request->get_param( 'per_page' ),
				'status'     => (string) $request->get_param( 'status' ),
				'stage'      => (string) $request->get_param( 'stage' ),
				'search'     => (string) $request->get_param( 'search' ),
				'event_id'   => (string) $request->get_param( 'event_id' ),
				'event_type' => (string) $request->get_param( 'event_type' ),
				'site_id'    => (string) $request->get_param( 'site_id' ),
				'post_id'    => (int) $request->get_param( 'post_id' ),
			)
		);

		$response = new WP_REST_Response( $result['items'], 200 );
		$response->header( 'X-WP-Total', (string) $result['total'] );
		$response->header( 'X-WP-TotalPages', (string) $result['pages'] );

		return $response;
	}

	/**
	 * GET /status — configuration and statistics snapshot.
	 *
	 * The API secret itself is never exposed; only its presence.
	 *
	 * @since 1.0.0
	 *
	 * @return WP_REST_Response Status payload.
	 */
	public function status(): WP_REST_Response {
		$settings = $this->settings->all();

		return new WP_REST_Response(
			array(
				'plugin_version'        => WPEP_VERSION,
				'contract_version'      => Contract::VERSION,
				'wordpress_version'     => get_bloginfo( 'version' ),
				'php_version'           => PHP_VERSION,
				'site_id'               => $this->settings->site_id(),
				'site_url'              => home_url(),
				'signature_algorithm'   => Signer::ALGORITHM,
				'signature_tolerance'   => $this->settings->signature_tolerance(),
				'event_types'           => array( Event::TYPE_CREATED, Event::TYPE_UPDATED, Event::TYPE_DELETED ),
				'enabled'               => (bool) $settings['enabled'],
				'webhooks_enabled'      => (bool) $settings['webhooks_enabled'],
				'logging_enabled'       => (bool) $settings['logging_enabled'],
				'endpoint_configured'   => '' !== (string) $settings['node_api_url'],
				'secret_configured'     => '' !== (string) $settings['api_secret'],
				'allowed_post_types'    => (array) $settings['allowed_post_types'],
				'allowed_post_statuses' => (array) $settings['allowed_post_statuses'],
				'allowed_event_types'   => $this->settings->allowed_event_types(),
				'dispatch_mode'         => $this->settings->dispatch_mode(),
				'debug_mode'            => (bool) $settings['debug_mode'],
				'cron_enabled'          => $this->settings->cron_available(),
				'queue_size'            => wpep()->event_store()->count_pending(),
				'stats'                 => $this->logger->stats(),
			),
			200
		);
	}
}
