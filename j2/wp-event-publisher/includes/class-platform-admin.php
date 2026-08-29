<?php
/**
 * Profiles, Destinations and Rules admin screens.
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
 * The three platform screens and their endpoints.
 *
 * Profiles, Destinations and Rules are one controller because they share
 * everything that matters: the same capability, the same nonce, the same
 * import/export shape, and the same rule tester. Splitting them into three
 * classes would triple the boilerplate and halve the clarity.
 *
 * Every entry point checks the capability **and** the nonce before reading
 * a single field of input, every stored value is sanitized on the way in,
 * and every displayed value is escaped on the way out.
 *
 * @since 1.5.0
 */
class PlatformAdmin {

	/**
	 * Profiles screen slug.
	 *
	 * @var string
	 */
	public const PAGE_PROFILES = Admin::MENU_SLUG . '-profiles';

	/**
	 * Destinations screen slug.
	 *
	 * @var string
	 */
	public const PAGE_DESTINATIONS = Admin::MENU_SLUG . '-destinations';

	/**
	 * Rules screen slug.
	 *
	 * @var string
	 */
	public const PAGE_RULES = Admin::MENU_SLUG . '-rules';

	/**
	 * Nonce action for these screens.
	 *
	 * @var string
	 */
	public const NONCE = 'wpep_platform';

	/**
	 * Profile repository.
	 *
	 * @var ProfileRepository
	 */
	private ProfileRepository $profiles;

	/**
	 * Rule engine.
	 *
	 * @var RuleEngine
	 */
	private RuleEngine $rules;

	/**
	 * Destination registry.
	 *
	 * @var DestinationRegistry
	 */
	private DestinationRegistry $destinations;

	/**
	 * Publication workflow.
	 *
	 * @var Publisher
	 */
	private Publisher $publisher;

	/**
	 * Field registry.
	 *
	 * @var FieldRegistry
	 */
	private FieldRegistry $registry;

	/**
	 * Field resolver.
	 *
	 * @var FieldResolver
	 */
	private FieldResolver $resolver;

	/**
	 * Normalizer.
	 *
	 * @var Normalizer
	 */
	private Normalizer $normalizer;

	/**
	 * Contract builder.
	 *
	 * @var Contract
	 */
	private Contract $contract;

	/**
	 * Settings service.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Constructor.
	 *
	 * @since 1.5.0
	 *
	 * @param ProfileRepository   $profiles     Profile repository.
	 * @param RuleEngine          $rules        Rule engine.
	 * @param DestinationRegistry $destinations Destination registry.
	 * @param Publisher           $publisher    Publication workflow.
	 * @param FieldRegistry       $registry     Field registry.
	 * @param FieldResolver       $resolver     Field resolver.
	 * @param Normalizer          $normalizer   Normalizer.
	 * @param Contract            $contract     Contract builder.
	 * @param Settings            $settings     Settings service.
	 */
	public function __construct(
		ProfileRepository $profiles,
		RuleEngine $rules,
		DestinationRegistry $destinations,
		Publisher $publisher,
		FieldRegistry $registry,
		FieldResolver $resolver,
		Normalizer $normalizer,
		Contract $contract,
		Settings $settings
	) {
		$this->profiles     = $profiles;
		$this->rules        = $rules;
		$this->destinations = $destinations;
		$this->publisher    = $publisher;
		$this->registry     = $registry;
		$this->resolver     = $resolver;
		$this->normalizer   = $normalizer;
		$this->contract     = $contract;
		$this->settings     = $settings;
	}

