<?php if ( ! defined('ABSPATH') ) exit; ?>
<div class="wrap wpep-wrap wpep-inner-page" dir="rtl">
  <div class="wpep-card"><div class="wpep-card__head"><div><h2 class="wpep-card__title">پیشرفته تیکت</h2><p class="wpep-card__hint">پشتیبانی حرفه‌ای، SLA، FAQ، فیلدهای سفارشی و آپلود صدا را از یکجا مدیریت کنید.</p></div></div></div>
  <form method="post" class="wpep-card" style="padding:24px">
    <?php wp_nonce_field('jarchi_ticket_advanced_save'); ?>
    <input type="hidden" name="jarchi_ticket_advanced_save" value="1">
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px">
      <div><h3>اتوماسیون</h3><label><input type="checkbox" name="auto_close_enabled" <?php checked(!empty($settings['auto_close_enabled'])); ?>> بستن خودکار تیکت‌های بدون فعالیت</label><div><label>زمان بسته‌شدن (ساعت)<input type="number" min="1" max="720" name="auto_close_hours" value="<?php echo esc_attr($settings['auto_close_hours']); ?>"></label></div></div>
      <div><h3>ضمیمه و صوت</h3><label><input type="checkbox" name="allow_voice" <?php checked(!empty($settings['allow_voice'])); ?>> اجازه ارسال پیام صوتی</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label>حداکثر فایل<input type="number" min="1" max="12" name="max_files" value="<?php echo esc_attr($settings['max_files']); ?>"></label><label>حداکثر MB<input type="number" min="1" max="50" name="max_file_mb" value="<?php echo esc_attr($settings['max_file_mb']); ?>"></label></div></div>
    </div>
    <hr>
    <h3>نام وضعیت‌ها</h3>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px"><?php foreach($settings['status_labels'] as $k=>$label): ?><label><?php echo esc_html($k); ?><input type="text" name="status_label[<?php echo esc_attr($k); ?>]" value="<?php echo esc_attr($label); ?>"></label><?php endforeach; ?></div>
    <hr>
    <h3>اولویت‌ها</h3>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px"><?php foreach($settings['priorities'] as $k=>$priority): ?><div class="wpep-card" style="padding:12px"><strong><?php echo esc_html($k); ?></strong><label>عنوان<input type="text" name="priority_label[<?php echo esc_attr($k); ?>]" value="<?php echo esc_attr($priority['label']); ?>"></label><label>رنگ<input type="color" name="priority_color[<?php echo esc_attr($k); ?>]" value="<?php echo esc_attr($priority['color']); ?>"></label></div><?php endforeach; ?></div>
    <hr>
    <h3>فیلدهای سفارشی</h3>
    <p class="description">فیلدهایی که قبل از ارسال تیکت از کاربر دریافت می‌شوند.</p>
    <div id="jarchi-custom-fields"><?php foreach($settings['custom_fields'] as $field): ?><div style="display:grid;grid-template-columns:1fr 1fr 160px 1fr 100px;gap:8px;margin-bottom:8px"><input name="cf_key[]" placeholder="key" value="<?php echo esc_attr($field['key']); ?>"><input name="cf_label[]" placeholder="عنوان" value="<?php echo esc_attr($field['label']); ?>"><select name="cf_type[]"><option value="text" <?php selected($field['type'],'text'); ?>>متن</option><option value="textarea" <?php selected($field['type'],'textarea'); ?>>متن چندخطی</option><option value="select" <?php selected($field['type'],'select'); ?>>انتخابی</option></select><input name="cf_options[]" placeholder="گزینه‌ها، هر خط یک مورد" value="<?php echo esc_attr(implode('، ', (array)($field['options']??array()))); ?>"><label><input type="checkbox" name="cf_required[]" <?php checked(!empty($field['required'])); ?>> الزامی</label></div><?php endforeach; ?></div>
    <button type="button" class="button" onclick="const r=document.createElement('div');r.style='display:grid;grid-template-columns:1fr 1fr 160px 100px;gap:8px;margin-bottom:8px';r.innerHTML='<input name=\'cf_key[]\' placeholder=\'key\'><input name=\'cf_label[]\' placeholder=\'عنوان\'><select name=\'cf_type[]\'><option value=\'text\'>متن</option><option value=\'textarea\'>متن چندخطی</option><option value=\'select\'>انتخابی</option></select><label><input type=\'checkbox\' name=\'cf_required[]\'> الزامی</label>';document.getElementById('jarchi-custom-fields').appendChild(r);">+ افزودن فیلد</button>
    <hr>
    <h3>سؤالات متداول قبل از ثبت تیکت</h3>
    <div id="jarchi-faqs"><?php foreach($settings['faq'] as $faq): ?><div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-bottom:8px"><input name="faq_title[]" value="<?php echo esc_attr($faq['title']); ?>" placeholder="سؤال"><textarea name="faq_body[]" rows="2" placeholder="پاسخ"><?php echo esc_textarea($faq['body']); ?></textarea></div><?php endforeach; ?></div>
    <button type="button" class="button" onclick="const r=document.createElement('div');r.style='display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-bottom:8px';r.innerHTML='<input name=\'faq_title[]\' placeholder=\'سؤال\'><textarea name=\'faq_body[]\' rows=\'2\' placeholder=\'پاسخ\'></textarea>';document.getElementById('jarchi-faqs').appendChild(r);">+ افزودن FAQ</button>
    <p style="margin-top:20px"><button class="wpep-primary-button" type="submit">ذخیره تنظیمات پیشرفته</button></p>
  </form>
</div>
