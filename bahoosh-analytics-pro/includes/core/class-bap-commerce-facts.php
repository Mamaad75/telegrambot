<?php
/**
 * Commerce facts derived from WooCommerce orders.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Turns the shop's own order history into facts a model can reason about.
 *
 * Everything here is computed from WooCommerce itself. That is not a fallback —
 * it is the better source. The orders are already in this database, they are
 * complete rather than sampled, they are not delayed by an export pipeline, and
 * they carry line items, so "which two products are bought together" is a fact
 * rather than an inference. No collector, no GA4, no network call.
 *
 * Two rules govern every method:
 *
 * 1. **A number without a sample size is not a fact.** Every returned figure
 *    carries the count it was computed from, so a recommendation built on four
 *    orders can be recognised as such instead of being presented with the same
 *    confidence as one built on four thousand.
 * 2. **Only completed money counts.** Statuses that represent an intention
 *    rather than a payment are excluded, or "best selling product" would rank
 *    whatever gets abandoned most.
 *
 * @since 4.3.0
 */
class BAP_Commerce_Facts {

	/**
	 * Order statuses that represent money actually taken.
	 *
	 * `processing` and `completed` only. Not `pending`, not `on-hold`, not
	 * `cancelled`, not `failed` — and not `refunded`, because a refunded order
	 * is a product that came back.
	 *
	 * @var string[]
	 */
	const PAID_STATUSES = array( 'wc-processing', 'wc-completed' );

	/**
	 * Below this many orders, the window is reported as too small to interpret.
	 *
	 * @var int
	 */
	const MIN_ORDERS = 10;

	/**
	 * Below this many co-occurrences, a product pair is coincidence.
	 *
	 * Two people buying the same two things is not a pattern. Five is still
	 * modest, but it is the point where a bundle suggestion stops being noise.
	 *
	 * @var int
	 */
	const MIN_PAIR_SUPPORT = 5;

	/**
	 * Maximum orders scanned in one build.
	 *
	 * A shop with 400,000 orders must not turn an admin page load into a table
	 * scan. The window is time-bounded first and capped second.
	 *
	 * @var int
	 */
	const MAX_ORDERS = 5000;

	/**
	 * Whether commerce facts can be produced at all.
	 *
	 * @return bool
	 */
	public static function available() {
		return BAP_WooCommerce::is_active() && function_exists( 'wc_get_orders' );
	}

	/**
	 * Loads paid orders in a window, newest first.
	 *
	 * Uses `wc_get_orders()` rather than a direct query so the result is correct
	 * on both legacy post storage and HPOS without this class knowing which is
	 * in use.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array<int,array{id:int,total:float,device:string,items:array<int,array{id:int,name:string,qty:int,total:float}>}>
	 */
	public static function orders( $from, $to ) {
		if ( ! self::available() ) {
			return array();
		}

		$orders = wc_get_orders(
			array(
				'limit'        => self::MAX_ORDERS,
				'status'       => self::PAID_STATUSES,
				'date_created' => $from . '...' . $to,
				'orderby'      => 'date',
				'order'        => 'DESC',
				'return'       => 'objects',
			)
		);

		$out = array();

		foreach ( (array) $orders as $order ) {
			if ( ! is_object( $order ) || ! method_exists( $order, 'get_items' ) ) {
				continue;
			}

			$items = array();

			foreach ( $order->get_items() as $item ) {
				if ( ! is_object( $item ) || ! method_exists( $item, 'get_product_id' ) ) {
					continue;
				}

				$product_id = (int) $item->get_product_id();
				if ( $product_id <= 0 ) {
					continue;
				}

				$items[] = array(
					'id'    => $product_id,
					'name'  => (string) $item->get_name(),
					'qty'   => (int) $item->get_quantity(),
					'total' => (float) $item->get_total(),
				);
			}

			if ( ! $items ) {
				continue;
			}

			$out[] = array(
				'id'     => (int) $order->get_id(),
				'total'  => (float) $order->get_total(),
				'device' => self::order_device( $order ),
				'items'  => $items,
			);
		}

		return $out;
	}

	/**
	 * The device a purchase was made on.
	 *
	 * Written to the order at checkout by {@see BAP_WooCommerce::attach_identity()}.
	 * Orders placed before that existed report `unknown` rather than being
	 * guessed into a bucket — a device split that quietly invents its own data
	 * is worse than one that admits a gap.
	 *
	 * @param object $order WooCommerce order.
	 * @return string
	 */
	public static function order_device( $order ) {
		if ( ! is_object( $order ) || ! method_exists( $order, 'get_meta' ) ) {
			return 'unknown';
		}

		return BAP_Rollup::normalize_device( $order->get_meta( BAP_WooCommerce::DEVICE_META ) );
	}

