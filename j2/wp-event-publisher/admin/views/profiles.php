<?php
/**
 * Profiles admin view.
 *
 * @package WPEventPublisher
 *
 * @var array<int,array<string,mixed>> $profiles     Stored profiles.
 * @var array<int,array<string,mixed>> $destinations Configured destinations.
 * @var array<int,array<string,mixed>> $rules        Stored rules.
 * @var array<int,array<string,mixed>> $providers    Delivery providers.
 * @var array<string,string>           $assignments  Scope to profile id.
 * @var array<int,array<string,mixed>> $scopes       Assignable scopes.
 * @var array<string,string>           $image_modes  Image mode labels.
 * @var string                         $export_url   Nonced export URL.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap wpep-wrap wpep-platform-wrap" data-screen="profiles">
	<h1><?php esc_html_e( 'قالب پیام', 'wp-event-publisher' ); ?></h1>

	<p class="description">
		<?php esc_html_e( 'A profile is one complete publishing configuration: which fields are sent, under what labels and in what order, rendered by which template, with which images, to which destinations. Assign a profile to a post type or a category; anything below it inherits until you say otherwise.', 'wp-event-publisher' ); ?>
	</p>

	<div class="wpep-result" id="wpep-platform-notice" role="status" aria-live="polite" hidden></div>

	<div class="wpep-platform-grid">
		<div class="wpep-platform-list">
			<h2><?php esc_html_e( 'Profiles', 'wp-event-publisher' ); ?></h2>

			<p>
				<button type="button" class="button button-primary" id="wpep-new-profile">
					<?php esc_html_e( 'Create Profile', 'wp-event-publisher' ); ?>
				</button>
			</p>

			<ul class="wpep-item-list" id="wpep-profile-list">
				<?php foreach ( $profiles as $wpep_profile ) : ?>
					<li>
						<button type="button" class="wpep-item" data-id="<?php echo esc_attr( (string) $wpep_profile['id'] ); ?>">
							<span class="wpep-item-name"><?php echo esc_html( (string) $wpep_profile['name'] ); ?></span>
							<span class="wpep-item-meta">
								<code><?php echo esc_html( (string) $wpep_profile['id'] ); ?></code>
								<?php if ( '' !== (string) $wpep_profile['parent'] ) : ?>
									· <?php echo esc_html( sprintf( /* translators: %s: parent profile id. */ __( 'inherits %s', 'wp-event-publisher' ), (string) $wpep_profile['parent'] ) ); ?>
								<?php endif; ?>
								· <?php echo esc_html( sprintf( /* translators: %d: number of mapped fields. */ _n( '%d field', '%d fields', (int) $wpep_profile['field_count'], 'wp-event-publisher' ), (int) $wpep_profile['field_count'] ) ); ?>
							</span>
						</button>
					</li>
				<?php endforeach; ?>
			</ul>

			<?php if ( empty( $profiles ) ) : ?>
				<p class="description"><?php esc_html_e( 'No profiles yet. Until one is created and assigned, every post type keeps publishing with the automatically generated default, exactly as before.', 'wp-event-publisher' ); ?></p>
			<?php endif; ?>
		</div>

		<div class="wpep-platform-editor" id="wpep-profile-editor" hidden>
			<h2 id="wpep-profile-title"><?php esc_html_e( 'Edit profile', 'wp-event-publisher' ); ?></h2>

			<div class="wpep-validation" id="wpep-profile-problems" hidden></div>

			<table class="form-table" role="presentation">
				<tbody>
					<tr>
						<th scope="row"><label for="wpep-profile-name"><?php esc_html_e( 'Name', 'wp-event-publisher' ); ?></label></th>
						<td><input type="text" id="wpep-profile-name" class="regular-text" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-profile-description"><?php esc_html_e( 'Description', 'wp-event-publisher' ); ?></label></th>
						<td><textarea id="wpep-profile-description" rows="2" class="large-text"></textarea></td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-profile-parent"><?php esc_html_e( 'Inherits from', 'wp-event-publisher' ); ?></label></th>
						<td>
							<select id="wpep-profile-parent"></select>
							<p class="description"><?php esc_html_e( 'This profile stores only what it changes; everything else comes from its parent. A chain that would loop back on itself is refused.', 'wp-event-publisher' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-profile-images"><?php esc_html_e( 'Images', 'wp-event-publisher' ); ?></label></th>
						<td>
							<select id="wpep-profile-images">
								<?php foreach ( $image_modes as $wpep_mode => $wpep_mode_label ) : ?>
									<option value="<?php echo esc_attr( $wpep_mode ); ?>"><?php echo esc_html( $wpep_mode_label ); ?></option>
								<?php endforeach; ?>
							</select>
							<label for="wpep-profile-image-max" class="screen-reader-text"><?php esc_html_e( 'Maximum images', 'wp-event-publisher' ); ?></label>
							<input type="number" id="wpep-profile-image-max" class="small-text" min="0" max="50" />
							<span class="description"><?php esc_html_e( 'maximum', 'wp-event-publisher' ); ?></span>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-profile-destinations"><?php esc_html_e( 'Destinations', 'wp-event-publisher' ); ?></label></th>
						<td>
							<select id="wpep-profile-destinations" multiple size="4"></select>
							<p class="description"><?php esc_html_e( 'Select none to publish to every enabled destination, which is what a single-destination site wants.', 'wp-event-publisher' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-profile-template"><?php esc_html_e( 'Message template', 'wp-event-publisher' ); ?></label></th>
						<td>
							<textarea id="wpep-profile-template" rows="10" class="large-text code" spellcheck="false"></textarea>
							<p class="description">
								<?php esc_html_e( 'Leave empty to inherit, or to have the message generated from the enabled fields. Field mapping itself lives on the Field Mapping screen.', 'wp-event-publisher' ); ?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-profile-prepend"><?php esc_html_e( 'Always before', 'wp-event-publisher' ); ?></label></th>
						<td><textarea id="wpep-profile-prepend" rows="2" class="large-text"></textarea></td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-profile-append"><?php esc_html_e( 'Always after', 'wp-event-publisher' ); ?></label></th>
						<td><textarea id="wpep-profile-append" rows="2" class="large-text"></textarea></td>
					</tr>
				</tbody>
			</table>

			<p class="wpep-editor-actions">
				<button type="button" class="button button-primary" id="wpep-save-profile"><?php esc_html_e( 'Save Profile', 'wp-event-publisher' ); ?></button>
				<button type="button" class="button" id="wpep-duplicate-profile"><?php esc_html_e( 'Duplicate', 'wp-event-publisher' ); ?></button>
				<a class="button" id="wpep-export-profile" href="<?php echo esc_url( $export_url ); ?>"><?php esc_html_e( 'Export', 'wp-event-publisher' ); ?></a>
				<button type="button" class="button button-link-delete" id="wpep-delete-profile"><?php esc_html_e( 'Delete', 'wp-event-publisher' ); ?></button>
			</p>
		</div>
	</div>

	<h2><?php esc_html_e( 'Assignments', 'wp-event-publisher' ); ?></h2>

	<p class="description">
		<?php esc_html_e( 'Which profile applies where. Resolution walks from an advertisement’s own category outwards through its parents to the post type, and takes the first assignment it finds — so assigning "Cars" covers every category under it.', 'wp-event-publisher' ); ?>
	</p>

	<table class="widefat striped wpep-table">
		<thead>
			<tr>
				<th><?php esc_html_e( 'Scope', 'wp-event-publisher' ); ?></th>
				<th style="width:280px"><?php esc_html_e( 'Profile', 'wp-event-publisher' ); ?></th>
			</tr>
		</thead>
		<tbody id="wpep-assignments">
			<?php foreach ( $scopes as $wpep_scope ) : ?>
				<tr>
					<td>
						<span style="padding-inline-start:<?php echo esc_attr( (string) ( (int) $wpep_scope['depth'] * 16 ) ); ?>px">
							<?php echo esc_html( (string) $wpep_scope['label'] ); ?>
						</span>
						<br /><code><?php echo esc_html( (string) $wpep_scope['key'] ); ?></code>
					</td>
					<td>
						<label class="screen-reader-text" for="wpep-assign-<?php echo esc_attr( md5( (string) $wpep_scope['key'] ) ); ?>">
							<?php esc_html_e( 'Profile for this scope', 'wp-event-publisher' ); ?>
						</label>
						<select
							class="wpep-assign"
							id="wpep-assign-<?php echo esc_attr( md5( (string) $wpep_scope['key'] ) ); ?>"
							data-scope="<?php echo esc_attr( (string) $wpep_scope['key'] ); ?>">
							<option value=""><?php esc_html_e( '— inherit —', 'wp-event-publisher' ); ?></option>
							<?php foreach ( $profiles as $wpep_profile ) : ?>
								<option
									value="<?php echo esc_attr( (string) $wpep_profile['id'] ); ?>"
									<?php selected( $assignments[ (string) $wpep_scope['key'] ] ?? '', (string) $wpep_profile['id'] ); ?>>
									<?php echo esc_html( (string) $wpep_profile['name'] ); ?>
								</option>
							<?php endforeach; ?>
						</select>
					</td>
				</tr>
			<?php endforeach; ?>
		</tbody>
	</table>

	<h2><?php esc_html_e( 'Import', 'wp-event-publisher' ); ?></h2>

	<p class="description">
		<?php esc_html_e( 'Paste a profile or rule export from this or another site. A profile whose identifier is already taken is imported under a new one unless you tick overwrite.', 'wp-event-publisher' ); ?>
	</p>

	<p>
		<label for="wpep-import" class="screen-reader-text"><?php esc_html_e( 'Export file contents', 'wp-event-publisher' ); ?></label>
		<textarea id="wpep-import" rows="5" class="large-text code" spellcheck="false" placeholder='{"format":"wpep-profiles", …}'></textarea>
	</p>

	<p>
		<label><input type="checkbox" id="wpep-import-overwrite" /> <?php esc_html_e( 'Overwrite anything with the same identifier', 'wp-event-publisher' ); ?></label>
	</p>

	<p>
		<button type="button" class="button" id="wpep-do-import"><?php esc_html_e( 'Import', 'wp-event-publisher' ); ?></button>
		<a class="button" href="<?php echo esc_url( $export_url . '&what=profiles' ); ?>"><?php esc_html_e( 'Export all profiles', 'wp-event-publisher' ); ?></a>
		<a class="button" href="<?php echo esc_url( $export_url . '&what=rules' ); ?>"><?php esc_html_e( 'Export all rules', 'wp-event-publisher' ); ?></a>
	</p>
</div>
