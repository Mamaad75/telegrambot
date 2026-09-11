<?php
/**
 * Announcement placement registry and conditions.
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
 * Decides where an announcement appears, and whether it appears at all.
 *
 * Placements are declared as data and rendered through one hook table rather
 * than being branched on in a long conditional. Adding "show it on the cart
 * page" later means adding one entry here and nothing else — which is the
 * difference between an architecture and a pile of if-statements.
 *
 * Conditions are evaluated in one place too, so every placement gets the same
 * rules for free and a new placement cannot accidentally skip the audience
 * check.
 *
 * @since 1.7.0
 */
class AnnouncementPlacements {

	/**
	 * Meta key: where this announcement is shown.
	 *
	 * @var string
	 */
	public const META_PLACEMENT = '_jarchi_announcement_placement';

	/**
	 * Meta key: placement-specific options.
	 *
	 * @var string
	 */
	public const META_OPTIONS = '_jarchi_announcement_placement_options';

	/**
	 * Meta key: display conditions.
	 *
	 * @var string
	 */
	public const META_CONDITIONS = '_jarchi_announcement_conditions';

	/**
	 * Announcement query layer.
	 *
	 * @var Announcements
	 */
	private Announcements $announcements;

	/**
	 * Front-end renderer.
	 *
	 * @var AnnouncementsFrontend
	 */
	private AnnouncementsFrontend $frontend;

	/**
	 * Constructor.
	 *
	 * @since 1.7.0
	 *
	 * @param Announcements         $announcements Announcement query layer.
	 * @param AnnouncementsFrontend $frontend      Front-end renderer.
	 */
	public function __construct( Announcements $announcements, AnnouncementsFrontend $frontend ) {
		$this->announcements = $announcements;
		$this->frontend      = $frontend;
	}

	/**
	 * The placements this build offers.
	 *
	 * Each entry declares the WordPress hook it renders on and the priority.
	 * A placement whose hook does not exist on a given site simply never
	 * fires, which is why WooCommerce placements need no capability check
	 * here — `woocommerce_before_main_content` does not exist without
	 * WooCommerce, so nothing runs.
	 *
	 * @since 1.7.0
	 *
	 * @return array<string,array{label:string,hook:string,priority:int,group:string}> Placements.
	 */
	public static function all(): array {
		$placements = array(
			'page'           => array(
				'label'    => __( 'صفحه اطلاعیه‌ها', 'wp-event-publisher' ),
				'hook'     => '',
				'priority' => 10,
				'group'    => __( 'صفحه', 'wp-event-publisher' ),
			),
			'before_content' => array(
				'label'    => __( 'بالای محتوا', 'wp-event-publisher' ),
				'hook'     => 'wpep_render_before_content',
				'priority' => 10,
				'group'    => __( 'داخل محتوا', 'wp-event-publisher' ),
			),
			'after_content'  => array(
				'label'    => __( 'پایین محتوا', 'wp-event-publisher' ),
				'hook'     => 'wpep_render_after_content',
				'priority' => 10,
				'group'    => __( 'داخل محتوا', 'wp-event-publisher' ),
			),
			'header'         => array(
				'label'    => __( 'نوار بالای سایت', 'wp-event-publisher' ),
				'hook'     => 'wp_body_open',
				'priority' => 5,
				'group'    => __( 'نوارها', 'wp-event-publisher' ),
			),
			'footer_bar'     => array(
				'label'    => __( 'نوار پایین سایت', 'wp-event-publisher' ),
				'hook'     => 'wp_footer',
				'priority' => 20,
				'group'    => __( 'نوارها', 'wp-event-publisher' ),
			),
			'popup'          => array(
				'label'    => __( 'پنجره بازشو', 'wp-event-publisher' ),
				'hook'     => 'wp_footer',
				'priority' => 30,
				'group'    => __( 'شناور', 'wp-event-publisher' ),
			),
			'floating'       => array(
				'label'    => __( 'اعلان شناور', 'wp-event-publisher' ),
				'hook'     => 'wp_footer',
				'priority' => 40,
				'group'    => __( 'شناور', 'wp-event-publisher' ),
			),
		);

		if ( WooCommerceOrder::available() ) {
			$placements['wc_shop']     = array(
				'label'    => __( 'صفحه فروشگاه', 'wp-event-publisher' ),
				'hook'     => 'woocommerce_before_main_content',
				'priority' => 10,
				'group'    => __( 'ووکامرس', 'wp-event-publisher' ),
			);
			$placements['wc_product']  = array(
				'label'    => __( 'صفحه محصول', 'wp-event-publisher' ),
				'hook'     => 'woocommerce_before_single_product',
				'priority' => 10,
				'group'    => __( 'ووکامرس', 'wp-event-publisher' ),
			);
			$placements['wc_cart']     = array(
				'label'    => __( 'سبد خرید', 'wp-event-publisher' ),
				'hook'     => 'woocommerce_before_cart',
				'priority' => 10,
				'group'    => __( 'ووکامرس', 'wp-event-publisher' ),
			);
			$placements['wc_checkout'] = array(
				'label'    => __( 'تسویه حساب', 'wp-event-publisher' ),
				'hook'     => 'woocommerce_before_checkout_form',
				'priority' => 10,
				'group'    => __( 'ووکامرس', 'wp-event-publisher' ),
			);
			$placements['wc_account']  = array(
				'label'    => __( 'حساب کاربری', 'wp-event-publisher' ),
				'hook'     => 'woocommerce_account_content',
				'priority' => 5,
				'group'    => __( 'ووکامرس', 'wp-event-publisher' ),
			);
		}

		/**
		 * Filters the available announcement placements.
		 *
		 * Add an entry to teach Jarchi a new place to render, without
		 * touching the plugin. The `hook` is any action that echoes.
		 *
		 * @since 1.7.0
		 *
		 * @param array<string,array<string,mixed>> $placements Placements.
		 */
		return (array) apply_filters( 'wpep_announcement_placements', $placements );
	}

