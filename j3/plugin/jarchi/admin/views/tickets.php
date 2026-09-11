<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
$base = WPEventPublisher\Admin::app_url( 'support' );
$advanced = wpep()->tickets()->advanced_settings();
$priority_defs = (array) ( $advanced['priorities'] ?? array() );
?>
<div class="wrap wpep-wrap wpep-dashboard wpep-inner-page wpep-ticket-admin jarchi-ticket-admin-v120" dir="rtl">
	<div class="jarchi-admin-ticket-toolbar">
		<div>
			<h1><?php esc_html_e( 'مدیریت تیکت‌ها', 'wp-event-publisher' ); ?></h1>
			<p><?php esc_html_e( 'تیکت‌ها را مثل یک صندوق پشتیبانی مرتب، جستجو و پاسخ دهید.', 'wp-event-publisher' ); ?></p>
		</div>
		<div class="jarchi-ticket-admin-actions">
			<a class="wpep-primary-button" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'ticket-new' ) ); ?>"><span class="dashicons dashicons-plus-alt2"></span><?php esc_html_e( 'تیکت جدید', 'wp-event-publisher' ); ?></a>
			<a class="button" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'ticket-departments' ) ); ?>"><?php esc_html_e( 'دپارتمان‌ها', 'wp-event-publisher' ); ?></a>
		</div>
	</div>

	<div class="jarchi-admin-ticket-statusbar" role="navigation" aria-label="<?php esc_attr_e( 'وضعیت تیکت‌ها', 'wp-event-publisher' ); ?>">
		<?php
		$wpep_status_chips = array(
			'all'       => array( 'label' => 'همه', 'icon' => 'tickets-alt', 'class' => 'all' ),
			'waiting'   => array( 'label' => 'جدید', 'icon' => 'warning', 'class' => 'waiting' ),
			'reviewing' => array( 'label' => 'در حال بررسی', 'icon' => 'search', 'class' => 'reviewing' ),
			'answered'  => array( 'label' => 'پاسخ داده شده', 'icon' => 'yes-alt', 'class' => 'answered' ),
			'closed'    => array( 'label' => 'بسته', 'icon' => 'lock', 'class' => 'closed' ),
		);
		?>
		<?php foreach ( $wpep_status_chips as $wpep_key => $wpep_chip ) :
			$wpep_href = add_query_arg( array( 'status' => 'all' === $wpep_key ? '' : $wpep_key ), WPEventPublisher\Admin::app_url( 'support' ) );
			$active = ( '' === $status && 'all' === $wpep_key ) || $status === $wpep_key;
		?>
			<a class="jarchi-admin-ticket-statuschip jarchi-admin-ticket-statuschip--<?php echo esc_attr( $wpep_chip['class'] ); ?><?php echo $active ? ' is-active' : ''; ?>" href="<?php echo esc_url( $wpep_href ); ?>" aria-current="<?php echo $active ? 'page' : 'false'; ?>">
				<span class="dashicons dashicons-<?php echo esc_attr( $wpep_chip['icon'] ); ?>"></span><span><?php echo esc_html( $wpep_chip['label'] ); ?></span><b><?php echo esc_html( number_format_i18n( (int) ( $status_counts[ $wpep_key ] ?? 0 ) ) ); ?></b>
			</a>
		<?php endforeach; ?>
	</div>

	<div class="wpep-card jarchi-admin-ticket-filters-card">
		<form method="get" class="jarchi-admin-ticket-filters">
			<input type="hidden" name="page" value="<?php echo esc_attr( WPEventPublisher\Admin::MENU_SLUG ); ?>" />
			<input type="hidden" name="jarchi_view" value="support" />
			<label class="wpep-field jarchi-admin-ticket-search"><span><?php esc_html_e( 'جستجو', 'wp-event-publisher' ); ?></span><input type="search" name="s" value="<?php echo esc_attr( $search ); ?>" placeholder="<?php esc_attr_e( 'شماره، موضوع، متن، نام، ایمیل یا موبایل…', 'wp-event-publisher' ); ?>"></label>
			<label class="wpep-field"><span><?php esc_html_e( 'دپارتمان', 'wp-event-publisher' ); ?></span><select name="department"><option value="0"><?php esc_html_e( 'همه دپارتمان‌ها', 'wp-event-publisher' ); ?></option><?php foreach ( $departments as $department ) : ?><option value="<?php echo esc_attr( (string) $department->term_id ); ?>" <?php selected( $dept, $department->term_id ); ?>><?php echo esc_html( $department->name ); ?></option><?php endforeach; ?></select></label>
			<label class="wpep-field"><span><?php esc_html_e( 'دسته‌بندی', 'wp-event-publisher' ); ?></span><select name="category"><option value="0"><?php esc_html_e( 'همه دسته‌ها', 'wp-event-publisher' ); ?></option><?php foreach ( $categories as $category_item ) : ?><option value="<?php echo esc_attr( (string) $category_item->term_id ); ?>" <?php selected( $category, $category_item->term_id ); ?>><?php echo esc_html( $category_item->name ); ?></option><?php endforeach; ?></select></label>
			<button class="button button-primary" type="submit"><?php esc_html_e( 'فیلتر', 'wp-event-publisher' ); ?></button>
		</form>
	</div>

	<div class="jarchi-admin-ticket-table-card">
	<?php if ( ! $query->have_posts() ) : ?>
		<div class="wpep-empty"><span class="dashicons dashicons-sos"></span><strong><?php esc_html_e( 'تیکتی پیدا نشد', 'wp-event-publisher' ); ?></strong><span><?php esc_html_e( 'با تغییر فیلترها دوباره جستجو کنید.', 'wp-event-publisher' ); ?></span></div>
	<?php else : ?>
		<div class="jarchi-admin-ticket-table-wrap">
			<table class="jarchi-admin-ticket-table">
				<thead><tr>
					<th><?php esc_html_e( 'ID', 'wp-event-publisher' ); ?></th>
					<th><?php esc_html_e( 'موضوع', 'wp-event-publisher' ); ?></th>
					<th><?php esc_html_e( 'فرستنده', 'wp-event-publisher' ); ?></th>
					<th><?php esc_html_e( 'گیرنده', 'wp-event-publisher' ); ?></th>
					<th><?php esc_html_e( 'دپارتمان', 'wp-event-publisher' ); ?></th>
					<th><?php esc_html_e( 'اولویت', 'wp-event-publisher' ); ?></th>
					<th><?php esc_html_e( 'وضعیت', 'wp-event-publisher' ); ?></th>
					<th><?php esc_html_e( 'تاریخ ایجاد', 'wp-event-publisher' ); ?></th>
				</tr></thead>
				<tbody>
				<?php while ( $query->have_posts() ) : $query->the_post();
					$ticket_id = get_the_ID();
					$parties = wpep()->tickets()->admin_ticket_parties( $ticket_id );
					$unread = (bool) get_post_meta( $ticket_id, '_jarchi_ticket_admin_unread', true );
					$state = wpep()->tickets()->status( $ticket_id );
					$priority = sanitize_key( (string) get_post_meta( $ticket_id, '_jarchi_ticket_priority', true ) ) ?: 'normal';
					$priority_label = (string) ( $priority_defs[ $priority ]['label'] ?? $priority );
					$department_terms = wp_get_post_terms( $ticket_id, WPEventPublisher\Tickets::TAXONOMY );
					$department_name = ! is_wp_error( $department_terms ) && ! empty( $department_terms ) ? $department_terms[0]->name : '—';
					$href = add_query_arg( 'ticket', $ticket_id, $base );
				?>
				<tr class="<?php echo $unread ? 'has-unread' : ''; ?>">
					<td data-label="ID"><a class="jarchi-admin-ticket-id" href="<?php echo esc_url( $href ); ?>">#<?php echo esc_html( (string) $ticket_id ); ?></a></td>
					<td data-label="<?php esc_attr_e( 'موضوع', 'wp-event-publisher' ); ?>"><a class="jarchi-admin-ticket-subject" href="<?php echo esc_url( $href ); ?>"><?php echo esc_html( get_the_title() ); ?><?php if ( $unread ) : ?><i aria-label="<?php esc_attr_e( 'پیام جدید', 'wp-event-publisher' ); ?>"></i><?php endif; ?></a></td>
					<td data-label="<?php esc_attr_e( 'فرستنده', 'wp-event-publisher' ); ?>"><span class="jarchi-admin-party jarchi-admin-party--<?php echo esc_attr( (string) $parties['direction'] ); ?>"><?php echo esc_html( (string) $parties['sender'] ); ?></span></td>
					<td data-label="<?php esc_attr_e( 'گیرنده', 'wp-event-publisher' ); ?>"><span class="jarchi-admin-party"><?php echo esc_html( (string) $parties['receiver'] ); ?></span></td>
					<td data-label="<?php esc_attr_e( 'دپارتمان', 'wp-event-publisher' ); ?>"><?php echo esc_html( $department_name ); ?></td>
					<td data-label="<?php esc_attr_e( 'اولویت', 'wp-event-publisher' ); ?>"><span class="jarchi-admin-priority jarchi-admin-priority--<?php echo esc_attr( $priority ); ?>"><?php echo esc_html( $priority_label ); ?></span></td>
					<td data-label="<?php esc_attr_e( 'وضعیت', 'wp-event-publisher' ); ?>"><span class="jarchi-admin-ticket-state jarchi-admin-ticket-state--<?php echo esc_attr( $state ); ?>"><?php echo esc_html( wpep()->tickets()->status_label( $state ) ); ?></span></td>
					<td data-label="<?php esc_attr_e( 'تاریخ ایجاد', 'wp-event-publisher' ); ?>"><time datetime="<?php echo esc_attr( get_post_time( 'c', true, $ticket_id ) ); ?>"><?php echo esc_html( get_the_date( '', $ticket_id ) ); ?></time></td>
				</tr>
				<?php endwhile; wp_reset_postdata(); ?>
				</tbody>
			</table>
		</div>
		<?php if ( $query->max_num_pages > 1 ) : ?>
			<div class="jarchi-admin-ticket-pagination">
				<?php
				/*
				 * Do not delegate these links to paginate_links(). Jarchi is a
				 * single-page admin app and `page` is already WordPress' screen
				 * selector. On some admin URLs paginate_links() rebuilt the query
				 * from the current request and silently dropped `jarchi_view`, so
				 * page 2 opened the Jarchi dashboard instead of the support inbox.
				 * Every target is now built from Admin::app_url('support') directly.
				 */
				$current_page = max( 1, absint( $_GET['paged'] ?? 1 ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				$total_pages  = max( 1, (int) $query->max_num_pages );
				$pager_args   = array();
				if ( '' !== $status ) { $pager_args['status'] = $status; }
				if ( $dept > 0 ) { $pager_args['department'] = $dept; }
				if ( $category > 0 ) { $pager_args['category'] = $category; }
				if ( '' !== trim( $search ) ) { $pager_args['s'] = $search; }

				$ticket_page_url = static function ( int $page_number ) use ( $pager_args ): string {
					$args = $pager_args;
					if ( $page_number > 1 ) {
						$args['paged'] = $page_number;
					}
					return WPEventPublisher\Admin::app_url( 'support', $args );
				};

				$pages = array();
				for ( $i = 1; $i <= $total_pages; ++$i ) {
					if ( $total_pages <= 9 || $i <= 2 || $i > $total_pages - 2 || abs( $i - $current_page ) <= 2 ) {
						$pages[] = $i;
					}
				}
				?>
				<ul class="page-numbers">
					<?php if ( $current_page > 1 ) : ?>
						<li><a class="prev page-numbers" href="<?php echo esc_url( $ticket_page_url( $current_page - 1 ) ); ?>" aria-label="<?php esc_attr_e( 'صفحه قبل', 'wp-event-publisher' ); ?>">‹</a></li>
					<?php endif; ?>
					<?php $previous = 0; foreach ( $pages as $page_number ) : ?>
						<?php if ( $previous && $page_number > $previous + 1 ) : ?><li><span class="page-numbers dots">…</span></li><?php endif; ?>
						<li>
							<?php if ( $page_number === $current_page ) : ?>
								<span class="page-numbers current" aria-current="page"><?php echo esc_html( (string) $page_number ); ?></span>
							<?php else : ?>
								<a class="page-numbers" href="<?php echo esc_url( $ticket_page_url( $page_number ) ); ?>"><?php echo esc_html( (string) $page_number ); ?></a>
							<?php endif; ?>
						</li>
						<?php $previous = $page_number; ?>
					<?php endforeach; ?>
					<?php if ( $current_page < $total_pages ) : ?>
						<li><a class="next page-numbers" href="<?php echo esc_url( $ticket_page_url( $current_page + 1 ) ); ?>" aria-label="<?php esc_attr_e( 'صفحه بعد', 'wp-event-publisher' ); ?>">›</a></li>
					<?php endif; ?>
				</ul>
			</div>
		<?php endif; ?>
	<?php endif; ?>
	</div>
</div>
