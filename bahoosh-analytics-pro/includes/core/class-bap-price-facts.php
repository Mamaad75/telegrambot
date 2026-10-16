<?php
/**
 * Facts about price, derived from the shop's own catalogue and orders.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * The numbers that make a price worth changing.
 *
 * Everything else the analysis packet carries answers *what happened*: which
 * device earns more, where the funnel leaks, which products sell. None of it
 * mentions a price, and that was a real hole. A model cannot recommend a price
 * change from facts that contain no prices, and {@see BAP_Commerce_Agent} only
 * builds actions out of facts a recommendation cites — so the one verb that
 * writes a price could effectively never fire, and the advice an administrator
 * read was always about photographs, titles and page layout.
 *
 * This class fills that hole with three questions a shop owner can act on
 * tomorrow, each answered from data WooCommerce already holds:
 *
 * - **Is anybody looking and not buying?** Views with no purchases is the one
 *   case where a price test is the cheapest possible experiment: demand is
 *   proven, conversion is not.
 * - **Is this product expensive for its own shelf?** A product priced well
 *   above the median of its own category, selling less than its neighbours, has
 *   a specific and testable number attached to it — the gap down to that median.
 * - **Is the list price fiction?** When most orders only close with a coupon,
 *   the shop has already cut its prices; it just has not admitted it, and it is
 *   paying a discount on buyers who would have paid full price.
 *
 * Two deliberate omissions. There is no elasticity estimate: that needs prices
 * observed at more than one level for the same product, which a shop that has
 * never run a price test does not have — which is the point of running one.
 * And there is no margin figure unless a cost-of-goods plugin has stored one;
 * {@see self::cost()} reads that meta when it exists and reports nothing when it
 * does not, rather than assuming a markup.
 *
 * @since 4.15.0
 */
class BAP_Price_Facts {

	/**
	 * Views a product needs before "nobody bought it" means anything.
	 *
	 * Below this the sample is too thin to separate a pricing problem from a
	 * quiet week, and a price test launched on four page views is noise with a
	 * discount attached.
	 *
	 * @var int
	 */
	const MIN_VIEWS = 20;

	/**
	 * Products in a category before its median price is meaningful.
	 *
	 * A "median" of two products is just the cheaper one, and comparing a
	 * product against a single neighbour produces confident nonsense.
	 *
	 * @var int
	 */
	const MIN_PEERS = 4;

	/**
	 * How far above its peers a price has to sit to be worth questioning.
	 *
	 * 1.3 rather than 1.05: shops stock different tiers on purpose, and a
	 * product 8% above the median of its category is normal variation, not a
	 * mistake. At 30% the gap is a positioning decision, and a decision is
	 * something that can be tested.
	 *
	 * @var float
	 */
	const PEER_RATIO = 1.3;

	/**
	 * Share of orders carrying a coupon that makes the list price questionable.
	 *
	 * @var int Percent.
	 */
	const COUPON_HEAVY = 40;

	/**
	 * Products reported per fact kind.
	 *
	 * @var int
	 */
	const MAX_PRODUCTS = 5;

	/**
	 * Cost-of-goods meta keys written by the common WooCommerce plugins.
	 *
	 * Read, never written. The only use is refusing a discount that would sell
	 * below cost, which is a guard the shop owner cannot be expected to
	 * recompute in their head for every proposal.
	 *
	 * @var string[]
	 */
	const COST_META = array( '_wc_cog_cost', '_alg_wc_cog_cost', '_wc_cost_of_goods' );

	/**
	 * Builds every price fact available for a window.
	 *
	 * @param array  $orders   Orders from {@see BAP_Commerce_Facts::orders()}.
	 * @param string $from     Y-m-d.
	 * @param string $to       Y-m-d.
	 * @param array  $warnings Warnings, by reference.
	 * @return array<int,array{kind:string,id:string,label:string,value:array,sample_size:int,dimensions:array}>
	 */
	public static function all( array $orders, $from, $to, array &$warnings ) {
		if ( ! BAP_Commerce_Facts::available() ) {
			return array();
		}

		$facts = array();

		$coupon = self::coupon_reliance( $orders );
		if ( $coupon ) {
			$facts[] = $coupon;
		}

		$blocked = self::price_blocked( $from, $to );
		if ( ! $blocked ) {
			$warnings[] = sprintf(
				/* translators: %d: minimum page views. */
				__( 'هیچ محصولی در این بازه دست‌کم %d بازدید صفحه بدون خرید نداشت، بنابراین هیچ کاندید آزمایش قیمت از روی رفتار پیدا نشد.', 'bahoosh-analytics-pro' ),
				self::MIN_VIEWS
			);
		}

		return array_merge( $facts, $blocked, self::price_position( $orders ) );
	}

