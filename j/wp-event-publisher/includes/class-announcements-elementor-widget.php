<?php
/**
 * Elementor widget for Jarchi announcements.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/*
 * This file declares a class that extends an Elementor base class, so it can
 * only be loaded when Elementor is present. Returning early rather than
 * declaring the class is what lets the file be required unconditionally — by
 * the autoloader, by a test that walks every class file — on a site that does
 * not have Elementor installed, without a fatal error.
 */
if ( ! class_exists( '\Elementor\Widget_Base' ) ) {
	return;
}

/**
 * "Jarchi Announcements" Elementor widget.
 *
 * Renders through the same front-end service the shortcode uses, so the
 * audience and expiry rules are applied identically and there is no second
 * copy of the escaping to keep in step.
 *
 * @since 1.6.0
 */
class AnnouncementsElementorWidget extends \Elementor\Widget_Base {

	/**
	 * Widget slug.
	 *
	 * @since 1.6.0
	 *
	 * @return string Widget name.
	 */
	public function get_name(): string {
		return 'jarchi_announcements';
	}

	/**
	 * Widget title shown in the Elementor panel.
	 *
	 * @since 1.6.0
	 *
	 * @return string Widget title.
	 */
	public function get_title(): string {
		return __( 'اطلاعیه‌های جارچی', 'wp-event-publisher' );
	}

	/**
	 * Panel icon.
	 *
	 * @since 1.6.0
	 *
	 * @return string Icon class.
	 */
	public function get_icon(): string {
		return 'eicon-bullhorn';
	}

	/**
	 * Panel categories.
	 *
	 * @since 1.6.0
	 *
	 * @return string[] Categories.
	 */
	public function get_categories(): array {
		return array( 'general' );
	}

	/**
	 * Search keywords.
	 *
	 * @since 1.6.0
	 *
	 * @return string[] Keywords.
	 */
	public function get_keywords(): array {
		return array( 'jarchi', 'announcement', 'notice', 'اطلاعیه', 'جارچی' );
	}

	/**
	 * Registers the widget controls.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	protected function register_controls(): void {
		$this->start_controls_section(
			'content',
			array(
				'label' => __( 'محتوا', 'wp-event-publisher' ),
				'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
			)
		);

		$this->add_control(
			'count',
			array(
				'label'   => __( 'تعداد اطلاعیه‌ها', 'wp-event-publisher' ),
				'type'    => \Elementor\Controls_Manager::NUMBER,
				'min'     => 1,
				'max'     => 50,
				'default' => 5,
			)
		);

		$this->add_control(
			'layout',
			array(
				'label'   => __( 'چیدمان', 'wp-event-publisher' ),
				'type'    => \Elementor\Controls_Manager::SELECT,
				'default' => 'list',
				'options' => array(
					'list'  => __( 'فهرست', 'wp-event-publisher' ),
					'cards' => __( 'کارت', 'wp-event-publisher' ),
				),
			)
		);

		$this->add_control(
			'show_icon',
			array(
				'label'        => __( 'نمایش آیکون', 'wp-event-publisher' ),
				'type'         => \Elementor\Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'return_value' => 'yes',
			)
		);

		$this->add_control(
			'show_date',
			array(
				'label'        => __( 'نمایش تاریخ', 'wp-event-publisher' ),
				'type'         => \Elementor\Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'return_value' => 'yes',
			)
		);

		$this->add_control(
			'show_badge',
			array(
				'label'        => __( 'نمایش نشان', 'wp-event-publisher' ),
				'type'         => \Elementor\Controls_Manager::SWITCHER,
				'default'      => '',
				'return_value' => 'yes',
			)
		);

		$this->end_controls_section();

		$this->start_controls_section(
			'style',
			array(
				'label' => __( 'ظاهر', 'wp-event-publisher' ),
				'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
			)
		);

		$this->add_control(
			'title_color',
			array(
				'label'     => __( 'رنگ عنوان', 'wp-event-publisher' ),
				'type'      => \Elementor\Controls_Manager::COLOR,
				'selectors' => array(
					'{{WRAPPER}} .jarchi-announcement__title, {{WRAPPER}} .jarchi-announcement__title a' => 'color: {{VALUE}};',
				),
			)
		);

		$this->add_control(
			'text_color',
			array(
				'label'     => __( 'رنگ متن', 'wp-event-publisher' ),
				'type'      => \Elementor\Controls_Manager::COLOR,
				'selectors' => array(
					'{{WRAPPER}} .jarchi-announcement__text' => 'color: {{VALUE}};',
				),
			)
		);

		$this->add_control(
			'item_gap',
			array(
				'label'      => __( 'فاصله بین موارد', 'wp-event-publisher' ),
				'type'       => \Elementor\Controls_Manager::SLIDER,
				'size_units' => array( 'px', 'rem' ),
				'selectors'  => array(
					'{{WRAPPER}} .jarchi-announcements' => 'gap: {{SIZE}}{{UNIT}};',
				),
			)
		);

		$this->add_group_control(
			\Elementor\Group_Control_Typography::get_type(),
			array(
				'name'     => 'title_typography',
				'selector' => '{{WRAPPER}} .jarchi-announcement__title',
			)
		);

		$this->end_controls_section();
	}

	/**
	 * Renders the widget.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	protected function render(): void {
		if ( ! function_exists( 'wpep' ) ) {
			return;
		}

		$settings = $this->get_settings_for_display();

		// Escaping happens inside the renderer, at each point of output.
		echo wpep()->announcements_frontend()->markup(
			(int) ( $settings['count'] ?? 5 ),
			array(
				'icon'  => 'yes' === ( $settings['show_icon'] ?? 'yes' ),
				'date'  => 'yes' === ( $settings['show_date'] ?? 'yes' ),
				'badge' => 'yes' === ( $settings['show_badge'] ?? '' ),
				'style' => 'cards' === ( $settings['layout'] ?? 'list' ) ? 'cards' : 'list',
			)
		); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}
}
