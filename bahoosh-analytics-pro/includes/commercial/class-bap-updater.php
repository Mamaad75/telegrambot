<?php
/** Native WordPress update integration for commercial releases. @package Bahoosh_Analytics_Pro */

defined( 'ABSPATH' ) || exit;

class BAP_Updater {

	/** @var string Last compatibility reason for UI/notices. */
	private static $blocked_reason = '';

	/** @return void */
	public static function init() {
		add_filter( 'pre_set_site_transient_update_plugins', array( __CLASS__, 'inject_update' ) );
		add_filter( 'plugins_api', array( __CLASS__, 'plugin_information' ), 20, 3 );
		add_filter( 'auto_update_plugin', array( __CLASS__, 'allow_auto_update' ), 10, 2 );
		add_filter( 'upgrader_pre_download', array( __CLASS__, 'refresh_package_before_download' ), 10, 4 );
		add_action( 'admin_notices', array( __CLASS__, 'compatibility_notice' ) );
	}

	/** @param object $transient Update transient. @return object */
	public static function inject_update( $transient ) {
		if ( ! is_object( $transient ) || empty( $transient->checked[ BAP_PLUGIN_BASENAME ] ) ) {
			return $transient;
		}
		$info = BAP_License_Manager::update_info();
		if ( is_wp_error( $info ) || empty( $info['version'] ) || version_compare( $info['version'], BAP_VERSION, '<=' ) ) {
			return $transient;
		}
		$compat = self::compatible( $info );
		if ( is_wp_error( $compat ) ) {
			self::$blocked_reason = $compat->get_error_message();
			return $transient;
		}
		if ( empty( $info['package'] ) ) {
			return $transient;
		}
		$item = (object) array(
			'slug'        => 'bahoosh-analytics-pro',
			'plugin'      => BAP_PLUGIN_BASENAME,
			'new_version' => $info['version'],
			'package'     => $info['package'],
			'url'         => 'https://bahoosh.ai/',
			'requires_php'=> $info['requires_php'],
			'tested'      => $info['tested'],
		);
		$transient->response[ BAP_PLUGIN_BASENAME ] = $item;
		return $transient;
	}

	/** @param false|object|array $result Existing result. @param string $action Action. @param object $args Args. @return mixed */
	public static function plugin_information( $result, $action, $args ) {
		if ( 'plugin_information' !== $action || empty( $args->slug ) || 'bahoosh-analytics-pro' !== $args->slug ) {
			return $result;
		}
		$info = BAP_License_Manager::update_info();
		if ( is_wp_error( $info ) ) {
			return $result;
		}
		return (object) array(
			'name'          => 'Bahoosh Analytics Pro',
			'slug'          => 'bahoosh-analytics-pro',
			'version'       => $info['version'],
			'author'        => '<a href="https://bahoosh.ai/">Bahoosh</a>',
			'requires'      => $info['requires_wordpress'],
			'requires_php'  => $info['requires_php'],
			'tested'        => $info['tested'],
			'download_link' => $info['package'],
			'sections'      => array( 'changelog' => $info['changelog'] ),
		);
	}


	/**
	 * Refreshes the signed package URL immediately before WordPress downloads it.
	 * Update-check responses may be cached for hours while premium package URLs
	 * should remain short-lived. Returning a temporary file keeps installation in
	 * WordPress' native upgrader while avoiding stale download credentials.
	 *
	 * @param mixed  $reply      Existing pre-download result.
	 * @param string $package    Package URL currently stored in the update transient.
	 * @param object $upgrader   Core upgrader instance.
	 * @param array  $hook_extra Upgrade context.
	 * @return mixed
	 */
	public static function refresh_package_before_download( $reply, $package, $upgrader, $hook_extra ) {
		if ( false !== $reply ) {
			return $reply;
		}
		$plugin_match = isset( $hook_extra['plugin'] ) && BAP_PLUGIN_BASENAME === $hook_extra['plugin'];
		if ( ! $plugin_match && ! empty( $hook_extra['plugins'] ) && is_array( $hook_extra['plugins'] ) ) {
			$plugin_match = in_array( BAP_PLUGIN_BASENAME, $hook_extra['plugins'], true );
		}
		if ( ! $plugin_match ) {
			return $reply;
		}

		$info = BAP_License_Manager::update_info( true );
		if ( is_wp_error( $info ) ) {
			return $info;
		}
		$compat = self::compatible( $info );
		if ( is_wp_error( $compat ) ) {
			return $compat;
		}
		$fresh_package = isset( $info['package'] ) ? (string) $info['package'] : '';
		if ( '' === $fresh_package || 0 !== strpos( $fresh_package, 'https://' ) ) {
			return new WP_Error( 'bap_update_package_missing', __( 'لینک امن بسته به‌روزرسانی دریافت نشد.', 'bahoosh-analytics-pro' ) );
		}

		if ( ! function_exists( 'download_url' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		return download_url( $fresh_package, 300 );
	}

	/** Optional automatic updates, only when explicitly enabled by filter. */
	public static function allow_auto_update( $update, $item ) {
		if ( is_object( $item ) && isset( $item->plugin ) && BAP_PLUGIN_BASENAME === $item->plugin ) {
			return (bool) apply_filters( 'bap_auto_updates_enabled', $update );
		}
		return $update;
	}

	/** @param array $info Update metadata. @return true|WP_Error */
	public static function compatible( array $info ) {
		if ( empty( $info['compatible'] ) ) {
			return new WP_Error( 'bap_update_backend_incompatible', $info['compatibility_message'] ?: __( 'این نسخه با backend متصل سازگار اعلام نشده است.', 'bahoosh-analytics-pro' ) );
		}
		if ( $info['requires_php'] && version_compare( PHP_VERSION, $info['requires_php'], '<' ) ) {
			return new WP_Error( 'bap_update_php', sprintf( /* translators: %s PHP version */ __( 'این نسخه به PHP %s یا جدیدتر نیاز دارد.', 'bahoosh-analytics-pro' ), $info['requires_php'] ) );
		}
		$wp = get_bloginfo( 'version' );
		if ( $info['requires_wordpress'] && version_compare( $wp, $info['requires_wordpress'], '<' ) ) {
			return new WP_Error( 'bap_update_wp', sprintf( /* translators: %s WP version */ __( 'این نسخه به WordPress %s یا جدیدتر نیاز دارد.', 'bahoosh-analytics-pro' ), $info['requires_wordpress'] ) );
		}
		if ( $info['api_contract'] && defined( 'BAP_API_CONTRACT' ) && BAP_API_CONTRACT !== $info['api_contract'] ) {
			return new WP_Error( 'bap_update_contract', __( 'قرارداد API این نسخه با backend فعلی هم‌خوان نیست.', 'bahoosh-analytics-pro' ) );
		}
		return true;
	}

	/** @return void */
	public static function compatibility_notice() {
		if ( '' === self::$blocked_reason || ! current_user_can( 'update_plugins' ) ) {
			return;
		}
		echo '<div class="notice notice-warning is-dismissible"><p><strong>Bahoosh:</strong> ' . esc_html( self::$blocked_reason ) . '</p></div>';
	}
}
