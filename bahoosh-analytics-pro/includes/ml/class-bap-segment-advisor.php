<?php
/**
 * Turns customer segments into action proposals, without a model.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * What to do with each group of customers.
 *
 * The segments screen has always had an «پیشنهادهای AI» link that jumped to the
 * actions table. When the segmentation came from the notebook that table was
 * always empty, because the notebook sends segments and no actions — so the
 * link scrolled to the words "nothing proposed yet", which reads as a button
 * that does nothing.
 *
 * This class fills it. Every proposal is derived from the segment's own profile
 * by rules written here, so it needs no model, no API key and no network. The
 * segmentation already decided *who* these customers are; this decides what is
 * worth offering them, which is a much smaller question.
 *
 * **Nothing here executes anything.** Each proposal is handed to
 * {@see BAP_ML_REST::store_payload()}, the same entry point the Python service
 * uses, so it passes through {@see BAP_ML_Policy::evaluate()} exactly as a
 * remote proposal would: the same discount ceiling, the same duration limit,
 * the same approval rules. A proposal this class gets wrong is refused by the
 * same gate that refuses a model's.
 *
 * The rules encode one opinion worth stating plainly: **a discount is not the
 * answer to every segment.** Champions are offered recognition, not money off —
 * discounting people who already buy at full price is the most expensive
 * mistake in this screen. Customers who only ever buy on a coupon are not
 * offered another coupon. Only groups that have actually stopped buying get one.
 *
 * @since 4.18.0
 */
class BAP_Segment_Advisor {

	/**
	 * Recency, in days, past which a customer counts as gone rather than quiet.
	 *
	 * @var int
	 */
	const LAPSED_DAYS = 180;

	/**
	 * Share of a group's spend that has to be discount before the group is
	 * treated as coupon-driven rather than loyal.
	 *
	 * @var float
	 */
	const DISCOUNT_LED = 0.20;

	/**
	 * Orders per customer at which a group counts as repeat buyers.
	 *
	 * @var float
	 */
	const REPEAT_ORDERS = 2.5;

	/**
	 * Segments smaller than this are skipped: a campaign to six people is not
	 * worth an approval click, and a coupon code for them is noise in the
	 * coupon list.
	 *
	 * @var int
	 */
	const MIN_SEGMENT = 10;

	/**
	 * Builds and stores proposals for one run.
	 *
	 * @param string $run_id Run to advise on; latest when empty.
	 * @return array{run_id:string,proposed:int,skipped:int,result:array}
	 */
	public static function advise( $run_id = '' ) {
		$run_id   = '' !== $run_id ? $run_id : BAP_ML_Store::latest_run();
		$segments = $run_id ? BAP_ML_Store::segments( $run_id ) : array();

		if ( ! $segments ) {
			return array( 'run_id' => $run_id, 'proposed' => 0, 'skipped' => 0, 'result' => array() );
		}

		$policy  = BAP_ML_Policy::get();
		$actions = array();
		$skipped = 0;

		foreach ( $segments as $key => $segment ) {
			if ( (int) ( $segment['customer_count'] ?? 0 ) < self::MIN_SEGMENT ) {
				$skipped++;
				continue;
			}

			$proposal = self::for_segment( (string) $key, $segment, $policy );

			if ( null === $proposal ) {
				$skipped++;
				continue;
			}

			$actions[] = $proposal;
		}

		if ( ! $actions ) {
			return array( 'run_id' => $run_id, 'proposed' => 0, 'skipped' => $skipped, 'result' => array() );
		}

		// Deliberately the same door the network route uses. Re-validating here
		// would mean two copies of the policy, and the copy that is not the one
		// under test is the one that drifts.
		$result = BAP_ML_REST::store_payload(
			array(
				'run_id'  => $run_id,
				'actions' => $actions,
			)
		);

		return array(
			'run_id'   => $run_id,
			'proposed' => count( $result['actions'] ?? array() ),
			'skipped'  => $skipped,
			'result'   => $result,
		);
	}

