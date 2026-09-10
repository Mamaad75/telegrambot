<?php
/**
 * Microsoft Clarity as a data source.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Reads friction signals from a site's own Clarity project.
 *
 * The plugin can say *where* shoppers stop. Clarity can say *why*: it records
 * rage clicks, dead clicks, quick-backs and JavaScript errors, per page. That is
 * the difference between "43% abandon at checkout" and "43% abandon at checkout,
 * and 18% of sessions on that page rage-click, and it throws a script error" —
 * which is a bug report a developer can act on this afternoon.
 *
 * Two limits shape everything here, and neither is worked around quietly:
 *
 * The Data Export API allows **ten requests per project per day**. Results are
 * therefore cached for hours, not minutes, and the call count is tracked so an
 * administrator can see how much of the day's budget is left instead of
 * discovering the ceiling as an unexplained failure.
 *
 * It also returns **at most the last three days**, regardless of the period
 * asked for. Clarity facts are labelled with the window they actually cover, and
 * a warning says so in the packet, because a three-day number silently presented
 * as a monthly one is a lie the model would repeat with confidence.
 *
 * @since 4.3.0
 */
class BAP_Clarity {

	const OPTION_TOKEN = 'bap_clarity_token';
	const OPTION_USAGE = 'bap_clarity_usage';

	const API_URL = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';

	/**
	 * The API's own ceiling on the reporting window.
	 *
	 * @var int
	 */
	const MAX_DAYS = 3;

	/**
	 * Requests Clarity allows per project per day.
	 *
	 * @var int
	 */
	const DAILY_LIMIT = 10;

	/**
	 * Hours a result is reused. Chosen against the daily limit: six hours means
	 * at most four automatic refreshes a day, leaving room for manual runs.
	 *
	 * @var int
	 */
	const CACHE_SECONDS = 21600;

	const TIMEOUT = 30;

	/**
	 * Metrics worth asking for, mapped to what they mean for a shop.
	 *
	 * @var array<string,string>
	 */
	const FRICTION_METRICS = array(
		'RageClickCount'    => 'rage_clicks',
		'DeadClickCount'    => 'dead_clicks',
		'ScriptErrorCount'  => 'script_errors',
		'QuickbackClick'    => 'quick_backs',
		'ExcessiveScroll'   => 'excessive_scroll',
	);

	/**
	 * Whether Clarity is configured.
	 *
	 * @return bool
	 */
	public static function available() {
		return '' !== self::token();
	}

	/**
	 * The stored API token.
	 *
	 * @return string
	 */
	public static function token() {
		$token = (string) get_option( self::OPTION_TOKEN, '' );

		/**
		 * Filters the Clarity API token, e.g. to read it from an environment
		 * variable rather than the database.
		 *
		 * @since 4.3.0
		 *
		 * @param string $token API token.
		 */
		return (string) apply_filters( 'bap_clarity_token', $token );
	}

	/**
	 * Stores the API token.
	 *
	 * @param string $token Token.
	 * @return void
	 */
	public static function set_token( $token ) {
		$token = preg_replace( '/[^\x21-\x7E]/', '', (string) $token );

		if ( '' === $token ) {
			delete_option( self::OPTION_TOKEN );
			return;
		}

		update_option( self::OPTION_TOKEN, $token, false );
	}

	/**
	 * Safe status for the admin screen. Never includes the token.
	 *
	 * @return array
	 */
	public static function status() {
		$usage = self::usage();

		return array(
			'connected'     => self::available(),
			'calls_today'   => $usage['count'],
			'daily_limit'   => self::DAILY_LIMIT,
			'window_days'   => self::MAX_DAYS,
		);
	}

	/**
	 * Friction facts for the most recent window Clarity can report on.
	 *
	 * @param int $days How many days to ask for, capped at the API's limit.
	 * @return array{facts:array,warnings:array}
	 */
	public static function facts( $days = self::MAX_DAYS ) {
		if ( ! self::available() ) {
			return array( 'facts' => array(), 'warnings' => array() );
		}

		$days   = max( 1, min( self::MAX_DAYS, (int) $days ) );
		$report = self::fetch( $days );

		if ( is_wp_error( $report ) ) {
			return array(
				'facts'    => array(),
				'warnings' => array(
					sprintf(
						/* translators: %s: error message. */
						__( 'خواندن داده از مایکروسافت کلاریتی انجام نشد: %s', 'bahoosh-analytics-pro' ),
						$report->get_error_message()
					),
				),
			);
		}

		$facts    = array();
		$warnings = array(
			sprintf(
				/* translators: %d: number of days. */
				__( 'داده‌های کلاریتی فقط %d روز اخیر را پوشش می‌دهند (محدودیت خود سرویس) و با بازه انتخاب‌شده یکی نیستند.', 'bahoosh-analytics-pro' ),
				$days
			),
		);

		$sessions = self::total_sessions( $report );

		foreach ( $report as $metric ) {
			$name = (string) ( $metric['metricName'] ?? '' );

			if ( ! isset( self::FRICTION_METRICS[ $name ] ) ) {
				continue;
			}

			$slug = self::FRICTION_METRICS[ $name ];

			foreach ( array_slice( (array) ( $metric['information'] ?? array() ), 0, 8 ) as $row ) {
				$page  = (string) ( $row['URL'] ?? '' );
				$count = (int) ( $row['sessionsCount'] ?? 0 );
				$share = (float) ( $row['sessionsWithMetricPercentage'] ?? 0 );

				if ( '' === $page || $count < 1 ) {
					continue;
				}

				$facts[] = array(
					'id'    => 'clarity_' . $slug . '_' . substr( md5( $page ), 0, 10 ),
					'kind'  => 'ux.friction',
					'label' => sprintf(
						/* translators: 1: friction type, 2: page path. */
						__( 'اصطکاک %1$s در صفحه %2$s', 'bahoosh-analytics-pro' ),
						self::metric_label( $slug ),
						$page
					),
					'value' => array(
						'signal'         => $slug,
						'page_path'      => $page,
						'sessions'       => $count,
						'share_pc'       => round( $share, 2 ),
						'window_days'    => $days,
						'source'         => 'clarity',
					),
					'sample' => $count,
				);
			}
		}

		if ( $sessions > 0 ) {
			$facts[] = array(
				'id'    => 'clarity_traffic',
				'kind'  => 'ux.traffic',
				'label' => __( 'کل نشست‌های ثبت‌شده در کلاریتی', 'bahoosh-analytics-pro' ),
				'value' => array(
					'sessions'    => $sessions,
					'window_days' => $days,
					'source'      => 'clarity',
				),
				'sample' => $sessions,
			);
		}

		return array( 'facts' => $facts, 'warnings' => $warnings );
	}

