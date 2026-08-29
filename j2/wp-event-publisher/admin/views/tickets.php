<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
$base = WPEventPublisher\Admin::app_url( 'support' );
?>
<div class="wrap wpep-wrap wpep-dashboard wpep-inner-page wpep-ticket-admin" dir="rtl">
	<div class="wpep-card"><div class="wpep-card__head"><div><h2 class="wpep-card__title"><?php esc_html_e( 'تیکت‌های کاربران', 'wp-event-publisher' ); ?></h2><p class="wpep-card__hint"><?php esc_html_e( 'پشتیبانی را سریع مدیریت کنید، پاسخ بدهید و وضعیت هر گفتگو را تغییر دهید.', 'wp-event-publisher' ); ?></p></div><div class="jarchi-ticket-admin-actions"><a class="wpep-primary-button jarchi-ticket-new-admin" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'ticket-new' ) ); ?>"><span class="dashicons dashicons-plus-alt2"></span><?php esc_html_e( 'تیکت جدید', 'wp-event-publisher' ); ?></a><a class="button" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'ticket-sms' ) ); ?>"><span class="dashicons dashicons-smartphone"></span><?php esc_html_e( 'تنظیمات پیامک', 'wp-event-publisher' ); ?></a><a class="wpep-primary-button" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'ticket-departments' ) ); ?>"><?php esc_html_e( 'مدیریت دپارتمان‌ها', 'wp-event-publisher' ); ?></a><a class="button" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'ticket-bot' ) ); ?>"><?php esc_html_e( 'پاسخ‌گویی ربات', 'wp-event-publisher' ); ?></a></div></div></div>

	<div class="jarchi-admin-ticket-statusbar" role="navigation" aria-label="وضعیت تیکت‌ها">
		<?php $wpep_status_chips = array(
			'all' => array( 'label' => 'همه', 'icon' => 'list-view', 'class' => 'all' ),
			'waiting' => array( 'label' => 'در انتظار پاسخ', 'icon' => 'clock', 'class' => 'waiting' ),
			'reviewing' => array( 'label' => 'در حال بررسی', 'icon' => 'search', 'class' => 'reviewing' ),
			'answered' => array( 'label' => 'پاسخ داده شده', 'icon' => 'yes-alt', 'class' => 'answered' ),
			'closed' => array( 'label' => 'بسته شده', 'icon' => 'lock', 'class' => 'closed' ),
		); ?>
		<?php foreach ( $wpep_status_chips as $wpep_key => $wpep_chip ) : $wpep_href = add_query_arg( array( 'status' => 'all' === $wpep_key ? '' : $wpep_key ), WPEventPublisher\Admin::app_url( 'support' ) ); ?>
			<a class="jarchi-admin-ticket-statuschip jarchi-admin-ticket-statuschip--<?php echo esc_attr( $wpep_chip['class'] ); ?><?php echo ( ( '' === $status && 'all' === $wpep_key ) || $status === $wpep_key ) ? ' is-active' : ''; ?>" href="<?php echo esc_url( $wpep_href ); ?>" aria-current="<?php echo ( ( '' === $status && 'all' === $wpep_key ) || $status === $wpep_key ) ? 'page' : 'false'; ?>"><span class="dashicons dashicons-<?php echo esc_attr( $wpep_chip['icon'] ); ?>"></span><span><?php echo esc_html( $wpep_chip['label'] ); ?></span><b><?php echo esc_html( number_format_i18n( (int) ( $status_counts[ $wpep_key ] ?? 0 ) ) ); ?></b></a>
		<?php endforeach; ?>
	</div>
	<div class="wpep-card">
		<form method="get" style="display:grid;grid-template-columns:1.3fr repeat(3,minmax(0,1fr)) auto;gap:10px;align-items:end">
			<input type="hidden" name="page" value="<?php echo esc_attr( WPEventPublisher\Admin::MENU_SLUG ); ?>" />
			<input type="hidden" name="jarchi_view" value="support" />
			<label class="wpep-field"><span><?php esc_html_e( 'جستجو (عنوان یا شماره)', 'wp-event-publisher' ); ?></span><input type="search" name="s" value="<?php echo esc_attr( $search ); ?>" placeholder="مثلاً 125 یا خطای پرداخت"></label>
			<label class="wpep-field"><span><?php esc_html_e( 'دپارتمان', 'wp-event-publisher' ); ?></span><select name="department"><option value="0"><?php esc_html_e( 'همه دپارتمان‌ها', 'wp-event-publisher' ); ?></option><?php foreach ( $departments as $department ) : ?><option value="<?php echo esc_attr( (string) $department->term_id ); ?>" <?php selected( $dept, $department->term_id ); ?>><?php echo esc_html( $department->name ); ?></option><?php endforeach; ?></select></label><label class="wpep-field"><span><?php esc_html_e( 'دسته‌بندی', 'wp-event-publisher' ); ?></span><select name="category"><option value="0"><?php esc_html_e( 'همه دسته‌ها', 'wp-event-publisher' ); ?></option><?php foreach ( $categories as $category_item ) : ?><option value="<?php echo esc_attr( (string) $category_item->term_id ); ?>" <?php selected( $category, $category_item->term_id ); ?>><?php echo esc_html( $category_item->name ); ?></option><?php endforeach; ?></select></label>
			<button class="button button-primary" type="submit"><?php esc_html_e( 'فیلتر', 'wp-event-publisher' ); ?></button>
		</form>
	</div>
	<div class="wpep-ticket-list">
	<?php if ( ! $query->have_posts() ) : ?>
		<div class="wpep-card"><div class="wpep-empty"><span class="dashicons dashicons-sos"></span><strong><?php esc_html_e( 'تیکتی پیدا نشد', 'wp-event-publisher' ); ?></strong><span><?php esc_html_e( 'به محض ثبت اولین تیکت، گفتگوهای کاربران اینجا نمایش داده می‌شود.', 'wp-event-publisher' ); ?></span></div></div>
	<?php else : while ( $query->have_posts() ) : $query->the_post(); $ticket_id = get_the_ID(); $author = get_user_by( 'id', (int) get_post_field( 'post_author', $ticket_id ) ); $unread = (bool) get_post_meta( $ticket_id, '_jarchi_ticket_admin_unread', true ); $status_label = wpep()->tickets()->status_label( wpep()->tickets()->status( $ticket_id ) ); ?>
		<a class="wpep-ticket-row<?php echo $unread ? ' has-unread' : ''; ?>" href="<?php echo esc_url( add_query_arg( 'ticket', $ticket_id, $base ) ); ?>">
			<span><strong><?php echo esc_html( get_the_title() ); ?></strong><small><?php echo esc_html( $author ? $author->display_name : __( 'کاربر حذف شده', 'wp-event-publisher' ) ); ?> · <?php echo esc_html( get_the_modified_date( '', $ticket_id ) ); ?> · <?php echo esc_html( human_time_diff( get_post_timestamp( $ticket_id ), current_time( 'timestamp' ) ) . ' پیش' ); ?></small></span>
			<span class="wpep-pill wpep-pill--<?php echo 'closed' === wpep()->tickets()->status( $ticket_id ) ? 'muted' : ( 'reviewing' === wpep()->tickets()->status( $ticket_id ) ? 'warning' : ( 'waiting' === wpep()->tickets()->status( $ticket_id ) ? 'danger' : 'success' ) ); ?>"><?php echo esc_html( $status_label ); ?></span>
			<?php if ( $unread ) : ?><span class="jarchi-ticket-dot">1</span><?php endif; ?>
		</a>
	<?php endwhile; wp_reset_postdata(); endif; ?>
	</div>
</div>