	/**
	 * The one proposal a segment deserves, or null for "leave them alone".
	 *
	 * Returning null is a real answer and the right one more often than it
	 * looks: a group that is buying steadily at full price does not need an
	 * intervention, and proposing one anyway trains the shop owner to click
	 * approve without reading.
	 *
	 * @param string $key     Segment key.
	 * @param array  $segment Segment profile.
	 * @param array  $policy  Store policy.
	 * @return array|null
	 */
	private static function for_segment( $key, array $segment, array $policy ) {
		$label    = (string) ( $segment['label'] ?? $key );
		$people   = (int) ( $segment['customer_count'] ?? 0 );
		$recency  = (float) ( $segment['average_recency'] ?? 0 );
		$orders   = (float) ( $segment['average_frequency'] ?? 0 );
		$discount = (float) ( $segment['average_discount_share'] ?? 0 );
		$aov      = (float) ( $segment['average_aov'] ?? 0 );

		$max_discount = min( (float) $policy['max_discount_percent'], (float) BAP_Commerce_Agent::HARD_MAX_DISCOUNT );
		$max_days     = min( (int) $policy['max_coupon_duration_days'], BAP_ML_Policy::HARD_MAX_DURATION );

		// --- Gone, and used to be regular. The most valuable thing to recover.
		if ( $recency > self::LAPSED_DAYS ) {
			$depth = $orders >= self::REPEAT_ORDERS ? $max_discount : min( 10.0, $max_discount );

			return self::coupon(
				$key,
				$depth,
				min( 14, $max_days ),
				array(
					sprintf(
						/* translators: 1: segment label, 2: people, 3: days. */
						__( '«%1$s» شامل %2$s مشتری است که به‌طور میانگین %3$s روز است خریدی نکرده‌اند.', 'bahoosh-analytics-pro' ),
						$label,
						number_format_i18n( $people ),
						number_format_i18n( $recency )
					),
					$orders >= self::REPEAT_ORDERS
						? __( 'اینها قبلاً مشتری تکراری بوده‌اند، پس ارزش بازگرداندنشان از جذب مشتری تازه بیشتر است.', 'bahoosh-analytics-pro' )
						: __( 'یک‌بار خرید کرده‌اند و برنگشته‌اند؛ تخفیف کوچک برای آزمودن بازگشتشان.', 'bahoosh-analytics-pro' ),
					__( 'بخشی از این گروه عمداً کوپن نمی‌گیرد تا اثر واقعی کمپین قابل اندازه‌گیری باشد.', 'bahoosh-analytics-pro' ),
				),
				$orders >= self::REPEAT_ORDERS ? 0.75 : 0.6,
				(int) $policy['default_holdout_percent']
			);
		}

		// --- Only ever buys on a coupon. Another coupon makes it worse.
		if ( $discount >= self::DISCOUNT_LED ) {
			return self::campaign(
				$key,
				__( 'پیشنهاد ویژه، بدون کد تخفیف', 'bahoosh-analytics-pro' ),
				sprintf(
					/* translators: %s: segment label. */
					__( 'این پیام برای گروه «%s» نوشته شده است. این گروه تقریباً همیشه با کد تخفیف خرید می‌کند، بنابراین متن را روی ارزش محصول بنویسید نه روی قیمت: ارسال سریع‌تر، ضمانت، یا دسترسی زودتر به محصول تازه. اگر باز هم تخفیف بدهید، همین الگو را تثبیت می‌کنید و حاشیه سود را از دست می‌دهید.', 'bahoosh-analytics-pro' ),
					$label
				),
				array(
					sprintf(
						/* translators: 1: segment label, 2: percentage. */
						__( '«%1$s» به‌طور میانگین %2$s درصد از خریدش را با تخفیف انجام می‌دهد.', 'bahoosh-analytics-pro' ),
						$label,
						number_format_i18n( 100 * $discount, 1 )
					),
					__( 'به این گروه کوپن پیشنهاد نشد: تخفیف دوباره، همان رفتاری را تقویت می‌کند که مشکل است.', 'bahoosh-analytics-pro' ),
				),
				0.7
			);
		}

		// --- Buying steadily at full price. The one group to leave alone.
		if ( $orders >= self::REPEAT_ORDERS ) {
			return self::campaign(
				$key,
				__( 'دسترسی زودتر برای مشتریان همیشگی', 'bahoosh-analytics-pro' ),
				sprintf(
					/* translators: 1: segment label, 2: orders. */
					__( 'این پیام برای گروه «%1$s» است؛ مشتریانی که به‌طور میانگین %2$s بار خرید کرده‌اند و تخفیف هم نمی‌خواهند. متن را روی قدردانی و دسترسی زودتر به محصولات تازه بگذارید. تخفیف دادن به این گروه یعنی پول گذاشتن روی فروشی که در هر حال انجام می‌شد.', 'bahoosh-analytics-pro' ),
					$label,
					number_format_i18n( $orders, 1 )
				),
				array(
					sprintf(
						/* translators: 1: segment label, 2: orders, 3: discount share. */
						__( '«%1$s»: میانگین %2$s سفارش و تنها %3$s درصد خرید با تخفیف.', 'bahoosh-analytics-pro' ),
						$label,
						number_format_i18n( $orders, 1 ),
						number_format_i18n( 100 * $discount, 1 )
					),
					__( 'عمداً هیچ تخفیفی پیشنهاد نشد. این گروه بدون آن هم می‌خرد.', 'bahoosh-analytics-pro' ),
				),
				0.8
			);
		}

		// --- Bought once, recently. The whole job is the second purchase.
		if ( $orders < 2 && $recency <= 60 ) {
			return self::coupon(
				$key,
				min( 10.0, $max_discount ),
				min( 10, $max_days ),
				array(
					sprintf(
						/* translators: 1: segment label, 2: people. */
						__( '«%1$s» شامل %2$s مشتری تازه است که یک بار خرید کرده‌اند.', 'bahoosh-analytics-pro' ),
						$label,
						number_format_i18n( $people )
					),
					__( 'خرید دوم بیشترین اثر را بر ماندگاری مشتری دارد؛ تخفیف کوچک و کوتاه برای همان یک قدم.', 'bahoosh-analytics-pro' ),
				),
				0.65,
				(int) $policy['default_holdout_percent']
			);
		}

		// --- Everyone else: no clear pattern, so no confident proposal.
		unset( $aov );
		return null;
	}