	/**
	 * Registers the screens, assets and endpoints.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function register(): void {
		// Menu entries are registered centrally by Admin::register_menu().
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );

		add_action( 'wp_ajax_wpep_platform_state', array( $this, 'ajax_state' ) );
		add_action( 'wp_ajax_wpep_save_profile', array( $this, 'ajax_save_profile' ) );
		add_action( 'wp_ajax_wpep_delete_profile', array( $this, 'ajax_delete_profile' ) );
		add_action( 'wp_ajax_wpep_duplicate_profile', array( $this, 'ajax_duplicate_profile' ) );
		add_action( 'wp_ajax_wpep_assign_profile', array( $this, 'ajax_assign_profile' ) );
		add_action( 'wp_ajax_wpep_save_destination', array( $this, 'ajax_save_destination' ) );
		add_action( 'wp_ajax_wpep_delete_destination', array( $this, 'ajax_delete_destination' ) );
		add_action( 'wp_ajax_wpep_duplicate_destination', array( $this, 'ajax_duplicate_destination' ) );
		add_action( 'wp_ajax_wpep_test_destination', array( $this, 'ajax_test_destination' ) );
		add_action( 'wp_ajax_wpep_save_rule', array( $this, 'ajax_save_rule' ) );
		add_action( 'wp_ajax_wpep_delete_rule', array( $this, 'ajax_delete_rule' ) );
		add_action( 'wp_ajax_wpep_reorder_rules', array( $this, 'ajax_reorder_rules' ) );
		add_action( 'wp_ajax_wpep_test_rules', array( $this, 'ajax_test_rules' ) );
		add_action( 'wp_ajax_wpep_import', array( $this, 'ajax_import' ) );

		add_action( 'admin_post_wpep_export', array( $this, 'handle_export' ) );
	}

	/**
	 * Adds the three submenu entries.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function register_menu(): void {
		// Navigation is centralized in Admin::register_menu().
	}

	/**
	 * Enqueues the shared assets for these screens.
	 *
	 * @since 1.5.0
	 *
	 * @param string $hook_suffix Current admin page.
	 *
	 * @return void
	 */
	public function enqueue( string $hook_suffix ): void {
		$screens = array( self::PAGE_PROFILES, self::PAGE_DESTINATIONS, self::PAGE_RULES );
		$current = '';

		foreach ( $screens as $slug ) {
			if ( str_contains( $hook_suffix, $slug ) ) {
				$current = $slug;
				break;
			}
		}

		if ( '' === $current ) {
			return;
		}

		wp_enqueue_script(
			'wpep-platform',
			WPEP_PLUGIN_URL . 'admin/js/platform.js',
			array( 'jquery', 'jquery-ui-sortable' ),
			WPEP_VERSION,
			true
		);

		// Only a nonce, the screen name and UI strings reach the browser.
		// No destination credential is ever localized.
		wp_localize_script(
			'wpep-platform',
			'wpepPlatform',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( self::NONCE ),
				'screen'  => $current,
				'i18n'    => array(
					'loading'       => __( 'Loading…', 'wp-event-publisher' ),
					'saving'        => __( 'Saving…', 'wp-event-publisher' ),
					'saved'         => __( 'Saved.', 'wp-event-publisher' ),
					'deleted'       => __( 'Deleted.', 'wp-event-publisher' ),
					'testing'       => __( 'Testing…', 'wp-event-publisher' ),
					'failed'        => __( 'The request failed.', 'wp-event-publisher' ),
					'confirmDelete' => __( 'Delete this permanently?', 'wp-event-publisher' ),
					'untitled'      => __( 'Untitled', 'wp-event-publisher' ),
					'newProfile'    => __( 'New profile', 'wp-event-publisher' ),
					'newRule'       => __( 'New rule', 'wp-event-publisher' ),
					'newDest'       => __( 'New destination', 'wp-event-publisher' ),
					'namePrompt'    => __( 'Name:', 'wp-event-publisher' ),
					'inherits'      => __( 'inherits from', 'wp-event-publisher' ),
					'matched'       => __( 'Matched', 'wp-event-publisher' ),
					'notMatched'    => __( 'Not matched', 'wp-event-publisher' ),
					'noRules'       => __( 'No rules are defined. Everything is published with the assigned profile.', 'wp-event-publisher' ),
					'and'           => __( 'AND', 'wp-event-publisher' ),
					'or'            => __( 'OR', 'wp-event-publisher' ),
					'addCondition'  => __( 'Add condition', 'wp-event-publisher' ),
					'addGroup'      => __( 'Add nested group', 'wp-event-publisher' ),
					'addAction'     => __( 'Add action', 'wp-event-publisher' ),
					'remove'        => __( 'Remove', 'wp-event-publisher' ),
				),
			)
		);
	}

	/**
	 * Renders whichever of the three screens was requested.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function render(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'wp-event-publisher' ), 403 );
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only screen selection, capability checked above.
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';

		$view = match ( $page ) {
			self::PAGE_DESTINATIONS => 'destinations',
			self::PAGE_RULES        => 'rules',
			default                 => 'profiles',
		};

		$file = WPEP_PLUGIN_DIR . 'admin/views/' . $view . '.php';

		if ( ! is_readable( $file ) ) {
			printf(
				'<div class="wrap"><h1>%s</h1><div class="notice notice-error"><p>%s</p></div></div>',
				esc_html__( 'جارچی', 'wp-event-publisher' ),
				esc_html__( 'A plugin file is missing. Re-install the plugin to restore it.', 'wp-event-publisher' )
			);

			return;
		}

		$state = $this->state();

		wpep()->admin()->render_inner_shell_start();

		// phpcs:ignore WordPress.PHP.DontExtract.extract_extract -- fixed keys built by state().
		extract( $state, EXTR_SKIP );

		require $file;

		wpep()->admin()->render_inner_shell_end();
	}

	/**
	 * Builds everything the three screens read.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Screen state.
	 */
	private function state(): array {
		$profiles = array();

		foreach ( $this->profiles->all() as $profile ) {
			$profiles[] = array_merge(
				$profile->to_array(),
				array(
					'chain'      => $this->profiles->chain( $profile->id() ),
					'field_count' => count( $profile->fields() ),
				)
			);
		}

		$destinations = array();

		foreach ( $this->destinations->all() as $destination ) {
			$provider = $this->destinations->provider( (string) $destination['provider'] );

			$destinations[] = array_merge(
				$this->redact( $destination ),
				array(
					'provider_label' => $provider instanceof DeliveryProvider ? $provider->label() : (string) $destination['provider'],
					'available'      => $provider instanceof DeliveryProvider,
					'problems'       => $this->destinations->validate( $destination ),
				)
			);
		}

		$rules = array();

		foreach ( $this->rules->all() as $rule ) {
			$rules[] = $rule->to_array();
		}

		$providers = array();

		foreach ( $this->destinations->providers() as $provider ) {
			$providers[] = array(
				'id'         => $provider->id(),
				'label'      => $provider->label(),
				'schema'     => $provider->settings_schema(),
				'images'     => $provider->supports_images(),
				'gallery'    => $provider->supports_gallery(),
				'formatting' => $provider->supports_formatting(),
				'buttons'    => $provider->supports_buttons(),
				'scheduling' => $provider->supports_scheduling(),
			);
		}

		return array(
			'profiles'     => $profiles,
			'destinations' => $destinations,
			'rules'        => $rules,
			'providers'    => $providers,
			'assignments'  => $this->profiles->assignments(),
			'scopes'       => $this->scopes(),
			'subjects'     => $this->subjects(),
			'operators'    => $this->operators(),
			'rule_actions' => $this->rule_actions(),
			'image_modes'  => $this->image_modes(),
			'export_url'   => wp_nonce_url( admin_url( 'admin-post.php?action=wpep_export' ), self::NONCE ),
		);
	}

	/**
	 * Removes secret values from a destination before it reaches the page.
	 *
	 * A password-typed setting is replaced with a marker: the screen shows
	 * that something is stored without ever putting it in the page source,
	 * and an unchanged marker on save keeps the stored value.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $destination Destination.
	 *
	 * @return array<string,mixed> Redacted destination.
	 */
	private function redact( array $destination ): array {
		$provider = $this->destinations->provider( (string) ( $destination['provider'] ?? '' ) );

		if ( ! $provider instanceof DeliveryProvider ) {
			$destination['config'] = array();

			return $destination;
		}

		$config = (array) ( $destination['config'] ?? array() );

		foreach ( $provider->settings_schema() as $key => $setting ) {
			if ( 'password' !== ( $setting['type'] ?? '' ) ) {
				continue;
			}

			$config[ $key ] = '' === trim( (string) ( $config[ $key ] ?? '' ) ) ? '' : self::SECRET_MARKER;
		}

		$destination['config'] = $config;

		return $destination;
	}

	/**
	 * Placeholder shown in place of a stored secret.
	 *
	 * @var string
	 */
	public const SECRET_MARKER = '__wpep_stored__';

	/**
	 * Lists the scopes a profile can be assigned to.
	 *
	 * @since 1.5.0
	 *
	 * @return array<int,array{key:string,label:string,depth:int}> Scope rows.
	 */
	private function scopes(): array {
		$scopes = array(
			array(
				'key'   => '*',
				'label' => __( 'Every post type (site default)', 'wp-event-publisher' ),
				'depth' => 0,
			),
		);

		foreach ( $this->settings->allowed_post_types() as $post_type ) {
			$object = get_post_type_object( $post_type );

			$scopes[] = array(
				'key'   => FieldMapping::scope( $post_type ),
				'label' => ( $object ? (string) ( $object->labels->singular_name ?? $post_type ) : $post_type ) . ' (' . $post_type . ')',
				'depth' => 1,
			);

			$taxonomy = $this->profiles_taxonomy( $post_type );

			if ( '' === $taxonomy ) {
				continue;
			}

			$terms = get_terms(
				array(
					'taxonomy'   => $taxonomy,
					'hide_empty' => false,
					'number'     => 300,
					'orderby'    => 'name',
				)
			);

			if ( is_wp_error( $terms ) || ! is_array( $terms ) ) {
				continue;
			}

			foreach ( $terms as $term ) {
				if ( ! $term instanceof \WP_Term ) {
					continue;
				}

				$depth = count( get_ancestors( (int) $term->term_id, $taxonomy, 'taxonomy' ) );

				$scopes[] = array(
					'key'   => FieldMapping::scope( $post_type, $taxonomy, (int) $term->term_id ),
					'label' => str_repeat( '— ', $depth ) . (string) $term->name,
					'depth' => 2 + $depth,
				);
			}
		}

		return $scopes;
	}

	/**
	 * Returns the taxonomy driving assignments for a post type.
	 *
	 * @since 1.5.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return string Taxonomy name.
	 */
	private function profiles_taxonomy( string $post_type ): string {
		/** This filter is documented in includes/class-field-mapping.php */
		$chosen = '';

		foreach ( get_object_taxonomies( $post_type, 'objects' ) as $taxonomy ) {
			if ( $taxonomy instanceof \WP_Taxonomy && $taxonomy->hierarchical ) {
				$chosen = (string) $taxonomy->name;
				break;
			}
		}

		return (string) apply_filters( 'wpep_mapping_taxonomy', $chosen, $post_type );
	}

	/**
	 * Describes the condition subjects for the rule builder.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,array{label:string,needs_key:bool}> Subjects.
	 */
	private function subjects(): array {
		return array(
			'category'        => array( 'label' => __( 'Category (top level)', 'wp-event-publisher' ), 'needs_key' => false ),
			'subcategory'     => array( 'label' => __( 'Subcategory', 'wp-event-publisher' ), 'needs_key' => false ),
			'parent_category' => array( 'label' => __( 'Parent category', 'wp-event-publisher' ), 'needs_key' => false ),
			'term'            => array( 'label' => __( 'Assigned term (deepest)', 'wp-event-publisher' ), 'needs_key' => false ),
			'taxonomy'        => array( 'label' => __( 'Any term in a taxonomy', 'wp-event-publisher' ), 'needs_key' => true ),
			'tags'            => array( 'label' => __( 'Tags', 'wp-event-publisher' ), 'needs_key' => false ),
			'post_type'       => array( 'label' => __( 'Post type', 'wp-event-publisher' ), 'needs_key' => false ),
			'post_status'     => array( 'label' => __( 'Post status', 'wp-event-publisher' ), 'needs_key' => false ),
			'post_id'         => array( 'label' => __( 'Post ID', 'wp-event-publisher' ), 'needs_key' => false ),
			'title'           => array( 'label' => __( 'Title', 'wp-event-publisher' ), 'needs_key' => false ),
			'author'          => array( 'label' => __( 'Author (login)', 'wp-event-publisher' ), 'needs_key' => false ),
			'user_role'       => array( 'label' => __( 'Author role', 'wp-event-publisher' ), 'needs_key' => false ),
			'field'           => array( 'label' => __( 'Custom field (text)', 'wp-event-publisher' ), 'needs_key' => true ),
			'number'          => array( 'label' => __( 'Custom field (number)', 'wp-event-publisher' ), 'needs_key' => true ),
			'boolean'         => array( 'label' => __( 'Custom field (yes/no)', 'wp-event-publisher' ), 'needs_key' => true ),
			'price'           => array( 'label' => __( 'Price', 'wp-event-publisher' ), 'needs_key' => true ),
			'image_count'     => array( 'label' => __( 'Number of images', 'wp-event-publisher' ), 'needs_key' => false ),
			'gallery_count'   => array( 'label' => __( 'Number of gallery images', 'wp-event-publisher' ), 'needs_key' => false ),
			'word_count'      => array( 'label' => __( 'Word count', 'wp-event-publisher' ), 'needs_key' => false ),
			'date'            => array( 'label' => __( 'Publication date', 'wp-event-publisher' ), 'needs_key' => false ),
			'time'            => array( 'label' => __( 'Publication time', 'wp-event-publisher' ), 'needs_key' => false ),
			'weekday'         => array( 'label' => __( 'Day of the week', 'wp-event-publisher' ), 'needs_key' => false ),
		);
	}

	/**
	 * Describes the operators for the rule builder.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,string> Operator labels.
	 */
	private function operators(): array {
		return array(
			'is'           => __( 'is', 'wp-event-publisher' ),
			'is_not'       => __( 'is not', 'wp-event-publisher' ),
			'contains'     => __( 'contains', 'wp-event-publisher' ),
			'not_contains' => __( 'does not contain', 'wp-event-publisher' ),
			'starts_with'  => __( 'starts with', 'wp-event-publisher' ),
			'ends_with'    => __( 'ends with', 'wp-event-publisher' ),
			'in'           => __( 'is one of (comma separated)', 'wp-event-publisher' ),
			'not_in'       => __( 'is none of (comma separated)', 'wp-event-publisher' ),
			'gt'           => __( 'is greater than', 'wp-event-publisher' ),
			'gte'          => __( 'is at least', 'wp-event-publisher' ),
			'lt'           => __( 'is less than', 'wp-event-publisher' ),
			'lte'          => __( 'is at most', 'wp-event-publisher' ),
			'between'      => __( 'is between (min,max)', 'wp-event-publisher' ),
			'matches'      => __( 'matches pattern (* and ?)', 'wp-event-publisher' ),
			'empty'        => __( 'is empty', 'wp-event-publisher' ),
			'not_empty'    => __( 'is not empty', 'wp-event-publisher' ),
		);
	}

	/**
	 * Describes the rule actions for the builder.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,array{label:string,hint:string}> Actions.
	 */
	private function rule_actions(): array {
		return array(
			Rule::ACTION_PROFILE      => array( 'label' => __( 'Use profile', 'wp-event-publisher' ), 'hint' => __( 'Profile identifier', 'wp-event-publisher' ) ),
			Rule::ACTION_TEMPLATE     => array( 'label' => __( 'Use this template', 'wp-event-publisher' ), 'hint' => __( 'Template text with {{placeholders}}', 'wp-event-publisher' ) ),
			Rule::ACTION_DESTINATION  => array( 'label' => __( 'Send only to', 'wp-event-publisher' ), 'hint' => __( 'Destination identifiers, comma separated', 'wp-event-publisher' ) ),
			Rule::ACTION_ADD_DEST     => array( 'label' => __( 'Also send to', 'wp-event-publisher' ), 'hint' => __( 'Destination identifiers, comma separated', 'wp-event-publisher' ) ),
			Rule::ACTION_PREPEND      => array( 'label' => __( 'Add text before the message', 'wp-event-publisher' ), 'hint' => __( 'Text, for example a ⭐ badge', 'wp-event-publisher' ) ),
			Rule::ACTION_APPEND       => array( 'label' => __( 'Add text after the message', 'wp-event-publisher' ), 'hint' => __( 'Text', 'wp-event-publisher' ) ),
			Rule::ACTION_REPLACE      => array( 'label' => __( 'Replace text', 'wp-event-publisher' ), 'hint' => __( 'search|replacement', 'wp-event-publisher' ) ),
			Rule::ACTION_SHOW_FIELD   => array( 'label' => __( 'Show field', 'wp-event-publisher' ), 'hint' => __( 'Field keys, comma separated', 'wp-event-publisher' ) ),
			Rule::ACTION_HIDE_FIELD   => array( 'label' => __( 'Hide field', 'wp-event-publisher' ), 'hint' => __( 'Field keys, comma separated', 'wp-event-publisher' ) ),
			Rule::ACTION_LIMIT_IMAGES => array( 'label' => __( 'Send at most N images', 'wp-event-publisher' ), 'hint' => __( 'A number', 'wp-event-publisher' ) ),
			Rule::ACTION_NO_IMAGES    => array( 'label' => __( 'Send no images', 'wp-event-publisher' ), 'hint' => '' ),
			Rule::ACTION_DELAY        => array( 'label' => __( 'Delay publishing by N seconds', 'wp-event-publisher' ), 'hint' => __( 'Seconds; 300 is five minutes', 'wp-event-publisher' ) ),
			Rule::ACTION_SKIP         => array( 'label' => __( 'Do not publish', 'wp-event-publisher' ), 'hint' => __( 'Optional reason for the log', 'wp-event-publisher' ) ),
			Rule::ACTION_STOP         => array( 'label' => __( 'Stop processing further rules', 'wp-event-publisher' ), 'hint' => '' ),
			Rule::ACTION_CONTINUE     => array( 'label' => __( 'Continue processing rules', 'wp-event-publisher' ), 'hint' => '' ),
		);
	}

	/**
	 * Describes the image modes.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,string> Mode labels.
	 */
	private function image_modes(): array {
		return array(
			Profile::IMAGES_BOTH     => __( 'Featured image and gallery', 'wp-event-publisher' ),
			Profile::IMAGES_FEATURED => __( 'Only the featured image', 'wp-event-publisher' ),
			Profile::IMAGES_GALLERY  => __( 'Only the gallery', 'wp-event-publisher' ),
			Profile::IMAGES_NONE     => __( 'No images', 'wp-event-publisher' ),
		);
	}

	/* ------------------------------------------------------------------
	 * AJAX endpoints
	 * --------------------------------------------------------------- */

	/**
	 * AJAX: returns the full screen state.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_state(): void {
		$this->verify();

		wp_send_json_success( $this->state() );
	}

	/**
	 * AJAX: creates or updates a profile.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_save_profile(): void {
		$this->verify();

		$input = $this->request_array( 'profile' );
		$id    = Profile::sanitize_id( (string) ( $input['id'] ?? '' ) );
		$name  = sanitize_text_field( (string) ( $input['name'] ?? '' ) );

		if ( '' === $id ) {
			$id = $this->profiles->unique_id( $name );
		}

		$existing = $this->profiles->find( $id );

		$data = array(
			'id'           => $id,
			'name'         => '' !== $name ? $name : ( $existing instanceof Profile ? $existing->name() : $id ),
			'description'  => sanitize_textarea_field( (string) ( $input['description'] ?? '' ) ),
			'parent'       => Profile::sanitize_id( (string) ( $input['parent'] ?? '' ) ),
			'template'     => $this->sanitize_template( $input['template'] ?? '' ),
			'fields'       => $existing instanceof Profile ? $existing->fields() : array(),
			'favorites'    => array_map( array( Field::class, 'sanitize_key' ), (array) ( $input['favorites'] ?? ( $existing instanceof Profile ? $existing->favorites() : array() ) ) ),
			'destinations' => array_map( array( Profile::class, 'sanitize_id' ), (array) ( $input['destinations'] ?? array() ) ),
			'images'       => array(
				'mode' => sanitize_key( (string) ( $input['image_mode'] ?? Profile::IMAGES_BOTH ) ),
				'max'  => absint( $input['image_max'] ?? 10 ),
			),
			'formatting'   => array(
				'prepend' => sanitize_textarea_field( (string) ( $input['prepend'] ?? '' ) ),
				'append'  => sanitize_textarea_field( (string) ( $input['append'] ?? '' ) ),
			),
			'locked'       => $existing instanceof Profile ? $existing->is_locked() : false,
			'created'      => $existing instanceof Profile ? $existing->created() : gmdate( 'Y-m-d H:i:s' ),
		);

		// Field mappings arrive from the Field Mapping screen, not here, so
		// an edit on this screen can never silently discard them.
		if ( isset( $input['fields'] ) && is_array( $input['fields'] ) ) {
			$data['fields'] = $this->sanitize_fields( (array) $input['fields'] );
		}

		$profile = new Profile( $data );

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verify() ran first.
		$post_type = isset( $_POST['post_type'] ) ? sanitize_key( wp_unslash( $_POST['post_type'] ) ) : '';

		$problems = $this->profiles->validate( $profile, $post_type );

		foreach ( $problems as $problem ) {
			if ( 'error' === $problem['level'] ) {
				wp_send_json_error(
					array(
						'message'  => __( 'The profile was not saved.', 'wp-event-publisher' ),
						'problems' => $problems,
					),
					400
				);
			}
		}

		$this->profiles->save( $profile );

		wp_send_json_success(
			array(
				'message'  => __( 'Profile saved.', 'wp-event-publisher' ),
				'id'       => $profile->id(),
				'problems' => $problems,
				'state'    => $this->state(),
			)
		);
	}

	/**
	 * AJAX: deletes a profile.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_delete_profile(): void {
		$this->verify();

		$id = Profile::sanitize_id( $this->request_string( 'id' ) );

		if ( ! $this->profiles->delete( $id ) ) {
			wp_send_json_error( array( 'message' => __( 'That profile could not be deleted. The default profile is protected.', 'wp-event-publisher' ) ), 400 );
		}

		wp_send_json_success(
			array(
				'message' => __( 'Profile deleted. Anything that inherited from it now inherits from its parent.', 'wp-event-publisher' ),
				'state'   => $this->state(),
			)
		);
	}

	/**
	 * AJAX: duplicates a profile.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_duplicate_profile(): void {
		$this->verify();

		$copy = $this->profiles->duplicate(
			Profile::sanitize_id( $this->request_string( 'id' ) ),
			sanitize_text_field( $this->request_string( 'name' ) )
		);

		if ( ! $copy instanceof Profile ) {
			wp_send_json_error( array( 'message' => __( 'That profile could not be duplicated.', 'wp-event-publisher' ) ), 400 );
		}

		wp_send_json_success(
			array(
				'message' => __( 'Profile duplicated.', 'wp-event-publisher' ),
				'id'      => $copy->id(),
				'state'   => $this->state(),
			)
		);
	}

	/**
	 * AJAX: assigns a profile to a scope.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_assign_profile(): void {
		$this->verify();

		$scope = $this->request_string( 'scope' );
		$id    = Profile::sanitize_id( $this->request_string( 'profile' ) );

		// A scope must be one the screen offered, never arbitrary text.
		$valid = array_column( $this->scopes(), 'key' );

		if ( ! in_array( $scope, $valid, true ) ) {
			wp_send_json_error( array( 'message' => __( 'That is not a scope this site has.', 'wp-event-publisher' ) ), 400 );
		}

		$this->profiles->assign( $scope, $id );

		wp_send_json_success(
			array(
				'message' => '' === $id
					? __( 'Assignment removed; this scope inherits again.', 'wp-event-publisher' )
					: __( 'Profile assigned.', 'wp-event-publisher' ),
				'state'   => $this->state(),
			)
		);
	}

	/**
	 * AJAX: creates or updates a destination.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_save_destination(): void {
		$this->verify();

		$input = $this->request_array( 'destination' );
		$id    = Profile::sanitize_id( (string) ( $input['id'] ?? '' ) );
		$name  = sanitize_text_field( (string) ( $input['name'] ?? '' ) );

		if ( '' === $id ) {
			$id = $this->destinations->unique_id( $name );
		}

		$provider_id = Profile::sanitize_id( (string) ( $input['provider'] ?? TelegramDeliveryProvider::ID ) );
		$provider    = $this->destinations->provider( $provider_id );

		if ( ! $provider instanceof DeliveryProvider ) {
			wp_send_json_error( array( 'message' => __( 'That delivery provider is not registered.', 'wp-event-publisher' ) ), 400 );
		}

		$existing = $this->destinations->find( $id );
		$config   = $this->sanitize_config( (array) ( $input['config'] ?? array() ), $provider, $existing );

		$destination = array(
			'id'       => $id,
			'name'     => '' !== $name ? $name : $id,
			'provider' => $provider_id,
			'enabled'  => ! empty( $input['enabled'] ),
			'profile'  => Profile::sanitize_id( (string) ( $input['profile'] ?? '' ) ),
			'template' => $this->sanitize_template( $input['template'] ?? '' ),
			'delay'    => absint( $input['delay'] ?? 0 ),
			'images'   => isset( $input['images'] ) && '' !== $input['images'] ? max( -1, (int) $input['images'] ) : -1,
			'config'   => $config,
			'created'  => null !== $existing ? (string) $existing['created'] : gmdate( 'Y-m-d H:i:s' ),
		);

		$problems = $this->destinations->validate( $destination );

		if ( ! empty( $problems ) && ! empty( $destination['enabled'] ) ) {
			wp_send_json_error(
				array(
					'message'  => __( 'The destination was not saved: fix these first, or save it disabled.', 'wp-event-publisher' ),
					'problems' => $problems,
				),
				400
			);
		}

		$this->destinations->save( $destination );

		wp_send_json_success(
			array(
				'message'  => __( 'Destination saved.', 'wp-event-publisher' ),
				'id'       => $id,
				'problems' => $problems,
				'state'    => $this->state(),
			)
		);
	}

	/**
	 * AJAX: deletes a destination.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_delete_destination(): void {
		$this->verify();

		if ( ! $this->destinations->delete( Profile::sanitize_id( $this->request_string( 'id' ) ) ) ) {
			wp_send_json_error( array( 'message' => __( 'That destination could not be deleted.', 'wp-event-publisher' ) ), 400 );
		}

		wp_send_json_success(
			array(
				'message' => __( 'Destination deleted.', 'wp-event-publisher' ),
				'state'   => $this->state(),
			)
		);
	}

	/**
	 * AJAX: duplicates a destination.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_duplicate_destination(): void {
		$this->verify();

		$copy = $this->destinations->duplicate(
			Profile::sanitize_id( $this->request_string( 'id' ) ),
			sanitize_text_field( $this->request_string( 'name' ) )
		);

		if ( null === $copy ) {
			wp_send_json_error( array( 'message' => __( 'That destination could not be duplicated.', 'wp-event-publisher' ) ), 400 );
		}

		wp_send_json_success(
			array(
				'message' => __( 'Destination duplicated. It was created disabled so it does not start publishing straight away.', 'wp-event-publisher' ),
				'state'   => $this->state(),
			)
		);
	}

	/**
	 * AJAX: sends a real test message to one destination.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_test_destination(): void {
		$this->verify();

		$destination = $this->destinations->find( Profile::sanitize_id( $this->request_string( 'id' ) ) );

		if ( null === $destination ) {
			wp_send_json_error( array( 'message' => __( 'That destination does not exist.', 'wp-event-publisher' ) ), 404 );
		}

		$publication = $this->sample_publication();

		if ( ! $publication instanceof Publication ) {
			wp_send_json_error( array( 'message' => __( 'There is no advertisement to test with. Publish one first.', 'wp-event-publisher' ) ), 404 );
		}

		$result = $this->publisher->deliver( $publication, $destination );

		if ( empty( $result['success'] ) ) {
			wp_send_json_error(
				array(
					'message' => (string) $result['message'],
					'body'    => mb_substr( wp_strip_all_tags( (string) $result['body'] ), 0, 500 ),
				),
				200
			);
		}

		wp_send_json_success(
			array(
				'message' => (string) $result['message'],
				'body'    => mb_substr( wp_strip_all_tags( (string) $result['body'] ), 0, 500 ),
			)
		);
	}

	/**
	 * AJAX: creates or updates a rule.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_save_rule(): void {
		$this->verify();

		$input = $this->request_array( 'rule' );
		$id    = Profile::sanitize_id( (string) ( $input['id'] ?? '' ) );
		$name  = sanitize_text_field( (string) ( $input['name'] ?? '' ) );

		if ( '' === $id ) {
			$id = $this->rules->unique_id( $name );
		}

		$existing = $this->rules->find( $id );

		$rule = new Rule(
			array(
				'id'         => $id,
				'name'       => '' !== $name ? $name : $id,
				'enabled'    => ! empty( $input['enabled'] ),
				'priority'   => isset( $input['priority'] ) ? (int) $input['priority'] : ( $existing instanceof Rule ? $existing->priority() : 10 ),
				'conditions' => $this->sanitize_conditions( (array) ( $input['conditions'] ?? array() ) ),
				'actions'    => $this->sanitize_actions( (array) ( $input['actions'] ?? array() ) ),
			)
		);

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verify() ran first.
		$post_type = isset( $_POST['post_type'] ) ? sanitize_key( wp_unslash( $_POST['post_type'] ) ) : '';

		$problems = $this->rules->validate(
			$rule,
			array(
				'profiles'     => array_keys( $this->profiles->all() ),
				'destinations' => array_keys( $this->destinations->all() ),
			),
			$post_type,
			$this->registry
		);

		foreach ( $problems as $problem ) {
			if ( 'error' === $problem['level'] ) {
				wp_send_json_error(
					array(
						'message'  => __( 'The rule was not saved.', 'wp-event-publisher' ),
						'problems' => $problems,
					),
					400
				);
			}
		}

		$this->rules->save( $rule );

		wp_send_json_success(
			array(
				'message'  => __( 'Rule saved.', 'wp-event-publisher' ),
				'id'       => $rule->id(),
				'problems' => $problems,
				'state'    => $this->state(),
			)
		);
	}

	/**
	 * AJAX: deletes a rule.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_delete_rule(): void {
		$this->verify();

		if ( ! $this->rules->delete( Profile::sanitize_id( $this->request_string( 'id' ) ) ) ) {
			wp_send_json_error( array( 'message' => __( 'That rule could not be deleted.', 'wp-event-publisher' ) ), 400 );
		}

		wp_send_json_success(
			array(
				'message' => __( 'Rule deleted.', 'wp-event-publisher' ),
				'state'   => $this->state(),
			)
		);
	}

	/**
	 * AJAX: re-orders the rules.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_reorder_rules(): void {
		$this->verify();

		// phpcs:ignore WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- verify() ran; each id is sanitized below.
		$order = isset( $_POST['order'] ) ? (array) wp_unslash( $_POST['order'] ) : array();

		$this->rules->reorder( array_map( array( Profile::class, 'sanitize_id' ), array_map( 'strval', $order ) ) );

		wp_send_json_success(
			array(
				'message' => __( 'Rule order saved.', 'wp-event-publisher' ),
				'state'   => $this->state(),
			)
		);
	}

	/**
	 * AJAX: runs the rules against one real advertisement and reports
	 * everything that would happen.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_test_rules(): void {
		$this->verify();

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verify() ran first.
		$post_id = isset( $_POST['post_id'] ) ? absint( wp_unslash( $_POST['post_id'] ) ) : 0;

		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			wp_send_json_error( array( 'message' => __( 'That advertisement does not exist.', 'wp-event-publisher' ) ), 404 );
		}

		if ( ! current_user_can( 'edit_post', $post->ID ) ) {
			wp_send_json_error( array( 'message' => __( 'You cannot read that advertisement.', 'wp-event-publisher' ) ), 403 );
		}

		try {
			$flat  = $this->normalizer->normalize( $post, Event::TYPE_UPDATED );
			$event = new Event( 'evt_test_' . $post->ID, Event::TYPE_UPDATED, (int) $post->ID );
			$plan  = $this->publisher->build( $event, $post, $this->contract->build( $event, $flat, gmdate( 'c' ) ) );
		} catch ( \Throwable $e ) {
			wp_send_json_error(
				array(
					'message' => sprintf(
						/* translators: %s: error message. */
						__( 'The test could not be completed: %s', 'wp-event-publisher' ),
						$e->getMessage()
					),
				),
				500
			);
		}

		$outcome     = $plan['outcome'];
		$publication = $plan['publication'];

		$destinations = array();

		foreach ( (array) $plan['destinations'] as $id => $destination ) {
			$destinations[] = array(
				'id'    => (string) $id,
				'name'  => (string) $destination['name'],
				'delay' => max( (int) $destination['delay'], $outcome->delay() ),
			);
		}

		wp_send_json_success(
			array(
				'post'         => array(
					'id'    => (int) $post->ID,
					'title' => get_the_title( $post ),
					'type'  => (string) $post->post_type,
				),
				'trace'        => $outcome->trace_entries(),
				'profile'      => array(
					'id'    => $plan['profile']->id(),
					'name'  => $plan['profile']->name(),
					'chain' => $this->profiles->chain( $plan['profile']->id() ),
				),
				'skipped'      => (bool) $plan['skipped'],
				'reason'       => (string) $plan['reason'],
				'destinations' => $destinations,
				'message'      => $publication instanceof Publication ? $publication->message() : '',
				'fields'       => $publication instanceof Publication ? array_keys( $publication->fields() ) : array(),
				'images'       => $publication instanceof Publication ? $publication->images() : array(),
				'payload'      => $publication instanceof Publication
					? wp_json_encode( $publication->payload(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES )
					: '',
			)
		);
	}

	/**
	 * AJAX: imports profiles or rules from a pasted JSON document.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function ajax_import(): void {
		$this->verify();

		$raw = $this->request_string( 'document' );

		if ( '' === trim( $raw ) ) {
			wp_send_json_error( array( 'message' => __( 'Paste an export file first.', 'wp-event-publisher' ) ), 400 );
		}

		$document = json_decode( $raw, true );

		if ( ! is_array( $document ) || JSON_ERROR_NONE !== json_last_error() ) {
			wp_send_json_error( array( 'message' => __( 'That is not valid JSON.', 'wp-event-publisher' ) ), 400 );
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verify() ran first.
		$overwrite = ! empty( $_POST['overwrite'] );

		$format = (string) ( $document['format'] ?? '' );

		if ( 'wpep-profiles' === $format ) {
			$result = $this->profiles->import( $document, $overwrite );

			$message = sprintf(
				/* translators: 1: imported count, 2: skipped count. */
				__( 'Imported %1$d profiles, skipped %2$d.', 'wp-event-publisher' ),
				(int) $result['imported'],
				(int) $result['skipped']
			);
		} elseif ( 'wpep-rules' === $format ) {
			$result = $this->rules->import( $document, $overwrite );

			$message = sprintf(
				/* translators: %d: imported count. */
				__( 'Imported %d rules.', 'wp-event-publisher' ),
				(int) $result['imported']
			);
		} else {
			wp_send_json_error( array( 'message' => __( 'That file is neither a profile export nor a rule export.', 'wp-event-publisher' ) ), 400 );
		}

		wp_send_json_success(
			array(
				'message' => $message,
				'errors'  => (array) ( $result['errors'] ?? array() ),
				'state'   => $this->state(),
			)
		);
	}

	/**
	 * Streams an export file.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function handle_export(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'You do not have permission to export.', 'wp-event-publisher' ), 403 );
		}

		check_admin_referer( self::NONCE );

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- checked immediately above.
		$what = isset( $_GET['what'] ) ? sanitize_key( wp_unslash( $_GET['what'] ) ) : 'profiles';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- checked immediately above.
		$id = isset( $_GET['id'] ) ? Profile::sanitize_id( sanitize_text_field( wp_unslash( $_GET['id'] ) ) ) : '';

		$document = 'rules' === $what ? $this->rules->export() : $this->profiles->export( $id );
		$filename = sprintf( 'wpep-%s-%s.json', 'rules' === $what ? 'rules' : 'profiles', gmdate( 'Ymd-His' ) );

		nocache_headers();
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="' . $filename . '"' );

		echo wp_json_encode( $document, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

		exit;
	}

	/* ------------------------------------------------------------------
	 * Input handling
	 * --------------------------------------------------------------- */

	/**
	 * Sanitizes a destination configuration against its provider's schema.
	 *
	 * A password field submitted unchanged as the marker keeps whatever is
	 * stored, so editing a destination never wipes a secret the browser was
	 * never shown.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed>      $input    Submitted configuration.
	 * @param DeliveryProvider         $provider Provider.
	 * @param array<string,mixed>|null $existing Stored destination.
	 *
	 * @return array<string,mixed> Sanitized configuration.
	 */
	private function sanitize_config( array $input, DeliveryProvider $provider, ?array $existing ): array {
		$stored = (array) ( $existing['config'] ?? array() );
		$clean  = array();

		foreach ( $provider->settings_schema() as $key => $setting ) {
			$type  = (string) ( $setting['type'] ?? 'text' );
			$value = $input[ $key ] ?? null;

			if ( 'password' === $type ) {
				$submitted = is_scalar( $value ) ? (string) $value : '';

				$clean[ $key ] = ( self::SECRET_MARKER === $submitted )
					? (string) ( $stored[ $key ] ?? '' )
					: $submitted;

				continue;
			}

			switch ( $type ) {
				case 'url':
					$clean[ $key ] = esc_url_raw( trim( (string) $value ) );
					break;

				case 'number':
					$clean[ $key ] = (int) $value;
					break;

				case 'checkbox':
					$clean[ $key ] = ! empty( $value );
					break;

				case 'select':
					$options       = array_keys( (array) ( $setting['options'] ?? array() ) );
					$candidate     = sanitize_key( (string) $value );
					$clean[ $key ] = in_array( $candidate, $options, true ) ? $candidate : (string) ( $setting['default'] ?? '' );
					break;

				case 'textarea':
					$clean[ $key ] = sanitize_textarea_field( (string) $value );
					break;

				default:
					$clean[ $key ] = sanitize_text_field( (string) $value );
			}
		}

		return $clean;
	}

	/**
	 * Sanitizes a submitted field mapping.
	 *
	 * @since 1.5.0
	 *
	 * @param array<int|string,mixed> $input Submitted mapping.
	 *
	 * @return array<string,array<string,mixed>> Sanitized mapping.
	 */
	private function sanitize_fields( array $input ): array {
		$clean = array();
		$order = 0;

		foreach ( $input as $key => $settings ) {
			if ( ! is_array( $settings ) ) {
				continue;
			}

			$key = Field::sanitize_key( (string) ( $settings['key'] ?? $key ) );

			if ( '' === $key || isset( $clean[ $key ] ) ) {
				continue;
			}

			$visibility = sanitize_key( (string) ( $settings['visibility'] ?? '' ) );
			$format     = sanitize_key( (string) ( $settings['format'] ?? '' ) );

			$clean[ $key ] = array(
				'enabled'    => ! empty( $settings['enabled'] ),
				'label'      => sanitize_text_field( (string) ( $settings['label'] ?? '' ) ),
				'visibility' => in_array( $visibility, Field::VISIBILITIES, true ) ? $visibility : Field::VISIBILITY_HIDDEN,
				'order'      => $order++,
				'format'     => in_array( $format, FieldResolver::FORMATS, true ) ? $format : FieldResolver::FORMAT_INLINE,
				'separator'  => mb_substr( sanitize_text_field( (string) ( $settings['separator'] ?? '، ' ) ), 0, 10 ),
			);
		}

		return $clean;
	}

	/**
	 * Sanitizes a submitted condition group, recursively.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $group Submitted group.
	 * @param int                 $depth Nesting depth.
	 *
	 * @return array<string,mixed> Sanitized group.
	 */
	private function sanitize_conditions( array $group, int $depth = 0 ): array {
		if ( $depth > 8 ) {
			return array( 'match' => Rule::MATCH_ALL, 'conditions' => array() );
		}

		$match = sanitize_key( (string) ( $group['match'] ?? Rule::MATCH_ALL ) );

		$clean = array();

		foreach ( (array) ( $group['conditions'] ?? array() ) as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}

			if ( isset( $entry['conditions'] ) || isset( $entry['match'] ) ) {
				$nested = $this->sanitize_conditions( $entry, $depth + 1 );

				if ( ! empty( $nested['conditions'] ) ) {
					$clean[] = $nested;
				}

				continue;
			}

			$subject  = sanitize_key( (string) ( $entry['subject'] ?? '' ) );
			$operator = sanitize_key( (string) ( $entry['operator'] ?? 'is' ) );

			if ( ! in_array( $subject, RuleEngine::SUBJECTS, true ) || ! in_array( $operator, RuleEngine::OPERATORS, true ) ) {
				continue;
			}

			$clean[] = array(
				'subject'  => $subject,
				'key'      => Field::sanitize_key( (string) ( $entry['key'] ?? '' ) ),
				'operator' => $operator,
				'value'    => mb_substr( sanitize_text_field( (string) ( $entry['value'] ?? '' ) ), 0, 500 ),
			);
		}

		return array(
			'match'      => in_array( $match, array( Rule::MATCH_ALL, Rule::MATCH_ANY ), true ) ? $match : Rule::MATCH_ALL,
			'conditions' => $clean,
		);
	}

	/**
	 * Sanitizes submitted rule actions.
	 *
	 * @since 1.5.0
	 *
	 * @param array<int,mixed> $input Submitted actions.
	 *
	 * @return array<int,array<string,mixed>> Sanitized actions.
	 */
	private function sanitize_actions( array $input ): array {
		$clean = array();

		foreach ( $input as $action ) {
			if ( ! is_array( $action ) ) {
				continue;
			}

			$type = sanitize_key( (string) ( $action['type'] ?? '' ) );

			if ( ! in_array( $type, Rule::ACTIONS, true ) ) {
				continue;
			}

			$value = (string) ( $action['value'] ?? '' );

			// A template action carries a whole template; everything else is
			// one line.
			$value = Rule::ACTION_TEMPLATE === $type
				? $this->sanitize_template( $value )
				: mb_substr( sanitize_textarea_field( $value ), 0, 1000 );

			$clean[] = array(
				'type'  => $type,
				'value' => $value,
			);
		}

		return $clean;
	}

	/**
	 * Sanitizes a message template.
	 *
	 * @since 1.5.0
	 *
	 * @param mixed $raw Submitted template.
	 *
	 * @return string Sanitized template.
	 */
	private function sanitize_template( mixed $raw ): string {
		if ( ! is_string( $raw ) ) {
			return '';
		}

		$clean = wp_strip_all_tags( $raw, false );
		$clean = str_replace( array( "\r\n", "\r" ), "\n", $clean );

		return mb_substr( trim( $clean ), 0, 4000 );
	}

	/**
	 * Builds a publication from a real advertisement, for destination
	 * tests.
	 *
	 * @since 1.5.0
	 *
	 * @return Publication|null Publication, null when the site has none.
	 */
	private function sample_publication(): ?Publication {
		foreach ( $this->settings->allowed_post_types() as $post_type ) {
			$post = $this->registry->sample_post( $post_type );

			if ( ! $post instanceof WP_Post ) {
				continue;
			}

			try {
				$event = new Event( 'evt_test_' . $post->ID, Event::TYPE_UPDATED, (int) $post->ID );
				$flat  = $this->normalizer->normalize( $post, Event::TYPE_UPDATED );
				$plan  = $this->publisher->build( $event, $post, $this->contract->build( $event, $flat, gmdate( 'c' ) ) );
			} catch ( \Throwable $e ) {
				continue;
			}

			if ( $plan['publication'] instanceof Publication ) {
				return $plan['publication'];
			}
		}

		return null;
	}

	/**
	 * Reads a scalar request value.
	 *
	 * @since 1.5.0
	 *
	 * @param string $key Request key.
	 *
	 * @return string Raw value, unslashed but not yet sanitized.
	 */
	private function request_string( string $key ): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- verify() ran; callers sanitize per use.
		return isset( $_POST[ $key ] ) ? (string) wp_unslash( $_POST[ $key ] ) : '';
	}

	/**
	 * Reads an array request value.
	 *
	 * @since 1.5.0
	 *
	 * @param string $key Request key.
	 *
	 * @return array<string,mixed> Raw array, unslashed but not yet sanitized.
	 */
	private function request_array( string $key ): array {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- verify() ran; every member is sanitized by the caller.
		$value = isset( $_POST[ $key ] ) ? wp_unslash( $_POST[ $key ] ) : array();

		return is_array( $value ) ? $value : array();
	}

	/**
	 * Verifies capability and nonce for every endpoint.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	private function verify(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => __( 'Insufficient permissions.', 'wp-event-publisher' ) ), 403 );
		}

		check_ajax_referer( self::NONCE, 'nonce' );
	}
}
