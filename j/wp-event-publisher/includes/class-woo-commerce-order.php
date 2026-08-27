<?php
/**
 * WooCommerce order reader.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Reads one WooCommerce order into a flat, predictable array.
 *
 * Everything here goes through `wc_get_order()` and the `WC_Order` getters,
 * never through post meta. That is not a stylistic preference: with High
 * Performance Order Storage an order is a row in `wc_orders`, not a post, so
 * `get_post_meta( $order_id, '_billing_phone' )` returns nothing at all on a
 * modern shop. Reading through the CRUD API is what makes this work on both
 * storage backends without the plugin needing to know which is in use.
 *
 * The class is deliberately a reader and nothing else. It does not decide
 * whether to send, it does not format a message, and it does not know what a
 * destination is — {@see WooCommerceOrders} owns the events and
 * {@see WooCommerceOrderProvider} owns how the fields are offered for
 * mapping.
 *
 * @since 1.7.0
 */
class WooCommerceOrder {

	/**
	 * Whether WooCommerce is present and its order API is usable.
	 *
	 * @since 1.7.0
	 *
	 * @return bool True when orders can be read.
	 */
	public static function available(): bool {
		return function_exists( 'wc_get_order' ) && class_exists( '\WooCommerce' );
	}

	/**
	 * Whether the shop stores orders in custom tables (HPOS).
	 *
	 * Reported on the System Status screen rather than branched on: the code
	 * paths here are identical either way, and that is the point.
	 *
	 * @since 1.7.0
	 *
	 * @return bool True when HPOS is enabled.
	 */
	public static function hpos_enabled(): bool {
		if ( ! class_exists( '\Automattic\WooCommerce\Utilities\OrderUtil' ) ) {
			return false;
		}

		if ( ! method_exists( '\Automattic\WooCommerce\Utilities\OrderUtil', 'custom_orders_table_usage_is_enabled' ) ) {
			return false;
		}

		return (bool) \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
	}

	/**
	 * The shop's currency code.
	 *
	 * Used to label the minimum-total field, so an administrator can see which
	 * unit the threshold is counted in rather than guessing.
	 *
	 * @since 1.7.1
	 *
	 * @return string Currency code, or an empty string when unavailable.
	 */
	public static function currency(): string {
		return function_exists( 'get_woocommerce_currency' ) ? (string) get_woocommerce_currency() : '';
	}

	/**
	 * Reads an order into a flat array.
	 *
	 * Returns an empty array when the order cannot be loaded — a deleted
	 * order, a refund passed by mistake, WooCommerce deactivated between the
	 * event being queued and it being delivered. Callers treat empty as
	 * "nothing to send" rather than as an error, because by then there is
	 * genuinely nothing to describe.
	 *
	 * @since 1.7.0
	 *
	 * @param int $order_id Order identifier.
	 *
	 * @return array<string,mixed> Flat order data, or empty when unreadable.
	 */
	public static function read( int $order_id ): array {
		if ( ! self::available() || $order_id <= 0 ) {
			return array();
		}

		$order = wc_get_order( $order_id );

		// wc_get_order() returns a refund object for a refund ID, and false
		// for anything it cannot load. Only a real order is described here.
		if ( ! $order instanceof \WC_Order ) {
			return array();
		}

		$data = array(
			/* -------------------------------------------------- order */
			'order_id'             => $order->get_id(),
			'order_number'         => (string) $order->get_order_number(),
			'order_status'         => (string) $order->get_status(),
			'order_status_label'   => self::status_label( (string) $order->get_status() ),
			'order_date'           => self::date( $order->get_date_created() ),
			'order_modified'       => self::date( $order->get_date_modified() ),
			'order_paid_date'      => self::date( $order->get_date_paid() ),
			'order_url'            => (string) $order->get_edit_order_url(),
			'order_key'            => (string) $order->get_order_key(),
			'created_via'          => (string) $order->get_created_via(),

			/* ----------------------------------------------- customer */
			'customer_id'          => (int) $order->get_customer_id(),
			'customer_first_name'  => (string) $order->get_billing_first_name(),
			'customer_last_name'   => (string) $order->get_billing_last_name(),
			'customer_name'        => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
			'customer_email'       => (string) $order->get_billing_email(),
			'customer_phone'       => (string) $order->get_billing_phone(),
			'customer_ip'          => (string) $order->get_customer_ip_address(),
			'customer_note'        => (string) $order->get_customer_note(),

			/* ------------------------------------------------ billing */
			'billing_first_name'   => (string) $order->get_billing_first_name(),
			'billing_last_name'    => (string) $order->get_billing_last_name(),
			'billing_company'      => (string) $order->get_billing_company(),
			'billing_address_1'    => (string) $order->get_billing_address_1(),
			'billing_address_2'    => (string) $order->get_billing_address_2(),
			'billing_address'      => trim( $order->get_billing_address_1() . ' ' . $order->get_billing_address_2() ),
			'billing_city'         => (string) $order->get_billing_city(),
			'billing_state'        => (string) $order->get_billing_state(),
			'billing_postcode'     => (string) $order->get_billing_postcode(),
			'billing_country'      => (string) $order->get_billing_country(),
			'billing_phone'        => (string) $order->get_billing_phone(),
			'billing_email'        => (string) $order->get_billing_email(),

			/* ----------------------------------------------- shipping */
			'shipping_first_name'  => (string) $order->get_shipping_first_name(),
			'shipping_last_name'   => (string) $order->get_shipping_last_name(),
			'shipping_company'     => (string) $order->get_shipping_company(),
			'shipping_address_1'   => (string) $order->get_shipping_address_1(),
			'shipping_address_2'   => (string) $order->get_shipping_address_2(),
			'shipping_address'     => trim( $order->get_shipping_address_1() . ' ' . $order->get_shipping_address_2() ),
			'shipping_city'        => (string) $order->get_shipping_city(),
			'shipping_state'       => (string) $order->get_shipping_state(),
			'shipping_postcode'    => (string) $order->get_shipping_postcode(),
			'shipping_country'     => (string) $order->get_shipping_country(),
			'shipping_method'      => (string) $order->get_shipping_method(),

			/* ------------------------------------------------ payment */
			'payment_method'       => (string) $order->get_payment_method(),
			'payment_method_title' => (string) $order->get_payment_method_title(),
			'transaction_id'       => (string) $order->get_transaction_id(),

			/* ---------------------------------------------- financial */
			'currency'             => (string) $order->get_currency(),
			'subtotal'             => self::amount( $order->get_subtotal() ),
			'discount_total'       => self::amount( $order->get_discount_total() ),
			'discount_tax'         => self::amount( $order->get_discount_tax() ),
			'shipping_total'       => self::amount( $order->get_shipping_total() ),
			'shipping_tax'         => self::amount( $order->get_shipping_tax() ),
			'total_tax'            => self::amount( $order->get_total_tax() ),
			'total'                => self::amount( $order->get_total() ),
			'total_formatted'      => self::strip_markup( (string) $order->get_formatted_order_total() ),

			/* ---------------------------------------------------- misc */
			'coupon_codes'         => implode( '، ', array_map( 'strval', (array) $order->get_coupon_codes() ) ),
			'item_count'           => (int) $order->get_item_count(),
			'items'                => self::items( $order ),
		);

		/**
		 * Filters the flat order data before it becomes a payload.
		 *
		 * @since 1.7.0
		 *
		 * @param array<string,mixed> $data  Flat order data.
		 * @param \WC_Order           $order Source order.
		 */
		return (array) apply_filters( 'wpep_order_data', $data, $order );
	}

