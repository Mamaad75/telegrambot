<?php
/**
 * WooCommerce order events.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Turns WooCommerce order lifecycle hooks into Jarchi events.
 *
 * Orders do not travel the post pipeline. Under High Performance Order
 * Storage an order is not a post at all, so a path that ends in
 * `get_post( $id )` would deliver nothing on a modern shop. Instead each
 * event carries a **snapshot** — the order read in full at the moment the
 * event fired — which is the same mechanism deletions already use for a post
 * that no longer exists. Reusing it means orders need no new queue, no new
 * delivery path and no new retry logic.
 *
 * Taking the snapshot at event time is also the correct behaviour rather
 * than a workaround: a notification about an order becoming "completed"
 * should describe the order as it was when that happened, not as it is
 * whenever the queue drains.
 *
 * @since 1.7.0
 */
class WooCommerceOrders {

	/**
	 * Post meta / order meta key recording which statuses were announced.
	 *
	 * @var string
	 */
	public const META_ANNOUNCED = '_jarchi_order_announced';

	/**
	 * Event type prefix. Internal codes never change; only labels do.
	 *
	 * @var string
	 */
	public const EVENT_PREFIX = 'order.';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Dispatcher dependency.
	 *
	 * @var Dispatcher
	 */
	private Dispatcher $dispatcher;

	/**
	 * Event identifier service.
	 *
	 * @var EventId
	 */
	private EventId $event_id;

	/**
	 * Logger dependency.
	 *
	 * @var Logger
	 */
	private Logger $logger;

	/**
	 * Constructor.
	 *
	 * @since 1.7.0
	 *
	 * @param Settings   $settings   Settings service.
	 * @param Dispatcher $dispatcher Delivery dispatcher.
	 * @param EventId    $event_id   Event identifier service.
	 * @param Logger     $logger     Logger service.
	 */
	public function __construct( Settings $settings, Dispatcher $dispatcher, EventId $event_id, Logger $logger ) {
		$this->settings   = $settings;
		$this->dispatcher = $dispatcher;
		$this->event_id   = $event_id;
		$this->logger     = $logger;
	}

	/**
	 * The order events this integration can raise.
	 *
	 * Keys are the internal codes that travel on the wire and must never
	 * change; values are what an administrator reads.
	 *
	 * @since 1.7.0
	 *
	 * @return array<string,string> Event codes mapped to Persian labels.
	 */
	public static function event_types(): array {
		return array(
			'order.created'    => __( 'سفارش جدید', 'wp-event-publisher' ),
			'order.processing' => __( 'در حال انجام', 'wp-event-publisher' ),
			'order.completed'  => __( 'تکمیل‌شده', 'wp-event-publisher' ),
			'order.cancelled'  => __( 'لغوشده', 'wp-event-publisher' ),
			'order.failed'     => __( 'ناموفق', 'wp-event-publisher' ),
			'order.refunded'   => __( 'بازپرداخت‌شده', 'wp-event-publisher' ),
			'order.on-hold'    => __( 'در انتظار بررسی', 'wp-event-publisher' ),
			'order.status'     => __( 'هر تغییر وضعیت دیگر', 'wp-event-publisher' ),
		);
	}

	/**
	 * Registers the WooCommerce hooks.
	 *
	 * Nothing is registered when WooCommerce is absent, so a site without it
	 * carries no cost and raises no notice.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function register(): void {
		if ( ! WooCommerceOrder::available() ) {
			return;
		}

		// One hook for creation and one for every transition. Deliberately
		// *not* `woocommerce_new_order` plus a per-status hook per status:
		// those overlap, and a single checkout would raise the same
		// notification two or three times.
		add_action( 'woocommerce_checkout_order_created', array( $this, 'on_created' ), 10, 1 );
		add_action( 'woocommerce_order_status_changed', array( $this, 'on_status_changed' ), 10, 4 );
	}

	/**
	 * Whether order notifications are switched on.
	 *
	 * @since 1.7.0
	 *
	 * @return bool True when enabled.
	 */
	public function enabled(): bool {
		return ! empty( $this->settings->get( 'orders_enabled', false ) ) && WooCommerceOrder::available();
	}