	/**
	 * A coupon proposal for a segment.
	 *
	 * @param string $segment  Segment key.
	 * @param float  $percent  Discount percent.
	 * @param int    $days     Duration.
	 * @param array  $reason   Why, in the shop owner's language.
	 * @param float  $certain  Confidence, 0-1.
	 * @param int    $holdout  Control-group percentage.
	 * @return array
	 */
	private static function coupon( $segment, $percent, $days, array $reason, $certain, $holdout ) {
		return array(
			'action_id'   => self::uuid(),
			'action_type' => 'create_coupon_for_segment',
			'target'      => array( 'segment_key' => $segment ),
			'parameters'  => array(
				'discount_type'   => 'percent',
				'discount_value'  => round( max( 1.0, $percent ), 2 ),
				'duration_days'   => max( 1, (int) $days ),
				'holdout_percent' => max( 0, min( 50, (int) $holdout ) ),
			),
			'reason'      => $reason,
			'confidence'  => $certain,
			'source'      => 'rules',
		);
	}

	/**
	 * A campaign proposal for a segment.
	 *
	 * @param string $segment Segment key.
	 * @param string $subject Subject line.
	 * @param string $message Body.
	 * @param array  $reason  Why.
	 * @param float  $certain Confidence, 0-1.
	 * @return array
	 */
	private static function campaign( $segment, $subject, $message, array $reason, $certain ) {
		return array(
			'action_id'   => self::uuid(),
			'action_type' => 'create_campaign',
			'target'      => array( 'segment_key' => $segment ),
			'parameters'  => array(
				'subject' => $subject,
				'message' => $message,
			),
			'reason'      => $reason,
			'confidence'  => $certain,
			'source'      => 'rules',
		);
	}

	/**
	 * A v4 UUID in the shape the action id must match.
	 *
	 * @return string
	 */
	private static function uuid() {
		return function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : sprintf(
			'%04x%04x-%04x-4%03x-%04x-%04x%04x%04x',
			wp_rand( 0, 0xffff ), wp_rand( 0, 0xffff ), wp_rand( 0, 0xffff ), wp_rand( 0, 0x0fff ),
			wp_rand( 0, 0x3fff ) | 0x8000, wp_rand( 0, 0xffff ), wp_rand( 0, 0xffff ), wp_rand( 0, 0xffff )
		);
	}
}
