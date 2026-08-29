<?php
/**
 * Jarchi admin application shell.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Wraps every Jarchi screen in one application shell: sidebar, top bar and
 * content area.
 *
 * The WordPress admin menu stays where it is — this does not replace it and
 * does not touch it. Inside a Jarchi page, though, the plugin presents its
 * own navigation, so moving between Jarchi screens does not mean hunting
 * through a global menu that also contains twenty other plugins.
 *
 * The navigation is a tree declared in one place and rendered generically,
 * so a new screen is one array entry. Active state is derived from the
 * request rather than passed in by each screen, which is what stops a screen
 * from forgetting to highlight itself.
 *
 * @since 1.7.0
 */
class AdminShell {

	/**
	 * Option holding the collapsed/expanded preference per user.
	 *
	 * @var string
	 */
	public const META_COLLAPSED = 'wpep_nav_collapsed';

	/**
	 * User meta holding the light/dark preference.
	 *
	 * Stored per user rather than per site: a theme choice is a personal
	 * comfort setting, and two administrators may reasonably disagree.
	 *
	 * @var string
	 */
	public const META_THEME = 'wpep_admin_theme';

	/**
	 * The screens that belong to the "ارتباط با کاربران" section.
	 *
	 * One list, used by everything that needs to know which of the two
	 * sections the request is in: the navigation tree, the body class and the
	 * shell partial. It used to be written out three times — in `items()`, in
	 * `body_class()` and again in app-shell.php — and the three copies had
	 * already drifted apart: the partial's copy named six screens where the
	 * tree's named seventeen, so the top bar announced "جارچی" on eleven
	 * support screens. A single list cannot disagree with itself.
	 *
	 * @since 1.18.6
	 *
	 * @var string[]
	 */
	public const SUPPORT_SCREENS = array(
		'announcements-all',
		'announcements-new',
		'announcements-page',
		'tickets-all',
		'tickets-new',
		'tickets-agents',
		'tickets-canned',
		'tickets-faq',
		'tickets-departments',
		'tickets-categories',
		'tickets-bot',
		'tickets-sms',
		'tickets-ui',
		'tickets-advanced',
		'tickets-ops',
		'tickets-notifications',
		'tickets-automations',
		'tickets-cleanup',
	);

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Constructor.
	 *
	 * @since 1.7.0
	 *
	 * @param Settings $settings Settings service.
	 */
	public function __construct( Settings $settings ) {
		$this->settings = $settings;
	}