	/**
	 * Handles a newly created order.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $order Order object.
	 *
	 * @return void
	 */
	public function on_created( mixed $order ): void {
		if ( ! $order instanceof \WC_Order ) {
			return;
		}

		$this->maybe_send( $order->get_id(), 'order.created' );
	}

	/**
	 * Handles an order status transition.
	 *
	 * @since 1.7.0
	 *
	 * @param int    $order_id Order identifier.
	 * @param string $from     Previous status.
	 * @param string $to       New status.
	 * @param mixed  $order    Order object.
	 *
	 * @return void
	 */
	public function on_status_changed( int $order_id, string $from, string $to, mixed $order = null ): void {
		// A transition to the same status is not a transition. WooCommerce
		// can fire this during a save that changed something else.
		if ( $from === $to ) {
			return;
		}

		$event = self::EVENT_PREFIX . $to;

		// A status with no dedicated event still reports, under the generic
		// code, so a shop with custom statuses is not silently unsupported.
		if ( ! array_key_exists( $event, self::event_types() ) ) {
			$event = 'order.status';
		}

		$this->maybe_send( $order_id, $event, $to );
	}

	/**
	 * Queues an order event when it is wanted and has not already been sent.
	 *
	 * @since 1.7.0
	 *
	 * @param int    $order_id Order identifier.
	 * @param string $event    Internal event code.
	 * @param string $status   Status the event refers to, when applicable.
	 *
	 * @return void
	 */
	private function maybe_send( int $order_id, string $event, string $status = '' ): void {
		if ( ! $this->enabled() || $order_id <= 0 ) {
			return;
		}

		if ( ! in_array( $event, $this->selected_events(), true ) ) {
			return;
		}

		$order = wc_get_order( $order_id );

		if ( ! $order instanceof \WC_Order ) {
			return;
		}

		// The minimum-total threshold. Checked before the idempotency marker
		// is written, so an order that is below the threshold today and is
		// later edited above it still reports rather than being permanently
		// marked as handled.
		if ( ! $this->meets_minimum( $order ) ) {
			$this->logger->event(
				'order.skipped',
				Logger::STATUS_SKIPPED,
				sprintf(
					/* translators: 1: order number, 2: minimum total. */
					__( 'سفارش %1$s کمتر از حداقل مبلغ تعیین‌شده (%2$s) است و فرستاده نشد.', 'wp-event-publisher' ),
					$order->get_order_number(),
					$this->minimum_total()
				)
			);

			return;
		}

		// The destinations this order event may reach, resolved once here and
		// carried on the event. An event with none enabled is still queued:
		// that is what the post pipeline does, and the backend — which owns
		// delivery — is entitled to see an event it decides not to route
		// rather than have the plugin decide for it silently.
		$targets = $this->targets();

		// Idempotency. WooCommerce can reach the same status twice — a
		// payment gateway callback racing the thank-you page, an admin
		// re-saving an order, a retried webhook — and a customer receiving
		// "your order is complete" three times is the failure this prevents.
		// The marker lives on the order itself, so it survives a queue flush
		// and is removed with the order.
		$key   = '' !== $status ? $event . ':' . $status : $event;
		$sent  = $order->get_meta( self::META_ANNOUNCED );
		$sent  = is_array( $sent ) ? $sent : array();

		if ( in_array( $key, $sent, true ) ) {
			return;
		}

		$sent[] = $key;
		$order->update_meta_data( self::META_ANNOUNCED, $sent );
		$order->save_meta_data();

		$snapshot = $this->snapshot( $order_id, $event );

		if ( empty( $snapshot ) ) {
			return;
		}

		// The routing the administrator chose, carried on the event itself.
		// Without this the contract backfills the block to all-disabled, and
		// every order arrives at the backend with each platform switched off.
		$snapshot['publication_targets'] = $targets;

		// Straight onto the existing queue, with the payload already built.
		// An order event carries `post_id` for traceability only; nothing
		// downstream loads a post from it.
		$this->dispatcher->enqueue(
			new Event( $this->event_id->generate( $order_id, $event ), $event, $order_id, 1, $snapshot )
		);

		$this->logger->event(
			'order.queued',
			Logger::STATUS_INFO,
			sprintf(
				/* translators: 1: order number, 2: event label. */
				__( 'سفارش %1$s برای ارسال در صف قرار گرفت (%2$s).', 'wp-event-publisher' ),
				$order->get_order_number(),
				self::event_types()[ $event ] ?? $event
			)
		);
	}

