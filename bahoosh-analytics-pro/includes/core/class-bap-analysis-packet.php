<?php
/**
 * Builds the AI analysis packet.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Assembles the facts a model is allowed to reason about.
 *
 * The schema at `docs/schemas/analysis-packet.schema.json` was already defined
 * and already consumed; what was missing was anything that produced it. This
 * class is that producer.
 *
 * The design rule it exists to enforce: **the model reasons, it does not
 * measure.** Every number is computed here, in PHP, from the shop's own data,
 * and handed over with an id and a sample size. The model's job is to say what
 * a number means and what to do about it — never to invent the number. That is
 * what makes a recommendation auditable: each one cites `fact_*` ids, and an
 * administrator can check every one of them against this class.
 *
 * It also means the packet never contains a customer. No names, no emails, no
 * addresses, no order ids belonging to a person, no visitor identifiers. Only
 * aggregates and product-level figures leave the site.
 *
 * @since 4.3.0
 */
class BAP_Analysis_Packet {

	const SCHEMA_VERSION = 1;

	/**
	 * Builds a packet for a period.
	 *
	 * @param string $from  Y-m-d.
	 * @param string $to    Y-m-d.
	 * @param string $focus One of the schema's focus values.
	 * @return array Packet matching analysis-packet.schema.json.
	 */
	/**
	 * Seconds a built packet is reused.
	 *
	 * Building one reads every paid order in the window and every row of the
	 * rollup, which on a busy shop is real work — and an administrator clicking
	 * "تحلیل کن" twice while reading the first answer should not pay for it
	 * twice. Short enough that a fresh order shows up almost immediately.
	 *
	 * @var int
	 */
	const CACHE_SECONDS = 300;

	/**
	 * Builds a packet, reusing a recent one for the same window.
	 *
	 * @param string $from  Y-m-d.
	 * @param string $to    Y-m-d.
	 * @param string $focus Focus.
	 * @return array
	 */
	public static function cached( $from, $to, $focus = 'revenue' ) {
		$key    = 'bap_packet_' . md5( $from . '|' . $to . '|' . $focus );
		$cached = get_transient( $key );

		if ( is_array( $cached ) && isset( $cached['facts'] ) ) {
			// A fresh run id each time: the facts are reused, but two analyses
			// are still two analyses and their recommendations must not collide
			// on an id derived from it.
			$cached['run_id'] = 'run_' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 24 );
			return $cached;
		}

		$packet = self::build( $from, $to, $focus );

		set_transient( $key, $packet, self::CACHE_SECONDS );