	/**
	 * Revenue, orders and average order value split by device.
	 *
	 * Answers "do we sell more on mobile or on desktop" with money rather than
	 * with traffic. Sessions by device are easy and misleading: mobile usually
	 * wins on visits and loses on revenue, and an administrator who optimises
	 * for the wrong one of those spends their effort in the wrong place.
	 *
	 * @param array $orders Orders from {@see self::orders()}.
	 * @return array<string,array{orders:int,revenue:float,aov:float,share:float}>
	 */
	public static function device_revenue( array $orders ) {
		$totals = array();

		foreach ( BAP_Rollup::DEVICES as $device ) {
			$totals[ $device ] = array(
				'orders'  => 0,
				'revenue' => 0.0,
				'aov'     => 0.0,
				'share'   => 0.0,
			);
		}

		$revenue_all = 0.0;

		foreach ( $orders as $order ) {
			$device = BAP_Rollup::normalize_device( $order['device'] );

			++$totals[ $device ]['orders'];
			$totals[ $device ]['revenue'] += (float) $order['total'];
			$revenue_all                  += (float) $order['total'];
		}

		foreach ( $totals as $device => $row ) {
			$totals[ $device ]['revenue'] = round( $row['revenue'], 2 );
			$totals[ $device ]['aov']     = $row['orders'] > 0 ? round( $row['revenue'] / $row['orders'], 2 ) : 0.0;
			$totals[ $device ]['share']   = $revenue_all > 0 ? round( ( $row['revenue'] / $revenue_all ) * 100, 1 ) : 0.0;
		}

		return $totals;
	}

	/**
	 * Products ranked by revenue.
	 *
	 * @param array $orders Orders from {@see self::orders()}.
	 * @return array<int,array{id:int,name:string,units:int,revenue:float,orders:int}> Sorted by revenue, descending.
	 */
	public static function product_performance( array $orders ) {
		$products = array();

		foreach ( $orders as $order ) {
			// Counted once per order, so a shopper buying six of one thing does
			// not look like six customers who wanted it.
			$seen = array();

			foreach ( $order['items'] as $item ) {
				$id = (int) $item['id'];

				if ( ! isset( $products[ $id ] ) ) {
					$products[ $id ] = array(
						'id'      => $id,
						'name'    => (string) $item['name'],
						'units'   => 0,
						'revenue' => 0.0,
						'orders'  => 0,
					);
				}

				$products[ $id ]['units']   += (int) $item['qty'];
				$products[ $id ]['revenue'] += (float) $item['total'];

				if ( ! isset( $seen[ $id ] ) ) {
					++$products[ $id ]['orders'];
					$seen[ $id ] = true;
				}
			}
		}

		foreach ( $products as $id => $row ) {
			$products[ $id ]['revenue'] = round( $row['revenue'], 2 );
		}

		usort(
			$products,
			static function ( $a, $b ) {
				return $b['revenue'] <=> $a['revenue'];
			}
		);

		return array_values( $products );
	}

	/**
	 * Products that sell least, among those the shop actually offers.
	 *
	 * Deliberately drawn from published, purchasable products rather than from
	 * the order history: a product that sold nothing at all does not appear in
	 * any order, and it is precisely the one the shop owner needs to hear about.
	 * Ranking only what already sold would systematically hide the worst cases.
	 *
	 * @param array $orders Orders from {@see self::orders()}.
	 * @param int   $limit  Maximum products.
	 * @return array<int,array{id:int,name:string,units:int,revenue:float,orders:int}>
	 */
	public static function slow_movers( array $orders, $limit = 10 ) {
		if ( ! self::available() ) {
			return array();
		}

		$sold = array();
		foreach ( self::product_performance( $orders ) as $row ) {
			$sold[ (int) $row['id'] ] = $row;
		}

		$catalog = wc_get_products(
			array(
				'limit'   => 200,
				'status'  => 'publish',
				'orderby' => 'date',
				'order'   => 'DESC',
				'return'  => 'objects',
			)
		);

		$slow = array();

		foreach ( (array) $catalog as $product ) {
			if ( ! is_object( $product ) || ! method_exists( $product, 'get_id' ) ) {
				continue;
			}

			$id = (int) $product->get_id();

			$slow[] = isset( $sold[ $id ] )
				? $sold[ $id ]
				: array(
					'id'      => $id,
					'name'    => (string) $product->get_name(),
					'units'   => 0,
					'revenue' => 0.0,
					'orders'  => 0,
				);
		}

		usort(
			$slow,
			static function ( $a, $b ) {
				// Revenue first, then units, so two products with no sales at all
				// still come back in a stable order.
				return array( $a['revenue'], $a['units'] ) <=> array( $b['revenue'], $b['units'] );
			}
		);

		return array_slice( $slow, 0, max( 1, (int) $limit ) );
	}

