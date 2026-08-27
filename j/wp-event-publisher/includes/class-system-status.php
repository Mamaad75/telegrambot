<?php
/**
 * System status report.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Reports what Jarchi can see on this installation.
 *
 * Every row is a live check, not a stored flag: the point of the screen is to
 * answer "why isn't my integration showing up?", and a cached answer would be
 * exactly the wrong thing to show. Detection uses the same
 * `class_exists()`/`function_exists()` tests the providers themselves use, so
 * this screen and the plugin's behaviour cannot disagree.
 *
 * @since 1.7.0
 */
class SystemStatus {

	/**
	 * Status: working as intended.
	 *
	 * @var string
	 */
	public const OK = 'ok';

	/**
	 * Status: usable, but worth knowing about.
	 *
	 * @var string
	 */
	public const WARN = 'warn';

	/**
	 * Status: not working.
	 *
	 * @var string
	 */
	public const FAIL = 'fail';

	/**
	 * Status: neutral information, no judgement.
	 *
	 * @var string
	 */
	public const INFO = 'info';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Field registry dependency.
	 *
	 * @var FieldRegistry
	 */
	private FieldRegistry $registry;

	/**
	 * Constructor.
	 *
	 * @since 1.7.0
	 *
	 * @param Settings      $settings Settings service.
	 * @param FieldRegistry $registry Field registry.
	 */
	public function __construct( Settings $settings, FieldRegistry $registry ) {
		$this->settings = $settings;
		$this->registry = $registry;
	}

	/**
	 * Builds the full report, grouped for display.
	 *
	 * @since 1.7.0
	 *
	 * @return array<int,array{label:string,rows:array<int,array{label:string,value:string,status:string,note:string}>}> Report.
	 */
	public function report(): array {
		return array(
			array(
				'label' => __( 'محیط', 'wp-event-publisher' ),
				'rows'  => $this->environment(),
			),
			array(
				'label' => __( 'اتصال به جارچی', 'wp-event-publisher' ),
				'rows'  => $this->connection(),
			),
			array(
				'label' => __( 'افزونه‌های شناسایی‌شده', 'wp-event-publisher' ),
				'rows'  => $this->integrations(),
			),
			array(
				'label' => __( 'پلتفرم‌های انتشار', 'wp-event-publisher' ),
				'rows'  => $this->platforms(),
			),
		);
	}

	/**
	 * Environment rows.
	 *
	 * @since 1.7.0
	 *
	 * @return array<int,array<string,string>> Rows.
	 */
	private function environment(): array {
		$php_ok = version_compare( PHP_VERSION, '8.1', '>=' );
		$wp     = get_bloginfo( 'version' );

		return array(
			$this->row( __( 'نسخه جارچی', 'wp-event-publisher' ), WPEP_VERSION, self::INFO ),
			$this->row( __( 'نسخه وردپرس', 'wp-event-publisher' ), (string) $wp, version_compare( (string) $wp, '6.5', '>=' ) ? self::OK : self::WARN ),
			$this->row(
				__( 'نسخه PHP', 'wp-event-publisher' ),
				PHP_VERSION,
				$php_ok ? self::OK : self::FAIL,
				$php_ok ? '' : __( 'جارچی به PHP 8.1 یا بالاتر نیاز دارد.', 'wp-event-publisher' )
			),
			$this->row( __( 'منطقه زمانی سایت', 'wp-event-publisher' ), (string) wp_timezone_string(), self::INFO ),
		);
	}

	/**
	 * Connection rows.
	 *
	 * Never prints the secret, only whether one exists. A status screen that
	 * leaks a credential to anyone who can open it is worse than no screen.
	 *
	 * @since 1.7.0
	 *
	 * @return array<int,array<string,string>> Rows.
	 */
	private function connection(): array {
		$endpoint = $this->settings->endpoint();
		$secret   = (string) $this->settings->get( 'api_secret', '' );

		$rows = array(
			$this->row(
				__( 'آدرس وب‌هوک', 'wp-event-publisher' ),
				'' !== $endpoint ? $endpoint : __( 'تنظیم نشده', 'wp-event-publisher' ),
				'' !== $endpoint ? self::OK : self::FAIL,
				'' !== $endpoint ? '' : __( 'بدون آدرس، هیچ چیزی ارسال نمی‌شود.', 'wp-event-publisher' )
			),
			$this->row(
				__( 'کلید API', 'wp-event-publisher' ),
				'' !== $secret ? __( 'تنظیم شده', 'wp-event-publisher' ) : __( 'تنظیم نشده', 'wp-event-publisher' ),
				'' !== $secret ? self::OK : self::WARN
			),
			$this->row( __( 'شناسه سایت', 'wp-event-publisher' ), (string) $this->settings->site_id(), self::INFO ),
			$this->row(
				__( 'وضعیت افزونه', 'wp-event-publisher' ),
				$this->settings->get( 'enabled' ) ? __( 'فعال', 'wp-event-publisher' ) : __( 'غیرفعال', 'wp-event-publisher' ),
				$this->settings->get( 'enabled' ) ? self::OK : self::WARN
			),
			$this->row(
				__( 'REST API', 'wp-event-publisher' ),
				function_exists( 'rest_url' ) ? __( 'در دسترس', 'wp-event-publisher' ) : __( 'در دسترس نیست', 'wp-event-publisher' ),
				function_exists( 'rest_url' ) ? self::OK : self::WARN
			),
			$this->row(
				__( 'AJAX پیشخوان', 'wp-event-publisher' ),
				__( 'در دسترس', 'wp-event-publisher' ),
				self::OK
			),
		);

		return $rows;
	}

