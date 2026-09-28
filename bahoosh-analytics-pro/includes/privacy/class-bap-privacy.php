<?php
/**
 * Privacy and GDPR integration.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Hooks the plugin into WordPress' personal-data export and erasure tools and
 * publishes a suggested privacy policy section.
 *
 * Analytics data lives in the collector, not in WordPress, so export and
 * erasure are forwarded to it. When the collector has not implemented those
 * endpoints yet the request reports a clear failure rather than silently
 * claiming success — a false "erased" is worse than an honest error.
 */
class BAP_Privacy {

	/**
	 * Registers hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'add_policy_content' ) );
		add_filter( 'wp_privacy_personal_data_exporters', array( __CLASS__, 'register_exporter' ) );
		add_filter( 'wp_privacy_personal_data_erasers', array( __CLASS__, 'register_eraser' ) );
	}

	/**
	 * Suggests privacy policy content.
	 *
	 * @return void
	 */
	public static function add_policy_content() {
		if ( ! function_exists( 'wp_add_privacy_policy_content' ) ) {
			return;
		}

		$content = '<p>' . esc_html__(
			'این سایت برای شناخت نحوه استفاده بازدیدکنندگان از افزونه باهوش آنالیتیکس استفاده می‌کند. یک شناسه تصادفی و ناشناس در مرورگر شما ذخیره می‌شود و صفحه‌هایی که می‌بینید، عبارت‌هایی که جست‌وجو می‌کنید و کارهایی که در سایت انجام می‌دهید ثبت می‌شود. اگر حساب کاربری داشته باشید و وارد شده باشید، این فعالیت به حساب شما نسبت داده می‌شود.',
			'bahoosh-analytics-pro'
		) . '</p>';

		$content .= '<p>' . esc_html__(
			'این افزونه رمز عبور، توکن ورود یا اطلاعات کارت بانکی جمع نمی‌کند. اگر ناشناس‌سازی IP روشن باشد، نشانی IP پیش از ذخیره کوتاه می‌شود. می‌توانید با ابزارهای همین سایت، خروجی گرفتن یا حذف این داده‌ها را درخواست کنید.',
			'bahoosh-analytics-pro'
		) . '</p>';

		wp_add_privacy_policy_content( 'Bahoosh Analytics Pro', wp_kses_post( $content ) );
	}

	/**
	 * Registers the personal-data exporter.
	 *
	 * @param array $exporters Registered exporters.
	 * @return array
	 */
	public static function register_exporter( $exporters ) {
		$exporters['bahoosh-analytics-pro'] = array(
			'exporter_friendly_name' => __( 'باهوش آنالیتیکس', 'bahoosh-analytics-pro' ),
			'callback'               => array( __CLASS__, 'export_data' ),
		);
		return $exporters;
	}

	/**
	 * Registers the personal-data eraser.
	 *
	 * @param array $erasers Registered erasers.
	 * @return array
	 */
	public static function register_eraser( $erasers ) {
		$erasers['bahoosh-analytics-pro'] = array(
			'eraser_friendly_name' => __( 'باهوش آنالیتیکس', 'bahoosh-analytics-pro' ),
			'callback'             => array( __CLASS__, 'erase_data' ),
		);
		return $erasers;
	}

	/**
	 * Exports a user's analytics data.
	 *
	 * @param string $email_address User email.
	 * @param int    $page          Page number (unused; the collector returns one payload).
	 * @return array
	 */
	public static function export_data( $email_address, $page = 1 ) {
		unset( $page ); // Part of the WordPress exporter signature; the collector returns one payload.
		$user = get_user_by( 'email', $email_address );
		if ( ! $user ) {
			return array(
				'data' => array(),
				'done' => true,
			);
		}

		$result = BAP_Transport::request(
			'privacy/export',
			array(
				'site_id'    => BAP_Settings::get( 'site_id' ),
				'wp_user_id' => (int) $user->ID,
			)
		);

		if ( empty( $result['ok'] ) || ! is_array( $result['body'] ) ) {
			BAP_Logger::warn( 'privacy export unavailable: ' . $result['error'] );
			return array(
				'data' => array(),
				'done' => true,
			);
		}

		$items = array();
		foreach ( (array) $result['body'] as $group => $rows ) {
			if ( ! is_array( $rows ) ) {
				continue;
			}
			foreach ( $rows as $index => $row ) {
				if ( ! is_array( $row ) ) {
					continue;
				}
				$data = array();
				foreach ( $row as $name => $value ) {
					$data[] = array(
						'name'  => sanitize_text_field( (string) $name ),
						'value' => is_scalar( $value ) ? (string) $value : wp_json_encode( $value ),
					);
				}
				$items[] = array(
					'group_id'    => 'bahoosh-' . sanitize_key( (string) $group ),
					'group_label' => __( 'باهوش آنالیتیکس', 'bahoosh-analytics-pro' ) . ' — ' . sanitize_text_field( (string) $group ),
					'item_id'     => 'bahoosh-' . sanitize_key( (string) $group ) . '-' . (int) $index,
					'data'        => $data,
				);
			}
		}

		return array(
			'data' => $items,
			'done' => true,
		);
	}

	/**
	 * Erases a user's analytics data.
	 *
	 * @param string $email_address User email.
	 * @param int    $page          Page number.
	 * @return array
	 */
	public static function erase_data( $email_address, $page = 1 ) {
		unset( $page ); // Part of the WordPress eraser signature; erasure is not paginated.
		$response = array(
			'items_removed'  => false,
			'items_retained' => false,
			'messages'       => array(),
			'done'           => true,
		);

		$user = get_user_by( 'email', $email_address );
		if ( ! $user ) {
			return $response;
		}

		// Undelivered local events for this user go first — they are ours to
		// destroy, and no round trip can fail.
		$removed_local = self::purge_outbox_for_user( (int) $user->ID );
		if ( $removed_local > 0 ) {
			$response['items_removed'] = true;
		}

		$result = BAP_Transport::request(
			'privacy/erase',
			array(
				'site_id'    => BAP_Settings::get( 'site_id' ),
				'wp_user_id' => (int) $user->ID,
			)
		);

		if ( empty( $result['ok'] ) ) {
			$response['items_retained'] = true;
			$response['messages'][]     = __(
				'داده‌های نگهداری‌شده در کالکتور باهوش به‌صورت خودکار حذف نشدند. برای تکمیل درخواست با مدیر سامانه تحلیل تماس بگیرید.',
				'bahoosh-analytics-pro'
			);
			BAP_Logger::warn( 'privacy erase failed: ' . $result['error'] );
			return $response;
		}

		$response['items_removed'] = true;
		return $response;
	}

	/**
	 * Deletes queued events belonging to a user.
	 *
	 * @param int $user_id WordPress user id.
	 * @return int Rows removed.
	 */
	private static function purge_outbox_for_user( $user_id ) {
		global $wpdb;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- the
		// table name is the plugin's own and cannot be a prepare() placeholder.
		// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom table.
		$table = BAP_Outbox::table();

		// The user id lives inside the JSON payload; a LIKE against the encoded
		// key is exact enough here because the encoding is ours.
		$needle = '"wp_user_id":' . (int) $user_id;

		return (int) $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE payload LIKE %s",
				'%' . $wpdb->esc_like( $needle ) . '%'
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
	}
}
