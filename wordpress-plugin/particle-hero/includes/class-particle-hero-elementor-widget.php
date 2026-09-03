<?php
/**
 * Elementor widget.
 *
 * Controls are grouped the way an art director works, not the way the config
 * object is shaped: Content, Character, Palette, Formation, Motion, Effects,
 * Performance. Everything maps back through Particle_Hero_Config so the widget
 * cannot produce a config the shortcode could not.
 *
 * @package ParticleHero
 */

defined( 'ABSPATH' ) || exit;

use Elementor\Controls_Manager;
use Elementor\Group_Control_Typography;
use Elementor\Widget_Base;

class Particle_Hero_Elementor_Widget extends Widget_Base {

	public function get_name() {
		return 'particle_hero';
	}

	public function get_title() {
		return __( 'Particle Hero', 'particle-hero' );
	}

	public function get_icon() {
		return 'eicon-particles-comp';
	}

	public function get_categories() {
		return array( 'particle-hero', 'general' );
	}

	public function get_keywords() {
		return array( 'hero', 'particles', '3d', 'webgl', 'animation', 'character', 'ذرات', 'هیرو' );
	}

	public function get_script_depends() {
		return array( Particle_Hero_Assets::HANDLE );
	}

	public function get_style_depends() {
		return array( Particle_Hero_Assets::HANDLE );
	}

	/** Elementor 3.x asks widgets to declare that they render dynamically. */
	public function get_custom_help_url() {
		return 'https://github.com/Mamaad75/telegrambot';
	}

	protected function register_controls() {
		$this->register_content_controls();
		$this->register_character_controls();
		$this->register_palette_controls();
		$this->register_formation_controls();
		$this->register_motion_controls();
		$this->register_effects_controls();
		$this->register_performance_controls();
		$this->register_style_controls();
	}

	// -------------------------------------------------------------------------
	// Content
	// -------------------------------------------------------------------------

	private function register_content_controls() {
		$this->start_controls_section(
			'section_content',
			array(
				'label' => __( 'Content', 'particle-hero' ),
				'tab'   => Controls_Manager::TAB_CONTENT,
			)
		);

		$this->add_control(
			'show_content',
			array(
				'label'        => __( 'Show overlay text', 'particle-hero' ),
				'description'  => __( 'The copy fades in only after the character has finished assembling.', 'particle-hero' ),
				'type'         => Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'return_value' => 'yes',
			)
		);

		$this->add_control(
			'title',
			array(
				'label'     => __( 'Title', 'particle-hero' ),
				'type'      => Controls_Manager::TEXTAREA,
				'rows'      => 2,
				'default'   => __( 'The future, particle by particle', 'particle-hero' ),
				'condition' => array( 'show_content' => 'yes' ),
			)
		);

		$this->add_control(
			'subtitle',
			array(
				'label'     => __( 'Subtitle', 'particle-hero' ),
				'type'      => Controls_Manager::TEXTAREA,
				'rows'      => 3,
				'condition' => array( 'show_content' => 'yes' ),
			)
		);

		$this->add_control(
			'button_text',
			array(
				'label'     => __( 'Button text', 'particle-hero' ),
				'type'      => Controls_Manager::TEXT,
				'condition' => array( 'show_content' => 'yes' ),
			)
		);

		$this->add_control(
			'button_url',
			array(
				'label'       => __( 'Button link', 'particle-hero' ),
				'type'        => Controls_Manager::URL,
				'placeholder' => 'https://',
				'condition'   => array( 'show_content' => 'yes' ),
			)
		);

		$this->add_control(
			'align',
			array(
				'label'   => __( 'Content alignment', 'particle-hero' ),
				'type'    => Controls_Manager::CHOOSE,
				'default' => 'left',
				'options' => array(
					'left'   => array( 'title' => __( 'Left', 'particle-hero' ), 'icon' => 'eicon-text-align-left' ),
					'center' => array( 'title' => __( 'Center', 'particle-hero' ), 'icon' => 'eicon-text-align-center' ),
					'right'  => array( 'title' => __( 'Right', 'particle-hero' ), 'icon' => 'eicon-text-align-right' ),
				),
				'condition' => array( 'show_content' => 'yes' ),
			)
		);

		$this->add_responsive_control(
			'height',
			array(
				'label'      => __( 'Hero height', 'particle-hero' ),
				'type'       => Controls_Manager::SLIDER,
				'size_units' => array( 'px', 'vh', '%' ),
				'range'      => array(
					'px' => array( 'min' => 240, 'max' => 1400 ),
					'vh' => array( 'min' => 30, 'max' => 100 ),
				),
				'default'         => array( 'unit' => 'vh', 'size' => 100 ),
				'tablet_default'  => array( 'unit' => 'vh', 'size' => 80 ),
				'mobile_default'  => array( 'unit' => 'px', 'size' => 620 ),
			)
		);

		$this->end_controls_section();
	}

