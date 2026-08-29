<?php
/**
 * Front-end Jarchi customer hub: announcements + tickets + notifications.
 *
 * @package WPEventPublisher
 */
namespace WPEventPublisher;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class CustomerHub {
    public const OPTION_PAGE = 'wpep_customer_hub_page';

    public function register(): void {
        add_shortcode( 'jarchi_customer_hub', array( $this, 'shortcode' ) );
        add_action( 'init', array( $this, 'maybe_create_page' ), 20 );
        add_filter( 'the_content', array( $this, 'filter_page_content' ), 20 );
        add_action( 'elementor/widgets/register', array( $this, 'register_elementor_widget' ) );
    }

    public function maybe_create_page(): void {
        $page_id = absint( get_option( self::OPTION_PAGE, 0 ) );
        if ( $page_id && 'trash' !== get_post_status( $page_id ) ) {
            return;
        }
        $existing = get_page_by_path( 'jarchi-account' );
        if ( $existing instanceof \WP_Post ) {
            update_option( self::OPTION_PAGE, (int) $existing->ID, false );
            return;
        }
        $new_id = wp_insert_post(
            array(
                'post_type'    => 'page',
                'post_status'  => 'publish',
                'post_title'   => __( 'مرکز کاربری جارچی', 'wp-event-publisher' ),
                'post_name'    => 'jarchi-account',
                'post_content' => '[jarchi_customer_hub]',
            ),
            true
        );
        if ( ! is_wp_error( $new_id ) ) {
            update_option( self::OPTION_PAGE, (int) $new_id, false );
        }
    }

    public function page_url(): string {
        $page_id = absint( get_option( self::OPTION_PAGE, 0 ) );
        if ( $page_id && 'publish' === get_post_status( $page_id ) ) {
            return (string) get_permalink( $page_id );
        }
        return home_url( '/jarchi-account/' );
    }

    public function filter_page_content( string $content ): string {
        if ( is_admin() || ! is_page() ) {
            return $content;
        }
        $page_id = absint( get_option( self::OPTION_PAGE, 0 ) );
        if ( ! $page_id || get_queried_object_id() !== $page_id ) {
            return $content;
        }
        // Elementor-owned pages render their widget tree; do not replace it.
        if ( did_action( 'elementor/loaded' ) && class_exists( '\Elementor\Plugin' ) ) {
            $document = \Elementor\Plugin::$instance->documents->get( $page_id );
            if ( $document && $document->is_built_with_elementor() ) {
                return $content;
            }
        }
        if ( has_shortcode( $content, 'jarchi_customer_hub' ) ) {
            return $content;
        }
        return $content . $this->render();
    }

    public function shortcode( $atts = array() ): string {
        $atts = shortcode_atts(
            array(
                'show_announcements' => 'yes',
                'show_tickets'       => 'yes',
                'show_stats'         => 'yes',
                'title'              => 'مرکز کاربری جارچی',
                'description'        => 'اطلاعیه‌ها، تیکت‌ها و ارتباط با پشتیبانی را یکجا مدیریت کنید.',
            ),
            is_array( $atts ) ? $atts : array(),
            'jarchi_customer_hub'
        );
        return $this->render(
            array(
                'show_announcements' => $this->truthy( $atts['show_announcements'] ),
                'show_tickets'       => $this->truthy( $atts['show_tickets'] ),
                'show_stats'         => $this->truthy( $atts['show_stats'] ),
                'title'              => (string) $atts['title'],
                'description'        => (string) $atts['description'],
            )
        );
    }

