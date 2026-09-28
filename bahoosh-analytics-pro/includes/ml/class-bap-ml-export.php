<?php
/**
 * Pseudonymised WooCommerce export for the ML service.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Turns WooCommerce customers, orders, products and coupons into the rows the
 * ML service needs, and nothing more.
 *
 * What never leaves WordPress: names, emails, phone numbers, street
 * addresses, postcodes, IP addresses, user agents, order notes, coupon email
 * restrictions. Customers are identified by BAP_ML_Auth::customer_key(), a
 * salted HMAC. Location is country / state / city only.
 *
 * Uses wc_get_orders()/wc_get_products() rather than SQL so the result is the
 * same on legacy post storage and HPOS (as BAP_Commerce_Facts already does).
 *
 * @since 4.8.0
 */
class BAP_ML_Export {

	const MAX_PER_PAGE = 500;

	/** Order statuses exported: everything except drafts, trash and auto-drafts. */
	private static function order_statuses() {
		$statuses = function_exists( 'wc_get_order_statuses' ) ? array_keys( wc_get_order_statuses() ) : array();
		return array_values( array_diff( $statuses, array( 'wc-checkout-draft' ) ) );
	}

	/**
	 * Context: site id, currency, timezone and the policy the service must respect.
	 *
	 * @return array
	 */
	public static function context() {
		return array(
			'site_id'        => BAP_Settings::resolved_site_id(),
			'store_name'     => get_bloginfo( 'name' ),
			'currency'       => function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : '',
			'timezone'       => wp_timezone_string(),
			'wc_version'     => defined( 'WC_VERSION' ) ? WC_VERSION : null,
			'plugin_version' => BAP_VERSION,
			'is_synthetic'   => false,
			'policy'         => BAP_ML_Policy::for_service(),
			'generated_at'   => gmdate( 'c' ),
		);
	}

	/**
	 * ISO 8601 UTC or null.
	 *
	 * @param WC_DateTime|null $date Date.
	 * @return string|null
	 */
	private static function iso( $date ) {
		return $date ? gmdate( 'c', $date->getTimestamp() ) : null;
	}

	/**
	 * Paginated page envelope.
	 *
	 * @param array $items Rows.
	 * @param int   $page  Page.
	 * @param int   $pages Total pages.
	 * @param int   $total Total rows.
	 * @return array
	 */
	private static function page( array $items, $page, $pages, $total ) {
		return array( 'items' => $items, 'page' => (int) $page, 'total_pages' => max( 1, (int) $pages ), 'total' => (int) $total );
	}

	/**
	 * Parses `modified_after` into a timestamp.
	 *
	 * @param string $value ISO date.
	 * @return int 0 for none.
	 */
	private static function since( $value ) {
		$ts = $value ? strtotime( (string) $value ) : false;
		return $ts ? (int) $ts : 0;
	}

	/**
	 * Registered customers (including those who never ordered).
	 *
	 * @param int $page     Page.
	 * @param int $per_page Rows per page.
	 * @return array
	 */
	public static function customers( $page, $per_page ) {
		$query = new WP_User_Query(
			array(
				'role__in'    => array( 'customer', 'subscriber' ),
				'number'      => $per_page,
				'paged'       => $page,
				'orderby'     => 'ID',
				'order'       => 'ASC',
				'count_total' => true,
				'fields'      => 'all',
			)
		);
		$items      = array();
		$identities = array();
		foreach ( (array) $query->get_results() as $user ) {
			$billing_email = (string) get_user_meta( $user->ID, 'billing_email', true );
			$key           = BAP_ML_Auth::customer_key( '' !== $billing_email ? $billing_email : $user->user_email, $user->ID );
			if ( '' === $key ) {
				continue;
			}
			$items[] = array(
				'customer_key'  => $key,
				'is_registered' => true,
				'registered_at' => gmdate( 'c', strtotime( $user->user_registered . ' UTC' ) ),
				'country'       => (string) get_user_meta( $user->ID, 'billing_country', true ),
				'state'         => (string) get_user_meta( $user->ID, 'billing_state', true ),
				'city'          => (string) get_user_meta( $user->ID, 'billing_city', true ),
			);
			$identities[ $key ] = array( 'user_id' => $user->ID, 'last_order_id' => 0 );
		}
		BAP_ML_Store::remember_identities( $identities );
		$total = (int) $query->get_total();
		return self::page( $items, $page, (int) ceil( $total / max( 1, $per_page ) ), $total );
	}

