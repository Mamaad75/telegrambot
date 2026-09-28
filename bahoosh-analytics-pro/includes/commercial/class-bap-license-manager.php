<?php
/** Commercial license client with cached validation and graceful outage handling. @package Bahoosh_Analytics_Pro */

defined( 'ABSPATH' ) || exit;

class BAP_License_Manager {

	const OPTION_SECRET   = 'bap_license_key_enc';
	const OPTION_SNAPSHOT = 'bap_license_snapshot';
	const OPTION_CHANNEL  = 'bap_release_channel';
	const VALIDATE_HOOK   = 'bap_license_validate';
	const CACHE_VALIDATE  = 'bap_license_validate_cache';
	const CACHE_UPDATE    = 'bap_license_update_cache';
	const GRACE_SECONDS   = 259200; // 72 hours.

	/** Registers periodic revalidation without touching frontend requests. */
	public static function init() {
		add_action( self::VALIDATE_HOOK, array( __CLASS__, 'cron_validate' ) );
		add_action( 'admin_notices', array( __CLASS__, 'admin_notice' ) );
		if ( self::has_license_key() && ! wp_next_scheduled( self::VALIDATE_HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::VALIDATE_HOOK );
		}
	}

	/** @return void */
	public static function cron_validate() {
		self::validate( true );
	}

	/** Commercial API root. Empty means licensing server has not been configured in this build. */
	public static function api_base() {
		$base = defined( 'BAP_COMMERCIAL_API_URL' ) ? (string) BAP_COMMERCIAL_API_URL : '';
		$base = (string) apply_filters( 'bap_commercial_api_url', $base );
		return untrailingslashit( esc_url_raw( $base, array( 'https' ) ) );
	}

	/** @return string */
	public static function release_channel() {
		$channel = (string) get_option( self::OPTION_CHANNEL, 'stable' );
		return in_array( $channel, array( 'stable', 'beta' ), true ) ? $channel : 'stable';
	}

	/** @param string $channel stable|beta. @return string */
	public static function set_release_channel( $channel ) {
		$channel = in_array( $channel, array( 'stable', 'beta' ), true ) ? $channel : 'stable';
		update_option( self::OPTION_CHANNEL, $channel, false );
		delete_transient( self::CACHE_UPDATE );
		return $channel;
	}

	/** @return bool */
	public static function has_license_key() {
		return '' !== self::license_key();
	}

	/** Reads the secret from environment/constant first, encrypted option second. */
	private static function license_key() {
		if ( defined( 'BAP_LICENSE_KEY' ) && '' !== trim( (string) BAP_LICENSE_KEY ) ) {
			return trim( (string) BAP_LICENSE_KEY );
		}
		$filtered = (string) apply_filters( 'bap_license_key', '' );
		if ( '' !== $filtered ) {
			return $filtered;
		}
		return BAP_Secret_Store::decrypt( (string) get_option( self::OPTION_SECRET, '' ) );
	}

	/** @return array */
	public static function snapshot() {
		$stored = get_option( self::OPTION_SNAPSHOT, array() );
		$stored = is_array( $stored ) ? $stored : array();
		return array_merge(
			array(
				'status'                  => self::has_license_key() ? 'unknown' : 'inactive',
				'plan'                    => self::has_license_key() ? '—' : __( 'بدون لایسنس', 'bahoosh-analytics-pro' ),
				'customer_id'             => '',
				'site'                    => home_url(),
				'expires_at'              => null,
				'entitlements'            => array(),
				'feature_flags'           => array(),
				'last_successful_validation' => null,
				'last_attempt'            => null,
				'last_error'              => '',
				'grace_until'             => null,
			),
			$stored
		);
	}


