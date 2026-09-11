<?php
/**
 * WooCommerce order notification settings.
 *
 * Only reachable when WooCommerce is active; {@see WPEventPublisher\Admin}
 * does not register the screen otherwise.
 *
 * @package WPEventPublisher
 *
 * @var array<string,mixed>  $settings  Plugin settings.
 * @var array<string,string> $events    Selectable order events.
 * @var array<string,string> $fields    Order field labels.
 * @var array<string,array>  $mapping   Stored order field mapping.
 * @var array<string,string> $platforms  Platform display names.
 * @var array<string,bool>   $configured Which platforms the site has switched on.
 * @var array<string,mixed>  $recent     Recent order events that were queued.
 * @var array<string,mixed>  $skipped    Recent order events that were not sent.
 * @var array<string,array>  $resolved   Targets the event pipeline would use.
 * @var string               $currency   Shop currency code.
 * @var bool                 $hpos       Whether HPOS is enabled.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_option   = WPEventPublisher\Settings::OPTION;
$wpep_selected = (array) ( $settings['order_events'] ?? array() );
$wpep_targets  = (array) ( $settings['order_platforms'] ?? array() );
$wpep_on       = ! empty( $settings['orders_enabled'] );
?>
<div class="wrap wpep-wrap">
	<h1><?php esc_html_e( 'سفارش‌های ووکامرس', 'wp-event-publisher' ); ?></h1>

	<p class="description">
		<?php esc_html_e( 'وقتی سفارشی ثبت می‌شود یا وضعیتش تغییر می‌کند، جارچی می‌تواند یک پیام به کانال‌های شما بفرستد.', 'wp-event-publisher' ); ?>
	</p>

	<?php settings_errors(); ?>

	<div class="wpep-card wpep-status-row">
		<span class="wpep-status wpep-status--ok">
			<span class="wpep-status__dot" aria-hidden="true"></span>
			<?php esc_html_e( 'ووکامرس شناسایی شد', 'wp-event-publisher' ); ?>
		</span>

		<span class="wpep-status <?php echo $hpos ? 'wpep-status--ok' : 'wpep-status--info'; ?>">
			<span class="wpep-status__dot" aria-hidden="true"></span>
			<?php
			echo esc_html(
				$hpos
					? __( 'ذخیره‌سازی پرسرعت سفارش‌ها (HPOS) فعال است', 'wp-event-publisher' )
					: __( 'ذخیره‌سازی کلاسیک سفارش‌ها', 'wp-event-publisher' )
			);
			?>
		</span>

		<p class="wpep-card__hint" style="flex:1 0 100%">
			<?php esc_html_e( 'جارچی سفارش‌ها را از طریق خودِ ووکامرس می‌خواند، بنابراین در هر دو حالت ذخیره‌سازی یکسان کار می‌کند.', 'wp-event-publisher' ); ?>
		</p>
	</div>

	<form method="post" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>">
		<?php settings_fields( WPEventPublisher\Settings::GROUP ); ?>

		<div class="wpep-card">
			<h2 class="wpep-card__title"><?php esc_html_e( 'اطلاع‌رسانی سفارش‌ها', 'wp-event-publisher' ); ?></h2>

			<p>
				<label class="wpep-switch">
					<input
						type="checkbox"
						name="<?php echo esc_attr( $wpep_option ); ?>[orders_enabled]"
						value="1"
						<?php checked( $wpep_on ); ?>
					/>
					<span class="wpep-switch__track" aria-hidden="true"></span>
					<span class="wpep-switch__label"><?php esc_html_e( 'ارسال پیام برای سفارش‌های ووکامرس', 'wp-event-publisher' ); ?></span>
				</label>
			</p>

			<p class="wpep-card__hint">
				<?php esc_html_e( 'تا وقتی این گزینه خاموش است هیچ پیامی درباره سفارش‌ها فرستاده نمی‌شود.', 'wp-event-publisher' ); ?>
			</p>
		</div>

		<div class="wpep-card">
			<h2 class="wpep-card__title"><?php esc_html_e( 'چه رویدادهایی پیام بفرستند؟', 'wp-event-publisher' ); ?></h2>

			<p class="wpep-card__hint">
				<?php esc_html_e( 'هر رویداد فقط یک‌بار برای هر سفارش فرستاده می‌شود، حتی اگر ووکامرس آن وضعیت را دوباره اعلام کند.', 'wp-event-publisher' ); ?>
			</p>

			<div class="wpep-platform-group">
				<?php foreach ( $events as $wpep_code => $wpep_label ) : ?>
					<label class="wpep-chip<?php echo in_array( $wpep_code, $wpep_selected, true ) ? ' is-on' : ''; ?>">
						<input
							type="checkbox"
							name="<?php echo esc_attr( $wpep_option ); ?>[order_events][]"
							value="<?php echo esc_attr( $wpep_code ); ?>"
							<?php checked( in_array( $wpep_code, $wpep_selected, true ) ); ?>
						/>
						<span><?php echo esc_html( $wpep_label ); ?></span>
					</label>
				<?php endforeach; ?>
			</div>
		</div>

		<div class="wpep-card">
			<h2 class="wpep-card__title"><?php esc_html_e( 'به کدام پلتفرم‌ها فرستاده شود؟', 'wp-event-publisher' ); ?></h2>

			<p class="wpep-card__hint">
				<?php esc_html_e( 'اگر چیزی انتخاب نکنید، از همان پلتفرم‌هایی استفاده می‌شود که در تنظیمات هر پلتفرم روشن کرده‌اید.', 'wp-event-publisher' ); ?>
			</p>

			<div class="wpep-platform-group">
				<?php foreach ( $platforms as $wpep_key => $wpep_name ) : ?>
					<?php $wpep_ready = ! empty( $configured[ $wpep_key ] ); ?>
					<label class="wpep-chip<?php echo in_array( $wpep_key, $wpep_targets, true ) ? ' is-on' : ''; ?><?php echo $wpep_ready ? '' : ' is-unavailable'; ?>">
						<input
							type="checkbox"
							name="<?php echo esc_attr( $wpep_option ); ?>[order_platforms][]"
							value="<?php echo esc_attr( $wpep_key ); ?>"
							<?php checked( in_array( $wpep_key, $wpep_targets, true ) ); ?>
							<?php disabled( ! $wpep_ready ); ?>
						/>
						<span><?php echo esc_html( $wpep_name ); ?></span>
						<?php if ( ! $wpep_ready ) : ?>
							<em><?php esc_html_e( 'تنظیم نشده', 'wp-event-publisher' ); ?></em>
						<?php endif; ?>
					</label>
				<?php endforeach; ?>
			</div>

			<?php
			// What will actually happen, computed by the same method the event
			// pipeline calls. A setting screen that cannot show its own effect
			// is how "the toggle does nothing" goes unnoticed.
			$wpep_live = array();

			foreach ( $resolved as $wpep_id => $wpep_target ) {
				if ( ! empty( $wpep_target['enabled'] ) ) {
					$wpep_live[] = $platforms[ $wpep_id ] ?? $wpep_id;
				}
			}
			?>

			<p class="wpep-card__hint" style="margin-top:.8rem">
				<?php if ( ! $wpep_on ) : ?>
					<?php esc_html_e( 'اعلان سفارش‌ها خاموش است، بنابراین فعلاً چیزی فرستاده نمی‌شود.', 'wp-event-publisher' ); ?>
				<?php elseif ( empty( $wpep_live ) ) : ?>
					<strong><?php esc_html_e( 'در حال حاضر هیچ پلتفرمی پیام سفارش دریافت نمی‌کند.', 'wp-event-publisher' ); ?></strong>
					<?php esc_html_e( 'ابتدا در صفحهٔ هر پلتفرم آن را روشن کنید.', 'wp-event-publisher' ); ?>
				<?php else : ?>
					<?php esc_html_e( 'سفارش‌ها دقیقاً به این مقصدها فرستاده می‌شوند:', 'wp-event-publisher' ); ?>
				<?php endif; ?>
			</p>

			<?php
			/*
			 * The destination itself, not only the platform name.
			 *
			 * "Where does this send orders?" was unanswerable from this screen:
			 * it said "Telegram" and stopped, so a channel id that was wrong,
			 * missing, or pointing at a different chat looked identical to one
			 * that worked.
			 */
			if ( $wpep_on && ! empty( $wpep_live ) ) :
				?>
				<ul class="wpep-order-destinations">
					<?php foreach ( $resolved as $wpep_id => $wpep_target ) : ?>
						<?php
						if ( empty( $wpep_target['enabled'] ) ) {
							continue;
						}

						// Each platform addresses its destination with its own key.
						$wpep_address = '';

						foreach ( array( 'channel_id', 'chat_id', 'recipient' ) as $wpep_key ) {
							if ( ! empty( $wpep_target[ $wpep_key ] ) ) {
								$wpep_address = (string) $wpep_target[ $wpep_key ];
								break;
							}
						}

						$wpep_title = (string) ( $wpep_target['channel_title'] ?? '' );
						?>
						<li>
							<strong><?php echo esc_html( $platforms[ $wpep_id ] ?? $wpep_id ); ?></strong>
							<?php if ( '' !== $wpep_address ) : ?>
								<code dir="ltr"><?php echo esc_html( $wpep_address ); ?></code>
								<?php if ( '' !== $wpep_title ) : ?>
									<span class="wpep-card__hint"><?php echo esc_html( $wpep_title ); ?></span>
								<?php endif; ?>
							<?php else : ?>
								<span class="wpep-card__hint">
									<strong><?php esc_html_e( 'مقصدی تنظیم نشده — پیام جایی نمی‌رود.', 'wp-event-publisher' ); ?></strong>
									<?php esc_html_e( 'شناسهٔ کانال را در صفحهٔ همین پلتفرم وارد کنید.', 'wp-event-publisher' ); ?>
								</span>
							<?php endif; ?>
						</li>
					<?php endforeach; ?>
				</ul>
			<?php endif; ?>

			<?php
			/*
			 * And whether anything has actually been sent. A switch that is on
			 * and a queue that is empty look the same from a settings screen,
			 * which is how "it is on but nothing shows up" stays a mystery.
			 */
			$wpep_recent  = isset( $recent['items'] ) && is_array( $recent['items'] ) ? $recent['items'] : (array) $recent;
			$wpep_skipped = isset( $skipped['items'] ) && is_array( $skipped['items'] ) ? $skipped['items'] : (array) $skipped;
			?>

			<h3 style="margin-top:1.4rem"><?php esc_html_e( 'آخرین سفارش‌هایی که فرستاده شد', 'wp-event-publisher' ); ?></h3>

			<?php if ( empty( $wpep_recent ) ) : ?>
				<p class="wpep-card__hint">
					<strong><?php esc_html_e( 'تا حالا هیچ سفارشی در صف ارسال قرار نگرفته است.', 'wp-event-publisher' ); ?></strong><br />
					<?php esc_html_e( 'اگر سفارش ثبت شده ولی اینجا چیزی نیست، یعنی رویداد اصلاً شروع نشده. معمول‌ترین دلیل‌ها: رویداد مربوطه در فهرست بالا تیک نخورده، مبلغ سفارش از حداقل تعیین‌شده کمتر بوده، یا سفارش قبلاً یک بار برای همین وضعیت فرستاده شده است.', 'wp-event-publisher' ); ?>
				</p>
			<?php else : ?>
				<ul class="wpep-order-log">
					<?php foreach ( $wpep_recent as $wpep_row ) : ?>
						<li>
							<code dir="ltr"><?php echo esc_html( (string) ( $wpep_row->created_at ?? '' ) ); ?></code>
							<?php echo esc_html( (string) ( $wpep_row->message ?? '' ) ); ?>
						</li>
					<?php endforeach; ?>
				</ul>
			<?php endif; ?>

			<?php if ( ! empty( $wpep_skipped ) ) : ?>
				<h3 style="margin-top:1.2rem"><?php esc_html_e( 'سفارش‌هایی که فرستاده نشدند', 'wp-event-publisher' ); ?></h3>
				<ul class="wpep-order-log">
					<?php foreach ( $wpep_skipped as $wpep_row ) : ?>
						<li>
							<code dir="ltr"><?php echo esc_html( (string) ( $wpep_row->created_at ?? '' ) ); ?></code>
							<?php echo esc_html( (string) ( $wpep_row->message ?? '' ) ); ?>
						</li>
					<?php endforeach; ?>
				</ul>
			<?php endif; ?>

			<p style="margin-top:1rem">
				<label for="wpep-order-min">
					<strong><?php esc_html_e( 'فقط سفارش‌های بالاتر از این مبلغ', 'wp-event-publisher' ); ?></strong>
					<?php if ( '' !== $currency ) : ?>
						<span class="wpep-card__hint">(<?php echo esc_html( $currency ); ?>)</span>
					<?php endif; ?>
				</label><br />
				<input
					type="text"
					id="wpep-order-min"
					class="regular-text"
					dir="ltr"
					name="<?php echo esc_attr( $wpep_option ); ?>[order_min_total]"
					value="<?php echo esc_attr( (string) ( $settings['order_min_total'] ?? '' ) ); ?>"
					placeholder="0"
				/>
				<span class="wpep-card__hint">
					<?php esc_html_e( 'خالی بگذارید تا همه سفارش‌ها پیام داشته باشند.', 'wp-event-publisher' ); ?>
				</span>
			</p>
		</div>

		<div class="wpep-card">
			<h2 class="wpep-card__title"><?php esc_html_e( 'محتوای پیام سفارش', 'wp-event-publisher' ); ?></h2>

			<p class="wpep-card__hint">
				<?php esc_html_e( 'انتخاب کنید چه چیزی در پیام بیاید، با چه عنوانی و به چه ترتیبی. عدد کوچک‌تر بالاتر نمایش داده می‌شود.', 'wp-event-publisher' ); ?>
			</p>

			<div class="wpep-order-fields">
				<?php foreach ( $fields as $wpep_key => $wpep_default_label ) : ?>
					<?php
					$wpep_entry   = $mapping[ $wpep_key ] ?? array();
					$wpep_enabled = ! empty( $wpep_entry['enabled'] );
					?>
					<div class="wpep-order-field<?php echo $wpep_enabled ? '' : ' is-off'; ?>">
						<label class="wpep-switch">
							<input
								type="checkbox"
								name="<?php echo esc_attr( $wpep_option ); ?>[order_fields][<?php echo esc_attr( $wpep_key ); ?>][enabled]"
								value="1"
								<?php checked( $wpep_enabled ); ?>
							/>
							<span class="wpep-switch__track" aria-hidden="true"></span>
							<span class="wpep-switch__label"><?php echo esc_html( $wpep_default_label ); ?></span>
						</label>

						<input
							type="text"
							class="wpep-order-field__label"
							name="<?php echo esc_attr( $wpep_option ); ?>[order_fields][<?php echo esc_attr( $wpep_key ); ?>][label]"
							value="<?php echo esc_attr( (string) ( $wpep_entry['label'] ?? $wpep_default_label ) ); ?>"
							placeholder="<?php echo esc_attr( $wpep_default_label ); ?>"
							aria-label="<?php esc_attr_e( 'عنوان نمایشی', 'wp-event-publisher' ); ?>"
						/>

						<input
							type="number"
							class="small-text"
							min="0"
							name="<?php echo esc_attr( $wpep_option ); ?>[order_fields][<?php echo esc_attr( $wpep_key ); ?>][order]"
							value="<?php echo esc_attr( (string) ( $wpep_entry['order'] ?? 0 ) ); ?>"
							aria-label="<?php esc_attr_e( 'ترتیب نمایش', 'wp-event-publisher' ); ?>"
						/>
					</div>
				<?php endforeach; ?>
			</div>
		</div>

		<?php submit_button( __( 'ذخیره تغییرات', 'wp-event-publisher' ) ); ?>
	</form>
</div>