	// -------------------------------------------------------------------------
	// Character
	// -------------------------------------------------------------------------

	private function register_character_controls() {
		$this->start_controls_section(
			'section_character',
			array(
				'label' => __( 'Character', 'particle-hero' ),
				'tab'   => Controls_Manager::TAB_CONTENT,
			)
		);

		$this->add_control(
			'scale',
			array(
				'label'   => __( 'Character size', 'particle-hero' ),
				'type'    => Controls_Manager::SLIDER,
				'range'   => array( 'px' => array( 'min' => 0.4, 'max' => 2, 'step' => 0.01 ) ),
				'default' => array( 'size' => 1 ),
			)
		);

		$this->add_control(
			'camera_distance',
			array(
				'label'       => __( 'Camera distance', 'particle-hero' ),
				'description' => __( 'Larger values frame the character smaller and show more of the dust cloud.', 'particle-hero' ),
				'type'        => Controls_Manager::SLIDER,
				'range'       => array( 'px' => array( 'min' => 4, 'max' => 14, 'step' => 0.1 ) ),
				'default'     => array( 'size' => 7.2 ),
			)
		);

		$this->add_control(
			'offset_y',
			array(
				'label'   => __( 'Vertical offset', 'particle-hero' ),
				'type'    => Controls_Manager::SLIDER,
				'range'   => array( 'px' => array( 'min' => -1.5, 'max' => 1.5, 'step' => 0.01 ) ),
				'default' => array( 'size' => 0.05 ),
			)
		);

		$this->add_control(
			'particle_size',
			array(
				'label'   => __( 'Particle size', 'particle-hero' ),
				'type'    => Controls_Manager::SLIDER,
				'range'   => array( 'px' => array( 'min' => 0.4, 'max' => 4, 'step' => 0.05 ) ),
				'default' => array( 'size' => 1.55 ),
			)
		);

		$this->add_control(
			'seed',
			array(
				'label'       => __( 'Random seed', 'particle-hero' ),
				'description' => __( 'Same seed, same particle layout — change it for a different grain.', 'particle-hero' ),
				'type'        => Controls_Manager::NUMBER,
				'min'         => 0,
				'max'         => 999999,
				'default'     => 1337,
			)
		);

		$this->end_controls_section();
	}

	// -------------------------------------------------------------------------
	// Palette
	// -------------------------------------------------------------------------

	private function register_palette_controls() {
		$this->start_controls_section(
			'section_palette',
			array(
				'label' => __( 'Palette', 'particle-hero' ),
				'tab'   => Controls_Manager::TAB_STYLE,
			)
		);

		$colors = array(
			'color_deep'      => array( __( 'Body — shadow', 'particle-hero' ), '#062a63' ),
			'color_mid'       => array( __( 'Body — main blue', 'particle-hero' ), '#2f7dff' ),
			'color_hot'       => array( __( 'Edge highlight', 'particle-hero' ), '#9ce7ff' ),
			'color_core'      => array( __( 'Energy core', 'particle-hero' ), '#ff7a1a' ),
			'color_core_edge' => array( __( 'Core outer shell', 'particle-hero' ), '#ffd08a' ),
		);

		foreach ( $colors as $key => $meta ) {
			$this->add_control(
				$key,
				array(
					'label'   => $meta[0],
					'type'    => Controls_Manager::COLOR,
					'default' => $meta[1],
				)
			);
		}

		$this->add_control(
			'transparent',
			array(
				'label'        => __( 'Transparent background', 'particle-hero' ),
				'description'  => __( 'Let the Elementor section background show through instead of drawing the built-in gradient.', 'particle-hero' ),
				'type'         => Controls_Manager::SWITCHER,
				'default'      => '',
				'return_value' => 'yes',
				'separator'    => 'before',
			)
		);

		$backgrounds = array(
			'bg_top'    => array( __( 'Background — top', 'particle-hero' ), '#050a1c' ),
			'bg_bottom' => array( __( 'Background — bottom', 'particle-hero' ), '#01030a' ),
			'bg_glow'   => array( __( 'Background glow', 'particle-hero' ), '#0a3a7a' ),
		);

		foreach ( $backgrounds as $key => $meta ) {
			$this->add_control(
				$key,
				array(
					'label'     => $meta[0],
					'type'      => Controls_Manager::COLOR,
					'default'   => $meta[1],
					'condition' => array( 'transparent!' => 'yes' ),
				)
			);
		}

		$this->add_control(
			'bg_glow_strength',
			array(
				'label'     => __( 'Glow strength', 'particle-hero' ),
				'type'      => Controls_Manager::SLIDER,
				'range'     => array( 'px' => array( 'min' => 0, 'max' => 2, 'step' => 0.05 ) ),
				'default'   => array( 'size' => 0.85 ),
				'condition' => array( 'transparent!' => 'yes' ),
			)
		);

		$this->end_controls_section();
	}

