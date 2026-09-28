<?php
/**
 * Store policy for ML-proposed actions. The authoritative gate.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Decides whether an action may exist, whether it needs a human, and whether
 * it may run on its own.
 *
 * The ML service runs the same checks first (bahoosh_ml/actions.py), but this
 * class never trusts that: every action arriving from outside is re-validated
 * here against the policy the shop owner saved, and the status the service
 * suggested is discarded and recomputed. Numbers that break a limit are
 * rejected, not clamped, so the owner always sees what was actually proposed.
 *
 * @since 4.8.0
 */
class BAP_ML_Policy {

	const OPTION = 'bap_ml_policy';

	const HARD_MAX_PRICE_CHANGE = 30;
	const HARD_MAX_DURATION     = 30;
	const MAX_RECIPIENTS        = 5000;

	const ACTIONS = array(
		'create_customer_segment',
		'create_coupon_for_segment',
		'create_product_coupon',
		'update_sale_price',
		'recommend_price_change',
		'create_campaign',
		'schedule_campaign',
		'send_campaign',
	);

	/** Destructive: always needs a human, whatever the policy says. */
	const APPROVAL_ALWAYS = array( 'update_sale_price' );

	/** Never executed; shown to the owner as advice. */
	const RECOMMENDATION_ONLY = array( 'recommend_price_change' );

	/**
	 * Defaults. Everything that changes the shop starts switched off.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'connection_enabled'        => false,
			'execution_enabled'         => true,
			'max_discount_percent'      => 15,
			'max_fixed_discount_amount' => 0,
			'max_price_change_percent'  => 10,
			'max_coupon_duration_days'  => 14,
			'default_holdout_percent'   => 10,
			'auto_price_change'         => false,
			'auto_coupon'               => false,
			'auto_campaign'             => false,
			'auto_segment'              => true,
			'min_confidence_for_auto'   => 0.8,
			'max_actions_per_run'       => 10,
			'campaign_consent_meta_key' => '',
			'allowed_actions'           => self::ACTIONS,
		);
	}

	/**
	 * Current policy merged over defaults.
	 *
	 * @return array
	 */
	public static function get() {
		$stored = get_option( self::OPTION, array() );
		$policy = array_merge( self::defaults(), is_array( $stored ) ? $stored : array() );
		// Not a setting: price changes are never automatic.
		$policy['auto_price_change'] = false;
		return $policy;
	}

	/**
	 * Saves a policy from the admin form.
	 *
	 * @param array $input Raw input.
	 * @return array Saved policy.
	 */
	public static function save( array $input ) {
		$d = self::defaults();
		$p = array(
			'connection_enabled'        => ! empty( $input['connection_enabled'] ),
			'execution_enabled'         => ! empty( $input['execution_enabled'] ),
			'max_discount_percent'      => max( 1, min( BAP_Commerce_Agent::HARD_MAX_DISCOUNT, (float) ( $input['max_discount_percent'] ?? $d['max_discount_percent'] ) ) ),
			'max_fixed_discount_amount' => max( 0, (float) ( $input['max_fixed_discount_amount'] ?? 0 ) ),
			'max_price_change_percent'  => max( 1, min( self::HARD_MAX_PRICE_CHANGE, (float) ( $input['max_price_change_percent'] ?? $d['max_price_change_percent'] ) ) ),
			'max_coupon_duration_days'  => max( 1, min( self::HARD_MAX_DURATION, (int) ( $input['max_coupon_duration_days'] ?? $d['max_coupon_duration_days'] ) ) ),
			'default_holdout_percent'   => max( 0, min( 50, (int) ( $input['default_holdout_percent'] ?? $d['default_holdout_percent'] ) ) ),
			'auto_price_change'         => false,
			'auto_coupon'               => ! empty( $input['auto_coupon'] ),
			'auto_campaign'             => ! empty( $input['auto_campaign'] ),
			'auto_segment'              => ! empty( $input['auto_segment'] ),
			'min_confidence_for_auto'   => max( 0.5, min( 1.0, (float) ( $input['min_confidence_for_auto'] ?? $d['min_confidence_for_auto'] ) ) ),
			'max_actions_per_run'       => max( 1, min( 25, (int) ( $input['max_actions_per_run'] ?? $d['max_actions_per_run'] ) ) ),
			'campaign_consent_meta_key' => sanitize_key( (string) ( $input['campaign_consent_meta_key'] ?? '' ) ),
			'allowed_actions'           => array_values( array_intersect( self::ACTIONS, (array) ( $input['allowed_actions'] ?? self::ACTIONS ) ) ),
		);
		update_option( self::OPTION, $p, false );
		BAP_ML_Store::audit( '', 'policy_saved', $p );
		return $p;
	}

	/**
	 * Whether the signed ML routes answer at all.
	 *
	 * @return bool
	 */
	public static function connection_enabled() {
		return (bool) self::get()['connection_enabled'];
	}

