<?php
namespace WPEventPublisher;
if ( ! defined( 'ABSPATH' ) ) { exit; }
if ( ! class_exists( '\Elementor\Widget_Base' ) ) { return; }

class CustomerHubElementorWidget extends \Elementor\Widget_Base {
    public function get_name(): string { return 'jarchi_customer_hub'; }
    public function get_title(): string { return __( 'مرکز کاربری جارچی', 'wp-event-publisher' ); }
    public function get_icon(): string { return 'eicon-dashboard'; }
    public function get_categories(): array { return array( 'general' ); }
    public function get_keywords(): array { return array( 'jarchi', 'dashboard', 'customer', 'notifications', 'tickets', 'اطلاعیه', 'تیکت' ); }

    protected function register_controls(): void {
        $this->start_controls_section( 'content', array(
            'label' => __( 'محتوا', 'wp-event-publisher' ),
            'tab' => \Elementor\Controls_Manager::TAB_CONTENT,
        ) );
        foreach ( array(
            'title' => array( 'عنوان', 'مرکز کاربری جارچی' ),
            'description' => array( 'توضیح', 'اطلاعیه‌ها، تیکت‌ها و ارتباط با پشتیبانی را یکجا مدیریت کنید.' ),
        ) as $key => $item ) {
            $this->add_control( $key, array( 'label' => __( $item[0], 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::TEXT, 'default' => __( $item[1], 'wp-event-publisher' ) ) );
        }
        $this->add_control( 'show_stats', array( 'label' => __( 'نمایش کارت‌های آماری', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SWITCHER, 'default' => 'yes' ) );
        $this->add_control( 'show_announcements', array( 'label' => __( 'نمایش اطلاعیه‌ها', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SWITCHER, 'default' => 'yes' ) );
        $this->add_control( 'show_tickets', array( 'label' => __( 'نمایش تیکت‌ها', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SWITCHER, 'default' => 'yes' ) );
        $this->end_controls_section();

        $this->start_controls_section( 'colors', array( 'label' => __( 'رنگ‌ها', 'wp-event-publisher' ), 'tab' => \Elementor\Controls_Manager::TAB_STYLE ) );
        foreach ( array(
            'primary' => array( 'Accent', '#E84F01' ),
            'primary_hi' => array( 'Accent روشن', '#FF8A1C' ),
            'background' => array( 'پس‌زمینه', '#F6F7F9' ),
            'surface' => array( 'سطح کارت', '#FFFFFF' ),
            'text' => array( 'رنگ متن', '#171717' ),
            'muted' => array( 'متن کمکی', '#667085' ),
            'border' => array( 'حاشیه', '#E6E8EC' ),
        ) as $key => $item ) {
            $this->add_control( $key, array( 'label' => __( $item[0], 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::COLOR, 'default' => $item[1] ) );
        }
        $this->end_controls_section();

        $this->start_controls_section( 'layout', array( 'label' => __( 'چیدمان', 'wp-event-publisher' ), 'tab' => \Elementor\Controls_Manager::TAB_STYLE ) );
        foreach ( array(
            'max_width' => array( 'حداکثر عرض', 1240, 760, 1600 ),
            'radius' => array( 'گردی کارت‌ها', 22, 12, 34 ),
        ) as $key => $item ) {
            $this->add_responsive_control( $key, array(
                'label' => __( $item[0], 'wp-event-publisher' ),
                'type' => \Elementor\Controls_Manager::SLIDER,
                'size_units' => array( 'px' ),
                'range' => array( 'px' => array( 'min' => $item[2], 'max' => $item[3] ) ),
                'default' => array( 'unit' => 'px', 'size' => $item[1] ),
            ) );
        }
        $this->add_control( 'shadow', array( 'label' => __( 'سایه', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SWITCHER, 'default' => 'yes' ) );
        $this->end_controls_section();

        $this->start_controls_section( 'typography', array( 'label' => __( 'تایپوگرافی', 'wp-event-publisher' ), 'tab' => \Elementor\Controls_Manager::TAB_STYLE ) );
        $this->add_group_control( \Elementor\Group_Control_Typography::get_type(), array(
            'name' => 'title_typography', 'label' => __( 'عنوان', 'wp-event-publisher' ),
            'selector' => '{{WRAPPER}} .jarchi-hub__hero h2, {{WRAPPER}} .jarchi-hub__section-head h3',
        ) );
        $this->add_group_control( \Elementor\Group_Control_Typography::get_type(), array(
            'name' => 'body_typography', 'label' => __( 'متن', 'wp-event-publisher' ),
            'selector' => '{{WRAPPER}} .jarchi-hub__hero p, {{WRAPPER}} .jarchi-hub__ann-content, {{WRAPPER}} .jarchi-hub__stat small',
        ) );
        $this->end_controls_section();
    }

    protected function render(): void {
        if ( ! function_exists( 'wpep' ) ) { return; }
        $s = $this->get_settings_for_display();
        $overrides = array(
            'title' => (string) ( $s['title'] ?? 'مرکز کاربری جارچی' ),
            'description' => (string) ( $s['description'] ?? '' ),
            'show_stats' => 'yes' === ( $s['show_stats'] ?? 'yes' ),
            'show_announcements' => 'yes' === ( $s['show_announcements'] ?? 'yes' ),
            'show_tickets' => 'yes' === ( $s['show_tickets'] ?? 'yes' ),
            'shadow' => 'yes' === ( $s['shadow'] ?? 'yes' ),
        );
        foreach ( array( 'primary','primary_hi','background','surface','text','muted','border' ) as $key ) {
            $overrides[ $key ] = sanitize_hex_color( $s[ $key ] ?? '' ) ?: null;
        }
        foreach ( array( 'max_width','radius' ) as $key ) {
            $overrides[ $key ] = isset( $s[ $key ]['size'] ) ? (float) $s[ $key ]['size'] : null;
        }
        $html = wpep()->customer_hub()->render( $overrides );
        $widget_id = 'jarchi-hub-widget-' . preg_replace( '/[^a-zA-Z0-9_-]/', '', $this->get_id() );
        $html = preg_replace( '/class="jarchi-hub"/', 'class="' . esc_attr( $widget_id ) . ' jarchi-hub"', $html, 1 );
        echo $html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    }
}
