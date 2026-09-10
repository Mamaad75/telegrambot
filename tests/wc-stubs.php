<?php
/**
 * A WooCommerce stand-in: orders with line items, and a product catalogue.
 *
 * Enough to exercise the commerce facts against realistic baskets, including
 * the case that matters most — products that exist and have never sold.
 *
 * @package Bahoosh_Analytics_Pro
 */

// phpcs:disable

$GLOBALS['bap_orders']    = array();
$GLOBALS['bap_products']  = array();
$GLOBALS['bap_coupons']   = array();
$GLOBALS['bap_wc_active'] = true;

class Fake_WC_Item {
	public function __construct( private int $id, private string $name, private int $qty, private float $total ) {}
	public function get_product_id() { return $this->id; }
	public function get_name() { return $this->name; }
	public function get_quantity() { return $this->qty; }
	public function get_total() { return $this->total; }
}

class Fake_WC_Order {
	public array $meta = array();
	public function __construct( private int $id, private float $total, private array $items, string $device = '' ) {
		if ( '' !== $device ) { $this->meta['_bap_device_type'] = $device; }
	}
	public function get_id() { return $this->id; }
	public function get_total() { return $this->total; }
	public function get_items() { return $this->items; }
	public function get_meta( $key, $single = true ) { return $this->meta[ $key ] ?? ''; }
	public function update_meta_data( $key, $value ) { $this->meta[ $key ] = $value; }
	public function save() { return $this->id; }
	public function get_customer_id() { return 0; }
}

class Fake_WC_Product {
	public array $meta = array();
	public string $sale_price = '';
	public $sale_from = null;
	public $sale_to = null;
	public bool $saved = false;

	public function __construct( private int $id, private string $name, private float $regular = 100000.0 ) {}

	public function get_id() { return $this->id; }
	public function get_name() { return $this->name; }
	public function get_regular_price() { return (string) $this->regular; }
	public function get_sale_price() { return $this->sale_price; }
	public function set_sale_price( $price ) { $this->sale_price = (string) $price; }
	public function get_date_on_sale_from() { return $this->sale_from ? new Fake_WC_DateTime( $this->sale_from ) : null; }
	public function get_date_on_sale_to() { return $this->sale_to ? new Fake_WC_DateTime( $this->sale_to ) : null; }
	public function set_date_on_sale_from( $ts ) { $this->sale_from = $ts; }
	public function set_date_on_sale_to( $ts ) { $this->sale_to = $ts; }
	public function get_meta( $key, $single = true ) { return $this->meta[ $key ] ?? ''; }
	public function update_meta_data( $key, $value ) { $this->meta[ $key ] = $value; }
	public function delete_meta_data( $key ) { unset( $this->meta[ $key ] ); }
	public function save() { $this->saved = true; return $this->id; }
}

class Fake_WC_DateTime {
	public function __construct( private int $ts ) {}
	public function getTimestamp() { return $this->ts; }
}

/**
 * A coupon store, enough to prove the agent creates one and can expire it.
 */
class WC_Coupon {
	public int $id = 0;
	public string $code = '';
	public string $type = '';
	public float $amount = 0.0;
	public array $product_ids = array();
	public bool $individual = false;
	public $expires = null;
	public $usage_limit = null;
	public string $description = '';

	public function __construct( $id = 0 ) {
		if ( $id && isset( $GLOBALS['bap_coupons'][ $id ] ) ) {
			foreach ( get_object_vars( $GLOBALS['bap_coupons'][ $id ] ) as $key => $value ) { $this->$key = $value; }
		}
	}

	public function set_code( $code ) { $this->code = (string) $code; }
	public function get_code() { return $this->code; }
	public function set_discount_type( $type ) { $this->type = (string) $type; }
	public function set_amount( $amount ) { $this->amount = (float) $amount; }
	public function set_product_ids( array $ids ) { $this->product_ids = $ids; }
	public function set_individual_use( $flag ) { $this->individual = (bool) $flag; }
	public function set_date_expires( $ts ) { $this->expires = $ts; }
	public function set_usage_limit( $limit ) { $this->usage_limit = $limit; }
	public function set_description( $text ) { $this->description = (string) $text; }
	public function get_id() { return $this->id; }

	public function save() {
		if ( ! $this->id ) { $this->id = count( $GLOBALS['bap_coupons'] ) + 900; }
		$GLOBALS['bap_coupons'][ $this->id ] = clone $this;
		return $this->id;
	}
}

function wc_get_coupon_id_by_code( $code ) {
	foreach ( $GLOBALS['bap_coupons'] as $id => $coupon ) { if ( $coupon->code === $code ) { return $id; } }
	return 0;
}

function wc_get_price_decimals() { return 0; }

/**
 * Builds an order from a compact spec: [ [product_id, name, qty, total], ... ].
 */
function bap_add_order( int $id, array $lines, string $device = '', float $total = null ): void {
	$items = array();
	$sum   = 0.0;
	foreach ( $lines as [$pid, $name, $qty, $line_total] ) {
		$items[] = new Fake_WC_Item( $pid, $name, $qty, $line_total );
		$sum    += $line_total;
		$GLOBALS['bap_products'][ $pid ] = $GLOBALS['bap_products'][ $pid ] ?? new Fake_WC_Product( $pid, $name );
	}
	$GLOBALS['bap_orders'][] = new Fake_WC_Order( $id, $total ?? $sum, $items, $device );
}

function bap_add_product( int $id, string $name ): void {
	$GLOBALS['bap_products'][ $id ] = new Fake_WC_Product( $id, $name );
}

function wc_get_product( $id ) { return $GLOBALS['bap_products'][ (int) $id ] ?? false; }
function wc_get_orders( $args = array() ) { return $GLOBALS['bap_orders']; }
function wc_get_products( $args = array() ) { return array_values( $GLOBALS['bap_products'] ); }
function wc_get_order( $id ) {
	foreach ( $GLOBALS['bap_orders'] as $order ) { if ( $order->get_id() === (int) $id ) { return $order; } }
	return false;
}
function get_woocommerce_currency() { return 'IRT'; }

/**
 * The two things BAP_WooCommerce::is_active() checks for.
 *
 * Defined here rather than faked away in the plugin, so the test exercises the
 * real activation check — which is the one that was broken.
 */
class WooCommerce {}
function WC() { return new WooCommerce(); }