	/**
	 * Binds every placement that renders on a hook.
	 *
	 * One pass over the table, so a new placement needs no registration code
	 * of its own.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( 'save_post_' . Announcements::POST_TYPE, array( $this, 'save' ), 10, 2 );
		add_action( 'add_meta_boxes', array( $this, 'add_meta_box' ) );

		// The editor is admin-only; rendering is front-end only. Binding the
		// render hooks in the admin would run them on preview screens.
		if ( is_admin() ) {
			return;
		}

		$bound = array();

		foreach ( self::all() as $placement => $config ) {
			$hook = (string) $config['hook'];

			if ( '' === $hook || isset( $bound[ $hook ] ) ) {
				continue;
			}

			// One callback per hook, which then renders every placement bound
			// to it. Binding once per placement would print the wrapper twice
			// where two placements share a hook, as popup and floating do.
			$bound[ $hook ] = true;

			add_action(
				$hook,
				function () use ( $hook ): void {
					$this->render_hook( $hook );
				},
				(int) $config['priority']
			);
		}

		// `the_content` is a filter, not an action, so the two in-content
		// placements are applied rather than echoed.
		add_filter( 'the_content', array( $this, 'filter_content' ), 20 );
	}

	/**
	 * Renders every placement bound to one hook.
	 *
	 * @since 1.7.0
	 *
	 * @param string $hook Hook currently firing.
	 *
	 * @return void
	 */
	private function render_hook( string $hook ): void {
		foreach ( self::all() as $placement => $config ) {
			if ( (string) $config['hook'] !== $hook ) {
				continue;
			}

			// Escaping happens inside the renderer, at each point of output.
			echo $this->render( $placement ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		}
	}

	/**
	 * Injects the in-content placements around post content.
	 *
	 * @since 1.7.0
	 *
	 * @param string $content Post content.
	 *
	 * @return string Content, possibly wrapped.
	 */
	public function filter_content( string $content ): string {
		// Only the main query's singular content, or the announcement would
		// appear in every excerpt on an archive.
		if ( ! is_singular() || ! in_the_loop() || ! is_main_query() ) {
			return $content;
		}

		return $this->render( 'before_content' ) . $content . $this->render( 'after_content' );
	}

	/**
	 * Renders one placement.
	 *
	 * @since 1.7.0
	 *
	 * @param string $placement Placement identifier.
	 *
	 * @return string Markup, or an empty string when nothing qualifies.
	 */
	public function render( string $placement ): string {
		$items = $this->for_placement( $placement );

		if ( empty( $items ) ) {
			return '';
		}

		$options = $this->options( $items[0] );

		return $this->frontend->placement_markup( $placement, $items, $options );
	}

	/**
	 * Returns the announcements that should appear in one placement now.
	 *
	 * Starts from {@see Announcements::active()}, so the audience and expiry
	 * rules are already applied and a placement cannot bypass them.
	 *
	 * @since 1.7.0
	 *
	 * @param string $placement Placement identifier.
	 *
	 * @return WP_Post[] Announcements for this placement.
	 */
	public function for_placement( string $placement ): array {
		$matched = array();

		foreach ( $this->announcements->active( 20 ) as $post ) {
			if ( self::placement_of( $post ) !== $placement ) {
				continue;
			}

			if ( ! $this->conditions_pass( $post ) ) {
				continue;
			}

			$matched[] = $post;
		}

		return $matched;
	}

	/**
	 * Returns an announcement's placement, defaulting to the page.
	 *
	 * An announcement written before 1.7.0 has no placement meta at all, and
	 * must keep behaving exactly as it did: shown on the announcements page
	 * and nowhere else. Reading a missing value as anything else would start
	 * popping up old announcements over people's sites on upgrade.
	 *
	 * @since 1.7.0
	 *
	 * @param WP_Post $post Announcement.
	 *
	 * @return string Placement identifier.
	 */
	public static function placement_of( WP_Post $post ): string {
		$stored = (string) get_post_meta( $post->ID, self::META_PLACEMENT, true );

		return array_key_exists( $stored, self::all() ) ? $stored : 'page';
	}

	/**
	 * Returns an announcement's placement options, filled in with defaults.
	 *
	 * @since 1.7.0
	 *
	 * @param WP_Post $post Announcement.
	 *
	 * @return array<string,mixed> Options.
	 */
	public function options( WP_Post $post ): array {
		$stored = get_post_meta( $post->ID, self::META_OPTIONS, true );
		$stored = is_array( $stored ) ? $stored : array();

		return wp_parse_args( $stored, self::default_options() );
	}

	/**
	 * The default placement options.
	 *
	 * @since 1.7.0
	 *
	 * @return array<string,mixed> Defaults.
	 */
	public static function default_options(): array {
		return array(
			'delay'          => 0,
			'position'       => 'center',
			'width'          => 480,
			'overlay'        => true,
			'close_button'   => true,
			'close_outside'  => true,
			'close_esc'      => true,
			'frequency'      => 'session',
			'sticky'         => true,
			'dismissible'    => true,
			'side'           => 'end',
			'show_on_mobile' => true,
		);
	}

	/**
	 * Which options each placement actually uses.
	 *
	 * A popup has a delay and an overlay; a footer bar has neither, and
	 * showing the two the same panel of controls is how a settings screen
	 * teaches people that half its switches do nothing. Declared here beside
	 * the placements themselves so a new placement brings its own answer.
	 *
	 * @since 1.7.1
	 *
	 * @return array<string,string[]> Option keys keyed by placement.
	 */
	public static function relevant_options(): array {
		$map = array(
			'page'           => array(),
			'before_content' => array( 'dismissible' ),
			'after_content'  => array( 'dismissible' ),
			'header'         => array( 'sticky', 'dismissible', 'show_on_mobile' ),
			'footer_bar'     => array( 'sticky', 'dismissible', 'show_on_mobile' ),
			'popup'          => array( 'delay', 'position', 'width', 'overlay', 'close_button', 'close_outside', 'close_esc', 'frequency', 'show_on_mobile' ),
			'floating'       => array( 'position', 'side', 'width', 'delay', 'dismissible', 'frequency', 'show_on_mobile' ),
			'bell'           => array( 'side', 'frequency', 'show_on_mobile' ),
		);

		foreach ( array_keys( self::all() ) as $placement ) {
			if ( ! isset( $map[ $placement ] ) ) {
				// A placement registered by a third party gets every control
				// rather than none: showing too much is recoverable, hiding a
				// control someone needs is not.
				$map[ $placement ] = array_keys( self::default_options() );
			}
		}

		/**
		 * Filters which options each placement exposes.
		 *
		 * @since 1.7.1
		 *
		 * @param array<string,string[]> $map Option keys keyed by placement.
		 */
		return (array) apply_filters( 'wpep_placement_relevant_options', $map );
	}

	/**
	 * Human labels and control types for the placement options.
	 *
	 * @since 1.7.1
	 *
	 * @return array<string,array<string,mixed>> Option descriptors.
	 */
	public static function option_schema(): array {
		return array(
			'delay'          => array(
				'label' => __( 'تأخیر پیش از نمایش (ثانیه)', 'wp-event-publisher' ),
				'type'  => 'number',
				'min'   => 0,
				'max'   => 600,
			),
			'position'       => array(
				'label'   => __( 'محل نمایش', 'wp-event-publisher' ),
				'type'    => 'select',
				'choices' => array(
					'center'       => __( 'وسط صفحه', 'wp-event-publisher' ),
					'top'          => __( 'بالا', 'wp-event-publisher' ),
					'bottom'       => __( 'پایین', 'wp-event-publisher' ),
					'bottom_start' => __( 'پایین، ابتدای صفحه', 'wp-event-publisher' ),
					'bottom_end'   => __( 'پایین، انتهای صفحه', 'wp-event-publisher' ),
				),
			),
			'width'          => array(
				'label' => __( 'پهنا (پیکسل)', 'wp-event-publisher' ),
				'type'  => 'number',
				'min'   => 200,
				'max'   => 1200,
			),
			'overlay'        => array(
				'label' => __( 'تیره کردن پس‌زمینه', 'wp-event-publisher' ),
				'type'  => 'switch',
			),
			'close_button'   => array(
				'label' => __( 'دکمه بستن', 'wp-event-publisher' ),
				'type'  => 'switch',
			),
			'close_outside'  => array(
				'label' => __( 'بستن با کلیک بیرون', 'wp-event-publisher' ),
				'type'  => 'switch',
			),
			'close_esc'      => array(
				'label' => __( 'بستن با کلید Esc', 'wp-event-publisher' ),
				'type'  => 'switch',
			),
			'frequency'      => array(
				'label'   => __( 'هر چند وقت یک‌بار دیده شود', 'wp-event-publisher' ),
				'type'    => 'select',
				'choices' => array(
					'always'  => __( 'هر بار', 'wp-event-publisher' ),
					'session' => __( 'یک‌بار در هر بازدید', 'wp-event-publisher' ),
					'once'    => __( 'فقط یک‌بار', 'wp-event-publisher' ),
				),
			),
			'sticky'         => array(
				'label' => __( 'چسبیده هنگام پیمایش', 'wp-event-publisher' ),
				'type'  => 'switch',
			),
			'dismissible'    => array(
				'label' => __( 'کاربر بتواند ببندد', 'wp-event-publisher' ),
				'type'  => 'switch',
			),
			'side'           => array(
				'label'   => __( 'سمت', 'wp-event-publisher' ),
				'type'    => 'select',
				'choices' => array(
					'start' => __( 'ابتدای صفحه', 'wp-event-publisher' ),
					'end'   => __( 'انتهای صفحه', 'wp-event-publisher' ),
				),
			),
			'show_on_mobile' => array(
				'label' => __( 'نمایش روی موبایل', 'wp-event-publisher' ),
				'type'  => 'switch',
			),
		);
	}

	/**
	 * Evaluates an announcement's display conditions.
	 *
	 * An announcement with no conditions shows everywhere its placement
	 * applies, which is what someone who never opened the conditions panel
	 * expects.
	 *
	 * @since 1.7.0
	 *
	 * @param WP_Post $post Announcement.
	 *
	 * @return bool Whether the conditions allow display.
	 */
	public function conditions_pass( WP_Post $post ): bool {
		$stored = get_post_meta( $post->ID, self::META_CONDITIONS, true );
		$stored = is_array( $stored ) ? $stored : array();

		$rules = isset( $stored['rules'] ) && is_array( $stored['rules'] ) ? $stored['rules'] : array();

		if ( empty( $rules ) ) {
			return true;
		}

		$any     = 'any' === ( $stored['match'] ?? 'all' );
		$results = array();

		foreach ( $rules as $rule ) {
			$results[] = $this->rule_passes( (array) $rule );
		}

		return $any ? in_array( true, $results, true ) : ! in_array( false, $results, true );
	}

	/**
	 * Evaluates one display condition.
	 *
	 * @since 1.7.0
	 *
	 * @param array<string,mixed> $rule Condition.
	 *
	 * @return bool Whether it passes.
	 */
	private function rule_passes( array $rule ): bool {
		$subject = (string) ( $rule['subject'] ?? '' );
		$op      = (string) ( $rule['operator'] ?? 'is' );
		$value   = (string) ( $rule['value'] ?? '' );

		$actual = $this->subject_value( $subject );

		// An unknown subject never matches, rather than matching everything:
		// a condition the plugin cannot evaluate must not silently widen the
		// audience.
		if ( null === $actual ) {
			return false;
		}

		switch ( $op ) {
			case 'is':
				return (string) $actual === $value;

			case 'is_not':
				return (string) $actual !== $value;

			case 'contains':
				return '' !== $value && str_contains( (string) $actual, $value );

			case 'not_contains':
				return '' === $value || ! str_contains( (string) $actual, $value );
		}

		return false;
	}

	/**
	 * Resolves the current value of a condition subject.
	 *
	 * @since 1.7.0
	 *
	 * @param string $subject Subject identifier.
	 *
	 * @return string|null Current value, or null when unknown.
	 */
	private function subject_value( string $subject ): ?string {
		switch ( $subject ) {
			case 'url':
				$path = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( (string) $_SERVER['REQUEST_URI'] ) ) : '';

				return $path;

			case 'post_type':
				return (string) get_post_type();

			case 'is_front_page':
				return is_front_page() ? 'yes' : 'no';

			case 'logged_in':
				return is_user_logged_in() ? 'yes' : 'no';

			case 'user_role':
				$user = wp_get_current_user();

				return ! empty( $user->roles ) ? (string) reset( $user->roles ) : '';

			case 'device':
				return wp_is_mobile() ? 'mobile' : 'desktop';
		}

		return null;
	}

