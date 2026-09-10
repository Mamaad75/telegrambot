<?php
/**
 * Reports computed from the site's own data.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Answers the dashboard's questions without a collector.
 *
 * Every method here returns the exact shape {@see BAP_Reports::normalize_metrics()}
 * produces from a collector response, so the admin screens cannot tell the
 * difference and no rendering code had to change. What differs is where the
 * numbers come from: one pass over {@see BAP_Local_Store}, plus WooCommerce for
 * anything involving money.
 *
 * Two rules govern this file.
 *
 * **Nothing is invented.** Where the data cannot answer a question, the answer
 * is an empty list and a stated reason — never a plausible-looking number. The
 * clearest case is countries: resolving one needs a GeoIP database this plugin
 * does not ship, so the countries panel stays empty and says so. A dashboard
 * that quietly guesses is worse than one that admits a gap.
 *
 * **Sessions are derived, not stored.** The tracker has no session concept —
 * that was removed in v3 on purpose — so a session here is defined the ordinary
 * way: one visitor's events, split wherever they went quiet for longer than the
 * inactivity gap. It is computed the same way every time, which is what makes
 * two reports over the same window comparable.
 *
 * @since 4.3.1
 */
class BAP_Local_Reports {

	/**
	 * Minutes of inactivity that end a session.
	 *
	 * Thirty is the industry convention, including GA4's default. Matching it
	 * matters: a shop comparing this dashboard against Analytics should not see
	 * two different session counts because two tools drew the line differently.
	 *
	 * @var int
	 */
	const SESSION_GAP_MINUTES = 30;

	/**
	 * Rows returned in each breakdown panel.
	 *
	 * @var int
	 */
	const PANEL_ROWS = 10;

