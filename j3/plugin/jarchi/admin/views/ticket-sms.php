<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
$providers = WPEventPublisher\TicketSms::providers();
$current_provider = (string) ( $settings['provider'] ?? 'sms_ir' );
$current_meta = $providers[ $current_provider ] ?? $providers['sms_ir'];
?>
<div class="wrap wpep-wrap wpep-ticket-admin" dir="rtl">
	<div class="wpep-card jarchi-sms-hero">
		<div class="jarchi-sms-hero__icon"><span class="dashicons dashicons-smartphone"></span></div>
		<div>
			<span class="jarchi-kicker"><?php esc_html_e( 'مرکز ارتباط با کاربر', 'wp-event-publisher' ); ?></span>
			<h1><?php esc_html_e( 'پنل پیامکی تیکت‌ها', 'wp-event-publisher' ); ?></h1>
			<p><?php esc_html_e( 'پنل پیامکی خودتان را انتخاب کنید و فقط مشخصات همان سرویس را وارد کنید. پاسخ تیکت می‌تواند بلافاصله برای کاربر پیامک شود.', 'wp-event-publisher' ); ?></p>
		</div>
		<?php if ( isset( $_GET['updated'] ) ) : ?>
			<span class="wpep-pill wpep-pill--success"><?php esc_html_e( 'ذخیره شد', 'wp-event-publisher' ); ?></span>
		<?php endif; ?>
	</div>

	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="wpep-sms-settings-grid" id="jarchi-sms-provider-form">
		<input type="hidden" name="action" value="wpep_ticket_sms_save" />
		<input type="hidden" name="_wpnonce" value="<?php echo esc_attr( wp_create_nonce( WPEventPublisher\Tickets::NONCE ) ); ?>" />

		<section class="wpep-card">
			<div class="wpep-card__head">
				<div>
					<h2 class="wpep-card__title"><?php esc_html_e( 'انتخاب پنل پیامکی', 'wp-event-publisher' ); ?></h2>
					<p class="wpep-card__hint"><?php esc_html_e( 'در هر لحظه فقط یک درگاه برای ارسال پاسخ تیکت فعال است.', 'wp-event-publisher' ); ?></p>
				</div>
				<label class="jarchi-switch-line jarchi-sms-master-switch">
					<input type="checkbox" name="enabled" value="1" <?php checked( ! empty( $settings['enabled'] ) ); ?> />
					<span><?php esc_html_e( 'فعال‌سازی پیامک', 'wp-event-publisher' ); ?></span>
				</label>
			</div>

			<div class="jarchi-sms-provider-picker">
				<?php foreach ( $providers as $key => $meta ) : ?>
					<label class="jarchi-sms-provider-option<?php echo $current_provider === $key ? ' is-selected' : ''; ?>">
						<input type="radio" name="provider" value="<?php echo esc_attr( $key ); ?>" <?php checked( $current_provider, $key ); ?> />
						<span class="jarchi-sms-provider-logo"><?php echo esc_html( mb_substr( (string) $meta['label'], 0, 2 ) ); ?></span>
						<span class="jarchi-sms-provider-copy"><strong><?php echo esc_html( $meta['label'] ); ?></strong><small><?php echo esc_html( $meta['note'] ); ?></small></span>
					</label>
				<?php endforeach; ?>
			</div>
		</section>

		<section class="wpep-card jarchi-sms-config-card" id="jarchi-sms-credentials-card">
			<div class="wpep-card__head">
				<div>
					<h2 class="wpep-card__title" id="jarchi-sms-provider-title"><?php echo esc_html( $current_meta['label'] ); ?></h2>
					<p class="wpep-card__hint" id="jarchi-sms-provider-note"><?php echo esc_html( $current_meta['note'] ); ?></p>
				</div>
			</div>

			<div class="wpep-fields-grid wpep-fields-grid--2">
				<label class="wpep-field jarchi-provider-api-key">
					<span><?php esc_html_e( 'API Key / Token', 'wp-event-publisher' ); ?></span>
					<input type="password" name="api_key" value="<?php echo esc_attr( (string) $settings['api_key'] ); ?>" autocomplete="new-password" dir="ltr" />
				</label>
				<label class="wpep-field jarchi-provider-username">
					<span><?php esc_html_e( 'نام کاربری', 'wp-event-publisher' ); ?></span>
					<input type="text" name="username" value="<?php echo esc_attr( (string) $settings['username'] ); ?>" autocomplete="off" dir="ltr" />
				</label>
				<label class="wpep-field jarchi-provider-password">
					<span><?php esc_html_e( 'رمز عبور', 'wp-event-publisher' ); ?></span>
					<input type="password" name="password" value="<?php echo esc_attr( (string) $settings['password'] ); ?>" autocomplete="new-password" dir="ltr" />
				</label>
				<label class="wpep-field">
					<span><?php esc_html_e( 'خط ارسال', 'wp-event-publisher' ); ?></span>
					<input type="text" name="sender" value="<?php echo esc_attr( (string) $settings['sender'] ); ?>" placeholder="3000..." dir="ltr" />
				</label>
				<label class="wpep-field jarchi-provider-pattern">
					<span><?php esc_html_e( 'Pattern / Template / Code', 'wp-event-publisher' ); ?></span>
					<input type="text" name="pattern_id" value="<?php echo esc_attr( (string) $settings['pattern_id'] ); ?>" dir="ltr" />
				</label>
				<label class="wpep-field wpep-field--full">
					<span><?php esc_html_e( 'Endpoint', 'wp-event-publisher' ); ?></span>
					<input type="url" name="endpoint" value="<?php echo esc_attr( (string) $settings['endpoint'] ); ?>" dir="ltr" />
					<small><?php esc_html_e( 'برای پنل‌های سفارشی یا سرویس‌هایی که چند API دارند، Endpoint را مطابق مستندات خود پنل وارد کنید.', 'wp-event-publisher' ); ?></small>
				</label>
			</div>
		</section>

		<section class="wpep-card jarchi-provider-pattern-fields">
			<div class="wpep-card__head">
				<div>
					<h2 class="wpep-card__title"><?php esc_html_e( 'پارامترهای الگو', 'wp-event-publisher' ); ?></h2>
					<p class="wpep-card__hint"><?php esc_html_e( 'اگر پنل شما Pattern/Verify دارد، نام متغیرها را دقیقاً با الگوی پنل یکی کنید.', 'wp-event-publisher' ); ?></p>
				</div>
			</div>
			<div class="wpep-fields-grid wpep-fields-grid--3">
				<label class="wpep-field"><span><?php esc_html_e( 'پارامتر عنوان', 'wp-event-publisher' ); ?></span><input type="text" name="param_title" value="<?php echo esc_attr( (string) $settings['param_title'] ); ?>" dir="ltr" /></label>
				<label class="wpep-field"><span><?php esc_html_e( 'پارامتر شماره تیکت', 'wp-event-publisher' ); ?></span><input type="text" name="param_id" value="<?php echo esc_attr( (string) $settings['param_id'] ); ?>" dir="ltr" /></label>
				<label class="wpep-field"><span><?php esc_html_e( 'پارامتر لینک', 'wp-event-publisher' ); ?></span><input type="text" name="param_link" value="<?php echo esc_attr( (string) $settings['param_link'] ); ?>" dir="ltr" /></label>
			</div>
		</section>

		<div class="wpep-card wpep-form-actions">
			<button type="submit" class="wpep-primary-button"><span class="dashicons dashicons-saved"></span><?php esc_html_e( 'ذخیره تنظیمات پیامک', 'wp-event-publisher' ); ?></button>
			<a href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'support' ) ); ?>" class="button"><?php esc_html_e( 'بازگشت به تیکت‌ها', 'wp-event-publisher' ); ?></a>
		</div>
	</form>
