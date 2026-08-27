<?php
/**
 * Ticket operations: SLA, analytics and support health.
 *
 * Keeps operational tooling local to WordPress. The Mini App/Backend is an
 * optional remote-control layer and is never required for the ticket center.
 *
 * @package WPEventPublisher
 */
namespace WPEventPublisher;

if ( ! defined( 'ABSPATH' ) ) { exit; }

final class TicketOperations {
    private const OPTION = 'wpep_ticket_operations';
    public const PAGE_SLA = 'wp-event-publisher-ticket-ops';

    public function register(): void {
        // Screen registration is centralized in Admin::register_menu(); registering
		// it here as well produced a second $submenu entry for the same slug.
        add_action( 'admin_post_wpep_ticket_ops_save', array( $this, 'save_settings' ) );
        add_action( 'jarchi_ticket_ops_scan', array( $this, 'scan_sla' ) );
        add_action( 'init', array( $this, 'schedule' ) );
        register_deactivation_hook( WPEP_PLUGIN_FILE, array( $this, 'unschedule' ) );
    }

    public function defaults(): array {
        return array(
            'sla_enabled' => true,
            'first_response_minutes' => 60,
            'resolution_minutes' => 1440,
            'escalation_minutes' => 30,
            'notify_agents' => true,
            'auto_close_after_days' => 7,
        );
    }

    public function settings(): array {
        $stored = get_option( self::OPTION, array() );
        return wp_parse_args( is_array( $stored ) ? $stored : array(), $this->defaults() );
    }

    public function schedule(): void {
        if ( ! wp_next_scheduled( 'jarchi_ticket_ops_scan' ) ) {
            wp_schedule_event( time() + 300, 'hourly', 'jarchi_ticket_ops_scan' );
        }
    }

    public function unschedule(): void {
        wp_clear_scheduled_hook( 'jarchi_ticket_ops_scan' );
    }

    public function register_admin_page(): void {
        // Navigation is centralized in Admin::register_menu().
    }

    public function save_settings(): void {
        if ( ! current_user_can( Admin::CAPABILITY ) ) {
            wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
        }
        check_admin_referer( 'jarchi_ticket_ops_save' );
        $current = $this->settings();
        $current['sla_enabled'] = ! empty( $_POST['sla_enabled'] );
        $current['notify_agents'] = ! empty( $_POST['notify_agents'] );
        $current['first_response_minutes'] = max( 5, min( 10080, absint( $_POST['first_response_minutes'] ?? $current['first_response_minutes'] ) ) );
        $current['resolution_minutes'] = max( 15, min( 43200, absint( $_POST['resolution_minutes'] ?? $current['resolution_minutes'] ) ) );
        $current['escalation_minutes'] = max( 5, min( 1440, absint( $_POST['escalation_minutes'] ?? $current['escalation_minutes'] ) ) );
        $current['auto_close_after_days'] = max( 0, min( 90, absint( $_POST['auto_close_after_days'] ?? $current['auto_close_after_days'] ) ) );
        update_option( self::OPTION, $current, false );
        wp_safe_redirect( add_query_arg( array( 'updated' => 1 ), Admin::app_url( 'ticket-ops' ) ) );
        exit;
    }

    public function scan_sla(): void {
        $settings = $this->settings();
        if ( ! $settings['sla_enabled'] ) return;
        $tickets = get_posts( array(
            'post_type' => Tickets::POST_TYPE,
            'post_status' => array( 'publish', 'private', 'draft' ),
            'posts_per_page' => 200,
            'fields' => 'ids',
            'orderby' => 'modified',
            'order' => 'DESC',
            'no_found_rows' => true,
        ) );
        $now = time();
        foreach ( $tickets as $ticket_id ) {
            $status = wpep()->tickets()->status( (int) $ticket_id );
            if ( 'closed' === $status ) continue;
            $created = (int) get_post_time( 'U', true, $ticket_id );
            $first_responded = get_post_meta( $ticket_id, '_jarchi_ticket_first_response_at', true );
            $last_activity = get_post_meta( $ticket_id, '_jarchi_ticket_last_reply', true );
            $base = $last_activity ? strtotime( $last_activity ) : $created;
            if ( ! $first_responded && $created && ( $now - $created ) > ( $settings['first_response_minutes'] * 60 ) ) {
                if ( ! get_post_meta( $ticket_id, '_jarchi_sla_first_alerted', true ) ) {
                    update_post_meta( $ticket_id, '_jarchi_sla_first_alerted', current_time( 'mysql' ) );
                    $this->notify_agent( (int) $ticket_id, 'first_response', $settings );
                }
            }
            if ( $base && ( $now - $base ) > ( $settings['resolution_minutes'] * 60 ) ) {
                if ( ! get_post_meta( $ticket_id, '_jarchi_sla_resolution_alerted', true ) ) {
                    update_post_meta( $ticket_id, '_jarchi_sla_resolution_alerted', current_time( 'mysql' ) );
                    $this->notify_agent( (int) $ticket_id, 'resolution', $settings );
                }
            }
        }
    }

