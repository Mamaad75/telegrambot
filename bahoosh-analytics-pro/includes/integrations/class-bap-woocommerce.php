<?php
/**
 * WooCommerce integration.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Ecommerce tracking.
 *
 * Browsing events are collected in the browser; `purchase` and `refund` are
 * emitted server-side from order hooks. That split is deliberate:
 *
 *   - A browser purchase event is *lost* whenever the shopper closes the tab
 *     during the redirect back from a payment gateway, and *duplicated*
 *     whenever they reload the thank-you page or the gateway returns twice.
 *   - Order hooks fire exactly where the money is, but WooCommerce fires
 *     several of them per order.
 *
 * So the event id is derived from the order id
 * (`BAP_Event_Factory::deterministic_event_id`). Every hook that observes the
 * same order produces the same id, and three independent layers collapse the
 * repeats: an order meta flag, the outbox's UNIQUE(event_id) index, and the
 * collector's unique index.
 */
class BAP_WooCommerce {

	const PURCHASE_META = '_bap_purchase_event_id';
	const ANON_META     = '_bap_anonymous_id';
	const CONSENT_META  = '_bap_analytics_consent';

	/**
	 * Device class the order was placed on.
	 *
	 * Recorded at checkout because that is the only moment it can be known. An
	 * order completed later by a payment gateway callback has no browser behind
	 * it, and guessing from the callback's user agent would attribute the sale to
	 * the gateway's server rather than to the shopper's phone.
	 *
	 * @since 4.3.0
	 * @var string
	 */
	const DEVICE_META = '_bap_device_type';

	/**
	 * Registers hooks.
	 *
	 * @return void
	 */
	public static function init() {
		if ( ! self::is_active() || ! BAP_Settings::get( 'woocommerce_enabled' ) ) {
			return;
		}

		// Capture the browsing identity on the order so a server-side purchase
		// joins the same identity as the sessions that led to it.
		add_action( 'woocommerce_checkout_create_order', array( __CLASS__, 'attach_identity' ), 10, 1 );
		add_action( 'woocommerce_store_api_checkout_update_order_from_request', array( __CLASS__, 'attach_identity' ), 10, 1 );

		if ( BAP_Settings::get( 'server_side_purchase' ) ) {
			add_action( 'woocommerce_thankyou', array( __CLASS__, 'track_purchase' ), 10, 1 );
			add_action( 'woocommerce_payment_complete', array( __CLASS__, 'track_purchase' ), 10, 1 );
			add_action( 'woocommerce_order_status_processing', array( __CLASS__, 'track_purchase' ), 10, 1 );
			add_action( 'woocommerce_order_status_completed', array( __CLASS__, 'track_purchase' ), 10, 1 );
			add_action( 'woocommerce_order_refunded', array( __CLASS__, 'track_refund' ), 10, 2 );
		}
	}

	/**
	 * Whether WooCommerce is available.
	 *
	 * @return bool
	 */
	public static function is_active() {
		// `WooCommerce` is a PHP class name, not display text. A localisation
		// pass once replaced it with the Persian word, which made this method
		// return false on every site and silently disabled the entire shop
		// integration — no purchase events, no refunds, no cart tracking.
		return class_exists( 'WooCommerce' ) && function_exists( 'WC' );
	}

	/**
	 * Whether browser-side ecommerce tracking should run for this request.
	 *
	 * @return bool
	 */
	public static function should_track() {
		return self::is_active()
			&& BAP_Settings::get( 'woocommerce_enabled' )
			&& BAP_Identity::should_track_current_user();
	}

	/**
	 * Classifies WooCommerce pages.
	 *
	 * @return string Empty string when this is not a WooCommerce page.
	 */
	public static function page_type() {
		if ( ! self::is_active() ) {
			return '';
		}
		if ( function_exists( 'is_product' ) && is_product() ) {
			return 'product';
		}
		if ( function_exists( 'is_cart' ) && is_cart() ) {
			return 'cart';
		}
		if ( function_exists( 'is_checkout' ) && is_checkout() ) {
			return 'checkout';
		}
		if ( function_exists( 'is_product_category' ) && is_product_category() ) {
			return 'product_category';
		}
		if ( function_exists( 'is_shop' ) && is_shop() ) {
			return 'shop';
		}
		return '';
	}