	/**
	 * Reads an order's line items.
	 *
	 * Repeatable data, shaped like every other repeater the plugin already
	 * carries, so the mapping layer's existing list formatting applies to it
	 * with nothing new to learn.
	 *
	 * @since 1.7.0
	 *
	 * @param \WC_Order $order Order to read.
	 *
	 * @return array<int,array<string,mixed>> Line items.
	 */
	private static function items( \WC_Order $order ): array {
		$items = array();

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}

			$product    = $item->get_product();
			$quantity   = (int) $item->get_quantity();
			$line_total = (float) $item->get_total();

			$items[] = array(
				'product_id'     => (int) $item->get_product_id(),
				'variation_id'   => (int) $item->get_variation_id(),
				'name'           => (string) $item->get_name(),
				'sku'            => $product instanceof \WC_Product ? (string) $product->get_sku() : '',
				'quantity'       => $quantity,
				// Unit price is derived rather than read: WooCommerce stores
				// the line total, and a line with a per-item discount has no
				// single stored unit price that matches what was charged.
				'unit_price'     => self::amount( $quantity > 0 ? $line_total / $quantity : $line_total ),
				'line_subtotal'  => self::amount( $item->get_subtotal() ),
				'line_discount'  => self::amount( (float) $item->get_subtotal() - $line_total ),
				'line_total'     => self::amount( $line_total ),
				'line_tax'       => self::amount( $item->get_total_tax() ),
				'product_url'    => $product instanceof \WC_Product ? (string) $product->get_permalink() : '',
			);
		}

		return $items;
	}

	/**
	 * Formats a WooCommerce date as ISO-8601, or an empty string.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $date WC_DateTime or null.
	 *
	 * @return string ISO-8601 date, or an empty string.
	 */
	private static function date( mixed $date ): string {
		return $date instanceof \WC_DateTime ? $date->date( 'c' ) : '';
	}

	/**
	 * Normalizes a monetary amount to a plain decimal string.
	 *
	 * Deliberately not `wc_price()`: that returns markup with a currency
	 * symbol, which is a presentation decision belonging to whoever renders
	 * the message. The raw number travels, and `total_formatted` carries the
	 * shop's own formatting alongside it for consumers that want it.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $value Raw amount.
	 *
	 * @return string Decimal string.
	 */
	private static function amount( mixed $value ): string {
		return number_format( (float) $value, wc_get_price_decimals(), '.', '' );
	}

	/**
	 * Strips markup from a WooCommerce formatted string.
	 *
	 * @since 1.7.0
	 *
	 * @param string $html Formatted HTML.
	 *
	 * @return string Plain text.
	 */
	private static function strip_markup( string $html ): string {
		return trim( html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES, 'UTF-8' ) );
	}

	/**
	 * Returns the human label for an order status.
	 *
	 * @since 1.7.0
	 *
	 * @param string $status Status slug.
	 *
	 * @return string Status label.
	 */
	private static function status_label( string $status ): string {
		if ( ! function_exists( 'wc_get_order_status_name' ) ) {
			return $status;
		}

		return (string) wc_get_order_status_name( $status );
	}
}
