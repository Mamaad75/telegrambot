<?php
/**
 * Google Analytics 4 as a data source.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Reads a site's own GA4 property through the Analytics Data API.
 *
 * Most shops running this plugin already have GA4 installed and have had it for
 * years. That history is the one thing the plugin cannot produce for itself: the
 * local rollup starts counting the day it is activated, so on a fresh install
 * the funnel is empty and every behavioural recommendation has to say "not
 * enough data yet". GA4 already knows what happened last month.
 *
 * So this is not a second analytics system. It is a way to answer the questions
 * the plugin already asks — which device converts, where shoppers stop — using
 * numbers the shop already has, for periods that predate the plugin.
 *
 * Authentication is a Google service account. There is no OAuth dance to click
 * through, no token to refresh by hand, and no user session involved: the
 * account's private key signs a JWT, Google exchanges it for an access token,
 * and the token is cached until shortly before it expires.
 *
 * The private key is a secret. It is stored un-autoloaded, never returned by a
 * REST route, never printed in a diagnostic report, and never written to a log.
 * What the admin screen can see is whether a key is present and which service
 * account it belongs to — never the key itself.
 *
 * @since 4.3.0
 */
class BAP_GA4 {

	/**
	 * Option holding the service-account JSON.
	 *
	 * @var string
	 */
	const OPTION_CREDENTIALS = 'bap_ga4_credentials';

	/**
	 * Transient holding the current access token.
	 *
	 * @var string
	 */
	const TRANSIENT_TOKEN = 'bap_ga4_token';

	const TOKEN_URL  = 'https://oauth2.googleapis.com/token';
	const REPORT_URL = 'https://analyticsdata.googleapis.com/v1beta/properties/%s:runReport';
	const SCOPE      = 'https://www.googleapis.com/auth/analytics.readonly';

	const TIMEOUT = 30;

	/**
	 * How long a report is reused before GA4 is asked again.
	 *
	 * The Data API has request quotas per property per day, and an admin who
	 * clicks Analyse five times while reading the results should not spend five
	 * of them.
	 *
	 * @var int
	 */
	const CACHE_SECONDS = 1800;

	/**
	 * Whether GA4 is configured well enough to query.
	 *
	 * @return bool
	 */
	public static function available() {
		return '' !== self::property_id()
			&& array() !== self::credentials()
			&& function_exists( 'openssl_sign' );
	}

	/**
	 * The configured property id, digits only.
	 *
	 * @return string
	 */
	public static function property_id() {
		return preg_replace( '/[^0-9]/', '', (string) BAP_Settings::get( 'ga4_property_id', '' ) );
	}

	/**
	 * Stores a service-account JSON document.
	 *
	 * @param string $json Raw JSON.
	 * @return true|WP_Error
	 */
	public static function set_credentials( $json ) {
		$json = trim( (string) $json );

		if ( '' === $json ) {
			delete_option( self::OPTION_CREDENTIALS );
			delete_transient( self::TRANSIENT_TOKEN );
			return true;
		}

		$decoded = json_decode( $json, true );

		if ( ! is_array( $decoded ) || empty( $decoded['client_email'] ) || empty( $decoded['private_key'] ) ) {
			return new WP_Error(
				'bap_ga4_bad_credentials',
				__( 'فایل سرویس‌اکانت معتبر نیست. باید یک JSON شامل client_email و private_key باشد.', 'bahoosh-analytics-pro' )
			);
		}

		// Only the two fields that are actually used are kept. A service-account
		// file also carries ids and URLs that this plugin has no business
		// storing, and a secret that is not stored cannot leak.
		update_option(
			self::OPTION_CREDENTIALS,
			array(
				'client_email' => sanitize_text_field( (string) $decoded['client_email'] ),
				'private_key'  => (string) $decoded['private_key'],
			),
			false
		);

		delete_transient( self::TRANSIENT_TOKEN );

		return true;
	}

