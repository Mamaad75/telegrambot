<?php
/**
 * Announcement post type and query layer.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;
use WP_Query;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Site announcements: short notices an administrator writes in WordPress and
 * shows on the front end.
 *
 * Deliberately a real custom post type rather than a bespoke table. Editing,
 * revisions, scheduling, capabilities and the list table all already exist and
 * all already work; a private table would mean reimplementing every one of
 * them, and getting the capability checks wrong in the process.
 *
 * The extra behaviour a post type does not give for free is a window: an
 * announcement may have an expiry date, after which it stops being shown
 * without anyone having to remember to unpublish it. That window, and the
 * public/logged-in audience switch, are what {@see self::active()} applies.
 *
 * @since 1.6.0
 */
class Announcements {

	/**
	 * Post type slug.
	 *
	 * Namespaced to the product so it cannot collide with a theme's own
	 * announcements, and stable because posts are stored against it.
	 *
	 * @var string
	 */
	public const POST_TYPE = 'jarchi_announcement';

	/**
	 * Meta key: ISO-8601 date after which the announcement stops showing.
	 *
	 * @var string
	 */
	public const META_EXPIRES = '_jarchi_expires_at';

	/**
	 * Meta key: dashicon name shown beside the title.
	 *
	 * @var string
	 */
	public const META_ICON = '_jarchi_icon';

	/**
	 * Meta key: sort weight, higher first.
	 *
	 * @var string
	 */
	public const META_PRIORITY = '_jarchi_priority';

	/**
	 * Meta key: optional link the announcement points at.
	 *
	 * @var string
	 */
	public const META_LINK = '_jarchi_link';

	/**
	 * Meta key: attachment ID of the announcement image.
	 *
	 * Stored as an ID rather than a URL so the image survives a domain change
	 * or an SSL migration, and so WordPress can still report it as attached.
	 *
	 * @since 1.6.0
	 * @var string
	 */
	public const META_IMAGE = '_jarchi_image_id';

	/**
	 * Meta key: who may see it — `public` or `logged_in`.
	 *
	 * @var string
	 */
	public const META_AUDIENCE = '_jarchi_audience';

	/**
	 * Audience: anyone, including logged-out visitors.
	 *
	 * @var string
	 */
	public const AUDIENCE_PUBLIC = 'public';

	/**
	 * Audience: signed-in users only.
	 *
	 * @var string
	 */
	public const AUDIENCE_LOGGED_IN = 'logged_in';

	/**
	 * Nonce action for the editor metabox.
	 *
	 * @var string
	 */
	private const NONCE = 'wpep_announcement';

	/**
	 * Option holding the page that displays announcements.
	 *
	 * A real WordPress page, chosen or created by the administrator, so it can
	 * be edited with Elementor — or the block editor, or any builder the site
	 * already uses. The plugin does not implement a page builder of its own;
	 * it supplies a shortcode and gets out of the way.
	 *
	 * @since 1.6.0
	 * @var string
	 */
	public const OPTION_PAGE = 'wpep_announcement_page';

