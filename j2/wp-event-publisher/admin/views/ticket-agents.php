<?php
/**
 * Support agents screen.
 *
 * @package WPEventPublisher
 *
 * @var array<int,object> $agents      Current support agents.
 * @var array<int,object> $users       Candidate users.
 * @var \WP_Term[]        $departments Departments an agent may answer for.
 * @var string            $notice      Result of the last action.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_tickets = wpep()->tickets();
?>
<div class="wrap wpep-wrap wpep-dashboard wpep-inner-page" dir="rtl">

	<?php if ( '' !== (string) $notice ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php echo esc_html( $notice ); ?></p></div>
	<?php endif; ?>

	<section class="wpep-card">
		<div class="wpep-card__head">
			<div>
				<h2 class="wpep-card__title"><?php esc_html_e( 'پشتیبان‌های جارچی', 'wp-event-publisher' ); ?></h2>
				<p class="wpep-card__hint"><?php esc_html_e( 'کاربرانی که پاسخ تیکت‌ها را مدیریت می‌کنند. هر پشتیبان فقط تیکت‌های دپارتمان‌های خودش را می‌بیند؛ اگر هیچ دپارتمانی انتخاب نشود، هیچ تیکتی نمی‌بیند.', 'wp-event-publisher' ); ?></p>
			</div>
		</div>

		<?php if ( empty( $departments ) ) : ?>
			<div class="notice notice-warning inline" style="margin:12px 0">
				<p><?php esc_html_e( 'هنوز دپارتمانی تعریف نشده است. تا وقتی دپارتمانی نباشد، نمی‌توان دسترسی پشتیبان را محدود کرد.', 'wp-event-publisher' ); ?></p>
			</div>
		<?php endif; ?>

		<form method="post" style="margin:16px 0">
			<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>

			<label class="wpep-field" style="display:block;max-width:420px">
				<span><?php esc_html_e( 'کاربر', 'wp-event-publisher' ); ?></span>
				<select name="user_id" required style="width:100%">
					<option value=""><?php esc_html_e( 'انتخاب کاربر', 'wp-event-publisher' ); ?></option>
					<?php foreach ( $users as $wpep_user ) : ?>
						<?php if ( in_array( 'jarchi_support_agent', (array) $wpep_user->roles, true ) ) { continue; } ?>
						<option value="<?php echo esc_attr( (string) $wpep_user->ID ); ?>"><?php echo esc_html( $wpep_user->display_name . ' — ' . $wpep_user->user_email ); ?></option>
					<?php endforeach; ?>
				</select>
			</label>

			<?php if ( ! empty( $departments ) ) : ?>
				<fieldset style="margin-top:12px">
					<legend><strong><?php esc_html_e( 'دپارتمان‌های این پشتیبان', 'wp-event-publisher' ); ?></strong></legend>
					<div class="wpep-checkbox-grid">
						<?php foreach ( $departments as $wpep_department ) : ?>
							<label class="wpep-checkbox">
								<input type="checkbox" name="departments[]" value="<?php echo esc_attr( (string) $wpep_department->term_id ); ?>" />
								<span><?php echo esc_html( $wpep_department->name ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>
				</fieldset>
			<?php endif; ?>

			<button type="submit" class="button button-primary" name="jarchi_add_agent" value="1" style="margin-top:12px"><?php esc_html_e( 'افزودن پشتیبان', 'wp-event-publisher' ); ?></button>
		</form>
	</section>

	<section class="wpep-card">
		<h2 class="wpep-card__title"><?php esc_html_e( 'پشتیبان‌های فعلی', 'wp-event-publisher' ); ?></h2>

		<?php if ( empty( $agents ) ) : ?>
			<div class="wpep-empty"><?php esc_html_e( 'هنوز پشتیبانی اضافه نشده است.', 'wp-event-publisher' ); ?></div>
		<?php else : ?>
			<div class="wpep-ticket-list">
				<?php foreach ( $agents as $wpep_agent ) : ?>
					<?php
					$wpep_summary = $wpep_tickets->agent_rating_summary( (int) $wpep_agent->ID );
					$wpep_own     = $wpep_tickets->agent_departments( (int) $wpep_agent->ID );
					?>
					<div class="wpep-agent-row">
						<div class="wpep-agent-row__head">
							<span>
								<strong><?php echo esc_html( $wpep_agent->display_name ); ?></strong>
								<small>
									<?php echo esc_html( $wpep_agent->user_email ); ?> ·
									<?php echo esc_html( $wpep_summary['average'] ? sprintf( '%s/5', $wpep_summary['average'] ) : __( 'بدون امتیاز', 'wp-event-publisher' ) ); ?>
								</small>
							</span>

							<form method="post" class="wpep-inline-form">
								<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>
								<input type="hidden" name="user_id" value="<?php echo esc_attr( (string) $wpep_agent->ID ); ?>" />
								<button
									type="submit"
									class="button button-link-delete"
									name="jarchi_remove_agent"
									value="1"
									onclick="return confirm('<?php echo esc_js( __( 'این کاربر از پشتیبان‌ها حذف شود؟', 'wp-event-publisher' ) ); ?>');"
								><?php esc_html_e( 'حذف از پشتیبان‌ها', 'wp-event-publisher' ); ?></button>
							</form>
						</div>

						<?php if ( ! empty( $departments ) ) : ?>
							<form method="post" class="wpep-agent-row__departments">
								<?php wp_nonce_field( WPEventPublisher\Tickets::NONCE ); ?>
								<input type="hidden" name="user_id" value="<?php echo esc_attr( (string) $wpep_agent->ID ); ?>" />

								<div class="wpep-checkbox-grid">
									<?php foreach ( $departments as $wpep_department ) : ?>
										<label class="wpep-checkbox">
											<input
												type="checkbox"
												name="departments[]"
												value="<?php echo esc_attr( (string) $wpep_department->term_id ); ?>"
												<?php checked( in_array( (int) $wpep_department->term_id, $wpep_own, true ) ); ?>
											/>
											<span><?php echo esc_html( $wpep_department->name ); ?></span>
										</label>
									<?php endforeach; ?>
								</div>

								<button type="submit" class="button" name="jarchi_agent_departments" value="1"><?php esc_html_e( 'ذخیره دپارتمان‌ها', 'wp-event-publisher' ); ?></button>

								<?php if ( empty( $wpep_own ) ) : ?>
									<p class="wpep-agent-row__warning"><?php esc_html_e( 'این پشتیبان به هیچ دپارتمانی متصل نیست و هیچ تیکتی نمی‌بیند.', 'wp-event-publisher' ); ?></p>
								<?php endif; ?>
							</form>
						<?php endif; ?>
					</div>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</section>
</div>