	/**
	 * How much of the shop's revenue only closes with a coupon.
	 *
	 * The gap between a line's subtotal and its total is the discount that was
	 * actually granted, per product, in money. Summed across a window it is the
	 * single most direct pricing fact a WooCommerce shop has, and until now the
	 * plugin threw it away.
	 *
	 * @param array $orders Orders.
	 * @return array|null Fact, or null when there is nothing to say.
	 */
	public static function coupon_reliance( array $orders ) {
		if ( count( $orders ) < BAP_Commerce_Facts::MIN_ORDERS ) {
			return null;
		}

		$with    = 0;
		$without = 0;
		$rev_with    = 0.0;
		$rev_without = 0.0;
		$given       = 0.0;

		foreach ( $orders as $order ) {
			$discount = 0.0;

			foreach ( $order['items'] as $item ) {
				$discount += max( 0.0, (float) $item['subtotal'] - (float) $item['total'] );
			}

			if ( $discount > 0 ) {
				++$with;
				$rev_with += (float) $order['total'];
				$given    += $discount;
			} else {
				++$without;
				$rev_without += (float) $order['total'];
			}
		}

		$total = $with + $without;

		if ( $total < 1 || $with < 1 ) {
			return null;
		}

		return array(
			'kind'        => 'commerce.coupon_reliance',
			'id'          => 'coupon_reliance',
			'label'       => __( 'سهم سفارش‌هایی که با تخفیف بسته شده‌اند', 'bahoosh-analytics-pro' ),
			'value'       => array(
				'orders_with_discount' => $with,
				'orders_total'         => $total,
				'share_pc'             => round( ( $with / $total ) * 100, 1 ),
				'aov_with'             => $with > 0 ? round( $rev_with / $with, 2 ) : 0.0,
				'aov_without'          => $without > 0 ? round( $rev_without / $without, 2 ) : 0.0,
				'discount_given'       => round( $given, 2 ),
				'currency'             => BAP_Commerce_Facts::currency(),
			),
			'sample_size' => $total,
			'dimensions'  => array(),
		);
	}

	/**
	 * Products people look at and nobody buys.
	 *
	 * Built from the product funnel, which is keyed by product name because
	 * browser events carry a name rather than an id. The name is mapped back to
	 * a real catalogue id here, and anything that does not map is dropped — an
	 * action must never be built around a guess at which product was meant.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array Facts.
	 */
	public static function price_blocked( $from, $to ) {
		$funnel = BAP_Local_Reports::product_funnel( $from, $to );
		$ids    = self::name_index();

		if ( ! $ids ) {
			return array();
		}

		$rows = array();

		foreach ( (array) $funnel['products'] as $row ) {
			$views = (int) $row['view_item'];

			if ( $views < self::MIN_VIEWS || (int) $row['purchase'] > 0 ) {
				continue;
			}

			$key = self::normalize( (string) $row['name'] );

			if ( ! isset( $ids[ $key ] ) ) {
				continue;
			}

			$product = wc_get_product( $ids[ $key ] );
			$price   = $product ? (float) $product->get_regular_price() : 0.0;

			if ( ! $product || $price <= 0 ) {
				continue;
			}

			$rows[] = array(
				'product_id'  => (int) $ids[ $key ],
				'name'        => (string) $product->get_name(),
				'price'       => $price,
				'views'       => $views,
				'add_to_cart' => (int) $row['add_to_cart'],
				'purchases'   => 0,
				'currency'    => BAP_Commerce_Facts::currency(),
			);
		}

		usort( $rows, static fn( $a, $b ) => $b['views'] <=> $a['views'] );

		$facts = array();

		foreach ( array_slice( $rows, 0, self::MAX_PRODUCTS ) as $row ) {
			$facts[] = array(
				'kind'        => 'commerce.price_blocked',
				'id'          => 'price_blocked_' . $row['product_id'],
				'label'       => sprintf(
					/* translators: 1: product name, 2: number of views. */
					__( '«%1$s»: %2$d بازدید، صفر خرید', 'bahoosh-analytics-pro' ),
					$row['name'],
					$row['views']
				),
				'value'       => $row,
				'sample_size' => $row['views'],
				'dimensions'  => array( 'product_id' => (string) $row['product_id'] ),
			);
		}

		return $facts;
	}

