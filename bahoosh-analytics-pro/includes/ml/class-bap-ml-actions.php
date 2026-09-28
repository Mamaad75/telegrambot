<?php
/**
 * Executes validated ML actions against WooCommerce, with rollback.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * The only place in the ML layer that writes to the shop.
 *
 * Path of every action:
 *   LLM -> schema (ML service) -> policy (ML service) -> BAP_ML_Policy::evaluate()
 *   -> permission check -> human approval (unless the policy allows auto)
 *   -> execute() -> audit log -> result tracking by the ML service.
 *
 * Execution re-checks the policy at run time: a setting that allowed an action
 * when it was proposed is not the setting that matters when it runs.
 *
 * Nothing here deletes anything. Coupons are expired, sale prices restored,
 * segments unpublished — the same rules as BAP_Commerce_Agent.
 *
 * @since 4.8.0
 */
class BAP_ML_Actions {

	const CRON_SEND     = 'bap_ml_send_campaign';
	const CRON_EXECUTE  = 'bap_ml_execute_auto';
	const SEND_BATCH    = 40;
	const OPTION_PUBLISHED = 'bap_ml_published_segments';
	const OPTION_UNSUB     = 'bap_ml_unsubscribed';
	const META_ACTION      = '_bap_ml_action_id';

	/**
	 * Hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::CRON_SEND, array( __CLASS__, 'send_campaign_batch' ) );
		add_action( self::CRON_EXECUTE, array( __CLASS__, 'execute_auto_approved' ) );
		add_action( 'template_redirect', array( __CLASS__, 'handle_tracking_links' ) );
	}

	/**
	 * Deterministic control group. Identical to bahoosh_ml.security.in_holdout().
	 *
	 * @param string $action_id    Action id.
	 * @param string $customer_key Customer key.
	 * @param int    $percent      Holdout percent.
	 * @return bool
	 */
	public static function in_holdout( $action_id, $customer_key, $percent ) {
		if ( $percent <= 0 ) {
			return false;
		}
		$digest = hash( 'sha256', $action_id . ':' . $customer_key );
		return ( hexdec( substr( $digest, 0, 8 ) ) % 100 ) < (int) $percent;
	}

	/**
	 * Runs every auto-approved action (cron, right after results arrive).
	 *
	 * @return void
	 */
	public static function execute_auto_approved() {
		foreach ( BAP_ML_Store::actions( array( 'status' => 'auto_approved', 'limit' => 50 ) ) as $action ) {
			self::execute( $action['action_id'], true );
		}
	}

	/**
	 * Human approval: permission check, then execution.
	 *
	 * @param string $action_id Id.
	 * @return array|WP_Error
	 */
	public static function approve( $action_id ) {
		$action = BAP_ML_Store::action( $action_id );
		if ( ! $action ) {
			return new WP_Error( 'bap_ml_missing', __( 'اقدام پیدا نشد.', 'bahoosh-analytics-pro' ) );
		}
		if ( ! current_user_can( BAP_ML_Policy::capability_for( $action['action_type'] ) ) ) {
			return new WP_Error( 'bap_ml_forbidden', __( 'اجازه تأیید این نوع اقدام را ندارید.', 'bahoosh-analytics-pro' ) );
		}
		if ( ! BAP_ML_Store::transition( $action_id, array( 'pending_approval', 'auto_approved' ), 'approved' ) ) {
			return new WP_Error( 'bap_ml_state', __( 'این اقدام در وضعیتی نیست که قابل تأیید باشد.', 'bahoosh-analytics-pro' ) );
		}
		BAP_ML_Store::update_action( $action_id, array( 'approved_at' => BAP_ML_Store::now(), 'approved_by' => get_current_user_id() ) );
		BAP_ML_Store::audit( $action_id, 'approved' );
		return self::execute( $action_id, false );
	}

	/**
	 * Human rejection.
	 *
	 * @param string $action_id Id.
	 * @return true|WP_Error
	 */
	public static function reject( $action_id ) {
		if ( ! BAP_ML_Store::transition( $action_id, array( 'pending_approval', 'auto_approved', 'recommendation_only' ), 'rejected' ) ) {
			return new WP_Error( 'bap_ml_state', __( 'این اقدام قابل رد کردن نیست.', 'bahoosh-analytics-pro' ) );
		}
		BAP_ML_Store::audit( $action_id, 'rejected' );
		return true;
	}