	/**
	 * Orders with items, refunds and coupons.
	 *
	 * @param int    $page           Page.
	 * @param int    $per_page       Rows per page.
	 * @param string $modified_after ISO date.
	 * @return array
	 */
	public static function orders( $page, $per_page, $modified_after = '' ) {
		$args = array(
			'type'     => 'shop_order',
			'status'   => self::order_statuses(),
			'limit'    => $per_page,
			'page'     => $page,
			'paginate' => true,
			'orderby'  => 'ID',
			'order'    => 'ASC',
		);
		$since = self::since( $modified_after );
		if ( $since ) {
			$args['date_modified'] = '>=' . $since;
		}
		$result     = wc_get_orders( $args );
		$items      = array();
		$identities = array();
		$categories = array();

		foreach ( (array) $result->orders as $order ) {
			if ( ! $order instanceof WC_Order ) {
				continue;
			}
			$user_id = (int) $order->get_customer_id();
			$key     = BAP_ML_Auth::customer_key( $order->get_billing_email(), $user_id );
			if ( '' !== $key ) {
				$prev = $identities[ $key ]['last_order_id'] ?? 0;
				$identities[ $key ] = array( 'user_id' => $user_id, 'last_order_id' => max( $prev, $order->get_id() ) );
			}

			$lines = array();
			foreach ( $order->get_items() as $item_id => $item ) {
				if ( ! $item instanceof WC_Order_Item_Product ) {
					continue;
				}
				$product_id = (int) $item->get_product_id();
				if ( ! isset( $categories[ $product_id ] ) ) {
					$terms                     = wp_get_post_terms( $product_id, 'product_cat', array( 'fields' => 'ids' ) );
					$categories[ $product_id ] = is_wp_error( $terms ) ? array() : array_map( 'intval', $terms );
				}
				$lines[] = array(
					'line_id'      => (int) $item_id,
					'product_id'   => $product_id,
					'variation_id' => (int) $item->get_variation_id() ?: null,
					'quantity'     => (float) $item->get_quantity(),
					'subtotal'     => (float) $item->get_subtotal(),
					'total'        => (float) $item->get_total(),
					'category_ids' => $categories[ $product_id ],
				);
			}

			$refunds = array();
			foreach ( $order->get_refunds() as $refund ) {
				$refunds[] = array( 'amount' => (float) $refund->get_amount(), 'created_at' => self::iso( $refund->get_date_created() ) );
			}

			$items[] = array(
				'order_id'       => $order->get_id(),
				'customer_key'   => '' !== $key ? $key : null,
				'created_at'     => self::iso( $order->get_date_created() ),
				'paid_at'        => self::iso( $order->get_date_paid() ),
				'modified_at'    => self::iso( $order->get_date_modified() ),
				'status'         => $order->get_status(),
				'currency'       => $order->get_currency(),
				'total'          => (float) $order->get_total(),
				'subtotal'       => (float) $order->get_subtotal(),
				'discount_total' => (float) $order->get_discount_total(),
				'shipping_total' => (float) $order->get_shipping_total(),
				'tax_total'      => (float) $order->get_total_tax(),
				'refund_total'   => (float) $order->get_total_refunded(),
				'refunds'        => $refunds,
				'coupon_codes'   => array_values( array_map( 'strtolower', $order->get_coupon_codes() ) ),
				'country'        => $order->get_billing_country(),
				'state'          => $order->get_billing_state(),
				'city'           => $order->get_billing_city(),
				'device'         => (string) $order->get_meta( BAP_WooCommerce::DEVICE_META ),
				'items'          => $lines,
			);
		}
		BAP_ML_Store::remember_identities( $identities );
		return self::page( $items, $page, (int) $result->max_num_pages, (int) $result->total );
	}

	/**
	 * Products.
	 *
	 * @param int    $page           Page.
	 * @param int    $per_page       Rows per page.
	 * @param string $modified_after ISO date.
	 * @return array
	 */
	public static function products( $page, $per_page, $modified_after = '' ) {
		$args = array(
			'status'   => array( 'publish', 'private', 'draft', 'pending' ),
			'limit'    => $per_page,
			'page'     => $page,
			'paginate' => true,
			'orderby'  => 'ID',
			'order'    => 'ASC',
		);
		$since = self::since( $modified_after );
		if ( $since ) {
			$args['date_modified'] = '>=' . $since;
		}
		$result = wc_get_products( $args );
		$items  = array();
		foreach ( (array) $result->products as $product ) {
			$terms   = get_the_terms( $product->get_id(), 'product_cat' );
			$terms   = is_array( $terms ) ? $terms : array();
			$items[] = array(
				'product_id'     => $product->get_id(),
				'name'           => $product->get_name(),
				'type'           => $product->get_type(),
				'status'         => $product->get_status(),
				'category_ids'   => array_map( static function ( $t ) { return (int) $t->term_id; }, $terms ),
				'category_names' => array_map( static function ( $t ) { return $t->name; }, $terms ),
				'regular_price'  => '' !== $product->get_regular_price() ? (float) $product->get_regular_price() : null,
				'sale_price'     => '' !== $product->get_sale_price() ? (float) $product->get_sale_price() : null,
				'price'          => '' !== $product->get_price() ? (float) $product->get_price() : null,
				'stock_status'   => $product->get_stock_status(),
				'stock_quantity' => $product->get_stock_quantity(),
				'created_at'     => self::iso( $product->get_date_created() ),
				'modified_at'    => self::iso( $product->get_date_modified() ),
			);
		}
		return self::page( $items, $page, (int) $result->max_num_pages, (int) $result->total );
	}

