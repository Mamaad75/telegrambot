<?php
/**
 * Measures what the agent's changes actually did.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * The half of the agent that closes the loop.
 *
 * {@see BAP_Commerce_Agent} proposes a discount, applies it, and logs it. Until
 * this class existed, that was the end of the story: the shop owner could see
 * that a change had been made and could undo it, but nothing ever came back and
 * said whether it worked. An agent that acts and never checks is not running an
 * experiment, it is guessing repeatedly.
 *
 * **The control group is the rest of the catalogue, not a group of customers.**
 * This matters enough to be explicit about, because the plugin's ML side does
 * use customer holdouts ({@see BAP_ML_Actions::in_holdout()}) and the same trick
 * does not work here. A WooCommerce sale price is shown on the product page to
 * everybody; there is no supported way to show half the visitors one price and
 * half another, and faking it with session logic would be both fragile and, in
 * several jurisdictions, legally unwise. So the comparison used here is
 * difference-in-differences:
 *
 *     effect = (this product's change) − (the rest of the shop's change)
 *
 * over equal-length windows before and after. Subtracting the shop's own
 * movement is what stops a quiet fortnight or a Nowruz spike from being read as
 * the discount working. It is a weaker design than randomised assignment and it
 * is the strongest one the mechanism allows, which is why {@see self::verdict()}
 * refuses to call anything at all below a floor of units.
 *
 * Everything is measured in units per day, not totals, because the window after
 * a change is whatever has elapsed so far and is rarely the same length as the
 * window before it.
 *
 * @since 4.15.0
 */
class BAP_Agent_Effect {

	/**
	 * Cron hook that measures everything outstanding.
	 *
	 * @var string
	 */
	const CRON = 'bap_agent_measure';

	/**
	 * Days of observation before a first verdict is attempted.
	 *
	 * A discount's first two days are not its effect; they are the people who
	 * were already going to buy, arriving earlier. A week is the shortest window
	 * that contains one of every weekday.
	 *
	 * @var int
	 */
	const MIN_OBSERVE_DAYS = 7;

	/**
	 * Days of history used as the baseline.
	 *
	 * @var int
	 */
	const BASELINE_DAYS = 28;

	/**
	 * Units across both windows before any verdict is given.
	 *
	 * The honest floor. One sale before and two after is a 100% improvement and
	 * means nothing, and a plugin that announced that as a success would teach
	 * its owner to trust a number that cannot bear it.
	 *
	 * @var int
	 */
	const MIN_UNITS = 5;

	/**
	 * Net change, in percent, that counts as a real effect.
	 *
	 * @var int
	 */
	const MATERIAL_PC = 15;

	/**
	 * Entries measured in one cron pass.
	 *
	 * @var int
	 */
	const BATCH = 25;

	/**
	 * Registers the measurement cron.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::CRON, array( __CLASS__, 'measure_all' ) );
	}

	/**
	 * Makes sure the daily measurement job exists.
	 *
	 * Called when a change is applied rather than on every page load. A shop
	 * that never turns the agent on should not carry a daily job for it, and
	 * checking the log on each request to decide that would cost a query on
	 * every page to save one cron tick.
	 *
	 * @return void
	 */
	public static function ensure_scheduled() {
		if ( ! wp_next_scheduled( self::CRON ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CRON );
		}
	}

	/**
	 * Snapshot of how a product was selling before it was touched.
	 *
	 * Taken at apply time and stored on the log entry, because it cannot be
	 * recovered later: the price has changed, and "what it was doing before"
	 * stops being observable the moment the change lands.
	 *
	 * @param int[] $product_ids Products the action affects.
	 * @return array Baseline.
	 */
	public static function baseline( array $product_ids ) {
		$product_ids = array_values( array_unique( array_map( 'intval', $product_ids ) ) );
		$to          = gmdate( 'Y-m-d' );
		$from        = gmdate( 'Y-m-d', time() - ( self::BASELINE_DAYS * DAY_IN_SECONDS ) );

		$window = self::window( $product_ids, $from, $to );

		return array_merge(
			$window,
			array(
				'products' => $product_ids,
				'from'     => $from,
				'to'       => $to,
				'days'     => self::BASELINE_DAYS,
			)
		);
	}

	/**
	 * Measures every applied change that is old enough to judge.
	 *
	 * @return array<string,string> log_id => verdict, for logging and tests.
	 */
	public static function measure_all() {
		if ( ! BAP_Commerce_Facts::available() ) {
			return array();
		}

		$out  = array();
		$done = 0;

		foreach ( BAP_Commerce_Agent::history( BAP_Commerce_Agent::MAX_LOG ) as $entry ) {
			if ( $done >= self::BATCH ) {
				break;
			}

			$effect = self::measure( $entry );

			if ( null === $effect ) {
				continue;
			}

			BAP_Commerce_Agent::record_effect( (string) $entry['id'], $effect );

			$out[ (string) $entry['id'] ] = $effect['verdict'];
			++$done;
		}

		return $out;
	}

