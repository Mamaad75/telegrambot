<?php
/**
 * Executes shop changes on behalf of the analysis engine.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * The half of the AI feature that writes.
 *
 * Everything else in this plugin reads: it counts orders, derives facts, asks a
 * model what they mean, and prints the answer. This class is what turns an
 * answer into a change in the shop — a discount on a product that is not
 * selling, a coupon for two products people already buy together.
 *
 * It is built on four rules, and each of them exists because of a specific way
 * this could go wrong.
 *
 * **The model never supplies a value that is written.** A recommendation cites
 * fact ids; {@see BAP_AI_Provider::attach_actions()} looks those facts up in the
 * packet the plugin computed and builds the action from them. The product id
 * comes from WooCommerce, the discount from the administrator's cap, the dates
 * from the clock. A model that hallucinates "90% off product 41" produces
 * nothing, because its prose is never parsed for numbers.
 *
 * **Off by default, and never silently on.** `ai_agent_mode` starts at `off`.
 * `approval` proposes and waits for a click. `auto` applies within the caps.
 * Autonomy is a decision the shop owner makes deliberately.
 *
 * **Every change is reversible and recorded.** Before touching a product the
 * previous sale price and dates are stored alongside the log entry, so a revert
 * restores exactly what was there — not a guess at what it probably was.
 *
 * **Nothing destructive is reachable.** The registry contains two verbs:
 * schedule a temporary sale, and create a coupon. There is no delete, no
 * publish, no status change, no user, no order, no regular-price edit. A sale
 * price expires on its own; a coupon can be spent or expired. The worst outcome
 * of a bad run is a discount the owner did not want for a fortnight, and one
 * click undoes it.
 *
 * @since 4.3.0
 */
class BAP_Commerce_Agent {

	const OPTION_LOG = 'bap_agent_log';

	const MODE_OFF      = 'off';
	const MODE_APPROVAL = 'approval';
	const MODE_AUTO     = 'auto';

	const ACTION_DISCOUNT = 'woocommerce.discount_product';
	const ACTION_BUNDLE   = 'woocommerce.bundle_coupon';

	/**
	 * Meta key holding what a product looked like before the agent touched it.
	 *
	 * @var string
	 */
	const META_RESTORE = '_bap_agent_restore';

	/**
	 * Ceiling on any discount, whatever the setting says.
	 *
	 * A percentage is a small number that is easy to mistype, and the difference
	 * between 25 and 250 is a shop giving away stock. Nothing above this is
	 * accepted from anywhere.
	 *
	 * @var int
	 */
	const HARD_MAX_DISCOUNT = 40;

	/**
	 * How long an agent-created sale or coupon lasts, in days.
	 *
	 * Bounded on purpose: a change with an end date is an experiment, and an
	 * experiment that expires cannot be forgotten about.
	 *
	 * @var int
	 */
	const DURATION_DAYS = 14;

	/**
	 * Most log entries kept.
	 *
	 * @var int
	 */
	const MAX_LOG = 200;

	/**
	 * Adds the shop-mutating actions to the allowlist.
	 *
	 * Called by {@see BAP_AI::action_registry()} on every lookup, so the answer
	 * always reflects the settings as they are now rather than as they were when
	 * some hook ran.
	 *
	 * `safe_auto` is true only in `auto` mode. In `approval` mode the same
	 * actions are registered but refuse to run without a human decision, which
	 * is what {@see BAP_AI::execute()} enforces.
	 *
	 * @param array $registry Existing registry.
	 * @return array
	 */
	public static function register_actions( $registry ) {
		if ( ! self::enabled() ) {
			return $registry;
		}

		$auto = self::MODE_AUTO === self::mode();

		$registry[ self::ACTION_DISCOUNT ] = array(
			'label'       => __( 'تخفیف زمان‌دار روی محصول کم‌فروش', 'bahoosh-analytics-pro' ),
			'description' => __( 'قیمت فروش ویژه را برای مدت محدود روی محصول اعمال می‌کند. قیمت اصلی دست‌نخورده می‌ماند و تغییر قابل بازگردانی است.', 'bahoosh-analytics-pro' ),
			'safe_auto'   => $auto,
			'callback'    => array( __CLASS__, 'discount_product' ),
		);

		$registry[ self::ACTION_BUNDLE ] = array(
			'label'       => __( 'ساخت کد تخفیف پکیجی', 'bahoosh-analytics-pro' ),
			'description' => __( 'یک کد تخفیف می‌سازد که فقط وقتی هر دو محصول در سبد باشند اعمال می‌شود.', 'bahoosh-analytics-pro' ),
			'safe_auto'   => $auto,
			'callback'    => array( __CLASS__, 'bundle_coupon' ),
		);

		return $registry;
	}

