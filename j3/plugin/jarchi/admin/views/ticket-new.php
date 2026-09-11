<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
<div class="wrap wpep-wrap" dir="rtl">
	<div class="wpep-card">
		<div class="wpep-card__head">
			<div>
				<a class="jarchi-ticket-back" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'support' ) ); ?>">← بازگشت به تیکت‌ها</a>
				<h1 class="wpep-card__title"><span class="dashicons dashicons-plus-alt2"></span> تیکت جدید برای کاربر</h1>
				<p class="wpep-card__hint">کاربر را با نام، شماره موبایل یا ایمیل پیدا کنید و گفتگو را از طرف مدیریت آغاز کنید.</p>
			</div>
		</div>
		<?php $wpep_progress = wpep()->tickets()->broadcast_progress(); ?>
		<?php if ( $wpep_progress['running'] ) : ?>
			<div class="notice notice-info inline" style="margin:0 0 16px">
				<p>
					<?php
					printf(
						/* translators: 1: sent so far, 2: total recipients. */
						esc_html__( 'ارسال همگانی در حال انجام است: %1$s از %2$s کاربر. بقیه در پس‌زمینه ادامه پیدا می‌کند.', 'wp-event-publisher' ),
						esc_html( (string) $wpep_progress['sent'] ),
						esc_html( (string) $wpep_progress['total'] )
					);
					?>
				</p>
			</div>
		<?php endif; ?>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="jarchi-admin-ticket-new-form" enctype="multipart/form-data">
			<input type="hidden" name="action" value="wpep_ticket_admin_create">
			<input type="hidden" name="_wpnonce" value="<?php echo esc_attr( wp_create_nonce( WPEventPublisher\Tickets::NONCE ) ); ?>">

			<fieldset class="jarchi-ticket-audience" data-ticket-audience>
				<legend><strong><?php esc_html_e( 'گیرنده', 'wp-event-publisher' ); ?></strong></legend>

				<label class="jarchi-ticket-audience__option">
					<input type="radio" name="audience" value="single" checked>
					<span>
						<strong><?php esc_html_e( 'یک کاربر مشخص', 'wp-event-publisher' ); ?></strong>
						<small><?php esc_html_e( 'گفتگو فقط برای همان کاربر ساخته می‌شود.', 'wp-event-publisher' ); ?></small>
					</span>
				</label>

				<label class="jarchi-ticket-audience__option">
					<input type="radio" name="audience" value="all">
					<span>
						<strong><?php esc_html_e( 'همهٔ کاربران', 'wp-event-publisher' ); ?></strong>
						<small><?php esc_html_e( 'برای هر کاربر یک تیکت جداگانه ساخته می‌شود؛ ارسال دسته‌ای و در پس‌زمینه ادامه پیدا می‌کند.', 'wp-event-publisher' ); ?></small>
					</span>
				</label>
			</fieldset>

			<div class="jarchi-ticket-user-picker" data-ticket-user-picker data-ajax-url="<?php echo esc_attr( admin_url( 'admin-ajax.php' ) ); ?>" data-nonce="<?php echo esc_attr( wp_create_nonce( WPEventPublisher\Tickets::AJAX_NONCE ) ); ?>">
				<label class="wpep-field">
					<span>کاربر</span>
					<div class="jarchi-ticket-user-search-wrap">
						<span class="dashicons dashicons-search" aria-hidden="true"></span>
						<input type="search" class="jarchi-ticket-user-search" placeholder="نام، شماره موبایل یا ایمیل را جستجو کنید…" autocomplete="off" aria-describedby="jarchi-ticket-user-help">
						<input type="hidden" name="customer_id" class="jarchi-ticket-user-id" required>
					</div>
					<small id="jarchi-ticket-user-help" class="jarchi-ticket-user-help">حداقل ۲ کاراکتر وارد کنید. فقط ۲۰ نتیجه مرتبط نمایش داده می‌شود.</small>
				</label>
				<div class="jarchi-ticket-user-results" role="listbox" hidden></div>
				<div class="jarchi-ticket-selected-user" hidden aria-live="polite">
					<div class="jarchi-ticket-selected-user__avatar"><span class="dashicons dashicons-admin-users" aria-hidden="true"></span></div>
					<div class="jarchi-ticket-selected-user__meta"><strong></strong><div class="jarchi-ticket-selected-user__details"><span class="jarchi-ticket-selected-user__phone"></span><span class="jarchi-ticket-selected-user__email"></span></div></div>
					<button type="button" class="jarchi-ticket-user-clear">تغییر کاربر</button>
				</div>
			</div>
			<div class="jarchi-ticket-row">
				<label class="wpep-field"><span>دپارتمان</span><select name="department"><option value="0">انتخاب کنید</option><?php foreach($departments as $t): ?><option value="<?php echo esc_attr($t->term_id); ?>"><?php echo esc_html($t->name); ?></option><?php endforeach; ?></select></label>
				<label class="wpep-field"><span>دسته‌بندی</span><select name="category"><option value="0">انتخاب کنید</option><?php foreach($categories as $t): ?><option value="<?php echo esc_attr($t->term_id); ?>"><?php echo esc_html($t->name); ?></option><?php endforeach; ?></select></label>
			</div>
			<label class="wpep-field"><span>اولویت</span><select name="priority"><option value="low">کم</option><option value="normal" selected>عادی</option><option value="high">بالا</option><option value="urgent">فوری</option></select></label>
			<label class="wpep-field"><span>موضوع</span><input type="text" name="title" required maxlength="180"></label>
			<label class="wpep-field"><span>پیام</span><textarea name="message" rows="9" required></textarea></label>

			<label class="wpep-field">
				<span><?php esc_html_e( 'فایل و تصویر ضمیمه', 'wp-event-publisher' ); ?></span>
				<input type="file" name="attachments[]" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip">
				<small>
					<?php
					printf(
						/* translators: %d: maximum attachments. */
						esc_html__( 'تا %d فایل. همان فایل‌ها به تیکت همهٔ گیرندگان ضمیمه می‌شود.', 'wp-event-publisher' ),
						(int) WPEventPublisher\Tickets::MAX_ATTACHMENTS
					);
					?>
				</small>
			</label>

			<label class="wpep-checkbox jarchi-ticket-reply-toggle">
				<input type="checkbox" name="allow_reply" value="1">
				<span><?php esc_html_e( 'کاربر بتواند به این تیکت پاسخ دهد', 'wp-event-publisher' ); ?></span>
			</label>
			<p class="wpep-field__note">
				<?php esc_html_e( 'اگر تیک نخورد، این پیام فقط یک اطلاع‌رسانی است: تیکت بسته ساخته می‌شود، در فهرست «در انتظار پاسخ» نمی‌ماند و کاربر نمی‌تواند جواب بدهد.', 'wp-event-publisher' ); ?>
			</p>

			<button class="wpep-primary-button" type="submit"><span class="dashicons dashicons-email-alt"></span> ایجاد تیکت و اطلاع کاربر</button>
		</form>
	</div>
</div>