	/**
	 * Builds the payload snapshot for an order event.
	 *
	 * @since 1.7.0
	 *
	 * @param int    $order_id Order identifier.
	 * @param string $event    Internal event code.
	 *
	 * @return array<string,mixed> Snapshot, or empty when unreadable.
	 */
	public function snapshot( int $order_id, string $event ): array {
		$order = WooCommerceOrder::read( $order_id );

		if ( empty( $order ) ) {
			return array();
		}

		$mapping = $this->settings->get( 'order_fields', array() );
		$mapping = is_array( $mapping ) && ! empty( $mapping ) ? $mapping : self::default_fields();

		$fields     = array();
		$field_meta = array();
		$order_num  = 0;

		foreach ( $mapping as $key => $entry ) {
			if ( empty( $entry['enabled'] ) || ! array_key_exists( $key, $order ) ) {
				continue;
			}

			$value = $order[ $key ];

			if ( '' === $value || array() === $value ) {
				continue;
			}

			$fields[ $key ]     = $value;
			$field_meta[ $key ] = array(
				'label'       => (string) ( $entry['label'] ?? self::field_labels()[ $key ] ?? $key ),
				'order'       => (int) ( $entry['order'] ?? $order_num ),
				'visibility'  => Field::VISIBILITY_TELEGRAM,
				'format'      => 'items' === $key ? FieldResolver::FORMAT_BULLETS : FieldResolver::FORMAT_INLINE,
				'separator'   => '، ',
				'platforms'   => $this->platforms_for( (array) $entry ),
				'type'        => 'items' === $key ? Field::TYPE_REPEATER : Field::TYPE_TEXT,
				'source'      => WooCommerceOrderProvider::ID,
				'storage_key' => $key,
				'repeatable'  => 'items' === $key,
				'required'    => false,
				'choices'     => array(),
				'meta'        => array(),
			);

			++$order_num;
		}

		// The snapshot is a complete payload; Contract::refresh() stamps the
		// event id, type and timestamp onto it at delivery time.
		return array(
			'event_type'   => $event,
			'post_id'      => $order_id,
			'post_type'    => 'shop_order',
			'status'       => (string) ( $order['order_status'] ?? '' ),
			'title'        => sprintf(
				/* translators: %s: order number. */
				__( 'سفارش %s', 'wp-event-publisher' ),
				$order['order_number'] ?? (string) $order_id
			),
			'description'  => '',
			'url'          => (string) ( $order['order_url'] ?? '' ),
			'permalink'    => (string) ( $order['order_url'] ?? '' ),
			'site_id'      => $this->settings->site_id(),
			'images'       => array(),
			'fields'       => $fields,
			'field_meta'   => $field_meta,
			'order'        => $order,
			'language'     => get_locale(),
			'published_at' => (string) ( $order['order_date'] ?? '' ),
			'updated_at'   => (string) ( $order['order_modified'] ?? '' ),
		);
	}

	/**
	 * Returns the platform visibility of one order field entry.
	 *
	 * @since 1.7.0
	 *
	 * @param array<string,mixed> $entry Field entry.
	 *
	 * @return array<string,bool> Visibility keyed by platform.
	 */
	private function platforms_for( array $entry ): array {
		$stored  = isset( $entry['platforms'] ) && is_array( $entry['platforms'] ) ? $entry['platforms'] : null;
		$visible = array();

		foreach ( Field::PLATFORMS as $platform ) {
			// No stored choice means every platform this order event is being
			// sent to, because an order field the administrator switched on
			// was switched on in order to be seen.
			$visible[ $platform ] = null === $stored ? true : ! empty( $stored[ $platform ] );
		}

		return $visible;
	}