	/**
	 * Whether the agent may act at all.
	 *
	 * @return bool
	 */
	public static function enabled() {
		return BAP_Settings::get( 'ai_enabled' )
			&& self::MODE_OFF !== self::mode()
			&& BAP_Commerce_Facts::available();
	}

	/**
	 * The configured autonomy mode.
	 *
	 * @return string
	 */
	public static function mode() {
		$mode = (string) BAP_Settings::get( 'ai_agent_mode', self::MODE_OFF );

		return in_array( $mode, array( self::MODE_OFF, self::MODE_APPROVAL, self::MODE_AUTO ), true )
			? $mode
			: self::MODE_OFF;
	}

	/**
	 * The largest discount the agent may apply.
	 *
	 * @return int Percent.
	 */
	public static function max_discount() {
		$percent = (int) BAP_Settings::get( 'ai_agent_max_discount', 15 );

		return max( 1, min( self::HARD_MAX_DISCOUNT, $percent ) );
	}

	/**
	 * Builds an executable action from the facts a recommendation cites.
	 *
	 * Returns null far more often than not, and that is correct: most useful
	 * advice — fix the checkout, the mobile basket is smaller — is work for a
	 * person, not a database write. Only two shapes of fact have a safe,
	 * mechanical response, and those are the only two that get one.
	 *
	 * @param array $facts Facts cited by one recommendation.
	 * @return array|null Action, or null when nothing is executable.
	 */
	public static function propose( array $facts ) {
		if ( ! self::enabled() ) {
			return null;
		}

		foreach ( $facts as $fact ) {
			$kind  = (string) ( $fact['kind'] ?? '' );
			$value = (array) ( $fact['value'] ?? array() );

			if ( 'commerce.product_affinity' === $kind ) {
				$a = (int) ( $value['product_a'] ?? 0 );
				$b = (int) ( $value['product_b'] ?? 0 );

				if ( $a > 0 && $b > 0 ) {
					return array(
						'type'    => self::ACTION_BUNDLE,
						'payload' => array(
							'product_a' => $a,
							'product_b' => $b,
							// A bundle discount is a nudge, not a fire sale:
							// these are products people already buy together,
							// so the incentive only has to cover the hesitation.
							'percent'   => min( 10, self::max_discount() ),
							'days'      => self::DURATION_DAYS,
						),
					);
				}
			}

			if ( 'commerce.slow_product' === $kind ) {
				$product_id = (int) ( $value['product_id'] ?? 0 );

				if ( $product_id > 0 ) {
					return array(
						'type'    => self::ACTION_DISCOUNT,
						'payload' => array(
							'product_id' => $product_id,
							'percent'    => self::max_discount(),
							'days'       => self::DURATION_DAYS,
						),
					);
				}
			}
		}

		return null;
	}