	/**
	 * Executes an approved (or policy-auto-approved) action.
	 *
	 * @param string $action_id Id.
	 * @param bool   $automatic Whether no human approved it.
	 * @return array|WP_Error
	 */
	public static function execute( $action_id, $automatic ) {
		$action = BAP_ML_Store::action( $action_id );
		if ( ! $action ) {
			return new WP_Error( 'bap_ml_missing', 'missing action' );
		}

		// Re-check the policy now. Only an admin approval may override an
		// "auto" flag that has since been turned off, never a rejection.
		$check = BAP_ML_Policy::evaluate( $action );
		if ( 'rejected_by_policy' === $check['status'] || 'recommendation_only' === $check['status'] ) {
			BAP_ML_Store::update_action( $action_id, array( 'status' => 'rejected_by_policy', 'policy' => $check ) );
			BAP_ML_Store::audit( $action_id, 'blocked_at_execution', $check );
			return new WP_Error( 'bap_ml_policy', implode( '; ', $check['violations'] ) ?: 'not executable' );
		}
		if ( $automatic && 'auto_approved' !== $check['status'] ) {
			BAP_ML_Store::update_action( $action_id, array( 'status' => 'pending_approval', 'policy' => $check ) );
			return new WP_Error( 'bap_ml_needs_approval', 'policy no longer allows automatic execution' );
		}
		if ( empty( BAP_ML_Policy::get()['execution_enabled'] ) ) {
			return new WP_Error( 'bap_ml_paused', __( 'اجرای اقدام‌ها در تنظیمات متوقف شده است.', 'bahoosh-analytics-pro' ) );
		}

		$from = $automatic ? array( 'auto_approved' ) : array( 'approved' );
		if ( ! BAP_ML_Store::transition( $action_id, $from, 'executing' ) ) {
			return new WP_Error( 'bap_ml_state', 'action is not in an executable state' );
		}

		$handlers = array(
			'create_customer_segment'   => 'do_publish_segment',
			'create_coupon_for_segment' => 'do_segment_coupon',
			'create_product_coupon'     => 'do_product_coupon',
			'update_sale_price'         => 'do_sale_price',
			'create_campaign'           => 'do_create_campaign',
			'schedule_campaign'         => 'do_schedule_campaign',
			'send_campaign'             => 'do_send_campaign',
		);

		try {
			$outcome = call_user_func( array( __CLASS__, $handlers[ $action['action_type'] ] ), $action );
		} catch ( Throwable $e ) {
			$outcome = new WP_Error( 'bap_ml_exception', $e->getMessage() );
		}

		if ( is_wp_error( $outcome ) ) {
			BAP_ML_Store::update_action( $action_id, array( 'status' => 'failed', 'error' => $outcome->get_error_message() ) );
			BAP_ML_Store::audit( $action_id, 'failed', array( 'error' => $outcome->get_error_message() ) );
			return $outcome;
		}

		$status = $outcome['status'] ?? 'executed';
		BAP_ML_Store::update_action(
			$action_id,
			array(
				'status'      => $status,
				'executed_at' => 'executed' === $status ? BAP_ML_Store::now() : null,
				'result'      => $outcome['result'] ?? array(),
				'rollback'    => $outcome['rollback'] ?? array(),
				'error'       => null,
			)
		);
		BAP_ML_Store::audit( $action_id, $automatic ? 'executed_auto' : 'executed', array( 'status' => $status, 'result' => $outcome['result'] ?? array() ) );
		return $outcome;
	}

	// -------------------------------------------------------------- handlers

	/**
	 * Marks a segment as a named audience in wp-admin.
	 *
	 * @param array $action Action.
	 * @return array
	 */
	private static function do_publish_segment( array $action ) {
		$key       = (string) $action['target']['segment_key'];
		$published = (array) get_option( self::OPTION_PUBLISHED, array() );
		$previous  = $published[ $key ] ?? null;
		$published[ $key ] = $action['run_id'];
		update_option( self::OPTION_PUBLISHED, $published, false );
		return array(
			'result'   => array( 'customers' => count( BAP_ML_Store::members( $action['run_id'], $key ) ) ),
			'rollback' => array( 'previous_run' => $previous ),
		);
	}

