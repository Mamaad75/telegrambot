<?php
namespace WPEventPublisher;
if ( ! defined( 'ABSPATH' ) ) { exit; }
if ( ! class_exists( '\Elementor\Widget_Base' ) ) { return; }

class TicketIconElementorWidget extends \Elementor\Widget_Base {
    public function get_name(): string { return 'jarchi_ticket_icon'; }
    public function get_title(): string { return __( 'آیکن تیکت جارچی', 'wp-event-publisher' ); }
    public function get_icon(): string { return 'eicon-headphones'; }
    public function get_categories(): array { return array( 'general' ); }
    public function get_keywords(): array { return array( 'jarchi', 'ticket', 'support', 'تیکت', 'پشتیبانی' ); }

    protected function register_controls(): void {
        $this->start_controls_section( 'content', array(
            'label' => __( 'محتوا', 'wp-event-publisher' ),
            'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
        ) );
        $this->add_control( 'url', array( 'label' => __( 'آدرس صفحه تیکت‌ها', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::URL, 'default' => array( 'url' => '' ), 'dynamic' => array( 'active' => true ) ) );
        $this->add_control( 'show_badge', array( 'label' => __( 'نمایش تعداد پاسخ‌های جدید', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SWITCHER, 'default' => 'yes' ) );
        $this->end_controls_section();

        $this->start_controls_section( 'style', array(
            'label' => __( 'ظاهر', 'wp-event-publisher' ),
            'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
        ) );
        $this->add_control( 'icon', array( 'label' => __( 'آیکن', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::ICONS, 'default' => array( 'value' => 'fas fa-headset', 'library' => 'fa-solid' ) ) );
        $this->add_control( 'icon_color', array( 'label' => __( 'رنگ آیکن', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::COLOR, 'default' => '#E84F01' ) );
        $this->add_control( 'icon_bg', array( 'label' => __( 'رنگ پس‌زمینه', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::COLOR, 'default' => '#FFF4EA' ) );
        $this->add_control( 'icon_border', array( 'label' => __( 'رنگ حاشیه', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::COLOR, 'default' => '#FFD7BE' ) );
        $this->add_control( 'badge_bg', array( 'label' => __( 'رنگ Badge', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::COLOR, 'default' => '#D92D20' ) );
        $this->add_control( 'badge_text', array( 'label' => __( 'رنگ متن Badge', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::COLOR, 'default' => '#FFFFFF' ) );
        $this->add_control( 'badge_border', array( 'label' => __( 'رنگ دور Badge', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::COLOR, 'default' => '#FFFFFF' ) );
        $this->add_responsive_control( 'size', array( 'label' => __( 'اندازه آیکن', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SLIDER, 'size_units' => array( 'px' ), 'range' => array( 'px' => array( 'min' => 28, 'max' => 96 ) ), 'default' => array( 'unit' => 'px', 'size' => 48 ) ) );
        $this->add_responsive_control( 'icon_size', array( 'label' => __( 'اندازه خود آیکن', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SLIDER, 'size_units' => array( 'px' ), 'range' => array( 'px' => array( 'min' => 14, 'max' => 56 ) ), 'default' => array( 'unit' => 'px', 'size' => 24 ) ) );
        $this->add_responsive_control( 'radius', array( 'label' => __( 'گردی گوشه', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SLIDER, 'size_units' => array( 'px' ), 'range' => array( 'px' => array( 'min' => 6, 'max' => 30 ) ), 'default' => array( 'unit' => 'px', 'size' => 14 ) ) );
        $this->add_responsive_control( 'badge_size', array( 'label' => __( 'اندازه Badge', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SLIDER, 'size_units' => array( 'px' ), 'range' => array( 'px' => array( 'min' => 14, 'max' => 30 ) ), 'default' => array( 'unit' => 'px', 'size' => 18 ) ) );
        $this->add_control( 'shadow', array( 'label' => __( 'سایه', 'wp-event-publisher' ), 'type' => \Elementor\Controls_Manager::SWITCHER, 'default' => 'yes' ) );
        $this->end_controls_section();
    }

    protected function render(): void {
        if ( ! function_exists( 'wpep' ) ) { return; }
        wpep()->tickets()->enqueue_front_assets();
        $settings = $this->get_settings_for_display();
        $count = is_user_logged_in() ? wpep()->tickets()->unread_count() : 0;
        $url = ! empty( $settings['url']['url'] ) ? (string) $settings['url']['url'] : wpep()->tickets()->ticket_page_url();
        $icon = ! empty( $settings['icon']['value'] ) ? $settings['icon'] : array( 'value' => 'fas fa-headset', 'library' => 'fa-solid' );
        $icon_html = '';
        if ( class_exists( '\Elementor\Icons_Manager' ) ) {
            ob_start();
            \Elementor\Icons_Manager::render_icon( $icon, array( 'aria-hidden' => 'true', 'class' => 'jarchi-ticket-icon__elementor-svg' ) );
            $icon_html = (string) ob_get_clean();
        }
        if ( '' === trim( $icon_html ) ) {
            $icon_html = '<span class="dashicons dashicons-format-status"></span>';
        }
        $style = sprintf(
            'color:%1$s !important;background:%2$s !important;border:1px solid %3$s !important;width:%4$spx !important;height:%4$spx !important;border-radius:%5$spx !important;--jarchi-ticket-badge-bg:%6$s;--jarchi-ticket-badge-text:%7$s;--jarchi-ticket-badge-border:%8$s;--jarchi-ticket-icon-size:%9$spx;%10$s',
            esc_attr( Tickets::sanitize_css_color( $settings['icon_color'] ?? '#E84F01' ) ?: '#E84F01' ),
            esc_attr( Tickets::sanitize_css_color( $settings['icon_bg'] ?? '#FFF4EA' ) ?: '#FFF4EA' ),
            esc_attr( Tickets::sanitize_css_color( $settings['icon_border'] ?? '#FFD7BE' ) ?: '#FFD7BE' ),
            max( 28, (float) ( $settings['size']['size'] ?? 48 ) ),
            max( 6, (float) ( $settings['radius']['size'] ?? 14 ) ),
            esc_attr( Tickets::sanitize_css_color( $settings['badge_bg'] ?? '#D92D20' ) ?: '#D92D20' ),
            esc_attr( Tickets::sanitize_css_color( $settings['badge_text'] ?? '#FFFFFF' ) ?: '#FFFFFF' ),
            esc_attr( Tickets::sanitize_css_color( $settings['badge_border'] ?? '#FFFFFF' ) ?: '#FFFFFF' ),
            max( 14, (float) ( $settings['icon_size']['size'] ?? 24 ) ),
            ( 'yes' === ( $settings['shadow'] ?? 'yes' ) ? 'box-shadow:0 10px 24px rgba(232,79,1,.14);' : 'box-shadow:none;' )
        );
        $badge_style = sprintf('width:%1$spx;min-width:%1$spx;height:%1$spx;line-height:%1$spx;', max( 14, (float) ( $settings['badge_size']['size'] ?? 18 ) ) );
        $badge = ( 'yes' === ( $settings['show_badge'] ?? 'yes' ) ) ? '<span class="jarchi-ticket-icon__badge' . ( $count ? ' is-visible' : '' ) . '" data-jarchi-ticket-badge style="' . esc_attr( $badge_style ) . '">' . esc_html( (string) min( 99, $count ) ) . '</span>' : '';
        $widget_id = 'jarchi-ticket-icon-widget-' . preg_replace( '/[^a-zA-Z0-9_-]/', '', $this->get_id() );
        $icon_color = Tickets::sanitize_css_color( $settings['icon_color'] ?? '#E84F01' ) ?: '#E84F01';
        $icon_size  = max( 14, (float) ( $settings['icon_size']['size'] ?? 24 ) );
        $icon_css = '.' . $widget_id . ' .jarchi-ticket-icon__elementor-inner *{color:' . esc_attr( $icon_color ) . '!important;fill:currentColor!important;stroke:currentColor!important;width:' . esc_attr( $icon_size ) . 'px!important;height:' . esc_attr( $icon_size ) . 'px!important;}';
        $icon_css .= '.' . $widget_id . ' .jarchi-ticket-icon__elementor-inner svg{display:block!important;}';
        $icon_css .= '.' . $widget_id . ' .jarchi-ticket-icon__badge{background:' . esc_attr( Tickets::sanitize_css_color( $settings['badge_bg'] ?? '#D92D20' ) ?: '#D92D20' ) . '!important;color:' . esc_attr( Tickets::sanitize_css_color( $settings['badge_text'] ?? '#FFFFFF' ) ?: '#FFFFFF' ) . '!important;border-color:' . esc_attr( Tickets::sanitize_css_color( $settings['badge_border'] ?? '#FFFFFF' ) ?: '#FFFFFF' ) . '!important;}';
        if ( wp_style_is( 'wpep-tickets', 'enqueued' ) ) {
            wp_add_inline_style( 'wpep-tickets', $icon_css );
        } else {
            $icon_html .= '<style>' . $icon_css . '</style>';
        }
        echo '<a class="' . esc_attr( $widget_id ) . ' jarchi-ticket-icon jarchi-ticket-icon--elementor" href="' . esc_url( $url ) . '#jarchi-tickets" aria-label="' . esc_attr__( 'تیکت‌های من', 'wp-event-publisher' ) . '" style="' . esc_attr( $style ) . '"><span class="jarchi-ticket-icon__elementor-inner">' . $icon_html . '</span>' . $badge . '</a>' . $icon_inline_css; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    }
}
