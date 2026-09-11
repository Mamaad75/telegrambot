<?php
/**
 * Restricted automatic-ticket template copy editor.
 *
 * @var array<int,array<string,mixed>> $rules
 * @var array<string,string>            $tokens
 * @var string                          $nonce_action
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
$notice = isset( $_GET['template'] ) ? sanitize_key( wp_unslash( (string) $_GET['template'] ) ) : '';
$messages = array(
	'saved'           => __( 'متن قالب با موفقیت ذخیره شد.', 'wp-event-publisher' ),
	'template_saved' => __( 'متن تیکت خودکار با موفقیت ذخیره شد.', 'wp-event-publisher' ),
	'incomplete' => __( 'عنوان و متن تیکت نمی‌تواند خالی باشد.', 'wp-event-publisher' ),
	'not_found'  => __( 'قالب موردنظر پیدا نشد.', 'wp-event-publisher' ),
);
?>
<div class="wrap jarchi-template-editor" dir="rtl">
	<h1><?php esc_html_e( 'قالب‌های تیکت خودکار جارچی', 'wp-event-publisher' ); ?></h1>
	<p class="description"><?php esc_html_e( 'در این صفحه فقط متن قالب‌ها قابل ویرایش است. رویداد، شرط، فعال/غیرفعال بودن، دپارتمان و سایر تنظیمات فنی فقط در اختیار مدیر سایت می‌ماند.', 'wp-event-publisher' ); ?></p>

	<?php if ( isset( $messages[ $notice ] ) ) : ?>
		<div class="notice <?php echo in_array( $notice, array( 'saved', 'template_saved' ), true ) ? 'notice-success' : 'notice-error'; ?> is-dismissible"><p><?php echo esc_html( $messages[ $notice ] ); ?></p></div>
	<?php endif; ?>

	<?php if ( empty( $rules ) ) : ?>
		<div class="notice notice-info"><p><?php esc_html_e( 'هنوز هیچ قالب آماده‌ای به تیکت‌های خودکار اضافه نشده است. ابتدا مدیر سایت باید قالب موردنظر را اضافه کند.', 'wp-event-publisher' ); ?></p></div>
	<?php else : ?>
		<div class="jarchi-template-grid">
		<?php foreach ( $rules as $rule ) : ?>
			<?php
			$id      = sanitize_key( (string) ( $rule['id'] ?? '' ) );
			$name    = (string) ( $rule['name'] ?? '' );
			$subject = (string) ( $rule['subject'] ?? '' );
			$body    = (string) ( $rule['body'] ?? '' );
			$enabled = ! empty( $rule['enabled'] );
			?>
			<section class="jarchi-template-card" id="template-<?php echo esc_attr( $id ); ?>">
				<div class="jarchi-template-card__head">
					<div>
						<h2><?php echo esc_html( $name ); ?></h2>
						<span class="jarchi-template-state <?php echo $enabled ? 'is-on' : 'is-off'; ?>"><?php echo $enabled ? esc_html__( 'فعال', 'wp-event-publisher' ) : esc_html__( 'غیرفعال', 'wp-event-publisher' ); ?></span>
					</div>
					<code><?php echo esc_html( (string) ( $rule['from_preset'] ?? '' ) ); ?></code>
				</div>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<?php wp_nonce_field( $nonce_action ); ?>
					<input type="hidden" name="action" value="wpep_ticket_template_update" />
					<input type="hidden" name="rule_id" value="<?php echo esc_attr( $id ); ?>" />
					<label>
						<span><?php esc_html_e( 'عنوان تیکت', 'wp-event-publisher' ); ?></span>
						<input type="text" name="subject" value="<?php echo esc_attr( $subject ); ?>" required />
					</label>
					<label>
						<span><?php esc_html_e( 'متن تیکت', 'wp-event-publisher' ); ?></span>
						<textarea name="body" rows="8" required><?php echo esc_textarea( $body ); ?></textarea>
					</label>
					<button type="submit" class="button button-primary"><?php esc_html_e( 'ذخیره متن قالب', 'wp-event-publisher' ); ?></button>
				</form>
			</section>
		<?php endforeach; ?>
		</div>
	<?php endif; ?>

	<details class="jarchi-template-tokens">
		<summary><?php esc_html_e( 'متغیرهای قابل استفاده در متن قالب', 'wp-event-publisher' ); ?></summary>
		<div class="jarchi-template-token-list">
			<?php foreach ( $tokens as $token => $description ) : ?>
				<div><code><?php echo esc_html( $token ); ?></code><span><?php echo esc_html( $description ); ?></span></div>
			<?php endforeach; ?>
		</div>
	</details>
</div>
<style>
.jarchi-template-editor{max-width:1180px}.jarchi-template-editor>h1{font-weight:800}.jarchi-template-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px;margin-top:22px}.jarchi-template-card{background:#fff;border:1px solid #dcdcde;border-radius:14px;padding:18px;box-shadow:0 5px 20px rgba(0,0,0,.04)}.jarchi-template-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px}.jarchi-template-card__head h2{margin:0 0 7px;font-size:16px}.jarchi-template-state{display:inline-block;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700}.jarchi-template-state.is-on{background:#e8f7ee;color:#126b36}.jarchi-template-state.is-off{background:#f1f1f1;color:#646970}.jarchi-template-card label{display:block;margin-bottom:14px}.jarchi-template-card label>span{display:block;font-weight:700;margin-bottom:6px}.jarchi-template-card input[type=text],.jarchi-template-card textarea{width:100%;box-sizing:border-box}.jarchi-template-card textarea{line-height:1.9;resize:vertical}.jarchi-template-tokens{margin:24px 0;background:#fff;border:1px solid #dcdcde;border-radius:12px;padding:14px 16px}.jarchi-template-tokens summary{font-weight:800;cursor:pointer}.jarchi-template-token-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px 16px;margin-top:14px}.jarchi-template-token-list>div{display:flex;gap:8px;align-items:center}.jarchi-template-token-list code{direction:ltr}.jarchi-template-token-list span{color:#646970}@media(max-width:782px){.jarchi-template-grid{grid-template-columns:1fr}.jarchi-template-card{padding:14px}}
</style>