	/**
	 * Calls the Data Export API, through the cache and the daily budget.
	 *
	 * @param int $days Window.
	 * @return array|WP_Error
	 */
	private static function fetch( $days ) {
		$cache_key = 'bap_clarity_' . $days;
		$cached    = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		$usage = self::usage();

		if ( $usage['count'] >= self::DAILY_LIMIT ) {
			return new WP_Error(
				'bap_clarity_quota',
				sprintf(
					/* translators: %d: daily request limit. */
					__( 'سهمیه روزانه کلاریتی (%d درخواست) تمام شده است. فردا دوباره در دسترس خواهد بود.', 'bahoosh-analytics-pro' ),
					self::DAILY_LIMIT
				)
			);
		}

		$url = add_query_arg(
			array(
				'numOfDays'  => $days,
				'dimension1' => 'URL',
			),
			self::API_URL
		);

		self::record_call();

		$response = wp_remote_get(
			$url,
			array(
				'timeout' => self::TIMEOUT,
				'headers' => array( 'Authorization' => 'Bearer ' . self::token() ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		if ( 401 === $status || 403 === $status ) {
			return new WP_Error(
				'bap_clarity_unauthorized',
				__( 'توکن کلاریتی پذیرفته نشد. یک توکن تازه از Settings > Data Export در پنل کلاریتی بسازید.', 'bahoosh-analytics-pro' )
			);
		}

		if ( 200 !== $status ) {
			return new WP_Error(
				'bap_clarity_request_failed',
				sprintf(
					/* translators: %d: HTTP status code. */
					__( 'کلاریتی با کد %d پاسخ داد.', 'bahoosh-analytics-pro' ),
					$status
				)
			);
		}

		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( ! is_array( $decoded ) ) {
			return new WP_Error( 'bap_clarity_bad_response', __( 'پاسخ کلاریتی قابل خواندن نبود.', 'bahoosh-analytics-pro' ) );
		}

		set_transient( $cache_key, $decoded, self::CACHE_SECONDS );

		return $decoded;
	}

	/**
	 * Total sessions, from the Traffic metric.
	 *
	 * @param array $report Decoded report.
	 * @return int
	 */
	private static function total_sessions( array $report ) {
		foreach ( $report as $metric ) {
			if ( 'Traffic' !== (string) ( $metric['metricName'] ?? '' ) ) {
				continue;
			}

			$total = 0;

			foreach ( (array) ( $metric['information'] ?? array() ) as $row ) {
				$total += (int) ( $row['totalSessionCount'] ?? 0 );
			}

			return $total;
		}

		return 0;
	}

	/**
	 * Today's call count.
	 *
	 * @return array{date:string,count:int}
	 */
	public static function usage() {
		$stored = get_option( self::OPTION_USAGE, array() );
		$today  = gmdate( 'Y-m-d' );

		if ( ! is_array( $stored ) || ( $stored['date'] ?? '' ) !== $today ) {
			return array( 'date' => $today, 'count' => 0 );
		}

		return array( 'date' => $today, 'count' => (int) ( $stored['count'] ?? 0 ) );
	}

	/**
	 * Counts one call against today's budget.
	 *
	 * Incremented before the request, not after. A request that times out still
	 * consumed quota at Clarity's end, and counting only successes would let a
	 * failing site exceed the limit and stay locked out longer.
	 *
	 * @return void
	 */
	private static function record_call() {
		$usage = self::usage();

		update_option(
			self::OPTION_USAGE,
			array(
				'date'  => $usage['date'],
				'count' => $usage['count'] + 1,
			),
			false
		);
	}

	/**
	 * Persian label for a friction signal.
	 *
	 * @param string $slug Signal.
	 * @return string
	 */
	public static function metric_label( $slug ) {
		$labels = array(
			'rage_clicks'      => __( 'کلیک عصبی', 'bahoosh-analytics-pro' ),
			'dead_clicks'      => __( 'کلیک بی‌اثر', 'bahoosh-analytics-pro' ),
			'script_errors'    => __( 'خطای اسکریپت', 'bahoosh-analytics-pro' ),
			'quick_backs'      => __( 'بازگشت سریع', 'bahoosh-analytics-pro' ),
			'excessive_scroll' => __( 'اسکرول بیش از حد', 'bahoosh-analytics-pro' ),
		);

		return $labels[ $slug ] ?? $slug;
	}
}
