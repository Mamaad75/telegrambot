<?php
/**
 * Jarchi announcement builder.
 *
 * Two columns on a desktop: what the announcement says on the left, and
 * everything that decides where and when it appears on the right. One column
 * on a narrow screen, in the same order.
 *
 * @package WPEventPublisher
 *
 * @var array<string,mixed>              $state      Announcement being edited.
 * @var array<string,array>              $placements Placement registry.
 * @var array<string,string[]>           $relevant   Option keys per placement.
 * @var array<string,array>              $schema     Option labels and control types.
 * @var array<string,string>             $subjects   Condition subjects.
 * @var array<string,string>             $operators  Condition operators.
 * @var string[]                         $icons      Selectable dashicon names.
 * @var array<string,string>             $roles      Role slug mapped to name.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

use WPEventPublisher\AnnouncementBuilder;
use WPEventPublisher\Announcements;

// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
$wpep_result = isset( $_GET['wpep_result'] ) ? sanitize_key( wp_unslash( (string) $_GET['wpep_result'] ) ) : '';
$wpep_new    = 0 === (int) $state['id'];

$wpep_groups = array();

foreach ( $placements as $wpep_key => $wpep_meta ) {
	$wpep_groups[ (string) ( $wpep_meta['group'] ?? '' ) ][ $wpep_key ] = (string) $wpep_meta['label'];
}
?>
<div class="wrap wpep-wrap wpep-builder-screen">

	<?php if ( 'saved' === $wpep_result ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'اطلاعیه ذخیره شد.', 'wp-event-publisher' ); ?></p></div>
	<?php elseif ( 'duplicated' === $wpep_result ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'رونوشت ساخته شد. این نسخه پیش‌نویس است.', 'wp-event-publisher' ); ?></p></div>
	<?php elseif ( 'error' === $wpep_result ) : ?>
		<div class="notice notice-error is-dismissible"><p><?php esc_html_e( 'ذخیره نشد. دوباره تلاش کنید.', 'wp-event-publisher' ); ?></p></div>
	<?php endif; ?>

	<form
		class="wpep-builder"
		method="post"
		action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"
		data-wpep-builder
	>
		<input type="hidden" name="action" value="<?php echo esc_attr( AnnouncementBuilder::ACTION_SAVE ); ?>" />
		<input type="hidden" name="announcement_id" value="<?php echo esc_attr( (string) $state['id'] ); ?>" />
		<input type="hidden" name="post_status" value="<?php echo esc_attr( (string) $state['status'] ); ?>" data-wpep-status />
		<?php wp_nonce_field( AnnouncementBuilder::NONCE, 'wpep_nonce' ); ?>

		<header class="wpep-builder__bar">
			<div class="wpep-builder__identity">
				<h1>
					<?php echo $wpep_new ? esc_html__( 'اطلاعیه تازه', 'wp-event-publisher' ) : esc_html__( 'ویرایش اطلاعیه', 'wp-event-publisher' ); ?>
				</h1>
				<span class="wpep-builder__state" data-wpep-dirty-label hidden>
					<?php esc_html_e( 'تغییرات ذخیره‌نشده', 'wp-event-publisher' ); ?>
				</span>
			</div>

			<div class="wpep-builder__actions">
				<?php if ( ! $wpep_new ) : ?>
					<a class="button" href="<?php echo esc_url( get_permalink( (int) $state['id'] ) ?: '#' ); ?>" target="_blank" rel="noopener">
						<?php esc_html_e( 'مشاهده', 'wp-event-publisher' ); ?>
					</a>
				<?php endif; ?>

				<button type="submit" class="button" data-wpep-save="draft">
					<?php esc_html_e( 'ذخیره پیش‌نویس', 'wp-event-publisher' ); ?>
				</button>

				<button type="submit" class="button button-primary" data-wpep-save="publish">
					<?php echo 'publish' === $state['status'] ? esc_html__( 'ذخیره تغییرات', 'wp-event-publisher' ) : esc_html__( 'انتشار', 'wp-event-publisher' ); ?>
				</button>
			</div>
		</header>

		<div class="wpep-builder__grid">

			<!-- ---------------------------------------------------------- -->
			<!-- Main content.                                              -->
			<!-- ---------------------------------------------------------- -->
			<div class="wpep-builder__main">

				<section class="wpep-card">
					<h2 class="wpep-card__title"><?php esc_html_e( 'محتوای اطلاعیه', 'wp-event-publisher' ); ?></h2>

					<p class="wpep-field">
						<label for="wpep-title"><strong><?php esc_html_e( 'عنوان', 'wp-event-publisher' ); ?></strong></label>
						<input
							type="text"
							id="wpep-title"
							name="post_title"
							class="wpep-input wpep-input--lg"
							value="<?php echo esc_attr( (string) $state['title'] ); ?>"
							placeholder="<?php esc_attr_e( 'مثلاً: تعطیلی نوروزی پشتیبانی', 'wp-event-publisher' ); ?>"
							data-wpep-preview-field="title"
						/>
					</p>

					<p class="wpep-field">
						<label for="wpep-content"><strong><?php esc_html_e( 'متن', 'wp-event-publisher' ); ?></strong></label>
						<textarea
							id="wpep-content"
							name="post_content"
							rows="9"
							class="wpep-input"
							placeholder="<?php esc_attr_e( 'توضیح کوتاهی بنویسید…', 'wp-event-publisher' ); ?>"
							data-wpep-preview-field="content"
						><?php echo esc_textarea( (string) $state['content'] ); ?></textarea>
						<span class="wpep-card__hint"><?php esc_html_e( 'می‌توانید از تگ‌های ساده HTML استفاده کنید.', 'wp-event-publisher' ); ?></span>
					</p>
				</section>

				<section class="wpep-card">
					<h2 class="wpep-card__title"><?php esc_html_e( 'تصویر و نماد', 'wp-event-publisher' ); ?></h2>

					<div class="wpep-builder__pair">
						<div class="wpep-field">
							<label><strong><?php esc_html_e( 'تصویر', 'wp-event-publisher' ); ?></strong></label>

							<div class="wpep-media" data-wpep-media>
								<input type="hidden" name="wpep_image_id" value="<?php echo esc_attr( (string) $state['image_id'] ); ?>" data-wpep-media-id data-wpep-preview-field="image" />

								<div class="wpep-media__frame" data-wpep-media-frame>
									<?php if ( '' !== $state['image_url'] ) : ?>
										<img src="<?php echo esc_url( (string) $state['image_url'] ); ?>" alt="" />
									<?php else : ?>
										<span class="dashicons dashicons-format-image" aria-hidden="true"></span>
									<?php endif; ?>
								</div>

								<div class="wpep-media__actions">
									<button type="button" class="button" data-wpep-media-pick><?php esc_html_e( 'انتخاب تصویر', 'wp-event-publisher' ); ?></button>
									<button type="button" class="button-link" data-wpep-media-clear<?php echo '' === $state['image_url'] ? ' hidden' : ''; ?>><?php esc_html_e( 'حذف', 'wp-event-publisher' ); ?></button>
								</div>
							</div>
						</div>

						<div class="wpep-field">
							<label><strong><?php esc_html_e( 'نماد', 'wp-event-publisher' ); ?></strong></label>
							<span class="wpep-card__hint"><?php esc_html_e( 'وقتی تصویری انتخاب نشده باشد، این نماد نمایش داده می‌شود.', 'wp-event-publisher' ); ?></span>

							<div class="wpep-iconpicker" role="radiogroup" aria-label="<?php esc_attr_e( 'نماد اطلاعیه', 'wp-event-publisher' ); ?>">
								<label class="wpep-iconpicker__item<?php echo '' === $state['icon'] ? ' is-on' : ''; ?>">
									<input type="radio" name="wpep_icon" value="" <?php checked( '', (string) $state['icon'] ); ?> data-wpep-preview-field="icon" />
									<span class="dashicons dashicons-minus" aria-hidden="true"></span>
									<span class="screen-reader-text"><?php esc_html_e( 'بدون نماد', 'wp-event-publisher' ); ?></span>
								</label>

								<?php foreach ( $icons as $wpep_icon ) : ?>
									<label class="wpep-iconpicker__item<?php echo $wpep_icon === $state['icon'] ? ' is-on' : ''; ?>">
										<input type="radio" name="wpep_icon" value="<?php echo esc_attr( $wpep_icon ); ?>" <?php checked( $wpep_icon, (string) $state['icon'] ); ?> data-wpep-preview-field="icon" />
										<span class="dashicons dashicons-<?php echo esc_attr( $wpep_icon ); ?>" aria-hidden="true"></span>
										<span class="screen-reader-text"><?php echo esc_html( $wpep_icon ); ?></span>
									</label>
								<?php endforeach; ?>
							</div>
						</div>
					</div>
				</section>

				<section class="wpep-card">
					<h2 class="wpep-card__title"><?php esc_html_e( 'دکمه اقدام', 'wp-event-publisher' ); ?></h2>

					<p class="wpep-field">
						<label for="wpep-link"><strong><?php esc_html_e( 'نشانی مقصد', 'wp-event-publisher' ); ?></strong></label>
						<input
							type="url"
							id="wpep-link"
							name="wpep_link"
							class="wpep-input"
							dir="ltr"
							value="<?php echo esc_attr( (string) $state['link'] ); ?>"
							placeholder="https://"
							data-wpep-preview-field="link"
						/>
						<span class="wpep-card__hint"><?php esc_html_e( 'خالی بگذارید تا اطلاعیه بدون دکمه نمایش داده شود.', 'wp-event-publisher' ); ?></span>
					</p>
				</section>

				<!-- Preview: the real front-end component, not a mock-up. -->
				<section class="wpep-card wpep-preview" data-wpep-preview>
					<div class="wpep-preview__head">
						<h2 class="wpep-card__title"><?php esc_html_e( 'پیش‌نمایش', 'wp-event-publisher' ); ?></h2>

						<div class="wpep-preview__switches">
							<div class="wpep-seg" role="group" aria-label="<?php esc_attr_e( 'اندازه صفحه', 'wp-event-publisher' ); ?>">
								<button type="button" class="is-on" data-wpep-preview-device="desktop"><?php esc_html_e( 'دسکتاپ', 'wp-event-publisher' ); ?></button>
								<button type="button" data-wpep-preview-device="mobile"><?php esc_html_e( 'موبایل', 'wp-event-publisher' ); ?></button>
							</div>

							<div class="wpep-seg" role="group" aria-label="<?php esc_attr_e( 'حالت نمایش', 'wp-event-publisher' ); ?>">
								<button type="button" class="is-on" data-wpep-preview-theme="light"><?php esc_html_e( 'روشن', 'wp-event-publisher' ); ?></button>
								<button type="button" data-wpep-preview-theme="dark"><?php esc_html_e( 'تیره', 'wp-event-publisher' ); ?></button>
							</div>
						</div>
					</div>

					<div class="wpep-preview__stage is-desktop" data-theme="light" data-wpep-preview-stage>
						<div class="wpep-preview__surface" data-wpep-preview-surface>
							<p class="wpep-preview__empty"><?php esc_html_e( 'در حال آماده‌سازی پیش‌نمایش…', 'wp-event-publisher' ); ?></p>
						</div>
					</div>

					<p class="wpep-card__hint"><?php esc_html_e( 'پیش‌نمایش با همان اجزایی ساخته می‌شود که بازدیدکننده می‌بیند.', 'wp-event-publisher' ); ?></p>
				</section>
			</div>

			<!-- ---------------------------------------------------------- -->
			<!-- Settings.                                                  -->
			<!-- ---------------------------------------------------------- -->
			<aside class="wpep-builder__side">

				<section class="wpep-card">
					<h2 class="wpep-card__title"><?php esc_html_e( 'وضعیت', 'wp-event-publisher' ); ?></h2>

					<p class="wpep-field">
						<label for="wpep-priority"><strong><?php esc_html_e( 'اولویت', 'wp-event-publisher' ); ?></strong></label>
						<input type="number" id="wpep-priority" name="wpep_priority" class="wpep-input" min="-100" max="100" value="<?php echo esc_attr( (string) $state['priority'] ); ?>" />
						<span class="wpep-card__hint"><?php esc_html_e( 'عدد بزرگ‌تر بالاتر نمایش داده می‌شود. از ۱۰ به بالا نشان «مهم» می‌گیرد.', 'wp-event-publisher' ); ?></span>
					</p>

					<p class="wpep-field">
						<label for="wpep-expires"><strong><?php esc_html_e( 'تاریخ انقضا', 'wp-event-publisher' ); ?></strong></label>
						<input type="date" id="wpep-expires" name="wpep_expires_at" class="wpep-input" value="<?php echo esc_attr( (string) $state['expires'] ); ?>" />
						<span class="wpep-card__hint"><?php esc_html_e( 'خالی بگذارید تا اطلاعیه منقضی نشود.', 'wp-event-publisher' ); ?></span>
					</p>
				</section>

				<section class="wpep-card">
					<h2 class="wpep-card__title"><?php esc_html_e( 'مخاطب', 'wp-event-publisher' ); ?></h2>

					<div class="wpep-choices">
						<?php
						$wpep_audiences = array(
							Announcements::AUDIENCE_PUBLIC    => __( 'همه بازدیدکنندگان', 'wp-event-publisher' ),
							Announcements::AUDIENCE_LOGGED_IN => __( 'فقط کاربران وارد شده', 'wp-event-publisher' ),
						);
						?>
						<?php foreach ( $wpep_audiences as $wpep_value => $wpep_label ) : ?>
							<label class="wpep-choice<?php echo $wpep_value === $state['audience'] ? ' is-on' : ''; ?>">
								<input type="radio" name="wpep_audience" value="<?php echo esc_attr( $wpep_value ); ?>" <?php checked( $wpep_value, (string) $state['audience'] ); ?> />
								<span><?php echo esc_html( $wpep_label ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>

					<p class="wpep-card__hint">
						<?php esc_html_e( 'برای شرط‌های دقیق‌تر — مثلاً یک نقش خاص — از بخش «شرط‌های نمایش» استفاده کنید.', 'wp-event-publisher' ); ?>
					</p>
				</section>

				<section class="wpep-card">
					<h2 class="wpep-card__title"><?php esc_html_e( 'محل نمایش', 'wp-event-publisher' ); ?></h2>

					<p class="wpep-field">
						<label for="wpep-placement" class="screen-reader-text"><?php esc_html_e( 'محل نمایش', 'wp-event-publisher' ); ?></label>
						<select id="wpep-placement" name="wpep_placement" class="wpep-input" data-wpep-placement data-wpep-preview-field="placement">
							<?php foreach ( $wpep_groups as $wpep_group => $wpep_items ) : ?>
								<optgroup label="<?php echo esc_attr( $wpep_group ); ?>">
									<?php foreach ( $wpep_items as $wpep_key => $wpep_label ) : ?>
										<option value="<?php echo esc_attr( $wpep_key ); ?>" <?php selected( $wpep_key, (string) $state['placement'] ); ?>>
											<?php echo esc_html( $wpep_label ); ?>
										</option>
									<?php endforeach; ?>
								</optgroup>
							<?php endforeach; ?>
						</select>
					</p>

					<?php
					// Every option is rendered, and the script reveals only the
					// ones the chosen placement uses. Rendering them all keeps
					// a value that was already stored from being wiped just
					// because its panel happened to be hidden at save time.
					?>
					<div class="wpep-placement-options">
						<?php foreach ( $schema as $wpep_opt => $wpep_meta ) : ?>
							<?php
							$wpep_for   = array();
							$wpep_value = $state['options'][ $wpep_opt ] ?? null;

							foreach ( $relevant as $wpep_place => $wpep_keys ) {
								if ( in_array( $wpep_opt, $wpep_keys, true ) ) {
									$wpep_for[] = $wpep_place;
								}
							}
							?>
							<div
								class="wpep-field wpep-placement-option"
								data-wpep-option-for="<?php echo esc_attr( implode( ' ', $wpep_for ) ); ?>"
								hidden
							>
								<?php if ( 'switch' === $wpep_meta['type'] ) : ?>
									<label class="wpep-switch">
										<input type="hidden" name="wpep_placement_options[<?php echo esc_attr( $wpep_opt ); ?>]" value="0" />
										<input type="checkbox" name="wpep_placement_options[<?php echo esc_attr( $wpep_opt ); ?>]" value="1" <?php checked( ! empty( $wpep_value ) ); ?> />
										<span class="wpep-switch__track" aria-hidden="true"></span>
										<span class="wpep-switch__label"><?php echo esc_html( (string) $wpep_meta['label'] ); ?></span>
									</label>

								<?php elseif ( 'select' === $wpep_meta['type'] ) : ?>
									<label for="wpep-opt-<?php echo esc_attr( $wpep_opt ); ?>"><strong><?php echo esc_html( (string) $wpep_meta['label'] ); ?></strong></label>
									<select id="wpep-opt-<?php echo esc_attr( $wpep_opt ); ?>" name="wpep_placement_options[<?php echo esc_attr( $wpep_opt ); ?>]" class="wpep-input">
										<?php foreach ( (array) $wpep_meta['choices'] as $wpep_ck => $wpep_cl ) : ?>
											<option value="<?php echo esc_attr( (string) $wpep_ck ); ?>" <?php selected( (string) $wpep_ck, (string) $wpep_value ); ?>>
												<?php echo esc_html( (string) $wpep_cl ); ?>
											</option>
										<?php endforeach; ?>
									</select>

								<?php else : ?>
									<label for="wpep-opt-<?php echo esc_attr( $wpep_opt ); ?>"><strong><?php echo esc_html( (string) $wpep_meta['label'] ); ?></strong></label>
									<input
										type="number"
										id="wpep-opt-<?php echo esc_attr( $wpep_opt ); ?>"
										name="wpep_placement_options[<?php echo esc_attr( $wpep_opt ); ?>]"
										class="wpep-input"
										min="<?php echo esc_attr( (string) ( $wpep_meta['min'] ?? 0 ) ); ?>"
										max="<?php echo esc_attr( (string) ( $wpep_meta['max'] ?? 9999 ) ); ?>"
										value="<?php echo esc_attr( (string) $wpep_value ); ?>"
									/>
								<?php endif; ?>
							</div>
						<?php endforeach; ?>

						<p class="wpep-card__hint" data-wpep-no-options hidden>
							<?php esc_html_e( 'این محل نمایش تنظیم دیگری ندارد.', 'wp-event-publisher' ); ?>
						</p>
					</div>
				</section>

				<section class="wpep-card">
					<h2 class="wpep-card__title"><?php esc_html_e( 'شرط‌های نمایش', 'wp-event-publisher' ); ?></h2>

					<p class="wpep-card__hint">
						<?php esc_html_e( 'اگر شرطی نگذارید، اطلاعیه همه‌جا — در همان محلی که انتخاب کرده‌اید — نمایش داده می‌شود.', 'wp-event-publisher' ); ?>
					</p>

					<p class="wpep-field">
						<label for="wpep-match"><strong><?php esc_html_e( 'نمایش داده شود وقتی', 'wp-event-publisher' ); ?></strong></label>
						<select id="wpep-match" name="wpep_conditions[match]" class="wpep-input">
							<option value="all" <?php selected( 'all', (string) $state['conditions']['match'] ); ?>><?php esc_html_e( 'همه شرط‌ها برقرار باشند', 'wp-event-publisher' ); ?></option>
							<option value="any" <?php selected( 'any', (string) $state['conditions']['match'] ); ?>><?php esc_html_e( 'دست‌کم یکی از شرط‌ها برقرار باشد', 'wp-event-publisher' ); ?></option>
						</select>
					</p>

					<div class="wpep-rules" data-wpep-rules>
						<?php foreach ( (array) $state['conditions']['rules'] as $wpep_i => $wpep_rule ) : ?>
							<div class="wpep-rule" data-wpep-rule>
								<select name="wpep_conditions[rules][<?php echo (int) $wpep_i; ?>][subject]" class="wpep-input">
									<?php foreach ( $subjects as $wpep_sk => $wpep_sl ) : ?>
										<option value="<?php echo esc_attr( $wpep_sk ); ?>" <?php selected( $wpep_sk, (string) ( $wpep_rule['subject'] ?? '' ) ); ?>><?php echo esc_html( $wpep_sl ); ?></option>
									<?php endforeach; ?>
								</select>

								<select name="wpep_conditions[rules][<?php echo (int) $wpep_i; ?>][operator]" class="wpep-input">
									<?php foreach ( $operators as $wpep_ok => $wpep_ol ) : ?>
										<option value="<?php echo esc_attr( $wpep_ok ); ?>" <?php selected( $wpep_ok, (string) ( $wpep_rule['operator'] ?? 'is' ) ); ?>><?php echo esc_html( $wpep_ol ); ?></option>
									<?php endforeach; ?>
								</select>

								<input type="text" name="wpep_conditions[rules][<?php echo (int) $wpep_i; ?>][value]" class="wpep-input" value="<?php echo esc_attr( (string) ( $wpep_rule['value'] ?? '' ) ); ?>" />

								<button type="button" class="wpep-rule__remove" data-wpep-rule-remove aria-label="<?php esc_attr_e( 'حذف شرط', 'wp-event-publisher' ); ?>">
									<span class="dashicons dashicons-no-alt" aria-hidden="true"></span>
								</button>
							</div>
						<?php endforeach; ?>
					</div>

					<p class="wpep-rules__empty" data-wpep-rules-empty<?php echo empty( $state['conditions']['rules'] ) ? '' : ' hidden'; ?>>
						<?php esc_html_e( 'هنوز شرطی اضافه نشده است.', 'wp-event-publisher' ); ?>
					</p>

					<button type="button" class="button" data-wpep-rule-add>
						<span class="dashicons dashicons-plus-alt2" aria-hidden="true"></span>
						<?php esc_html_e( 'افزودن شرط', 'wp-event-publisher' ); ?>
					</button>

					<?php if ( ! empty( $roles ) ) : ?>
						<p class="wpep-card__hint">
							<?php
							printf(
								/* translators: %s: comma separated role slugs. */
								esc_html__( 'نقش‌های موجود: %s', 'wp-event-publisher' ),
								esc_html( implode( '، ', array_keys( $roles ) ) )
							);
							?>
						</p>
					<?php endif; ?>

					<!-- The blank row the "add" button clones. -->
					<template data-wpep-rule-template>
						<div class="wpep-rule" data-wpep-rule>
							<select data-name="subject" class="wpep-input">
								<?php foreach ( $subjects as $wpep_sk => $wpep_sl ) : ?>
									<option value="<?php echo esc_attr( $wpep_sk ); ?>"><?php echo esc_html( $wpep_sl ); ?></option>
								<?php endforeach; ?>
							</select>

							<select data-name="operator" class="wpep-input">
								<?php foreach ( $operators as $wpep_ok => $wpep_ol ) : ?>
									<option value="<?php echo esc_attr( $wpep_ok ); ?>"><?php echo esc_html( $wpep_ol ); ?></option>
								<?php endforeach; ?>
							</select>

							<input type="text" data-name="value" class="wpep-input" />

							<button type="button" class="wpep-rule__remove" data-wpep-rule-remove aria-label="<?php esc_attr_e( 'حذف شرط', 'wp-event-publisher' ); ?>">
								<span class="dashicons dashicons-no-alt" aria-hidden="true"></span>
							</button>
						</div>
					</template>
				</section>
			</aside>
		</div>
	</form>
</div>