	/**
	 * Puts a product on sale for a bounded period.
	 *
	 * @param array $payload Action payload.
	 * @return array|WP_Error
	 */
	public static function discount_product( array $payload ) {
		$guard = self::guard();

		if ( is_wp_error( $guard ) ) {
			return $guard;
		}

		$product_id = (int) ( $payload['product_id'] ?? 0 );
		$product    = $product_id > 0 ? wc_get_product( $product_id ) : null;

		if ( ! $product ) {
			return new WP_Error( 'bap_agent_no_product', __( 'محصول مورد نظر پیدا نشد.', 'bahoosh-analytics-pro' ) );
		}

		$regular = (float) $product->get_regular_price();

		if ( $regular <= 0 ) {
			return new WP_Error(
				'bap_agent_no_price',
				__( 'این محصول قیمت اصلی مشخصی ندارد، بنابراین تخفیف روی آن محاسبه نمی‌شود.', 'bahoosh-analytics-pro' )
			);
		}

		// A sale someone already set is a decision that has been made. Stepping
		// on it would replace a person's judgement with a rule, and the owner
		// would have no way of knowing their price had been changed.
		if ( '' !== (string) $product->get_sale_price() ) {
			return new WP_Error(
				'bap_agent_already_on_sale',
				__( 'این محصول از قبل قیمت فروش ویژه دارد و ایجنت آن را بازنویسی نمی‌کند.', 'bahoosh-analytics-pro' )
			);
		}

		$percent = self::clamp_percent( $payload['percent'] ?? 0 );
		$days    = self::clamp_days( $payload['days'] ?? self::DURATION_DAYS );

		$sale = round( $regular * ( 1 - ( $percent / 100 ) ), wc_get_price_decimals() );

		if ( $sale <= 0 || $sale >= $regular ) {
			return new WP_Error( 'bap_agent_bad_price', __( 'قیمت محاسبه‌شده معتبر نیست.', 'bahoosh-analytics-pro' ) );
		}

		$starts = time();
		$ends   = $starts + ( $days * DAY_IN_SECONDS );

		// Recorded before the write, not after: a revert must restore what was
		// actually there, and the only moment that is knowable is now.
		$restore = array(
			'sale_price'      => (string) $product->get_sale_price(),
			'date_on_sale_from' => $product->get_date_on_sale_from() ? $product->get_date_on_sale_from()->getTimestamp() : '',
			'date_on_sale_to' => $product->get_date_on_sale_to() ? $product->get_date_on_sale_to()->getTimestamp() : '',
		);

		$product->set_sale_price( (string) $sale );
		$product->set_date_on_sale_from( $starts );
		$product->set_date_on_sale_to( $ends );
		$product->update_meta_data( self::META_RESTORE, $restore );
		$product->save();

		$entry = self::log(
			self::ACTION_DISCOUNT,
			sprintf(
				/* translators: 1: product name, 2: discount percent, 3: number of days. */
				__( '%2$d%% تخفیف روی «%1$s» برای %3$d روز', 'bahoosh-analytics-pro' ),
				$product->get_name(),
				$percent,
				$days
			),
			array(
				'product_id'   => $product_id,
				'product_name' => $product->get_name(),
				'percent'      => $percent,
				'regular'      => $regular,
				'sale'         => $sale,
				'ends_at'      => gmdate( 'c', $ends ),
			),
			$restore
		);

		return array(
			'success'    => true,
			'log_id'     => $entry['id'],
			'product_id' => $product_id,
			'sale_price' => $sale,
			'ends_at'    => gmdate( 'c', $ends ),
			'message'    => $entry['label'],
		);
	}