	/**
	 * Resolves recipients (treatment group) of a segment with their emails.
	 *
	 * @param string $run_id       Run id.
	 * @param string $segment_key  Segment.
	 * @param string $holdout_id   Action id used for the holdout hash.
	 * @param int    $holdout      Holdout percent.
	 * @param bool   $for_campaign Apply unsubscribe and consent rules.
	 * @return array{emails:array,treatment:int,holdout:int,no_email:int}
	 */
	private static function recipients( $run_id, $segment_key, $holdout_id, $holdout, $for_campaign ) {
		$members    = BAP_ML_Store::members( $run_id, $segment_key );
		$identities = BAP_ML_Store::identities( $members );
		$unsub      = $for_campaign ? array_flip( (array) get_option( self::OPTION_UNSUB, array() ) ) : array();
		$consent    = $for_campaign ? (string) BAP_ML_Policy::get()['campaign_consent_meta_key'] : '';
		$out        = array( 'emails' => array(), 'treatment' => 0, 'holdout' => 0, 'no_email' => 0 );

		foreach ( $members as $key ) {
			if ( self::in_holdout( $holdout_id, $key, $holdout ) ) {
				$out['holdout']++;
				continue;
			}
			$out['treatment']++;
			if ( isset( $unsub[ $key ] ) ) {
				continue;
			}
			$id      = $identities[ $key ] ?? null;
			$email   = '';
			$user_id = $id ? (int) $id['user_id'] : 0;
			if ( $user_id > 0 ) {
				$user  = get_userdata( $user_id );
				$email = $user ? (string) $user->user_email : '';
				if ( '' !== $consent && ! get_user_meta( $user_id, $consent, true ) ) {
					continue;
				}
			} elseif ( '' !== $consent ) {
				continue; // guests cannot have given stored consent.
			}
			if ( '' === $email && $id && (int) $id['last_order_id'] > 0 ) {
				$order = wc_get_order( (int) $id['last_order_id'] );
				$email = $order ? (string) $order->get_billing_email() : '';
			}
			if ( '' === $email || ! is_email( $email ) ) {
				$out['no_email']++;
				continue;
			}
			$out['emails'][ $key ] = strtolower( $email );
		}
		/**
		 * Filters campaign/coupon recipients (customer_key => email).
		 *
		 * @param array  $emails      Recipients.
		 * @param string $segment_key Segment.
		 * @param bool   $for_campaign Whether this is an email send.
		 */
		$out['emails'] = (array) apply_filters( 'bap_ml_recipients', $out['emails'], $segment_key, $for_campaign );
		return $out;
	}

	/**
	 * Creates a WooCommerce coupon.
	 *
	 * @param array  $action   Action.
	 * @param array  $params   Parameters.
	 * @param array  $emails   Email restrictions (empty = anyone).
	 * @param array  $products Product ids (empty = cart).
	 * @return WC_Coupon|WP_Error
	 */
	private static function make_coupon( array $action, array $params, array $emails, array $products ) {
		if ( ! class_exists( 'WC_Coupon' ) ) {
			return new WP_Error( 'bap_ml_no_woo', 'WooCommerce is not active' );
		}
		$coupon = new WC_Coupon();
		$coupon->set_code( 'bh-' . strtolower( wp_generate_password( 8, false, false ) ) );
		$coupon->set_description( 'Bahoosh ML action ' . $action['action_id'] );
		$coupon->set_discount_type( (string) $params['discount_type'] );
		$coupon->set_amount( (float) $params['discount_value'] );
		$coupon->set_date_expires( time() + DAY_IN_SECONDS * (int) $params['duration_days'] );
		$coupon->set_individual_use( true );
		if ( $emails ) {
			$coupon->set_email_restrictions( array_values( $emails ) );
		}
		if ( $products ) {
			$coupon->set_product_ids( $products );
		}
		if ( ! empty( $params['usage_limit_per_user'] ) ) {
			$coupon->set_usage_limit_per_user( (int) $params['usage_limit_per_user'] );
		}
		if ( ! empty( $params['usage_limit'] ) ) {
			$coupon->set_usage_limit( (int) $params['usage_limit'] );
		}
		if ( ! empty( $params['minimum_amount'] ) ) {
			$coupon->set_minimum_amount( (float) $params['minimum_amount'] );
		}
		$coupon->update_meta_data( self::META_ACTION, $action['action_id'] );
		$coupon->save();
		return $coupon;
	}

