<?php
/**
 * Flat, sanitised settings -> the nested JSON config the JS bundle expects.
 *
 * The Elementor widget, the shortcode and the theme helper all funnel through
 * here, so there is exactly one place where user input is validated and exactly
 * one definition of what a valid option is.
 *
 * @package ParticleHero
 */

defined( 'ABSPATH' ) || exit;

class Particle_Hero_Config {

	/**
	 * Every accepted option with its default. Keys are flat and snake_case,
	 * which is what both Elementor controls and shortcode attributes give us.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			// Layout & content.
			'height'              => '100vh',
			'height_mobile'       => '620px',
			'align'               => 'left',
			'show_content'        => 'yes',
			'title'               => '',
			'subtitle'            => '',
			'button_text'         => '',
			'button_url'          => '',
			'button_target'       => '',
			'class'               => '',

			// Character.
			'quality'             => 'auto',
			'particles'           => 0,      // 0 = let the quality tier decide
			'core_particles'      => 0,
			'scale'               => 1.0,
			'camera_distance'     => 7.2,
			'offset_y'            => 0.05,
			'seed'                => 1337,
			'particle_size'       => 1.55,

			// Palette.
			'color_deep'          => '#062a63',
			'color_mid'           => '#2f7dff',
			'color_hot'           => '#9ce7ff',
			'color_core'          => '#ff7a1a',
			'color_core_edge'     => '#ffd08a',
			'bg_top'              => '#050a1c',
			'bg_bottom'           => '#01030a',
			'bg_glow'             => '#0a3a7a',
			'bg_glow_strength'    => 0.85,
			'transparent'         => 'no',

			// Formation.
			'formation_duration'  => 5.2,
			'formation_delay'     => 0.25,
			'stagger'             => 0.55,
			'arc'                 => 1.35,

			// Idle motion.
			'drift'               => 0.085,
			'auto_rotate'         => 0.045,
			'sway'                => 0.055,

			// Pointer.
			'pointer'             => 'yes',
			'pointer_radius'      => 1.5,
			'pointer_push'        => 0.45,
			'pointer_parallax'    => 0.28,

			// Scroll.
			'scroll'              => 'yes',
			'scroll_distance'     => 2.6,
			'scroll_parallax'     => 0.35,

			// Post processing.
			'bloom'               => 'yes',
			'bloom_strength'      => 1.15,
			'exposure'            => 1.18,
			'vignette'            => 0.55,

			// Behaviour.
			'fallback_image'      => '',
			'pause_offscreen'     => 'yes',
			'eager'               => 'yes',
		);
	}

	/**
	 * Clamp helper: keeps a hand-edited shortcode from producing a 4-million
	 * particle hero that locks up a phone.
	 *
	 * @param mixed $value
	 * @param float $min
	 * @param float $max
	 * @param float $fallback
	 * @return float
	 */
	private static function num( $value, $min, $max, $fallback ) {
		if ( ! is_numeric( $value ) ) {
			return (float) $fallback;
		}
		return (float) max( $min, min( $max, (float) $value ) );
	}

	/** @param mixed $value */
	private static function bool( $value ) {
		return in_array( $value, array( 'yes', 'true', '1', 1, true, 'on' ), true );
	}

	/**
	 * @param mixed  $value
	 * @param string $fallback
	 * @return string
	 */
	private static function color( $value, $fallback ) {
		$color = sanitize_hex_color( is_string( $value ) ? trim( $value ) : '' );
		return $color ? $color : $fallback;
	}