	/**
	 * The subjects a condition may test.
	 *
	 * @since 1.7.0
	 *
	 * @return array<string,string> Subject labels.
	 */
	public static function condition_subjects(): array {
		return array(
			'url'           => __( 'نشانی صفحه', 'wp-event-publisher' ),
			'post_type'     => __( 'نوع محتوا', 'wp-event-publisher' ),
			'is_front_page' => __( 'صفحه اصلی', 'wp-event-publisher' ),
			'logged_in'     => __( 'کاربر وارد شده', 'wp-event-publisher' ),
			'user_role'     => __( 'نقش کاربر', 'wp-event-publisher' ),
			'device'        => __( 'نوع دستگاه', 'wp-event-publisher' ),
		);
	}

	/**
	 * The operators a condition may use.
	 *
	 * @since 1.7.0
	 *
	 * @return array<string,string> Operator labels.
	 */
	public static function condition_operators(): array {
		return array(
			'is'           => __( 'برابر است با', 'wp-event-publisher' ),
			'is_not'       => __( 'برابر نیست با', 'wp-event-publisher' ),
			'contains'     => __( 'شامل باشد', 'wp-event-publisher' ),
			'not_contains' => __( 'شامل نباشد', 'wp-event-publisher' ),
		);
	}

	/**
	 * Adds the placement metabox to the announcement editor.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function add_meta_box(): void {
		add_meta_box(
			'wpep-announcement-placement',
			__( 'محل نمایش', 'wp-event-publisher' ),
			array( $this, 'render_meta_box' ),
			Announcements::POST_TYPE,
			'normal',
			'high'
		);
	}

	/**
	 * Renders the placement metabox.
	 *
	 * @since 1.7.0
	 *
	 * @param WP_Post $post Announcement being edited.
	 *
	 * @return void
	 */
	public function render_meta_box( WP_Post $post ): void {
		$file = WPEP_PLUGIN_DIR . 'admin/views/announcement-placement.php';

		if ( ! is_readable( $file ) ) {
			return;
		}

		wp_nonce_field( 'wpep_placement', 'wpep_placement_nonce' );

		$placement  = self::placement_of( $post );
		$options    = $this->options( $post );
		$conditions = get_post_meta( $post->ID, self::META_CONDITIONS, true );
		$conditions = is_array( $conditions ) ? $conditions : array( 'match' => 'all', 'rules' => array() );

		include $file;
	}