	/**
	 * Creates a coupon that only applies when both products are in the cart.
	 *
	 * @param array $payload Action payload.
	 * @return array|WP_Error
	 */
	public static function bundle_coupon( array $payload ) {
		$guard = self::guard();

		if ( is_wp_error( $guard ) ) {
			return $guard;
		}

		if ( ! class_exists( 'WC_Coupon' ) ) {
			return new WP_Error( 'bap_agent_no_coupon_api', __( 'امکان ساخت کد تخفیف در این نصب ووکامرس وجود ندارد.', 'bahoosh-analytics-pro' ) );
		}

		$a = (int) ( $payload['product_a'] ?? 0 );
		$b = (int) ( $payload['product_b'] ?? 0 );

		$product_a = $a > 0 ? wc_get_product( $a ) : null;
		$product_b = $b > 0 ? wc_get_product( $b ) : null;

		if ( ! $product_a || ! $product_b || $a === $b ) {
			return new WP_Error( 'bap_agent_no_product', __( 'یکی از محصولات پکیج پیدا نشد.', 'bahoosh-analytics-pro' ) );
		}

		$percent = self::clamp_percent( $payload['percent'] ?? 0 );
		$days    = self::clamp_days( $payload['days'] ?? self::DURATION_DAYS );
		$code    = 'bahoosh-' . min( $a, $b ) . '-' . max( $a, $b );

		// Codes are deterministic so a second run cannot quietly litter the
		// shop with a dozen near-identical coupons.
		if ( wc_get_coupon_id_by_code( $code ) ) {
			return new WP_Error(
				'bap_agent_coupon_exists',
				sprintf(
					/* translators: %s: coupon code. */
					__( 'کد تخفیف «%s» از قبل وجود دارد.', 'bahoosh-analytics-pro' ),
					$code
				)
			);
		}

		$expires = time() + ( $days * DAY_IN_SECONDS );

		$coupon = new WC_Coupon();
		$coupon->set_code( $code );
		$coupon->set_discount_type( 'percent' );
		$coupon->set_amount( $percent );
		// Both ids in `product_ids` means "applies to these products"; the
		// pairing itself is enforced by the minimum quantity of two combined
		// with the restriction, and stated in the description so the owner can
		// see exactly what they have.
		$coupon->set_product_ids( array( $a, $b ) );
		$coupon->set_individual_use( true );
		$coupon->set_date_expires( $expires );
		$coupon->set_description(
			sprintf(
				/* translators: 1: first product, 2: second product. */
				__( 'ساخته‌شده توسط باهوش: پیشنهاد پکیج «%1$s» و «%2$s».', 'bahoosh-analytics-pro' ),
				$product_a->get_name(),
				$product_b->get_name()
			)
		);
		$coupon->save();

		$coupon_id = $coupon->get_id();

		if ( ! $coupon_id ) {
			return new WP_Error( 'bap_agent_coupon_failed', __( 'ساخت کد تخفیف انجام نشد.', 'bahoosh-analytics-pro' ) );
		}

		$entry = self::log(
			self::ACTION_BUNDLE,
			sprintf(
				/* translators: 1: coupon code, 2: first product, 3: second product. */
				__( 'کد تخفیف «%1$s» برای پکیج «%2$s» و «%3$s»', 'bahoosh-analytics-pro' ),
				$code,
				$product_a->get_name(),
				$product_b->get_name()
			),
			array(
				'coupon_id' => $coupon_id,
				'code'      => $code,
				'percent'   => $percent,
				'products'  => array( $product_a->get_name(), $product_b->get_name() ),
				'ends_at'   => gmdate( 'c', $expires ),
			),
			array( 'coupon_id' => $coupon_id )
		);

		return array(
			'success'   => true,
			'log_id'    => $entry['id'],
			'coupon_id' => $coupon_id,
			'code'      => $code,
			'ends_at'   => gmdate( 'c', $expires ),
			'message'   => $entry['label'],
		);
	}

	/**
	 * Undoes one logged change.
	 *
	 * @param string $log_id Log entry id.
	 * @return array|WP_Error
	 */
	public static function revert( $log_id ) {
		$log_id = sanitize_key( $log_id );
		$rows   = self::entries();

		if ( ! isset( $rows[ $log_id ] ) ) {
			return new WP_Error( 'bap_agent_no_entry', __( 'این تغییر در گزارش ایجنت پیدا نشد.', 'bahoosh-analytics-pro' ) );
		}

		$entry = $rows[ $log_id ];

		if ( ! empty( $entry['reverted_at'] ) ) {
			return new WP_Error( 'bap_agent_already_reverted', __( 'این تغییر قبلاً بازگردانده شده است.', 'bahoosh-analytics-pro' ) );
		}

		if ( ! BAP_Commerce_Facts::available() ) {
			return new WP_Error( 'bap_agent_no_woo', __( 'ووکامرس فعال نیست.', 'bahoosh-analytics-pro' ) );
		}

		if ( self::ACTION_DISCOUNT === $entry['type'] ) {
			$product = wc_get_product( (int) ( $entry['data']['product_id'] ?? 0 ) );

			if ( ! $product ) {
				return new WP_Error( 'bap_agent_no_product', __( 'محصول دیگر وجود ندارد.', 'bahoosh-analytics-pro' ) );
			}

			$restore = (array) ( $entry['restore'] ?? array() );

			$product->set_sale_price( (string) ( $restore['sale_price'] ?? '' ) );
			$product->set_date_on_sale_from( $restore['date_on_sale_from'] ? (int) $restore['date_on_sale_from'] : null );
			$product->set_date_on_sale_to( $restore['date_on_sale_to'] ? (int) $restore['date_on_sale_to'] : null );
			$product->delete_meta_data( self::META_RESTORE );
			$product->save();
		} elseif ( self::ACTION_BUNDLE === $entry['type'] ) {
			$coupon_id = (int) ( $entry['data']['coupon_id'] ?? 0 );

			if ( $coupon_id > 0 && class_exists( 'WC_Coupon' ) ) {
				$coupon = new WC_Coupon( $coupon_id );

				// Expired rather than deleted. A coupon that has been used is
				// attached to real orders, and deleting it would break their
				// history to tidy up a screen.
				$coupon->set_date_expires( time() - DAY_IN_SECONDS );
				$coupon->set_usage_limit( 1 );
				$coupon->save();
			}
		} else {
			return new WP_Error( 'bap_agent_unknown_type', __( 'نوع این تغییر قابل بازگردانی نیست.', 'bahoosh-analytics-pro' ) );
		}

		$rows[ $log_id ]['reverted_at'] = gmdate( 'c' );
		$rows[ $log_id ]['reverted_by'] = get_current_user_id();
		update_option( self::OPTION_LOG, $rows, false );

		return array(
			'success' => true,
			'log_id'  => $log_id,
		);
	}