	// -------------------------------------------------------------------------
	// Formation
	// -------------------------------------------------------------------------

	private function register_formation_controls() {
		$this->start_controls_section(
			'section_formation',
			array(
				'label' => __( 'Formation', 'particle-hero' ),
				'tab'   => Controls_Manager::TAB_CONTENT,
			)
		);

		$this->add_control(
			'formation_duration',
			array(
				'label'       => __( 'Assembly duration (s)', 'particle-hero' ),
				'description' => __( '4–6 seconds keeps the reveal impressive without making visitors wait.', 'particle-hero' ),
				'type'        => Controls_Manager::SLIDER,
				'range'       => array( 'px' => array( 'min' => 1, 'max' => 12, 'step' => 0.1 ) ),
				'default'     => array( 'size' => 5.2 ),
			)
		);

		$this->add_control(
			'formation_delay',
			array(
				'label'   => __( 'Start delay (s)', 'particle-hero' ),
				'type'    => Controls_Manager::SLIDER,
				'range'   => array( 'px' => array( 'min' => 0, 'max' => 3, 'step' => 0.05 ) ),
				'default' => array( 'size' => 0.25 ),
			)
		);

		$this->add_control(
			'stagger',
			array(
				'label'       => __( 'Stagger', 'particle-hero' ),
				'description' => __( 'How much the particles trail each other on the way in.', 'particle-hero' ),
				'type'        => Controls_Manager::SLIDER,
				'range'       => array( 'px' => array( 'min' => 0, 'max' => 0.9, 'step' => 0.01 ) ),
				'default'     => array( 'size' => 0.55 ),
			)
		);

		$this->add_control(
			'arc',
			array(
				'label'       => __( 'Path curvature', 'particle-hero' ),
				'description' => __( 'How far particles swing off a straight line while travelling.', 'particle-hero' ),
				'type'        => Controls_Manager::SLIDER,
				'range'       => array( 'px' => array( 'min' => 0, 'max' => 4, 'step' => 0.05 ) ),
				'default'     => array( 'size' => 1.35 ),
			)
		);

		$this->end_controls_section();
	}

	// -------------------------------------------------------------------------
	// Motion & interaction
	// -------------------------------------------------------------------------