	/**
	 * Builds the `BAP_WC` browser configuration.
	 *
	 * @return array
	 */
	public static function build_config() {
		$page_type = self::page_type();

		$config = array(
			'page_type'  => $page_type,
			'currency'   => function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : '',
			'catalog'    => array(),
			'item_list'  => array(),
			'cart_items' => array(),
			'cart_total' => null,
			'coupons'    => array(),
		);

		if ( 'product' === $page_type ) {
			$product = function_exists( 'wc_get_product' ) ? wc_get_product( get_the_ID() ) : null;
			if ( $product ) {
				$config['product']                                = self::item_from_product( $product );
				$config['catalog'][ (string) $product->get_id() ] = $config['product'];
			}
		}

		if ( in_array( $page_type, array( 'shop', 'product_category' ), true ) || is_search() ) {
			$config['list_name'] = $page_type ? $page_type : 'search';
			$config['item_list'] = self::items_from_loop();
			foreach ( $config['item_list'] as $item ) {
				if ( ! empty( $item['item_id'] ) ) {
					$config['catalog'][ (string) $item['item_id'] ] = $item;
				}
			}
		}

		if ( in_array( $page_type, array( 'cart', 'checkout' ), true ) ) {
			$cart                 = self::cart_snapshot();
			$config['cart_items'] = $cart['items'];
			$config['cart_total'] = $cart['total'];
			$config['coupons']    = $cart['coupons'];
			foreach ( $cart['items'] as $item ) {
				if ( ! empty( $item['item_id'] ) ) {
					$config['catalog'][ (string) $item['item_id'] ] = $item;
				}
			}
		}

		/**
		 * Filters the WooCommerce tracker configuration.
		 *
		 * @param array $config Configuration.
		 */
		return apply_filters( 'bap_woocommerce_config', $config );
	}

	/**
	 * Stores the visitor's anonymous id on a new order.
	 *
	 * @param WC_Order $order Order being created.
	 * @return void
	 */
	public static function attach_identity( $order ) {
		if ( ! is_object( $order ) || ! method_exists( $order, 'update_meta_data' ) ) {
			return;
		}
		// The shopper's consent state is only observable here, during their own
		// request. Order hooks that fire later may run without a browser.
		$order->update_meta_data(
			self::CONSENT_META,
			BAP_Consent::allows_analytics() ? 'yes' : 'no'
		);

		// Same reasoning as the consent flag: observable now, unknowable later.
		// This is what lets the shop answer "do we sell more on mobile or on
		// desktop" with revenue instead of with visit counts.
		$device = self::detect_device();
		if ( '' !== $device ) {
			$order->update_meta_data( self::DEVICE_META, $device );
		}

		$anonymous_id = BAP_Identity::anonymous_id_from_cookie();
		if ( '' === $anonymous_id ) {
			return;
		}
		$order->update_meta_data( self::ANON_META, $anonymous_id );
	}

