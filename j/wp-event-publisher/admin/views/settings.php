<?php
/**
 * Settings admin view.
 *
 * @package WPEventPublisher
 *
 * @var array<string,mixed>         $settings    Plugin settings.
 * @var array<string,\WP_Post_Type> $post_types  Selectable post types.
 * @var array<string,object>        $statuses    Non-internal post statuses.
 * @var array<string,string>        $event_types Selectable event types.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_option = WPEventPublisher\Settings::OPTION;

/**
 * Returns the number of published posts of a post type, for guidance only.
 *
 * @param string $type Post type slug.
 *
 * @return int Published count.
 */
$wpep_published_count = static function ( string $type ): int {
	$counts = wp_count_posts( $type );

	return isset( $counts->publish ) ? (int) $counts->publish : 0;
};
?>
<div class="wrap wpep-wrap">
	<h1><?php esc_html_e( 'تنظیمات جارچی', 'wp-event-publisher' ); ?></h1>

	<?php settings_errors(); ?>

	<form method="post" action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>">
		<?php settings_fields( WPEventPublisher\Settings::GROUP ); ?>

		<h2 class="title"><?php esc_html_e( 'اتصال به جارچی', 'wp-event-publisher' ); ?></h2>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row">
					<label for="wpep-node-api-url"><?php esc_html_e( 'آدرس وب‌هوک جارچی', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<input
						type="url"
						id="wpep-node-api-url"
						class="regular-text code"
						name="<?php echo esc_attr( $wpep_option ); ?>[node_api_url]"
						value="<?php echo esc_attr( (string) $settings['node_api_url'] ); ?>"
						placeholder="<?php echo esc_attr( WPEventPublisher\Settings::DEFAULT_ENDPOINT ); ?>"
					/>
					<p class="description">
						<?php esc_html_e( 'HTTPS endpoint of the Node.js Telegram Publisher. The connection test and real advertisement events both post to exactly this URL.', 'wp-event-publisher' ); ?>
						<br />
						<?php
						printf(
							/* translators: %s: default endpoint URL. */
							esc_html__( 'Production default: %s', 'wp-event-publisher' ),
							'<code>' . esc_html( WPEventPublisher\Settings::DEFAULT_ENDPOINT ) . '</code>'
						);
						?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-api-secret"><?php esc_html_e( 'Webhook Secret', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<input
						type="password"
						id="wpep-api-secret"
						class="regular-text code"
						name="<?php echo esc_attr( $wpep_option ); ?>[api_secret]"
						value=""
						autocomplete="new-password"
						placeholder="<?php echo esc_attr( empty( $settings['api_secret'] ) ? '' : '••••••••••••••••' ); ?>"
					/>
					<p class="description">
						<?php esc_html_e( 'Shared secret used to authenticate every request. It must match the secret the Node.js service expects (for example WEBHOOK_SECRET in its .env file). Leave blank to keep the stored secret.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-auth-style"><?php esc_html_e( 'روش احراز هویت', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<select id="wpep-auth-style" name="<?php echo esc_attr( $wpep_option ); ?>[auth_style]">
						<option value="<?php echo esc_attr( WPEventPublisher\Signer::AUTH_ALL ); ?>" <?php selected( (string) $settings['auth_style'], WPEventPublisher\Signer::AUTH_ALL ); ?>>
							<?php esc_html_e( 'All of the below (recommended)', 'wp-event-publisher' ); ?>
						</option>
						<option value="<?php echo esc_attr( WPEventPublisher\Signer::AUTH_HMAC ); ?>" <?php selected( (string) $settings['auth_style'], WPEventPublisher\Signer::AUTH_HMAC ); ?>>
							<?php esc_html_e( 'HMAC signature only (X-Signature, X-Hub-Signature-256)', 'wp-event-publisher' ); ?>
						</option>
						<option value="<?php echo esc_attr( WPEventPublisher\Signer::AUTH_API_KEY ); ?>" <?php selected( (string) $settings['auth_style'], WPEventPublisher\Signer::AUTH_API_KEY ); ?>>
							<?php esc_html_e( '— پیش‌فرض —', 'wp-event-publisher' ); ?>
							<?php esc_html_e( 'API key only (X-API-Key, X-Webhook-Secret)', 'wp-event-publisher' ); ?>
						</option>
						<option value="<?php echo esc_attr( WPEventPublisher\Signer::AUTH_BEARER ); ?>" <?php selected( (string) $settings['auth_style'], WPEventPublisher\Signer::AUTH_BEARER ); ?>>
							<?php esc_html_e( 'Bearer token only (Authorization header)', 'wp-event-publisher' ); ?>
						</option>
					</select>
					<p class="description">
						<?php esc_html_e( 'روش پیشنهادی «کلید API» است و برای اتصال به جارچی همین کافی است. روش‌های HMAC و Bearer برای سایت‌هایی نگه داشته شده‌اند که از قبل از آن‌ها استفاده می‌کردند.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-site-id"><?php esc_html_e( 'شناسه سایت', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<input
						type="text"
						id="wpep-site-id"
						class="regular-text code"
						name="<?php echo esc_attr( $wpep_option ); ?>[site_id]"
						value="<?php echo esc_attr( (string) $settings['site_id'] ); ?>"
						maxlength="<?php echo esc_attr( (string) WPEventPublisher\Validator::SITE_ID_MAX ); ?>"
						placeholder="site_001"
					/>
					<p class="description">
						<?php esc_html_e( 'Identifies this site to the Node.js service. Sent as site_id in the payload and as the X-Site-ID header.', 'wp-event-publisher' ); ?>
						<?php if ( '' === (string) $settings['site_id'] ) : ?>
							<br />
							<?php
							printf(
								/* translators: %s: derived site identifier. */
								esc_html__( 'Leave empty to use the derived value %s.', 'wp-event-publisher' ),
								'<code>' . esc_html( wpep()->settings()->derive_site_id() ) . '</code>'
							);
							?>
						<?php endif; ?>
					</p>
				</td>
			</tr>
		</table>

		<h2 class="title"><?php esc_html_e( 'What triggers an event', 'wp-event-publisher' ); ?></h2>

		<table class="form-table" role="presentation">

			<tr>
				<th scope="row">
					<label for="wpep-post-type-mode"><?php esc_html_e( 'Post Type Detection', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<select id="wpep-post-type-mode" name="<?php echo esc_attr( $wpep_option ); ?>[post_type_mode]">
						<option value="<?php echo esc_attr( WPEventPublisher\Settings::POST_TYPES_MANUAL ); ?>" <?php selected( (string) $settings['post_type_mode'], WPEventPublisher\Settings::POST_TYPES_MANUAL ); ?>>
							<?php esc_html_e( 'Manual — only the post types ticked below', 'wp-event-publisher' ); ?>
						</option>
						<option value="<?php echo esc_attr( WPEventPublisher\Settings::POST_TYPES_AUTO ); ?>" <?php selected( (string) $settings['post_type_mode'], WPEventPublisher\Settings::POST_TYPES_AUTO ); ?>>
							<?php esc_html_e( 'Automatic — every public post type, plus the ones ticked below', 'wp-event-publisher' ); ?>
						</option>
					</select>
					<p class="description">
						<?php esc_html_e( 'Automatic detection watches whatever is registered, whichever plugin created it (JetEngine, ACF, CPT UI, WooCommerce or a theme), so a post type added later is picked up without visiting this screen.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row"><?php esc_html_e( 'کدام محتوا در جارچی منتشر شود؟', 'wp-event-publisher' ); ?></th>
				<td>
					<fieldset>
						<?php foreach ( $post_types as $wpep_type ) : ?>
							<?php $wpep_count = $wpep_published_count( $wpep_type->name ); ?>
							<label class="wpep-check-item">
								<input
									type="checkbox"
									name="<?php echo esc_attr( $wpep_option ); ?>[allowed_post_types][]"
									value="<?php echo esc_attr( $wpep_type->name ); ?>"
									<?php checked( in_array( $wpep_type->name, (array) $settings['allowed_post_types'], true ) ); ?>
								/>
								<?php
								echo esc_html(
									sprintf(
										/* translators: 1: post type label, 2: post type slug, 3: number of published items. */
										__( '%1$s (%2$s) — %3$d published', 'wp-event-publisher' ),
										$wpep_type->labels->singular_name ?? $wpep_type->name,
										$wpep_type->name,
										$wpep_count
									)
								);
								?>
							</label>
						<?php endforeach; ?>
						<p class="description">
							<?php esc_html_e( 'نوع محتوایی را انتخاب کنید که می‌خواهید منتشر شود — نوشته‌ها، محصولات، آگهی‌ها یا هر نوع محتوای دیگری که سایت شما دارد. تعداد موارد منتشرشده کنار هر گزینه کمک می‌کند مورد درست را بشناسید.', 'wp-event-publisher' ); ?>
						</p>
					</fieldset>
				</td>
			</tr>


			<tr>
				<th scope="row"><?php esc_html_e( 'Event Types', 'wp-event-publisher' ); ?></th>
				<td>
					<fieldset>
						<?php foreach ( $event_types as $wpep_event_key => $wpep_event_label ) : ?>
							<label class="wpep-check-item">
								<input
									type="checkbox"
									name="<?php echo esc_attr( $wpep_option ); ?>[allowed_event_types][]"
									value="<?php echo esc_attr( $wpep_event_key ); ?>"
									<?php checked( in_array( $wpep_event_key, (array) $settings['allowed_event_types'], true ) ); ?>
								/>
								<?php echo esc_html( $wpep_event_label ); ?>
							</label>
						<?php endforeach; ?>
					</fieldset>
				</td>
			</tr>

			<tr>
				<th scope="row"><?php esc_html_e( 'حذف محتوای منتشرشده', 'wp-event-publisher' ); ?></th>
				<td>
					<label>
						<input type="checkbox" name="<?php echo esc_attr( $wpep_option ); ?>[trash_as_deleted]" value="1" <?php checked( ! empty( $settings['trash_as_deleted'] ) ); ?> />
						<?php esc_html_e( 'حذف محتوای منتشرشده هنگام حذف کامل', 'wp-event-publisher' ); ?>
					</label>
					<p class="description">
						<?php esc_html_e( 'با فعال بودن این گزینه، وقتی محتوایی در وردپرس برای همیشه حذف شود، جارچی تلاش می‌کند نسخه منتشرشده آن را هم از پلتفرم‌های متصل بردارد.', 'wp-event-publisher' ); ?>
						<br />
						<?php esc_html_e( 'در این حالت انتقال به زباله‌دان هم به‌عنوان حذف در نظر گرفته می‌شود و رویداد حذف کامل بعدی نادیده گرفته می‌شود، بنابراین سرویس دقیقاً یک رویداد دریافت می‌کند.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>
		</table>

		<h2 class="title"><?php esc_html_e( 'Delivery', 'wp-event-publisher' ); ?></h2>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Enable Webhooks', 'wp-event-publisher' ); ?></th>
				<td>
					<label>
						<input type="checkbox" name="<?php echo esc_attr( $wpep_option ); ?>[webhooks_enabled]" value="1" <?php checked( ! empty( $settings['webhooks_enabled'] ) ); ?> />
						<?php esc_html_e( 'Allow outgoing webhook requests. Disable to pause delivery without losing configuration.', 'wp-event-publisher' ); ?>
					</label>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-dispatch-mode"><?php esc_html_e( 'Dispatch Mode', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<select id="wpep-dispatch-mode" name="<?php echo esc_attr( $wpep_option ); ?>[dispatch_mode]">
						<option value="<?php echo esc_attr( WPEventPublisher\Settings::DISPATCH_AUTO ); ?>" <?php selected( (string) $settings['dispatch_mode'], WPEventPublisher\Settings::DISPATCH_AUTO ); ?>>
							<?php esc_html_e( 'Automatic — WP-Cron, with inline delivery when cron is unavailable (recommended)', 'wp-event-publisher' ); ?>
						</option>
						<option value="<?php echo esc_attr( WPEventPublisher\Settings::DISPATCH_IMMEDIATE ); ?>" <?php selected( (string) $settings['dispatch_mode'], WPEventPublisher\Settings::DISPATCH_IMMEDIATE ); ?>>
							<?php esc_html_e( 'Immediate — deliver at the end of the publish request', 'wp-event-publisher' ); ?>
						</option>
						<option value="<?php echo esc_attr( WPEventPublisher\Settings::DISPATCH_CRON ); ?>" <?php selected( (string) $settings['dispatch_mode'], WPEventPublisher\Settings::DISPATCH_CRON ); ?>>
							<?php esc_html_e( 'WP-Cron only', 'wp-event-publisher' ); ?>
						</option>
					</select>
					<p class="description">
						<?php esc_html_e( 'Events are always queued first. This setting only decides who drains the queue. A sweeper re-runs anything left waiting, whichever mode you pick.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-timeout"><?php esc_html_e( 'Webhook Timeout', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<input
						type="number"
						id="wpep-timeout"
						class="small-text"
						name="<?php echo esc_attr( $wpep_option ); ?>[webhook_timeout]"
						value="<?php echo esc_attr( (string) $settings['webhook_timeout'] ); ?>"
						min="<?php echo esc_attr( (string) WPEventPublisher\Validator::TIMEOUT_MIN ); ?>"
						max="<?php echo esc_attr( (string) WPEventPublisher\Validator::TIMEOUT_MAX ); ?>"
						step="1"
					/>
					<?php esc_html_e( 'seconds', 'wp-event-publisher' ); ?>
					<p class="description">
						<?php esc_html_e( 'How long one delivery attempt may take. Do not go below 10 seconds: a TLS handshake to a remote server can exceed a very short budget, which surfaces as "cURL error 28: Operation timed out" even though the endpoint is healthy.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-connect-timeout"><?php esc_html_e( 'Connection Timeout', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<input
						type="number"
						id="wpep-connect-timeout"
						class="small-text"
						name="<?php echo esc_attr( $wpep_option ); ?>[connect_timeout]"
						value="<?php echo esc_attr( (string) $settings['connect_timeout'] ); ?>"
						min="<?php echo esc_attr( (string) WPEventPublisher\Validator::TIMEOUT_MIN ); ?>"
						max="<?php echo esc_attr( (string) WPEventPublisher\Validator::TIMEOUT_MAX ); ?>"
						step="1"
					/>
					<?php esc_html_e( 'seconds', 'wp-event-publisher' ); ?>
					<p class="description">
						<?php esc_html_e( 'Budget for establishing the connection alone (DNS and TLS). It is part of the total timeout above, and it makes an unreachable host fail quickly and recognisably instead of consuming the whole window.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-retry-count"><?php esc_html_e( 'Retry Count', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<input
						type="number"
						id="wpep-retry-count"
						class="small-text"
						name="<?php echo esc_attr( $wpep_option ); ?>[retry_count]"
						value="<?php echo esc_attr( (string) $settings['retry_count'] ); ?>"
						min="0"
						max="<?php echo esc_attr( (string) WPEventPublisher\Validator::RETRY_MAX ); ?>"
						step="1"
					/>
					<p class="description">
						<?php esc_html_e( 'How many times a failed webhook is retried with exponential backoff (1, 2, 4, 8 … minutes). Every retry re-uses the same event_id, so the backend can deduplicate.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>


			<tr>
				<th scope="row">
					<label for="wpep-signature-tolerance"><?php esc_html_e( 'Webhook Signature Tolerance', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<input
						type="number"
						id="wpep-signature-tolerance"
						class="small-text"
						name="<?php echo esc_attr( $wpep_option ); ?>[signature_tolerance]"
						value="<?php echo esc_attr( (string) $settings['signature_tolerance'] ); ?>"
						min="<?php echo esc_attr( (string) WPEventPublisher\Validator::TOLERANCE_MIN ); ?>"
						max="<?php echo esc_attr( (string) WPEventPublisher\Validator::TOLERANCE_MAX ); ?>"
						step="1"
					/>
					<?php esc_html_e( 'seconds', 'wp-event-publisher' ); ?>
					<p class="description">
						<?php esc_html_e( 'Replay window advertised to the Node.js service. WordPress always signs the current time; every retry is re-signed with a fresh timestamp.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>
		</table>

		<h2 class="title"><?php esc_html_e( 'Advertisement fields', 'wp-event-publisher' ); ?></h2>

		<table class="form-table" role="presentation">




			<tr>
				<th scope="row">
					<label for="wpep-description-source"><?php esc_html_e( 'Description Source', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<select id="wpep-description-source" name="<?php echo esc_attr( $wpep_option ); ?>[description_source]">
						<option value="auto" <?php selected( (string) $settings['description_source'], 'auto' ); ?>>
							<?php esc_html_e( 'Automatic — excerpt when present, otherwise the content', 'wp-event-publisher' ); ?>
						</option>
						<option value="excerpt" <?php selected( (string) $settings['description_source'], 'excerpt' ); ?>>
							<?php esc_html_e( 'Excerpt only', 'wp-event-publisher' ); ?>
						</option>
						<option value="content" <?php selected( (string) $settings['description_source'], 'content' ); ?>>
							<?php esc_html_e( 'Full content', 'wp-event-publisher' ); ?>
						</option>
					</select>
					<p class="description">
						<?php esc_html_e( 'The description is sent as plain UTF-8 text, ready for a Telegram message. The untouched HTML is still available as post.content.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-max-images"><?php esc_html_e( 'Maximum Images', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<input
						type="number"
						id="wpep-max-images"
						class="small-text"
						name="<?php echo esc_attr( $wpep_option ); ?>[max_images]"
						value="<?php echo esc_attr( (string) $settings['max_images'] ); ?>"
						min="0"
						max="<?php echo esc_attr( (string) WPEventPublisher\Validator::IMAGES_MAX ); ?>"
						step="1"
					/>
					<p class="description">
						<?php esc_html_e( 'How many image URLs travel in the images array. The featured image always comes first.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>
		</table>

		<h2 class="title"><?php esc_html_e( 'Diagnostics', 'wp-event-publisher' ); ?></h2>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Enable Logging', 'wp-event-publisher' ); ?></th>
				<td>
					<label>
						<input type="checkbox" name="<?php echo esc_attr( $wpep_option ); ?>[logging_enabled]" value="1" <?php checked( ! empty( $settings['logging_enabled'] ) ); ?> />
						<?php esc_html_e( 'Log queueing, delivery and responses. Failures are always logged.', 'wp-event-publisher' ); ?>
					</label>
				</td>
			</tr>

			<tr>
				<th scope="row">
					<label for="wpep-admin-locale"><?php esc_html_e( 'Admin Language', 'wp-event-publisher' ); ?></label>
				</th>
				<td>
					<select id="wpep-admin-locale" name="<?php echo esc_attr( $wpep_option ); ?>[admin_locale]">
						<option value="<?php echo esc_attr( WPEventPublisher\Settings::LOCALE_FA ); ?>" <?php selected( (string) $settings['admin_locale'], WPEventPublisher\Settings::LOCALE_FA ); ?>>
							<?php esc_html_e( 'Persian (right to left)', 'wp-event-publisher' ); ?>
						</option>
						<option value="<?php echo esc_attr( WPEventPublisher\Settings::LOCALE_EN ); ?>" <?php selected( (string) $settings['admin_locale'], WPEventPublisher\Settings::LOCALE_EN ); ?>>
							<?php esc_html_e( 'English', 'wp-event-publisher' ); ?>
						</option>
						<option value="<?php echo esc_attr( WPEventPublisher\Settings::LOCALE_SITE ); ?>" <?php selected( (string) $settings['admin_locale'], WPEventPublisher\Settings::LOCALE_SITE ); ?>>
							<?php esc_html_e( 'Follow the WordPress language', 'wp-event-publisher' ); ?>
						</option>
					</select>
					<p class="description">
						<?php esc_html_e( 'Language of this plugin\'s own admin screens. Only these screens are affected; the rest of the WordPress admin keeps the site language.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>

			<tr>
				<th scope="row"><?php esc_html_e( 'Debug Mode', 'wp-event-publisher' ); ?></th>
				<td>
					<label>
						<input type="checkbox" name="<?php echo esc_attr( $wpep_option ); ?>[debug_mode]" value="1" <?php checked( ! empty( $settings['debug_mode'] ) ); ?> />
						<?php esc_html_e( 'Log the complete event lifecycle: every hook, every skip reason, every scheduling decision and every request.', 'wp-event-publisher' ); ?>
					</label>
					<p class="description">
						<?php esc_html_e( 'Turn this on while diagnosing a publish that produced nothing, then turn it off again. Secrets are never written to the log. With WP_DEBUG_LOG enabled the same entries are mirrored into debug.log.', 'wp-event-publisher' ); ?>
					</p>
				</td>
			</tr>
		</table>

		<p class="submit">
			<?php submit_button( __( 'Save Settings', 'wp-event-publisher' ), 'primary', 'submit', false ); ?>
			<button type="button" class="button" id="wpep-test-connection">
				<?php esc_html_e( 'Connection Test', 'wp-event-publisher' ); ?>
			</button>
		</p>

		<div id="wpep-test-result" class="wpep-result" role="status" aria-live="polite" hidden></div>
	</form>
</div>