	/**
	 * Products priced above the median of their own category and selling less.
	 *
	 * The comparison is deliberately within a category rather than across the
	 * shop. A shop-wide median says a laptop is expensive next to a phone case,
	 * which is true and useless.
	 *
	 * @param array $orders Orders, for the units each product actually sold.
	 * @return array Facts.
	 */
	public static function price_position( array $orders ) {
		$catalog = self::catalog();

		if ( ! $catalog ) {
			return array();
		}

		$units = array();
		foreach ( BAP_Commerce_Facts::product_performance( $orders ) as $row ) {
			$units[ (int) $row['id'] ] = (int) $row['units'];
		}

		// Prices grouped by category, so every product can be compared against
		// the shelf it actually sits on.
		$shelves = array();
		foreach ( $catalog as $row ) {
			foreach ( $row['categories'] as $term_id ) {
				$shelves[ $term_id ][] = $row['price'];
			}
		}

		$rows = array();

		foreach ( $catalog as $row ) {
			$best = null;

			foreach ( $row['categories'] as $term_id ) {
				$peers = $shelves[ $term_id ] ?? array();

				if ( count( $peers ) < self::MIN_PEERS ) {
					continue;
				}

				$median = self::median( $peers );

				if ( $median <= 0 ) {
					continue;
				}

				$ratio = $row['price'] / $median;

				// The weakest qualifying shelf wins: if a product looks normal
				// on any of its categories, calling it overpriced on another is
				// an argument the shop owner will rightly reject.
				if ( null === $best || $ratio < $best['ratio'] ) {
					$best = array(
						'ratio'       => $ratio,
						'median'      => $median,
						'peers'       => count( $peers ),
						'category'    => self::category_name( $term_id ),
						'category_id' => $term_id,
					);
				}
			}

			if ( null === $best || $best['ratio'] < self::PEER_RATIO ) {
				continue;
			}

			$sold = $units[ $row['id'] ] ?? 0;

			// Expensive *and* selling well is a premium product doing its job.
			// Only the ones that are expensive and stuck are worth a test.
			$peer_units = self::peer_units( $catalog, $best['category_id'], $units, $row['id'] );

			if ( $sold > $peer_units ) {
				continue;
			}

			$rows[] = array(
				'product_id'  => $row['id'],
				'name'        => $row['name'],
				'price'       => $row['price'],
				'category'    => $best['category'],
				'peer_median' => round( $best['median'], 2 ),
				'peers'       => $best['peers'],
				'ratio'       => round( $best['ratio'], 2 ),
				'units'       => $sold,
				'peer_units'  => $peer_units,
				// How far the price would have to fall to reach the shelf's
				// middle. The one number in this fact that an action can use.
				'gap_pc'      => (int) round( 100 - ( 100 / $best['ratio'] ) ),
				'currency'    => BAP_Commerce_Facts::currency(),
			);
		}

		usort( $rows, static fn( $a, $b ) => $b['ratio'] <=> $a['ratio'] );

		$facts = array();

		foreach ( array_slice( $rows, 0, self::MAX_PRODUCTS ) as $row ) {
			$facts[] = array(
				'kind'        => 'commerce.price_position',
				'id'          => 'price_position_' . $row['product_id'],
				'label'       => sprintf(
					/* translators: 1: product name, 2: ratio, 3: category name. */
					__( '«%1$s» %2$s برابر میانه قیمت دسته «%3$s» است', 'bahoosh-analytics-pro' ),
					$row['name'],
					number_format_i18n( $row['ratio'], 1 ),
					$row['category']
				),
				'value'       => $row,
				'sample_size' => $row['peers'],
				'dimensions'  => array( 'product_id' => (string) $row['product_id'] ),
			);
		}

		return $facts;
	}