	/**
	 * The stored credentials.
	 *
	 * @return array
	 */
	private static function credentials() {
		$stored = get_option( self::OPTION_CREDENTIALS, array() );

		return is_array( $stored ) && ! empty( $stored['private_key'] ) ? $stored : array();
	}

	/**
	 * Safe status for the admin screen.
	 *
	 * Deliberately returns no key material, and masks the account address:
	 * enough to recognise which account is connected, not enough to be worth
	 * copying out of a screenshot.
	 *
	 * @return array
	 */
	public static function status() {
		$credentials = self::credentials();
		$email       = (string) ( $credentials['client_email'] ?? '' );

		return array(
			'connected'   => self::available(),
			'has_key'     => array() !== $credentials,
			'property_id' => self::property_id(),
			'account'     => '' === $email ? '' : BAP_Debug_Log::mask( $email ),
			'openssl'     => function_exists( 'openssl_sign' ),
		);
	}

	/**
	 * Facts derived from GA4 for a period.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array{facts:array,warnings:array}
	 */
	public static function facts( $from, $to ) {
		if ( ! self::available() ) {
			return array( 'facts' => array(), 'warnings' => array() );
		}

		$facts    = array();
		$warnings = array();

		$devices = self::run_report(
			$from,
			$to,
			array( array( 'name' => 'deviceCategory' ) ),
			array(
				array( 'name' => 'sessions' ),
				array( 'name' => 'totalRevenue' ),
				array( 'name' => 'transactions' ),
			)
		);

		if ( is_wp_error( $devices ) ) {
			$warnings[] = sprintf(
				/* translators: %s: error message. */
				__( 'خواندن داده از گوگل آنالیتیکس انجام نشد: %s', 'bahoosh-analytics-pro' ),
				$devices->get_error_message()
			);

			return array( 'facts' => array(), 'warnings' => $warnings );
		}

		foreach ( self::rows( $devices ) as $row ) {
			$device   = (string) ( $row['dimensions'][0] ?? '' );
			$sessions = (int) ( $row['metrics'][0] ?? 0 );
			$revenue  = (float) ( $row['metrics'][1] ?? 0 );
			$orders   = (int) ( $row['metrics'][2] ?? 0 );

			if ( '' === $device || $sessions < 1 ) {
				continue;
			}

			$facts[] = array(
				'id'    => 'ga4_device_' . preg_replace( '/[^a-z]/', '', strtolower( $device ) ),
				'kind'  => 'ga4.device_conversion',
				'label' => sprintf(
					/* translators: %s: GA4 device category. */
					__( 'نرخ تبدیل گوگل آنالیتیکس برای دستگاه %s', 'bahoosh-analytics-pro' ),
					$device
				),
				'value' => array(
					'device'          => $device,
					'sessions'        => $sessions,
					'transactions'    => $orders,
					'revenue'         => round( $revenue, 2 ),
					// The number the whole device question turns on, computed
					// here rather than left for a model to divide.
					'conversion_pc'   => $sessions > 0 ? round( ( $orders / $sessions ) * 100, 2 ) : 0.0,
					'revenue_per_session' => $sessions > 0 ? round( $revenue / $sessions, 2 ) : 0.0,
					'source'          => 'ga4',
				),
				'sample' => $sessions,
			);
		}

		$events = self::run_report(
			$from,
			$to,
			array( array( 'name' => 'eventName' ) ),
			array( array( 'name' => 'eventCount' ) )
		);

		if ( ! is_wp_error( $events ) ) {
			$wanted = array( 'view_item', 'add_to_cart', 'view_cart', 'begin_checkout', 'add_payment_info', 'purchase' );
			$counts = array();

			foreach ( self::rows( $events ) as $row ) {
				$name = (string) ( $row['dimensions'][0] ?? '' );

				if ( in_array( $name, $wanted, true ) ) {
					$counts[ $name ] = (int) ( $row['metrics'][0] ?? 0 );
				}
			}

			foreach ( $wanted as $index => $step ) {
				if ( ! isset( $counts[ $step ] ) ) {
					continue;
				}

				$next      = $wanted[ $index + 1 ] ?? '';
				$continued = '' !== $next && isset( $counts[ $next ] ) ? $counts[ $next ] : null;
				$drop      = null;

				if ( null !== $continued && $counts[ $step ] > 0 ) {
					$drop = max( 0.0, round( ( ( $counts[ $step ] - $continued ) / $counts[ $step ] ) * 100, 1 ) );
				}

				$facts[] = array(
					'id'    => 'ga4_funnel_' . $step,
					'kind'  => 'funnel.step',
					'label' => sprintf(
						/* translators: %s: funnel step label. */
						__( 'مرحله قیف بر اساس گوگل آنالیتیکس: %s', 'bahoosh-analytics-pro' ),
						BAP_Analysis_Packet::step_label( $step )
					),
					'value' => array(
						'step'      => $step,
						'reached'   => $counts[ $step ],
						'next_step' => $next,
						'continued' => $continued,
						'drop_pc'   => $drop,
						'source'    => 'ga4',
					),
					'sample' => $counts[ $step ],
				);
			}
		}

		return array( 'facts' => $facts, 'warnings' => $warnings );
	}