	/**
	 * Persists the placement, its options and its conditions.
	 *
	 * @since 1.7.0
	 *
	 * @param int     $post_id Announcement ID.
	 * @param WP_Post $post    Announcement.
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

		if ( ! isset( $_POST['wpep_placement_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( (string) $_POST['wpep_placement_nonce'] ) ), 'wpep_placement' ) ) {
			return;
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		$this->save_meta( $post_id, wp_unslash( $_POST ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified above.
	}

	/**
	 * Writes the placement, its options and its conditions from a submitted
	 * array.
	 *
	 * Split out of {@see self::save()} so the announcement builder stores
	 * placement through exactly the same sanitizing. Capability and nonce are
	 * the caller's responsibility.
	 *
	 * @since 1.7.1
	 *
	 * @param int                 $post_id Announcement identifier.
	 * @param array<string,mixed> $input   Unslashed submitted values.
	 *
	 * @return void
	 */
	public function save_meta( int $post_id, array $input ): void {
		// Constrained to the declared placement list, so a crafted form cannot
		// store a placement that will never render and looks like a bug.
		$placement = isset( $input['wpep_placement'] ) ? sanitize_key( (string) $input['wpep_placement'] ) : 'page';
		$placement = array_key_exists( $placement, self::all() ) ? $placement : 'page';
		update_post_meta( $post_id, self::META_PLACEMENT, $placement );

		update_post_meta( $post_id, self::META_OPTIONS, $this->sanitize_options( $input['wpep_placement_options'] ?? array() ) );
		update_post_meta( $post_id, self::META_CONDITIONS, $this->sanitize_conditions( $input['wpep_conditions'] ?? array() ) );
	}

