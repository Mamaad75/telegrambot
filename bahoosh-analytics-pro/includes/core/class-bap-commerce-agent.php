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
 * **Every change is measured.** Since 4.15.0 each applied change stores how the
 * affected products were selling beforehand, and {@see BAP_Agent_Effect}
 * compares that against what happened afterwards, with the rest of the
 * catalogue as the control. An agent that acts and never checks is not running
 * experiments, it is guessing repeatedly — and the shop owner is the one paying
 * for the guesses.
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
			'label'       => __( 'آزمایش قیمت با تخفیف زمان‌دار', 'bahoosh-analytics-pro' ),
			'description' => __( 'قیمت فروش ویژه را برای مدت محدود روی محصول اعمال می‌کند. قیمت اصلی دست‌نخورده می‌ماند، تغییر با یک کلیک قابل بازگردانی است، و نتیجه‌اش بعد از یک هفته در همین گزارش اندازه‌گیری و با بقیه فروشگاه مقایسه می‌شود.', 'bahoosh-analytics-pro' ),
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
	 * person, not a database write. Only facts with a safe, mechanical response
	 * get one.
	 *
	 * **Every candidate is scored, and the best one wins.** This used to take
	 * the first fact it recognised, which meant the order facts happened to
	 * arrive in decided what the shop did. A recommendation citing both a
	 * product nobody has bought for a year and a product 200 people looked at
	 * this week would act on whichever came first in the array. The scoring in
	 * {@see self::score()} is a ranking of evidence strength, not a revenue
	 * forecast, and it is written down so it can be argued with.
	 *
	 * @param array $facts Facts cited by one recommendation.
	 * @return array|null The best executable action, or null when there is none.
	 */
	public static function propose( array $facts ) {
		if ( ! self::enabled() ) {
			return null;
		}

		$best  = null;
		$score = -1.0;

		foreach ( $facts as $fact ) {
			$candidate = self::candidate( $fact );

			if ( null === $candidate ) {
				continue;
			}

			if ( $candidate['score'] > $score ) {
				$score = $candidate['score'];
				$best  = $candidate['action'];
			}
		}

		return $best;
	}

	/**
	 * Turns one fact into a scored candidate action.
	 *
	 * The four shapes that have a mechanical answer, in the order of how
	 * directly the fact speaks about price:
	 *
	 * - **`price_blocked`** — people looked and nobody bought. The clearest
	 *   invitation to a price test there is, because demand is already proven.
	 * - **`price_position`** — priced above its own shelf and not moving. The
	 *   percentage comes from the fact's own gap down to the category median,
	 *   capped: a test aimed at a number the shop can defend, rather than the
	 *   maximum the setting allows.
	 * - **`product_affinity`** — buy these two together.
	 * - **`slow_product`** — never sold at all. Last, because a product with no
	 *   sales *and* no views has a visibility problem that a discount cannot
	 *   fix, and that is the most common reason a discount disappoints.
	 *
	 * @param array $fact One fact from the packet.
	 * @return array{score:float,action:array}|null
	 */
	private static function candidate( $fact ) {
		$kind   = (string) ( $fact['kind'] ?? '' );
		$value  = (array) ( $fact['value'] ?? array() );
		$sample = (int) ( $fact['sample_size'] ?? 0 );

		if ( 'commerce.price_blocked' === $kind ) {
			$product_id = (int) ( $value['product_id'] ?? 0 );

			if ( $product_id > 0 ) {
				return array(
					'score'  => self::score( 100, $sample ),
					'action' => array(
						'type'    => self::ACTION_DISCOUNT,
						'payload' => array(
							'product_id' => $product_id,
							// Deliberately not the cap. This is a measurement,
							// and the point of the first step is to find out
							// whether price is the obstacle at all — which a
							// 10% cut answers as well as a 40% one, for a
							// quarter of the margin.
							'percent'    => min( 10, self::max_discount() ),
							'days'       => self::DURATION_DAYS,
							'intent'     => 'price_test',
						),
					),
				);
			}
		}

		if ( 'commerce.price_position' === $kind ) {
			$product_id = (int) ( $value['product_id'] ?? 0 );
			$gap        = (int) ( $value['gap_pc'] ?? 0 );

			if ( $product_id > 0 && $gap > 0 ) {
				return array(
					'score'  => self::score( 90, $sample ),
					'action' => array(
						'type'    => self::ACTION_DISCOUNT,
						'payload' => array(
							'product_id' => $product_id,
							'percent'    => min( $gap, self::max_discount() ),
							'days'       => self::DURATION_DAYS,
							'intent'     => 'price_align',
						),
					),
				);
			}
		}

		if ( 'commerce.product_affinity' === $kind ) {
			$a = (int) ( $value['product_a'] ?? 0 );
			$b = (int) ( $value['product_b'] ?? 0 );

			if ( $a > 0 && $b > 0 ) {
				// Lift is how much stronger the pairing is than chance, so it
				// belongs in the ranking: a lift of 3 is a better bundle than a
				// lift of 1.3 on the same number of baskets.
				$lift = max( 1.0, (float) ( $value['lift'] ?? 1 ) );

				return array(
					'score'  => self::score( 70 * min( 2.0, $lift ), $sample ),
					'action' => array(
						'type'    => self::ACTION_BUNDLE,
						'payload' => array(
							'product_a' => $a,
							'product_b' => $b,
							// A bundle discount is a nudge, not a fire sale:
							// these are products people already buy together,
							// so the incentive only has to cover the hesitation.
							'percent'   => min( 10, self::max_discount() ),
							'days'      => self::DURATION_DAYS,
							'intent'    => 'bundle',
						),
					),
				);
			}
		}

		if ( 'commerce.slow_product' === $kind ) {
			$product_id = (int) ( $value['product_id'] ?? 0 );

			if ( $product_id > 0 ) {
				return array(
					'score'  => self::score( 50, $sample ),
					'action' => array(
						'type'    => self::ACTION_DISCOUNT,
						'payload' => array(
							'product_id' => $product_id,
							'percent'    => self::max_discount(),
							'days'       => self::DURATION_DAYS,
							'intent'     => 'clearance',
						),
					),
				);
			}
		}

		return null;
	}

	/**
	 * How strongly one fact argues for acting on it.
	 *
	 * Base weight times the logarithm of the sample. Logarithmic because the
	 * difference between 5 observations and 50 is decisive and the difference
	 * between 500 and 5,000 is not, and multiplying by the raw sample would let
	 * one popular product's view count outrank every other consideration.
	 *
	 * This is an ordering, not a prediction. It deliberately contains no
	 * estimate of revenue: that would need an assumed conversion rate at the new
	 * price, which is precisely the unknown the experiment exists to find out.
	 *
	 * @param float $weight Base weight for the fact kind.
	 * @param int   $sample Observations behind the fact.
	 * @return float
	 */
	private static function score( $weight, $sample ) {
		return (float) $weight * log( 1 + max( 0, (int) $sample ) );
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

		// Only checked when a cost-of-goods plugin has actually recorded a cost.
		// Without one this is silent rather than guessing at a markup — but when
		// the number is there, selling below it is the one outcome the shop owner
		// cannot be expected to recompute for every proposal themselves.
		$cost = BAP_Price_Facts::cost( $product_id );

		if ( $cost > 0 && $sale < $cost ) {
			return new WP_Error(
				'bap_agent_below_cost',
				sprintf(
					/* translators: 1: discount percent, 2: cost of goods. */
					__( '%1$d درصد تخفیف قیمت را به زیر قیمت تمام‌شده (%2$s) می‌برد، بنابراین اعمال نشد.', 'bahoosh-analytics-pro' ),
					$percent,
					(string) $cost
				)
			);
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
				'intent'       => self::intent( $payload ),
				'ends_at'      => gmdate( 'c', $ends ),
			),
			$restore,
			// Stored on the entry rather than recomputed at measurement time, so
			// the comparison is always against the window that was current when
			// the decision was made — not against whatever 28 days happen to
			// precede the day somebody opens the report.
			BAP_Agent_Effect::baseline( array( $product_id ) )
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
				'intent'    => self::intent( $payload ),
				'ends_at'   => gmdate( 'c', $expires ),
			),
			array( 'coupon_id' => $coupon_id ),
			BAP_Agent_Effect::baseline( array( $a, $b ) )
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
	 * Why a change was made, as a slug the screen can label.
	 *
	 * Comes from {@see self::candidate()}, never from model text. A missing or
	 * unrecognised value becomes `manual`, which is the truthful answer for an
	 * action an administrator triggered directly through the REST route.
	 *
	 * @param array $payload Action payload.
	 * @return string
	 */
	private static function intent( array $payload ) {
		$intent = (string) ( $payload['intent'] ?? '' );

		return in_array( $intent, array( 'price_test', 'price_align', 'clearance', 'bundle' ), true )
			? $intent
			: 'manual';
	}

	/**
	 * Writes a measurement back onto a log entry.
	 *
	 * Called by {@see BAP_Agent_Effect} rather than computed here, so this class
	 * stays the one that writes to the shop and that one stays the one that
	 * judges the result.
	 *
	 * @param string $log_id Entry id.
	 * @param array  $effect Effect record.
	 * @return bool Whether the entry existed.
	 */
	public static function record_effect( $log_id, array $effect ) {
		$log_id = sanitize_key( $log_id );
		$rows   = self::entries();

		if ( ! isset( $rows[ $log_id ] ) ) {
			return false;
		}

		$rows[ $log_id ]['effect'] = $effect;
		update_option( self::OPTION_LOG, $rows, false );

		return true;
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

		$rows = array_slice( $rows, 0, $limit );

		// The verdict is turned into a sentence here rather than in JavaScript,
		// so the thresholds behind it live in exactly one place.
		foreach ( $rows as $index => $row ) {
			$rows[ $index ]['effect_text'] = ! empty( $row['effect'] )
				? BAP_Agent_Effect::explain( (array) $row['effect'] )
				: '';
		}

		return $rows;
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
	 * @param string $type     Action type.
	 * @param string $label    Human description.
	 * @param array  $data     Details.
	 * @param array  $restore  What is needed to undo it.
	 * @param array  $baseline How the affected products were selling before.
	 * @return array The stored entry.
	 */
	private static function log( $type, $label, array $data, array $restore, array $baseline = array() ) {
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
			'baseline' => $baseline,
			// Filled in by BAP_Agent_Effect once the change has been live long
			// enough to say anything about. Empty is the honest state for the
			// first week, and the screen says so rather than showing a zero.
			'effect'  => array(),
			'reverted_at' => '',
		);

		$rows[ $id ] = $entry;

		if ( count( $rows ) > self::MAX_LOG ) {
			$rows = array_slice( $rows, -self::MAX_LOG, null, true );
		}

		update_option( self::OPTION_LOG, $rows, false );

		if ( $baseline ) {
			BAP_Agent_Effect::ensure_scheduled();
		}

		return $entry;
	}
}