	/**
	 * Segment coupon restricted to the treatment group's emails.
	 *
	 * @param array $action Action.
	 * @return array|WP_Error
	 */
	private static function do_segment_coupon( array $action ) {
		$params  = $action['parameters'];
		$holdout = isset( $params['holdout_percent'] ) ? (int) $params['holdout_percent'] : (int) BAP_ML_Policy::get()['default_holdout_percent'];
		$r       = self::recipients( $action['run_id'], (string) $action['target']['segment_key'], $action['action_id'], $holdout, false );
		if ( ! $r['emails'] ) {
			return new WP_Error( 'bap_ml_no_recipients', __( 'هیچ مشتری با ایمیل معتبر در این بخش نیست.', 'bahoosh-analytics-pro' ) );
		}
		if ( count( $r['emails'] ) > BAP_ML_Policy::MAX_RECIPIENTS ) {
			return new WP_Error( 'bap_ml_too_many', sprintf( 'segment has %d recipients; max %d', count( $r['emails'] ), BAP_ML_Policy::MAX_RECIPIENTS ) );
		}
		$coupon = self::make_coupon( $action, $params, $r['emails'], array() );
		if ( is_wp_error( $coupon ) ) {
			return $coupon;
		}
		return array(
			'result'   => array(
				'coupon_id'           => $coupon->get_id(),
				'coupon_code'         => $coupon->get_code(),
				'customers_targeted'  => $r['treatment'],
				'customers_reached'   => count( $r['emails'] ),
				'customers_no_email'  => $r['no_email'],
				'holdout_percent'     => $holdout,
				'holdout_customers'   => $r['holdout'],
				'expires_at'          => gmdate( 'c', time() + DAY_IN_SECONDS * (int) $params['duration_days'] ),
			),
			'rollback' => array( 'coupon_id' => $coupon->get_id() ),
		);
	}

	/**
	 * Product coupon, optionally restricted to a segment.
	 *
	 * @param array $action Action.
	 * @return array|WP_Error
	 */
	private static function do_product_coupon( array $action ) {
		$params = $action['parameters'];
		$emails = array();
		if ( ! empty( $params['restrict_to_segment'] ) ) {
			$r      = self::recipients( $action['run_id'] ?: BAP_ML_Store::latest_run(), (string) $params['restrict_to_segment'], $action['action_id'], 0, false );
			$emails = $r['emails'];
			if ( ! $emails ) {
				return new WP_Error( 'bap_ml_no_recipients', 'restricted segment has no reachable customers' );
			}
		}
		$coupon = self::make_coupon( $action, $params, $emails, array( (int) $action['target']['product_id'] ) );
		if ( is_wp_error( $coupon ) ) {
			return $coupon;
		}
		return array(
			'result'   => array( 'coupon_id' => $coupon->get_id(), 'coupon_code' => $coupon->get_code(), 'restricted_customers' => count( $emails ) ),
			'rollback' => array( 'coupon_id' => $coupon->get_id() ),
		);
	}

	/**
	 * Temporary sale price, restorable exactly.
	 *
	 * @param array $action Action.
	 * @return array|WP_Error
	 */
	private static function do_sale_price( array $action ) {
		$product = wc_get_product( (int) $action['target']['product_id'] );
		if ( ! $product ) {
			return new WP_Error( 'bap_ml_no_product', 'product not found' );
		}
		$regular = (float) $product->get_regular_price();
		if ( $regular <= 0 || '' !== (string) $product->get_sale_price() ) {
			return new WP_Error( 'bap_ml_price_state', 'product has no regular price or already has a sale price' );
		}
		$restore = array(
			'product_id'        => $product->get_id(),
			'sale_price'        => (string) $product->get_sale_price(),
			'date_on_sale_from' => $product->get_date_on_sale_from() ? $product->get_date_on_sale_from()->getTimestamp() : null,
			'date_on_sale_to'   => $product->get_date_on_sale_to() ? $product->get_date_on_sale_to()->getTimestamp() : null,
		);
		$pct       = (float) $action['parameters']['discount_percent'];
		$new_price = round( $regular * ( 1 - $pct / 100 ), wc_get_price_decimals() );
		$product->set_sale_price( (string) $new_price );
		$product->set_date_on_sale_from( time() );
		$product->set_date_on_sale_to( time() + DAY_IN_SECONDS * (int) $action['parameters']['duration_days'] );
		$product->update_meta_data( self::META_ACTION, $action['action_id'] );
		$product->save();
		return array(
			'result'   => array( 'previous_price' => $regular, 'new_price' => $new_price, 'regular_price' => $regular, 'ends_at' => gmdate( 'c', time() + DAY_IN_SECONDS * (int) $action['parameters']['duration_days'] ) ),
			'rollback' => $restore,
		);
	}