    private function notify_agent( int $ticket_id, string $kind, array $settings ): void {
        if ( ! $settings['notify_agents'] ) return;
        $agent_id = absint( get_post_meta( $ticket_id, '_jarchi_ticket_agent', true ) );
        if ( ! $agent_id ) return;
        $user = get_user_by( 'id', $agent_id );
        $ticket = get_post( $ticket_id );
        if ( ! $user || ! $ticket || ! $user->user_email ) return;
        $label = 'first_response' === $kind ? __( 'اولین پاسخ', 'wp-event-publisher' ) : __( 'حل تیکت', 'wp-event-publisher' );
        wp_mail(
            $user->user_email,
            sprintf( __( 'هشدار SLA تیکت #%d', 'wp-event-publisher' ), $ticket_id ),
            sprintf( __( "سلام %1\$s\n\nمهلت %2\$s تیکت «%3\$s» گذشته است. لطفاً آن را بررسی کنید.", 'wp-event-publisher' ), $user->display_name, $label, $ticket->post_title ),
            array( 'Content-Type: text/plain; charset=UTF-8' )
        );
    }

    public function analytics(): array {
        $tickets = get_posts( array(
            'post_type' => Tickets::POST_TYPE,
            'post_status' => array( 'publish', 'private', 'draft' ),
            'posts_per_page' => 500,
            'fields' => 'ids',
            'orderby' => 'date',
            'order' => 'DESC',
            'no_found_rows' => true,
        ) );
        $counts = array( 'all' => count( $tickets ), 'waiting' => 0, 'reviewing' => 0, 'answered' => 0, 'closed' => 0 );
        $response_times = array();
        $resolution_times = array();
        $agents = array();
        foreach ( $tickets as $id ) {
            $status = wpep()->tickets()->status( (int) $id );
            if ( isset( $counts[ $status ] ) ) $counts[ $status ]++;
            $messages = wpep()->tickets()->messages( (int) $id );
            $first_admin = null;
            $last_admin = null;
            foreach ( $messages as $message ) {
                $sender = (string) get_comment_meta( $message->comment_ID, '_jarchi_ticket_sender', true );
                if ( 'admin' === $sender ) {
                    $time = strtotime( $message->comment_date_gmt . ' GMT' );
                    if ( null === $first_admin ) $first_admin = $time;
                    $last_admin = $time;
                }
            }
            $created = (int) get_post_time( 'U', true, $id );
            if ( $created && $first_admin ) $response_times[] = max( 0, $first_admin - $created );
            if ( $created && 'closed' === $status && $last_admin ) $resolution_times[] = max( 0, $last_admin - $created );
            $agent_id = absint( get_post_meta( $id, '_jarchi_ticket_agent', true ) );
            if ( $agent_id ) {
                if ( ! isset( $agents[ $agent_id ] ) ) $agents[ $agent_id ] = array( 'tickets' => 0, 'closed' => 0, 'rating_total' => 0, 'rated' => 0 );
                $agents[ $agent_id ]['tickets']++;
                if ( 'closed' === $status ) $agents[ $agent_id ]['closed']++;
                $rating = absint( get_post_meta( $id, '_jarchi_ticket_rating', true ) );
                if ( $rating ) { $agents[ $agent_id ]['rating_total'] += $rating; $agents[ $agent_id ]['rated']++; }
            }
        }
        $agent_rows = array();
        foreach ( $agents as $agent_id => $row ) {
            $user = get_user_by( 'id', $agent_id );
            if ( ! $user ) continue;
            $agent_rows[] = array(
                'id' => $agent_id,
                'name' => $user->display_name,
                'tickets' => $row['tickets'],
                'closed' => $row['closed'],
                'rating' => $row['rated'] ? round( $row['rating_total'] / $row['rated'], 2 ) : null,
            );
        }
        return array(
            'counts' => $counts,
            'avg_first_response_minutes' => $response_times ? round( array_sum( $response_times ) / count( $response_times ) / 60, 1 ) : null,
            'avg_resolution_minutes' => $resolution_times ? round( array_sum( $resolution_times ) / count( $resolution_times ) / 60, 1 ) : null,
            'agents' => $agent_rows,
        );
    }