	/**
	 * Sanitizes submitted placement options.
	 *
	 * Built from the default key set rather than the submitted keys.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $raw Submitted options.
	 *
	 * @return array<string,mixed> Sanitized options.
	 */
	private function sanitize_options( mixed $raw ): array {
		$input = is_array( $raw ) ? $raw : array();
		$clean = array();

		foreach ( self::default_options() as $key => $default ) {
			$value = $input[ $key ] ?? null;

			if ( is_bool( $default ) ) {
				$clean[ $key ] = null === $value ? false : ( '0' !== (string) $value && '' !== (string) $value );

				continue;
			}

			if ( is_int( $default ) ) {
				$clean[ $key ] = max( 0, min( 60000, absint( $value ) ) );

				continue;
			}

			$clean[ $key ] = sanitize_key( (string) ( $value ?? $default ) );
		}

		return $clean;
	}

	/**
	 * Sanitizes submitted display conditions.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $raw Submitted conditions.
	 *
	 * @return array{match:string,rules:array<int,array<string,string>>} Sanitized conditions.
	 */
	private function sanitize_conditions( mixed $raw ): array {
		$input = is_array( $raw ) ? $raw : array();

		$match = 'any' === ( $input['match'] ?? 'all' ) ? 'any' : 'all';
		$rules = array();

		$subjects  = array_keys( self::condition_subjects() );
		$operators = array_keys( self::condition_operators() );

		foreach ( (array) ( $input['rules'] ?? array() ) as $rule ) {
			if ( ! is_array( $rule ) ) {
				continue;
			}

			$subject = sanitize_key( (string) ( $rule['subject'] ?? '' ) );

			if ( ! in_array( $subject, $subjects, true ) ) {
				continue;
			}

			$operator = sanitize_key( (string) ( $rule['operator'] ?? 'is' ) );

			$rules[] = array(
				'subject'  => $subject,
				'operator' => in_array( $operator, $operators, true ) ? $operator : 'is',
				'value'    => mb_substr( sanitize_text_field( (string) ( $rule['value'] ?? '' ) ), 0, 200 ),
			);

			// A generous but finite cap: a rule list this long is a mistake,
			// and evaluating it on every page load would be a real cost.
			if ( count( $rules ) >= 20 ) {
				break;
			}
		}

		return array(
			'match' => $match,
			'rules' => $rules,
		);
	}
}