	/**
	 * The configured minimum order total, as a number.
	 *
	 * @since 1.7.1
	 *
	 * @return float Threshold; 0.0 when unset, which admits every order.
	 */
	public function minimum_total(): float {
		$raw = $this->settings->get( 'order_min_total', '' );

		if ( is_array( $raw ) || null === $raw ) {
			return 0.0;
		}

		$text = trim( (string) $raw );

		if ( '' === $text ) {
			return 0.0;
		}

		// The stored value is already sanitised, but a site can be edited by
		// filter, by WP-CLI or by a direct option write, so the shape is not
		// assumed here. Persian and Arabic-Indic digits are normalised, and
		// thousands separators — which a person typing "1,000,000" will use —
		// are dropped before the number is read.
		$text = strtr(
			$text,
			array(
				'۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
				'۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
				'٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
				'٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
				'٫' => '.', '،' => '', ',' => '', ' ' => '', ' ' => '',
			)
		);

		$text = preg_replace( '/[^0-9.\-]/', '', $text ) ?? '';
		$value = (float) $text;

		// A negative threshold is not a threshold; treating it as "no minimum"
		// is the reading that cannot silently suppress every order.
		return $value > 0 ? $value : 0.0;
	}

	/**
	 * Whether an order clears the configured minimum total.
	 *
	 * @since 1.7.1
	 *
	 * @param \WC_Order $order Order object.
	 *
	 * @return bool True when the order may be sent.
	 */
	public function meets_minimum( \WC_Order $order ): bool {
		$minimum = $this->minimum_total();

		if ( $minimum <= 0.0 ) {
			return true;
		}

		$total = $order->get_total();

		// A total WooCommerce cannot state is not evidence the order is small.
		// Admitting it keeps a gateway quirk from silencing notifications
		// entirely, which is the more damaging of the two failures.
		if ( null === $total || '' === $total ) {
			return true;
		}

		$total = (float) $total;

		/**
		 * Filters whether an order clears the minimum-total threshold.
		 *
		 * @since 1.7.1
		 *
		 * @param bool      $passes  Whether the order clears the threshold.
		 * @param float     $total   Order total.
		 * @param float     $minimum Configured minimum.
		 * @param \WC_Order $order   Order object.
		 */
		return (bool) apply_filters(
			'wpep_order_meets_minimum',
			// Compared with a cent of tolerance: an order for exactly the
			// threshold should pass, and binary floats make "1000000.00" and
			// 1000000 differ in the last place often enough to matter.
			$total >= ( $minimum - 0.005 ),
			$total,
			$minimum,
			$order
		);
	}

	/**
	 * Resolves the publication targets an order event may reach.
	 *
	 * The WooCommerce screen's platform choice is a narrowing of the site
	 * configuration, never a widening of it: a platform the administrator has
	 * not configured has no channel to post to, so selecting it on the orders
	 * screen cannot switch it on.
	 *
	 * @since 1.7.1
	 *
	 * @return array<string,array<string,mixed>> Targets keyed by platform.
	 */
	public function targets(): array {
		$site     = $this->settings->platforms();
		$selected = $this->settings->get( 'order_platforms', array() );
		$selected = is_array( $selected ) ? array_filter( array_map( 'strval', $selected ) ) : array();

		$targets = array();

		foreach ( Field::PLATFORMS as $platform ) {
			$config  = isset( $site[ $platform ] ) && is_array( $site[ $platform ] ) ? $site[ $platform ] : array();
			$site_on = ! empty( $config['enabled'] );

			// No explicit choice means "wherever the site publishes", which is
			// what the screen's own hint promises.
			$enabled = empty( $selected )
				? $site_on
				: ( $site_on && in_array( $platform, $selected, true ) );

			$target = array( 'enabled' => $enabled );

			foreach ( array( 'channel_id', 'chat_id', 'recipient', 'channel_title' ) as $key ) {
				if ( ! empty( $config[ $key ] ) ) {
					$target[ $key ] = (string) $config[ $key ];
				}
			}

			$targets[ $platform ] = $target;
		}

		/**
		 * Filters the publication targets resolved for order events.
		 *
		 * @since 1.7.1
		 *
		 * @param array<string,array<string,mixed>> $targets  Resolved targets.
		 * @param string[]                          $selected Administrator's choice.
		 */
		return (array) apply_filters( 'wpep_order_publication_targets', $targets, $selected );
	}