	/** Shows a restrained status notice only when the commercial state needs attention. */
	public static function admin_notice() {
		if ( ! is_admin() || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$snapshot = self::snapshot();
		$status   = (string) ( $snapshot['status'] ?? 'inactive' );
		if ( in_array( $status, array( 'active', 'inactive' ), true ) ) {
			return;
		}

		$messages = array(
			'grace_period'       => __( 'ارتباط با سرویس لایسنس موقتاً برقرار نیست. قابلیت‌های موجود در بازه مهلت آفلاین ادامه می‌یابند.', 'bahoosh-analytics-pro' ),
			'expired'            => __( 'اشتراک باهوش منقضی شده است. داده‌های موجود حفظ می‌شوند؛ برای دریافت قابلیت‌ها و آپدیت‌های تجاری اشتراک را تمدید کنید.', 'bahoosh-analytics-pro' ),
			'suspended'          => __( 'اشتراک باهوش در وضعیت تعلیق است. برای جزئیات صفحه اشتراک را بررسی کنید.', 'bahoosh-analytics-pro' ),
			'invalid'            => __( 'اعتبار لایسنس باهوش تأیید نشد. کلید یا اتصال سایت را بررسی کنید.', 'bahoosh-analytics-pro' ),
			'site_limit_reached' => __( 'این لایسنس به سقف سایت‌های مجاز رسیده است.', 'bahoosh-analytics-pro' ),
			'unknown'            => __( 'وضعیت سرویس تجاری باهوش قابل تأیید نیست. Analytics موجود بدون قطع ناگهانی ادامه می‌یابد.', 'bahoosh-analytics-pro' ),
		);
		if ( empty( $messages[ $status ] ) || ! self::has_license_key() ) {
			return;
		}

		$url = admin_url( 'admin.php?page=bahoosh-analytics-account' );
		echo '<div class="notice notice-warning"><p><strong>Bahoosh:</strong> ' . esc_html( $messages[ $status ] ) . ' <a href="' . esc_url( $url ) . '">' . esc_html__( 'مشاهده وضعیت', 'bahoosh-analytics-pro' ) . '</a></p></div>';
	}

	/** @param string $key License key. @return array|WP_Error */
	public static function activate( $key ) {
		$key = trim( sanitize_text_field( (string) $key ) );
		if ( strlen( $key ) < 8 ) {
			return new WP_Error( 'bap_license_invalid_format', __( 'کلید لایسنس معتبر نیست.', 'bahoosh-analytics-pro' ) );
		}
		if ( '' === self::api_base() ) {
			return new WP_Error( 'bap_license_api_missing', __( 'آدرس سرویس لایسنس در این build تنظیم نشده است.', 'bahoosh-analytics-pro' ) );
		}
		$response = self::request( '/licenses/activate', self::client_payload( array( 'license' => $key ) ), $key );
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$enc = BAP_Secret_Store::encrypt( $key );
		if ( is_wp_error( $enc ) ) {
			return $enc;
		}
		update_option( self::OPTION_SECRET, $enc, false );
		self::save_server_snapshot( $response, '' );
		delete_transient( self::CACHE_VALIDATE );
		delete_transient( self::CACHE_UPDATE );
		if ( ! wp_next_scheduled( self::VALIDATE_HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::VALIDATE_HOOK );
		}
		return self::snapshot();
	}

	/** @return array|WP_Error */
	public static function deactivate() {
		$key = self::license_key();
		if ( '' === $key ) {
			return self::snapshot();
		}
		if ( '' !== self::api_base() ) {
			$response = self::request( '/licenses/deactivate', self::client_payload(), $key );
			if ( is_wp_error( $response ) ) {
				return $response;
			}
		}
		delete_option( self::OPTION_SECRET );
		update_option( self::OPTION_SNAPSHOT, array( 'status' => 'inactive', 'site' => home_url(), 'last_attempt' => gmdate( 'c' ) ), false );
		delete_transient( self::CACHE_VALIDATE );
		delete_transient( self::CACHE_UPDATE );
		wp_clear_scheduled_hook( self::VALIDATE_HOOK );
		return self::snapshot();
	}

	/**
	 * Validates a license. Network failures never catastrophically disable the plugin.
	 *
	 * @param bool $force Ignore six-hour cache.
	 * @return array|WP_Error
	 */
	public static function validate( $force = false ) {
		$key = self::license_key();
		if ( '' === $key ) {
			return self::snapshot();
		}
		if ( ! $force ) {
			$cached = get_transient( self::CACHE_VALIDATE );
			if ( is_array( $cached ) ) {
				return $cached;
			}
		}
		if ( '' === self::api_base() ) {
			return self::network_failure_snapshot( __( 'سرویس لایسنس برای این build تنظیم نشده است.', 'bahoosh-analytics-pro' ) );
		}

		$response = self::request( '/licenses/validate', self::client_payload(), $key );
		if ( is_wp_error( $response ) ) {
			return self::network_failure_snapshot( $response->get_error_message() );
		}
		self::save_server_snapshot( $response, '' );
		$snapshot = self::snapshot();
		set_transient( self::CACHE_VALIDATE, $snapshot, 6 * HOUR_IN_SECONDS );
		return $snapshot;
	}

	/** Update metadata from the commercial backend. @return array|WP_Error */
	public static function update_info( $force = false ) {
		if ( ! self::has_license_key() || '' === self::api_base() ) {
			return new WP_Error( 'bap_update_unavailable', __( 'برای بررسی آپدیت، لایسنس و سرویس انتشار باید فعال باشند.', 'bahoosh-analytics-pro' ) );
		}
		if ( ! $force ) {
			$cached = get_transient( self::CACHE_UPDATE );
			if ( is_array( $cached ) ) {
				return $cached;
			}
		}
		$key      = self::license_key();
		$response = self::request(
			'/updates/check',
			self::client_payload(
				array(
					'channel'      => self::release_channel(),
					'api_contract' => defined( 'BAP_API_CONTRACT' ) ? BAP_API_CONTRACT : 'v4',
				)
			),
			$key
		);
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$clean = self::sanitize_update( $response );
		set_transient( self::CACHE_UPDATE, $clean, 6 * HOUR_IN_SECONDS );
		return $clean;
	}

	/** @param array $extra Extra payload. @return array */
	private static function client_payload( array $extra = array() ) {
		return array_merge(
			array(
				'site_url'       => home_url(),
				'plugin'         => BAP_PLUGIN_BASENAME,
				'plugin_version' => BAP_VERSION,
				'wordpress'      => get_bloginfo( 'version' ),
				'php'            => PHP_VERSION,
			),
			$extra
		);
	}

	/** @param array $body Response. @param string $error Error. @return void */
	private static function save_server_snapshot( array $body, $error ) {
		$allowed = array( 'active', 'inactive', 'expired', 'suspended', 'invalid', 'site_limit_reached', 'grace_period', 'unknown' );
		$status  = sanitize_key( (string) ( $body['status'] ?? 'unknown' ) );
		$status  = in_array( $status, $allowed, true ) ? $status : 'unknown';
		$now     = gmdate( 'c' );
		$current = self::snapshot();
		$snap    = array(
			'status'                     => $status,
			'plan'                       => sanitize_text_field( (string) ( $body['plan'] ?? $current['plan'] ) ),
			'customer_id'                => sanitize_text_field( (string) ( $body['customer_id'] ?? $current['customer_id'] ) ),
			'site'                       => esc_url_raw( (string) ( $body['site'] ?? home_url() ) ),
			'expires_at'                 => self::iso_or_null( $body['expires_at'] ?? null ),
			'entitlements'               => self::sanitize_entitlements( $body['entitlements'] ?? $current['entitlements'] ),
			'feature_flags'              => self::sanitize_entitlements( $body['feature_flags'] ?? $current['feature_flags'] ),
			'last_successful_validation' => $now,
			'last_attempt'               => $now,
			'last_error'                 => sanitize_text_field( (string) $error ),
			'grace_until'                => gmdate( 'c', time() + self::GRACE_SECONDS ),
		);
		update_option( self::OPTION_SNAPSHOT, $snap, false );
	}

	/** @param string $message Error text. @return array */
	private static function network_failure_snapshot( $message ) {
		$current = self::snapshot();
		$last    = ! empty( $current['last_successful_validation'] ) ? strtotime( (string) $current['last_successful_validation'] ) : false;
		$status  = ( $last && time() - $last <= self::GRACE_SECONDS && in_array( $current['status'], array( 'active', 'grace_period' ), true ) ) ? 'grace_period' : 'unknown';
		$current['status']      = $status;
		$current['last_attempt'] = gmdate( 'c' );
		$current['last_error']   = sanitize_text_field( (string) $message );
		if ( 'grace_period' === $status ) {
			$current['grace_until'] = gmdate( 'c', $last + self::GRACE_SECONDS );
		}
		update_option( self::OPTION_SNAPSHOT, $current, false );
		return $current;
	}

	/** @param string $path API path. @param array $payload Body. @param string $key License key. @return array|WP_Error */
	private static function request( $path, array $payload, $key ) {
		$url = self::api_base() . '/' . ltrim( $path, '/' );
		$args = array(
			'timeout'     => 8,
			'redirection' => 2,
			'headers'     => array(
				'Accept'        => 'application/json',
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . $key,
				'X-Bahoosh-Plugin' => BAP_VERSION,
			),
			'body'        => wp_json_encode( $payload ),
			'data_format' => 'body',
		);
		$response = wp_safe_remote_post( $url, $args );
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'bap_license_network', __( 'ارتباط با سرویس باهوش برقرار نشد.', 'bahoosh-analytics-pro' ) . ' ' . $response->get_error_message() );
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) ) {
			return new WP_Error( 'bap_license_bad_json', __( 'پاسخ سرویس باهوش معتبر نبود.', 'bahoosh-analytics-pro' ) );
		}
		if ( $code < 200 || $code >= 300 ) {
			$message = sanitize_text_field( (string) ( $body['message'] ?? $body['error'] ?? __( 'درخواست لایسنس رد شد.', 'bahoosh-analytics-pro' ) ) );
			return new WP_Error( 'bap_license_http_' . $code, $message, array( 'status' => $code ) );
		}
		return $body;
	}

	/** @param mixed $value Date. @return string|null */
	private static function iso_or_null( $value ) {
		$ts = $value ? strtotime( (string) $value ) : false;
		return $ts ? gmdate( 'c', $ts ) : null;
	}

	/** @param mixed $value Map/list. @return array */
	private static function sanitize_entitlements( $value ) {
		$out = array();
		foreach ( (array) $value as $key => $enabled ) {
			if ( is_int( $key ) ) {
				$out[ sanitize_key( (string) $enabled ) ] = true;
			} else {
				$out[ sanitize_key( (string) $key ) ] = (bool) $enabled;
			}
		}
		return $out;
	}

	/** @param array $body Update response. @return array */
	private static function sanitize_update( array $body ) {
		return array(
			'version'                 => preg_replace( '/[^0-9A-Za-z.\-+]/', '', (string) ( $body['version'] ?? '' ) ),
			'package'                 => esc_url_raw( (string) ( $body['package'] ?? '' ), array( 'https' ) ),
			'changelog'               => wp_kses_post( (string) ( $body['changelog'] ?? '' ) ),
			'requires_php'            => sanitize_text_field( (string) ( $body['requires_php'] ?? '' ) ),
			'requires_wordpress'      => sanitize_text_field( (string) ( $body['requires_wordpress'] ?? '' ) ),
			'tested'                  => sanitize_text_field( (string) ( $body['tested'] ?? '' ) ),
			'minimum_backend_version' => sanitize_text_field( (string) ( $body['minimum_backend_version'] ?? '' ) ),
			'api_contract'            => sanitize_text_field( (string) ( $body['api_contract'] ?? '' ) ),
			'compatible'              => ! array_key_exists( 'compatible', $body ) || (bool) $body['compatible'],
			'compatibility_message'   => sanitize_text_field( (string) ( $body['compatibility_message'] ?? '' ) ),
			'release_channel'         => sanitize_key( (string) ( $body['release_channel'] ?? self::release_channel() ) ),
		);
	}
}