	/**
	 * Merge raw input over the defaults, sanitising as we go.
	 *
	 * @param array $args
	 * @return array
	 */
	public static function sanitize( array $args ) {
		$defaults = self::defaults();
		$args     = shortcode_atts( $defaults, $args, 'particle_hero' );
		$out      = $defaults;

		// Text & markup.
		$out['title']         = wp_kses_post( $args['title'] );
		$out['subtitle']      = wp_kses_post( $args['subtitle'] );
		$out['button_text']   = sanitize_text_field( $args['button_text'] );
		$out['button_url']    = esc_url_raw( $args['button_url'] );
		$out['button_target'] = in_array( $args['button_target'], array( '_blank', '_self' ), true ) ? $args['button_target'] : '';
		$out['class']         = sanitize_html_class( $args['class'] ) ? $args['class'] : '';
		$out['align']         = in_array( $args['align'], array( 'left', 'center', 'right' ), true ) ? $args['align'] : 'left';
		$out['height']        = self::css_length( $args['height'], '100vh' );
		$out['height_mobile'] = self::css_length( $args['height_mobile'], '620px' );

		// Character.
		$out['quality']         = in_array( $args['quality'], array( 'auto', 'low', 'medium', 'high' ), true ) ? $args['quality'] : 'auto';
		$out['particles']       = (int) self::num( $args['particles'], 0, 250000, 0 );
		$out['core_particles']  = (int) self::num( $args['core_particles'], 0, 20000, 0 );
		$out['scale']           = self::num( $args['scale'], 0.3, 3, 1 );
		$out['camera_distance'] = self::num( $args['camera_distance'], 3, 20, 7.2 );
		$out['offset_y']        = self::num( $args['offset_y'], -2, 2, 0.05 );
		$out['seed']            = (int) self::num( $args['seed'], 0, 999999, 1337 );
		$out['particle_size']   = self::num( $args['particle_size'], 0.2, 6, 1.55 );

		// Palette.
		foreach ( array( 'color_deep', 'color_mid', 'color_hot', 'color_core', 'color_core_edge', 'bg_top', 'bg_bottom', 'bg_glow' ) as $key ) {
			$out[ $key ] = self::color( $args[ $key ], $defaults[ $key ] );
		}
		$out['bg_glow_strength'] = self::num( $args['bg_glow_strength'], 0, 3, 0.85 );

		// Timings and motion.
		$out['formation_duration'] = self::num( $args['formation_duration'], 0.5, 20, 5.2 );
		$out['formation_delay']    = self::num( $args['formation_delay'], 0, 5, 0.25 );
		$out['stagger']            = self::num( $args['stagger'], 0, 0.9, 0.55 );
		$out['arc']                = self::num( $args['arc'], 0, 6, 1.35 );
		$out['drift']              = self::num( $args['drift'], 0, 0.6, 0.085 );
		$out['auto_rotate']        = self::num( $args['auto_rotate'], -1, 1, 0.045 );
		$out['sway']               = self::num( $args['sway'], 0, 0.5, 0.055 );

		// Interaction.
		$out['pointer_radius']   = self::num( $args['pointer_radius'], 0.1, 8, 1.5 );
		$out['pointer_push']     = self::num( $args['pointer_push'], 0, 3, 0.45 );
		$out['pointer_parallax'] = self::num( $args['pointer_parallax'], 0, 1.5, 0.28 );
		$out['scroll_distance']  = self::num( $args['scroll_distance'], 0, 10, 2.6 );
		$out['scroll_parallax']  = self::num( $args['scroll_parallax'], -3, 3, 0.35 );

		// Post.
		$out['bloom_strength'] = self::num( $args['bloom_strength'], 0, 4, 1.15 );
		$out['exposure']       = self::num( $args['exposure'], 0.2, 3, 1.18 );
		$out['vignette']       = self::num( $args['vignette'], 0, 1.5, 0.55 );

		// Flags.
		foreach ( array( 'show_content', 'transparent', 'pointer', 'scroll', 'bloom', 'pause_offscreen', 'eager' ) as $key ) {
			$out[ $key ] = self::bool( $args[ $key ] ) ? 'yes' : 'no';
		}

		$out['fallback_image'] = esc_url_raw( $args['fallback_image'] );

		return $out;
	}

	/**
	 * Accept only simple CSS lengths, so the value can go straight into a
	 * style attribute.
	 *
	 * @param mixed  $value
	 * @param string $fallback
	 * @return string
	 */
	public static function css_length( $value, $fallback ) {
		$value = is_string( $value ) ? trim( $value ) : '';
		if ( preg_match( '/^\d+(\.\d+)?(px|vh|svh|dvh|rem|em|%)$/', $value ) ) {
			return $value;
		}
		if ( is_numeric( $value ) ) {
			return ( (float) $value ) . 'px';
		}
		return $fallback;
	}

	/**
	 * Build the nested object consumed by `data-particle-hero`.
	 *
	 * @param array $s Sanitised settings.
	 * @return array
	 */
	public static function to_js( array $s ) {
		$config = array(
			'quality'            => $s['quality'],
			'seed'               => $s['seed'],
			'scale'              => $s['scale'],
			'cameraDistance'     => $s['camera_distance'],
			'characterOffsetY'   => $s['offset_y'],
			'transparent'        => 'yes' === $s['transparent'],
			'backgroundGlow'     => $s['bg_glow_strength'],
			'pauseWhenOffscreen' => 'yes' === $s['pause_offscreen'],
			'colors'             => array(
				'deep'     => $s['color_deep'],
				'mid'      => $s['color_mid'],
				'hot'      => $s['color_hot'],
				'core'     => $s['color_core'],
				'coreEdge' => $s['color_core_edge'],
				'bgTop'    => $s['bg_top'],
				'bgBottom' => $s['bg_bottom'],
				'bgGlow'   => $s['bg_glow'],
			),
			'formation'          => array(
				'duration' => $s['formation_duration'],
				'delay'    => $s['formation_delay'],
				'stagger'  => $s['stagger'],
				'arc'      => $s['arc'],
			),
			'motion'             => array(
				'drift'      => $s['drift'],
				'autoRotate' => $s['auto_rotate'],
				'sway'       => $s['sway'],
			),
			'pointer'            => array(
				'enabled'  => 'yes' === $s['pointer'],
				'radius'   => $s['pointer_radius'],
				'push'     => $s['pointer_push'],
				'parallax' => $s['pointer_parallax'],
			),
			'scroll'             => array(
				'enabled'  => 'yes' === $s['scroll'],
				'distance' => $s['scroll_distance'],
				'parallax' => $s['scroll_parallax'],
			),
			'particles'          => array(
				'size' => $s['particle_size'],
			),
			'post'               => array(
				'bloom'         => 'yes' === $s['bloom'],
				'bloomStrength' => $s['bloom_strength'],
				'exposure'      => $s['exposure'],
				'vignette'      => $s['vignette'],
			),
		);

		// 0 means "let the device tier decide" — send null so the JS default wins.
		if ( $s['particles'] > 0 ) {
			$config['particleCount'] = $s['particles'];
		}
		if ( $s['core_particles'] > 0 ) {
			$config['coreParticleCount'] = $s['core_particles'];
		}

		/**
		 * Filter the JS config right before it is printed.
		 *
		 * @param array $config
		 * @param array $s Sanitised flat settings.
		 */
		return apply_filters( 'particle_hero_js_config', $config, $s );
	}
}
