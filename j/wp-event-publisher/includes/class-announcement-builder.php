<?php
/**
 * Jarchi announcement builder.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * A dedicated screen for writing and configuring an announcement.
 *
 * The announcement post type keeps its editor and its metaboxes — a site that
 * relies on them, or on a plugin that adds its own box, is not broken by this
 * — but the route an administrator is sent to is this one: content on the
 * left, everything that decides where and when it appears on the right, and a
 * preview that renders through the real front-end renderer.
 *
 * Storage is unchanged. The same post type, the same meta keys and the same
 * sanitizing methods are used, so an announcement written here and one
 * written in the classic editor are indistinguishable on disk, and a legacy
 * announcement opens here with everything intact.
 *
 * @since 1.7.1
 */
class AnnouncementBuilder {

	/**
	 * Screen slug.
	 *
	 * @var string
	 */
	public const PAGE = 'wp-event-publisher-announcement';

	/**
	 * Nonce action for the builder form.
	 *
	 * @var string
	 */
	public const NONCE = 'wpep_builder';

	/**
	 * admin-post action that stores a submission.
	 *
	 * @var string
	 */
	public const ACTION_SAVE = 'wpep_builder_save';

	/**
	 * Announcement post type service.
	 *
	 * @var Announcements
	 */
	private Announcements $announcements;

	/**
	 * Placement registry.
	 *
	 * @var AnnouncementPlacements
	 */
	private AnnouncementPlacements $placements;

	/**
	 * Front-end renderer, used so the preview is the real component.
	 *
	 * @var AnnouncementsFrontend
	 */
	private AnnouncementsFrontend $frontend;

	/**
	 * Constructor.
	 *
	 * @since 1.7.1
	 *
	 * @param Announcements          $announcements Announcement post type.
	 * @param AnnouncementPlacements $placements    Placement registry.
	 * @param AnnouncementsFrontend  $frontend      Front-end renderer.
	 */
	public function __construct( Announcements $announcements, AnnouncementPlacements $placements, AnnouncementsFrontend $frontend ) {
		$this->announcements = $announcements;
		$this->placements    = $placements;
		$this->frontend      = $frontend;
	}

	/**
	 * Registers the screen, its handler and its routing.
	 *
	 * @since 1.7.1
	 *
	 * @return void
	 */
	public function register(): void {
		// The builder screen is registered centrally by Admin::register_menu()
		// as a hidden admin page. Keeping one registration point prevents the
		// screen from being removed when Jarchi trims the visible native menu.
		add_action( 'admin_post_' . self::ACTION_SAVE, array( $this, 'handle_save' ) );
		add_action( 'wp_ajax_wpep_builder_preview', array( $this, 'ajax_preview' ) );

		// "Add new" and the row's "edit" link both lead here, which is what
		// makes this the editing experience rather than a second one hidden
		// behind a menu item.
		add_action( 'load-post-new.php', array( $this, 'redirect_new' ) );
		add_action( 'load-post.php', array( $this, 'redirect_edit' ) );
		add_filter( 'post_row_actions', array( $this, 'row_actions' ), 10, 2 );
		add_filter( 'get_edit_post_link', array( $this, 'edit_link' ), 10, 2 );

		// The list has to answer "where does this show, to whom, and is it
		// live?" without opening each announcement.
		add_filter( 'manage_' . Announcements::POST_TYPE . '_posts_columns', array( $this, 'columns' ) );
		add_action( 'manage_' . Announcements::POST_TYPE . '_posts_custom_column', array( $this, 'column' ), 10, 2 );
		add_filter( 'manage_edit-' . Announcements::POST_TYPE . '_sortable_columns', array( $this, 'sortable_columns' ) );
	}

