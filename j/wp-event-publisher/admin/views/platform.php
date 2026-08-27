<?php
/**
 * Per-platform settings screen (Telegram, Bale, WhatsApp).
 *
 * One view drives all three. They differ only in how they address a
 * destination — a Telegram channel ID, a Bale chat ID, a WhatsApp recipient —
 * so the shared parts are written once and the differences are declared in
 * $address below.
 *
 * @package WPEventPublisher
 *
 * @var string               $platform Platform identifier.
 * @var string               $title    Screen title.
 * @var array<string,mixed>  $config   Stored configuration for this platform.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_option = WPEventPublisher\Settings::OPTION;
$wpep_name   = $wpep_option . '[platforms][' . $platform . ']';

// How this platform names the place it publishes to.
$wpep_address = array(
	'telegram' => array(
		'key'         => 'channel_id',
		'label'       => __( 'شناسه کانال', 'wp-event-publisher' ),
		'placeholder' => '@my_channel',
		'description' => __( 'شناسه یا نام کاربری کانال تلگرام، مثل ‎@my_channel‎.', 'wp-event-publisher' ),
	),
	'bale'     => array(
		'key'         => 'chat_id',
		'label'       => __( 'شناسه گفتگو', 'wp-event-publisher' ),
		'placeholder' => '@my_bale_channel',
		'description' => __( 'شناسه کانال یا گروه بله.', 'wp-event-publisher' ),
	),
	'whatsapp' => array(
		'key'         => 'recipient',
		'label'       => __( 'گیرنده', 'wp-event-publisher' ),
		'placeholder' => '+989120000000',
		'description' => __( 'شماره یا شناسه گیرنده واتس‌اپ.', 'wp-event-publisher' ),
	),
);

$wpep_addr = $wpep_address[ $platform ] ?? $wpep_address['telegram'];
?>
<div class="wrap wpep-wrap">
	<div class="jarchi-platform-heading jarchi-platform-heading--<?php echo esc_attr( $platform ); ?>">
		<?php if ( 'telegram' === $platform ) : ?><svg class="jarchi-platform-heading__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 3.4 2.8 10.65c-.86.34-.83 1.58.04 1.86l4.77 1.52 1.83 5.68c.27.84 1.3 1.11 1.91.5l2.66-2.67 4.94 3.63c.72.53 1.74.12 1.9-.76l2.75-15.24c.17-.94-.73-1.61-1.59-1.27ZM18.48 6.5l-7.17 6.45-.26 3.11-.99-3.1-4.34-1.38 12.76-4.92Z"/></svg><?php elseif ( 'whatsapp' === $platform ) : ?><svg class="jarchi-platform-heading__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.05a9.85 9.85 0 0 0-8.48 14.86L2.1 21.85l5.08-1.33A9.84 9.84 0 1 0 12 2.05Zm0 17.93a8.06 8.06 0 0 1-4.1-1.12l-.29-.17-3.02.79.8-2.94-.18-.3A8.07 8.07 0 1 1 12 19.98Zm4.45-5.98c-.24-.12-1.41-.69-1.63-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.19-.71-.63-1.19-1.4-1.33-1.64-.14-.24-.01-.37.1-.49.1-.1.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.12 3.63.58.25 1.03.39 1.38.5.58.18 1.1.15 1.52.09.46-.07 1.41-.58 1.61-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z"/></svg><?php else : ?><svg class="jarchi-platform-heading__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.25a9.75 9.75 0 0 0-8.86 13.8L2.5 21.5l5.45-1.47A9.75 9.75 0 1 0 12 2.25Zm0 2.1a7.66 7.66 0 0 1 6.62 11.51l-.3.5.68 2.54-2.56-.69-.5.3A7.66 7.66 0 1 1 12 4.35Zm-4.2 7.52c1.18-2.06 2.96-3.34 5.31-3.79l.74-.14-.18.73c-.42 1.73-.2 2.78.73 3.59.67.58 1.6.84 2.95.8l.82-.02-.36.74c-.86 1.77-2.5 2.77-4.48 2.77-2.84 0-5.42-1.84-5.53-4.68v-.2Z"/></svg><?php endif; ?>
		<h1><?php echo esc_html( $title ); ?></h1>
	</div>

	<?php settings_errors(); ?>

	<div class="notice notice-info inline">
		<p>
			<?php esc_html_e( 'توکن ربات و کلیدهای محرمانه در وردپرس ذخیره نمی‌شوند. وردپرس فقط می‌گوید چه چیزی و کجا منتشر شود؛ ارتباط با پلتفرم بر عهده سرویس جارچی است.', 'wp-event-publisher' ); ?>
		</p>
	</div>

	<?php if ( in_array( $platform, array( 'telegram', 'bale' ), true ) ) : ?>
		<div class="wpep-plan-banner">
			<strong><?php echo esc_html( 'telegram' === $platform ? 'قابلیت‌های ربات تلگرام جارچی' : 'قابلیت‌های ربات بله جارچی' ); ?></strong>
			<span>برای پاسخ‌گویی تیکت، ارسال اطلاعیه و افزودن محصول از طریق ربات، پلن سرویس جارچی لازم است.</span>
			<a class="button button-primary" href="<?php echo esc_url( 'https://bymer.ir/jarchi' ); ?>" target="_blank" rel="noopener">مشاهده پلن‌ها</a>
		</div>
	<?php endif; ?>

	<form method="post" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>">
		<?php settings_fields( WPEventPublisher\Settings::GROUP ); ?>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'انتشار', 'wp-event-publisher' ); ?></th>
				<td>
					<label class="wpep-switch">
						<input
							type="checkbox"
							name="<?php echo esc_attr( $wpep_name ); ?>[enabled]"
							value="1"
							<?php checked( ! empty( $config['enabled'] ) ); ?>
						/>
						<span class="wpep-switch__track" aria-hidden="true"></span>
						<span class="wpep-switch__label"><?php esc_html_e( 'انتشار در این پلتفرم فعال باشد', 'wp-event-publisher' ); ?></span>
					</label>
					<p class="description">
						<?php esc_html_e( 'تا وقتی این گزینه خاموش است، هیچ محتوایی به این پلتفرم فرستاده نمی‌شود — حتی اگر در تک‌تک نوشته‌ها انتخاب شده باشد.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-<?php echo esc_attr( $platform ); ?>-address"><?php echo esc_html( $wpep_addr['label'] ); ?></label>
				</th>
				<td>
					<input
						type="text"
						id="wpep-<?php echo esc_attr( $platform ); ?>-address"
						class="regular-text code"
						dir="ltr"
						name="<?php echo esc_attr( $wpep_name . '[' . $wpep_addr['key'] . ']' ); ?>"
						value="<?php echo esc_attr( (string) ( $config[ $wpep_addr['key'] ] ?? '' ) ); ?>"
						placeholder="<?php echo esc_attr( $wpep_addr['placeholder'] ); ?>"
					/>
					<p class="description"><?php echo esc_html( $wpep_addr['description'] ); ?></p>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-<?php echo esc_attr( $platform ); ?>-title"><?php esc_html_e( 'نام نمایشی', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<input
						type="text"
						id="wpep-<?php echo esc_attr( $platform ); ?>-title"
						class="regular-text"
						name="<?php echo esc_attr( $wpep_name ); ?>[channel_title]"
						value="<?php echo esc_attr( (string) ( $config['channel_title'] ?? '' ) ); ?>"
					/>
					<p class="description"><?php esc_html_e( 'فقط برای شناسایی در همین صفحه و گزارش‌ها استفاده می‌شود.', 'wp-event-publisher' ); ?></p>
				</td>
			</tr>

			<?php if ( 'whatsapp' === $platform ) : ?>
				<tr>
					<th scope="row">
						<label for="wpep-whatsapp-mode"><?php esc_html_e( 'نوع پیام', 'wp-event-publisher' ); ?></label>
					</th>
					<td>
						<select id="wpep-whatsapp-mode" name="<?php echo esc_attr( $wpep_name ); ?>[message_mode]">
							<option value="text" <?php selected( 'text', (string) ( $config['message_mode'] ?? 'text' ) ); ?>>
								<?php esc_html_e( 'فقط متن', 'wp-event-publisher' ); ?>
							</option>
							<option value="media" <?php selected( 'media', (string) ( $config['message_mode'] ?? 'text' ) ); ?>>
								<?php esc_html_e( 'متن همراه تصویر', 'wp-event-publisher' ); ?>
							</option>
						</select>
					</td>
				</tr>
			<?php endif; ?>
		</table>

		<h2 class="title"><?php esc_html_e( 'دکمه‌ها', 'wp-event-publisher' ); ?></h2>

		<p class="description">
			<?php esc_html_e( 'متن دکمه‌ها همراه پیام فرستاده می‌شود، بنابراین هرچه اینجا بنویسید دقیقاً همان زیر آگهی دیده می‌شود.', 'wp-event-publisher' ); ?>
		</p>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'دکمه مشاهده', 'wp-event-publisher' ); ?></th>
				<td>
					<label class="wpep-switch">
						<input
							type="checkbox"
							name="<?php echo esc_attr( $wpep_name ); ?>[view_button]"
							value="1"
							<?php checked( ! empty( $config['view_button'] ) ); ?>
						/>
						<span class="wpep-switch__track" aria-hidden="true"></span>
						<span class="wpep-switch__label"><?php esc_html_e( 'نمایش دکمه مشاهده', 'wp-event-publisher' ); ?></span>
					</label>
					<br /><br />
					<input
						type="text"
						class="regular-text"
						name="<?php echo esc_attr( $wpep_name ); ?>[view_label]"
						value="<?php echo esc_attr( (string) ( $config['view_label'] ?? '' ) ); ?>"
						placeholder="<?php esc_attr_e( 'مشاهده آگهی', 'wp-event-publisher' ); ?>"
					/>
					<p class="description"><?php esc_html_e( 'متن دکمه مشاهده.', 'wp-event-publisher' ); ?></p>
				</td>
			</tr>

			<tr>
				<th scope="row"><?php esc_html_e( 'دکمه تماس', 'wp-event-publisher' ); ?></th>
				<td>
					<label class="wpep-switch">
						<input
							type="checkbox"
							name="<?php echo esc_attr( $wpep_name ); ?>[contact_button]"
							value="1"
							<?php checked( ! empty( $config['contact_button'] ) ); ?>
						/>
						<span class="wpep-switch__track" aria-hidden="true"></span>
						<span class="wpep-switch__label"><?php esc_html_e( 'نمایش دکمه تماس', 'wp-event-publisher' ); ?></span>
					</label>
					<br /><br />
					<input
						type="text"
						class="regular-text"
						name="<?php echo esc_attr( $wpep_name ); ?>[contact_label]"
						value="<?php echo esc_attr( (string) ( $config['contact_label'] ?? '' ) ); ?>"
						placeholder="<?php esc_attr_e( 'تماس با آگهی‌دهنده', 'wp-event-publisher' ); ?>"
					/>
					<p class="description">
						<?php esc_html_e( 'این دکمه فقط وقتی نمایش داده می‌شود که شماره تماس هم منتشر شده باشد. دکمه تماسی که شماره‌ای پشتش نباشد، بن‌بست است.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>
		</table>

		<?php submit_button(); ?>
	</form>
</div>