	/**
	 * Product pairs bought together, ranked by how surprising the pairing is.
	 *
	 * This is a market-basket count with a lift calculation on top, and the lift
	 * is what makes it worth doing. Raw co-occurrence just re-lists the two
	 * best-sellers: of course the two most popular products appear together most
	 * often, and bundling them teaches the shop nothing.
	 *
	 * Lift asks a better question — do these two appear together *more often than
	 * their individual popularity would predict?* A lift near 1 means the pairing
	 * is coincidence. A lift of 3 means buyers of one genuinely reach for the
	 * other, which is exactly the lipstick-and-lip-tint case a bundle should be
	 * built around.
	 *
	 * @param array $orders Orders from {@see self::orders()}.
	 * @param int   $limit  Maximum pairs.
	 * @return array<int,array{a:int,b:int,a_name:string,b_name:string,support:int,lift:float,confidence:float}>
	 */
	public static function product_affinity( array $orders, $limit = 10 ) {
		$basket_count  = 0;
		$product_count = array();
		$pair_count    = array();
		$names         = array();

		foreach ( $orders as $order ) {
			// Distinct products in this basket. A single-product order tells us
			// nothing about pairing and is skipped entirely.
			$ids = array();
			foreach ( $order['items'] as $item ) {
				$id           = (int) $item['id'];
				$ids[ $id ]   = true;
				$names[ $id ] = (string) $item['name'];
			}

			$ids = array_keys( $ids );

			if ( count( $ids ) < 2 ) {
				// Still counted towards the basket total: excluding it would
				// inflate every product's apparent co-purchase rate.
				++$basket_count;
				foreach ( $ids as $id ) {
					$product_count[ $id ] = ( $product_count[ $id ] ?? 0 ) + 1;
				}
				continue;
			}

			++$basket_count;
			sort( $ids );

			foreach ( $ids as $id ) {
				$product_count[ $id ] = ( $product_count[ $id ] ?? 0 ) + 1;
			}

			$total = count( $ids );
			for ( $i = 0; $i < $total; $i++ ) {
				for ( $j = $i + 1; $j < $total; $j++ ) {
					$key                = $ids[ $i ] . ':' . $ids[ $j ];
					$pair_count[ $key ] = ( $pair_count[ $key ] ?? 0 ) + 1;
				}
			}
		}

		if ( $basket_count < 1 ) {
			return array();
		}

		$pairs = array();

		foreach ( $pair_count as $key => $support ) {
			if ( $support < self::MIN_PAIR_SUPPORT ) {
				continue;
			}

			list( $a, $b ) = array_map( 'intval', explode( ':', $key ) );

			$count_a = $product_count[ $a ] ?? 0;
			$count_b = $product_count[ $b ] ?? 0;

			if ( $count_a < 1 || $count_b < 1 ) {
				continue;
			}

			// P(A and B) / (P(A) * P(B))
			$p_a      = $count_a / $basket_count;
			$p_b      = $count_b / $basket_count;
			$p_ab     = $support / $basket_count;
			$lift     = ( $p_a * $p_b ) > 0 ? $p_ab / ( $p_a * $p_b ) : 0.0;

			$pairs[] = array(
				'a'          => $a,
				'b'          => $b,
				'a_name'     => $names[ $a ] ?? (string) $a,
				'b_name'     => $names[ $b ] ?? (string) $b,
				'support'    => (int) $support,
				'lift'       => round( $lift, 2 ),
				// How often buyers of A also took B. The practical number for
				// deciding whether a bundle is worth offering.
				'confidence' => round( ( $support / $count_a ) * 100, 1 ),
			);
		}

		usort(
			$pairs,
			static function ( $a, $b ) {
				return array( $b['lift'], $b['support'] ) <=> array( $a['lift'], $a['support'] );
			}
		);

		return array_slice( $pairs, 0, max( 1, (int) $limit ) );
	}

	/**
	 * Currency code, for labelling figures that are money.
	 *
	 * @return string
	 */
	public static function currency() {
		return function_exists( 'get_woocommerce_currency' ) ? (string) get_woocommerce_currency() : '';
	}
}