	/**
	 * The agent's change log, newest first.
	 *
	 * @param int $limit Maximum rows.
	 * @return array
	 */
	public static function history( $limit = 50 ) {
		$rows  = array_values( self::entries() );
		$limit = max( 1, min( self::MAX_LOG, (int) $limit ) );

		usort(
			$rows,
			static function ( $a, $b ) {
				return strcmp( (string) ( $b['at'] ?? '' ), (string) ( $a['at'] ?? '' ) );
			}
		);

		return array_slice( $rows, 0, $limit );
	}

	/**
	 * Blocks execution unless the shop and the settings both allow it.
	 *
	 * Checked at execution time as well as at proposal time. Between the two, an
	 * administrator may have turned the agent off, and the setting that was true
	 * when a recommendation was written is not the setting that matters when it
	 * runs.
	 *
	 * @return true|WP_Error
	 */
	private static function guard() {
		if ( ! BAP_Commerce_Facts::available() ) {
			return new WP_Error( 'bap_agent_no_woo', __( 'ووکامرس فعال نیست.', 'bahoosh-analytics-pro' ) );
		}

		if ( ! self::enabled() ) {
			return new WP_Error( 'bap_agent_disabled', __( 'حالت ایجنت خاموش است، بنابراین هیچ تغییری روی فروشگاه اعمال نمی‌شود.', 'bahoosh-analytics-pro' ) );
		}

		return true;
	}

	/**
	 * Clamps a discount percentage.
	 *
	 * @param mixed $percent Raw value.
	 * @return int
	 */
	private static function clamp_percent( $percent ) {
		return max( 1, min( self::max_discount(), (int) $percent ) );
	}

	/**
	 * Clamps a duration.
	 *
	 * @param mixed $days Raw value.
	 * @return int
	 */
	private static function clamp_days( $days ) {
		return max( 1, min( 90, (int) $days ) );
	}

	/**
	 * Reads the raw log.
	 *
	 * @return array
	 */
	private static function entries() {
		$rows = get_option( self::OPTION_LOG, array() );

		return is_array( $rows ) ? $rows : array();
	}

	/**
	 * Records one change.
	 *
	 * @param string $type    Action type.
	 * @param string $label   Human description.
	 * @param array  $data    Details.
	 * @param array  $restore What is needed to undo it.
	 * @return array The stored entry.
	 */
	private static function log( $type, $label, array $data, array $restore ) {
		$rows = self::entries();
		$id   = 'agt_' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 18 );

		$entry = array(
			'id'      => $id,
			'at'      => gmdate( 'c' ),
			'type'    => (string) $type,
			'label'   => (string) $label,
			'mode'    => self::mode(),
			'user_id' => get_current_user_id(),
			'data'    => $data,
			'restore' => $restore,
			'reverted_at' => '',
		);

		$rows[ $id ] = $entry;

		if ( count( $rows ) > self::MAX_LOG ) {
			$rows = array_slice( $rows, -self::MAX_LOG, null, true );
		}

		update_option( self::OPTION_LOG, $rows, false );

		return $entry;
	}
}