	/**
	 * Cost of goods, when a plugin has recorded one.
	 *
	 * @param int $product_id Product.
	 * @return float Zero when unknown — never a guess.
	 */
	public static function cost( $product_id ) {
		$product = $product_id > 0 ? wc_get_product( $product_id ) : null;

		if ( ! $product || ! method_exists( $product, 'get_meta' ) ) {
			return 0.0;
		}

		foreach ( self::COST_META as $key ) {
			$value = $product->get_meta( $key );

			if ( is_numeric( $value ) && (float) $value > 0 ) {
				return (float) $value;
			}
		}

		return 0.0;
	}

	/**
	 * Published, priced products with their categories.
	 *
	 * @return array<int,array{id:int,name:string,price:float,categories:int[]}>
	 */
	private static function catalog() {
		$products = wc_get_products(
			array(
				'limit'   => 200,
				'status'  => 'publish',
				'orderby' => 'date',
				'order'   => 'DESC',
				'return'  => 'objects',
			)
		);

		$out = array();

		foreach ( (array) $products as $product ) {
			if ( ! is_object( $product ) || ! method_exists( $product, 'get_id' ) ) {
				continue;
			}

			$price = (float) $product->get_regular_price();

			if ( $price <= 0 ) {
				continue;
			}

			$categories = method_exists( $product, 'get_category_ids' )
				? array_map( 'intval', (array) $product->get_category_ids() )
				: array();

			$out[] = array(
				'id'         => (int) $product->get_id(),
				'name'       => (string) $product->get_name(),
				'price'      => $price,
				'categories' => array_values( array_filter( $categories ) ),
			);
		}

		return $out;
	}

	/**
	 * Median units sold by the other products on one shelf.
	 *
	 * @param array $catalog  Catalogue.
	 * @param int   $term_id  Category.
	 * @param array $units    product_id => units.
	 * @param int   $exclude  The product being judged.
	 * @return int
	 */
	private static function peer_units( array $catalog, $term_id, array $units, $exclude ) {
		$values = array();

		foreach ( $catalog as $row ) {
			if ( $row['id'] === $exclude || ! in_array( $term_id, $row['categories'], true ) ) {
				continue;
			}

			$values[] = $units[ $row['id'] ] ?? 0;
		}

		return $values ? (int) round( self::median( $values ) ) : 0;
	}

	/**
	 * Catalogue index from normalised product name to id.
	 *
	 * @return array<string,int>
	 */
	private static function name_index() {
		$index = array();

		foreach ( self::catalog() as $row ) {
			$key = self::normalize( $row['name'] );

			if ( '' === $key || isset( $index[ $key ] ) ) {
				// A duplicate name cannot be resolved to one product, so both
				// are dropped rather than one of them picked arbitrarily.
				$index[ $key ] = isset( $index[ $key ] ) ? 0 : $row['id'];
				continue;
			}

			$index[ $key ] = $row['id'];
		}

		return array_filter( $index );
	}

	/**
	 * Category name, for the label.
	 *
	 * @param int $term_id Term.
	 * @return string
	 */
	private static function category_name( $term_id ) {
		if ( ! function_exists( 'get_term' ) ) {
			return (string) $term_id;
		}

		$term = get_term( (int) $term_id, 'product_cat' );

		return ( $term && ! is_wp_error( $term ) && isset( $term->name ) )
			? (string) $term->name
			: (string) $term_id;
	}

	/**
	 * Middle value of a list.
	 *
	 * @param array $values Numbers.
	 * @return float
	 */
	private static function median( array $values ) {
		$values = array_values( array_map( 'floatval', $values ) );

		if ( ! $values ) {
			return 0.0;
		}

		sort( $values );
		$count = count( $values );
		$half  = intdiv( $count, 2 );

		return 0 === $count % 2
			? ( $values[ $half - 1 ] + $values[ $half ] ) / 2
			: $values[ $half ];
	}

	/**
	 * Comparison form of a product name.
	 *
	 * The same normalisation Search Rescue uses, for the same reason: a browser
	 * event and a catalogue row disagree about Arabic yeh, kaf and spacing far
	 * more often than they disagree about the product.
	 *
	 * @param string $text Raw name.
	 * @return string
	 */
	private static function normalize( $text ) {
		return BAP_Search_Rescue::normalize( $text );
	}
}