	/**
	 * The subset of the policy the ML service needs (sent in /ml/context).
	 *
	 * @return array
	 */
	public static function for_service() {
		$p = self::get();
		unset( $p['connection_enabled'], $p['campaign_consent_meta_key'] );
		$p['max_fixed_discount_amount'] = $p['max_fixed_discount_amount'] > 0 ? $p['max_fixed_discount_amount'] : null;
		return $p;
	}

	/**
	 * Validates one action and computes its status.
	 *
	 * @param array $action   Normalised action (action_type, target, parameters, confidence, run_id).
	 * @param array $siblings action_id => action of the same batch, for cross references.
	 * @param int   $position Index in the batch.
	 * @return array{status:string,violations:string[]}
	 */
	public static function evaluate( array $action, array $siblings = array(), $position = 0 ) {
		$p          = self::get();
		$type       = (string) $action['action_type'];
		$target     = (array) $action['target'];
		$params     = (array) $action['parameters'];
		$violations = array();

		if ( ! in_array( $type, self::ACTIONS, true ) ) {
			return array( 'status' => 'rejected_by_policy', 'violations' => array( 'unknown action type' ) );
		}
		if ( ! in_array( $type, (array) $p['allowed_actions'], true ) ) {
			$violations[] = 'action type not allowed by store policy';
		}
		if ( $position >= (int) $p['max_actions_per_run'] ) {
			$violations[] = 'too many actions in one run';
		}
		$confidence = $action['confidence'];
		if ( null !== $confidence && ( ! is_numeric( $confidence ) || $confidence < 0 || $confidence > 1 ) ) {
			$violations[] = 'confidence must be between 0 and 1';
		}

		// Targets must exist here, now.
		if ( isset( $target['segment_key'] ) ) {
			$run = '' !== (string) ( $action['run_id'] ?? '' ) ? (string) $action['run_id'] : BAP_ML_Store::latest_run();
			if ( ! isset( BAP_ML_Store::segments( $run )[ (string) $target['segment_key'] ] ) ) {
				$violations[] = 'unknown segment';
			}
		}
		$product = null;
		if ( isset( $target['product_id'] ) ) {
			$product = function_exists( 'wc_get_product' ) ? wc_get_product( (int) $target['product_id'] ) : null;
			if ( ! $product ) {
				$violations[] = 'unknown product';
			}
		}
		$needs_segment = in_array( $type, array( 'create_customer_segment', 'create_coupon_for_segment', 'create_campaign' ), true );
		$needs_product = in_array( $type, array( 'create_product_coupon', 'update_sale_price', 'recommend_price_change' ), true );
		if ( $needs_segment && ! isset( $target['segment_key'] ) ) {
			$violations[] = 'missing target segment';
		}
		if ( $needs_product && ! isset( $target['product_id'] ) ) {
			$violations[] = 'missing target product';
		}

		$max_discount = min( (float) $p['max_discount_percent'], (float) BAP_Commerce_Agent::HARD_MAX_DISCOUNT );
		$max_days     = min( (int) $p['max_coupon_duration_days'], self::HARD_MAX_DURATION );
		$max_change   = min( (float) $p['max_price_change_percent'], (float) self::HARD_MAX_PRICE_CHANGE );

		switch ( $type ) {
			case 'create_coupon_for_segment':
			case 'create_product_coupon':
				$dtype = (string) ( $params['discount_type'] ?? '' );
				$value = (float) ( $params['discount_value'] ?? 0 );
				$days  = (int) ( $params['duration_days'] ?? 0 );
				$allowed_types = 'create_product_coupon' === $type ? array( 'percent', 'fixed_product' ) : array( 'percent', 'fixed_cart' );
				if ( ! in_array( $dtype, $allowed_types, true ) ) {
					$violations[] = 'invalid discount type';
				}
				if ( $value <= 0 ) {
					$violations[] = 'discount must be positive';
				}
				if ( 'percent' === $dtype && $value > $max_discount ) {
					$violations[] = sprintf( 'discount %s%% exceeds max %s%%', $value, $max_discount );
				}
				if ( 'percent' !== $dtype ) {
					$cap = (float) $p['max_fixed_discount_amount'];
					if ( $cap <= 0 ) {
						$violations[] = 'fixed-amount discounts are disabled (set a max fixed discount amount)';
					} elseif ( $value > $cap ) {
						$violations[] = 'fixed discount exceeds max amount';
					}
					if ( $product && (float) $product->get_regular_price() > 0 && $value / (float) $product->get_regular_price() * 100 > $max_discount ) {
						$violations[] = 'fixed discount exceeds max percent of product price';
					}
				}
				if ( $days < 1 || $days > $max_days ) {
					$violations[] = sprintf( 'duration must be 1-%d days', $max_days );
				}
				if ( isset( $params['holdout_percent'] ) && ( (int) $params['holdout_percent'] < 0 || (int) $params['holdout_percent'] > 50 ) ) {
					$violations[] = 'holdout must be 0-50%';
				}
				if ( ! empty( $params['restrict_to_segment'] ) && ! isset( BAP_ML_Store::segments( (string) ( $action['run_id'] ?? '' ) )[ (string) $params['restrict_to_segment'] ] ) ) {
					$violations[] = 'unknown restrict_to_segment';
				}
				break;

			case 'update_sale_price':
			case 'recommend_price_change':
				$change = (float) ( 'update_sale_price' === $type ? ( $params['discount_percent'] ?? 0 ) : ( $params['change_percent'] ?? 0 ) );
				if ( $change <= 0 || $change > $max_change ) {
					$violations[] = sprintf( 'price change must be >0 and <= %s%%', $max_change );
				}
				if ( 'update_sale_price' === $type && $product ) {
					if ( (float) $product->get_regular_price() <= 0 ) {
						$violations[] = 'product has no regular price';
					}
					if ( '' !== (string) $product->get_sale_price() ) {
						$violations[] = 'product already has a sale price; not overwriting a human decision';
					}
					$days = (int) ( $params['duration_days'] ?? 0 );
					if ( $days < 1 || $days > self::HARD_MAX_DURATION ) {
						$violations[] = 'duration must be 1-30 days';
					}
				}
				break;

			case 'create_campaign':
				$subject = (string) ( $params['subject'] ?? '' );
				$message = (string) ( $params['message'] ?? '' );
				if ( mb_strlen( $subject ) < 3 || mb_strlen( $subject ) > 120 || mb_strlen( $message ) < 10 || mb_strlen( $message ) > 2000 ) {
					$violations[] = 'subject/message length';
				}
				if ( wp_strip_all_tags( $subject . $message ) !== $subject . $message ) {
					$violations[] = 'campaign text must be plain text';
				}
				if ( ! empty( $params['coupon_action_id'] ) && ! self::refers_to( (string) $params['coupon_action_id'], array( 'create_coupon_for_segment', 'create_product_coupon' ), $siblings ) ) {
					$violations[] = 'coupon_action_id does not reference a coupon action';
				}
				break;

			case 'schedule_campaign':
			case 'send_campaign':
				if ( empty( $params['campaign_action_id'] ) || ! self::refers_to( (string) $params['campaign_action_id'], array( 'create_campaign' ), $siblings ) ) {
					$violations[] = 'campaign_action_id does not reference a campaign';
				}
				if ( 'schedule_campaign' === $type ) {
					$at = strtotime( (string) ( $params['send_at'] ?? '' ) );
					if ( ! $at || $at <= time() ) {
						$violations[] = 'send_at must be in the future';
					}
				}
				break;
		}

		if ( $violations ) {
			return array( 'status' => 'rejected_by_policy', 'violations' => $violations );
		}
		if ( in_array( $type, self::RECOMMENDATION_ONLY, true ) ) {
			return array( 'status' => 'recommendation_only', 'violations' => array() );
		}
		if ( in_array( $type, self::APPROVAL_ALWAYS, true ) ) {
			return array( 'status' => 'pending_approval', 'violations' => array() );
		}

		$flags = array(
			'create_customer_segment'   => 'auto_segment',
			'create_coupon_for_segment' => 'auto_coupon',
			'create_product_coupon'     => 'auto_coupon',
			'create_campaign'           => 'auto_campaign',
			'schedule_campaign'         => 'auto_campaign',
			'send_campaign'             => 'auto_campaign',
		);
		$auto = ! empty( $p[ $flags[ $type ] ] )
			&& ! empty( $p['execution_enabled'] )
			&& null !== $confidence
			&& (float) $confidence >= (float) $p['min_confidence_for_auto'];

		return array( 'status' => $auto ? 'auto_approved' : 'pending_approval', 'violations' => array() );
	}

	/**
	 * Whether an id points to an action of one of the given types.
	 *
	 * @param string $action_id Id.
	 * @param array  $types     Types.
	 * @param array  $siblings  Same-batch actions.
	 * @return bool
	 */
	private static function refers_to( $action_id, array $types, array $siblings ) {
		$other = $siblings[ $action_id ] ?? BAP_ML_Store::action( $action_id );
		return is_array( $other ) && in_array( (string) ( $other['action_type'] ?? '' ), $types, true );
	}

	/**
	 * Capability needed to approve or execute an action type.
	 *
	 * @param string $type Action type.
	 * @return string
	 */
	public static function capability_for( $type ) {
		switch ( $type ) {
			case 'update_sale_price':
				return 'edit_products';
			case 'create_coupon_for_segment':
			case 'create_product_coupon':
				return 'edit_shop_coupons';
			default:
				return BAP_Admin::settings_capability();
		}
	}
}