	/**
	 * Registers the post type, its meta and its editor UI.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_post_type' ) );
		add_action( 'add_meta_boxes', array( $this, 'add_meta_box' ) );
		add_action( 'save_post_' . self::POST_TYPE, array( $this, 'save' ), 10, 2 );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
		add_action( 'admin_post_wpep_create_announcement_page', array( $this, 'handle_create_page' ) );
		add_action( 'admin_init', array( $this, 'register_page_setting' ) );
	}

	/**
	 * Registers the post type.
	 *
	 * Not publicly queryable: an announcement is a fragment shown inside
	 * another page, not a page of its own, so giving it a permalink would
	 * create thin URLs nobody asked for. `show_in_rest` stays off for the
	 * same reason — the front end reads announcements through this plugin's
	 * own filtered query, which applies the audience and expiry rules that a
	 * generic REST collection would not.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function register_post_type(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'               => __( 'اطلاعیه‌ها', 'wp-event-publisher' ),
					'singular_name'      => __( 'اطلاعیه', 'wp-event-publisher' ),
					'add_new'            => __( 'افزودن اطلاعیه', 'wp-event-publisher' ),
					'add_new_item'       => __( 'افزودن اطلاعیه تازه', 'wp-event-publisher' ),
					'edit_item'          => __( 'ویرایش اطلاعیه', 'wp-event-publisher' ),
					'new_item'           => __( 'اطلاعیه تازه', 'wp-event-publisher' ),
					'view_item'          => __( 'مشاهده اطلاعیه', 'wp-event-publisher' ),
					'search_items'       => __( 'جستجوی اطلاعیه‌ها', 'wp-event-publisher' ),
					'not_found'          => __( 'اطلاعیه‌ای یافت نشد.', 'wp-event-publisher' ),
					'not_found_in_trash' => __( 'اطلاعیه‌ای در زباله‌دان نیست.', 'wp-event-publisher' ),
					'menu_name'          => __( 'اطلاعیه‌ها', 'wp-event-publisher' ),
				),
				'public'              => false,
				'publicly_queryable'  => false,
				'show_ui'             => true,
				// Listed under the Jarchi menu, which Admin adds explicitly.
				'show_in_menu'        => false,
				'show_in_rest'        => false,
				'exclude_from_search' => true,
				'has_archive'         => false,
				'rewrite'             => false,
				'query_var'           => false,
				'capability_type'     => 'post',
				'map_meta_cap'        => true,
				'supports'            => array( 'title', 'editor', 'author', 'revisions' ),
				'menu_icon'           => 'dashicons-megaphone',
			)
		);
	}

	/**
	 * Adds the announcement settings metabox.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function add_meta_box(): void {
		add_meta_box(
			'wpep-announcement',
			__( 'تنظیمات اطلاعیه', 'wp-event-publisher' ),
			array( $this, 'render_meta_box' ),
			self::POST_TYPE,
			'side',
			'high'
		);
	}

	/**
	 * Registers the announcement page option with the Settings API.
	 *
	 * Sanitized to an ID that is really a page, so a crafted form cannot point
	 * the setting at an arbitrary post.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function register_page_setting(): void {
		register_setting(
			'wpep_announcement_page_group',
			self::OPTION_PAGE,
			array(
				'type'              => 'integer',
				'default'           => 0,
				'sanitize_callback' => static function ( $value ): int {
					$id = absint( $value );

					return ( $id > 0 && 'page' === get_post_type( $id ) ) ? $id : 0;
				},
			)
		);
	}

	/**
	 * Returns the configured announcement page, if it still exists.
	 *
	 * Checked rather than trusted: an administrator can delete the page, and a
	 * stale ID pointing at nothing would otherwise produce a broken "edit"
	 * link with no explanation.
	 *
	 * @since 1.6.0
	 *
	 * @return WP_Post|null The page, or null when unset or deleted.
	 */
	public function page(): ?WP_Post {
		$id = (int) get_option( self::OPTION_PAGE, 0 );

		if ( $id <= 0 ) {
			return null;
		}

		$page = get_post( $id );

		if ( ! $page instanceof WP_Post || 'page' !== $page->post_type || 'trash' === $page->post_status ) {
			return null;
		}

		return $page;
	}

	/**
	 * Creates a page that displays announcements, and selects it.
	 *
	 * The page is a perfectly ordinary WordPress page whose content is the
	 * shortcode. That is the whole trick: Elementor, the block editor and any
	 * other builder can all edit it, because there is nothing special about
	 * it. No custom builder, no bespoke template, nothing to maintain.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function handle_create_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ), '', array( 'response' => 403 ) );
		}

		check_admin_referer( 'wpep_create_announcement_page' );

		$id = wp_insert_post(
			array(
				'post_title'   => __( 'اطلاعیه‌ها', 'wp-event-publisher' ),
				'post_content' => '[jarchi_announcements count="10"]',
				'post_status'  => 'publish',
				'post_type'    => 'page',
			),
			true
		);

		if ( ! is_wp_error( $id ) && $id > 0 ) {
			update_option( self::OPTION_PAGE, (int) $id );
		}

		wp_safe_redirect( Admin::app_url( 'announcement-page' ) );
		exit;
	}

	/**
	 * Whether Elementor is active and can edit a page.
	 *
	 * @since 1.6.0
	 *
	 * @return bool True when Elementor is available.
	 */
	public static function elementor_available(): bool {
		return did_action( 'elementor/loaded' ) > 0 || class_exists( '\\Elementor\\Plugin' );
	}