	private function register_motion_controls() {
		$this->start_controls_section(
			'section_motion',
			array(
				'label' => __( 'Motion & interaction', 'particle-hero' ),
				'tab'   => Controls_Manager::TAB_CONTENT,
			)
		);

		$this->add_control(
			'drift',
			array(
				'label'       => __( 'Surface drift', 'particle-hero' ),
				'description' => __( 'Curl-noise wobble that keeps the assembled body alive.', 'particle-hero' ),
				'type'        => Controls_Manager::SLIDER,
				'range'       => array( 'px' => array( 'min' => 0, 'max' => 0.4, 'step' => 0.005 ) ),
				'default'     => array( 'size' => 0.085 ),
			)
		);

		$this->add_control(
			'auto_rotate',
			array(
				'label'   => __( 'Turntable speed', 'particle-hero' ),
				'type'    => Controls_Manager::SLIDER,
				'range'   => array( 'px' => array( 'min' => -0.4, 'max' => 0.4, 'step' => 0.005 ) ),
				'default' => array( 'size' => 0.045 ),
			)
		);

		$this->add_control(
			'sway',
			array(
				'label'   => __( 'Idle sway', 'particle-hero' ),
				'type'    => Controls_Manager::SLIDER,
				'range'   => array( 'px' => array( 'min' => 0, 'max' => 0.3, 'step' => 0.005 ) ),
				'default' => array( 'size' => 0.055 ),
			)
		);

		$this->add_control(
			'pointer',
			array(
				'label'        => __( 'React to cursor', 'particle-hero' ),
				'type'         => Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'return_value' => 'yes',
				'separator'    => 'before',
			)
		);

		$this->add_control(
			'pointer_parallax',
			array(
				'label'     => __( 'Lean toward cursor', 'particle-hero' ),
				'type'      => Controls_Manager::SLIDER,
				'range'     => array( 'px' => array( 'min' => 0, 'max' => 1, 'step' => 0.01 ) ),
				'default'   => array( 'size' => 0.28 ),
				'condition' => array( 'pointer' => 'yes' ),
			)
		);

		$this->add_control(
			'pointer_push',
			array(
				'label'     => __( 'Cursor push', 'particle-hero' ),
				'type'      => Controls_Manager::SLIDER,
				'range'     => array( 'px' => array( 'min' => 0, 'max' => 2, 'step' => 0.01 ) ),
				'default'   => array( 'size' => 0.45 ),
				'condition' => array( 'pointer' => 'yes' ),
			)
		);

		$this->add_control(
			'pointer_radius',
			array(
				'label'     => __( 'Cursor radius', 'particle-hero' ),
				'type'      => Controls_Manager::SLIDER,
				'range'     => array( 'px' => array( 'min' => 0.2, 'max' => 5, 'step' => 0.05 ) ),
				'default'   => array( 'size' => 1.5 ),
				'condition' => array( 'pointer' => 'yes' ),
			)
		);

		$this->add_control(
			'scroll',
			array(
				'label'        => __( 'Dissolve on scroll', 'particle-hero' ),
				'description'  => __( 'The character scatters as the hero leaves the viewport and rebuilds on the way back.', 'particle-hero' ),
				'type'         => Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'return_value' => 'yes',
				'separator'    => 'before',
			)
		);

		$this->add_control(
			'scroll_distance',
			array(
				'label'     => __( 'Dissolve distance', 'particle-hero' ),
				'type'      => Controls_Manager::SLIDER,
				'range'     => array( 'px' => array( 'min' => 0, 'max' => 6, 'step' => 0.1 ) ),
				'default'   => array( 'size' => 2.6 ),
				'condition' => array( 'scroll' => 'yes' ),
			)
		);

		$this->add_control(
			'scroll_parallax',
			array(
				'label'     => __( 'Scroll parallax', 'particle-hero' ),
				'type'      => Controls_Manager::SLIDER,
				'range'     => array( 'px' => array( 'min' => -1.5, 'max' => 1.5, 'step' => 0.05 ) ),
				'default'   => array( 'size' => 0.35 ),
				'condition' => array( 'scroll' => 'yes' ),
			)
		);

		$this->end_controls_section();
	}

	// -------------------------------------------------------------------------
	// Effects
	// -------------------------------------------------------------------------

	private function register_effects_controls() {
		$this->start_controls_section(
			'section_effects',
			array(
				'label' => __( 'Effects', 'particle-hero' ),
				'tab'   => Controls_Manager::TAB_STYLE,
			)
		);

		$this->add_control(
			'bloom',
			array(
				'label'        => __( 'Bloom', 'particle-hero' ),
				'type'         => Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'return_value' => 'yes',
			)
		);

		$this->add_control(
			'bloom_strength',
			array(
				'label'     => __( 'Bloom strength', 'particle-hero' ),
				'type'      => Controls_Manager::SLIDER,
				'range'     => array( 'px' => array( 'min' => 0, 'max' => 3, 'step' => 0.05 ) ),
				'default'   => array( 'size' => 1.15 ),
				'condition' => array( 'bloom' => 'yes' ),
			)
		);

		$this->add_control(
			'exposure',
			array(
				'label'   => __( 'Exposure', 'particle-hero' ),
				'type'    => Controls_Manager::SLIDER,
				'range'   => array( 'px' => array( 'min' => 0.4, 'max' => 2.5, 'step' => 0.01 ) ),
				'default' => array( 'size' => 1.18 ),
			)
		);

		$this->add_control(
			'vignette',
			array(
				'label'   => __( 'Vignette', 'particle-hero' ),
				'type'    => Controls_Manager::SLIDER,
				'range'   => array( 'px' => array( 'min' => 0, 'max' => 1.2, 'step' => 0.01 ) ),
				'default' => array( 'size' => 0.55 ),
			)
		);

		$this->end_controls_section();
	}