	/**
	 * Stores a campaign draft. Sending is a separate action.
	 *
	 * @param array $action Action.
	 * @return array
	 */
	private static function do_create_campaign( array $action ) {
		return array( 'result' => array( 'draft' => true, 'sent' => 0 ) );
	}

	/**
	 * Schedules the send of an existing campaign.
	 *
	 * @param array $action Action.
	 * @return array|WP_Error
	 */
	private static function do_schedule_campaign( array $action ) {
		$campaign = BAP_ML_Store::action( (string) $action['parameters']['campaign_action_id'] );
		if ( ! $campaign || 'executed' !== $campaign['status'] ) {
			return new WP_Error( 'bap_ml_campaign_state', __( 'ابتدا خود کمپین باید ساخته (تأیید) شده باشد.', 'bahoosh-analytics-pro' ) );
		}
		$at = strtotime( (string) $action['parameters']['send_at'] );
		wp_schedule_single_event( $at, self::CRON_SEND, array( $action['action_id'] ) );
		return array( 'status' => 'scheduled', 'result' => array( 'send_at' => gmdate( 'c', $at ), 'sent' => 0 ) );
	}

	/**
	 * Starts sending now (in cron batches, so a large segment cannot time out a request).
	 *
	 * @param array $action Action.
	 * @return array|WP_Error
	 */
	private static function do_send_campaign( array $action ) {
		$campaign = BAP_ML_Store::action( (string) $action['parameters']['campaign_action_id'] );
		if ( ! $campaign || 'executed' !== $campaign['status'] ) {
			return new WP_Error( 'bap_ml_campaign_state', __( 'ابتدا خود کمپین باید ساخته (تأیید) شده باشد.', 'bahoosh-analytics-pro' ) );
		}
		wp_schedule_single_event( time(), self::CRON_SEND, array( $action['action_id'] ) );
		return array( 'status' => 'sending', 'result' => array( 'sent' => 0 ) );
	}