	/**
	 * The order events the administrator selected.
	 *
	 * @since 1.7.0
	 *
	 * @return string[] Selected event codes.
	 */
	public function selected_events(): array {
		$selected = $this->settings->get( 'order_events', array() );

		if ( ! is_array( $selected ) || empty( $selected ) ) {
			// A shop that switched notifications on without choosing events
			// most likely wants the two that matter.
			return array( 'order.created', 'order.completed' );
		}

		return array_values( array_intersect( $selected, array_keys( self::event_types() ) ) );
	}

	/**
	 * Human labels for every order field.
	 *
	 * @since 1.7.0
	 *
	 * @return array<string,string> Labels keyed by field key.
	 */
	public static function field_labels(): array {
		return array(
			'order_number'         => __( 'شماره سفارش', 'wp-event-publisher' ),
			'order_status_label'   => __( 'وضعیت سفارش', 'wp-event-publisher' ),
			'order_date'           => __( 'تاریخ سفارش', 'wp-event-publisher' ),
			'order_url'            => __( 'لینک سفارش', 'wp-event-publisher' ),
			'customer_name'        => __( 'نام مشتری', 'wp-event-publisher' ),
			'customer_email'       => __( 'ایمیل مشتری', 'wp-event-publisher' ),
			'customer_phone'       => __( 'تلفن مشتری', 'wp-event-publisher' ),
			'customer_note'        => __( 'یادداشت مشتری', 'wp-event-publisher' ),
			'billing_address'      => __( 'نشانی صورتحساب', 'wp-event-publisher' ),
			'billing_city'         => __( 'شهر', 'wp-event-publisher' ),
			'billing_state'        => __( 'استان', 'wp-event-publisher' ),
			'billing_postcode'     => __( 'کد پستی', 'wp-event-publisher' ),
			'shipping_address'     => __( 'نشانی ارسال', 'wp-event-publisher' ),
			'shipping_city'        => __( 'شهر ارسال', 'wp-event-publisher' ),
			'shipping_method'      => __( 'روش ارسال', 'wp-event-publisher' ),
			'payment_method_title' => __( 'روش پرداخت', 'wp-event-publisher' ),
			'transaction_id'       => __( 'شناسه تراکنش', 'wp-event-publisher' ),
			'subtotal'             => __( 'جمع جزء', 'wp-event-publisher' ),
			'discount_total'       => __( 'تخفیف', 'wp-event-publisher' ),
			'shipping_total'       => __( 'هزینه ارسال', 'wp-event-publisher' ),
			'total_tax'            => __( 'مالیات', 'wp-event-publisher' ),
			'total'                => __( 'مبلغ کل', 'wp-event-publisher' ),
			'total_formatted'      => __( 'مبلغ کل با واحد پول', 'wp-event-publisher' ),
			'currency'             => __( 'واحد پول', 'wp-event-publisher' ),
			'coupon_codes'         => __( 'کد تخفیف', 'wp-event-publisher' ),
			'item_count'           => __( 'تعداد اقلام', 'wp-event-publisher' ),
			'items'                => __( 'اقلام سفارش', 'wp-event-publisher' ),
		);
	}

	/**
	 * The default order field selection for a shop that has not chosen.
	 *
	 * Deliberately a short, useful message rather than everything available:
	 * a notification listing forty fields is not a notification.
	 *
	 * @since 1.7.0
	 *
	 * @return array<string,array<string,mixed>> Default mapping.
	 */
	public static function default_fields(): array {
		$on = array( 'order_number', 'customer_name', 'customer_phone', 'items', 'total_formatted', 'order_status_label', 'order_url' );

		$mapping = array();
		$order   = 0;
		$labels  = self::field_labels();

		foreach ( array_keys( $labels ) as $key ) {
			$mapping[ $key ] = array(
				'enabled' => in_array( $key, $on, true ),
				'label'   => $labels[ $key ],
				'order'   => in_array( $key, $on, true ) ? array_search( $key, $on, true ) : 100 + $order,
			);

			++$order;
		}

		return $mapping;
	}
}
