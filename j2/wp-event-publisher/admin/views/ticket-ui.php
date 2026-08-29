<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
$page_id = absint( get_option( '_wpep_ticket_page_id', 0 ) );
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
    <p class="description"><?php esc_html_e( 'رنگ‌های پیش‌فرض مرکز تیکت را تنظیم کنید. این مقادیر روی صفحه عمومی تیکت اعمال می‌شوند و در Elementor نیز قابل شخصی‌سازی هستند.', 'wp-event-publisher' ); ?></p>
    <?php if ( class_exists( 'Elementor\Plugin' ) && ! empty( $page_id ) ) : ?>
        <p><a class="button" href="<?php echo esc_url( admin_url( 'post.php?post=' . absint( $page_id ) . '&action=elementor' ) ); ?>"><?php esc_html_e( 'ویرایش مرکز تیکت با Elementor', 'wp-event-publisher' ); ?></a></p>
    <?php endif; ?>
    <form method="post">
        <?php wp_nonce_field( 'jarchi_ticket_ui_save' ); ?>
        <table class="form-table" role="presentation">
        <?php foreach ( $fields as $key => $field ) : ?>
            <tr><th><label for="jarchi-ticket-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $field[0] ); ?></label></th><td><input type="color" id="jarchi-ticket-<?php echo esc_attr( $key ); ?>" name="<?php echo esc_attr( $key ); ?>" value="<?php echo esc_attr( $field[1] ); ?>" /></td></tr>
        <?php endforeach; ?>
            <tr><th><?php esc_html_e( 'گوشه کارت‌ها', 'wp-event-publisher' ); ?></th><td><input type="number" min="10" max="28" name="radius" value="<?php echo esc_attr( (string) $settings['radius'] ); ?>" /> px</td></tr>
            <tr><th><?php esc_html_e( 'سایه کارت‌ها', 'wp-event-publisher' ); ?></th><td><label><input type="checkbox" name="shadow" value="1" <?php checked( ! empty( $settings['shadow'] ) ); ?> /> <?php esc_html_e( 'فعال', 'wp-event-publisher' ); ?></label></td></tr>
        </table>
        <p><button type="submit" class="button button-primary" name="jarchi_ticket_ui_save" value="1"><?php esc_html_e( 'ذخیره ظاهر تیکت‌ها', 'wp-event-publisher' ); ?></button></p>
    </form>
</div>