	/**
	 * Coupons. Email restrictions are deliberately not exported.
	 *
	 * @param int    $page           Page.
	 * @param int    $per_page       Rows per page.
	 * @param string $modified_after ISO date.
	 * @return array
	 */
	public static function coupons( $page, $per_page, $modified_after = '' ) {
		$args = array(
			'post_type'      => 'shop_coupon',
			'post_status'    => array( 'publish', 'future', 'draft', 'pending', 'private' ),
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'fields'         => 'ids',
		);
		$since = self::since( $modified_after );
		if ( $since ) {
			$args['date_query'] = array( array( 'column' => 'post_modified_gmt', 'after' => gmdate( 'Y-m-d H:i:s', $since ), 'inclusive' => true ) );
		}
		$query = new WP_Query( $args );
		$items = array();
		foreach ( (array) $query->posts as $id ) {
			$coupon  = new WC_Coupon( (int) $id );
			$items[] = array(
				'coupon_id'     => $coupon->get_id(),
				'code'          => strtolower( $coupon->get_code() ),
				'discount_type' => $coupon->get_discount_type(),
				'amount'        => (float) $coupon->get_amount(),
				'usage_count'   => (int) $coupon->get_usage_count(),
				'usage_limit'   => $coupon->get_usage_limit() ? (int) $coupon->get_usage_limit() : null,
				'expires_at'    => self::iso( $coupon->get_date_expires() ),
				'created_at'    => self::iso( $coupon->get_date_created() ),
				'action_id'     => (string) $coupon->get_meta( BAP_ML_Actions::META_ACTION ) ?: null,
			);
		}
		return self::page( $items, $page, (int) $query->max_num_pages, (int) $query->found_posts );
	}

	/**
	 * Customer-level behavior aggregates for ML, keyed only by the pseudonymous
	 * customer key. Search text, element labels, raw URLs and anonymous ids are
	 * intentionally not exported.
	 *
	 * @param int    $page           Page.
	 * @param int    $per_page       Rows per page.
	 * @param string $modified_after ISO date.
	 * @return array
	 */
	public static function behaviors( $page, $per_page, $modified_after = '' ) {
		global $wpdb;
		$table = BAP_Local_Store::table();
		$page = max( 1, (int) $page );
		$per_page = max( 1, min( self::MAX_PER_PAGE, (int) $per_page ) );
		$offset = ( $page - 1 ) * $per_page;
		$since = self::since( $modified_after );
		$where = "customer_key <> '' AND event_type IN ('page_view','view_item','add_to_cart','begin_checkout','purchase','search','click')";
		$params = array();
		if ( $since ) {
			$where .= ' AND occurred_at >= %s';
			$params[] = gmdate( 'Y-m-d H:i:s', $since );
		}

		$count_sql = "SELECT COUNT(*) FROM (SELECT customer_key, DATE(occurred_at) AS d, event_type FROM {$table} WHERE {$where} GROUP BY customer_key, d, event_type) AS grouped_events";
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table name is trusted; values are prepared below.
		$total = $params ? (int) $wpdb->get_var( $wpdb->prepare( $count_sql, ...$params ) ) : (int) $wpdb->get_var( $count_sql ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

		$data_sql = "SELECT customer_key, DATE(occurred_at) AS d, event_type, COUNT(*) AS events FROM {$table} WHERE {$where} GROUP BY customer_key, d, event_type ORDER BY d ASC, customer_key ASC LIMIT %d OFFSET %d";
		$data_params = array_merge( $params, array( $per_page, $offset ) );
		$rows = $wpdb->get_results( $wpdb->prepare( $data_sql, ...$data_params ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.NotPrepared
		$items = array();
		foreach ( (array) $rows as $row ) {
			$items[] = array(
				'customer_key' => (string) $row['customer_key'],
				'date'         => (string) $row['d'],
				'event_type'   => (string) $row['event_type'],
				'events'       => (int) $row['events'],
			);
		}
		return self::page( $items, $page, (int) ceil( $total / $per_page ), $total );
	}

	/**
	 * Hourly aggregate counts from the plugin's own event store. No visitor ids.
	 *
	 * @param int $days Days back.
	 * @return array
	 */
	public static function traffic( $days ) {
		global $wpdb;
		$table  = BAP_Local_Store::table();
		$offset = (int) round( (float) get_option( 'gmt_offset', 0 ) * HOUR_IN_SECONDS );
		$from   = gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS * max( 1, min( 730, (int) $days ) ) );
		// phpcs:ignore WordPress.DB
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT DATE(DATE_ADD(occurred_at, INTERVAL %d SECOND)) AS d, HOUR(DATE_ADD(occurred_at, INTERVAL %d SECOND)) AS h, event_type,
				        COUNT(*) AS events, COUNT(DISTINCT anonymous_id) AS visitors
				 FROM {$table}
				 WHERE occurred_at >= %s AND event_type IN ('page_view','view_item','add_to_cart','begin_checkout','purchase')
				 GROUP BY d, h, event_type",
				$offset,
				$offset,
				$from
			),
			ARRAY_A
		);
		$items = array();
		foreach ( (array) $rows as $r ) {
			$items[] = array( 'date' => $r['d'], 'hour' => (int) $r['h'], 'event_type' => $r['event_type'], 'events' => (int) $r['events'], 'visitors' => (int) $r['visitors'] );
		}
		return array( 'items' => $items );
	}