	/**
	 * Measures one log entry.
	 *
	 * @param array $entry Log entry.
	 * @return array|null Effect, or null when there is nothing to measure yet.
	 */
	public static function measure( array $entry ) {
		$baseline = (array) ( $entry['baseline'] ?? array() );
		$products = array_map( 'intval', (array) ( $baseline['products'] ?? array() ) );

		// Entries applied before this feature existed have no baseline, and one
		// cannot be reconstructed after the fact. They stay unmeasured rather
		// than being compared against a period that already contained the
		// change.
		if ( ! $products || empty( $entry['at'] ) ) {
			return null;
		}

		$applied = strtotime( (string) $entry['at'] );

		if ( ! $applied ) {
			return null;
		}

		$elapsed = (int) floor( ( time() - $applied ) / DAY_IN_SECONDS );

		if ( $elapsed < self::MIN_OBSERVE_DAYS ) {
			return null;
		}

		// A reverted change is still worth measuring, but only over the days it
		// was actually live.
		if ( ! empty( $entry['reverted_at'] ) ) {
			$reverted = strtotime( (string) $entry['reverted_at'] );
			$elapsed  = $reverted ? max( 1, (int) floor( ( $reverted - $applied ) / DAY_IN_SECONDS ) ) : $elapsed;

			if ( $elapsed < self::MIN_OBSERVE_DAYS ) {
				return null;
			}
		}

		$from  = gmdate( 'Y-m-d', $applied );
		$to    = gmdate( 'Y-m-d', $applied + ( $elapsed * DAY_IN_SECONDS ) );
		$after = self::window( $products, $from, $to );

		$before_days = max( 1, (int) ( $baseline['days'] ?? self::BASELINE_DAYS ) );

		$product_pc = self::change_pc(
			( (int) ( $baseline['units'] ?? 0 ) ) / $before_days,
			$after['units'] / $elapsed
		);

		// The control: the same catalogue minus the treated products, over the
		// same two windows. Excluding the treatment is the whole point — leave
		// it in and the discount partly measures itself.
		$shop_pc = self::change_pc(
			( (int) ( $baseline['control_units'] ?? 0 ) ) / $before_days,
			$after['control_units'] / $elapsed
		);

		$net = ( null === $product_pc || null === $shop_pc ) ? null : round( $product_pc - $shop_pc, 1 );

		return array(
			'measured_at'    => gmdate( 'c' ),
			'days'           => $elapsed,
			'baseline_days'  => $before_days,
			'units_before'   => (int) ( $baseline['units'] ?? 0 ),
			'units_after'    => $after['units'],
			'revenue_before' => (float) ( $baseline['revenue'] ?? 0 ),
			'revenue_after'  => $after['revenue'],
			'per_day_before' => round( ( (int) ( $baseline['units'] ?? 0 ) ) / $before_days, 3 ),
			'per_day_after'  => round( $after['units'] / $elapsed, 3 ),
			'product_pc'     => $product_pc,
			'shop_pc'        => $shop_pc,
			'net_pc'         => $net,
			'verdict'        => self::verdict( $net, (int) ( $baseline['units'] ?? 0 ), $after['units'] ),
		);
	}

	/**
	 * What the numbers are allowed to be called.
	 *
	 * The zero-baseline case is handled separately and deliberately, because it
	 * is the most common one the agent creates: discounting a product that sold
	 * nothing has no percentage change to report — every move from zero is an
	 * infinite improvement — and refusing to judge it would leave exactly the
	 * clearance experiments permanently unmeasured. There the question is the
	 * simpler one, and units answer it: did it start selling, or not.
	 *
	 * @param float|null $net    Net percentage change, or null when undefined.
	 * @param int        $before Units in the baseline window.
	 * @param int        $after  Units in the observation window.
	 * @return string One of `thin`, `worked`, `backfired`, `flat`.
	 */
	public static function verdict( $net, $before, $after ) {
		$before = max( 0, (int) $before );
		$after   = max( 0, (int) $after );

		if ( $before < 1 ) {
			return $after >= self::MIN_UNITS ? 'worked' : 'thin';
		}

		if ( null === $net || ( $before + $after ) < self::MIN_UNITS ) {
			return 'thin';
		}

		if ( $net >= self::MATERIAL_PC ) {
			return 'worked';
		}

		if ( $net <= -self::MATERIAL_PC ) {
			return 'backfired';
		}

		return 'flat';
	}