</div>
<script>
(function(){
	const providers = <?php echo wp_json_encode( $providers ); ?>;
	const form = document.getElementById('jarchi-sms-provider-form');
	if(!form) return;
	const radios = form.querySelectorAll('input[name="provider"]');
	const title = document.getElementById('jarchi-sms-provider-title');
	const note = document.getElementById('jarchi-sms-provider-note');
	const pattern = form.querySelector('.jarchi-provider-pattern-fields');
	const patternMain = form.querySelector('.jarchi-provider-pattern');
	const api = form.querySelector('.jarchi-provider-api-key');
	const user = form.querySelector('.jarchi-provider-username');
	const pass = form.querySelector('.jarchi-provider-password');
	const url = form.querySelector('input[name="endpoint"]');
	function render(key){
		const meta = providers[key] || providers.sms_ir;
		title.textContent = meta.label;
		note.textContent = meta.note;
		if (meta.default_url && !url.value) url.value = meta.default_url;
		if (!meta.default_url && ['custom','melipayamak'].includes(key)) url.placeholder = 'https://...';
		pattern.style.display = meta.pattern ? '' : 'none';
		patternMain.style.display = meta.pattern ? '' : 'none';
		api.style.display = ['sms_ir','kavenegar','ippanel','melipayamak','custom'].includes(key) ? '' : 'none';
		user.style.display = ['farapayamak','melipayamak','custom'].includes(key) ? '' : 'none';
		pass.style.display = ['farapayamak','melipayamak','custom'].includes(key) ? '' : 'none';
		form.querySelectorAll('.jarchi-sms-provider-option').forEach(el => el.classList.toggle('is-selected', el.querySelector('input').checked));
	}
	radios.forEach(r => r.addEventListener('change', e => render(e.target.value)));
	render(<?php echo wp_json_encode( $current_provider ); ?>);
})();
</script>