    public function render( array $overrides = array() ): string {
        if ( ! is_user_logged_in() ) {
            return '<section class="jarchi-hub jarchi-hub--login"><div class="jarchi-hub__login-card"><span class="jarchi-hub__eyebrow">JARCHI</span><h2>' . esc_html__( 'برای دسترسی وارد حساب خود شوید', 'wp-event-publisher' ) . '</h2><p>' . esc_html__( 'پس از ورود، تیکت‌ها و اطلاعیه‌های شخصی شما اینجا نمایش داده می‌شود.', 'wp-event-publisher' ) . '</p>' . wp_login_form( array( 'echo' => false, 'redirect' => $this->page_url() ) ) . '</div></section>';
        }

        wpep()->tickets()->enqueue_front_assets();
        $hub_css = WPEP_PLUGIN_DIR . 'assets/css/customer-hub.css';
        if ( is_readable( $hub_css ) ) {
            wp_enqueue_style( 'wpep-customer-hub', WPEP_PLUGIN_URL . 'assets/css/customer-hub.css', array( 'wpep-tickets' ), WPEP_VERSION . '.' . filemtime( $hub_css ) );
            // The hub still draws its glyphs with Dashicons, which WordPress
            // only loads in wp-admin. Without this the icons are empty boxes
            // on the front end, which is exactly how they shipped.
            wp_enqueue_style( 'dashicons' );
        }

        $announcements = wpep()->announcements()->active( 50 );
        $unread_tickets = wpep()->tickets()->unread_count();
        $announcement_count = count( $announcements );
        $show_ann = $overrides['show_announcements'] ?? true;
        $show_tickets = $overrides['show_tickets'] ?? true;
        $show_stats = $overrides['show_stats'] ?? true;
        $title = $overrides['title'] ?? __( 'مرکز کاربری جارچی', 'wp-event-publisher' );
        $description = $overrides['description'] ?? __( 'اطلاعیه‌ها، تیکت‌ها و ارتباط با پشتیبانی را یکجا مدیریت کنید.', 'wp-event-publisher' );

        $primary = Tickets::sanitize_css_color( $overrides['primary'] ?? '#E84F01' ) ?: '#E84F01';
        $primary_hi = Tickets::sanitize_css_color( $overrides['primary_hi'] ?? '#FF8A1C' ) ?: '#FF8A1C';
        $bg = Tickets::sanitize_css_color( $overrides['background'] ?? '#F6F7F9' ) ?: '#F6F7F9';
        $surface = Tickets::sanitize_css_color( $overrides['surface'] ?? '#FFFFFF' ) ?: '#FFFFFF';
        $text = Tickets::sanitize_css_color( $overrides['text'] ?? '#171717' ) ?: '#171717';
        $muted = Tickets::sanitize_css_color( $overrides['muted'] ?? '#667085' ) ?: '#667085';
        $border = Tickets::sanitize_css_color( $overrides['border'] ?? '#E6E8EC' ) ?: '#E6E8EC';
        $radius = max( 12, min( 34, (float) ( $overrides['radius'] ?? 22 ) ) );
        $max_width = max( 760, min( 1600, (float) ( $overrides['max_width'] ?? 1240 ) ) );
        $shadow = ! array_key_exists( 'shadow', $overrides ) || ! empty( $overrides['shadow'] );

        $style = sprintf(
            '--jhub-primary:%1$s;--jhub-primary-hi:%2$s;--jhub-bg:%3$s;--jhub-surface:%4$s;--jhub-text:%5$s;--jhub-muted:%6$s;--jhub-border:%7$s;--jhub-radius:%8$spx;--jhub-max:%9$spx;--jhub-shadow:%10$s;',
            $primary,
            $primary_hi,
            $bg,
            $surface,
            $text,
            $muted,
            $border,
            $radius,
            $max_width,
            $shadow ? '0 18px 55px rgba(20,24,31,.09)' : 'none'
        );

        wp_enqueue_style( 'wpep-tickets' );
        $out  = '<section class="jarchi-hub" dir="rtl" style="' . esc_attr( $style ) . '">';
        $out .= '<div class="jarchi-hub__hero"><div><span class="jarchi-hub__eyebrow">JARCHI • SMART CUSTOMER HUB</span><h2>' . esc_html( $title ) . '</h2><p>' . esc_html( $description ) . '</p></div><div class="jarchi-hub__hero-actions"><button type="button" class="jarchi-hub__quick jarchi-push-enable" data-jarchi-enable-notifications hidden><span class="dashicons dashicons-bell"></span><span>فعال‌سازی اعلان</span></button><a class="jarchi-hub__quick" href="#jarchi-hub-tickets"><span class="dashicons dashicons-sos"></span><span>' . esc_html__( 'تیکت‌ها', 'wp-event-publisher' ) . '</span><b>' . esc_html( (string) $unread_tickets ) . '</b></a><a class="jarchi-hub__quick" href="#jarchi-hub-announcements"><span class="dashicons dashicons-megaphone"></span><span>' . esc_html__( 'اطلاعیه‌ها', 'wp-event-publisher' ) . '</span><b>' . esc_html( (string) $announcement_count ) . '</b></a></div></div>';

        if ( $show_stats ) {
            $out .= '<div class="jarchi-hub__stats">';
            $out .= '<div class="jarchi-hub__stat"><span class="dashicons dashicons-sos"></span><div><small>' . esc_html__( 'پاسخ جدید تیکت', 'wp-event-publisher' ) . '</small><strong>' . esc_html( (string) $unread_tickets ) . '</strong></div></div>';
            $out .= '<div class="jarchi-hub__stat"><span class="dashicons dashicons-megaphone"></span><div><small>' . esc_html__( 'اطلاعیه فعال', 'wp-event-publisher' ) . '</small><strong>' . esc_html( (string) $announcement_count ) . '</strong></div></div>';
            $out .= '<div class="jarchi-hub__stat"><span class="dashicons dashicons-admin-users"></span><div><small>' . esc_html__( 'حساب کاربری', 'wp-event-publisher' ) . '</small><strong>' . esc_html( wp_get_current_user()->display_name ?: wp_get_current_user()->user_login ) . '</strong></div></div>';
            $out .= '</div>';
        }

        if ( $show_ann ) {
            $out .= '<div id="jarchi-hub-announcements" class="jarchi-hub__section"><div class="jarchi-hub__section-head"><div><span class="jarchi-hub__section-kicker">ANNOUNCEMENTS</span><h3>' . esc_html__( 'اطلاعیه‌های شما', 'wp-event-publisher' ) . '</h3></div><a href="#jarchi-hub-announcements" class="jarchi-hub__section-link">' . esc_html__( 'مشاهده همه', 'wp-event-publisher' ) . '</a></div>';
            if ( $announcements ) {
                $out .= '<div class="jarchi-hub__ann-grid">';
                foreach ( $announcements as $item ) {
                    $view = wpep()->announcements()->view( $item );
                    $link = ! empty( $view['link'] ) ? $view['link'] : '#';
                    $icon = ! empty( $view['icon'] ) ? $view['icon'] : 'dashicons-megaphone';
                    $out .= '<article class="jarchi-hub__ann-card"><div class="jarchi-hub__ann-icon"><span class="dashicons ' . esc_attr( $icon ) . '"></span></div><div class="jarchi-hub__ann-body"><span class="jarchi-hub__ann-date">' . esc_html( $view['date'] ?? get_the_date( '', $item ) ) . '</span><h4>' . esc_html( get_the_title( $item ) ) . '</h4><div class="jarchi-hub__ann-content">' . wp_kses_post( wp_trim_words( $item->post_content, 34 ) ) . '</div>' . ( '#' !== $link ? '<a href="' . esc_url( $link ) . '" class="jarchi-hub__ann-link">' . esc_html__( 'مشاهده جزئیات', 'wp-event-publisher' ) . ' <span aria-hidden="true">←</span></a>' : '' ) . '</div></article>';
                }
                $out .= '</div>';
            } else {
                $out .= '<div class="jarchi-hub__empty"><span class="dashicons dashicons-megaphone"></span><strong>' . esc_html__( 'اطلاعیه‌ای برای شما وجود ندارد.', 'wp-event-publisher' ) . '</strong><p>' . esc_html__( 'هر اطلاعیه جدیدی که برای شما منتشر شود، اینجا نمایش داده می‌شود.', 'wp-event-publisher' ) . '</p></div>';
            }
            $out .= '</div>';
        }

        if ( $show_tickets ) {
            $out .= '<div id="jarchi-hub-tickets" class="jarchi-hub__section jarchi-hub__section--tickets"><div class="jarchi-hub__section-head"><div><span class="jarchi-hub__section-kicker">SUPPORT CENTER</span><h3>' . esc_html__( 'مرکز تیکت شما', 'wp-event-publisher' ) . '</h3></div><a href="' . esc_url( wpep()->tickets()->ticket_page_url() ) . '" class="jarchi-hub__section-link">' . esc_html__( 'صفحه کامل تیکت‌ها', 'wp-event-publisher' ) . '</a></div>';
            $ticket_overrides = array(
                'show_list' => true,
                'kicker' => __( 'SUPPORT CENTER', 'wp-event-publisher' ),
                'title' => __( 'تیکت‌های من', 'wp-event-publisher' ),
            );
            $out .= wpep()->tickets()->render_center( $ticket_overrides );
            $out .= '</div>';
        }

        $out .= '</section>';
        return $out;
    }

    public function register_elementor_widget( $widgets_manager ): void {
        if ( ! class_exists( '\Elementor\Widget_Base' ) || ! is_object( $widgets_manager ) || ! method_exists( $widgets_manager, 'register' ) ) {
            return;
        }
        $widgets_manager->register( new CustomerHubElementorWidget() );
    }

    private function truthy( $value ): bool {
        return in_array( strtolower( (string) $value ), array( '1', 'yes', 'true', 'on' ), true );
    }
}
