<?php
/**
 * Asset registration.
 *
 * The bundle is registered on every request but enqueued only when a hero is
 * actually rendered, so pages without one pay nothing. `defer` keeps the ~138KB
 * gzipped bundle off the critical path — the hero fades in when it is ready.
 *
 * @package ParticleHero
 */

defined( 'ABSPATH' ) || exit;

class Particle_Hero_Assets {

	const HANDLE = 'particle-hero';

	/** @var Particle_Hero_Assets|null */
	private static $instance = null;

	/** @var bool */
	private $enqueued = false;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'wp_enqueue_scripts', array( $this, 'register' ) );
		add_action( 'elementor/frontend/after_register_scripts', array( $this, 'register' ) );
		add_action( 'elementor/editor/after_enqueue_scripts', array( $this, 'register' ) );
		add_filter( 'script_loader_tag', array( $this, 'add_defer' ), 10, 2 );
	}

	public function register() {
		if ( wp_script_is( self::HANDLE, 'registered' ) ) {
			return;
		}

		wp_register_style(
			self::HANDLE,
			PARTICLE_HERO_URL . 'assets/css/particle-hero.css',
			array(),
			PARTICLE_HERO_VERSION
		);

		wp_register_script(
			self::HANDLE,
			PARTICLE_HERO_URL . 'assets/js/particle-hero.min.js',
			array(),
			PARTICLE_HERO_VERSION,
			true
		);
	}

	/** Enqueue on demand, from whichever renderer needs it. */
	public function enqueue() {
		$this->register();
		wp_enqueue_style( self::HANDLE );
		wp_enqueue_script( self::HANDLE );
		$this->enqueued = true;
	}

	/**
	 * @param string $tag
	 * @param string $handle
	 * @return string
	 */
	public function add_defer( $tag, $handle ) {
		if ( self::HANDLE !== $handle || false !== strpos( $tag, ' defer' ) ) {
			return $tag;
		}
		return str_replace( ' src=', ' defer src=', $tag );
	}
}