	// -------------------------------------------------------------------------
	// Performance
	// -------------------------------------------------------------------------

	private function register_performance_controls() {
		$this->start_controls_section(
			'section_performance',
			array(
				'label' => __( 'Performance', 'particle-hero' ),
				'tab'   => Controls_Manager::TAB_ADVANCED,
			)
		);

		$this->add_control(
			'quality',
			array(
				'label'       => __( 'Quality preset', 'particle-hero' ),
				'description' => __( 'Auto reads CPU cores, memory and screen size, then keeps adapting if frames drop.', 'particle-hero' ),
				'type'        => Controls_Manager::SELECT,
				'default'     => 'auto',
				'options'     => array(
					'auto'   => __( 'Auto (recommended)', 'particle-hero' ),
					'low'    => __( 'Low — 22k particles', 'particle-hero' ),
					'medium' => __( 'Medium — 52k particles', 'particle-hero' ),
					'high'   => __( 'High — 96k particles', 'particle-hero' ),
				),
			)
		);

		$this->add_control(
			'particles',
			array(
				'label'       => __( 'Particle count override', 'particle-hero' ),
				'description' => __( 'Leave at 0 to follow the quality preset.', 'particle-hero' ),
				'type'        => Controls_Manager::NUMBER,
				'min'         => 0,
				'max'         => 250000,
				'step'        => 1000,
				'default'     => 0,
			)
		);

		$this->add_control(
			'eager',
			array(
				'label'        => __( 'Start immediately', 'particle-hero' ),
				'description'  => __( 'Turn off for a hero below the fold: it will boot only when the visitor scrolls near it.', 'particle-hero' ),
				'type'         => Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'return_value' => 'yes',
			)
		);

		$this->add_control(
			'pause_offscreen',
			array(
				'label'        => __( 'Pause when off screen', 'particle-hero' ),
				'type'         => Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'return_value' => 'yes',
			)
		);

		$this->add_control(
			'fallback_image',
			array(
				'label'       => __( 'Fallback image', 'particle-hero' ),
				'description' => __( 'Shown when WebGL is unavailable or blocked.', 'particle-hero' ),
				'type'        => Controls_Manager::MEDIA,
			)
		);

		$this->end_controls_section();
	}

	// -------------------------------------------------------------------------
	// Typography
	// -------------------------------------------------------------------------

	private function register_style_controls() {
		$this->start_controls_section(
			'section_typography',
			array(
				'label'     => __( 'Typography', 'particle-hero' ),
				'tab'       => Controls_Manager::TAB_STYLE,
				'condition' => array( 'show_content' => 'yes' ),
			)
		);

		$this->add_control(
			'title_color',
			array(
				'label'     => __( 'Title colour', 'particle-hero' ),
				'type'      => Controls_Manager::COLOR,
				'selectors' => array( '{{WRAPPER}} .particle-hero__title' => 'color: {{VALUE}};' ),
			)
		);

		$this->add_group_control(
			Group_Control_Typography::get_type(),
			array(
				'name'     => 'title_typography',
				'selector' => '{{WRAPPER}} .particle-hero__title',
			)
		);

		$this->add_control(
			'subtitle_color',
			array(
				'label'     => __( 'Subtitle colour', 'particle-hero' ),
				'type'      => Controls_Manager::COLOR,
				'selectors' => array( '{{WRAPPER}} .particle-hero__subtitle' => 'color: {{VALUE}};' ),
				'separator' => 'before',
			)
		);

		$this->add_group_control(
			Group_Control_Typography::get_type(),
			array(
				'name'     => 'subtitle_typography',
				'selector' => '{{WRAPPER}} .particle-hero__subtitle',
			)
		);

		$this->end_controls_section();
	}

	// -------------------------------------------------------------------------
	// Render
	// -------------------------------------------------------------------------

	/**
	 * Read a slider control, tolerating an empty value.
	 *
	 * @param array  $settings
	 * @param string $key
	 * @param float  $fallback
	 * @return float
	 */
	private function slider( $settings, $key, $fallback ) {
		if ( isset( $settings[ $key ]['size'] ) && is_numeric( $settings[ $key ]['size'] ) ) {
			return (float) $settings[ $key ]['size'];
		}
		return $fallback;
	}