	/**
	 * Actions and their state, for the service's feedback loop.
	 *
	 * @param string $since ISO date.
	 * @return array
	 */
	public static function actions( $since = '' ) {
		$ts    = self::since( $since );
		$rows  = BAP_ML_Store::actions( array( 'since' => $ts ? gmdate( 'Y-m-d H:i:s', $ts ) : '', 'limit' => 1000 ) );
		$items = array();
		foreach ( $rows as $row ) {
			$result = $row['result'];
			unset( $result['queue'] );
			$result['clicks'] = (int) $row['clicks'];
			$items[] = array(
				'action_id'   => $row['action_id'],
				'run_id'      => $row['run_id'],
				'action_type' => $row['action_type'],
				'target'      => $row['target'],
				'parameters'  => $row['parameters'],
				'reason'      => $row['reason'],
				'confidence'  => $row['confidence'],
				'source'      => $row['source'],
				'status'      => $row['status'],
				'policy'      => $row['policy'],
				'created_at'  => $row['created_at'] ? gmdate( 'c', strtotime( $row['created_at'] . ' UTC' ) ) : null,
				'approved_at' => $row['approved_at'] ? gmdate( 'c', strtotime( $row['approved_at'] . ' UTC' ) ) : null,
				'executed_at' => $row['executed_at'] ? gmdate( 'c', strtotime( $row['executed_at'] . ' UTC' ) ) : null,
				'result'      => $result,
				'error'       => $row['error'],
				'rollback'    => $row['rolled_back_at'] ? array( 'rolled_back_at' => $row['rolled_back_at'] ) : null,
			);
		}
		return array( 'items' => $items );
	}

	/**
	 * Streams the complete dataset as one JSON file (for Google Colab / offline use).
	 *
	 * Written piece by piece so a large shop does not exhaust PHP memory.
	 *
	 * @return void
	 */
	public static function stream_bundle() {
		nocache_headers();
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="bahoosh-ml-export-' . gmdate( 'Ymd-His' ) . '.json"' );
		echo '{"format":"bahoosh-ml-bundle","version":1,"is_synthetic":false,"context":' . wp_json_encode( self::context() );
		$sources = array(
			'customers' => array( __CLASS__, 'customers' ),
			'products'  => array( __CLASS__, 'products' ),
			'coupons'   => array( __CLASS__, 'coupons' ),
			'orders'    => array( __CLASS__, 'orders' ),
			'behaviors' => array( __CLASS__, 'behaviors' ),
		);
		foreach ( $sources as $name => $callback ) {
			echo ',"' . $name . '":[';
			$first = true;
			$page  = 1;
			do {
				$chunk = call_user_func( $callback, $page, 200, '' );
				foreach ( $chunk['items'] as $row ) {
					echo ( $first ? '' : ',' ) . wp_json_encode( $row );
					$first = false;
				}
				$page++;
				if ( function_exists( 'wp_cache_flush_runtime' ) ) {
					wp_cache_flush_runtime();
				}
			} while ( $page <= $chunk['total_pages'] );
			echo ']';
		}
		echo ',"traffic":' . wp_json_encode( self::traffic( 365 )['items'] );
		echo ',"actions":' . wp_json_encode( self::actions()['items'] ) . '}';
		exit;
	}
}