	/**
	 * Classifies the current request's device.
	 *
	 * Coarse on purpose: mobile, tablet or desktop. A full user-agent parser
	 * would be a dependency, a maintenance burden and a fingerprinting surface,
	 * and none of the decisions this data supports need more precision than
	 * "which of the three".
	 *
	 * WordPress ships `wp_is_mobile()`, which is used where it applies; tablets
	 * are separated first because `wp_is_mobile()` reports them as mobile and a
	 * shop optimising a phone checkout should not be counting iPads.
	 *
	 * @since 4.3.0
	 *
	 * @return string One of mobile|tablet|desktop, or '' when undeterminable.
	 */
	public static function detect_device() {
		if ( empty( $_SERVER['HTTP_USER_AGENT'] ) ) {
			return '';
		}

		$agent = strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) );

		if ( preg_match( '/ipad|tablet|playbook|silk|(android(?!.*mobile))/i', $agent ) ) {
			return 'tablet';
		}

		if ( function_exists( 'wp_is_mobile' ) && wp_is_mobile() ) {
			return 'mobile';
		}

		if ( preg_match( '/mobile|iphone|ipod|android|blackberry|windows phone/i', $agent ) ) {
			return 'mobile';
		}

		return 'desktop';
	}

	/**
	 * Emits exactly one `purchase` event per order.
	 *
	 * @param int $order_id Order id.
	 * @return bool Whether a new event was queued.
	 */
	public static function track_purchase( $order_id ) {
		$order_id = (int) $order_id;
		if ( $order_id <= 0 || ! function_exists( 'wc_get_order' ) ) {
			return false;
		}

		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return false;
		}

		// Layer 1: order meta. Cheap, and covers the common repeat-hook case
		// without touching the database queue at all.
		if ( $order->get_meta( self::PURCHASE_META ) ) {
			BAP_Logger::debug( 'purchase already tracked for order ' . $order_id );
			return false;
		}

		if ( ! self::may_record( $order ) ) {
			BAP_Logger::debug( 'purchase not recorded for order ' . $order_id . ' — analytics consent withheld' );
			BAP_Debug_Log::log(
				'woocommerce',
				'Purchase not recorded: consent withheld for this order',
				array( 'order_id' => $order_id )
			);
			return false;
		}

		// Layer 2: a deterministic id, so even if the meta write is lost the
		// event id stays the same and later layers still collapse it.
		$event_id = BAP_Event_Factory::deterministic_event_id( 'purchase', (string) $order_id );

		$identity = BAP_Identity::payload(
			array(
				'anonymous_id' => self::order_anonymous_id( $order ),
				'wp_user_id'   => (int) $order->get_customer_id(),
			)
		);

		$event = BAP_Event_Factory::build(
			'purchase',
			self::purchase_data( $order ),
			array(
				'event_id'         => $event_id,
				'identity'         => $identity,
				'timestamp_client' => self::order_timestamp( $order ),
			)
		);

		// Layer 3: UNIQUE(event_id) in the outbox table, and the same
		// constraint again on the collector.
		$queued = BAP_Outbox::enqueue( $event );

		$order->update_meta_data( self::PURCHASE_META, $event_id );
		$order->save();

		/**
		 * Fires after a purchase event has been queued.
		 *
		 * @param int    $order_id Order id.
		 * @param string $event_id Deterministic event id.
		 * @param bool   $queued   Whether this call created the queue row.
		 */
		do_action( 'bap_purchase_tracked', $order_id, $event_id, $queued );

		return $queued;
	}

	/**
	 * Emits a `refund` event, one per refund record.
	 *
	 * @param int $order_id  Order id.
	 * @param int $refund_id Refund id.
	 * @return bool
	 */
	public static function track_refund( $order_id, $refund_id ) {
		$order_id  = (int) $order_id;
		$refund_id = (int) $refund_id;
		if ( $order_id <= 0 || $refund_id <= 0 || ! function_exists( 'wc_get_order' ) ) {
			return false;
		}

		$order  = wc_get_order( $order_id );
		$refund = wc_get_order( $refund_id );
		if ( ! $order || ! $refund ) {
			return false;
		}

		if ( ! self::may_record( $order ) ) {
			return false;
		}

		$event = BAP_Event_Factory::build(
			'refund',
			array(
				'order_id'       => (string) $order_id,
				'transaction_id' => (string) $order->get_transaction_id(),
				'refund_id'      => (string) $refund_id,
				'currency'       => $order->get_currency(),
				'value'          => (float) $refund->get_amount(),
				'reason'         => (string) $refund->get_reason(),
			),
			array(
				'event_id' => BAP_Event_Factory::deterministic_event_id( 'refund', (string) $refund_id ),
				'identity' => BAP_Identity::payload(
					array(
						'anonymous_id' => self::order_anonymous_id( $order ),
						'wp_user_id'   => (int) $order->get_customer_id(),
					)
				),
			)
		);

		return BAP_Outbox::enqueue( $event );
	}

	/**
	 * Whether analytics consent permits recording an order.
	 *
	 * The decision is captured on the order at checkout, because that is the
	 * only moment the shopper's own consent state is observable. An order hook
	 * may fire later from cron or a gateway callback, where `$_COOKIE` belongs
	 * to nobody — falling back to the current request there would silently
	 * record data a visitor declined.
	 *
	 * @param WC_Order $order Order.
	 * @return bool
	 */
	private static function may_record( $order ) {
		$captured = $order->get_meta( self::CONSENT_META );

		if ( '' !== $captured && null !== $captured ) {
			return 'yes' === $captured;
		}

		// No captured decision: this order predates the plugin, or checkout ran
		// before the tracker did. Fall back to the site default rather than the
		// current request, which may be a cron process.
		if ( BAP_Settings::get( 'require_consent' ) ) {
			return false;
		}

		return true;
	}

	/**
	 * Builds the `purchase` payload.
	 *
	 * @param WC_Order $order Order.
	 * @return array
	 */
	private static function purchase_data( $order ) {
		$items = array();
		foreach ( $order->get_items() as $line ) {
			$product = $line->get_product();
			$items[] = array(
				'item_id'    => $product ? (string) $product->get_id() : '',
				'item_name'  => $line->get_name(),
				'item_sku'   => $product ? $product->get_sku() : '',
				'quantity'   => (int) $line->get_quantity(),
				'price'      => (float) $order->get_item_subtotal( $line, false, false ),
				'line_total' => (float) $line->get_total(),
				'categories' => $product ? self::product_categories( $product ) : array(),
			);
		}

		return array(
			'order_id'       => (string) $order->get_id(),
			'order_number'   => (string) $order->get_order_number(),
			'transaction_id' => (string) $order->get_transaction_id(),
			'currency'       => $order->get_currency(),
			'value'          => (float) $order->get_total(),
			'total_value'    => (float) $order->get_total(),
			'tax'            => (float) $order->get_total_tax(),
			'shipping'       => (float) $order->get_shipping_total(),
			'discount'       => (float) $order->get_discount_total(),
			'payment_method' => $order->get_payment_method(),
			'coupons'        => array_map( 'strval', $order->get_coupon_codes() ),
			'status'         => $order->get_status(),
			'items'          => $items,
			'item_count'     => count( $items ),
		);
	}

	/**
	 * Reads the anonymous id recorded on an order, falling back to the request.
	 *
	 * @param WC_Order $order Order.
	 * @return string
	 */
	private static function order_anonymous_id( $order ) {
		$stored = $order->get_meta( self::ANON_META );
		if ( BAP_Identity::is_valid_anonymous_id( $stored ) ) {
			return $stored;
		}
		return BAP_Identity::resolve_anonymous_id();
	}

	/**
	 * Order creation time as an ISO-8601 UTC string.
	 *
	 * @param WC_Order $order Order.
	 * @return string
	 */
	private static function order_timestamp( $order ) {
		$created = $order->get_date_created();
		if ( $created ) {
			return gmdate( 'Y-m-d\TH:i:s.v\Z', $created->getTimestamp() );
		}
		return gmdate( 'Y-m-d\TH:i:s.v\Z' );
	}

	/**
	 * Converts a product into an event item.
	 *
	 * @param WC_Product $product Product.
	 * @return array
	 */
	private static function item_from_product( $product ) {
		return array(
			'item_id'    => (string) $product->get_id(),
			'item_name'  => $product->get_name(),
			'item_sku'   => $product->get_sku(),
			'price'      => (float) $product->get_price(),
			'categories' => self::product_categories( $product ),
		);
	}

	/**
	 * Category names for a product.
	 *
	 * @param WC_Product $product Product.
	 * @return string[]
	 */
	private static function product_categories( $product ) {
		$terms = get_the_terms( $product->get_id(), 'product_cat' );
		if ( ! is_array( $terms ) ) {
			return array();
		}
		return array_values( wp_list_pluck( $terms, 'name' ) );
	}

	/**
	 * Items in the current archive loop.
	 *
	 * @return array
	 */
	private static function items_from_loop() {
		global $wp_query;
		$items = array();
		if ( ! isset( $wp_query->posts ) || ! is_array( $wp_query->posts ) ) {
			return $items;
		}

		foreach ( array_slice( $wp_query->posts, 0, 24 ) as $post ) {
			$product = function_exists( 'wc_get_product' ) ? wc_get_product( $post->ID ) : null;
			if ( $product ) {
				$items[] = self::item_from_product( $product );
			}
		}
		return $items;
	}

	/**
	 * Snapshot of the current cart.
	 *
	 * @return array{items:array,total:float|null,coupons:array}
	 */
	private static function cart_snapshot() {
		$snapshot = array(
			'items'   => array(),
			'total'   => null,
			'coupons' => array(),
		);

		if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
			return $snapshot;
		}

		foreach ( WC()->cart->get_cart() as $line ) {
			if ( empty( $line['data'] ) ) {
				continue;
			}
			$product             = $line['data'];
			$snapshot['items'][] = array(
				'item_id'   => (string) $product->get_id(),
				'item_name' => $product->get_name(),
				'item_sku'  => $product->get_sku(),
				'price'     => (float) $product->get_price(),
				'quantity'  => isset( $line['quantity'] ) ? (int) $line['quantity'] : 1,
			);
		}

		$snapshot['total']   = (float) WC()->cart->get_total( 'edit' );
		$snapshot['coupons'] = array_map( 'strval', WC()->cart->get_applied_coupons() );

		return $snapshot;
	}
}