		return $packet;
	}

	public static function build( $from, $to, $focus = 'revenue' ) {
		$from = BAP_Reports::sanitize_date( $from );
		$to   = BAP_Reports::sanitize_date( $to );

		$facts    = array();
		$warnings = array();

		$orders    = BAP_Commerce_Facts::available() ? BAP_Commerce_Facts::orders( $from, $to ) : array();
		$has_woo   = BAP_Commerce_Facts::available();
		$order_qty = count( $orders );

		if ( ! $has_woo ) {
			$warnings[] = __( 'ووکامرس فعال نیست، بنابراین هیچ داده فروش، محصول یا سبد خریدی در دسترس نبود.', 'bahoosh-analytics-pro' );
		} elseif ( $order_qty < BAP_Commerce_Facts::MIN_ORDERS ) {
			$warnings[] = sprintf(
				/* translators: 1: number of orders found, 2: minimum required. */
				__( 'تنها %1$d سفارش در این بازه ثبت شده است؛ برای نتیجه‌گیری قابل اتکا دست‌کم %2$d سفارش لازم است.', 'bahoosh-analytics-pro' ),
				$order_qty,
				BAP_Commerce_Facts::MIN_ORDERS
			);
		}

		$facts = array_merge(
			$facts,
			self::device_facts( $orders, $warnings ),
			self::product_facts( $orders, $warnings ),
			self::affinity_facts( $orders, $warnings ),
			self::funnel_facts( $from, $to, $warnings ),
			self::external_facts( $from, $to, $warnings )
		);

		// A packet with no facts is not sent. A model given nothing will still
		// produce confident prose, and confident prose about no data is the
		// single worst thing this feature could do.
		if ( ! $facts ) {
			$warnings[] = __( 'هیچ داده قابل تحلیلی در این بازه یافت نشد.', 'bahoosh-analytics-pro' );
		}

		return array(
			'schema_version' => self::SCHEMA_VERSION,
			'site_id'        => BAP_Settings::resolved_site_id(),
			'run_id'         => 'run_' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 24 ),
			'focus'          => in_array( $focus, array( 'growth', 'conversion', 'ux', 'retention', 'revenue', 'performance' ), true ) ? $focus : 'revenue',
			'period'         => array(
				'from' => $from . 'T00:00:00Z',
				'to'   => $to . 'T23:59:59Z',
			),
			'goals'          => self::goals(),
			'data_quality'   => array(
				'score'    => self::quality_score( $order_qty, BAP_Rollup::volume( $from, $to ), $has_woo, self::external_sources() ),
				'sources'  => self::source_status(),
				'warnings' => array_values( array_unique( $warnings ) ),
			),
			'facts'          => array_values( $facts ),
		);
	}

	/**
	 * Device revenue split.
	 *
	 * @param array $orders   Orders.
	 * @param array $warnings Warnings, by reference.
	 * @return array Facts.
	 */
	private static function device_facts( array $orders, array &$warnings ) {
		if ( ! $orders ) {
			return array();
		}

		$split    = BAP_Commerce_Facts::device_revenue( $orders );
		$currency = BAP_Commerce_Facts::currency();
		$facts    = array();
		$unknown  = $split['unknown']['orders'] ?? 0;

		if ( $unknown > 0 && $unknown >= ( count( $orders ) / 2 ) ) {
			// Said plainly rather than hidden: orders placed before device
			// capture existed have no device, and a split computed mostly from
			// those would be a guess presented as a measurement.
			$warnings[] = __( 'برای بیش از نیمی از سفارش‌ها نوع دستگاه ثبت نشده است (سفارش‌های قدیمی‌تر از فعال‌سازی این قابلیت). تفکیک موبایل و دسکتاپ تا انباشته‌شدن سفارش‌های جدید قابل اتکا نیست.', 'bahoosh-analytics-pro' );
		}

		foreach ( array( 'mobile', 'desktop', 'tablet' ) as $device ) {
			$row = $split[ $device ];

			if ( $row['orders'] < 1 ) {
				continue;
			}

			$facts[] = self::fact(
				'device_revenue_' . $device,
				'commerce.device_revenue',
				sprintf(
					/* translators: %s: device class. */
					__( 'درآمد و تعداد سفارش از دستگاه %s', 'bahoosh-analytics-pro' ),
					self::device_label( $device )
				),
				array(
					'orders'   => $row['orders'],
					'revenue'  => $row['revenue'],
					'aov'      => $row['aov'],
					'share_pc' => $row['share'],
					'currency' => $currency,
				),
				$row['orders'],
				array( 'device' => $device )
			);
		}

		return $facts;
	}

	/**
	 * Best and worst selling products.
	 *
	 * @param array $orders   Orders.
	 * @param array $warnings Warnings, by reference.
	 * @return array Facts.
	 */
	private static function product_facts( array $orders, array &$warnings ) {
		if ( ! $orders ) {
			return array();
		}

		$facts    = array();
		$currency = BAP_Commerce_Facts::currency();
		$top      = array_slice( BAP_Commerce_Facts::product_performance( $orders ), 0, 10 );

		foreach ( $top as $index => $product ) {
			$facts[] = self::fact(
				'top_product_' . $product['id'],
				'commerce.top_product',
				sprintf(
					/* translators: 1: rank, 2: product name. */
					__( 'محصول پرفروش رتبه %1$d: %2$s', 'bahoosh-analytics-pro' ),
					$index + 1,
					$product['name']
				),
				array(
					'product_id' => $product['id'],
					'name'       => $product['name'],
					'units'      => $product['units'],
					'revenue'    => $product['revenue'],
					'orders'     => $product['orders'],
					'currency'   => $currency,
				),
				$product['orders'],
				array(
					'rank'       => $index + 1,
					'product_id' => (string) $product['id'],
				)
			);
		}

		foreach ( array_slice( BAP_Commerce_Facts::slow_movers( $orders, 10 ), 0, 10 ) as $index => $product ) {
			$facts[] = self::fact(
				'slow_product_' . $product['id'],
				'commerce.slow_product',
				sprintf(
					/* translators: %s: product name. */
					__( 'محصول کم‌فروش: %s', 'bahoosh-analytics-pro' ),
					$product['name']
				),
				array(
					'product_id' => $product['id'],
					'name'       => $product['name'],
					'units'      => $product['units'],
					'revenue'    => $product['revenue'],
					'orders'     => $product['orders'],
					'currency'   => $currency,
				),
				$product['orders'],
				array(
					'rank'       => $index + 1,
					'product_id' => (string) $product['id'],
				)
			);
		}

		return $facts;
	}

	/**
	 * Products bought together.
	 *
	 * @param array $orders   Orders.
	 * @param array $warnings Warnings, by reference.
	 * @return array Facts.
	 */
	private static function affinity_facts( array $orders, array &$warnings ) {
		if ( ! $orders ) {
			return array();
		}

		$pairs = BAP_Commerce_Facts::product_affinity( $orders, 10 );

		if ( ! $pairs ) {
			$warnings[] = sprintf(
				/* translators: %d: minimum co-purchase count. */
				__( 'هیچ جفت محصولی به حد نصاب %d خرید مشترک نرسید، بنابراین پیشنهاد پکیج ارائه نشد.', 'bahoosh-analytics-pro' ),
				BAP_Commerce_Facts::MIN_PAIR_SUPPORT
			);
			return array();
		}

		$facts = array();

		foreach ( $pairs as $pair ) {
			$facts[] = self::fact(
				'affinity_' . $pair['a'] . '_' . $pair['b'],
				'commerce.product_affinity',
				sprintf(
					/* translators: 1: first product, 2: second product. */
					__( 'خرید مشترک «%1$s» و «%2$s»', 'bahoosh-analytics-pro' ),
					$pair['a_name'],
					$pair['b_name']
				),
				array(
					'product_a'    => $pair['a'],
					'product_b'    => $pair['b'],
					'name_a'       => $pair['a_name'],
					'name_b'       => $pair['b_name'],
					'together'     => $pair['support'],
					// Above 1 means the pairing is stronger than each product's
					// popularity alone would explain.
					'lift'         => $pair['lift'],
					'confidence_pc' => $pair['confidence'],
				),
				$pair['support'],
				array(
					'product_a' => (string) $pair['a'],
					'product_b' => (string) $pair['b'],
				)
			);
		}

		return $facts;
	}

	/**
	 * Funnel drop-off and abandonment pages.
	 *
	 * @param string $from     Y-m-d.
	 * @param string $to       Y-m-d.
	 * @param array  $warnings Warnings, by reference.
	 * @return array Facts.
	 */
	private static function funnel_facts( $from, $to, array &$warnings ) {
		$volume = BAP_Rollup::volume( $from, $to );

		if ( $volume < 1 ) {
			$warnings[] = __( 'هنوز داده رفتاری محلی ثبت نشده است. قیف خرید از لحظه فعال‌سازی این نسخه شروع به جمع‌آوری می‌کند و برای بازه‌های گذشته داده‌ای وجود ندارد.', 'bahoosh-analytics-pro' );
			return array();
		}

		$funnel = BAP_Rollup::funnel( $from, $to );
		$facts  = array();
		$steps  = BAP_Rollup::STEPS;

		foreach ( $steps as $index => $step ) {
			$reached = (int) $funnel[ $step ];

			if ( $reached < 1 ) {
				continue;
			}

			$next      = $steps[ $index + 1 ] ?? '';
			$continued = '' !== $next ? (int) $funnel[ $next ] : null;

			// The drop is the interesting number: not how many arrived, but how
			// many stopped here.
			$drop_pc = null;
			if ( null !== $continued && $reached > 0 ) {
				$drop_pc = round( ( ( $reached - $continued ) / $reached ) * 100, 1 );
				$drop_pc = max( 0.0, $drop_pc );
			}

			$facts[] = self::fact(
				'funnel_' . $step,
				'funnel.step',
				sprintf(
					/* translators: %s: funnel step label. */
					__( 'مرحله قیف: %s', 'bahoosh-analytics-pro' ),
					self::step_label( $step )
				),
				array(
					'step'      => $step,
					'reached'   => $reached,
					'next_step' => $next,
					'continued' => $continued,
					'drop_pc'   => $drop_pc,
				),
				$reached,
				array(
					'step'     => $step,
					'position' => (string) ( $index + 1 ),
				)
			);
		}

		// The pages where the last-reached step happened are where the shop can
		// actually intervene: "40% leave at checkout" is a statistic, "/checkout
		// loses 40%" is a task.
		foreach ( array( 'begin_checkout', 'add_payment_info' ) as $step ) {
			foreach ( BAP_Rollup::top_pages_for_step( $step, $from, $to, 5 ) as $page ) {
				$facts[] = self::fact(
					'exitpage_' . $step . '_' . substr( md5( $page['page_path'] ), 0, 10 ),
					'funnel.exit_page',
					sprintf(
						/* translators: 1: page path, 2: step label. */
						__( 'صفحه %1$s در مرحله %2$s', 'bahoosh-analytics-pro' ),
						$page['page_path'],
						self::step_label( $step )
					),
					array(
						'page_path' => $page['page_path'],
						'step'      => $step,
						'hits'      => $page['hits'],
					),
					$page['hits'],
					array( 'step' => $step )
				);
			}
		}

		return $facts;
	}

	/**
	 * Facts borrowed from GA4 and Clarity.
	 *
	 * These two answer questions the plugin cannot answer for itself. GA4 has
	 * history from before this plugin was installed, which is the only cure for
	 * an empty funnel on a fresh activation. Clarity has rage clicks, dead
	 * clicks and script errors per page, which is the difference between knowing
	 * that shoppers abandon the checkout and knowing what is broken on it.
	 *
	 * Both are optional and both are additive: neither replaces a local fact,
	 * and each fact carries `source` so a recommendation's evidence trail says
	 * which system a number came from.
	 *
	 * @param string $from     Y-m-d.
	 * @param string $to       Y-m-d.
	 * @param array  $warnings Warnings, by reference.
	 * @return array Facts.
	 */
	private static function external_facts( $from, $to, array &$warnings ) {
		$facts = array();

		foreach ( array( BAP_GA4::facts( $from, $to ), BAP_Clarity::facts() ) as $source ) {
			foreach ( $source['warnings'] as $warning ) {
				$warnings[] = $warning;
			}

			foreach ( $source['facts'] as $row ) {
				$facts[] = self::fact(
					$row['id'],
					$row['kind'],
					$row['label'],
					$row['value'],
					$row['sample'],
					isset( $row['dimensions'] ) ? (array) $row['dimensions'] : array()
				);
			}
		}

		return $facts;
	}

	/**
	 * Builds one schema-valid fact.
	 *
	 * @param string $id          Id suffix, sanitised into the schema's pattern.
	 * @param string $kind        Fact kind.
	 * @param string $label       Human label.
	 * @param mixed  $value       Value.
	 * @param int    $sample_size Observations behind the value.
	 * @param array  $dimensions  Scalar dimensions.
	 * @return array Fact.
	 */
	private static function fact( $id, $kind, $label, $value, $sample_size, array $dimensions = array() ) {
		// The schema requires `^fact_[A-Za-z0-9_-]{3,100}$`, and a product name
		// or URL in an id would break it. Sanitised here rather than trusted.
		$id = preg_replace( '/[^A-Za-z0-9_-]/', '_', (string) $id );
		$id = substr( 'fact_' . trim( $id, '_' ), 0, 105 );

		return array(
			'id'          => $id,
			'kind'        => (string) $kind,
			'label'       => substr( (string) $label, 0, 240 ),
			'value'       => $value,
			'sample_size' => max( 0, (int) $sample_size ),
			'dimensions'  => $dimensions,
		);
	}

	/**
	 * How much the numbers can be trusted, as a single score.
	 *
	 * The backend spec requires data quality to gate AI, and this is the
	 * plugin's half of that gate. It is deliberately harsh: a low score should
	 * make an administrator sceptical of the recommendations rather than
	 * reassured by them.
	 *
	 * @param int  $orders   Orders in the window.
	 * @param int  $events   Behavioural observations in the window.
	 * @param bool $has_woo  Whether WooCommerce is active.
	 * @param int  $external How many external sources are connected.
	 * @return int 0-100.
	 */
	public static function quality_score( $orders, $events, $has_woo, $external = 0 ) {
		$score = 0;

		// Commerce data, up to 60. Orders are the strongest signal available.
		if ( $has_woo ) {
			$score += min( 60, (int) round( ( $orders / 200 ) * 60 ) );
		}

		// Behavioural data, up to 40.
		$score += min( 40, (int) round( ( $events / 5000 ) * 40 ) );

		// A connected GA4 or Clarity is worth a little, and only a little. It
		// widens what can be seen — history before activation, friction the
		// plugin cannot detect — but a shop with fifty orders still has fifty
		// orders, and no external source makes a thin sample thick.
		$score += min( 10, max( 0, (int) $external ) * 5 );

		return max( 0, min( 100, $score ) );
	}

	/**
	 * How many external sources are connected.
	 *
	 * @return int
	 */
	private static function external_sources() {
		return (int) BAP_GA4::available() + (int) BAP_Clarity::available();
	}

	/**
	 * Which sources fed this packet.
	 *
	 * Sent to the model as well as shown to the administrator, so a small
	 * number can be read in the light of where it came from.
	 *
	 * @return array
	 */
	private static function source_status() {
		return array(
			'woocommerce' => BAP_Commerce_Facts::available(),
			'rollup'      => true,
			'ga4'         => BAP_GA4::available(),
			'clarity'     => BAP_Clarity::available(),
		);
	}

	/**
	 * The shop's stated goals, if an administrator wrote any.
	 *
	 * @return array
	 */
	private static function goals() {
		$goals = get_option( 'bap_ai_goals', array() );

		if ( ! is_array( $goals ) ) {
			return array();
		}

		return array_slice( array_values( array_filter( array_map( 'sanitize_text_field', $goals ) ) ), 0, 20 );
	}

	/**
	 * Persian label for a device class.
	 *
	 * @param string $device Device.
	 * @return string
	 */
	public static function device_label( $device ) {
		$labels = array(
			'mobile'  => __( 'موبایل', 'bahoosh-analytics-pro' ),
			'tablet'  => __( 'تبلت', 'bahoosh-analytics-pro' ),
			'desktop' => __( 'دسکتاپ', 'bahoosh-analytics-pro' ),
			'unknown' => __( 'نامشخص', 'bahoosh-analytics-pro' ),
		);

		return $labels[ $device ] ?? $device;
	}

	/**
	 * Persian label for a funnel step.
	 *
	 * @param string $step Step.
	 * @return string
	 */
	public static function step_label( $step ) {
		$labels = array(
			'view_item'        => __( 'مشاهده محصول', 'bahoosh-analytics-pro' ),
			'add_to_cart'      => __( 'افزودن به سبد', 'bahoosh-analytics-pro' ),
			'view_cart'        => __( 'مشاهده سبد', 'bahoosh-analytics-pro' ),
			'begin_checkout'   => __( 'شروع تسویه‌حساب', 'bahoosh-analytics-pro' ),
			'add_payment_info' => __( 'ورود اطلاعات پرداخت', 'bahoosh-analytics-pro' ),
			'purchase'         => __( 'خرید نهایی', 'bahoosh-analytics-pro' ),
		);

		return $labels[ $step ] ?? $step;
	}
}