	/**
	 * Declares the announcement list's columns.
	 *
	 * @since 1.7.1
	 *
	 * @param array<string,string> $columns Existing columns.
	 *
	 * @return array<string,string> Modified columns.
	 */
	public function columns( $columns ): array {
		$columns = (array) $columns;
		$date    = $columns['date'] ?? null;

		unset( $columns['date'] );

		$columns['wpep_state']     = __( 'وضعیت', 'wp-event-publisher' );
		$columns['wpep_placement'] = __( 'محل نمایش', 'wp-event-publisher' );
		$columns['wpep_audience']  = __( 'مخاطب', 'wp-event-publisher' );
		$columns['wpep_priority']  = __( 'اولویت', 'wp-event-publisher' );
		$columns['wpep_expires']   = __( 'انقضا', 'wp-event-publisher' );

		if ( null !== $date ) {
			$columns['date'] = $date;
		}

		return $columns;
	}

	/**
	 * Makes priority and expiry sortable.
	 *
	 * @since 1.7.1
	 *
	 * @param array<string,string> $columns Sortable columns.
	 *
	 * @return array<string,string> Modified columns.
	 */
	public function sortable_columns( $columns ): array {
		$columns = (array) $columns;

		$columns['wpep_priority'] = 'wpep_priority';
		$columns['wpep_expires']  = 'wpep_expires';

		return $columns;
	}

	/**
	 * Renders one list column.
	 *
	 * @since 1.7.1
	 *
	 * @param string $column  Column key.
	 * @param int    $post_id Announcement identifier.
	 *
	 * @return void
	 */
	public function column( $column, $post_id ): void {
		$column  = (string) $column;
		$post_id = (int) $post_id;
		$post    = get_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			return;
		}

