<?php
/**
 * Signed REST routes used by the ML service.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Routes (all require the HMAC signature, see BAP_ML_Auth::verify()):
 *
 *   GET  bahoosh/v2/ml/context
 *   GET  bahoosh/v2/ml/export/customers|orders|products|coupons|behaviors   ?page&per_page&modified_after
 *   GET  bahoosh/v2/ml/export/traffic                             ?days
 *   GET  bahoosh/v2/ml/actions                                    ?since
 *   POST bahoosh/v2/ml/results
 *
 * The service pulls data and pushes results; it never gets a route that
 * executes anything. Execution happens only through BAP_ML_Actions after this
 * site's own policy says so.
 *
 * @since 4.8.0
 */
class BAP_ML_REST {

	const NS = 'bahoosh/v2';

	/**
	 * Hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Registers routes.
	 *
	 * @return void
	 */
	public static function register_routes() {
		$auth = array( 'BAP_ML_Auth', 'verify' );

		register_rest_route( self::NS, '/ml/context', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'context' ), 'permission_callback' => $auth ) );

		register_rest_route(
			self::NS,
			'/ml/export/(?P<entity>customers|orders|products|coupons|behaviors)',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'export' ),
				'permission_callback' => $auth,
				'args'                => array(
					'page'           => array( 'type' => 'integer', 'default' => 1, 'minimum' => 1 ),
					'per_page'       => array( 'type' => 'integer', 'default' => 200, 'minimum' => 1, 'maximum' => BAP_ML_Export::MAX_PER_PAGE ),
					'modified_after' => array( 'type' => 'string', 'default' => '' ),
				),
			)
		);

		register_rest_route(
			self::NS,
			'/ml/export/traffic',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'traffic' ),
				'permission_callback' => $auth,
				'args'                => array( 'days' => array( 'type' => 'integer', 'default' => 180, 'minimum' => 1, 'maximum' => 730 ) ),
			)
		);

		register_rest_route(
			self::NS,
			'/ml/actions',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'actions' ),
				'permission_callback' => $auth,
				'args'                => array( 'since' => array( 'type' => 'string', 'default' => '' ) ),
			)
		);

		register_rest_route( self::NS, '/ml/results', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'results' ), 'permission_callback' => $auth ) );
	}

	/**
	 * GET /ml/context.
	 *
	 * @return WP_REST_Response
	 */
	public static function context() {
		return new WP_REST_Response( BAP_ML_Export::context() );
	}

	/**
	 * GET /ml/export/{entity}.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function export( WP_REST_Request $request ) {
		if ( ! BAP_Commerce_Facts::available() ) {
			return new WP_REST_Response( array( 'error' => 'woocommerce_inactive' ), 409 );
		}
		$entity   = (string) $request['entity'];
		$page     = (int) $request['page'];
		$per_page = (int) $request['per_page'];
		$since    = (string) $request['modified_after'];
		switch ( $entity ) {
			case 'customers':
				$data = BAP_ML_Export::customers( $page, $per_page );
				break;
			case 'orders':
				$data = BAP_ML_Export::orders( $page, $per_page, $since );
				break;
			case 'products':
				$data = BAP_ML_Export::products( $page, $per_page, $since );
				break;
			case 'behaviors':
				$data = BAP_ML_Export::behaviors( $page, $per_page, $since );
				break;
			default:
				$data = BAP_ML_Export::coupons( $page, $per_page, $since );
		}
		return new WP_REST_Response( $data );
	}

	/**
	 * GET /ml/export/traffic.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function traffic( WP_REST_Request $request ) {
		return new WP_REST_Response( BAP_ML_Export::traffic( (int) $request['days'] ) );
	}

	/**
	 * GET /ml/actions.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function actions( WP_REST_Request $request ) {
		return new WP_REST_Response( BAP_ML_Export::actions( (string) $request['since'] ) );
	}

	/**
	 * POST /ml/results: segments, predictions, insights, action plans, measurements.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function results( WP_REST_Request $request ) {
		$body = json_decode( (string) $request->get_body(), true );
		if ( ! is_array( $body ) ) {
			return new WP_REST_Response( array( 'error' => 'invalid_json' ), 400 );
		}
		if ( ! empty( $body['is_synthetic'] ) ) {
			// Numbers from a synthetic dataset must never drive a real shop.
			return new WP_REST_Response( array( 'error' => 'synthetic_results_refused' ), 422 );
		}
		$run_id = (string) ( $body['run_id'] ?? '' );
		if ( ! preg_match( '/^[a-f0-9\-]{36}$/', $run_id ) ) {
			return new WP_REST_Response( array( 'error' => 'invalid_run_id' ), 422 );
		}

		$out = array( 'run_id' => $run_id, 'segments' => 0, 'assignments' => 0, 'actions' => array(), 'results' => 0 );

		if ( isset( $body['segments'] ) && is_array( $body['segments'] ) ) {
			$out['assignments'] = BAP_ML_Store::save_run( $run_id, $body['segments'], (array) ( $body['assignments'] ?? array() ) );
			$out['segments']    = count( $body['segments'] );
			update_option(
				'bap_ml_insights',
				array(
					'run_id'          => $run_id,
					'received_at'     => gmdate( 'c' ),
					'insights'        => BAP_Event_Validator::sanitize_data( (array) ( $body['insights'] ?? array() ) ),
					'recommendations' => BAP_Event_Validator::sanitize_data( (array) ( $body['recommendations'] ?? array() ) ),
					'timing'          => BAP_Event_Validator::sanitize_data( (array) ( $body['timing'] ?? array() ) ),
					'planner'         => BAP_Event_Validator::sanitize_data( (array) ( $body['planner'] ?? array() ) ),
					'model_versions'  => BAP_Event_Validator::sanitize_data( (array) ( $body['model_versions'] ?? array() ) ),
					'notes'           => BAP_Event_Validator::sanitize_data( (array) ( $body['notes'] ?? array() ) ),
				),
				false
			);
		}

		// Actions: normalise, re-validate here, recompute status. The status the
		// service sent is ignored except that a rejection is never upgraded.
		$incoming = array();
		foreach ( (array) ( $body['actions'] ?? array() ) as $raw ) {
			$action = self::normalise_action( $raw, $run_id );
			if ( $action ) {
				$incoming[ $action['action_id'] ] = $action;
			}
		}
		$position = 0;
		foreach ( $incoming as $id => $action ) {
			$decision = BAP_ML_Policy::evaluate( $action, $incoming, $position++ );
			if ( 'rejected_by_policy' === ( $action['sent_status'] ?? '' ) ) {
				$decision = array( 'status' => 'rejected_by_policy', 'violations' => array_merge( (array) ( $action['sent_violations'] ?? array() ), $decision['violations'] ) );
			}
			$action['status'] = $decision['status'];
			$action['policy'] = $decision;
			$inserted         = BAP_ML_Store::insert_action( $action );
			if ( $inserted ) {
				BAP_ML_Store::audit( $id, 'received', array( 'source' => $action['source'], 'status' => $decision['status'], 'violations' => $decision['violations'] ) );
			}
			$out['actions'][] = array( 'action_id' => $id, 'status' => $inserted ? $decision['status'] : 'duplicate_ignored', 'violations' => $decision['violations'] );
		}
		if ( $out['actions'] && ! wp_next_scheduled( BAP_ML_Actions::CRON_EXECUTE ) ) {
			// Executed in cron, not in this request, so a slow WooCommerce save
			// cannot time out the service's call.
			wp_schedule_single_event( time(), BAP_ML_Actions::CRON_EXECUTE );
		}

		foreach ( (array) ( $body['action_results'] ?? array() ) as $res ) {
			$id = (string) ( $res['action_id'] ?? '' );
			if ( preg_match( '/^[a-f0-9\-]{36}$/', $id ) && is_array( $res['metrics'] ?? null ) && BAP_ML_Store::action( $id ) ) {
				BAP_ML_Store::save_result( $id, gmdate( 'Y-m-d H:i:s' ), (array) $res['metrics'] );
				$out['results']++;
			}
		}

		update_option( 'bap_ml_last_results_at', gmdate( 'c' ), false );
		BAP_ML_Store::audit( '', 'results_received', array( 'run_id' => $run_id, 'segments' => $out['segments'], 'actions' => count( $out['actions'] ) ) );
		return new WP_REST_Response( $out );
	}

	/**
	 * Strict normalisation of one incoming action.
	 *
	 * @param mixed  $raw    Raw action.
	 * @param string $run_id Run id.
	 * @return array|null
	 */
	private static function normalise_action( $raw, $run_id ) {
		if ( ! is_array( $raw ) ) {
			return null;
		}
		$id   = (string) ( $raw['action_id'] ?? '' );
		$type = (string) ( $raw['action_type'] ?? '' );
		if ( ! preg_match( '/^[a-f0-9\-]{36}$/', $id ) || ! in_array( $type, BAP_ML_Policy::ACTIONS, true ) ) {
			return null;
		}
		$target = array();
		if ( isset( $raw['target']['segment_key'] ) ) {
			$target['segment_key'] = sanitize_key( (string) $raw['target']['segment_key'] );
		}
		if ( isset( $raw['target']['product_id'] ) ) {
			$target['product_id'] = absint( $raw['target']['product_id'] );
		}
		$params = BAP_Event_Validator::sanitize_data( (array) ( $raw['parameters'] ?? array() ) );
		foreach ( array( 'subject', 'message' ) as $text ) {
			if ( isset( $params[ $text ] ) ) {
				$params[ $text ] = sanitize_textarea_field( (string) $params[ $text ] );
			}
		}
		$reason = array();
		foreach ( array_slice( (array) ( $raw['reason'] ?? array() ), 0, 6 ) as $line ) {
			$reason[] = sanitize_text_field( (string) $line );
		}
		return array(
			'action_id'       => $id,
			'run_id'          => preg_match( '/^[a-f0-9\-]{36}$/', (string) ( $raw['run_id'] ?? '' ) ) ? (string) $raw['run_id'] : $run_id,
			'action_type'     => $type,
			'target'          => $target,
			'parameters'      => $params,
			'reason'          => $reason,
			'confidence'      => isset( $raw['confidence'] ) && is_numeric( $raw['confidence'] ) ? (float) $raw['confidence'] : null,
			'source'          => in_array( $raw['source'] ?? '', array( 'llm', 'rules', 'admin' ), true ) ? $raw['source'] : 'llm',
			'sent_status'     => (string) ( $raw['status'] ?? '' ),
			'sent_violations' => array_map( 'sanitize_text_field', (array) ( $raw['policy']['violations'] ?? array() ) ),
		);
	}
}
