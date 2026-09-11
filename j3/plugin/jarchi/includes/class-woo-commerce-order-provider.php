<?php
/**
 * WooCommerce order field provider.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Describes WooCommerce order fields to the mapping architecture.
 *
 * Registers only for the `shop_order` pseudo post type. Orders are not
 * ordinary content and must never appear as mappable fields on a product or a
 * blog post, so every other post type gets nothing from this provider.
 *
 * Values are read through {@see WooCommerceOrder}, which uses the WooCommerce
 * CRUD API, so this works identically on legacy post storage and on HPOS.
 *
 * @since 1.7.0
 */
class WooCommerceOrderProvider extends BaseProvider {

	/**
	 * Provider identifier. Stored in mappings, so it never changes.
	 *
	 * @var string
	 */
	public const ID = 'woocommerce_order';

	/**
	 * The pseudo post type order fields are offered under.
	 *
	 * @var string
	 */
	public const POST_TYPE = 'shop_order';

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.7.0
	 *
	 * @return string Provider id.
	 */
	public function id(): string {
		return self::ID;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.7.0
	 *
	 * @return string Provider label.
	 */
	public function label(): string {
		return __( 'سفارش ووکامرس', 'wp-event-publisher' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * Available only when WooCommerce is, which is what keeps a shop-less
	 * site from being offered order fields it can never fill.
	 *
	 * @since 1.7.0
	 *
	 * @return bool True when WooCommerce is active.
	 */
	public function is_available(): bool {
		return WooCommerceOrder::available();
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.7.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return Field[] Order fields, or an empty array for other post types.
	 */
	public function discover( string $post_type ): array {
		if ( self::POST_TYPE !== $post_type ) {
			return array();
		}

		$labels = WooCommerceOrders::field_labels();
		$fields = array();

		foreach ( $labels as $key => $label ) {
			$fields[] = new Field(
				array(
					'key'         => $key,
					'label'       => $label,
					'type'        => $this->type_for( $key ),
					'source'      => self::ID,
					'storage_key' => $key,
					'repeatable'  => 'items' === $key,
					'description' => $this->description_for( $key ),
				)
			);
		}

		return $fields;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.7.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Post standing in for the order.
	 *
	 * @return mixed Raw value.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed {
		$order = WooCommerceOrder::read( (int) $post->ID );

		return $order[ $field->storage_key() ] ?? null;
	}

	/**
	 * Returns the field type for an order key.
	 *
	 * @since 1.7.0
	 *
	 * @param string $key Field key.
	 *
	 * @return string Field type constant.
	 */
	private function type_for( string $key ): string {
		if ( 'items' === $key ) {
			return Field::TYPE_REPEATER;
		}

		if ( in_array( $key, array( 'order_url' ), true ) ) {
			return Field::TYPE_URL;
		}

		if ( in_array( $key, array( 'order_date' ), true ) ) {
			return Field::TYPE_DATE;
		}

		if ( in_array( $key, array( 'subtotal', 'discount_total', 'shipping_total', 'total_tax', 'total', 'item_count' ), true ) ) {
			return Field::TYPE_NUMBER;
		}

		return Field::TYPE_TEXT;
	}

	/**
	 * Returns a one-line explanation for the fields that need one.
	 *
	 * @since 1.7.0
	 *
	 * @param string $key Field key.
	 *
	 * @return string Description, possibly empty.
	 */
	private function description_for( string $key ): string {
		$notes = array(
			'items'           => __( 'فهرست کالاهای سفارش با نام، تعداد و مبلغ.', 'wp-event-publisher' ),
			'total_formatted' => __( 'مبلغ کل همراه با واحد پول فروشگاه.', 'wp-event-publisher' ),
			'total'           => __( 'فقط عدد، بدون واحد پول.', 'wp-event-publisher' ),
			'order_url'       => __( 'لینک مدیریت سفارش در پیشخوان وردپرس.', 'wp-event-publisher' ),
			'customer_phone'  => __( 'شماره تماس ثبت‌شده در صورتحساب.', 'wp-event-publisher' ),
		);

		return $notes[ $key ] ?? '';
	}
}
