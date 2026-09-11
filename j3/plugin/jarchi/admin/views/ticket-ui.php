<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
$page_id = absint( get_option( '_wpep_ticket_page_id', 0 ) );
$ticket_url = (string) get_option( WPEventPublisher\Tickets::TICKET_URL_OPTION, '' );
$fields = array(
    'primary' => array( 'رنگ اصلی', $settings['primary'] ),
    'surface' => array( 'رنگ کارت', $settings['surface'] ),
    'background' => array( 'پس‌زمینه', $settings['background'] ),
    'text' => array( 'رنگ متن', $settings['text'] ),
    'muted' => array( 'متن کمکی', $settings['muted'] ),
    'border' => array( 'رنگ حاشیه', $settings['border'] ),
);
?>
<div class="wrap wpep-wrap jarchi-ticket-ui-settings">
    <h1><?php esc_html_e( 'ظاهر تیکت‌ها', 'wp-event-publisher' ); ?></h1>
    <p class="description"><?php esc_html_e( 'رنگ‌های پیش‌فرض مرکز تیکت را تنظیم کنید. مرکز تیکت همان‌جایی نمایش داده می‌شود که طراح المان جارچی را در Elementor/JetEngine قرار داده است؛ جارچی دیگر صفحه جداگانه‌ای برای تیکت نمی‌سازد.', 'wp-event-publisher' ); ?></p>
    <?php if ( class_exists( 'Elementor\Plugin' ) && ! empty( $page_id ) ) : ?>
        <p><a class="button" href="<?php echo esc_url( admin_url( 'post.php?post=' . absint( $page_id ) . '&action=elementor' ) ); ?>"><?php esc_html_e( 'ویرایش مرکز تیکت با Elementor', 'wp-event-publisher' ); ?></a></p>
    <?php endif; ?>
    <form method="post">
        <?php wp_nonce_field( 'jarchi_ticket_ui_save' ); ?>
        <table class="form-table" role="presentation">
            <tr>
                <th><label for="jarchi-ticket-main-url"><?php esc_html_e( 'آدرس اصلی صفحه تیکت‌ها', 'wp-event-publisher' ); ?></label></th>
                <td>
                    <input type="url" class="regular-text code" id="jarchi-ticket-main-url" name="ticket_url" value="<?php echo esc_attr( $ticket_url ); ?>" placeholder="<?php echo esc_attr( home_url( '/account/tickets/' ) ); ?>" dir="ltr" />
                    <p class="description"><?php esc_html_e( 'لینک همان صفحه‌ای را وارد کنید که طراح، المان «مرکز تیکت جارچی» را داخل آن گذاشته است. آیکن جارچی، اعلان‌ها و لینک‌های تیکت از این آدرس استفاده می‌کنند؛ افزونه دیگر به /jarchi-tickets/ نمی‌رود.', 'wp-event-publisher' ); ?></p>
                </td>
            </tr>
        <?php foreach ( $fields as $key => $field ) : ?>
            <tr><th><label for="jarchi-ticket-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $field[0] ); ?></label></th><td><input type="color" id="jarchi-ticket-<?php echo esc_attr( $key ); ?>" name="<?php echo esc_attr( $key ); ?>" value="<?php echo esc_attr( $field[1] ); ?>" /></td></tr>
        <?php endforeach; ?>
            <tr><th><?php esc_html_e( 'گوشه کارت‌ها', 'wp-event-publisher' ); ?></th><td><input type="number" min="10" max="28" name="radius" value="<?php echo esc_attr( (string) $settings['radius'] ); ?>" /> px</td></tr>
            <tr><th><?php esc_html_e( 'سایه کارت‌ها', 'wp-event-publisher' ); ?></th><td><label><input type="checkbox" name="shadow" value="1" <?php checked( ! empty( $settings['shadow'] ) ); ?> /> <?php esc_html_e( 'فعال', 'wp-event-publisher' ); ?></label></td></tr>
            <tr>
                <th><?php esc_html_e( 'دسته‌بندی در فرم ثبت تیکت', 'wp-event-publisher' ); ?></th>
                <td>
                    <label><input type="checkbox" name="show_category" value="1" <?php checked( ! empty( $settings['show_category'] ) ); ?> /> <?php esc_html_e( 'نمایش فیلد دسته‌بندی به کاربر', 'wp-event-publisher' ); ?></label>
                    <p class="description"><?php esc_html_e( 'پیش‌فرض خاموش است. اگر دسته‌بندی برای سایت لازم است آن را اینجا فعال کنید؛ طراح Elementor نیز می‌تواند برای هر المان جداگانه نمایش یا مخفی‌بودن آن را تعیین کند.', 'wp-event-publisher' ); ?></p>
                </td>
            </tr>
        </table>
        <p><button type="submit" class="button button-primary" name="jarchi_ticket_ui_save" value="1"><?php esc_html_e( 'ذخیره ظاهر تیکت‌ها', 'wp-event-publisher' ); ?></button></p>
    </form>
