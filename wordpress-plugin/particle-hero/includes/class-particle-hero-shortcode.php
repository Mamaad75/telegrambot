<?php
/**
 * [particle_hero] — the page-builder-free path.
 *
 * Example:
 *   [particle_hero height="90vh" title="آینده، ذره به ذره" color_core="#ff7a1a"]
 *
 * @package ParticleHero
 */

defined( 'ABSPATH' ) || exit;

class Particle_Hero_Shortcode {

	/** @var Particle_Hero_Shortcode|null */
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_shortcode( 'particle_hero', array( $this, 'render' ) );
	}

	/**
	 * @param array|string $atts
	 * @param string|null  $content Used as the subtitle when no attribute is given.
	 * @return string
	 */
	public function render( $atts, $content = null ) {
		$atts = is_array( $atts ) ? $atts : array();

		if ( $content && empty( $atts['subtitle'] ) ) {
			$atts['subtitle'] = $content;
		}

		Particle_Hero_Assets::instance()->enqueue();

		return Particle_Hero_Renderer::render( $atts );
	}
}
