<?php
/**
 * Announcement placement and conditions metabox.
 *
 * Included by {@see WPEventPublisher\AnnouncementPlacements::render_meta_box()},
 * which supplies the variables and prints the nonce.
 *
 * @package WPEventPublisher
 *
 * @var \WP_Post            $post       Announcement being edited.
 * @var string              $placement  Current placement.
 * @var array<string,mixed> $options    Placement options.
 * @var array<string,mixed> $conditions Display conditions.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_groups = array();

foreach ( WPEventPublisher\AnnouncementPlacements::all() as $wpep_key => $wpep_config ) {
	$wpep_groups[ $wpep_config['group'] ][ $wpep_key ] = $wpep_config['label'];
}

$wpep_rules = isset( $conditions['rules'] ) && is_array( $conditions['rules'] ) ? $conditions['rules'] : array();
?>
<div class="wpep-wrap wpep-placement-box">

	<p class="description">
		<?php esc_html_e( 'انتخاب کنید این اطلاعیه کجای سایت دیده شود. هر جای دیگری که انتخاب نکنید، نمایش داده نمی‌شود.', 'wp-event-publisher' ); ?>
	</p>

	<div class="wpep-placement-grid">
		<?php foreach ( $wpep_groups as $wpep_group_label => $wpep_items ) : ?>
			<fieldset class="wpep-placement-group">
				<legend><?php echo esc_html( $wpep_group_label ); ?></legend>

				<?php foreach ( $wpep_items as $wpep_key => $wpep_label ) : ?>
					<label class="wpep-placement-option">
						<input
							type="radio"
							name="wpep_placement"
							value="<?php echo esc_attr( $wpep_key ); ?>"
							<?php checked( $placement, $wpep_key ); ?>
							data-placement="<?php echo esc_attr( $wpep_key ); ?>"
						/>
						<span><?php echo esc_html( $wpep_label ); ?></span>
					</label>
				<?php endforeach; ?>
			</fieldset>
		<?php endforeach; ?>
	</div>

	<!-- Popup-specific options, revealed only when Popup is the placement. -->
	<div class="wpep-placement-options" data-for="popup" <?php echo 'popup' === $placement ? '' : 'hidden'; ?>>
		<h4><?php esc_html_e( 'تنظیمات پنجره بازشو', 'wp-event-publisher' ); ?></h4>

		<div class="wpep-placement-options__grid">
			<label>
				<span><?php esc_html_e( 'تأخیر نمایش (ثانیه)', 'wp-event-publisher' ); ?></span>
				<input type="number" min="0" max="120" name="wpep_placement_options[delay]" value="<?php echo esc_attr( (string) ( $options['delay'] ?? 0 ) ); ?>" />
			</label>

			<label>
				<span><?php esc_html_e( 'حداکثر عرض (پیکسل)', 'wp-event-publisher' ); ?></span>
				<input type="number" min="240" max="1200" name="wpep_placement_options[width]" value="<?php echo esc_attr( (string) ( $options['width'] ?? 480 ) ); ?>" />
			</label>

			<label>
				<span><?php esc_html_e( 'جایگاه', 'wp-event-publisher' ); ?></span>
				<select name="wpep_placement_options[position]">
					<option value="center" <?php selected( 'center', $options['position'] ?? 'center' ); ?>><?php esc_html_e( 'وسط', 'wp-event-publisher' ); ?></option>
					<option value="top" <?php selected( 'top', $options['position'] ?? '' ); ?>><?php esc_html_e( 'بالا', 'wp-event-publisher' ); ?></option>
					<option value="bottom" <?php selected( 'bottom', $options['position'] ?? '' ); ?>><?php esc_html_e( 'پایین', 'wp-event-publisher' ); ?></option>
				</select>
			</label>

			<label>
				<span><?php esc_html_e( 'هر چند وقت یک‌بار دیده شود', 'wp-event-publisher' ); ?></span>
				<select name="wpep_placement_options[frequency]">
					<option value="session" <?php selected( 'session', $options['frequency'] ?? 'session' ); ?>><?php esc_html_e( 'یک‌بار در هر بازدید', 'wp-event-publisher' ); ?></option>
					<option value="once" <?php selected( 'once', $options['frequency'] ?? '' ); ?>><?php esc_html_e( 'فقط یک‌بار برای هر کاربر', 'wp-event-publisher' ); ?></option>
					<option value="always" <?php selected( 'always', $options['frequency'] ?? '' ); ?>><?php esc_html_e( 'همیشه', 'wp-event-publisher' ); ?></option>
				</select>
			</label>
		</div>

		<?php
		$wpep_popup_switches = array(
			'overlay'       => __( 'تیره کردن پس‌زمینه', 'wp-event-publisher' ),
			'close_button'  => __( 'دکمه بستن', 'wp-event-publisher' ),
			'close_outside' => __( 'بستن با کلیک بیرون', 'wp-event-publisher' ),
			'close_esc'     => __( 'بستن با کلید Esc', 'wp-event-publisher' ),
		);
		?>

		<div class="wpep-placement-switches">
			<?php foreach ( $wpep_popup_switches as $wpep_opt => $wpep_opt_label ) : ?>
				<label class="wpep-switch">
					<input type="checkbox" name="wpep_placement_options[<?php echo esc_attr( $wpep_opt ); ?>]" value="1" <?php checked( ! empty( $options[ $wpep_opt ] ) ); ?> />
					<span class="wpep-switch__track" aria-hidden="true"></span>
					<span class="wpep-switch__label"><?php echo esc_html( $wpep_opt_label ); ?></span>
				</label>
			<?php endforeach; ?>
		</div>
	</div>

	<!-- Bar options. -->
	<div class="wpep-placement-options" data-for="header footer_bar" <?php echo in_array( $placement, array( 'header', 'footer_bar' ), true ) ? '' : 'hidden'; ?>>
		<h4><?php esc_html_e( 'تنظیمات نوار', 'wp-event-publisher' ); ?></h4>

		<div class="wpep-placement-switches">
			<label class="wpep-switch">
				<input type="checkbox" name="wpep_placement_options[sticky]" value="1" <?php checked( ! empty( $options['sticky'] ) ); ?> />
				<span class="wpep-switch__track" aria-hidden="true"></span>
				<span class="wpep-switch__label"><?php esc_html_e( 'چسبیده به لبه صفحه بماند', 'wp-event-publisher' ); ?></span>
			</label>

			<label class="wpep-switch">
				<input type="checkbox" name="wpep_placement_options[dismissible]" value="1" <?php checked( ! empty( $options['dismissible'] ) ); ?> />
				<span class="wpep-switch__track" aria-hidden="true"></span>
				<span class="wpep-switch__label"><?php esc_html_e( 'کاربر بتواند ببندد', 'wp-event-publisher' ); ?></span>
			</label>
		</div>
	</div>

	<!-- Floating options. -->
	<div class="wpep-placement-options" data-for="floating" <?php echo 'floating' === $placement ? '' : 'hidden'; ?>>
		<h4><?php esc_html_e( 'تنظیمات اعلان شناور', 'wp-event-publisher' ); ?></h4>

		<label>
			<span><?php esc_html_e( 'سمت صفحه', 'wp-event-publisher' ); ?></span>
			<select name="wpep_placement_options[side]">
				<option value="end" <?php selected( 'end', $options['side'] ?? 'end' ); ?>><?php esc_html_e( 'سمت چپ (انتهای جهت متن)', 'wp-event-publisher' ); ?></option>
				<option value="start" <?php selected( 'start', $options['side'] ?? '' ); ?>><?php esc_html_e( 'سمت راست (ابتدای جهت متن)', 'wp-event-publisher' ); ?></option>
			</select>
		</label>
	</div>

	<hr />

	<h4><?php esc_html_e( 'شرایط نمایش', 'wp-event-publisher' ); ?></h4>

	<p class="description">
		<?php esc_html_e( 'اگر شرطی اضافه نکنید، اطلاعیه در همه صفحه‌هایی که محل نمایش آن اجازه می‌دهد دیده می‌شود.', 'wp-event-publisher' ); ?>
	</p>

	<p>
		<label>
			<?php esc_html_e( 'نمایش وقتی', 'wp-event-publisher' ); ?>
			<select name="wpep_conditions[match]">
				<option value="all" <?php selected( 'all', $conditions['match'] ?? 'all' ); ?>><?php esc_html_e( 'همه شرط‌ها برقرار باشند', 'wp-event-publisher' ); ?></option>
				<option value="any" <?php selected( 'any', $conditions['match'] ?? '' ); ?>><?php esc_html_e( 'دست‌کم یکی از شرط‌ها برقرار باشد', 'wp-event-publisher' ); ?></option>
			</select>
		</label>
	</p>

	<div class="wpep-conditions" data-jarchi-conditions>
		<?php
		// One blank row is always rendered so the list is never empty and the
		// JS has a template to clone.
		$wpep_render_rules = ! empty( $wpep_rules ) ? $wpep_rules : array( array( 'subject' => '', 'operator' => 'is', 'value' => '' ) );
		?>

		<?php foreach ( $wpep_render_rules as $wpep_index => $wpep_rule ) : ?>
			<div class="wpep-condition">
				<select name="wpep_conditions[rules][<?php echo (int) $wpep_index; ?>][subject]" aria-label="<?php esc_attr_e( 'موضوع شرط', 'wp-event-publisher' ); ?>">
					<option value=""><?php esc_html_e( '— انتخاب کنید —', 'wp-event-publisher' ); ?></option>
					<?php foreach ( WPEventPublisher\AnnouncementPlacements::condition_subjects() as $wpep_sub => $wpep_sub_label ) : ?>
						<option value="<?php echo esc_attr( $wpep_sub ); ?>" <?php selected( $wpep_sub, $wpep_rule['subject'] ?? '' ); ?>>
							<?php echo esc_html( $wpep_sub_label ); ?>
						</option>
					<?php endforeach; ?>
				</select>

				<select name="wpep_conditions[rules][<?php echo (int) $wpep_index; ?>][operator]" aria-label="<?php esc_attr_e( 'عملگر', 'wp-event-publisher' ); ?>">
					<?php foreach ( WPEventPublisher\AnnouncementPlacements::condition_operators() as $wpep_op => $wpep_op_label ) : ?>
						<option value="<?php echo esc_attr( $wpep_op ); ?>" <?php selected( $wpep_op, $wpep_rule['operator'] ?? 'is' ); ?>>
							<?php echo esc_html( $wpep_op_label ); ?>
						</option>
					<?php endforeach; ?>
				</select>

				<input
					type="text"
					name="wpep_conditions[rules][<?php echo (int) $wpep_index; ?>][value]"
					value="<?php echo esc_attr( (string) ( $wpep_rule['value'] ?? '' ) ); ?>"
					placeholder="<?php esc_attr_e( 'مقدار', 'wp-event-publisher' ); ?>"
					aria-label="<?php esc_attr_e( 'مقدار شرط', 'wp-event-publisher' ); ?>"
				/>

				<button type="button" class="button-link wpep-condition__remove" aria-label="<?php esc_attr_e( 'حذف شرط', 'wp-event-publisher' ); ?>">&times;</button>
			</div>
		<?php endforeach; ?>
	</div>

	<p>
		<button type="button" class="button" data-jarchi-add-condition><?php esc_html_e( 'افزودن شرط', 'wp-event-publisher' ); ?></button>
	</p>
</div>
