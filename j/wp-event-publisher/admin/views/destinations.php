<?php
/**
 * Destinations admin view.
 *
 * @package WPEventPublisher
 *
 * @var array<int,array<string,mixed>> $profiles     Stored profiles.
 * @var array<int,array<string,mixed>> $destinations Configured destinations.
 * @var array<int,array<string,mixed>> $providers    Delivery providers.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap wpep-wrap wpep-platform-wrap" data-screen="destinations">
	<h1><?php esc_html_e( 'پلتفرم انتشار', 'wp-event-publisher' ); ?></h1>

	<p class="description">
		<?php esc_html_e( 'A destination is one place an advertisement is published. Several destinations may share a provider — five Telegram channels are five destinations — and each carries its own template, image limit and delay.', 'wp-event-publisher' ); ?>
	</p>

	<div class="wpep-result" id="wpep-platform-notice" role="status" aria-live="polite" hidden></div>

	<div class="wpep-platform-grid">
		<div class="wpep-platform-list">
			<h2><?php esc_html_e( 'Destinations', 'wp-event-publisher' ); ?></h2>

			<p>
				<button type="button" class="button button-primary" id="wpep-new-destination">
					<?php esc_html_e( 'Create Destination', 'wp-event-publisher' ); ?>
				</button>
			</p>

			<ul class="wpep-item-list" id="wpep-destination-list">
				<?php foreach ( $destinations as $wpep_destination ) : ?>
					<li>
						<button type="button" class="wpep-item" data-id="<?php echo esc_attr( (string) $wpep_destination['id'] ); ?>">
							<span class="wpep-item-name">
								<?php echo esc_html( (string) $wpep_destination['name'] ); ?>
								<span class="wpep-badge wpep-badge-<?php echo ! empty( $wpep_destination['enabled'] ) ? 'ok' : 'skipped'; ?>">
									<?php echo esc_html( ! empty( $wpep_destination['enabled'] ) ? __( 'Enabled', 'wp-event-publisher' ) : __( 'Disabled', 'wp-event-publisher' ) ); ?>
								</span>
							</span>
							<span class="wpep-item-meta">
								<?php echo esc_html( (string) $wpep_destination['provider_label'] ); ?>
								· <code><?php echo esc_html( (string) $wpep_destination['id'] ); ?></code>
								<?php if ( ! empty( $wpep_destination['problems'] ) ) : ?>
									· <span class="wpep-problem"><?php echo esc_html( sprintf( /* translators: %d: number of problems. */ _n( '%d problem', '%d problems', count( (array) $wpep_destination['problems'] ), 'wp-event-publisher' ), count( (array) $wpep_destination['problems'] ) ) ); ?></span>
								<?php endif; ?>
							</span>
						</button>
					</li>
				<?php endforeach; ?>
			</ul>

			<?php if ( empty( $destinations ) ) : ?>
				<p class="description"><?php esc_html_e( 'No destinations are configured. Advertisements are sent to the webhook URL in Settings, exactly as before.', 'wp-event-publisher' ); ?></p>
			<?php endif; ?>
		</div>

		<div class="wpep-platform-editor" id="wpep-destination-editor" hidden>
			<h2 id="wpep-destination-title"><?php esc_html_e( 'Edit destination', 'wp-event-publisher' ); ?></h2>

			<div class="wpep-validation" id="wpep-destination-problems" hidden></div>

			<table class="form-table" role="presentation">
				<tbody>
					<tr>
						<th scope="row"><label for="wpep-destination-name"><?php esc_html_e( 'Name', 'wp-event-publisher' ); ?></label></th>
						<td><input type="text" id="wpep-destination-name" class="regular-text" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-destination-provider"><?php esc_html_e( 'Provider', 'wp-event-publisher' ); ?></label></th>
						<td>
							<select id="wpep-destination-provider">
								<?php foreach ( $providers as $wpep_provider ) : ?>
									<option value="<?php echo esc_attr( (string) $wpep_provider['id'] ); ?>">
										<?php echo esc_html( (string) $wpep_provider['label'] ); ?>
									</option>
								<?php endforeach; ?>
							</select>
							<p class="description" id="wpep-provider-capabilities"></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Enabled', 'wp-event-publisher' ); ?></th>
						<td>
							<label>
								<input type="checkbox" id="wpep-destination-enabled" />
								<?php esc_html_e( 'Publish advertisements to this destination', 'wp-event-publisher' ); ?>
							</label>
						</td>
					</tr>
				</tbody>
			</table>

			<h3><?php esc_html_e( 'Provider settings', 'wp-event-publisher' ); ?></h3>

			<table class="form-table" role="presentation">
				<tbody id="wpep-destination-config"></tbody>
			</table>

			<h3><?php esc_html_e( 'Overrides', 'wp-event-publisher' ); ?></h3>

			<p class="description">
				<?php esc_html_e( 'Leave these empty to use whatever the profile and the rules decided. Set them to make this destination differ from the others.', 'wp-event-publisher' ); ?>
			</p>

			<table class="form-table" role="presentation">
				<tbody>
					<tr>
						<th scope="row"><label for="wpep-destination-template"><?php esc_html_e( 'Message template', 'wp-event-publisher' ); ?></label></th>
						<td><textarea id="wpep-destination-template" rows="6" class="large-text code" spellcheck="false"></textarea></td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-destination-images"><?php esc_html_e( 'Maximum images', 'wp-event-publisher' ); ?></label></th>
						<td>
							<input type="number" id="wpep-destination-images" class="small-text" min="-1" max="50" />
							<p class="description"><?php esc_html_e( '−1 uses the profile’s limit. 0 sends no images.', 'wp-event-publisher' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-destination-delay"><?php esc_html_e( 'Delay', 'wp-event-publisher' ); ?></label></th>
						<td>
							<select id="wpep-destination-delay">
								<option value="0"><?php esc_html_e( 'Publish immediately', 'wp-event-publisher' ); ?></option>
								<option value="300"><?php esc_html_e( 'After 5 minutes', 'wp-event-publisher' ); ?></option>
								<option value="1800"><?php esc_html_e( 'After 30 minutes', 'wp-event-publisher' ); ?></option>
								<option value="3600"><?php esc_html_e( 'After an hour', 'wp-event-publisher' ); ?></option>
								<option value="86400"><?php esc_html_e( 'Tomorrow (24 hours)', 'wp-event-publisher' ); ?></option>
							</select>
							<label for="wpep-destination-delay-custom" class="screen-reader-text"><?php esc_html_e( 'Custom delay in seconds', 'wp-event-publisher' ); ?></label>
							<input type="number" id="wpep-destination-delay-custom" class="small-text" min="0" placeholder="<?php esc_attr_e( 'seconds', 'wp-event-publisher' ); ?>" />
							<p class="description"><?php esc_html_e( 'A delayed advertisement is rebuilt when it is finally sent, so an edit during the wait goes out corrected and a deletion cancels it.', 'wp-event-publisher' ); ?></p>
						</td>
					</tr>
				</tbody>
			</table>

			<p class="wpep-editor-actions">
				<button type="button" class="button button-primary" id="wpep-save-destination"><?php esc_html_e( 'Save Destination', 'wp-event-publisher' ); ?></button>
				<button type="button" class="button" id="wpep-test-destination"><?php esc_html_e( 'Send a test', 'wp-event-publisher' ); ?></button>
				<button type="button" class="button" id="wpep-duplicate-destination"><?php esc_html_e( 'Duplicate', 'wp-event-publisher' ); ?></button>
				<button type="button" class="button button-link-delete" id="wpep-delete-destination"><?php esc_html_e( 'Delete', 'wp-event-publisher' ); ?></button>
			</p>

			<div class="wpep-preview-output" id="wpep-destination-result" hidden></div>
		</div>
	</div>

	<h2><?php esc_html_e( 'Available providers', 'wp-event-publisher' ); ?></h2>

	<table class="widefat striped wpep-table">
		<thead>
			<tr>
				<th><?php esc_html_e( 'Provider', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Images', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Gallery', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Formatting', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Buttons', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Native scheduling', 'wp-event-publisher' ); ?></th>
			</tr>
		</thead>
		<tbody>
			<?php foreach ( $providers as $wpep_provider ) : ?>
				<tr>
					<td>
						<?php echo esc_html( (string) $wpep_provider['label'] ); ?>
						<br /><code><?php echo esc_html( (string) $wpep_provider['id'] ); ?></code>
					</td>
					<?php foreach ( array( 'images', 'gallery', 'formatting', 'buttons', 'scheduling' ) as $wpep_capability ) : ?>
						<td>
							<?php echo esc_html( ! empty( $wpep_provider[ $wpep_capability ] ) ? __( 'Yes', 'wp-event-publisher' ) : __( 'No', 'wp-event-publisher' ) ); ?>
						</td>
					<?php endforeach; ?>
				</tr>
			<?php endforeach; ?>
		</tbody>
	</table>

	<p class="description">
		<?php
		printf(
			/* translators: %s: filter name in code tags. */
			esc_html__( 'A service that is not listed is one adapter class away: implement the DeliveryProvider interface and register it with %s. The settings form on this screen is built from the provider’s own schema, so no admin code is needed.', 'wp-event-publisher' ),
			'<code>wpep_delivery_providers</code>'
		);
		?>
	</p>
</div>