	/**
	 * The verdict in the shop owner's words.
	 *
	 * @param array $effect Effect record.
	 * @return string
	 */
	public static function explain( array $effect ) {
		$verdict = (string) ( $effect['verdict'] ?? 'thin' );
		$net     = $effect['net_pc'];
		$days    = (int) ( $effect['days'] ?? 0 );

		if ( 'thin' === $verdict ) {
			return sprintf(
				/* translators: 1: days observed, 2: minimum units. */
				__( 'بعد از %1$d روز، تعداد فروش کمتر از %2$d عدد بوده و هیچ نتیجه‌ای از آن درنمی‌آید. این یعنی «نمی‌دانیم»، نه «جواب نداد».', 'bahoosh-analytics-pro' ),
				$days,
				self::MIN_UNITS
			);
		}

		if ( 'worked' === $verdict && null === $net ) {
			return sprintf(
				/* translators: 1: units sold, 2: days observed. */
				__( 'این محصول پیش از تغییر قیمت هیچ فروشی نداشت و در %2$d روز بعد از آن %1$d عدد فروش رفته است. چون نقطه شروع صفر بوده، درصدی برای آن گزارش نمی‌شود — همان تعداد، خودش جواب است.', 'bahoosh-analytics-pro' ),
				(int) ( $effect['units_after'] ?? 0 ),
				$days
			);
		}

		if ( 'worked' === $verdict ) {
			return sprintf(
				/* translators: 1: net percent, 2: days observed. */
				__( 'در %2$d روز، فروش این محصول %1$s درصد بیشتر از بقیه فروشگاه رشد کرده است. این عدد تفاضلی است: حرکت کل فروشگاه از آن کم شده تا رونق یا رکود عمومی به حساب تخفیف نوشته نشود.', 'bahoosh-analytics-pro' ),
				number_format_i18n( abs( (float) $net ), 1 ),
				$days
			);
		}

		if ( 'backfired' === $verdict ) {
			return sprintf(
				/* translators: 1: net percent, 2: days observed. */
				__( 'در %2$d روز، فروش این محصول %1$s درصد بدتر از بقیه فروشگاه بوده است. تخفیف کمکی نکرده و حاشیه سود را هم کم کرده؛ بازگردانی کنید و دنبال علت دیگری بگردید.', 'bahoosh-analytics-pro' ),
				number_format_i18n( abs( (float) $net ), 1 ),
				$days
			);
		}

		return sprintf(
			/* translators: %d: days observed. */
			__( 'در %d روز، فروش این محصول تفاوت معناداری با بقیه فروشگاه نداشته است. قیمت گلوگاه این محصول نبوده — پس آن را برگردانید و سراغ عکس، توضیح و دیده‌شدن محصول بروید.', 'bahoosh-analytics-pro' ),
			$days
		);
	}

	/**
	 * Units, revenue and orders for a set of products, and for everything else.
	 *
	 * @param int[]  $product_ids Treated products.
	 * @param string $from        Y-m-d.
	 * @param string $to          Y-m-d.
	 * @return array{units:int,revenue:float,orders:int,control_units:int,control_revenue:float}
	 */
	private static function window( array $product_ids, $from, $to ) {
		$treated = array_fill_keys( array_map( 'intval', $product_ids ), true );

		$out = array(
			'units'           => 0,
			'revenue'         => 0.0,
			'orders'          => 0,
			'control_units'   => 0,
			'control_revenue' => 0.0,
		);

		foreach ( BAP_Commerce_Facts::orders( $from, $to ) as $order ) {
			$hit = false;

			foreach ( $order['items'] as $item ) {
				$id  = (int) $item['id'];
				$qty = (int) $item['qty'];

				if ( isset( $treated[ $id ] ) ) {
					$out['units']   += $qty;
					$out['revenue'] += (float) $item['total'];
					$hit             = true;
					continue;
				}

				$out['control_units']   += $qty;
				$out['control_revenue'] += (float) $item['total'];
			}

			if ( $hit ) {
				++$out['orders'];
			}
		}

		$out['revenue']         = round( $out['revenue'], 2 );
		$out['control_revenue'] = round( $out['control_revenue'], 2 );

		return $out;
	}

	/**
	 * Percentage change between two rates.
	 *
	 * Null when the before rate is zero: the change from nothing to something is
	 * not a percentage, and reporting it as one produces infinities that look
	 * like spectacular results. The unit floor in {@see self::verdict()} is what
	 * handles that case instead.
	 *
	 * @param float $before Per-day rate before.
	 * @param float $after  Per-day rate after.
	 * @return float|null
	 */
	private static function change_pc( $before, $after ) {
		if ( $before <= 0 ) {
			return null;
		}

		return round( ( ( $after - $before ) / $before ) * 100, 1 );
	}
}