	/**
	 * Registers the shell's hooks.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( 'in_admin_header', array( $this, 'open' ), 100 );
		add_action( 'wp_ajax_wpep_set_theme', array( $this, 'ajax_set_theme' ) );
		add_action( 'wp_ajax_wpep_set_nav', array( $this, 'ajax_set_nav' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
		add_filter( 'admin_body_class', array( $this, 'body_class' ) );
	}

	/**
	 * Loads the shell's stylesheet and behaviour on Jarchi screens.
	 *
	 * The plugin's own pages already enqueue the stylesheet through
	 * {@see Admin::enqueue_assets()}; the announcement list and editor do not,
	 * and they are where the shell would otherwise appear unstyled.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function enqueue(): void {
		if ( ! self::is_jarchi_screen() || ! current_user_can( Admin::CAPABILITY ) ) {
			return;
		}

		$css = WPEP_PLUGIN_DIR . 'admin/css/admin.css';
		$js  = WPEP_PLUGIN_DIR . 'admin/js/shell.js';

		wp_enqueue_style( 'dashicons' );

		if ( is_readable( $css ) ) {
			wp_enqueue_style(
				'wpep-admin',
				WPEP_PLUGIN_URL . 'admin/css/admin.css',
				array(),
				WPEP_VERSION . '.' . filemtime( $css )
			);
		}

		if ( ! is_readable( $js ) ) {
			return;
		}

		wp_enqueue_script(
			'wpep-shell',
			WPEP_PLUGIN_URL . 'admin/js/shell.js',
			array(),
			WPEP_VERSION . '.' . filemtime( $js ),
			true
		);

		wp_localize_script(
			'wpep-shell',
			'wpepShell',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( Admin::NONCE_AJAX ),
				'i18n'    => array(
					'collapse' => __( 'جمع کردن منو', 'wp-event-publisher' ),
					'expand'   => __( 'باز کردن منو', 'wp-event-publisher' ),
				),
			)
		);

		$this->enqueue_builder();
	}

	/**
	 * Loads the announcement builder's behaviour on its own screen only.
	 *
	 * @since 1.7.1
	 *
	 * @return void
	 */
	private function enqueue_builder(): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only routing.
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( (string) $_GET['page'] ) ) : '';

		if ( AnnouncementBuilder::PAGE !== $page ) {
			return;
		}

		$file = WPEP_PLUGIN_DIR . 'admin/js/builder.js';

		if ( ! is_readable( $file ) ) {
			return;
		}

		// The image picker is WordPress's own, so an administrator chooses a
		// picture the same way they do everywhere else in the admin.
		wp_enqueue_media();

		wp_enqueue_script(
			'wpep-builder',
			WPEP_PLUGIN_URL . 'admin/js/builder.js',
			array(),
			WPEP_VERSION . '.' . filemtime( $file ),
			true
		);

		wp_localize_script(
			'wpep-builder',
			'wpepBuilder',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( AnnouncementBuilder::NONCE ),
				'i18n'    => array(
					'chooseImage'   => __( 'انتخاب تصویر اطلاعیه', 'wp-event-publisher' ),
					'previewFailed' => __( 'پیش‌نمایش ساخته نشد.', 'wp-event-publisher' ),
				),
			)
		);
	}

	/**
	 * Marks the body with the shell's state.
	 *
	 * The layout, the collapsed sidebar and the theme all live here rather
	 * than on the shell element, because the page content is WordPress's own
	 * `#wpbody` — a sibling of the sidebar, not a descendant of it — and only
	 * the body is an ancestor of both.
	 *
	 * Every one of these classes is gated on being a Jarchi screen, so the
	 * rest of the admin, and every other plugin's pages, are left exactly as
	 * WordPress styles them.
	 *
	 * @since 1.7.0
	 *
	 * @param string $classes Existing body classes.
	 *
	 * @return string Modified classes.
	 */
	public function body_class( $classes ): string {
		$classes = (string) $classes;

		if ( ! self::is_jarchi_screen() || ! current_user_can( Admin::CAPABILITY ) ) {
			return $classes;
		}

		$classes .= ' jarchi-shell-active';

		if ( 'support' === $this->section() ) {
			$classes .= ' jarchi-support-context';
		}

		if ( get_user_meta( get_current_user_id(), self::META_COLLAPSED, true ) ) {
			$classes .= ' jarchi-nav-collapsed';
		}

		$theme = $this->theme();

		// Rendering the stored theme server side is what stops the page from
		// flashing the wrong palette before the script runs.
		$classes .= ' jarchi-theme-' . $theme;

		return trim( $classes );
	}

	/**
	 * Whether the current request is a Jarchi screen.
	 *
	 * Covers both the plugin's own pages and the announcement post type's
	 * list and editor screens, because an administrator editing an
	 * announcement is still inside Jarchi as far as they are concerned.
	 *
	 * @since 1.7.0
	 *
	 * @return bool True on a Jarchi screen.
	 */
	public static function is_jarchi_screen(): bool {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only routing.
		$page      = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( (string) $_GET['page'] ) ) : '';
		$post_type = isset( $_GET['post_type'] ) ? sanitize_key( wp_unslash( (string) $_GET['post_type'] ) ) : '';
		// phpcs:enable

		// 1. The page the plugin actually registered. Asking the registry
		//    rather than listing slugs here means a new screen is detected the
		//    moment it is registered, and a removed one stops being detected —
		//    the long hand-maintained OR chain this replaces had drifted into
		//    naming only slugs that the prefix test already matched.
		if ( '' !== $page && array_key_exists( $page, Admin::screens() ) ) {
			return true;
		}

		// 2. The slug prefix, which also covers a screen registered by a
		//    third party under the plugin's namespace.
		if ( '' !== $page && str_starts_with( $page, Admin::MENU_SLUG ) ) {
			return true;
		}

		// 3. The post types the plugin owns, whose editors carry no page arg.
		if ( in_array( $post_type, array( Announcements::POST_TYPE, Tickets::POST_TYPE ), true ) ) {
			return true;
		}

		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

		if ( ! $screen ) {
			return false;
		}

		if ( in_array( (string) ( $screen->post_type ?? '' ), array( Announcements::POST_TYPE, Tickets::POST_TYPE ), true ) ) {
			return true;
		}

		// 4. The hook suffix WordPress handed back at registration time. This
		//    is the only signal available on a hidden screen reached in a way
		//    the query string does not describe.
		return in_array( (string) ( $screen->id ?? '' ), array_values( Admin::screens() ), true );
	}

	/**
	 * The navigation tree.
	 *
	 * Declared once and rendered generically. Each item may carry children;
	 * a group with children is expanded when it or one of its children is
	 * the current screen.
	 *
	 * @since 1.7.0
	 *
	 * @return array<int,array<string,mixed>> Navigation items.
	 */
	public function items(): array {
		$slug  = Admin::MENU_SLUG;
		$admin = static fn( string $page ): string => Admin::app_url( self::view_from_legacy_page( $page ) );

		$publishing_children = array(
			array( 'id' => $slug, 'label' => __( 'داشبورد', 'wp-event-publisher' ), 'url' => $admin( $slug ), 'icon' => 'dashboard' ),
			array( 'id' => $slug . '-fields', 'label' => __( 'فیلدهای انتشار', 'wp-event-publisher' ), 'url' => $admin( $slug . '-fields' ), 'icon' => 'admin-post' ),
			array( 'id' => $slug . '-telegram', 'label' => __( 'تلگرام', 'wp-event-publisher' ), 'url' => $admin( $slug . '-telegram' ), 'icon' => 'brand-telegram' ),
			array( 'id' => $slug . '-bale', 'label' => __( 'بله', 'wp-event-publisher' ), 'url' => $admin( $slug . '-bale' ), 'icon' => 'brand-bale' ),
			array( 'id' => $slug . '-whatsapp', 'label' => __( 'واتس‌اپ', 'wp-event-publisher' ), 'url' => $admin( $slug . '-whatsapp' ), 'icon' => 'brand-whatsapp' ),
		);

		if ( WooCommerceOrder::available() ) {
			$publishing_children[] = array(
				'id'    => $slug . '-woocommerce',
				'label' => __( 'ووکامرس', 'wp-event-publisher' ),
				'url'   => $admin( $slug . '-woocommerce' ),
				'icon'  => 'cart',
			);
		}

		$publishing_children[] = array(
			'id'       => 'automation',
			'label'    => __( 'خودکارسازی', 'wp-event-publisher' ),
			'icon'     => 'randomize',
			'url'      => $admin( $slug . '-rules' ),
			// Every leaf carries an icon, including the nested ones. The
			// collapsed rail is nothing but icons, so a leaf without one is a
			// destination that becomes unreachable the moment the sidebar is
			// collapsed.
			'children' => array(
				array( 'id' => $slug . '-rules', 'label' => __( 'قوانین انتشار', 'wp-event-publisher' ), 'url' => $admin( $slug . '-rules' ), 'icon' => 'admin-network' ),
				array( 'id' => $slug . '-destinations', 'label' => __( 'مقصدها', 'wp-event-publisher' ), 'url' => $admin( $slug . '-destinations' ), 'icon' => 'location-alt' ),
				array( 'id' => $slug . '-profiles', 'label' => __( 'نمایه‌های محتوا', 'wp-event-publisher' ), 'url' => $admin( $slug . '-profiles' ), 'icon' => 'id-alt' ),
			),
		);
		$publishing_children[] = array( 'id' => $slug . '-logs', 'label' => __( 'تاریخچه انتقال', 'wp-event-publisher' ), 'url' => $admin( $slug . '-logs' ), 'icon' => 'list-view' );
		$publishing_children[] = array( 'id' => $slug . '-tools', 'label' => __( 'ابزارها', 'wp-event-publisher' ), 'url' => $admin( $slug . '-tools' ), 'icon' => 'admin-tools' );
		$publishing_children[] = array( 'id' => $slug . '-settings', 'label' => __( 'تنظیمات', 'wp-event-publisher' ), 'url' => $admin( $slug . '-settings' ), 'icon' => 'admin-generic' );
		$publishing_children[] = array( 'id' => $slug . '-status', 'label' => __( 'وضعیت سیستم', 'wp-event-publisher' ), 'url' => $admin( $slug . '-status' ), 'icon' => 'info' );

		$announcements = array(
			'id'       => 'announcements-group',
			'label'    => __( 'اطلاعیه‌ها', 'wp-event-publisher' ),
			'icon'     => 'megaphone',
			'url'      => admin_url( 'edit.php?post_type=' . Announcements::POST_TYPE ),
			'children' => array(
				array( 'id' => 'announcements-all', 'label' => __( 'همه اطلاعیه‌ها', 'wp-event-publisher' ), 'url' => admin_url( 'edit.php?post_type=' . Announcements::POST_TYPE ), 'icon' => 'list-view' ),
				array( 'id' => 'announcements-new', 'label' => __( 'افزودن اطلاعیه', 'wp-event-publisher' ), 'url' => AnnouncementBuilder::url(), 'icon' => 'plus-alt' ),
				array( 'id' => 'announcements-page', 'label' => __( 'صفحه اطلاعیه‌ها', 'wp-event-publisher' ), 'url' => Admin::app_url( 'announcement-page' ), 'icon' => 'admin-page' ),
			),
		);

		$tickets = array(
			'id'       => 'tickets-group',
			'label'    => __( 'تیکت‌ها', 'wp-event-publisher' ),
			'icon'     => 'sos',
			'url'      => $admin( Tickets::PAGE ),
			'children' => array(
				array( 'id' => 'tickets-all', 'label' => __( 'تیکت‌ها', 'wp-event-publisher' ), 'url' => $admin( Tickets::PAGE ), 'icon' => 'sos' ),
				array( 'id' => 'tickets-new', 'label' => __( 'تیکت جدید', 'wp-event-publisher' ), 'url' => $admin( Tickets::PAGE_NEW ), 'icon' => 'plus-alt2' ),
				array( 'id' => 'tickets-agents', 'label' => __( 'پشتیبان‌ها', 'wp-event-publisher' ), 'url' => $admin( 'wp-event-publisher-ticket-agents' ), 'icon' => 'groups' ),
				array( 'id' => 'tickets-canned', 'label' => __( 'پاسخ‌های آماده', 'wp-event-publisher' ), 'url' => $admin( 'wp-event-publisher-ticket-canned' ), 'icon' => 'format-status' ),
				array( 'id' => 'tickets-faq', 'label' => __( 'سوالات متداول', 'wp-event-publisher' ), 'url' => $admin( Tickets::PAGE_FAQ ), 'icon' => 'editor-help' ),
				array( 'id' => 'tickets-departments', 'label' => __( 'دپارتمان‌ها', 'wp-event-publisher' ), 'url' => $admin( Tickets::PAGE_DEPTS ), 'icon' => 'groups' ),
				array( 'id' => 'tickets-categories', 'label' => __( 'دسته‌بندی‌ها', 'wp-event-publisher' ), 'url' => $admin( 'wp-event-publisher-ticket-categories' ), 'icon' => 'category' ),
				array( 'id' => 'tickets-bot', 'label' => __( 'تنظیمات تیکت', 'wp-event-publisher' ), 'url' => $admin( Tickets::PAGE_BOT ), 'icon' => 'admin-comments' ),
				array( 'id' => 'tickets-sms', 'label' => __( 'پیامک پاسخ تیکت', 'wp-event-publisher' ), 'url' => $admin( Tickets::PAGE_SMS ), 'icon' => 'smartphone' ),
				array( 'id' => 'tickets-ui', 'label' => __( 'ظاهر تیکت‌ها', 'wp-event-publisher' ), 'url' => $admin( Tickets::PAGE_UI ), 'icon' => 'art' ),
				array( 'id' => 'tickets-advanced', 'label' => __( 'پیشرفته', 'wp-event-publisher' ), 'url' => $admin( Tickets::PAGE_ADVANCED ), 'icon' => 'admin-tools' ),
				array( 'id' => 'tickets-ops', 'label' => __( 'SLA و عملکرد', 'wp-event-publisher' ), 'url' => $admin( TicketOperations::PAGE_SLA ), 'icon' => 'chart-bar' ),
				array( 'id' => 'tickets-notifications', 'label' => __( 'اعلان‌ها', 'wp-event-publisher' ), 'url' => $admin( TicketNotifications::PAGE ), 'icon' => 'bell' ),
				array( 'id' => 'tickets-automations', 'label' => __( 'تیکت‌های خودکار', 'wp-event-publisher' ), 'url' => $admin( TicketAutomations::PAGE ), 'icon' => 'update' ),
				array( 'id' => 'tickets-cleanup', 'label' => __( 'پاک‌سازی تیکت‌ها', 'wp-event-publisher' ), 'url' => Admin::app_url( 'ticket-cleanup' ), 'icon' => 'trash' ),
			),
		);

		// The two sections intentionally have completely separate sidebars.
		// When the administrator enters "ارتباط با کاربران", publishing
		// configuration never appears here; when they enter the publishing
		// application, support navigation never appears there.
		if ( 'support' === $this->section() ) {
			return (array) apply_filters(
				'wpep_admin_nav',
				array(
					array(
						'id'       => 'audience-announcements',
						'label'    => __( 'اطلاعیه‌ها', 'wp-event-publisher' ),
						'icon'     => 'megaphone',
						'url'      => $announcements['url'],
						'children' => $announcements['children'],
					),
					array(
						'id'       => 'audience-tickets',
						'label'    => __( 'تیکت‌ها', 'wp-event-publisher' ),
						'icon'     => 'sos',
						'url'      => $tickets['url'],
						'children' => $tickets['children'],
					),
				)
			);
		}

		return (array) apply_filters(
			'wpep_admin_nav',
			array(
				array(
					'id'       => 'jarchi-config',
					'label'    => __( 'جارچی', 'wp-event-publisher' ),
					'icon'     => 'megaphone',
					'url'      => $admin( $slug ),
					'children' => $publishing_children,
				),
			)
		);
	}

	/**
	 * Which of the two Jarchi sections the request belongs to.
	 *
	 * The plugin presents exactly two native areas, and each owns a sidebar.
	 * Deciding that once, here, is what keeps the tree, the body class and
	 * the top bar from ever disagreeing about where the administrator is.
	 *
	 * @since 1.18.6
	 *
	 * @return string `support` or `publishing`.
	 */
	public function section(): string {
		return in_array( $this->current(), self::SUPPORT_SCREENS, true ) ? 'support' : 'publishing';
	}

	/**
	 * The human label for the current section.
	 *
	 * @since 1.18.6
	 *
	 * @return string Section label.
	 */
	public function section_label(): string {
		return 'support' === $this->section()
			? __( 'ارتباط با کاربران', 'wp-event-publisher' )
			: __( 'جارچی', 'wp-event-publisher' );
	}

	/**
	 * Returns the identifier of the current screen.
	 *
	 * Derived from the request rather than declared per screen, so a screen
	 * cannot forget to highlight itself in the navigation.
	 *
	 * @since 1.7.0
	 *
	 * @return string Current screen identifier.
	 */
	public function current(): string {
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( (string) $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$post_type = isset( $_GET['post_type'] ) ? sanitize_key( wp_unslash( (string) $_GET['post_type'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$view = Admin::current_view();

		/*
		 * A registered page slug describes the screen just as precisely as the
		 * in-app selector does, and one of the two native menu entries —
		 * "ارتباط با کاربران" — is reached by slug alone:
		 *
		 *     admin.php?page=wp-event-publisher-support   (no jarchi_view)
		 *
		 * Reading only jarchi_view meant that request produced an empty
		 * current screen. Everything downstream keys off that value, so the
		 * consequences were exactly what the section looked like: items()
		 * decided it was not in the support context and drew the publishing
		 * tree, and is_active() highlighted nothing at all. Translating the
		 * slug through the same map the rest of the routing uses puts the
		 * two entry points on one code path.
		 */
		if ( '' === $view && '' !== $page ) {
			$from_slug = self::view_from_legacy_page( $page );

			// An unmapped slug maps to itself; that is not a view.
			if ( $from_slug !== $page ) {
				$view = $from_slug;
			}
		}

		if ( '' !== $view ) {
			$map = array(
				'support' => 'tickets-all', 'ticket-new' => 'tickets-new', 'ticket-agents' => 'tickets-agents',
				'ticket-canned' => 'tickets-canned', 'ticket-faq' => 'tickets-faq', 'ticket-departments' => 'tickets-departments',
				'ticket-categories' => 'tickets-categories', 'ticket-bot' => 'tickets-bot', 'ticket-sms' => 'tickets-sms',
				'ticket-ui' => 'tickets-ui', 'ticket-advanced' => 'tickets-advanced', 'ticket-ops' => 'tickets-ops',
				'ticket-notifications' => 'tickets-notifications', 'ticket-automations' => 'tickets-automations',
				'ticket-cleanup' => 'tickets-cleanup',
				'announcement-page' => 'announcements-page', 'announcement' => ( isset( $_GET['announcement'] ) && absint( $_GET['announcement'] ) > 0 ) ? 'announcements-all' : 'announcements-new',
				'fields' => 'wp-event-publisher-fields', 'telegram' => 'wp-event-publisher-telegram', 'bale' => 'wp-event-publisher-bale',
				'whatsapp' => 'wp-event-publisher-whatsapp', 'woocommerce' => 'wp-event-publisher-woocommerce',
				'rules' => 'wp-event-publisher-rules', 'destinations' => 'wp-event-publisher-destinations', 'profiles' => 'wp-event-publisher-profiles',
				'logs' => 'wp-event-publisher-logs', 'tools' => 'wp-event-publisher-tools', 'settings' => 'wp-event-publisher-settings',
				'status' => 'wp-event-publisher-status', 'diagnostics' => 'wp-event-publisher-diagnostics', 'about' => 'wp-event-publisher-about',
			);
			return $map[ $view ] ?? $view;
		}

		if ( '' !== $page && $page === Admin::MENU_SLUG ) {
			return Admin::MENU_SLUG;
		}

		if ( Announcements::POST_TYPE === $post_type ) {
			$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
			$base = $screen->base ?? '';
			return 'post' === $base ? 'announcements-all' : 'announcements-new';
		}

		return '';
	}

	/** Map a legacy screen slug to the canonical in-app view. */
	public static function view_from_legacy_page( string $page ): string {
		$map = array(
			Admin::MENU_SLUG => '', Admin::MENU_SLUG . '-fields' => 'fields', Admin::MENU_SLUG . '-telegram' => 'telegram',
			Admin::MENU_SLUG . '-bale' => 'bale', Admin::MENU_SLUG . '-whatsapp' => 'whatsapp', Admin::MENU_SLUG . '-woocommerce' => 'woocommerce',
			Admin::MENU_SLUG . '-rules' => 'rules', Admin::MENU_SLUG . '-destinations' => 'destinations', Admin::MENU_SLUG . '-profiles' => 'profiles',
			Admin::MENU_SLUG . '-logs' => 'logs', Admin::MENU_SLUG . '-tools' => 'tools', Admin::MENU_SLUG . '-settings' => 'settings',
			Admin::MENU_SLUG . '-status' => 'status', Admin::MENU_SLUG . '-diagnostics' => 'diagnostics', Admin::MENU_SLUG . '-about' => 'about',
			Tickets::PAGE => 'support', Tickets::PAGE_DEPTS => 'ticket-departments', Tickets::PAGE_SMS => 'ticket-sms', Tickets::PAGE_UI => 'ticket-ui',
			Tickets::PAGE_NEW => 'ticket-new', Tickets::PAGE_ADVANCED => 'ticket-advanced', Tickets::PAGE_BOT => 'ticket-bot', Tickets::PAGE_FAQ => 'ticket-faq',
			'wp-event-publisher-ticket-agents' => 'ticket-agents', 'wp-event-publisher-ticket-canned' => 'ticket-canned', 'wp-event-publisher-ticket-categories' => 'ticket-categories',
			TicketOperations::PAGE_SLA => 'ticket-ops', TicketNotifications::PAGE => 'ticket-notifications', TicketAutomations::PAGE => 'ticket-automations',
			Admin::PAGE_ANNOUNCEMENT_PAGE => 'announcement-page', AnnouncementBuilder::PAGE => 'announcement',
		);
		return $map[ $page ] ?? $page;
	}


	/**
	 * Opens the shell: sidebar, top bar and the content wrapper.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function open(): void {
		if ( ! self::is_jarchi_screen() || ! current_user_can( Admin::CAPABILITY ) ) {
			return;
		}

		$file = WPEP_PLUGIN_DIR . 'admin/views/partials/app-shell.php';

		if ( ! is_readable( $file ) ) {
			return;
		}

		$items     = $this->items();
		$current   = $this->current();
		$theme     = $this->theme();
		$collapsed = (bool) get_user_meta( get_current_user_id(), self::META_COLLAPSED, true );
		$shell     = $this;
		$section   = $this->section();

		include $file;
	}

	/**
	 * Whether an item is the current screen, or contains it.
	 *
	 * @since 1.7.0
	 *
	 * @param array<string,mixed> $item    Navigation item.
	 * @param string              $current Current screen identifier.
	 *
	 * @return bool True when the item should read as active.
	 */
	public function is_active( array $item, string $current ): bool {
		if ( '' === $current ) {
			return false;
		}

		if ( (string) ( $item['id'] ?? '' ) === $current ) {
			return true;
		}

		foreach ( (array) ( $item['children'] ?? array() ) as $child ) {
			if ( $this->is_active( (array) $child, $current ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Returns the effective admin theme for the current user.
	 *
	 * @since 1.7.0
	 *
	 * @return string One of `light`, `dark` or `auto`.
	 */
	public function theme(): string {
		$stored = (string) get_user_meta( get_current_user_id(), self::META_THEME, true );

		return in_array( $stored, array( 'light', 'dark' ), true ) ? $stored : 'light';
	}

	/**
	 * Persists a theme choice for the current user.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function ajax_set_theme(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => __( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) ), 403 );
		}

		check_ajax_referer( Admin::NONCE_AJAX, 'nonce' );

		$theme = isset( $_POST['theme'] ) ? sanitize_key( wp_unslash( (string) $_POST['theme'] ) ) : 'light';
		$theme = in_array( $theme, array( 'light', 'dark' ), true ) ? $theme : 'light';

		update_user_meta( get_current_user_id(), self::META_THEME, $theme );

		wp_send_json_success( array( 'theme' => $theme ) );
	}

	/**
	 * Persists the sidebar's collapsed state for the current user.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function ajax_set_nav(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => __( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) ), 403 );
		}

		check_ajax_referer( Admin::NONCE_AJAX, 'nonce' );

		$collapsed = isset( $_POST['collapsed'] ) && '1' === sanitize_key( wp_unslash( (string) $_POST['collapsed'] ) );

		// Stored as '1' or deleted rather than '0', so the absent case and the
		// expanded case are the same state instead of two.
		if ( $collapsed ) {
			update_user_meta( get_current_user_id(), self::META_COLLAPSED, '1' );
		} else {
			delete_user_meta( get_current_user_id(), self::META_COLLAPSED );
		}

		wp_send_json_success( array( 'collapsed' => $collapsed ) );
	}
}
