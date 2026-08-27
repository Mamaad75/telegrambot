<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
<div class="wrap wpep-wrap wpep-dashboard wpep-inner-page">
  <div class="wpep-card"><div class="wpep-card__head"><div><h2 class="wpep-card__title">پاسخ‌گویی ربات تیکت</h2><p class="wpep-card__hint">انتخاب کنید پاسخ‌گویی تیکت از طریق کدام ربات‌های جارچی فعال باشد.</p></div></div>
  <form method="post" action="<?php echo esc_url( admin_url('admin-post.php') ); ?>">
    <input type="hidden" name="action" value="wpep_ticket_bot_settings">
    <?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>
    <label class="wpep-switch"><input type="checkbox" name="enabled" value="1" <?php checked(!empty($settings['enabled'])); ?>><span class="wpep-switch__track"></span><span class="wpep-switch__label">پاسخ‌گویی ربات فعال باشد</span></label>
    <div class="wpep-grid-2" style="margin-top:22px">
      <label class="wpep-option-card"><input type="checkbox" name="platforms[]" value="telegram" <?php checked(in_array('telegram',(array)$settings['platforms'],true)); ?>><strong>تلگرام</strong><span>پاسخ به تیکت از ربات تلگرام جارچی</span><a href="<?php echo esc_url(admin_url('admin.php?page='.WPEventPublisher\Admin::MENU_SLUG.'-telegram')); ?>">تنظیمات تلگرام</a></label>
      <label class="wpep-option-card"><input type="checkbox" name="platforms[]" value="bale" <?php checked(in_array('bale',(array)$settings['platforms'],true)); ?>><strong>بله</strong><span>پاسخ به تیکت از ربات بله جارچی</span><a href="<?php echo esc_url(admin_url('admin.php?page='.WPEventPublisher\Admin::MENU_SLUG.'-bale')); ?>">تنظیمات بله</a></label>
    </div>
    <div class="wpep-plan-banner"><strong>قابلیت‌های رباتی جارچی وابسته به پلن سرویس شماست.</strong><span>پس از فعال‌سازی پلن، Backend جارچی با همین Webhook و API Secret به سایت متصل می‌شود.</span></div>
    <p><button class="button button-primary" type="submit">ذخیره تنظیمات تیکت</button> <a class="button" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'ticket-ui' ) ); ?>">تنظیمات ظاهری تیکت</a></p>
  </form></div>
</div>