    public function render_page(): void {
        if ( ! current_user_can( Admin::CAPABILITY ) ) wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
        $settings = $this->settings();
        $analytics = $this->analytics();
        $this->assets();
        ?>
        <div class="wrap jarchi-ops-page" dir="rtl">
            <div class="jarchi-ops-hero"><div><span class="jarchi-ops-kicker">SUPPORT OPERATIONS</span><h1><?php esc_html_e( 'عملیات و SLA تیکت', 'wp-event-publisher' ); ?></h1><p><?php esc_html_e( 'سلامت پشتیبانی، SLA و عملکرد پشتیبان‌ها را در یک نمای واحد ببینید.', 'wp-event-publisher' ); ?></p></div><div class="jarchi-ops-badge">JARCHI</div></div>
            <div class="jarchi-ops-grid">
                <?php foreach ( array( array( 'all', 'همه تیکت‌ها' ), array( 'waiting', 'در انتظار پاسخ' ), array( 'reviewing', 'در حال بررسی' ), array( 'answered', 'پاسخ داده شده' ), array( 'closed', 'بسته شده' ) ) as $card ) : ?>
                    <div class="jarchi-ops-card"><span><?php echo esc_html( $card[1] ); ?></span><strong><?php echo esc_html( (string) $analytics['counts'][ $card[0] ] ); ?></strong></div>
                <?php endforeach; ?>
            </div>
            <div class="jarchi-ops-columns">
                <section class="jarchi-ops-panel"><div class="jarchi-ops-panel-head"><h2><?php esc_html_e( 'SLA', 'wp-event-publisher' ); ?></h2><span><?php echo $settings['sla_enabled'] ? 'فعال' : 'خاموش'; ?></span></div>
                    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="jarchi-ops-form">
                        <input type="hidden" name="action" value="wpep_ticket_ops_save"><?php wp_nonce_field( 'jarchi_ticket_ops_save' ); ?>
                        <label><input type="checkbox" name="sla_enabled" value="1" <?php checked( $settings['sla_enabled'] ); ?>> فعال‌سازی SLA</label>
                        <label>اولین پاسخ (دقیقه)<input type="number" min="5" max="10080" name="first_response_minutes" value="<?php echo esc_attr( $settings['first_response_minutes'] ); ?>"></label>
                        <label>حل تیکت (دقیقه)<input type="number" min="15" max="43200" name="resolution_minutes" value="<?php echo esc_attr( $settings['resolution_minutes'] ); ?>"></label>
                        <label>مهلت Escalation (دقیقه)<input type="number" min="5" max="1440" name="escalation_minutes" value="<?php echo esc_attr( $settings['escalation_minutes'] ); ?>"></label>
                        <label><input type="checkbox" name="notify_agents" value="1" <?php checked( $settings['notify_agents'] ); ?>> ایمیل هشدار به پشتیبان</label>
                        <label>بستن خودکار پس از بی‌فعالیتی (روز)<input type="number" min="0" max="90" name="auto_close_after_days" value="<?php echo esc_attr( $settings['auto_close_after_days'] ); ?>"></label>
                        <button class="button button-primary">ذخیره تنظیمات SLA</button>
                    </form>
                </section>
                <section class="jarchi-ops-panel"><div class="jarchi-ops-panel-head"><h2><?php esc_html_e( 'عملکرد', 'wp-event-publisher' ); ?></h2></div><div class="jarchi-ops-metrics"><div><small>میانگین اولین پاسخ</small><strong><?php echo null === $analytics['avg_first_response_minutes'] ? '—' : esc_html( $analytics['avg_first_response_minutes'] . ' دقیقه' ); ?></strong></div><div><small>میانگین حل</small><strong><?php echo null === $analytics['avg_resolution_minutes'] ? '—' : esc_html( $analytics['avg_resolution_minutes'] . ' دقیقه' ); ?></strong></div></div>
                    <div class="jarchi-ops-agents"><?php foreach ( $analytics['agents'] as $agent ) : ?><div class="jarchi-ops-agent"><span><?php echo esc_html( $agent['name'] ); ?></span><b><?php echo esc_html( $agent['tickets'] ); ?> تیکت</b><em><?php echo null === $agent['rating'] ? 'بدون امتیاز' : esc_html( $agent['rating'] . '/5' ); ?></em></div><?php endforeach; if ( ! $analytics['agents'] ) : ?><p>هنوز داده‌ای برای پشتیبان‌ها وجود ندارد.</p><?php endif; ?></div>
                </section>
            </div>
        </div>
        <?php
    }

    private function assets(): void {
        $css = WPEP_PLUGIN_DIR . 'assets/css/ticket-operations.css';
        if ( is_readable( $css ) ) wp_enqueue_style( 'wpep-ticket-operations', WPEP_PLUGIN_URL . 'assets/css/ticket-operations.css', array( 'wpep-admin' ), WPEP_VERSION . '.' . filemtime( $css ) );
    }
}