	/**
	 * Runs one GA4 report.
	 *
	 * @param string $from       Y-m-d.
	 * @param string $to         Y-m-d.
	 * @param array  $dimensions Dimension definitions.
	 * @param array  $metrics    Metric definitions.
	 * @return array|WP_Error Decoded response.
	 */
	public static function run_report( $from, $to, array $dimensions, array $metrics ) {
		$property = self::property_id();

		if ( '' === $property ) {
			return new WP_Error( 'bap_ga4_no_property', __( 'شناسه Property تنظیم نشده است.', 'bahoosh-analytics-pro' ) );
		}

		$body = array(
			'dateRanges' => array(
				array(
					'startDate' => BAP_Reports::sanitize_date( $from ),
					'endDate'   => BAP_Reports::sanitize_date( $to ),
				),
			),
			'dimensions' => $dimensions,
			'metrics'    => $metrics,
			'limit'      => 100,
		);

		$cache_key = 'bap_ga4_' . md5( $property . wp_json_encode( $body ) );
		$cached    = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		$token = self::access_token();

		if ( is_wp_error( $token ) ) {
			return $token;
		}

		$response = wp_remote_post(
			sprintf( self::REPORT_URL, rawurlencode( $property ) ),
			array(
				'timeout' => self::TIMEOUT,
				'headers' => array(
					'Content-Type'  => 'application/json',
					'Authorization' => 'Bearer ' . $token,
				),
				'body'    => wp_json_encode( $body ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$status  = (int) wp_remote_retrieve_response_code( $response );
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $status ) {
			// 403 here is nearly always the same mistake: the service account
			// exists but was never added to the GA4 property. Saying so saves an
			// hour of looking in the wrong place.
			$message = 403 === $status
				? __( 'گوگل دسترسی را رد کرد. ایمیل سرویس‌اکانت باید در بخش Property Access Management گوگل آنالیتیکس با نقش Viewer اضافه شده باشد.', 'bahoosh-analytics-pro' )
				: (string) ( $decoded['error']['message'] ?? sprintf(
					/* translators: %d: HTTP status code. */
					__( 'گوگل آنالیتیکس با کد %d پاسخ داد.', 'bahoosh-analytics-pro' ),
					$status
				) );

			return new WP_Error( 'bap_ga4_request_failed', $message );
		}

		$decoded = is_array( $decoded ) ? $decoded : array();

		set_transient( $cache_key, $decoded, self::CACHE_SECONDS );

		return $decoded;
	}

	/**
	 * Normalises a GA4 report into plain rows.
	 *
	 * @param array $report Decoded report.
	 * @return array
	 */
	private static function rows( array $report ) {
		$rows = array();

		foreach ( (array) ( $report['rows'] ?? array() ) as $row ) {
			$rows[] = array(
				'dimensions' => wp_list_pluck( (array) ( $row['dimensionValues'] ?? array() ), 'value' ),
				'metrics'    => wp_list_pluck( (array) ( $row['metricValues'] ?? array() ), 'value' ),
			);
		}

		return $rows;
	}

	/**
	 * Returns a valid access token, minting one when needed.
	 *
	 * @return string|WP_Error
	 */
	public static function access_token() {
		$cached = get_transient( self::TRANSIENT_TOKEN );

		if ( is_string( $cached ) && '' !== $cached ) {
			return $cached;
		}

		$assertion = self::signed_assertion();

		if ( is_wp_error( $assertion ) ) {
			return $assertion;
		}

		$response = wp_remote_post(
			self::TOKEN_URL,
			array(
				'timeout' => self::TIMEOUT,
				'body'    => array(
					'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
					'assertion'  => $assertion,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$token   = (string) ( $decoded['access_token'] ?? '' );

		if ( '' === $token ) {
			return new WP_Error(
				'bap_ga4_token_failed',
				(string) ( $decoded['error_description'] ?? __( 'دریافت توکن دسترسی از گوگل انجام نشد.', 'bahoosh-analytics-pro' ) )
			);
		}

		$expires = (int) ( $decoded['expires_in'] ?? 3600 );

		// Deliberately short of the real expiry. A token that expires mid-report
		// produces a confusing 401 rather than a clean refresh.
		set_transient( self::TRANSIENT_TOKEN, $token, max( 60, $expires - 120 ) );

		return $token;
	}

	/**
	 * Builds and signs the JWT Google exchanges for a token.
	 *
	 * @return string|WP_Error
	 */
	private static function signed_assertion() {
		$credentials = self::credentials();

		if ( ! $credentials ) {
			return new WP_Error( 'bap_ga4_no_credentials', __( 'فایل سرویس‌اکانت گوگل ذخیره نشده است.', 'bahoosh-analytics-pro' ) );
		}

		if ( ! function_exists( 'openssl_sign' ) ) {
			return new WP_Error(
				'bap_ga4_no_openssl',
				__( 'افزونه OpenSSL در PHP این سرور فعال نیست و بدون آن امضای درخواست گوگل ممکن نیست.', 'bahoosh-analytics-pro' )
			);
		}

		$now = time();

		$header = array(
			'alg' => 'RS256',
			'typ' => 'JWT',
		);

		$claim = array(
			'iss'   => $credentials['client_email'],
			'scope' => self::SCOPE,
			'aud'   => self::TOKEN_URL,
			'exp'   => $now + 3600,
			'iat'   => $now,
		);

		$input = self::base64url( wp_json_encode( $header ) ) . '.' . self::base64url( wp_json_encode( $claim ) );

		$key = openssl_pkey_get_private( $credentials['private_key'] );

		if ( ! $key ) {
			return new WP_Error( 'bap_ga4_bad_key', __( 'کلید خصوصی سرویس‌اکانت قابل خواندن نبود.', 'bahoosh-analytics-pro' ) );
		}

		$signature = '';
		$signed    = openssl_sign( $input, $signature, $key, 'sha256WithRSAEncryption' );

		if ( ! $signed ) {
			return new WP_Error( 'bap_ga4_sign_failed', __( 'امضای درخواست گوگل انجام نشد.', 'bahoosh-analytics-pro' ) );
		}

		return $input . '.' . self::base64url( $signature );
	}

	/**
	 * URL-safe base64 without padding, as JWT requires.
	 *
	 * @param string $value Raw value.
	 * @return string
	 */
	private static function base64url( $value ) {
		return rtrim( strtr( base64_encode( (string) $value ), '+/', '-_' ), '=' );
	}
}
