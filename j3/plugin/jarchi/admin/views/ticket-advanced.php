<?php if ( ! defined('ABSPATH') ) exit; ?>
<div class="wrap wpep-wrap wpep-inner-page" dir="rtl">
  <div class="wpep-card"><div class="wpep-card__head"><div><h2 class="wpep-card__title">پیشرفته تیکت</h2><p class="wpep-card__hint">پاسخ‌گویی Mini App، SLA، فیلدهای سفارشی و آپلود صدا را از یکجا مدیریت کنید. سوالات متداول از بخش مستقل FAQ مدیریت می‌شوند.</p></div></div></div>
  <form method="post" class="wpep-card" style="padding:24px">
    <?php wp_nonce_field('jarchi_ticket_advanced_save'); ?>
    <input type="hidden" name="jarchi_ticket_advanced_save" value="1">
    <section id="jarchi-remote-ticketing" class="wpep-card" style="padding:18px;margin:0 0 18px;background:var(--jarchi-surface-2,#f8fafc)">
      <div class="wpep-card__head" style="padding:0 0 12px">
        <div>
          <h3 class="wpep-card__title" style="margin:0">پاسخ‌گویی تیکت در ربات و Mini App</h3>
          <p class="wpep-card__hint">دسترسی پاسخ‌گویی از راه دور را همین‌جا مدیریت کنید. گزینهٔ جداگانهٔ «تنظیمات تیکت» از منو حذف شده است.</p>
        </div>
      </div>
      <label class="wpep-switch">
        <input type="checkbox" name="ticket_bot_enabled" value="1" <?php checked( ! empty( $bot_settings['enabled'] ) ); ?>>
        <span class="wpep-switch__track"></span>
        <span class="wpep-switch__label">پاسخ‌گویی تیکت از ربات و Mini App فعال باشد</span>
      </label>
      <div class="wpep-grid-2" style="margin-top:14px">
        <label class="wpep-option-card">
          <input type="checkbox" name="ticket_bot_platforms[]" value="telegram" <?php checked( in_array( 'telegram', (array) $bot_settings['platforms'], true ) ); ?>>
          <strong>تلگرام</strong>
          <span>مشاهده و پاسخ به تیکت‌ها از Mini App / ربات تلگرام جارچی</span>
          <a href="<?php echo esc_url( admin_url( 'admin.php?page=' . WPEventPublisher\Admin::MENU_SLUG . '-telegram' ) ); ?>">تنظیمات تلگرام</a>
        </label>
        <label class="wpep-option-card">
          <input type="checkbox" name="ticket_bot_platforms[]" value="bale" <?php checked( in_array( 'bale', (array) $bot_settings['platforms'], true ) ); ?>>
          <strong>بله</strong>
          <span>مشاهده و پاسخ به تیکت‌ها از Mini App / ربات بله جارچی</span>
          <a href="<?php echo esc_url( admin_url( 'admin.php?page=' . WPEventPublisher\Admin::MENU_SLUG . '-bale' ) ); ?>">تنظیمات بله</a>
        </label>
      </div>
      <p class="description" style="margin:12px 0 0">این قابلیت علاوه بر فعال بودن این گزینه، به اتصال Backend جارچی و قابلیت <code>remote_tickets</code> در پلن نیاز دارد.</p>
    </section>
    <div class="jarchi-ticket-admin-advanced-grid">
      <div><h3>اتوماسیون</h3><label><input type="checkbox" name="auto_close_enabled" <?php checked(!empty($settings['auto_close_enabled'])); ?>> بستن خودکار تیکت‌های بدون فعالیت</label><div><label>زمان بسته‌شدن (ساعت)<input type="number" min="1" max="720" name="auto_close_hours" value="<?php echo esc_attr($settings['auto_close_hours']); ?>"></label></div></div>
      <div><h3>ضمیمه و صوت</h3><label><input type="checkbox" name="allow_voice" <?php checked(!empty($settings['allow_voice'])); ?>> اجازه ارسال پیام صوتی</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label>حداکثر فایل<input type="number" min="1" max="12" name="max_files" value="<?php echo esc_attr($settings['max_files']); ?>"></label><label>حداکثر MB<input type="number" min="1" max="50" name="max_file_mb" value="<?php echo esc_attr($settings['max_file_mb']); ?>"></label></div></div>
    </div>
    <hr>
    <h3>نام وضعیت‌ها</h3>
    <div class="jarchi-ticket-admin-status-grid"><?php foreach($settings['status_labels'] as $k=>$label): ?><label><?php echo esc_html($k); ?><input type="text" name="status_label[<?php echo esc_attr($k); ?>]" value="<?php echo esc_attr($label); ?>"></label><?php endforeach; ?></div>
    <hr>
    <h3>اولویت‌ها</h3>
    <div class="jarchi-ticket-admin-priority-grid"><?php foreach($settings['priorities'] as $k=>$priority): ?><div class="wpep-card" style="padding:12px"><strong><?php echo esc_html($k); ?></strong><label>عنوان<input type="text" name="priority_label[<?php echo esc_attr($k); ?>]" value="<?php echo esc_attr($priority['label']); ?>"></label><label>رنگ<input type="color" name="priority_color[<?php echo esc_attr($k); ?>]" value="<?php echo esc_attr($priority['color']); ?>"></label></div><?php endforeach; ?></div>
    <hr>
    <h3>فیلدهای سفارشی</h3>
    <p class="description">فیلدهایی که قبل از ارسال تیکت از کاربر دریافت می‌شوند.</p>
    <div id="jarchi-custom-fields"><?php foreach($settings['custom_fields'] as $field): ?><div class="jarchi-ticket-admin-custom-row"><input name="cf_key[]" placeholder="key" value="<?php echo esc_attr($field['key']); ?>"><input name="cf_label[]" placeholder="عنوان" value="<?php echo esc_attr($field['label']); ?>"><select name="cf_type[]"><option value="text" <?php selected($field['type'],'text'); ?>>متن</option><option value="textarea" <?php selected($field['type'],'textarea'); ?>>متن چندخطی</option><option value="select" <?php selected($field['type'],'select'); ?>>انتخابی</option></select><input name="cf_options[]" placeholder="گزینه‌ها، هر خط یک مورد" value="<?php echo esc_attr(implode('، ', (array)($field['options']??array()))); ?>"><label><input type="checkbox" name="cf_required[]" <?php checked(!empty($field['required'])); ?>> الزامی</label></div><?php endforeach; ?></div>
    <button type="button" class="button" onclick="const r=document.createElement('div');r.className='jarchi-ticket-admin-custom-row';r.innerHTML='<input name=\'cf_key[]\' placeholder=\'key\'><input name=\'cf_label[]\' placeholder=\'عنوان\'><select name=\'cf_type[]\'><option value=\'text\'>متن</option><option value=\'textarea\'>متن چندخطی</option><option value=\'select\'>انتخابی</option></select><input name=\'cf_options[]\' placeholder=\'گزینه‌ها، هر خط یک مورد\'><label><input type=\'checkbox\' name=\'cf_required[]\'> الزامی</label>';document.getElementById('jarchi-custom-fields').appendChild(r);">+ افزودن فیلد</button>
    <p style="margin-top:20px"><button class="wpep-primary-button" type="submit">ذخیره تنظیمات پیشرفته</button></p>
  </form>
</div>