</div>

<?php
$hub_page_id = absint( get_option( WPEventPublisher\CustomerHub::OPTION_PAGE, 0 ) );
$hub_exists = $hub_page_id && 'trash' !== get_post_status( $hub_page_id );
?>
<div class="jarchi-ticket-ui-hub-card" style="margin-top:24px;padding:20px;border:1px solid #e5e7eb;border-radius:16px;background:#fff;max-width:900px">
    <h2 style="margin-top:0"><?php esc_html_e( 'صفحه اختیاری مرکز کاربری جارچی', 'wp-event-publisher' ); ?></h2>
    <p class="description"><?php esc_html_e( 'از نسخه 1.20.0 این صفحه خودکار ساخته نمی‌شود. فقط در صورت نیاز آن را بسازید و مشخص کنید اعلان، تیکت یا هر دو نمایش داده شوند.', 'wp-event-publisher' ); ?></p>
    <?php if ( ! empty( $hub_notice ) ) : ?><div class="notice notice-info inline"><p><?php echo esc_html( $hub_notice ); ?></p></div><?php endif; ?>
    <?php if ( $hub_exists ) : ?>
        <p><strong><?php esc_html_e( 'وضعیت:', 'wp-event-publisher' ); ?></strong> <?php esc_html_e( 'صفحه فعال است', 'wp-event-publisher' ); ?></p>
        <p><a class="button button-primary" href="<?php echo esc_url( get_permalink( $hub_page_id ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'مشاهده صفحه', 'wp-event-publisher' ); ?></a> <a class="button" href="<?php echo esc_url( admin_url( 'post.php?post=' . $hub_page_id . '&action=edit' ) ); ?>"><?php esc_html_e( 'ویرایش صفحه', 'wp-event-publisher' ); ?></a></p>
        <form method="post" onsubmit="return confirm('صفحه مرکز کاربری به زباله‌دان منتقل شود؟');">
            <?php wp_nonce_field( 'jarchi_customer_hub_page' ); ?>
            <button class="button button-link-delete" name="jarchi_customer_hub_remove" value="1"><?php esc_html_e( 'حذف صفحه مرکز کاربری', 'wp-event-publisher' ); ?></button>
        </form>
    <?php else : ?>
        <form method="post">
            <?php wp_nonce_field( 'jarchi_customer_hub_page' ); ?>
            <p><label><strong><?php esc_html_e( 'محتوای صفحه', 'wp-event-publisher' ); ?></strong><br><select name="hub_mode">
                <option value="both"><?php esc_html_e( 'اعلانات + تیکت‌ها', 'wp-event-publisher' ); ?></option>
                <option value="announcements"><?php esc_html_e( 'فقط اعلانات', 'wp-event-publisher' ); ?></option>
                <option value="tickets"><?php esc_html_e( 'فقط تیکت‌ها', 'wp-event-publisher' ); ?></option>
            </select></label></p>
            <p><label><input type="checkbox" name="hub_stats" value="1" checked> <?php esc_html_e( 'نمایش خلاصه آمار', 'wp-event-publisher' ); ?></label></p>
            <button class="button button-primary" name="jarchi_customer_hub_create" value="1"><?php esc_html_e( 'ساخت صفحه مرکز کاربری', 'wp-event-publisher' ); ?></button>
        </form>
    <?php endif; ?>
</div>
