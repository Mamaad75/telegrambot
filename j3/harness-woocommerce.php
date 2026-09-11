<?php
/**
 * A WooCommerce stand-in, just large enough for the order pipeline.
 *
 * WooCommerceOrder::available() asks for `wc_get_order()` and the `WooCommerce`
 * class, and the order hooks are not registered without both. A test that
 * skipped this would be exercising an early return.
 *
 * @package WPEventPublisherAudit
 */

class WooCommerce {}

class WC_Order {
	public int $id;
	public string $status;
	public float $total;
	private array $meta = array();

	public function __construct( int $id = 0, string $status = 'pending', float $total = 0.0 ) {
		$this->id     = $id;
		$this->status = $status;
		$this->total  = $total;
	}

	public function get_id() { return $this->id; }
	// The ticket automations reach for these two as well.
	public function get_user_id() { return 0; }
	public function get_meta_data() { return array(); }
	public function get_status() { return $this->status; }
	public function get_total() { return $this->total; }

	/*
	 * Everything WooCommerceOrder::read() asks an order for. Present with
	 * neutral values rather than absent: a missing method is a fatal error
	 * partway through the snapshot, which would look like the pipeline failing
	 * when it is the stand-in that is incomplete.
	 */
	public function get_billing_address_1() { return ''; }
	public function get_billing_address_2() { return ''; }
	public function get_billing_city() { return ''; }
	public function get_billing_company() { return ''; }
	public function get_billing_country() { return ''; }
	public function get_billing_email() { return ''; }
	public function get_billing_first_name() { return ''; }
	public function get_billing_last_name() { return ''; }
	public function get_billing_phone() { return ''; }
	public function get_billing_postcode() { return ''; }
	public function get_billing_state() { return ''; }
	public function get_coupon_codes() { return array(); }
	public function get_created_via() { return 'admin'; }
	public function get_currency() { return 'IRT'; }
	public function get_customer_id() { return 0; }
	public function get_customer_ip_address() { return ''; }
	public function get_customer_note() { return ''; }
	public function get_date_created() { return null; }
	public function get_date_modified() { return null; }
	public function get_date_paid() { return null; }
	public function get_discount_tax() { return 0; }
	public function get_discount_total() { return 0; }
	public function get_edit_order_url() { return ''; }
	public function get_formatted_order_total() { return (string) $this->total; }
	public function get_item_count() { return 0; }
	public function get_items() { return array(); }
	public function get_order_key() { return ''; }
	public function get_order_number() { return (string) $this->id; }
	public function get_payment_method() { return ''; }
	public function get_payment_method_title() { return ''; }
	public function get_shipping_address_1() { return ''; }
	public function get_shipping_address_2() { return ''; }
	public function get_shipping_city() { return ''; }
	public function get_shipping_company() { return ''; }
	public function get_shipping_country() { return ''; }
	public function get_shipping_first_name() { return ''; }
	public function get_shipping_last_name() { return ''; }
	public function get_shipping_method() { return ''; }
	public function get_shipping_postcode() { return ''; }
	public function get_shipping_state() { return ''; }
	public function get_shipping_tax() { return 0; }
	public function get_shipping_total() { return 0; }
	public function get_subtotal() { return 0; }
	public function get_total_tax() { return 0; }
	public function get_transaction_id() { return ''; }

	/** The idempotency marker lives here, so it has to round-trip. */
	public function get_meta( $key, $single = true ) { return $this->meta[ $key ] ?? ''; }
	public function update_meta_data( $key, $value ) { $this->meta[ $key ] = $value; }
	public function save_meta_data() { return true; }
}

// wc_get_order() is already stubbed in harness.php and reads the same store.
$GLOBALS['wc_orders'] = array();

function wc_get_price_decimals() { return 0; }
function wc_price( $amount, $args = array() ) { return (string) $amount; }
function get_woocommerce_currency() { return 'IRT'; }
function get_woocommerce_currency_symbol( $c = '' ) { return 'تومان'; }