	/**
	 * Metrics for a window, in the dashboard's shape.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	public static function metrics( $from, $to ) {
		$from = BAP_Reports::sanitize_date( $from );
		$to   = BAP_Reports::sanitize_date( $to );

		$loaded = BAP_Local_Store::events( $from, $to );
		$rows   = $loaded['rows'];

		$visitors     = array();
		$page_views   = 0;
		$searches     = 0;
		$pages        = array();
		$sources      = array();
		$devices      = array();
		$daily        = array();
		$event_value  = 0.0;
		$event_orders = 0;

		// Per-visitor timelines, kept only long enough to cut them into sessions.
		$timeline = array();

		foreach ( $rows as $row ) {
			$type    = (string) $row['event_type'];
			$visitor = (string) $row['anonymous_id'];
			$day     = substr( (string) $row['occurred_at'], 0, 10 );
			$stamp   = strtotime( (string) $row['occurred_at'] . ' UTC' );

			if ( '' !== $visitor ) {
				$visitors[ $visitor ] = true;
				$timeline[ $visitor ][] = $stamp;
			}

			if ( ! isset( $daily[ $day ] ) ) {
				$daily[ $day ] = array( 'events' => 0, 'page_views' => 0, 'visitors' => array() );
			}
			$daily[ $day ]['events']++;
			if ( '' !== $visitor ) {
				$daily[ $day ]['visitors'][ $visitor ] = true;
			}

			$device = '' !== $row['device'] ? (string) $row['device'] : 'unknown';
			$devices[ $device ] = ( $devices[ $device ] ?? 0 ) + 1;

			if ( 'page_view' === $type ) {
				$page_views++;
				$daily[ $day ]['page_views']++;

				$path = '' !== $row['page_path'] ? (string) $row['page_path'] : '/';
				$pages[ $path ] = ( $pages[ $path ] ?? 0 ) + 1;

				// Counted on page views only. Counting every event would rank a
				// source by how chatty its visitors' browsers were.
				$source = '' !== $row['referrer_host'] ? (string) $row['referrer_host'] : 'direct';
				if ( ! isset( $sources[ $source ] ) ) {
					$sources[ $source ] = array();
				}
				if ( '' !== $visitor ) {
					$sources[ $source ][ $visitor ] = true;
				}
			}

			if ( 'search' === $type ) {
				$searches++;
			}

			if ( 'purchase' === $type ) {
				$event_orders++;
				$event_value += (float) $row['value'];
			}
		}

		$sessions = self::sessions( $timeline );

		// Money comes from WooCommerce when it is there. Orders are the record;
		// a purchase event can be blocked, lost or fired twice, and a shop owner
		// comparing this card against their orders screen should see the same
		// figure they would be paid.
		$commerce = self::commerce( $from, $to, $event_orders, $event_value );

		$total_events = BAP_Local_Store::count( $from, $to );
		$warnings     = array();

		// Orders come from WooCommerce and sessions from the tracker, and the
		// two do not always describe the same people: an order placed by phone,
		// by an admin, through a visitor who blocks scripts, or in a session
		// that began before this window all count as an order with no session
		// behind it. Left alone that produces a conversion rate above 100%,
		// which reads as a broken dashboard. It is capped, and the reason is
		// stated rather than the number being quietly massaged.
		$rate = $sessions > 0 ? round( ( $commerce['orders'] / $sessions ) * 100, 2 ) : 0.0;

		if ( $commerce['orders'] > $sessions && $commerce['orders'] > 0 ) {
			$rate = 100.0;

			$warnings[] = sprintf(
				/* translators: 1: order count, 2: session count. */
				__( 'در این بازه %1$s سفارش ثبت شده ولی تنها %2$s نشست رهگیری شده است. سفارش‌هایی که تلفنی، توسط مدیر، یا در مرورگری با مسدودکننده اسکریپت ثبت شده‌اند نشست متناظر ندارند، بنابراین نرخ تبدیل دقیق نیست.', 'bahoosh-analytics-pro' ),
				number_format_i18n( $commerce['orders'] ),
				number_format_i18n( $sessions )
			);
		}

		if ( $loaded['truncated'] ) {
			$warnings[] = sprintf(
				/* translators: %s: number of events. */
				__( 'در این بازه بیش از %s رویداد ثبت شده و برای محاسبه، تنها بخش نخست آن خوانده شده است. کارت «کل رویدادها» عدد کامل را نشان می‌دهد ولی تفکیک‌ها بر پایه همین بخش‌اند. بازه کوتاه‌تری را انتخاب کنید.', 'bahoosh-analytics-pro' ),
				number_format_i18n( BAP_Local_Store::MAX_REPORT_ROWS )
			);
		}

		return array(
			'total_events'    => $total_events,
			'unique_users'    => count( $visitors ),
			'sessions'        => $sessions,
			'page_views'      => $page_views,
			'searches'        => $searches,
			'realtime_users'  => BAP_Local_Store::realtime_visitors(),
			'conversions'     => $commerce['orders'],
			'revenue'         => $commerce['revenue'],
			'conversion_rate' => $rate,
			'currency'        => $commerce['currency'],
			'top_pages'       => self::panel( $pages, 'url', 'views' ),
			'traffic_sources' => self::panel( array_map( 'count', $sources ), 'source', 'sessions' ),
			'devices'         => self::panel( $devices, 'device_type', 'sessions' ),
			// Empty on purpose. A country needs a GeoIP lookup this plugin does
			// not ship, and a guessed country is worse than a blank panel.
			'countries'       => array(),
			'timeseries'      => self::timeseries( $daily, $from, $to ),
			'source'          => 'local',
			'notes'           => $warnings,
		);
	}

	/**
	 * Splits visitor timelines into sessions.
	 *
	 * @param array<string,int[]> $timeline Timestamps per visitor.
	 * @return int
	 */
	private static function sessions( array $timeline ) {
		$gap   = self::SESSION_GAP_MINUTES * MINUTE_IN_SECONDS;
		$count = 0;

		foreach ( $timeline as $stamps ) {
			sort( $stamps );

			$previous = null;
			foreach ( $stamps as $stamp ) {
				if ( null === $previous || ( $stamp - $previous ) > $gap ) {
					$count++;
				}
				$previous = $stamp;
			}
		}

		return $count;
	}

	/**
	 * Orders and revenue for the window.
	 *
	 * @param string $from         Y-m-d.
	 * @param string $to           Y-m-d.
	 * @param int    $event_orders Purchase events seen.
	 * @param float  $event_value  Their summed value.
	 * @return array{orders:int,revenue:float,currency:string}
	 */
	private static function commerce( $from, $to, $event_orders, $event_value ) {
		if ( ! BAP_Commerce_Facts::available() ) {
			return array(
				'orders'   => (int) $event_orders,
				'revenue'  => round( (float) $event_value, 2 ),
				'currency' => '',
			);
		}

		// Already normalised to plain arrays by BAP_Commerce_Facts, which is also
		// what applies the paid-status filter: a pending or cancelled order is
		// not revenue and never reaches this loop.
		$orders  = BAP_Commerce_Facts::orders( $from, $to );
		$revenue = 0.0;

		foreach ( $orders as $order ) {
			$revenue += (float) $order['total'];
		}

		return array(
			'orders'   => count( $orders ),
			'revenue'  => round( $revenue, 2 ),
			'currency' => BAP_Commerce_Facts::currency(),
		);
	}

	/**
	 * Turns a counted map into a sorted panel.
	 *
	 * @param array  $counts     Label => count.
	 * @param string $label_key  Key name for the label.
	 * @param string $value_key  Key name for the count.
	 * @return array
	 */
	private static function panel( array $counts, $label_key, $value_key ) {
		arsort( $counts );

		$rows = array();

		foreach ( array_slice( $counts, 0, self::PANEL_ROWS, true ) as $label => $count ) {
			$rows[] = array(
				$label_key => (string) $label,
				$value_key => (int) $count,
			);
		}

		return $rows;
	}

	/**
	 * A row per day in the window, including days with no traffic.
	 *
	 * Missing days are filled with zeros rather than omitted. A chart that skips
	 * quiet days compresses them out of existence and makes a flat week look
	 * like steady activity.
	 *
	 * @param array  $daily Aggregates by day.
	 * @param string $from  Y-m-d.
	 * @param string $to    Y-m-d.
	 * @return array
	 */
	private static function timeseries( array $daily, $from, $to ) {
		$start = strtotime( $from . ' 00:00:00 UTC' );
		$end   = strtotime( $to . ' 00:00:00 UTC' );

		if ( ! $start || ! $end || $end < $start ) {
			return array();
		}

		$series = array();

		for ( $day = $start; $day <= $end; $day += DAY_IN_SECONDS ) {
			$date = gmdate( 'Y-m-d', $day );
			$row  = $daily[ $date ] ?? array( 'events' => 0, 'page_views' => 0, 'visitors' => array() );

			$series[] = array(
				'date'       => $date,
				'events'     => (int) $row['events'],
				'users'      => count( $row['visitors'] ),
				// Sessions are not split per day: doing it correctly means
				// re-deriving them inside each day's boundary, and a session
				// that crosses midnight belongs to neither day cleanly. The
				// chart plots events, users and page views, which are exact.
				'sessions'   => 0,
				'page_views' => (int) $row['page_views'],
			);

			if ( count( $series ) >= 400 ) {
				break;
			}
		}

		return $series;
	}

	/**
	 * Funnel and drop-off, from the local rollup.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	public static function funnel( $from, $to ) {
		$counts = BAP_Rollup::funnel( $from, $to );
		$steps  = array();
		$first  = 0;

		foreach ( BAP_Rollup::STEPS as $index => $step ) {
			$reached = (int) $counts[ $step ];

			if ( 0 === $index ) {
				$first = $reached;
			}

			$next      = BAP_Rollup::STEPS[ $index + 1 ] ?? '';
			$continued = '' !== $next ? (int) $counts[ $next ] : null;

			$steps[] = array(
				'step'       => $step,
				'label'      => BAP_Analysis_Packet::step_label( $step ),
				'count'      => $reached,
				'drop_pc'    => ( null !== $continued && $reached > 0 )
					? max( 0.0, round( ( ( $reached - $continued ) / $reached ) * 100, 1 ) )
					: null,
				'of_first_pc' => $first > 0 ? round( ( $reached / $first ) * 100, 1 ) : 0.0,
			);
		}

		return array(
			'steps'  => $steps,
			'source' => 'local',
		);
	}

	/**
	 * Experience signals: friction the tracker itself recorded.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	public static function experience( $from, $to ) {
		$loaded  = BAP_Local_Store::events( BAP_Reports::sanitize_date( $from ), BAP_Reports::sanitize_date( $to ) );
		$signals = array( 'rage_click', 'dead_click', 'js_error', 'web_vital' );
		$pages   = array();
		$totals  = array_fill_keys( $signals, 0 );

		foreach ( $loaded['rows'] as $row ) {
			$type = (string) $row['event_type'];

			if ( ! in_array( $type, $signals, true ) ) {
				continue;
			}

			$path = '' !== $row['page_path'] ? (string) $row['page_path'] : '/';

			if ( ! isset( $pages[ $path ] ) ) {
				$pages[ $path ] = array_fill_keys( $signals, 0 );
			}

			$pages[ $path ][ $type ]++;
			$totals[ $type ]++;
		}

		uasort(
			$pages,
			static function ( $a, $b ) {
				return array_sum( $b ) <=> array_sum( $a );
			}
		);

		$rows = array();

		foreach ( array_slice( $pages, 0, self::PANEL_ROWS, true ) as $path => $counts ) {
			$rows[] = array_merge( array( 'page_path' => $path ), $counts );
		}

		return array(
			'totals' => $totals,
			'pages'  => $rows,
			'source' => 'local',
			// Said plainly: these signals only exist if the matching tracking
			// options are on, and they are off by default.
			'notes'  => self::experience_notes(),
		);
	}

	/**
	 * Warnings about experience tracking that is switched off.
	 *
	 * @return array
	 */
	private static function experience_notes() {
		$off = array();

		$switches = array(
			'track_rage_clicks' => __( 'کلیک عصبی', 'bahoosh-analytics-pro' ),
			'track_dead_clicks' => __( 'کلیک بی‌اثر', 'bahoosh-analytics-pro' ),
			'track_js_errors'   => __( 'خطای جاوااسکریپت', 'bahoosh-analytics-pro' ),
			'track_web_vitals'  => __( 'شاخص‌های Web Vitals', 'bahoosh-analytics-pro' ),
		);

		foreach ( $switches as $key => $label ) {
			if ( ! BAP_Settings::get( $key ) ) {
				$off[] = $label;
			}
		}

		if ( ! $off ) {
			return array();
		}

		return array(
			sprintf(
				/* translators: %s: comma-separated list of tracking options. */
				__( 'این موارد در تنظیمات خاموش‌اند و داده‌ای برایشان جمع نمی‌شود: %s', 'bahoosh-analytics-pro' ),
				implode( '، ', $off )
			),
		);
	}

	/**
	 * The paths visitors actually walked.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	public static function journeys( $from, $to ) {
		$loaded  = BAP_Local_Store::events( BAP_Reports::sanitize_date( $from ), BAP_Reports::sanitize_date( $to ) );
		$walks   = array();
		$entries = array();
		$exits   = array();

		foreach ( $loaded['rows'] as $row ) {
			if ( 'page_view' !== (string) $row['event_type'] ) {
				continue;
			}

			$visitor = (string) $row['anonymous_id'];

			if ( '' === $visitor ) {
				continue;
			}

			$walks[ $visitor ][] = '' !== $row['page_path'] ? (string) $row['page_path'] : '/';
		}

		$sequences = array();

		foreach ( $walks as $path_list ) {
			$entries[ $path_list[0] ] = ( $entries[ $path_list[0] ] ?? 0 ) + 1;

			$last = $path_list[ count( $path_list ) - 1 ];
			$exits[ $last ] = ( $exits[ $last ] ?? 0 ) + 1;

			// Three pages is the shortest walk that shows a decision rather than
			// just an arrival.
			$trimmed = array_slice( $path_list, 0, 3 );

			if ( count( $trimmed ) < 2 ) {
				continue;
			}

			$key = implode( ' → ', $trimmed );
			$sequences[ $key ] = ( $sequences[ $key ] ?? 0 ) + 1;
		}

		arsort( $sequences );
		arsort( $entries );
		arsort( $exits );

		$paths = array();

		foreach ( array_slice( $sequences, 0, self::PANEL_ROWS, true ) as $sequence => $count ) {
			$paths[] = array(
				'path'     => $sequence,
				'visitors' => (int) $count,
			);
		}

		return array(
			'paths'   => $paths,
			'entries' => self::panel( $entries, 'page_path', 'visitors' ),
			'exits'   => self::panel( $exits, 'page_path', 'visitors' ),
			'source'  => 'local',
		);
	}

	/**
	 * Everything that happened, itemised.
	 *
	 * The dashboard answers "how much"; this answers "what". A page-view count
	 * of 812 is a number to look at once. The list of which 812 pages, which
	 * events fired on them, and what people typed into the search box is the
	 * thing an owner acts on — an empty-result search is a product they could
	 * stock, and a page nobody reaches is a link nobody found.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	public static function explorer( $from, $to ) {
		$from   = BAP_Reports::sanitize_date( $from );
		$to     = BAP_Reports::sanitize_date( $to );
		$loaded = BAP_Local_Store::events( $from, $to );

		$pages    = array();
		$types    = array();
		$searches = array();
		$devices  = array();
		$feed     = array();

		foreach ( $loaded['rows'] as $row ) {
			$type = (string) $row['event_type'];
			$path = '' !== $row['page_path'] ? (string) $row['page_path'] : '/';

			if ( ! isset( $types[ $type ] ) ) {
				$types[ $type ] = array( 'count' => 0, 'visitors' => array() );
			}
			$types[ $type ]['count']++;

			if ( '' !== $row['anonymous_id'] ) {
				$types[ $type ]['visitors'][ $row['anonymous_id'] ] = true;
			}

			if ( ! isset( $pages[ $path ] ) ) {
				$pages[ $path ] = array(
					'page_path' => $path,
					'views'     => 0,
					'events'    => 0,
					'visitors'  => array(),
					'revenue'   => 0.0,
					'last_seen' => '',
					'by_type'   => array(),
				);
			}

			$pages[ $path ]['events']++;
			$pages[ $path ]['by_type'][ $type ] = ( $pages[ $path ]['by_type'][ $type ] ?? 0 ) + 1;
			$pages[ $path ]['last_seen']        = (string) $row['occurred_at'];
			$pages[ $path ]['revenue']         += (float) $row['value'];

			if ( '' !== $row['anonymous_id'] ) {
				$pages[ $path ]['visitors'][ $row['anonymous_id'] ] = true;
			}

			if ( 'page_view' === $type ) {
				$pages[ $path ]['views']++;
			}

			if ( 'search' === $type && '' !== $row['label'] ) {
				$term = (string) $row['label'];

				if ( ! isset( $searches[ $term ] ) ) {
					$searches[ $term ] = array( 'term' => $term, 'count' => 0, 'visitors' => array() );
				}

				$searches[ $term ]['count']++;

				if ( '' !== $row['anonymous_id'] ) {
					$searches[ $term ]['visitors'][ $row['anonymous_id'] ] = true;
				}
			}

			$device = '' !== $row['device'] ? (string) $row['device'] : 'unknown';
			$devices[ $device ] = ( $devices[ $device ] ?? 0 ) + 1;

			// A rolling window of the most recent events. Kept short on purpose:
			// this is a "is it working right now" view, not an archive.
			$feed[] = array(
				'event_type' => $type,
				'page_path'  => $path,
				'label'      => (string) $row['label'],
				'device'     => $device,
				'value'      => (float) $row['value'],
				'at'         => (string) $row['occurred_at'],
			);

			if ( count( $feed ) > 400 ) {
				array_shift( $feed );
			}
		}

		// Counted visitors collapse to numbers here: the identifiers were only
		// ever needed to count distinct people, and nothing downstream should be
		// handed a list of who was on which page.
		foreach ( $pages as $path => $page ) {
			$pages[ $path ]['visitors'] = count( $page['visitors'] );
			$pages[ $path ]['revenue']  = round( $page['revenue'], 2 );
			arsort( $pages[ $path ]['by_type'] );
		}

		foreach ( $types as $type => $row ) {
			$types[ $type ] = array(
				'event_type' => $type,
				'label'      => self::event_label( $type ),
				'count'      => $row['count'],
				'visitors'   => count( $row['visitors'] ),
			);
		}

		foreach ( $searches as $term => $row ) {
			$searches[ $term ]['visitors'] = count( $row['visitors'] );
		}

		uasort( $pages, static fn( $a, $b ) => $b['events'] <=> $a['events'] );
		uasort( $types, static fn( $a, $b ) => $b['count'] <=> $a['count'] );
		uasort( $searches, static fn( $a, $b ) => $b['count'] <=> $a['count'] );

		return array(
			'pages'     => array_values( array_slice( $pages, 0, 100 ) ),
			'types'     => array_values( $types ),
			'searches'  => array_values( array_slice( $searches, 0, 50 ) ),
			'devices'   => self::panel( $devices, 'device_type', 'events' ),
			'feed'      => array_reverse( array_slice( $feed, -100 ) ),
			'paths'     => self::journeys( $from, $to )['paths'],
			'truncated' => $loaded['truncated'],
			'source'    => 'local',
			// Search only produces rows when visitors use the site's own search.
			// Said explicitly, because an empty panel otherwise reads as a bug.
			'notes'     => $searches ? array() : array(
				__( 'هنوز جست‌وجویی ثبت نشده است. این پنل وقتی پر می‌شود که بازدیدکننده‌ای از جست‌وجوی خود سایت (پارامتر ?s=) استفاده کند.', 'bahoosh-analytics-pro' ),
			),
		);
	}

	/**
	 * Persian label for an event type.
	 *
	 * @param string $type Event type.
	 * @return string
	 */
	public static function event_label( $type ) {
		$labels = array(
			'page_view'        => __( 'بازدید صفحه', 'bahoosh-analytics-pro' ),
			'click'            => __( 'کلیک', 'bahoosh-analytics-pro' ),
			'scroll'           => __( 'اسکرول', 'bahoosh-analytics-pro' ),
			'search'           => __( 'جست‌وجو', 'bahoosh-analytics-pro' ),
			'form_submit'      => __( 'ارسال فرم', 'bahoosh-analytics-pro' ),
			'time_on_page'     => __( 'زمان روی صفحه', 'bahoosh-analytics-pro' ),
			'rage_click'       => __( 'کلیک عصبی', 'bahoosh-analytics-pro' ),
			'dead_click'       => __( 'کلیک بی‌اثر', 'bahoosh-analytics-pro' ),
			'js_error'         => __( 'خطای جاوااسکریپت', 'bahoosh-analytics-pro' ),
			'web_vital'        => __( 'شاخص عملکرد', 'bahoosh-analytics-pro' ),
			'view_item'        => __( 'مشاهده محصول', 'bahoosh-analytics-pro' ),
			'add_to_cart'      => __( 'افزودن به سبد', 'bahoosh-analytics-pro' ),
			'remove_from_cart' => __( 'حذف از سبد', 'bahoosh-analytics-pro' ),
			'view_cart'        => __( 'مشاهده سبد', 'bahoosh-analytics-pro' ),
			'begin_checkout'   => __( 'شروع تسویه‌حساب', 'bahoosh-analytics-pro' ),
			'add_payment_info' => __( 'ورود اطلاعات پرداخت', 'bahoosh-analytics-pro' ),
			'purchase'         => __( 'خرید', 'bahoosh-analytics-pro' ),
			'refund'           => __( 'بازپرداخت', 'bahoosh-analytics-pro' ),
			'login'            => __( 'ورود کاربر', 'bahoosh-analytics-pro' ),
			'signup'           => __( 'ثبت‌نام', 'bahoosh-analytics-pro' ),
			'media'            => __( 'پخش رسانه', 'bahoosh-analytics-pro' ),
			'copy'             => __( 'کپی متن', 'bahoosh-analytics-pro' ),
		);

		return $labels[ $type ] ?? $type;
	}

	/**
	 * Whether the local store holds anything for a window.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return bool
	 */
	public static function has_data( $from, $to ) {
		return BAP_Local_Store::count( $from, $to ) > 0;
	}
}