	/**
	 * Cron: sends the next batch of a scheduled/sending campaign.
	 *
	 * @param string $send_action_id The schedule_campaign/send_campaign action.
	 * @return void
	 */
	public static function send_campaign_batch( $send_action_id ) {
		$send = BAP_ML_Store::action( (string) $send_action_id );
		if ( ! $send || ! in_array( $send['status'], array( 'scheduled', 'sending' ), true ) ) {
			return;
		}
		$campaign = BAP_ML_Store::action( (string) $send['parameters']['campaign_action_id'] );
		if ( ! $campaign ) {
			BAP_ML_Store::update_action( $send['action_id'], array( 'status' => 'failed', 'error' => 'campaign missing' ) );
			return;
		}
		$params = $campaign['parameters'];
		$result = $send['result'];

		// With a coupon, the recipients are exactly the coupon's treatment group,
		// so nobody receives a code that is restricted to someone else, and the
		// holdout stays one consistent control group.
		$coupon      = ! empty( $params['coupon_action_id'] ) ? BAP_ML_Store::action( (string) $params['coupon_action_id'] ) : null;
		$code        = ( $coupon && 'executed' === $coupon['status'] ) ? (string) ( $coupon['result']['coupon_code'] ?? '' ) : '';
		$holdout_id  = $coupon ? $coupon['action_id'] : $campaign['action_id'];
		$holdout_pct = $coupon ? (int) ( $coupon['result']['holdout_percent'] ?? 0 ) : (int) ( $params['holdout_percent'] ?? BAP_ML_Policy::get()['default_holdout_percent'] );

		if ( ! isset( $result['queue'] ) ) {
			$r = self::recipients( $campaign['run_id'], (string) $campaign['target']['segment_key'], $holdout_id, $holdout_pct, true );
			$result = array(
				'queue'                   => array_keys( $r['emails'] ),
				// Pseudonymous keys only; lets the ML service measure purchases
				// by exactly the people who were emailed.
				'recipient_keys'          => array_keys( $r['emails'] ),
				'sent'                    => 0,
				'failed'                  => 0,
				'targeted'                => $r['treatment'],
				'holdout_percent'         => $holdout_pct,
				'holdout_source_action_id' => $holdout_id,
				'no_email'                => $r['no_email'],
			);
			BAP_ML_Store::transition( $send['action_id'], array( 'scheduled' ), 'sending' );
		}

		$batch      = array_splice( $result['queue'], 0, self::SEND_BATCH );
		$identities = BAP_ML_Store::identities( $batch );
		foreach ( $batch as $key ) {
			$emails = self::recipients_for_keys( array( $key => $identities[ $key ] ?? null ) );
			if ( empty( $emails[ $key ] ) ) {
				$result['failed']++;
				continue;
			}
			$link  = add_query_arg( 'bap_c', rawurlencode( $send_action_id ), home_url( '/' ) );
			$unsub = add_query_arg( 'bap_unsub', rawurlencode( BAP_ML_Auth::unsubscribe_token( $key ) ), home_url( '/' ) );
			$body  = $params['message'] . "\n\n";
			if ( '' !== $code ) {
				/* translators: %s: coupon code */
				$body .= sprintf( __( 'کد تخفیف شما: %s', 'bahoosh-analytics-pro' ), strtoupper( $code ) ) . "\n\n";
			}
			$body .= $link . "\n\n" . __( 'لغو دریافت ایمیل:', 'bahoosh-analytics-pro' ) . ' ' . $unsub;
			/**
			 * Lets a site send through SMS or an email provider instead of wp_mail().
			 * Return true when sent.
			 *
			 * @param null|bool $sent    Null to use wp_mail().
			 * @param string    $email   Recipient.
			 * @param string    $subject Subject.
			 * @param string    $body    Plain-text body.
			 * @param array     $campaign Campaign action.
			 */
			$sent = apply_filters( 'bap_ml_send_campaign_message', null, $emails[ $key ], $params['subject'], $body, $campaign );
			if ( null === $sent ) {
				$sent = wp_mail( $emails[ $key ], $params['subject'], $body );
			}
			$sent ? $result['sent']++ : $result['failed']++;
		}

		if ( $result['queue'] ) {
			BAP_ML_Store::update_action( $send['action_id'], array( 'result' => $result ) );
			wp_schedule_single_event( time() + 30, self::CRON_SEND, array( $send['action_id'] ) );
			return;
		}
		unset( $result['queue'] );
		BAP_ML_Store::update_action( $send['action_id'], array( 'status' => 'executed', 'executed_at' => BAP_ML_Store::now(), 'result' => $result ) );
		BAP_ML_Store::audit( $send['action_id'], 'campaign_sent', array( 'sent' => $result['sent'], 'failed' => $result['failed'] ) );
	}

	/**
	 * Email for identity rows, read from WooCommerce at send time.
	 *
	 * @param array $identities customer_key => identity row.
	 * @return array customer_key => email.
	 */
	private static function recipients_for_keys( array $identities ) {
		$out = array();
		foreach ( $identities as $key => $id ) {
			if ( ! $id ) {
				continue;
			}
			$email = '';
			if ( (int) $id['user_id'] > 0 ) {
				$user  = get_userdata( (int) $id['user_id'] );
				$email = $user ? (string) $user->user_email : '';
			}
			if ( '' === $email && (int) $id['last_order_id'] > 0 ) {
				$order = wc_get_order( (int) $id['last_order_id'] );
				$email = $order ? (string) $order->get_billing_email() : '';
			}
			if ( is_email( $email ) ) {
				$out[ $key ] = $email;
			}
		}
		return $out;
	}

