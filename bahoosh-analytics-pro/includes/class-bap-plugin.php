<?php
/**
 * Plugin container.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Boots the plugin's modules.
 *
 * Each subsystem owns its own hooks; this class only decides what runs and in
 * which context.
 */
class BAP_Plugin {

	/**
	 * Singleton instance.
	 *
	 * @var BAP_Plugin|null
	 */
	private static $instance = null;

	/**
	 * Whether boot() already ran.
	 *
	 * @var bool
	 */
	private $booted = false;

	/**
	 * Returns the container.
	 *
	 * @return BAP_Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Registers all modules.
	 *
	 * @return void
	 */
	public function boot() {
		if ( $this->booted ) {
			return;
		}
		$this->booted = true;

		add_action( 'plugins_loaded', array( $this, 'on_plugins_loaded' ) );
	}

	/**
	 * Runs once WordPress and other plugins are available.
	 *
	 * WooCommerce detection needs `plugins_loaded`, which is why registration
	 * is deferred rather than done at file load.
	 *
	 * @return void
	 */
	public function on_plugins_loaded() {
		// WordPress 6.7 warns when a text domain is loaded before `init`,
		// because translations are not reliably available until then.
		add_action( 'init', array( $this, 'load_textdomain' ), 0 );

		BAP_Installer::maybe_upgrade();

		BAP_Outbox::init();
		BAP_REST_Controller::init();
		BAP_Privacy::init();

		// Registered unconditionally: `wp_enqueue_scripts` only fires on the
		// front end anyway, while `wp_login` fires on wp-login.php and
		// `user_register` can fire in wp-admin.
		BAP_WordPress::init();

		// Order hooks fire in every context (admin edits, cron, gateway
		// callbacks), so the WooCommerce integration is always registered.
		BAP_WooCommerce::init();

		if ( is_admin() ) {
			BAP_Admin::init();
		}

		/**
		 * Fires once the plugin has registered its modules.
		 *
		 * @param BAP_Plugin $plugin Plugin container.
		 */
		do_action( 'bap_loaded', $this );
	}

	/**
	 * Loads translations.
	 *
	 * @return void
	 */
	public function load_textdomain() {
		load_plugin_textdomain(
			'bahoosh-analytics-pro',
			false,
			dirname( BAP_PLUGIN_BASENAME ) . '/languages'
		);
	}
}