	/**
	 * Returns the Elementor edit URL for a page.
	 *
	 * @since 1.6.0
	 *
	 * @param int $page_id Page ID.
	 *
	 * @return string Edit URL, or an empty string when Elementor is absent.
	 */
	public static function elementor_edit_url( int $page_id ): string {
		if ( ! self::elementor_available() || $page_id <= 0 ) {
			return '';
		}

		return admin_url( 'post.php?post=' . $page_id . '&action=elementor' );
	}

	/**
	 * Loads the media library and the picker script on the announcement editor.
	 *
	 * Scoped to this one screen. wp_enqueue_media() pulls in a substantial
	 * amount of JavaScript, and loading it on every admin page to serve one
	 * metabox would be a performance regression for everyone else.
	 *
	 * @since 1.6.0
	 *
	 * @param string $hook_suffix Current admin page.
	 *
	 * @return void
	 */
	public function enqueue( string $hook_suffix ): void {
		if ( ! in_array( $hook_suffix, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}

		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

		if ( ! $screen || self::POST_TYPE !== $screen->post_type ) {
			return;
		}

		wp_enqueue_media();

		wp_enqueue_style(
			'wpep-admin',
			WPEP_PLUGIN_URL . 'admin/css/admin.css',
			array(),
			WPEP_VERSION
		);

		wp_enqueue_script(
			'wpep-announcement',
			WPEP_PLUGIN_URL . 'admin/js/announcement.js',
			array( 'jquery' ),
			WPEP_VERSION,
			true
		);

		// The placement editor is dependency-free, so it needs no jQuery.
		wp_enqueue_script(
			'wpep-placement',
			WPEP_PLUGIN_URL . 'admin/js/placement.js',
			array(),
			WPEP_VERSION,
			true
		);

		wp_localize_script(
			'wpep-announcement',
			'wpepAnnouncement',
			array(
				'chooseImage' => __( 'انتخاب تصویر اطلاعیه', 'wp-event-publisher' ),
				'useImage'    => __( 'استفاده از این تصویر', 'wp-event-publisher' ),
				'select'      => __( 'انتخاب تصویر', 'wp-event-publisher' ),
				'change'      => __( 'تغییر تصویر', 'wp-event-publisher' ),
			)
		);
	}

	/**
	 * Renders the announcement settings metabox.
	 *
	 * @since 1.6.0
	 *
	 * @param WP_Post $post Post being edited.
	 *
	 * @return void
	 */
	public function render_meta_box( WP_Post $post ): void {
		wp_nonce_field( self::NONCE, self::NONCE );

		$expires  = (string) get_post_meta( $post->ID, self::META_EXPIRES, true );
		$icon     = (string) get_post_meta( $post->ID, self::META_ICON, true );
		$priority = (string) get_post_meta( $post->ID, self::META_PRIORITY, true );
		$link     = (string) get_post_meta( $post->ID, self::META_LINK, true );
		$image    = (int) get_post_meta( $post->ID, self::META_IMAGE, true );
		$audience = (string) get_post_meta( $post->ID, self::META_AUDIENCE, true );
		$audience = self::AUDIENCE_LOGGED_IN === $audience ? $audience : self::AUDIENCE_PUBLIC;
		$preview  = $image > 0 ? wp_get_attachment_image_url( $image, 'medium' ) : '';
		?>
		<div class="wpep-ann-panel">

			<section class="wpep-ann-group">
				<h4><?php esc_html_e( 'نمایش', 'wp-event-publisher' ); ?></h4>

				<p>
					<label for="wpep-ann-expires"><?php esc_html_e( 'تاریخ انقضا', 'wp-event-publisher' ); ?></label>
					<input type="date" id="wpep-ann-expires" name="wpep_expires_at" value="<?php echo esc_attr( $expires ); ?>" class="widefat" />
					<span class="description"><?php esc_html_e( 'بعد از این تاریخ دیگر نمایش داده نمی‌شود. خالی بگذارید تا همیشه بماند.', 'wp-event-publisher' ); ?></span>
				</p>

				<p>
					<label for="wpep-ann-audience"><?php esc_html_e( 'مخاطبان', 'wp-event-publisher' ); ?></label>
					<select id="wpep-ann-audience" name="wpep_audience" class="widefat">
						<option value="<?php echo esc_attr( self::AUDIENCE_PUBLIC ); ?>" <?php selected( self::AUDIENCE_PUBLIC, $audience ); ?>>
							<?php esc_html_e( 'عمومی — همه بازدیدکنندگان', 'wp-event-publisher' ); ?>
						</option>
						<option value="<?php echo esc_attr( self::AUDIENCE_LOGGED_IN ); ?>" <?php selected( self::AUDIENCE_LOGGED_IN, $audience ); ?>>
							<?php esc_html_e( 'فقط کاربران واردشده', 'wp-event-publisher' ); ?>
						</option>
					</select>
					<span class="description"><?php esc_html_e( 'اطلاعیه خصوصی هرگز به بازدیدکننده‌ای که وارد نشده نمایش داده نمی‌شود.', 'wp-event-publisher' ); ?></span>
				</p>

				<p>
					<label for="wpep-ann-priority"><?php esc_html_e( 'اهمیت', 'wp-event-publisher' ); ?></label>
					<input type="number" id="wpep-ann-priority" name="wpep_priority" value="<?php echo esc_attr( '' !== $priority ? $priority : '0' ); ?>" class="widefat" min="-100" max="100" />
					<span class="description"><?php esc_html_e( 'عدد بزرگ‌تر بالاتر نمایش داده می‌شود.', 'wp-event-publisher' ); ?></span>
				</p>
			</section>

			<section class="wpep-ann-group">
				<h4><?php esc_html_e( 'ظاهر', 'wp-event-publisher' ); ?></h4>

				<div class="wpep-ann-field">
					<label><?php esc_html_e( 'آیکون', 'wp-event-publisher' ); ?></label>

					<div class="wpep-icon-picker" data-jarchi-icon-picker>
						<button type="button" class="button wpep-icon-picker__open">
							<?php esc_html_e( 'انتخاب آیکون', 'wp-event-publisher' ); ?>
						</button>
						<span class="wpep-icon-picker__preview" aria-hidden="true">
							<span class="dashicons dashicons-<?php echo esc_attr( '' !== $icon ? $icon : 'megaphone' ); ?>"></span>
						</span>
						<button type="button" class="button-link wpep-icon-picker__clear"<?php echo '' === $icon ? ' hidden' : ''; ?>>
							<?php esc_html_e( 'حذف', 'wp-event-publisher' ); ?>
						</button>

						<input type="hidden" name="wpep_icon" value="<?php echo esc_attr( $icon ); ?>" class="wpep-icon-picker__value" />

						<div class="wpep-icon-picker__grid" hidden>
							<?php foreach ( self::icon_choices() as $wpep_choice ) : ?>
								<button
									type="button"
									class="wpep-icon-picker__choice<?php echo $wpep_choice === $icon ? ' is-selected' : ''; ?>"
									data-icon="<?php echo esc_attr( $wpep_choice ); ?>"
									title="<?php echo esc_attr( $wpep_choice ); ?>"
								>
									<span class="dashicons dashicons-<?php echo esc_attr( $wpep_choice ); ?>"></span>
								</button>
							<?php endforeach; ?>
						</div>
					</div>
				</div>

				<div class="wpep-ann-field">
					<label><?php esc_html_e( 'تصویر', 'wp-event-publisher' ); ?></label>

					<div class="wpep-media-picker" data-jarchi-media-picker>
						<div class="wpep-media-picker__preview"<?php echo '' === $preview ? ' hidden' : ''; ?>>
							<img src="<?php echo esc_url( $preview ); ?>" alt="" />
						</div>

						<p class="wpep-media-picker__actions">
							<button type="button" class="button wpep-media-picker__select">
								<?php echo '' === $preview ? esc_html__( 'انتخاب تصویر', 'wp-event-publisher' ) : esc_html__( 'تغییر تصویر', 'wp-event-publisher' ); ?>
							</button>
							<button type="button" class="button-link wpep-media-picker__remove"<?php echo '' === $preview ? ' hidden' : ''; ?>>
								<?php esc_html_e( 'حذف تصویر', 'wp-event-publisher' ); ?>
							</button>
						</p>

						<input type="hidden" name="wpep_image_id" value="<?php echo esc_attr( (string) $image ); ?>" class="wpep-media-picker__value" />
					</div>
				</div>

				<p>
					<label for="wpep-ann-link"><?php esc_html_e( 'پیوند', 'wp-event-publisher' ); ?></label>
					<input type="url" id="wpep-ann-link" name="wpep_link" value="<?php echo esc_attr( $link ); ?>" class="widefat" dir="ltr" placeholder="https://" />
					<span class="description"><?php esc_html_e( 'اختیاری. با کلیک روی عنوان اطلاعیه باز می‌شود.', 'wp-event-publisher' ); ?></span>
				</p>
			</section>
		</div>
		<?php
	}

	/**
	 * The icons offered by the picker.
	 *
	 * A short, curated list of Dashicons that suit a notice, rather than the
	 * whole set: an administrator choosing an icon for an announcement is
	 * better served by twenty relevant options than by four hundred.
	 *
	 * @since 1.6.0
	 *
	 * @return string[] Dashicon names without the `dashicons-` prefix.
	 */
	public static function icon_choices(): array {
		return array(
			'megaphone',
			'info',
			'warning',
			'bell',
			'star-filled',
			'yes-alt',
			'dismiss',
			'clock',
			'calendar-alt',
			'admin-users',
			'cart',
			'tag',
			'awards',
			'lightbulb',
			'flag',
			'sos',
			'update',
			'download',
			'email-alt',
			'admin-site-alt3',
		);
	}

	/**
	 * Saves the announcement settings.
	 *
	 * @since 1.6.0
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post object.
	 *
	 * @return void
	 */
	public function save( int $post_id, WP_Post $post ): void {
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}

		if ( ! isset( $_POST[ self::NONCE ] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( (string) $_POST[ self::NONCE ] ) ), self::NONCE ) ) {
			return;
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		$this->save_meta( $post_id, wp_unslash( $_POST ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified above.
	}

	/**
	 * Writes the announcement meta from a submitted array.
	 *
	 * Split out of {@see self::save()} so the announcement builder stores its
	 * fields through exactly the same sanitizing, rather than a second copy
	 * that would drift. Capability and nonce are the caller's responsibility,
	 * because the two entry points authenticate differently.
	 *
	 * @since 1.7.1
	 *
	 * @param int                 $post_id Announcement identifier.
	 * @param array<string,mixed> $input   Unslashed submitted values.
	 *
	 * @return void
	 */
	public function save_meta( int $post_id, array $input ): void {
		// A date input yields YYYY-MM-DD or nothing; anything else is rejected
		// rather than coerced, so a malformed value cannot become a window
		// that never closes.
		$expires = isset( $input['wpep_expires_at'] ) ? sanitize_text_field( (string) $input['wpep_expires_at'] ) : '';
		$expires = preg_match( '/^\d{4}-\d{2}-\d{2}$/', $expires ) ? $expires : '';
		update_post_meta( $post_id, self::META_EXPIRES, $expires );

		$audience = isset( $input['wpep_audience'] ) ? sanitize_key( (string) $input['wpep_audience'] ) : '';
		$audience = self::AUDIENCE_LOGGED_IN === $audience ? $audience : self::AUDIENCE_PUBLIC;
		update_post_meta( $post_id, self::META_AUDIENCE, $audience );

		// Dashicon names are a restricted alphabet; anything else would end up
		// inside a class attribute.
		$icon = isset( $input['wpep_icon'] ) ? sanitize_key( (string) $input['wpep_icon'] ) : '';
		// Constrained to the offered list rather than merely sanitized: the
		// value lands inside a class attribute, and an allowlist is a stronger
		// guarantee than an escaping rule someone has to remember.
		$icon = in_array( $icon, self::icon_choices(), true ) ? $icon : '';
		update_post_meta( $post_id, self::META_ICON, $icon );

		$priority = isset( $input['wpep_priority'] ) ? (int) $input['wpep_priority'] : 0;
		update_post_meta( $post_id, self::META_PRIORITY, max( -100, min( 100, $priority ) ) );

		// esc_url_raw with an explicit scheme allowlist: an announcement link
		// is rendered as an href, so javascript: and data: must never survive.
		$link = isset( $input['wpep_link'] ) ? esc_url_raw( (string) $input['wpep_link'], array( 'http', 'https', 'mailto', 'tel' ) ) : '';
		update_post_meta( $post_id, self::META_LINK, $link );

		// An attachment ID, not a URL. Verified to be an attachment that
		// actually exists, so a crafted form cannot point the image at an
		// arbitrary post ID and have the front end render whatever that is.
		$image = isset( $input['wpep_image_id'] ) ? absint( $input['wpep_image_id'] ) : 0;

		if ( $image > 0 && 'attachment' !== get_post_type( $image ) ) {
			$image = 0;
		}

		update_post_meta( $post_id, self::META_IMAGE, $image );
	}

	/**
	 * Returns the announcements a given viewer may currently see.
	 *
	 * Applies three rules the post type does not apply on its own: published
	 * only, not past its expiry date, and allowed for this viewer. The
	 * audience rule is applied here rather than in the template, so every
	 * caller — shortcode, widget, icon panel — gets it without having to
	 * remember it.
	 *
	 * @since 1.6.0
	 *
	 * @param int $limit Maximum number to return.
	 *
	 * @return WP_Post[] Announcements, highest priority first, then newest.
	 */
	public function active( int $limit = 5 ): array {
		$limit = max( 1, min( 50, $limit ) );

		$query = new WP_Query(
			array(
				'post_type'              => self::POST_TYPE,
				'post_status'            => 'publish',
				// Fetch a little more than asked for, because the expiry and
				// audience filters below remove rows after the query.
				'posts_per_page'         => $limit * 3,
				'ignore_sticky_posts'    => true,
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
				'orderby'                => array( 'date' => 'DESC' ),
			)
		);

		$today   = current_time( 'Y-m-d' );
		$active  = array();
		$user_in = is_user_logged_in();

		foreach ( $query->posts as $post ) {
			if ( ! $post instanceof WP_Post ) {
				continue;
			}

			$expires = (string) get_post_meta( $post->ID, self::META_EXPIRES, true );

			if ( '' !== $expires && $expires < $today ) {
				continue;
			}

			// The privacy rule. A logged-out visitor never sees a logged-in
			// announcement, whatever the caller asked for.
			if ( self::AUDIENCE_LOGGED_IN === (string) get_post_meta( $post->ID, self::META_AUDIENCE, true ) && ! $user_in ) {
				continue;
			}

			$active[] = $post;
		}

		usort(
			$active,
			static function ( WP_Post $a, WP_Post $b ): int {
				$pa = (int) get_post_meta( $a->ID, self::META_PRIORITY, true );
				$pb = (int) get_post_meta( $b->ID, self::META_PRIORITY, true );

				if ( $pa === $pb ) {
					return strcmp( (string) $b->post_date_gmt, (string) $a->post_date_gmt );
				}

				return $pb <=> $pa;
			}
		);

		return array_slice( $active, 0, $limit );
	}

	/**
	 * Returns the display data for one announcement.
	 *
	 * Everything here is already escaped for HTML output by the caller; this
	 * only assembles it, so there is one place that decides what an
	 * announcement *is* and the three front ends cannot drift apart.
	 *
	 * @since 1.6.0
	 *
	 * @param WP_Post $post Announcement.
	 *
	 * @return array<string,string> Display data.
	 */
	public function view( WP_Post $post ): array {
		$expires  = (string) get_post_meta( $post->ID, self::META_EXPIRES, true );
		$priority = (int) get_post_meta( $post->ID, self::META_PRIORITY, true );
		$image_id = (int) get_post_meta( $post->ID, self::META_IMAGE, true );

		// The badge says its meaning in words, not only in colour, so the
		// state is still readable to someone who cannot tell the hues apart.
		$badge      = '';
		$badge_kind = '';

		if ( '' !== $expires && $expires < current_time( 'Y-m-d' ) ) {
			$badge      = __( 'منقضی', 'wp-event-publisher' );
			$badge_kind = 'expired';
		} elseif ( $priority >= 10 ) {
			$badge      = __( 'مهم', 'wp-event-publisher' );
			$badge_kind = 'important';
		} elseif ( '' !== $expires ) {
			$badge      = __( 'فعال', 'wp-event-publisher' );
			$badge_kind = 'active';
		}

		return array(
			'id'         => (string) $post->ID,
			'title'      => get_the_title( $post ),
			'content'    => wp_kses_post( (string) $post->post_content ),
			'icon'       => (string) get_post_meta( $post->ID, self::META_ICON, true ),
			'link'       => (string) get_post_meta( $post->ID, self::META_LINK, true ),
			'date'       => (string) get_post_time( get_option( 'date_format' ), false, $post ),
			'datetime'   => (string) get_post_time( 'c', true, $post ),
			'badge'      => $badge,
			'badge_kind' => $badge_kind,
			'image'      => $image_id > 0 ? (string) wp_get_attachment_image_url( $image_id, 'medium' ) : '',
		);
	}
}