		switch ( $column ) {
			case 'wpep_state':
				$expires = (string) get_post_meta( $post_id, Announcements::META_EXPIRES, true );
				$expired = '' !== $expires && $expires < current_time( 'Y-m-d' );

				if ( 'publish' !== $post->post_status ) {
					$this->pill( __( 'پیش‌نویس', 'wp-event-publisher' ), 'muted' );
				} elseif ( $expired ) {
					$this->pill( __( 'منقضی', 'wp-event-publisher' ), 'danger' );
				} else {
					$this->pill( __( 'فعال', 'wp-event-publisher' ), 'success' );
				}

				break;

			case 'wpep_placement':
				$placement = AnnouncementPlacements::placement_of( $post );
				$all       = AnnouncementPlacements::all();

				echo esc_html( (string) ( $all[ $placement ]['label'] ?? $placement ) );

				$conditions = get_post_meta( $post_id, AnnouncementPlacements::META_CONDITIONS, true );
				$rules      = is_array( $conditions ) ? (array) ( $conditions['rules'] ?? array() ) : array();

				if ( ! empty( $rules ) ) {
					echo '<br /><small>';
					printf(
						/* translators: %d: number of display conditions. */
						esc_html( _n( '%d شرط نمایش', '%d شرط نمایش', count( $rules ), 'wp-event-publisher' ) ),
						count( $rules )
					);
					echo '</small>';
				}

				break;

			case 'wpep_audience':
				$audience = (string) get_post_meta( $post_id, Announcements::META_AUDIENCE, true );

				echo esc_html(
					Announcements::AUDIENCE_LOGGED_IN === $audience
						? __( 'کاربران وارد شده', 'wp-event-publisher' )
						: __( 'همه', 'wp-event-publisher' )
				);

				break;

			case 'wpep_priority':
				echo esc_html( number_format_i18n( (int) get_post_meta( $post_id, Announcements::META_PRIORITY, true ) ) );

				break;

			case 'wpep_expires':
				$expires = (string) get_post_meta( $post_id, Announcements::META_EXPIRES, true );

				echo '' !== $expires ? esc_html( $expires ) : '<span aria-hidden="true">—</span>';

				break;
		}
	}

	/**
	 * Prints a small status pill.
	 *
	 * @since 1.7.1
	 *
	 * @param string $label Text to show.
	 * @param string $kind  Visual kind: success, danger or muted.
	 *
	 * @return void
	 */
	private function pill( string $label, string $kind ): void {
		printf(
			'<span class="wpep-pill wpep-pill--%s">%s</span>',
			esc_attr( $kind ),
			esc_html( $label )
		);
	}

	/**
	 * Registers the builder as a hidden screen.
	 *
	 * Registered under the Jarchi menu, not under the announcement post type.
	 *
	 * The post type is declared with `show_in_menu => false`, so
	 * `edit.php?post_type=jarchi_announcement` is never a registered admin
	 * menu. Using it as a submenu parent produced a hook name that
	 * `wp-admin/admin.php` could not find in `$_registered_pages`, and its
	 * response to that is `wp_die( 'Sorry, you are not allowed to access this
	 * page.' )` — a registration failure that reads as a permissions failure.
	 * Registering under the plugin's own menu gives a plain
	 * `admin.php?page=…` route, which needs no such indirection.
	 *
	 * @since 1.7.1
	 *
	 * @return void
	 */
	public function register_screen(): void {
		// Intentionally empty. The screen is registered as a hidden admin page
		// by Admin::register_menu(). Kept for backwards compatibility with any
		// third-party code that may call this method directly.
	}

	/**
	 * The builder URL for an announcement.
	 *
	 * @since 1.7.1
	 *
	 * @param int $post_id Announcement identifier, or 0 for a new one.
	 *
	 * @return string Admin URL.
	 */
	public static function url( int $post_id = 0 ): string {
		$url = Admin::app_url( 'announcement' );

		return $post_id > 0 ? $url . '&announcement=' . $post_id : $url;
	}

	/**
	 * Sends "add new" to the builder.
	 *
	 * @since 1.7.1
	 *
	 * @return void
	 */
	public function redirect_new(): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing.
		$type = isset( $_GET['post_type'] ) ? sanitize_key( wp_unslash( (string) $_GET['post_type'] ) ) : '';

		if ( Announcements::POST_TYPE !== $type || ! current_user_can( Admin::CAPABILITY ) ) {
			return;
		}

		wp_safe_redirect( self::url() );
		exit;
	}

	/**
	 * Sends "edit" to the builder.
	 *
	 * The classic editor stays reachable with `&classic=1`, so nothing that
	 * depended on it — a metabox added by another plugin, a workflow someone
	 * has built around it — is taken away.
	 *
	 * @since 1.7.1
	 *
	 * @return void
	 */
	public function redirect_edit(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only routing.
		$post_id = isset( $_GET['post'] ) ? absint( $_GET['post'] ) : 0;
		$classic = isset( $_GET['classic'] );
		// phpcs:enable

		if ( $post_id <= 0 || $classic ) {
			return;
		}

		if ( Announcements::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		wp_safe_redirect( self::url( $post_id ) );
		exit;
	}

	/**
	 * Points the list table's row actions at the builder.
	 *
	 * @since 1.7.1
	 *
	 * @param array<string,string> $actions Row actions.
	 * @param WP_Post              $post    Row post.
	 *
	 * @return array<string,string> Modified actions.
	 */
	public function row_actions( array $actions, WP_Post $post ): array {
		if ( Announcements::POST_TYPE !== $post->post_type ) {
			return $actions;
		}

		if ( current_user_can( 'edit_post', $post->ID ) ) {
			$actions['edit'] = sprintf(
				'<a href="%s">%s</a>',
				esc_url( self::url( $post->ID ) ),
				esc_html__( 'ویرایش در جارچی', 'wp-event-publisher' )
			);

			// Built from admin_url rather than get_edit_post_link, because
			// this class filters that helper to point at the builder — going
			// through it would send the "classic editor" link straight back
			// here, which is the one place it must not lead.
			$actions['wpep_classic'] = sprintf(
				'<a href="%s">%s</a>',
				esc_url( admin_url( 'post.php?post=' . $post->ID . '&action=edit&classic=1' ) ),
				esc_html__( 'ویرایشگر پیشین', 'wp-event-publisher' )
			);

			// Duplicating an announcement is how a second one that differs in
			// one setting gets made without retyping the first.
			$actions['wpep_duplicate'] = sprintf(
				'<a href="%s">%s</a>',
				esc_url(
					wp_nonce_url(
						admin_url( 'admin-post.php?action=' . self::ACTION_SAVE . '&duplicate=' . $post->ID ),
						self::NONCE,
						'wpep_nonce'
					)
				),
				esc_html__( 'تکثیر', 'wp-event-publisher' )
			);
		}

		return $actions;
	}

	/**
	 * Points edit links at the builder.
	 *
	 * @since 1.7.1
	 *
	 * @param string $link    Edit link.
	 * @param int    $post_id Post identifier.
	 *
	 * @return string Modified link.
	 */
	public function edit_link( $link, $post_id ) {
		$link    = (string) $link;
		$post_id = (int) $post_id;

		// The classic link must stay reachable, or the "classic editor" row
		// action would loop straight back here.
		if ( str_contains( $link, 'classic=1' ) ) {
			return $link;
		}

		if ( Announcements::POST_TYPE !== get_post_type( $post_id ) ) {
			return $link;
		}

		return self::url( $post_id );
	}

	/**
	 * Renders the builder.
	 *
	 * @since 1.7.1
	 *
	 * @return void
	 */
	public function render(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی به این صفحه را ندارید.', 'wp-event-publisher' ), '', array( 'response' => 403 ) );
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing.
		$post_id = isset( $_GET['announcement'] ) ? absint( $_GET['announcement'] ) : 0;
		$post    = $post_id > 0 ? get_post( $post_id ) : null;

		if ( $post instanceof WP_Post && Announcements::POST_TYPE !== $post->post_type ) {
			$post = null;
		}

		if ( $post instanceof WP_Post && ! current_user_can( 'edit_post', $post->ID ) ) {
			wp_die( esc_html__( 'اجازه ویرایش این اطلاعیه را ندارید.', 'wp-event-publisher' ), '', array( 'response' => 403 ) );
		}

		$file = WPEP_PLUGIN_DIR . 'admin/views/announcement-builder.php';

		if ( ! is_readable( $file ) ) {
			return;
		}

		$state      = $this->state( $post );
		$placements = AnnouncementPlacements::all();
		$relevant   = AnnouncementPlacements::relevant_options();
		$schema     = AnnouncementPlacements::option_schema();
		$subjects   = AnnouncementPlacements::condition_subjects();
		$operators  = AnnouncementPlacements::condition_operators();
		$icons      = Announcements::icon_choices();
		$roles      = $this->roles();

		include $file;
	}

	/**
	 * Reads an announcement into the shape the builder edits.
	 *
	 * A legacy announcement — one written before the builder existed — has
	 * every one of these keys present in its meta already, so it opens here
	 * complete rather than partly blank.
	 *
	 * @since 1.7.1
	 *
	 * @param WP_Post|null $post Announcement, or null for a new one.
	 *
	 * @return array<string,mixed> Builder state.
	 */
	public function state( ?WP_Post $post ): array {
		$defaults = array(
			'id'         => 0,
			'title'      => '',
			'content'    => '',
			'status'     => 'draft',
			'icon'       => '',
			'image_id'   => 0,
			'image_url'  => '',
			'link'       => '',
			'priority'   => 0,
			'expires'    => '',
			'audience'   => Announcements::AUDIENCE_PUBLIC,
			'placement'  => 'page',
			'options'    => AnnouncementPlacements::default_options(),
			'conditions' => array(
				'match' => 'all',
				'rules' => array(),
			),
		);

		if ( ! $post instanceof WP_Post ) {
			return $defaults;
		}

		$image_id   = (int) get_post_meta( $post->ID, Announcements::META_IMAGE, true );
		$conditions = get_post_meta( $post->ID, AnnouncementPlacements::META_CONDITIONS, true );
		$conditions = is_array( $conditions ) ? $conditions : array();

		return array(
			'id'         => $post->ID,
			'title'      => $post->post_title,
			'content'    => $post->post_content,
			'status'     => $post->post_status,
			'icon'       => (string) get_post_meta( $post->ID, Announcements::META_ICON, true ),
			'image_id'   => $image_id,
			'image_url'  => $image_id > 0 ? (string) wp_get_attachment_url( $image_id ) : '',
			'link'       => (string) get_post_meta( $post->ID, Announcements::META_LINK, true ),
			'priority'   => (int) get_post_meta( $post->ID, Announcements::META_PRIORITY, true ),
			'expires'    => (string) get_post_meta( $post->ID, Announcements::META_EXPIRES, true ),
			'audience'   => (string) get_post_meta( $post->ID, Announcements::META_AUDIENCE, true ) ?: Announcements::AUDIENCE_PUBLIC,
			'placement'  => AnnouncementPlacements::placement_of( $post ),
			'options'    => $this->placements->options( $post ),
			'conditions' => array(
				'match' => 'any' === ( $conditions['match'] ?? 'all' ) ? 'any' : 'all',
				'rules' => isset( $conditions['rules'] ) && is_array( $conditions['rules'] ) ? array_values( $conditions['rules'] ) : array(),
			),
		);
	}

	/**
	 * The roles an audience condition may name.
	 *
	 * @since 1.7.1
	 *
	 * @return array<string,string> Role slug mapped to display name.
	 */
	public function roles(): array {
		if ( ! function_exists( 'wp_roles' ) ) {
			return array();
		}

		$roles = wp_roles();
		$names = is_object( $roles ) && isset( $roles->role_names ) ? (array) $roles->role_names : array();

		return array_map( 'strval', $names );
	}

	/**
	 * Stores a builder submission.
	 *
	 * @since 1.7.1
	 *
	 * @return void
	 */
	public function handle_save(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ), '', array( 'response' => 403 ) );
		}

		check_admin_referer( self::NONCE, 'wpep_nonce' );

		// Duplication is a GET action from the list table, handled here so it
		// shares the same capability and nonce as every other write.
		$duplicate = isset( $_GET['duplicate'] ) ? absint( $_GET['duplicate'] ) : 0;

		if ( $duplicate > 0 ) {
			$this->redirect_to( $this->duplicate( $duplicate ), 'duplicated' );
		}

		$input   = wp_unslash( $_POST ); // phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified above.
		$post_id = isset( $input['announcement_id'] ) ? absint( $input['announcement_id'] ) : 0;

		// A status the form is not allowed to set — "trash", say — must not
		// arrive by editing the markup.
		$status = isset( $input['post_status'] ) ? sanitize_key( (string) $input['post_status'] ) : 'draft';
		$status = in_array( $status, array( 'draft', 'publish', 'pending' ), true ) ? $status : 'draft';

		$title = isset( $input['post_title'] ) ? sanitize_text_field( (string) $input['post_title'] ) : '';

		// wp_kses_post, not raw: the announcement body is rendered into a page
		// for logged-out visitors, so script and event attributes must not
		// survive even when an administrator pastes them.
		$content = isset( $input['post_content'] ) ? wp_kses_post( (string) $input['post_content'] ) : '';

		if ( '' === trim( $title ) ) {
			$title = __( 'اطلاعیه بدون عنوان', 'wp-event-publisher' );
		}

		$data = array(
			'post_type'    => Announcements::POST_TYPE,
			'post_title'   => $title,
			'post_content' => $content,
			'post_status'  => $status,
		);

		if ( $post_id > 0 ) {
			if ( Announcements::POST_TYPE !== get_post_type( $post_id ) || ! current_user_can( 'edit_post', $post_id ) ) {
				wp_die( esc_html__( 'اجازه ویرایش این اطلاعیه را ندارید.', 'wp-event-publisher' ), '', array( 'response' => 403 ) );
			}

			$data['ID'] = $post_id;
			$saved      = wp_update_post( $data, true );
		} else {
			$saved = wp_insert_post( $data, true );
		}

		if ( is_wp_error( $saved ) || (int) $saved <= 0 ) {
			$this->redirect_to( $post_id, 'error' );
		}

		$saved = (int) $saved;

		// The same writers the classic metaboxes use, so a builder save and a
		// metabox save produce byte-identical meta.
		$this->announcements->save_meta( $saved, $input );
		$this->placements->save_meta( $saved, $input );

		$this->redirect_to( $saved, 'saved' );
	}

	/**
	 * Copies an announcement, including every one of its settings.
	 *
	 * @since 1.7.1
	 *
	 * @param int $source_id Announcement to copy.
	 *
	 * @return int New announcement identifier, or 0 on failure.
	 */
	public function duplicate( int $source_id ): int {
		$source = get_post( $source_id );

		if ( ! $source instanceof WP_Post || Announcements::POST_TYPE !== $source->post_type ) {
			return 0;
		}

		if ( ! current_user_can( 'edit_post', $source_id ) ) {
			return 0;
		}

		$copy = wp_insert_post(
			array(
				'post_type'    => Announcements::POST_TYPE,
				'post_title'   => sprintf(
					/* translators: %s: original announcement title. */
					__( '%s (رونوشت)', 'wp-event-publisher' ),
					$source->post_title
				),
				'post_content' => $source->post_content,
				// A copy always starts as a draft: publishing it the moment it
				// is made would put an unreviewed duplicate in front of
				// visitors.
				'post_status'  => 'draft',
			),
			true
		);

		if ( is_wp_error( $copy ) || (int) $copy <= 0 ) {
			return 0;
		}

		$copy = (int) $copy;

		foreach ( self::meta_keys() as $key ) {
			$value = get_post_meta( $source_id, $key, true );

			if ( '' !== $value && array() !== $value ) {
				update_post_meta( $copy, $key, $value );
			}
		}

		return $copy;
	}

	/**
	 * Every meta key an announcement owns.
	 *
	 * One list, so duplication and any future export cannot quietly miss a
	 * field that was added later.
	 *
	 * @since 1.7.1
	 *
	 * @return string[] Meta keys.
	 */
	public static function meta_keys(): array {
		return array(
			Announcements::META_EXPIRES,
			Announcements::META_ICON,
			Announcements::META_PRIORITY,
			Announcements::META_LINK,
			Announcements::META_IMAGE,
			Announcements::META_AUDIENCE,
			AnnouncementPlacements::META_PLACEMENT,
			AnnouncementPlacements::META_OPTIONS,
			AnnouncementPlacements::META_CONDITIONS,
		);
	}

	/**
	 * Returns to the builder with a result message.
	 *
	 * @since 1.7.1
	 *
	 * @param int    $post_id Announcement identifier.
	 * @param string $result  Result code.
	 *
	 * @return void
	 */
	private function redirect_to( int $post_id, string $result ): void {
		wp_safe_redirect( add_query_arg( 'wpep_result', $result, self::url( $post_id ) ) );
		exit;
	}

	/**
	 * Renders a preview of the announcement being edited.
	 *
	 * Draws through the same renderer the front end uses, so what the preview
	 * shows is the component visitors get rather than a second implementation
	 * that can drift away from it.
	 *
	 * @since 1.7.1
	 *
	 * @return void
	 */
	public function ajax_preview(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => __( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) ), 403 );
		}

		check_ajax_referer( self::NONCE, 'nonce' );

		$input = wp_unslash( $_POST ); // phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified above.

		$image_id = isset( $input['wpep_image_id'] ) ? absint( $input['wpep_image_id'] ) : 0;

		$draft = array(
			'title'     => isset( $input['post_title'] ) ? sanitize_text_field( (string) $input['post_title'] ) : '',
			'content'   => isset( $input['post_content'] ) ? wp_kses_post( (string) $input['post_content'] ) : '',
			'icon'      => isset( $input['wpep_icon'] ) ? sanitize_key( (string) $input['wpep_icon'] ) : '',
			'link'      => isset( $input['wpep_link'] ) ? esc_url_raw( (string) $input['wpep_link'], array( 'http', 'https', 'mailto', 'tel' ) ) : '',
			'image_url' => $image_id > 0 && 'attachment' === get_post_type( $image_id ) ? (string) wp_get_attachment_url( $image_id ) : '',
			'placement' => isset( $input['wpep_placement'] ) ? sanitize_key( (string) $input['wpep_placement'] ) : 'page',
		);

		$draft['icon'] = in_array( $draft['icon'], Announcements::icon_choices(), true ) ? $draft['icon'] : '';

		if ( ! array_key_exists( $draft['placement'], AnnouncementPlacements::all() ) ) {
			$draft['placement'] = 'page';
		}

		wp_send_json_success( array( 'html' => $this->frontend->preview( $draft ) ) );
	}
}