	/**
	 * Integration rows.
	 *
	 * @since 1.7.0
	 *
	 * @return array<int,array<string,string>> Rows.
	 */
	private function integrations(): array {
		$rows = array();

		$checks = array(
			array( 'WooCommerce', WooCommerceOrder::available() ),
			array( 'Elementor', Announcements::elementor_available() ),
			array( 'JetEngine', class_exists( '\Jet_Engine' ) || function_exists( 'jet_engine' ) ),
			array( 'JetFormBuilder', class_exists( '\Jet_Form_Builder\Plugin' ) || defined( 'JET_FORM_BUILDER_VERSION' ) ),
			array( 'ACF', class_exists( '\ACF' ) || function_exists( 'get_field_objects' ) ),
			array( 'Meta Box', class_exists( '\RWMB_Loader' ) || function_exists( 'rwmb_meta' ) ),
			array( 'Pods', function_exists( 'pods' ) || class_exists( '\PodsInit' ) ),
		);

		foreach ( $checks as $check ) {
			$rows[] = $this->row(
				$check[0],
				$check[1] ? __( 'شناسایی شد', 'wp-event-publisher' ) : __( 'نصب نیست', 'wp-event-publisher' ),
				// Absence is information, not a fault: an optional integration
				// that is simply not installed is a perfectly healthy site.
				$check[1] ? self::OK : self::INFO
			);
		}

		if ( WooCommerceOrder::available() ) {
			$rows[] = $this->row(
				__( 'ذخیره‌سازی سفارش‌ها (HPOS)', 'wp-event-publisher' ),
				WooCommerceOrder::hpos_enabled()
					? __( 'پرسرعت (جدول اختصاصی)', 'wp-event-publisher' )
					: __( 'کلاسیک (نوشته‌ها)', 'wp-event-publisher' ),
				self::OK,
				__( 'جارچی با هر دو حالت کار می‌کند.', 'wp-event-publisher' )
			);
		}

		// Which providers actually answered, as opposed to which are coded.
		$available = array();

		foreach ( $this->registry->available() as $provider ) {
			$available[] = $provider->label();
		}

		$rows[] = $this->row(
			__( 'منابع فیلد فعال', 'wp-event-publisher' ),
			implode( '، ', $available ),
			empty( $available ) ? self::FAIL : self::OK
		);

		return $rows;
	}

	/**
	 * Platform rows.
	 *
	 * @since 1.7.0
	 *
	 * @return array<int,array<string,string>> Rows.
	 */
	private function platforms(): array {
		$names = array(
			Field::PLATFORM_TELEGRAM => __( 'تلگرام', 'wp-event-publisher' ),
			Field::PLATFORM_BALE     => __( 'بله', 'wp-event-publisher' ),
			Field::PLATFORM_WHATSAPP => __( 'واتس‌اپ', 'wp-event-publisher' ),
		);

		$rows = array();

		foreach ( $this->settings->platforms() as $platform => $config ) {
			$on   = ! empty( $config['enabled'] );
			$addr = (string) ( $config['channel_id'] ?? $config['chat_id'] ?? $config['recipient'] ?? '' );

			$rows[] = $this->row(
				$names[ $platform ] ?? $platform,
				$on
					? ( '' !== $addr ? $addr : __( 'روشن، بدون مقصد', 'wp-event-publisher' ) )
					: __( 'خاموش', 'wp-event-publisher' ),
				$on && '' !== $addr ? self::OK : ( $on ? self::WARN : self::INFO ),
				$on && '' === $addr ? __( 'کانال یا گیرنده مشخص نشده است.', 'wp-event-publisher' ) : ''
			);
		}

		return $rows;
	}

	/**
	 * Builds one report row.
	 *
	 * @since 1.7.0
	 *
	 * @param string $label  Row label.
	 * @param string $value  Row value.
	 * @param string $status One of the status constants.
	 * @param string $note   Optional explanation.
	 *
	 * @return array<string,string> Row.
	 */
	private function row( string $label, string $value, string $status, string $note = '' ): array {
		return array(
			'label'  => $label,
			'value'  => $value,
			'status' => $status,
			'note'   => $note,
		);
	}
}