	/**
	 * Click counting and one-click unsubscribe from campaign links.
	 *
	 * @return void
	 */
	public static function handle_tracking_links() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- public links from emails.
		if ( isset( $_GET['bap_c'] ) ) {
			$id = sanitize_text_field( wp_unslash( $_GET['bap_c'] ) );
			if ( preg_match( '/^[a-f0-9\-]{36}$/', $id ) ) {
				BAP_ML_Store::count_click( $id );
			}
		}
		if ( isset( $_GET['bap_unsub'] ) ) {
			$key = BAP_ML_Auth::customer_from_unsubscribe_token( sanitize_text_field( wp_unslash( $_GET['bap_unsub'] ) ) );
			if ( '' !== $key ) {
				$list   = (array) get_option( self::OPTION_UNSUB, array() );
				$list[] = $key;
				update_option( self::OPTION_UNSUB, array_values( array_unique( $list ) ), false );
				wp_die( esc_html__( 'دیگر ایمیل تبلیغاتی از این فروشگاه دریافت نمی‌کنید.', 'bahoosh-analytics-pro' ), '', array( 'response' => 200 ) );
			}
		}
		// phpcs:enable
	}

	/**
	 * Undoes an executed action.
	 *
	 * @param string $action_id Id.
	 * @return true|WP_Error
	 */
	public static function rollback( $action_id ) {
		$action = BAP_ML_Store::action( $action_id );
		if ( ! $action ) {
			return new WP_Error( 'bap_ml_missing', 'missing action' );
		}
		if ( ! current_user_can( BAP_ML_Policy::capability_for( $action['action_type'] ) ) ) {
			return new WP_Error( 'bap_ml_forbidden', __( 'اجازه بازگردانی این اقدام را ندارید.', 'bahoosh-analytics-pro' ) );
		}
		$rb = $action['rollback'];

		switch ( $action['action_type'] ) {
			case 'update_sale_price':
				$product = wc_get_product( (int) ( $rb['product_id'] ?? 0 ) );
				if ( ! $product ) {
					return new WP_Error( 'bap_ml_no_product', 'product no longer exists' );
				}
				// Only restore if nobody changed the price since; overwriting a
				// person's later edit would be a second, unasked-for change.
				if ( (string) $product->get_sale_price() !== (string) ( $action['result']['new_price'] ?? '' ) ) {
					return new WP_Error( 'bap_ml_changed', __( 'قیمت این محصول بعد از اجرای اقدام دستی تغییر کرده؛ بازگردانی انجام نشد.', 'bahoosh-analytics-pro' ) );
				}
				$product->set_sale_price( (string) ( $rb['sale_price'] ?? '' ) );
				$product->set_date_on_sale_from( $rb['date_on_sale_from'] ? (int) $rb['date_on_sale_from'] : null );
				$product->set_date_on_sale_to( $rb['date_on_sale_to'] ? (int) $rb['date_on_sale_to'] : null );
				$product->delete_meta_data( self::META_ACTION );
				$product->save();
				break;

			case 'create_coupon_for_segment':
			case 'create_product_coupon':
				$coupon = new WC_Coupon( (int) ( $rb['coupon_id'] ?? 0 ) );
				if ( ! $coupon->get_id() ) {
					return new WP_Error( 'bap_ml_no_coupon', 'coupon no longer exists' );
				}
				// Expired, not deleted: used coupons are referenced by real orders.
				$coupon->set_date_expires( time() - DAY_IN_SECONDS );
				$coupon->save();
				break;

			case 'create_customer_segment':
				$published = (array) get_option( self::OPTION_PUBLISHED, array() );
				$key       = (string) $action['target']['segment_key'];
				if ( ! empty( $rb['previous_run'] ) ) {
					$published[ $key ] = $rb['previous_run'];
				} else {
					unset( $published[ $key ] );
				}
				update_option( self::OPTION_PUBLISHED, $published, false );
				break;

			case 'schedule_campaign':
				if ( 'scheduled' !== $action['status'] ) {
					return new WP_Error( 'bap_ml_sent', __( 'ایمیل ارسال‌شده قابل بازگردانی نیست.', 'bahoosh-analytics-pro' ) );
				}
				wp_clear_scheduled_hook( self::CRON_SEND, array( $action_id ) );
				break;

			default:
				return new WP_Error( 'bap_ml_no_rollback', __( 'این نوع اقدام قابل بازگردانی نیست.', 'bahoosh-analytics-pro' ) );
		}

		if ( ! BAP_ML_Store::transition( $action_id, array( 'executed', 'scheduled' ), 'rolled_back' ) ) {
			return new WP_Error( 'bap_ml_state', 'action is not in a reversible state' );
		}
		BAP_ML_Store::update_action( $action_id, array( 'rolled_back_at' => BAP_ML_Store::now() ) );
		BAP_ML_Store::audit( $action_id, 'rolled_back' );
		return true;
	}
}
