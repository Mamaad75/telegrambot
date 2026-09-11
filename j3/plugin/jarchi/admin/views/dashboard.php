<?php
/**
 * Jarchi premium dashboard.
 *
 * @package WPEventPublisher
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$stats        = wp_parse_args( (array) $stats, array( 'total' => 0, 'success' => 0, 'failed' => 0, 'pending' => 0, 'today' => 0 ) );
$queue        = (int) ( $queue ?? 0 );
$trend        = (array) ( $trend ?? array() );
$destinations = (array) ( $destinations ?? array() );
$recent       = (array) ( $recent ?? array() );
$settings     = (array) ( $settings ?? array() );
$user         = wp_get_current_user();
$settings_url = WPEventPublisher\Admin::app_url( 'settings' );
$logs_url     = WPEventPublisher\Admin::app_url( 'logs' );
$dest_url     = WPEventPublisher\Admin::app_url( 'destinations' );
$rules_url    = WPEventPublisher\Admin::app_url( 'rules' );
$tools_url    = WPEventPublisher\Admin::app_url( 'tools' );

$provider_labels = array(
	'telegram' => 'تلگرام',
	'webhook'  => 'Webhook',
	'discord'  => 'Discord',
	'slack'    => 'Slack',
	'email'    => 'ایمیل',
);
$enabled_destinations = array_values( array_filter( $destinations, static fn( $d ) => ! empty( $d['enabled'] ) ) );
$active_provider_names = array_map( static fn( $d ) => (string) ( $provider_labels[ $d['provider'] ] ?? $d['provider'] ), $enabled_destinations );
$rules_count = is_object( wpep()->rules() ) ? count( wpep()->rules()->all() ) : 0;
// Weekday labels now travel with each data point (Admin::weekly_trend()),
// so a label can never be paired with another day's numbers.
$max_bar    = 1;
foreach ( $trend as $point ) {
	$max_bar = max( $max_bar, (int) ( $point['success'] ?? 0 ), (int) ( $point['failed'] ?? 0 ) );
}
?>
<div class="wrap wpep-wrap wpep-dashboard">
	<main class="wpep-dashboard-main">
			<section class="wpep-hero">
				<div>
					<div class="wpep-kicker">jarchi published by bymer</div>
					<h1>سلام <?php echo esc_html( $user->display_name ?: 'مدیر' ); ?>، جارچی آماده انتشار است <span>👋</span></h1>
					<p>همه‌چیز برای انتقال خودکار محتوا آماده است. وضعیت انتشار، مقصدها و صف را از همین‌جا کنترل کنید.</p>
				</div>
				<div class="wpep-hero-status <?php echo ! empty( $settings['enabled'] ) ? 'is-on' : 'is-off'; ?>">
					<span class="dot"></span>
					<?php echo ! empty( $settings['enabled'] ) ? 'جارچی فعال است' : 'جارچی غیرفعال است'; ?>
				</div>
			</section>

			<section class="jarchi-overview-grid">
				<div class="jarchi-overview-card jarchi-overview-card--primary">
					<div class="jarchi-overview-card__icon"><span class="dashicons dashicons-megaphone"></span></div>
					<div><strong>وضعیت جارچی</strong><span><?php echo ! empty( $settings['enabled'] ) ? 'سیستم فعال و آماده پردازش است' : 'سیستم فعلاً غیرفعال است'; ?></span></div>
					<b class="jarchi-overview-badge <?php echo ! empty( $settings['enabled'] ) ? 'is-on' : 'is-off'; ?>"><?php echo ! empty( $settings['enabled'] ) ? 'فعال' : 'خاموش'; ?></b>
				</div>
				<div class="jarchi-overview-card">
					<div class="jarchi-overview-card__icon"><span class="dashicons dashicons-share"></span></div>
					<div><strong>اتصال‌های فعال</strong><span><?php echo esc_html( $active_provider_names ? implode( '، ', $active_provider_names ) : 'هنوز مقصد فعالی تنظیم نشده است' ); ?></span></div>
					<b><?php echo esc_html( number_format_i18n( count( $enabled_destinations ) ) ); ?></b>
				</div>
				<div class="jarchi-overview-card">
					<div class="jarchi-overview-card__icon"><span class="dashicons dashicons-randomize"></span></div>
					<div><strong>خودکارسازی</strong><span><?php echo $rules_count > 0 ? 'قوانین انتشار در حال اجرا هستند' : 'هنوز قانونی برای خودکارسازی تعریف نشده است'; ?></span></div>
					<b><?php echo esc_html( number_format_i18n( $rules_count ) ); ?></b>
				</div>
				<div class="jarchi-overview-card">
					<div class="jarchi-overview-card__icon"><span class="dashicons dashicons-update"></span></div>
					<div><strong>صف انتشار</strong><span><?php echo $queue > 0 ? 'رویدادهایی منتظر ارسال هستند' : 'صف انتشار کاملاً خالی است'; ?></span></div>
					<b><?php echo esc_html( number_format_i18n( $queue ) ); ?></b>
				</div>
			</section>

			<section class="wpep-stat-grid">
				<div class="wpep-stat-card accent"><span class="stat-icon">✓</span><strong><?php echo esc_html( number_format_i18n( $stats['success'] ) ); ?></strong><span>انتقال موفق</span><small>کل انتقال‌های موفق</small></div>
				<div class="wpep-stat-card"><span class="stat-icon">↗</span><strong><?php echo esc_html( number_format_i18n( $stats['total'] ) ); ?></strong><span>کل رویدادها</span><small>ثبت‌شده در جارچی</small></div>
				<div class="wpep-stat-card"><span class="stat-icon orange">⚡</span><strong><?php echo esc_html( number_format_i18n( $stats['today'] ) ); ?></strong><span>انتقال امروز</span><small>فعالیت ۲۴ ساعت اخیر</small></div>
				<div class="wpep-stat-card"><span class="stat-icon red">!</span><strong><?php echo esc_html( number_format_i18n( $stats['failed'] ) ); ?></strong><span>ناموفق</span><small>نیازمند بررسی</small></div>
				<div class="wpep-stat-card"><span class="stat-icon yellow">…</span><strong><?php echo esc_html( number_format_i18n( $stats['pending'] ) ); ?></strong><span>در انتظار</span><small>در حال پردازش</small></div>
				<div class="wpep-stat-card"><span class="stat-icon dark">▤</span><strong><?php echo esc_html( number_format_i18n( count( $destinations ) ) ); ?></strong><span>مقصد فعال</span><small>کانال‌های متصل</small></div>
			</section>

			<section class="wpep-main-row">
				<div class="wpep-panel wpep-chart-panel">
					<div class="wpep-panel-head"><div><h2>انتقال‌های موفق و ناموفق <em>(۷ روز اخیر)</em></h2><span>روند فعالیت انتشار در جارچی</span></div><a href="<?php echo esc_url( $logs_url ); ?>">مشاهده گزارش ←</a></div>
					<div class="wpep-chart">
						<?php foreach ( $trend as $day => $point ) : ?>
							<div class="wpep-chart-col<?php echo ! empty( $point['is_today'] ) ? ' is-today' : ''; ?><?php echo ! empty( $point['future'] ) ? ' is-future' : ''; ?>">
								<div class="wpep-bars" title="<?php echo esc_attr( $point['label'] . ' — ' . $day ); ?>">
									<div class="bar success" style="height: <?php echo esc_attr( max( 4, round( ( (int) $point['success'] / $max_bar ) * 100 ) ) ); ?>%"><b><?php echo esc_html( $point['success'] ); ?></b></div>
									<div class="bar failed" style="height: <?php echo esc_attr( max( 4, round( ( (int) $point['failed'] / $max_bar ) * 100 ) ) ); ?>%"><b><?php echo esc_html( $point['failed'] ); ?></b></div>
								</div>
								<span><?php echo esc_html( $point['label'] ); ?></span>
							</div>
						<?php endforeach; ?>
					</div>
					<div class="wpep-chart-legend"><span><i class="success"></i> موفق</span><span><i class="failed"></i> ناموفق</span></div>
				</div>

				<div class="wpep-panel wpep-destination-panel">
					<div class="wpep-panel-head"><div><h2>وضعیت مقصدها</h2><span>اتصال سرویس‌های انتشار</span></div><a href="<?php echo esc_url( $dest_url ); ?>">مدیریت مقصدها</a></div>
					<div class="wpep-destination-list">
						<?php if ( empty( $destinations ) ) : ?><div class="wpep-empty">هنوز مقصدی تعریف نشده است.</div><?php else : ?>
							<?php foreach ( $destinations as $destination ) : ?>
								<div class="wpep-destination-item"><span class="dest-icon">↗</span><div><strong><?php echo esc_html( $destination['name'] ); ?></strong><small><?php echo esc_html( $provider_labels[ $destination['provider'] ] ?? $destination['provider'] ); ?></small></div><span class="wpep-status-dot <?php echo $destination['enabled'] ? 'on' : 'off'; ?>"></span><em><?php echo $destination['enabled'] ? 'متصل' : 'غیرفعال'; ?></em></div>
							<?php endforeach; ?>
						<?php endif; ?>
					</div>
				</div>
			</section>

			<section class="wpep-main-row lower">
				<div class="wpep-panel wpep-activity-panel">
					<div class="wpep-panel-head"><div><h2>فعالیت‌های اخیر</h2><span>آخرین رویدادهای ثبت‌شده در جارچی</span></div><a href="<?php echo esc_url( $logs_url ); ?>">مشاهده همه ←</a></div>
					<div class="wpep-activity-list" id="wpep-activity-list">
						<?php if ( empty( $recent ) ) : ?><div class="wpep-empty">هنوز فعالیتی ثبت نشده است.</div><?php else : ?>
						<?php foreach ( $recent as $row ) :
							$status = (string) $row->status;
							$status_label = array( 'success' => 'موفق', 'failed' => 'ناموفق', 'pending' => 'در انتظار', 'retry' => 'تلاش مجدد', 'skipped' => 'رد شده' )[ $status ] ?? $status;
							$title = $row->post_id > 0 ? ( get_the_title( (int) $row->post_id ) ?: 'محتوا #' . $row->post_id ) : 'رویداد سیستمی';
						?>
							<div class="wpep-activity-item"><span class="activity-icon <?php echo esc_attr( $status ); ?>"><?php echo $status === 'success' ? '✓' : ( $status === 'failed' ? '!' : '↻' ); ?></span><div class="activity-copy"><strong><?php echo esc_html( $title ); ?></strong><small><?php echo esc_html( $row->event_type ?: 'انتشار محتوا' ); ?> · <?php echo esc_html( $row->created_at ); ?></small></div><span class="wpep-mini-badge <?php echo esc_attr( $status ); ?>"><?php echo esc_html( $status_label ); ?></span></div>
						<?php endforeach; ?>
						<?php endif; ?>
					</div>
				</div>

				<div class="wpep-panel wpep-queue-panel">
					<div class="wpep-panel-head"><div><h2>صف انتشار</h2><span>رویدادهای منتظر ارسال</span></div><span class="wpep-queue-count"><?php echo esc_html( number_format_i18n( $queue ) ); ?></span></div>
					<div class="wpep-queue-empty"><div class="queue-ring">✓</div><strong><?php echo $queue > 0 ? 'رویداد در صف انتشار دارید' : 'صف انتشار خالی است'; ?></strong><p><?php echo $queue > 0 ? 'می‌توانید صف را از بخش انتقال محتوا پردازش کنید.' : 'همه رویدادها پردازش شده‌اند و چیزی در انتظار نیست.'; ?></p><?php if ( $queue > 0 ) : ?><a class="wpep-primary-button" href="<?php echo esc_url( $tools_url ); ?>">پردازش صف</a><?php endif; ?></div>
				</div>
			</section>

			<section class="wpep-quick-actions">
				<a href="<?php echo esc_url( $tools_url ); ?>"><span>↗</span><div><strong>انتقال محتوا</strong><small>ارسال دستی یک محتوا</small></div></a>
				<a href="<?php echo esc_url( $dest_url ); ?>"><span>♧</span><div><strong>مدیریت مقصدها</strong><small>کانال‌ها و سرویس‌های انتشار</small></div></a>
				<a href="<?php echo esc_url( $rules_url ); ?>"><span>☷</span><div><strong>قوانین انتشار</strong><small>شرایط و مسیرهای انتشار</small></div></a>
				<a href="<?php echo esc_url( $settings_url ); ?>"><span>⚙</span><div><strong>تنظیمات جارچی</strong><small>اتصال و پیکربندی سیستم</small></div></a>
			</section>

			<footer class="wpep-dashboard-footer"><span><b>JARCHI</b> · jarchi published by bymer</span><span>نسخه <?php echo esc_html( WPEP_VERSION ); ?></span></footer>
	</main>
</div>
