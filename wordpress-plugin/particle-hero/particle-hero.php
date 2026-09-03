<?php
/**
 * Plugin Name:       Particle Hero — WebGL Cubic Character
 * Plugin URI:        https://github.com/Mamaad75/telegrambot
 * Description:       A premium interactive hero: a futuristic cubic character built entirely from luminous particles, with a 4–6s assembly on load, an orange chest core, natural cursor response and a scroll-driven dissolve. Ships an Elementor widget and a shortcode.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Particle Hero
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       particle-hero
 * Domain Path:       /languages
 *
 * @package ParticleHero
 */

defined( 'ABSPATH' ) || exit;

define( 'PARTICLE_HERO_VERSION', '1.0.0' );
define( 'PARTICLE_HERO_FILE', __FILE__ );
define( 'PARTICLE_HERO_PATH', plugin_dir_path( __FILE__ ) );
define( 'PARTICLE_HERO_URL', plugin_dir_url( __FILE__ ) );

/** Minimum Elementor version that has the widget registration API we use. */
define( 'PARTICLE_HERO_MIN_ELEMENTOR', '3.5.0' );

require_once PARTICLE_HERO_PATH . 'includes/class-particle-hero-config.php';
require_once PARTICLE_HERO_PATH . 'includes/class-particle-hero-renderer.php';
require_once PARTICLE_HERO_PATH . 'includes/class-particle-hero-assets.php';
require_once PARTICLE_HERO_PATH . 'includes/class-particle-hero-shortcode.php';

/**
 * Plugin bootstrap.
 *
 * Elementor is optional: without it the shortcode and the `render()` helper
 * still work, so the animation is never coupled to a page builder.
 */
final class Particle_Hero_Plugin {

	/** @var Particle_Hero_Plugin|null */
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'init', array( $this, 'load_textdomain' ) );

		Particle_Hero_Assets::instance();
		Particle_Hero_Shortcode::instance();

		add_action( 'plugins_loaded', array( $this, 'maybe_boot_elementor' ) );
	}

	public function load_textdomain() {
		load_plugin_textdomain( 'particle-hero', false, dirname( plugin_basename( PARTICLE_HERO_FILE ) ) . '/languages' );
	}

	/**
	 * Register the Elementor widget, but only when a compatible Elementor is
	 * actually active. A missing page builder must never fatal the site.
	 */
	public function maybe_boot_elementor() {
		if ( ! did_action( 'elementor/loaded' ) ) {
			return;
		}

		if ( ! version_compare( ELEMENTOR_VERSION, PARTICLE_HERO_MIN_ELEMENTOR, '>=' ) ) {
			add_action( 'admin_notices', array( $this, 'notice_elementor_version' ) );
			return;
		}

		add_action( 'elementor/widgets/register', array( $this, 'register_widget' ) );
		add_action( 'elementor/elements/categories_registered', array( $this, 'register_category' ) );
	}

	/**
	 * @param \Elementor\Widgets_Manager $widgets_manager
	 */
	public function register_widget( $widgets_manager ) {
		require_once PARTICLE_HERO_PATH . 'includes/class-particle-hero-elementor-widget.php';
		$widgets_manager->register( new Particle_Hero_Elementor_Widget() );
	}

	/**
	 * @param \Elementor\Elements_Manager $elements_manager
	 */
	public function register_category( $elements_manager ) {
		$elements_manager->add_category(
			'particle-hero',
			array(
				'title' => __( 'Particle Hero', 'particle-hero' ),
				'icon'  => 'eicon-particles-comp',
			)
		);
	}

	public function notice_elementor_version() {
		printf(
			'<div class="notice notice-warning"><p>%s</p></div>',
			esc_html(
				sprintf(
					/* translators: %s: minimum Elementor version */
					__( 'Particle Hero needs Elementor %s or newer for its widget. The [particle_hero] shortcode keeps working in the meantime.', 'particle-hero' ),
					PARTICLE_HERO_MIN_ELEMENTOR
				)
			)
		);
	}
}

Particle_Hero_Plugin::instance();

/**
 * Render the hero from a theme template.
 *
 * @param array $args See Particle_Hero_Config::defaults().
 * @param bool  $echo Print instead of returning.
 * @return string
 */
function particle_hero_render( array $args = array(), $echo = true ) {
	Particle_Hero_Assets::instance()->enqueue();
	$html = Particle_Hero_Renderer::render( $args );

	if ( $echo ) {
		// Markup is escaped inside the renderer.
		echo $html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}
	return $html;
}