	/**
	 * Slider + unit, as a CSS length.
	 *
	 * @param array  $settings
	 * @param string $key
	 * @param string $fallback
	 * @return string
	 */
	private function length( $settings, $key, $fallback ) {
		if ( ! isset( $settings[ $key ]['size'] ) || ! is_numeric( $settings[ $key ]['size'] ) ) {
			return $fallback;
		}
		$unit = isset( $settings[ $key ]['unit'] ) ? $settings[ $key ]['unit'] : 'px';
		return $settings[ $key ]['size'] . $unit;
	}

	protected function render() {
		$settings = $this->get_settings_for_display();

		$args = array(
			'height'             => $this->length( $settings, 'height', '100vh' ),
			'height_mobile'      => $this->length( $settings, 'height_mobile', '620px' ),
			'align'              => isset( $settings['align'] ) ? $settings['align'] : 'left',
			'show_content'       => isset( $settings['show_content'] ) ? $settings['show_content'] : 'yes',
			'title'              => isset( $settings['title'] ) ? $settings['title'] : '',
			'subtitle'           => isset( $settings['subtitle'] ) ? $settings['subtitle'] : '',
			'button_text'        => isset( $settings['button_text'] ) ? $settings['button_text'] : '',
			'button_url'         => isset( $settings['button_url']['url'] ) ? $settings['button_url']['url'] : '',
			'button_target'      => ! empty( $settings['button_url']['is_external'] ) ? '_blank' : '',

			'quality'            => isset( $settings['quality'] ) ? $settings['quality'] : 'auto',
			'particles'          => isset( $settings['particles'] ) ? (int) $settings['particles'] : 0,
			'scale'              => $this->slider( $settings, 'scale', 1 ),
			'camera_distance'    => $this->slider( $settings, 'camera_distance', 7.2 ),
			'offset_y'           => $this->slider( $settings, 'offset_y', 0.05 ),
			'particle_size'      => $this->slider( $settings, 'particle_size', 1.55 ),
			'seed'               => isset( $settings['seed'] ) ? (int) $settings['seed'] : 1337,

			'color_deep'         => $settings['color_deep'] ?? '',
			'color_mid'          => $settings['color_mid'] ?? '',
			'color_hot'          => $settings['color_hot'] ?? '',
			'color_core'         => $settings['color_core'] ?? '',
			'color_core_edge'    => $settings['color_core_edge'] ?? '',
			'bg_top'             => $settings['bg_top'] ?? '',
			'bg_bottom'          => $settings['bg_bottom'] ?? '',
			'bg_glow'            => $settings['bg_glow'] ?? '',
			'bg_glow_strength'   => $this->slider( $settings, 'bg_glow_strength', 0.85 ),
			'transparent'        => $settings['transparent'] ?? 'no',

			'formation_duration' => $this->slider( $settings, 'formation_duration', 5.2 ),
			'formation_delay'    => $this->slider( $settings, 'formation_delay', 0.25 ),
			'stagger'            => $this->slider( $settings, 'stagger', 0.55 ),
			'arc'                => $this->slider( $settings, 'arc', 1.35 ),

			'drift'              => $this->slider( $settings, 'drift', 0.085 ),
			'auto_rotate'        => $this->slider( $settings, 'auto_rotate', 0.045 ),
			'sway'               => $this->slider( $settings, 'sway', 0.055 ),

			'pointer'            => $settings['pointer'] ?? 'yes',
			'pointer_radius'     => $this->slider( $settings, 'pointer_radius', 1.5 ),
			'pointer_push'       => $this->slider( $settings, 'pointer_push', 0.45 ),
			'pointer_parallax'   => $this->slider( $settings, 'pointer_parallax', 0.28 ),

			'scroll'             => $settings['scroll'] ?? 'yes',
			'scroll_distance'    => $this->slider( $settings, 'scroll_distance', 2.6 ),
			'scroll_parallax'    => $this->slider( $settings, 'scroll_parallax', 0.35 ),

			'bloom'              => $settings['bloom'] ?? 'yes',
			'bloom_strength'     => $this->slider( $settings, 'bloom_strength', 1.15 ),
			'exposure'           => $this->slider( $settings, 'exposure', 1.18 ),
			'vignette'           => $this->slider( $settings, 'vignette', 0.55 ),

			'fallback_image'     => isset( $settings['fallback_image']['url'] ) ? $settings['fallback_image']['url'] : '',
			'pause_offscreen'    => $settings['pause_offscreen'] ?? 'yes',
			'eager'              => $settings['eager'] ?? 'yes',
		);

		// Markup is escaped inside the renderer.
		echo Particle_Hero_Renderer::render( $args ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}
}
