<?php
/**
 * Automatic tickets screen.
 *
 * Written for an administrator who is not a developer. A rule is presented as
 * one sentence — when X happens, send this — and the form asks for the pieces
 * of that sentence in order. The previous screen printed the raw trigger and
 * condition keys side by side with a single unlabelled text box next to them,
 * which is what made it unreadable.
 *
 * @package WPEventPublisher
 *
 * @var \WPEventPublisher\TicketAutomations $automations  The service.
 * @var array<int,array<string,mixed>>      $rules        Saved rules.
 * @var array<string,array<string,mixed>>   $triggers     Available events.
 * @var array<string,array<string,mixed>>   $conditions   Available conditions.
 * @var array<string,string>                $priorities   Priority labels.
 * @var array<int,array<string,mixed>>      $presets      Ready-made rules.
 * @var array<string,string>                $tokens       Placeholders.
 * @var \WP_Term[]                          $departments  Departments.
 * @var \WP_Term[]                          $categories   Categories.
 * @var array<string,object>                $post_types   Public post types.
 * @var array<string,string>                $roles        Role names.
 * @var array<string,string>                $order_statuses WooCommerce statuses.
 * @var string[]                            $adopted      Preset slugs already added.
 * @var string                              $nonce_action Nonce action.
 * @var array<string,mixed>|null            $dry_run      Last dry-run report.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_post_url = admin_url( 'admin-post.php' );

// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only notice.
$wpep_notice = isset( $_GET['automation'] ) ? sanitize_key( wp_unslash( (string) $_GET['automation'] ) ) : '';

$wpep_notices = array(
	'saved'      => __( 'قانون ذخیره شد.', 'wp-event-publisher' ),
	'added'      => __( 'قالب اضافه شد. برای شروع کار، آن را روشن کنید.', 'wp-event-publisher' ),
	'deleted'    => __( 'قانون حذف شد.', 'wp-event-publisher' ),
	'ran'        => __( 'قانون یک بار اجرا شد.', 'wp-event-publisher' ),
	'incomplete' => __( 'عنوان و متن تیکت الزامی است.', 'wp-event-publisher' ),
	'tested'     => __( 'آزمایش انجام شد — هیچ تیکتی ساخته نشد.', 'wp-event-publisher' ),
	'no_user'    => __( 'برای اجرای آزمایشی، یک کاربر مشخص کنید.', 'wp-event-publisher' ),
	'already_ran' => __( 'این قانون همین ساعت برای این کاربر اجرا شده است.', 'wp-event-publisher' ),
);
?>
<div class="wrap wpep-wrap wpep-dashboard wpep-inner-page jarchi-automations" dir="rtl">

	<?php if ( isset( $wpep_notices[ $wpep_notice ] ) ) : ?>
		<div class="notice notice-<?php echo 'incomplete' === $wpep_notice ? 'error' : 'success'; ?> is-dismissible">
			<p><?php echo esc_html( $wpep_notices[ $wpep_notice ] ); ?></p>
		</div>
	<?php endif; ?>

	<section class="wpep-card">
		<h1 class="wpep-card__title"><?php esc_html_e( 'تیکت‌های خودکار', 'wp-event-publisher' ); ?></h1>
		<p class="wpep-card__hint">
			<?php esc_html_e( 'هر قانون یک جمله است: «وقتی این اتفاق افتاد، برای همان کاربر این پیام ساخته شود.» می‌توانید از قالب‌های آماده شروع کنید و بعد متن‌ها را به دلخواه تغییر دهید.', 'wp-event-publisher' ); ?>
		</p>
	</section>

	<?php /* ------------------------------------------------------ presets */ ?>
	<section class="wpep-card">
		<div class="wpep-card__head">
			<div>
				<h2 class="wpep-card__title"><?php esc_html_e( 'قالب‌های آماده', 'wp-event-publisher' ); ?></h2>
				<p class="wpep-card__hint"><?php esc_html_e( 'هر قالبی که لازم دارید اضافه کنید. قالب‌ها خاموش اضافه می‌شوند تا فرصت داشته باشید متن را ببینید و ویرایش کنید؛ بعد روشنشان کنید.', 'wp-event-publisher' ); ?></p>
			</div>
		</div>

		<div class="jarchi-preset-grid">
			<?php foreach ( $presets as $wpep_preset ) : ?>
				<?php
				$wpep_slug     = (string) $wpep_preset['slug'];
				$wpep_trigger  = (string) $wpep_preset['trigger'];
				$wpep_priority = (string) $wpep_preset['priority'];
				$wpep_used     = in_array( $wpep_slug, (array) $adopted, true );
				?>
				<article class="jarchi-preset<?php echo $wpep_used ? ' is-used' : ''; ?>">
					<header class="jarchi-preset__head">
						<span class="jarchi-preset__event"><?php echo esc_html( (string) ( $triggers[ $wpep_trigger ]['label'] ?? $wpep_trigger ) ); ?></span>
						<span class="jarchi-preset__priority jarchi-preset__priority--<?php echo esc_attr( $wpep_priority ); ?>"><?php echo esc_html( (string) ( $priorities[ $wpep_priority ] ?? $wpep_priority ) ); ?></span>
					</header>

					<h3 class="jarchi-preset__subject"><?php echo esc_html( (string) $wpep_preset['subject'] ); ?></h3>
					<p class="jarchi-preset__body"><?php echo esc_html( (string) $wpep_preset['body'] ); ?></p>

					<footer class="jarchi-preset__foot">
						<?php if ( $wpep_used ) : ?>
							<span class="jarchi-preset__used"><span class="dashicons dashicons-yes" aria-hidden="true"></span> <?php esc_html_e( 'اضافه شده', 'wp-event-publisher' ); ?></span>
						<?php else : ?>
							<form method="post" action="<?php echo esc_url( $wpep_post_url ); ?>">
								<?php wp_nonce_field( $nonce_action ); ?>
								<input type="hidden" name="action" value="wpep_ticket_automation_preset" />
								<input type="hidden" name="preset" value="<?php echo esc_attr( $wpep_slug ); ?>" />
								<button type="submit" class="button"><?php esc_html_e( 'افزودن این قالب', 'wp-event-publisher' ); ?></button>
							</form>
						<?php endif; ?>
					</footer>
				</article>
			<?php endforeach; ?>
		</div>
	</section>

	<?php if ( $dry_run ) : ?>
		<?php $wpep_report = (array) ( $dry_run['report'] ?? array() ); ?>
		<section class="wpep-card jarchi-dryrun">
			<h2 class="wpep-card__title">
				<?php
				printf(
					/* translators: %s: rule name. */
					esc_html__( 'نتیجهٔ آزمایش «%s»', 'wp-event-publisher' ),
					esc_html( (string) ( $dry_run['rule'] ?? '' ) )
				);
				?>
			</h2>

			<p class="wpep-card__hint"><?php esc_html_e( 'هیچ تیکتی ساخته نشد. این فقط گزارش کاری است که اگر قانون اجرا می‌شد انجام می‌داد.', 'wp-event-publisher' ); ?></p>

			<?php if ( ! empty( $wpep_report['reasons'] ) ) : ?>
				<?php foreach ( (array) $wpep_report['reasons'] as $wpep_reason ) : ?>
					<p class="jarchi-rule__warning"><?php echo esc_html( $wpep_reason ); ?></p>
				<?php endforeach; ?>
			<?php endif; ?>

			<div class="jarchi-dryrun__grid">
				<div class="jarchi-dryrun__stat"><strong><?php echo esc_html( number_format_i18n( (int) ( $wpep_report['examined'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'بررسی شد', 'wp-event-publisher' ); ?></span></div>
				<div class="jarchi-dryrun__stat"><strong><?php echo esc_html( number_format_i18n( (int) ( $wpep_report['matched'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'شرط را داشت', 'wp-event-publisher' ); ?></span></div>
				<div class="jarchi-dryrun__stat is-primary"><strong><?php echo esc_html( number_format_i18n( (int) ( $wpep_report['would_send'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'تیکت می‌گرفت', 'wp-event-publisher' ); ?></span></div>
				<div class="jarchi-dryrun__stat"><strong><?php echo esc_html( number_format_i18n( (int) ( $wpep_report['already'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'قبلاً گرفته', 'wp-event-publisher' ); ?></span></div>
				<div class="jarchi-dryrun__stat"><strong><?php echo esc_html( number_format_i18n( (int) ( $wpep_report['skipped'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'رد شد', 'wp-event-publisher' ); ?></span></div>
			</div>

			<?php if ( ! empty( $wpep_report['sample'] ) ) : ?>
				<p class="wpep-card__hint">
					<?php esc_html_e( 'نمونهٔ گیرندگان:', 'wp-event-publisher' ); ?>
					<?php echo esc_html( implode( '، ', (array) $wpep_report['sample'] ) ); ?>
				</p>
			<?php endif; ?>
		</section>
	<?php endif; ?>

	<?php /* -------------------------------------------------- your rules */ ?>
	<section class="wpep-card">
		<h2 class="wpep-card__title"><?php esc_html_e( 'قانون‌های شما', 'wp-event-publisher' ); ?></h2>

		<?php if ( empty( $rules ) ) : ?>
			<div class="wpep-empty"><?php esc_html_e( 'هنوز قانونی ندارید. از قالب‌های بالا یکی را اضافه کنید یا پایین‌تر قانون تازه بسازید.', 'wp-event-publisher' ); ?></div>
		<?php else : ?>
			<div class="jarchi-rule-list">
				<?php foreach ( $rules as $wpep_rule ) : ?>
					<?php
					$wpep_trigger  = (string) ( $wpep_rule['trigger'] ?? '' );
					$wpep_priority = (string) ( $wpep_rule['priority'] ?? 'normal' );
					$wpep_on       = ! empty( $wpep_rule['enabled'] );
					$wpep_scope    = (string) ( $triggers[ $wpep_trigger ]['scope'] ?? 'actor' );
					?>
					<article class="jarchi-rule<?php echo $wpep_on ? ' is-on' : ' is-off'; ?>">
						<div class="jarchi-rule__main">
							<div class="jarchi-rule__title">
								<strong><?php echo esc_html( (string) ( $wpep_rule['name'] ?? '' ) ); ?></strong>
								<span class="jarchi-rule__state"><?php echo $wpep_on ? esc_html__( 'روشن', 'wp-event-publisher' ) : esc_html__( 'خاموش', 'wp-event-publisher' ); ?></span>
							</div>

							<p class="jarchi-rule__sentence"><?php echo esc_html( $automations->describe( (array) $wpep_rule ) ); ?></p>

							<div class="jarchi-rule__tags">
								<span class="jarchi-rule__tag"><?php echo esc_html( (string) ( $priorities[ $wpep_priority ] ?? $wpep_priority ) ); ?></span>

								<span class="jarchi-rule__tag">
									<?php
									echo esc_html(
										! empty( $wpep_rule['allow_reply'] )
											? __( 'کاربر می‌تواند پاسخ دهد', 'wp-event-publisher' )
											: __( 'فقط اطلاع‌رسانی — بدون پاسخ', 'wp-event-publisher' )
									);
									?>
								</span>

								<?php if ( ! empty( $wpep_rule['once_per_user'] ) ) : ?>
									<span class="jarchi-rule__tag"><?php esc_html_e( 'فقط یک بار', 'wp-event-publisher' ); ?></span>
								<?php endif; ?>

								<?php if ( ! empty( $wpep_rule['delay_minutes'] ) ) : ?>
									<span class="jarchi-rule__tag">
										<?php
										printf(
											/* translators: %d: delay in minutes. */
											esc_html__( 'با %d دقیقه تأخیر', 'wp-event-publisher' ),
											(int) $wpep_rule['delay_minutes']
										);
										?>
									</span>
								<?php endif; ?>

								<?php if ( 'scan' === $wpep_scope ) : ?>
									<span class="jarchi-rule__tag jarchi-rule__tag--warn"><?php esc_html_e( 'بررسی همهٔ کاربران', 'wp-event-publisher' ); ?></span>
								<?php endif; ?>
							</div>

							<?php if ( 'custom_hook' === $wpep_trigger ) : ?>
								<p class="jarchi-rule__note">
									<?php esc_html_e( 'این رویداد را سایت شما باید اعلام کند:', 'wp-event-publisher' ); ?>
									<code>do_action( 'jarchi_automation_event', '<?php echo esc_html( (string) ( $wpep_rule['hook_slug'] ?? '' ) ); ?>', $user_id, $context );</code>
								</p>
							<?php endif; ?>

							<?php if ( 'scheduled' === $wpep_trigger && 'none' === (string) ( $wpep_rule['condition'] ?? 'none' ) ) : ?>
								<p class="jarchi-rule__warning"><?php esc_html_e( 'این قانون شرطی ندارد و هر ساعت برای همهٔ کاربران اجرا می‌شود. حتماً یک شرط بگذارید.', 'wp-event-publisher' ); ?></p>
							<?php endif; ?>
						</div>

						<div class="jarchi-rule__actions">
							<form method="post" action="<?php echo esc_url( $wpep_post_url ); ?>" class="jarchi-rule__test">
								<?php wp_nonce_field( $nonce_action ); ?>
								<input type="hidden" name="action" value="wpep_ticket_automation_dry_run" />
								<input type="hidden" name="rule_id" value="<?php echo esc_attr( (string) ( $wpep_rule['id'] ?? '' ) ); ?>" />
								<input
									type="number"
									name="user_id"
									min="0"
									placeholder="<?php esc_attr_e( 'شناسهٔ کاربر (اختیاری)', 'wp-event-publisher' ); ?>"
									title="<?php esc_attr_e( 'برای آزمایش روی یک کاربر مشخص، شناسهٔ او را وارد کنید.', 'wp-event-publisher' ); ?>"
								/>
								<button type="submit" class="button"><?php esc_html_e( 'آزمایش بدون ارسال', 'wp-event-publisher' ); ?></button>
							</form>

							<form method="post" action="<?php echo esc_url( $wpep_post_url ); ?>">
								<?php wp_nonce_field( $nonce_action ); ?>
								<input type="hidden" name="action" value="wpep_ticket_automation_toggle" />
								<input type="hidden" name="rule_id" value="<?php echo esc_attr( (string) ( $wpep_rule['id'] ?? '' ) ); ?>" />
								<button type="submit" class="button"><?php echo $wpep_on ? esc_html__( 'خاموش کن', 'wp-event-publisher' ) : esc_html__( 'روشن کن', 'wp-event-publisher' ); ?></button>
							</form>

							<form method="post" action="<?php echo esc_url( $wpep_post_url ); ?>">
								<?php wp_nonce_field( $nonce_action ); ?>
								<input type="hidden" name="action" value="wpep_ticket_automation_delete" />
								<input type="hidden" name="rule_id" value="<?php echo esc_attr( (string) ( $wpep_rule['id'] ?? '' ) ); ?>" />
								<button
									type="submit"
									class="button button-link-delete"
									onclick="return confirm('<?php echo esc_js( __( 'این قانون حذف شود؟', 'wp-event-publisher' ) ); ?>');"
								><?php esc_html_e( 'حذف', 'wp-event-publisher' ); ?></button>
							</form>
						</div>
					</article>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</section>

	<?php /* ---------------------------------------------------- new rule */ ?>
	<section class="wpep-card">
		<h2 class="wpep-card__title"><?php esc_html_e( 'ساخت قانون تازه', 'wp-event-publisher' ); ?></h2>

		<form method="post" action="<?php echo esc_url( $wpep_post_url ); ?>" class="jarchi-rule-form" data-jarchi-rule-form>
			<?php wp_nonce_field( $nonce_action ); ?>
			<input type="hidden" name="action" value="wpep_ticket_automation_save" />

			<div class="jarchi-rule-form__step">
				<h3><span class="jarchi-rule-form__num">۱</span> <?php esc_html_e( 'چه اتفاقی بیفتد؟', 'wp-event-publisher' ); ?></h3>

				<label class="wpep-field">
					<span><?php esc_html_e( 'رویداد', 'wp-event-publisher' ); ?></span>
					<select name="trigger" data-jarchi-trigger>
						<?php foreach ( $triggers as $wpep_key => $wpep_meta ) : ?>
							<option
								value="<?php echo esc_attr( $wpep_key ); ?>"
								data-hint="<?php echo esc_attr( (string) $wpep_meta['hint'] ); ?>"
								data-scope="<?php echo esc_attr( (string) $wpep_meta['scope'] ); ?>"
							><?php echo esc_html( (string) $wpep_meta['label'] ); ?></option>
						<?php endforeach; ?>
					</select>
					<small class="jarchi-rule-form__hint" data-jarchi-trigger-hint></small>
				</label>

				<div class="jarchi-rule-form__conditional" data-when-trigger="post_published post_unpublished">
					<label class="wpep-field">
						<span><?php esc_html_e( 'کدام نوع محتوا؟', 'wp-event-publisher' ); ?></span>
						<select name="post_type">
							<?php foreach ( $post_types as $wpep_type ) : ?>
								<option value="<?php echo esc_attr( (string) $wpep_type->name ); ?>"><?php echo esc_html( (string) ( $wpep_type->labels->singular_name ?? $wpep_type->name ) ); ?></option>
							<?php endforeach; ?>
						</select>
						<small><?php esc_html_e( 'قانون فقط برای همین نوع محتوا اجرا می‌شود.', 'wp-event-publisher' ); ?></small>
					</label>
				</div>

				<div class="jarchi-rule-form__conditional" data-when-trigger="order_status_changed">
					<label class="wpep-field">
						<span><?php esc_html_e( 'کدام وضعیت سفارش؟', 'wp-event-publisher' ); ?></span>
						<select name="order_status">
							<option value=""><?php esc_html_e( 'هر تغییری در وضعیت', 'wp-event-publisher' ); ?></option>
							<?php foreach ( $order_statuses as $wpep_status_key => $wpep_status_label ) : ?>
								<option value="<?php echo esc_attr( str_replace( 'wc-', '', (string) $wpep_status_key ) ); ?>"><?php echo esc_html( (string) $wpep_status_label ); ?></option>
							<?php endforeach; ?>
						</select>
					</label>
				</div>

				<div class="jarchi-rule-form__conditional" data-when-trigger="custom_hook">
					<label class="wpep-field">
						<span><?php esc_html_e( 'نام رویداد', 'wp-event-publisher' ); ?></span>
						<input type="text" name="hook_slug" placeholder="post_bumped" />
						<small><?php esc_html_e( 'سایت شما همین نام را به jarchi_automation_event پاس می‌دهد.', 'wp-event-publisher' ); ?></small>
					</label>
				</div>

				<div class="jarchi-rule-form__scan-warning" data-jarchi-scan-warning hidden>
					<?php esc_html_e( 'این رویداد لحظه‌ای نیست: هر ساعت همهٔ کاربران بررسی می‌شوند. حتماً پایین‌تر یک شرط بگذارید تا پیام برای همه نرود.', 'wp-event-publisher' ); ?>
				</div>
			</div>

			<div class="jarchi-rule-form__step">
				<h3><span class="jarchi-rule-form__num">۲</span> <?php esc_html_e( 'برای چه کسانی؟', 'wp-event-publisher' ); ?></h3>

				<label class="wpep-field">
					<span><?php esc_html_e( 'شرط', 'wp-event-publisher' ); ?></span>
					<select name="condition" data-jarchi-condition>
						<?php foreach ( $conditions as $wpep_key => $wpep_meta ) : ?>
							<option
								value="<?php echo esc_attr( $wpep_key ); ?>"
								data-value-type="<?php echo esc_attr( (string) $wpep_meta['value'] ); ?>"
								data-hint="<?php echo esc_attr( (string) $wpep_meta['hint'] ); ?>"
							><?php echo esc_html( (string) $wpep_meta['label'] ); ?></option>
						<?php endforeach; ?>
					</select>
					<small class="jarchi-rule-form__hint" data-jarchi-condition-hint></small>
				</label>

				<?php /* One control per value type; the script shows only the relevant one. */ ?>
				<label class="wpep-field" data-when-value="role" hidden>
					<span><?php esc_html_e( 'نقش', 'wp-event-publisher' ); ?></span>
					<select name="condition_value_role">
						<?php foreach ( $roles as $wpep_role_key => $wpep_role_label ) : ?>
							<option value="<?php echo esc_attr( (string) $wpep_role_key ); ?>"><?php echo esc_html( (string) $wpep_role_label ); ?></option>
						<?php endforeach; ?>
					</select>
				</label>

				<label class="wpep-field" data-when-value="number" hidden>
					<span><?php esc_html_e( 'مبلغ (تومان)', 'wp-event-publisher' ); ?></span>
					<input type="number" name="condition_value_number" min="0" step="1000" />
				</label>

				<label class="wpep-field" data-when-value="text" hidden>
					<span><?php esc_html_e( 'مقدار', 'wp-event-publisher' ); ?></span>
					<input type="text" name="condition_value_text" />
				</label>

				<div class="jarchi-rule-form__row" data-when-value="meta" hidden>
					<label class="wpep-field">
						<span><?php esc_html_e( 'نام فیلد کاربر', 'wp-event-publisher' ); ?></span>
						<input type="text" name="condition_key" />
					</label>
					<label class="wpep-field">
						<span><?php esc_html_e( 'مقدار مورد انتظار', 'wp-event-publisher' ); ?></span>
						<input type="text" name="condition_value_meta" />
					</label>
				</div>

				<?php /* The single field the server reads; the script keeps it in step. */ ?>
				<input type="hidden" name="condition_value" data-jarchi-condition-value value="" />
			</div>

			<div class="jarchi-rule-form__step">
				<h3><span class="jarchi-rule-form__num">۳</span> <?php esc_html_e( 'چه پیامی؟', 'wp-event-publisher' ); ?></h3>

				<label class="wpep-field">
					<span><?php esc_html_e( 'نام قانون (فقط برای خودتان)', 'wp-event-publisher' ); ?></span>
					<input type="text" name="name" required />
				</label>

				<label class="wpep-field">
					<span><?php esc_html_e( 'عنوان تیکت', 'wp-event-publisher' ); ?></span>
					<input type="text" name="subject" required />
				</label>

				<label class="wpep-field">
					<span><?php esc_html_e( 'متن تیکت', 'wp-event-publisher' ); ?></span>
					<textarea name="body" rows="7" required></textarea>
				</label>

				<details class="jarchi-rule-form__tokens">
					<summary><?php esc_html_e( 'جای‌گذاری‌های قابل استفاده', 'wp-event-publisher' ); ?></summary>
					<ul>
						<?php foreach ( $tokens as $wpep_token => $wpep_desc ) : ?>
							<li><code><?php echo esc_html( $wpep_token ); ?></code> — <?php echo esc_html( $wpep_desc ); ?></li>
						<?php endforeach; ?>
					</ul>
				</details>
			</div>

			<div class="jarchi-rule-form__step">
				<h3><span class="jarchi-rule-form__num">۴</span> <?php esc_html_e( 'چطور ارسال شود؟', 'wp-event-publisher' ); ?></h3>

				<div class="jarchi-rule-form__row">
					<label class="wpep-field">
						<span><?php esc_html_e( 'اولویت', 'wp-event-publisher' ); ?></span>
						<select name="priority">
							<?php foreach ( $priorities as $wpep_key => $wpep_label ) : ?>
								<option value="<?php echo esc_attr( $wpep_key ); ?>" <?php selected( 'normal', $wpep_key ); ?>><?php echo esc_html( $wpep_label ); ?></option>
							<?php endforeach; ?>
						</select>
					</label>

					<label class="wpep-field">
						<span><?php esc_html_e( 'دپارتمان', 'wp-event-publisher' ); ?></span>
						<select name="department">
							<option value="0"><?php esc_html_e( 'بدون دپارتمان', 'wp-event-publisher' ); ?></option>
							<?php foreach ( $departments as $wpep_term ) : ?>
								<option value="<?php echo esc_attr( (string) $wpep_term->term_id ); ?>"><?php echo esc_html( $wpep_term->name ); ?></option>
							<?php endforeach; ?>
						</select>
					</label>

					<label class="wpep-field">
						<span><?php esc_html_e( 'دسته‌بندی', 'wp-event-publisher' ); ?></span>
						<select name="category">
							<option value="0"><?php esc_html_e( 'بدون دسته‌بندی', 'wp-event-publisher' ); ?></option>
							<?php foreach ( $categories as $wpep_term ) : ?>
								<option value="<?php echo esc_attr( (string) $wpep_term->term_id ); ?>"><?php echo esc_html( $wpep_term->name ); ?></option>
							<?php endforeach; ?>
						</select>
					</label>

					<label class="wpep-field">
						<span><?php esc_html_e( 'تأخیر (دقیقه)', 'wp-event-publisher' ); ?></span>
						<input type="number" name="delay_minutes" min="0" max="10080" value="0" />
					</label>
				</div>

				<label class="wpep-checkbox"><input type="checkbox" name="allow_reply" value="1"> <span><?php esc_html_e( 'کاربر بتواند به این تیکت پاسخ دهد', 'wp-event-publisher' ); ?></span></label>
				<p class="jarchi-rule-form__note"><?php esc_html_e( 'اگر تیک نخورد، پیام فقط اطلاع‌رسانی است: تیکت بسته ساخته می‌شود و کاربر نمی‌تواند پاسخ بدهد.', 'wp-event-publisher' ); ?></p>

				<label class="wpep-checkbox"><input type="checkbox" name="once_per_user" value="1" checked> <span><?php esc_html_e( 'برای هر کاربر فقط یک بار', 'wp-event-publisher' ); ?></span></label>
				<p class="jarchi-rule-form__note"><?php esc_html_e( 'برای رویدادهایی مثل ثبت‌نام یا تکمیل پروفایل یعنی فقط یک تیکت در کل عمر حساب. برای رویدادهایی که روی یک چیز مشخص رخ می‌دهند (آگهی، سفارش) یعنی یک تیکت برای هر آگهی یا هر سفارش؛ همان آگهی هر چند بار هم منتشر شود، تیکت دوم ساخته نمی‌شود.', 'wp-event-publisher' ); ?></p>
				<label class="wpep-checkbox"><input type="checkbox" name="enabled" value="1"> <span><?php esc_html_e( 'همین حالا روشن باشد', 'wp-event-publisher' ); ?></span></label>
			</div>

			<button type="submit" class="button button-primary"><?php esc_html_e( 'ذخیره قانون', 'wp-event-publisher' ); ?></button>
		</form>
	</section>
</div>
