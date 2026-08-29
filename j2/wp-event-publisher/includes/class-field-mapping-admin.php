<?php
/**
 * Field Mapping admin screen.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;
use WP_Term;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The Field Mapping screen and its AJAX endpoints.
 *
 * Kept apart from {@see Admin} because it is a screen with its own state
 * machine — post type, category, subcategory, a field table and a template
 * — and folding that into the settings controller would make both harder
 * to follow.
 *
 * Every entry point checks the capability and a nonce, every stored value
 * is sanitized on the way in, and every displayed value is escaped on the
 * way out.
 *
 * @since 1.4.0
 */
class FieldMappingAdmin {

	/**
	 * Screen slug.
	 *
	 * @var string
	 */
	public const PAGE_SLUG = Admin::MENU_SLUG . '-fields';

	/**
	 * Nonce action for this screen's AJAX calls.
	 *
	 * @var string
	 */
	public const NONCE = 'wpep_fields';

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
	 * Mapping store.
	 *
	 * @var FieldMapping
	 */
	private FieldMapping $mapping;

	/**
	 * Message renderer.
	 *
	 * @var MessageTemplate
	 */
	private MessageTemplate $template;

	/**
	 * Settings service.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Profile repository, for favourites and the "NEW" marker.
	 *
	 * @var ProfileRepository|null
	 */
	private ?ProfileRepository $profiles = null;

	/**
	 * Option remembering which field keys a post type has already shown.
	 *
	 * A key that is not in here is new: a framework added it after the last
	 * time somebody looked at this screen. It is badged and left unticked,
	 * never enabled behind the administrator's back.
	 *
	 * @var string
	 */
	public const OPTION_SEEN = 'wpep_seen_fields';

	/**
	 * Constructor.
	 *
	 * @since 1.4.0
	 *
	 * @param FieldRegistry   $registry Field registry.
	 * @param FieldResolver   $resolver Field resolver.
	 * @param FieldMapping    $mapping  Mapping store.
	 * @param MessageTemplate $template Message renderer.
	 * @param Settings        $settings Settings service.
	 */
	public function __construct(
		FieldRegistry $registry,
		FieldResolver $resolver,
		FieldMapping $mapping,
		MessageTemplate $template,
		Settings $settings
	) {
		$this->registry = $registry;
		$this->resolver = $resolver;
		$this->mapping  = $mapping;
		$this->template = $template;
		$this->settings = $settings;
	}

	/**
	 * Gives the screen the profile repository.
	 *
	 * Optional so the screen keeps working on its own, which is what the
	 * 1.4.0 tests exercise.
	 *
	 * @since 1.5.0
	 *
	 * @param ProfileRepository $profiles Profile repository.
	 *
	 * @return void
	 */
	public function set_profiles( ProfileRepository $profiles ): void {
		$this->profiles = $profiles;
	}

	/**
	 * Returns the field keys this post type has shown before.
	 *
	 * @since 1.5.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return string[] Field keys.
	 */
	private function seen( string $post_type ): array {
		$seen = get_option( self::OPTION_SEEN, array() );

		return is_array( $seen ) && isset( $seen[ $post_type ] ) && is_array( $seen[ $post_type ] )
			? array_map( 'strval', $seen[ $post_type ] )
			: array();
	}

	/**
	 * Records the field keys currently discovered for a post type.
	 *
	 * @since 1.5.0
	 *
	 * @param string   $post_type Post type slug.
	 * @param string[] $keys      Field keys.
	 *
	 * @return void
	 */
	private function remember( string $post_type, array $keys ): void {
		$seen = get_option( self::OPTION_SEEN, array() );
		$seen = is_array( $seen ) ? $seen : array();

		$seen[ $post_type ] = array_values( array_unique( array_map( 'strval', $keys ) ) );

		update_option( self::OPTION_SEEN, $seen, false );
	}

	/**
	 * Returns the favourite field keys for a post type's profile.
	 *
	 * @since 1.5.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return string[] Field keys.
	 */
	private function favorites( string $post_type ): array {
		if ( ! $this->profiles instanceof ProfileRepository ) {
			return array();
		}

		$assigned = $this->profiles->assigned_for( $post_type );

		if ( '' === $assigned ) {
			return array();
		}

		return $this->profiles->resolve( $assigned )->favorites();
	}

	/**
	 * Registers the screen, its assets and its endpoints.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function register(): void {
		// Menu entry is registered centrally by Admin::register_menu().
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );

		add_action( 'wp_ajax_wpep_load_fields', array( $this, 'ajax_load_fields' ) );
		add_action( 'wp_ajax_wpep_save_mapping', array( $this, 'ajax_save_mapping' ) );
		add_action( 'wp_ajax_wpep_reset_mapping', array( $this, 'ajax_reset_mapping' ) );
		add_action( 'wp_ajax_wpep_preview_template', array( $this, 'ajax_preview_template' ) );
		add_action( 'wp_ajax_wpep_rescan_fields', array( $this, 'ajax_rescan_fields' ) );

		// A settings save can change which post types are watched, which
		// changes what there is to discover.
		add_action( 'update_option_' . Settings::OPTION, array( $this->registry, 'flush' ) );
	}

	/**
	 * Adds the submenu entry.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function register_menu(): void {
		// Navigation is centralized in Admin::register_menu().
	}

	/**
	 * Enqueues this screen's assets.
	 *
	 * @since 1.4.0
	 *
	 * @param string $hook_suffix Current admin page.
	 *
	 * @return void
	 */
	public function enqueue( string $hook_suffix ): void {
		// Hidden admin pages registered with add_submenu_page( null, ... ) do
		// not always receive a hook suffix containing the page slug. Relying on
		// the suffix made the field-mapping JS silently disappear on some WP
		// versions, leaving the screen stuck on "Loading fields…".
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( (string) $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( self::PAGE_SLUG !== $page && ! str_contains( $hook_suffix, self::PAGE_SLUG ) ) {
			return;
		}

		wp_enqueue_script(
			'wpep-fields',
			WPEP_PLUGIN_URL . 'admin/js/field-mapping.js',
			array( 'jquery', 'jquery-ui-sortable' ),
			WPEP_VERSION,
			true
		);

		// Only a nonce and UI strings reach the browser. No credential of
		// any kind is localized onto this page.
		wp_localize_script(
			'wpep-fields',
			'wpepFields',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( self::NONCE ),
				'i18n'    => array(
					'loading'    => __( 'Loading fields…', 'wp-event-publisher' ),
					'saving'     => __( 'Saving…', 'wp-event-publisher' ),
					'saved'      => __( 'Mapping saved.', 'wp-event-publisher' ),
					'resetting'  => __( 'Restoring inheritance…', 'wp-event-publisher' ),
					'reset'      => __( 'This category inherits from its parent again.', 'wp-event-publisher' ),
					'rescanning' => __( 'Rescanning fields…', 'wp-event-publisher' ),
					'previewing' => __( 'Rendering preview…', 'wp-event-publisher' ),
					'failed'     => __( 'The request failed.', 'wp-event-publisher' ),
					'noFields'   => __( 'No fields were discovered for this post type.', 'wp-event-publisher' ),
					'noSample'   => __( 'No advertisement of this type exists yet, so no sample values can be shown.', 'wp-event-publisher' ),
					'confirm'    => __( 'Discard this category’s own mapping and inherit from its parent again?', 'wp-event-publisher' ),
					'copied'     => __( 'Placeholder copied.', 'wp-event-publisher' ),
					'scopeOwn'   => __( 'has its own mapping', 'wp-event-publisher' ),
					'scopeInherits' => __( 'inherits from', 'wp-event-publisher' ),
					'badgeNew'   => __( 'NEW', 'wp-event-publisher' ),
					'newFields'  => __( 'New fields appeared since you last looked. They are badged and left switched off.', 'wp-event-publisher' ),
					'favorite'   => __( 'Pin this field to the top', 'wp-event-publisher' ),
					'selectAll'  => __( 'Select all', 'wp-event-publisher' ),
					'selectNone' => __( 'Select none', 'wp-event-publisher' ),
					// Plain-language descriptions of what a field type means for
					// the published message, keyed by the provider's type name.
					'typeHints'      => array(
						'text'     => __( 'یک متن کوتاه.', 'wp-event-publisher' ),
						'textarea' => __( 'یک متن بلند.', 'wp-event-publisher' ),
						'number'   => __( 'یک عدد.', 'wp-event-publisher' ),
						'url'      => __( 'یک نشانی اینترنتی.', 'wp-event-publisher' ),
						'date'     => __( 'یک تاریخ.', 'wp-event-publisher' ),
						'select'   => __( 'یکی از چند گزینه مشخص.', 'wp-event-publisher' ),
						'checkbox' => __( 'یک یا چند گزینه.', 'wp-event-publisher' ),
						'gallery'  => __( 'چند تصویر.', 'wp-event-publisher' ),
						'image'    => __( 'یک تصویر.', 'wp-event-publisher' ),
						'repeater' => __( 'چند ردیف تکرارشونده.', 'wp-event-publisher' ),
						'taxonomy' => __( 'دسته‌بندی محتوا.', 'wp-event-publisher' ),
						'user'     => __( 'یک کاربر.', 'wp-event-publisher' ),
						'html'     => __( 'محتوای قالب‌بندی‌شده.', 'wp-event-publisher' ),
					),
					'removeLine'     => __( 'حذف این خط', 'wp-event-publisher' ),
					'customTemplate' => __( 'این قالب دستی نوشته شده و در سازنده نمایش داده نمی‌شود. برای ویرایش آن از «ویرایش پیشرفته» استفاده کنید.', 'wp-event-publisher' ),
					// Three distinct outcomes, three distinct messages: nothing
					// exists, the request failed, or nothing is switched on.
					'noFieldsTitle'  => __( 'فیلدی پیدا نشد.', 'wp-event-publisher' ),
					'noFieldsBody'   => __( 'برای این نوع محتوا هیچ فیلدی شناسایی نشد. اگر به‌تازگی افزونه‌ای مثل ACF یا ووکامرس اضافه کرده‌اید، «بررسی دوباره فیلدها» را بزنید.', 'wp-event-publisher' ),
					'loadFailedTitle' => __( 'دریافت فیلدها با مشکل مواجه شد.', 'wp-event-publisher' ),
					'loadFailedBody' => __( 'ارتباط با سرور برقرار نشد. این به معنی نبودن فیلد نیست — دوباره تلاش کنید.', 'wp-event-publisher' ),
					'retry'          => __( 'تلاش دوباره', 'wp-event-publisher' ),
					'emptyTitle'     => __( 'هنوز هیچ اطلاعاتی برای انتشار انتخاب نشده است.', 'wp-event-publisher' ),
					'emptyBody'      => __( 'هر کارت را که می‌خواهید منتشر شود روشن کنید و مشخص کنید در کدام پلتفرم‌ها دیده شود. بعد تغییرات را ذخیره کنید.', 'wp-event-publisher' ),
					'nothingEnabled' => __( 'هیچ فیلدی برای انتشار روشن نیست. تا وقتی دست‌کم یک فیلد روشن نباشد و روی یکی از پلتفرم‌ها نمایش داده نشود، پیام‌ها خالی فرستاده می‌شوند.', 'wp-event-publisher' ),
					'collapse'   => __( 'Collapse or expand this group', 'wp-event-publisher' ),
				),
			)
		);
	}

	/**
	 * Renders the screen.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function render(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'wp-event-publisher' ), 403 );
		}

		$post_types = $this->post_types();
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only screen state, capability checked above.
		$requested  = isset( $_GET['post_type'] ) ? sanitize_key( wp_unslash( $_GET['post_type'] ) ) : '';
		$current    = isset( $post_types[ $requested ] ) ? $requested : (string) array_key_first( $post_types );

		$initial_taxonomy = '' === (string) $current ? '' : $this->mapping->primary_taxonomy( (string) $current );
		$initial_state = '' !== (string) $current ? $this->build_state( (string) $current, $initial_taxonomy, 0, false ) : array();

		$data = array(
			'post_types'       => $post_types,
			'post_type'        => (string) $current,
			'taxonomy'         => $initial_taxonomy,
			'providers'        => $this->registry->providers(),
			'formats'          => $this->formats(),
			'platform_labels'  => $this->platform_labels(),
			'initial_state'    => $initial_state,
			'page'             => self::PAGE_SLUG,
		);

		$file = WPEP_PLUGIN_DIR . 'admin/views/field-mapping.php';

		if ( ! is_readable( $file ) ) {
			return;
		}

		wpep()->admin()->render_inner_shell_start();

		// phpcs:ignore WordPress.PHP.DontExtract.extract_extract -- scoped view variables, keys are fixed above.
		extract( $data, EXTR_SKIP );

		require $file;

		wpep()->admin()->render_inner_shell_end();
	}

	/**
	 * AJAX: returns the discovered fields and the effective mapping for a
	 * scope.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function ajax_load_fields(): void {
		$this->verify();

		$post_type = $this->request_post_type();
		$taxonomy  = $this->request_taxonomy( $post_type );
		$term_id   = $this->request_term_id( $taxonomy );

		if ( '' === $post_type ) {
			wp_send_json_error( array( 'message' => __( 'Select a post type first.', 'wp-event-publisher' ) ), 400 );
		}

		$fresh = ! empty( $_POST['fresh'] );

		wp_send_json_success( $this->build_state( $post_type, $taxonomy, $term_id, $fresh ) );
	}

	/**
	 * AJAX: rebuilds the discovery cache and returns the fresh state.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function ajax_rescan_fields(): void {
		$this->verify();

		$this->registry->flush();

		$post_type = $this->request_post_type();
		$taxonomy  = $this->request_taxonomy( $post_type );
		$term_id   = $this->request_term_id( $taxonomy );

		if ( '' === $post_type ) {
			wp_send_json_error( array( 'message' => __( 'Select a post type first.', 'wp-event-publisher' ) ), 400 );
		}

		wp_send_json_success( $this->build_state( $post_type, $taxonomy, $term_id, true ) );
	}

	/**
	 * AJAX: stores a scope's mapping and template.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function ajax_save_mapping(): void {
		$this->verify();

		$post_type = $this->request_post_type();
		$taxonomy  = $this->request_taxonomy( $post_type );
		$term_id   = $this->request_term_id( $taxonomy );

		if ( '' === $post_type ) {
			wp_send_json_error( array( 'message' => __( 'Select a post type first.', 'wp-event-publisher' ) ), 400 );
		}

		$discovered = $this->registry->discover( $post_type );

		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- each member is sanitized in sanitize_rows().
		$raw    = isset( $_POST['fields'] ) ? wp_unslash( $_POST['fields'] ) : array();
		$fields = $this->sanitize_rows( is_array( $raw ) ? $raw : array(), $discovered );

		$template = isset( $_POST['template'] )
			? $this->sanitize_template( wp_unslash( $_POST['template'] ) ) // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitize_template() handles it.
			: '';

		$scope = FieldMapping::scope( $post_type, $taxonomy, $term_id );

		$this->mapping->save( $scope, $fields, $template );

		$this->store_favorites( $post_type );

		wp_send_json_success(
			array(
				'message' => __( 'Mapping saved.', 'wp-event-publisher' ),
				'scope'   => $scope,
				'state'   => $this->build_state( $post_type, $taxonomy, $term_id, false ),
			)
		);
	}

	/**
	 * AJAX: discards a scope's own mapping so it inherits again.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function ajax_reset_mapping(): void {
		$this->verify();

		$post_type = $this->request_post_type();
		$taxonomy  = $this->request_taxonomy( $post_type );
		$term_id   = $this->request_term_id( $taxonomy );

		if ( '' === $post_type ) {
			wp_send_json_error( array( 'message' => __( 'Select a post type first.', 'wp-event-publisher' ) ), 400 );
		}

		$this->mapping->reset( FieldMapping::scope( $post_type, $taxonomy, $term_id ) );

		wp_send_json_success(
			array(
				'message' => __( 'This scope inherits from its parent again.', 'wp-event-publisher' ),
				'state'   => $this->build_state( $post_type, $taxonomy, $term_id, false ),
			)
		);
	}

	/**
	 * AJAX: renders a template against a real advertisement.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function ajax_preview_template(): void {
		$this->verify();

		$post_type = $this->request_post_type();
		$taxonomy  = $this->request_taxonomy( $post_type );
		$term_id   = $this->request_term_id( $taxonomy );

		$template = isset( $_POST['template'] )
			? $this->sanitize_template( wp_unslash( $_POST['template'] ) ) // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitize_template() handles it.
			: '';

		$post = $this->preview_post( $post_type, $taxonomy, $term_id );

		if ( ! $post instanceof WP_Post ) {
			wp_send_json_error(
				array( 'message' => __( 'There is no advertisement of this type to preview with. Publish one first.', 'wp-event-publisher' ) ),
				404
			);
		}

		// The preview renders the unsaved template against the saved
		// mapping, so what is shown is what would be sent.
		$mapping = $this->mapping->resolve( $post_type, $taxonomy, $term_id );
		$values  = $this->template->values( $post, $mapping );

		$message = '' === trim( $template )
			? $this->template->render( $post )
			: $this->template->apply( $template, $values );

		wp_send_json_success(
			array(
				'message' => $message,
				'post_id' => (int) $post->ID,
				'title'   => get_the_title( $post ),
			)
		);
	}

	/**
	 * Builds the complete state the browser needs for one scope.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $taxonomy  Taxonomy name.
	 * @param int    $term_id   Term ID.
	 * @param bool   $fresh     Bypass the discovery cache.
	 *
	 * @return array<string,mixed> Screen state.
	 */
	private function build_state( string $post_type, string $taxonomy, int $term_id, bool $fresh ): array {
		$grouped = $this->registry->grouped( $post_type, $fresh );
		$mapping = $this->mapping->resolve( $post_type, $taxonomy, $term_id );
		$scope   = FieldMapping::scope( $post_type, $taxonomy, $term_id );
		$sample  = $this->preview_post( $post_type, $taxonomy, $term_id );

		$discovered = array_keys( $this->registry->discover( $post_type ) );
		$seen       = $this->seen( $post_type );
		$favorites  = $this->favorites( $post_type );

		// The first time a post type is opened, nothing is "new" — every
		// field is simply what this site has. New means "appeared since".
		$fresh_keys = empty( $seen ) ? array() : array_values( array_diff( $discovered, $seen ) );

		$groups = array();

		foreach ( $grouped as $source => $group ) {
			$rows = array();

			foreach ( $group['fields'] as $key => $field ) {
				$settings = $mapping[ $key ] ?? array();

				$rows[] = array(
					'key'        => $key,
					'label'      => (string) ( $settings['label'] ?? '' ) !== '' ? (string) $settings['label'] : $field->label(),
					'default'    => $field->label(),
					'storage'    => $field->storage_key(),
					'type'       => $field->type(),
					'source'     => $field->source(),
					'repeatable' => $field->is_repeatable(),
					'required'   => $field->is_required(),
					'choices'    => count( $field->choices() ),
					'sample'     => $this->registry->sample( $field, $sample, $this->resolver ),
					'enabled'    => ! empty( $settings['enabled'] ),
					'visibility' => (string) ( $settings['visibility'] ?? Field::VISIBILITY_HIDDEN ),
					'order'      => (int) ( $settings['order'] ?? 9999 ),
					'format'     => (string) ( $settings['format'] ?? FieldResolver::FORMAT_INLINE ),
					'separator'  => (string) ( $settings['separator'] ?? '، ' ),
					'icon'       => (string) ( $settings['icon'] ?? '' ),
					'prefix'     => (string) ( $settings['prefix'] ?? '' ),
					'suffix'     => (string) ( $settings['suffix'] ?? '' ),
					'platforms'  => $this->platform_flags( (array) $settings ),
					'description' => $field->description(),
					'inherited'  => (string) ( $settings['inherited_from'] ?? '' ),
					'is_new'     => in_array( $key, $fresh_keys, true ),
					'favorite'   => in_array( $key, $favorites, true ),
				);
			}

			$groups[] = array(
				'id'     => (string) $source,
				'label'  => (string) $group['label'],
				'fields' => $rows,
			);
		}

		$this->remember( $post_type, $discovered );

		return array(
			'scope'        => $scope,
			'post_type'    => $post_type,
			'new_fields'   => $fresh_keys,
			'favorites'    => $favorites,
			'taxonomy'     => $taxonomy,
			'term_id'      => $term_id,
			'has_own'      => $this->mapping->has_own( $scope ),
			'inherits'     => array_values( array_slice( $this->mapping->chain( $post_type, $taxonomy, $term_id ), 1 ) ),
			'groups'       => $groups,
			'order'        => array_keys( $mapping ),
			'template'     => $this->mapping->template( $post_type, $taxonomy, $term_id ),
			'own_template' => (string) ( $this->mapping->own( $scope )['template'] ?? '' ),
			'placeholders' => $this->template->placeholders( $post_type, $taxonomy, $term_id ),
			'terms'        => $this->term_tree( $post_type, $taxonomy ),
			'sample_id'    => $sample instanceof WP_Post ? (int) $sample->ID : 0,
			'sample_title' => $sample instanceof WP_Post ? get_the_title( $sample ) : '',
		);
	}

	/**
	 * Builds the category tree for the selectors.
	 *
	 * Two levels are offered, which is what "Category" and "Subcategory"
	 * mean on the screen; deeper terms inherit from whichever of those two
	 * is their ancestor.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $taxonomy  Taxonomy name.
	 *
	 * @return array<int,array<string,mixed>> Term rows.
	 */
	private function term_tree( string $post_type, string $taxonomy ): array {
		if ( '' === $taxonomy || ! taxonomy_exists( $taxonomy ) ) {
			return array();
		}

		$terms = get_terms(
			array(
				'taxonomy'   => $taxonomy,
				'hide_empty' => false,
				'number'     => 500,
				'orderby'    => 'name',
			)
		);

		if ( is_wp_error( $terms ) || ! is_array( $terms ) ) {
			return array();
		}

		$rows = array();

		foreach ( $terms as $term ) {
			if ( ! $term instanceof WP_Term ) {
				continue;
			}

			$scope = FieldMapping::scope( $post_type, $taxonomy, (int) $term->term_id );

			$rows[] = array(
				'id'      => (int) $term->term_id,
				'name'    => (string) $term->name,
				'parent'  => (int) $term->parent,
				'depth'   => count( get_ancestors( (int) $term->term_id, $taxonomy, 'taxonomy' ) ),
				'has_own' => $this->mapping->has_own( $scope ),
			);
		}

		return $rows;
	}

	/**
	 * Finds a post to draw sample values and previews from.
	 *
	 * Prefers one that actually belongs to the selected category, so the
	 * preview of the "SUV" template is an SUV.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $taxonomy  Taxonomy name.
	 * @param int    $term_id   Term ID.
	 *
	 * @return WP_Post|null Sample post.
	 */
	private function preview_post( string $post_type, string $taxonomy, int $term_id ): ?WP_Post {
		if ( '' !== $taxonomy && $term_id > 0 ) {
			$posts = get_posts(
				array(
					'post_type'      => $post_type,
					'post_status'    => array( 'publish', 'draft', 'pending', 'private' ),
					'posts_per_page' => 1,
					'no_found_rows'  => true,
					'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- admin screen, one row.
						array(
							'taxonomy'         => $taxonomy,
							'field'            => 'term_id',
							'terms'            => $term_id,
							'include_children' => true,
						),
					),
				)
			);

			if ( is_array( $posts ) && isset( $posts[0] ) && $posts[0] instanceof WP_Post ) {
				return $posts[0];
			}
		}

		return $this->registry->sample_post( $post_type );
	}

	/**
	 * Sanitizes the submitted field rows.
	 *
	 * A key that is not a discovered field of this post type is discarded,
	 * so a crafted request cannot store a mapping for something that does
	 * not exist.
	 *
	 * @since 1.4.0
	 *
	 * @param array<int|string,mixed> $rows       Submitted rows.
	 * @param array<string,Field>     $discovered Discovered fields.
	 *
	 * @return array<string,array<string,mixed>> Sanitized settings keyed by field key.
	 */
	private function sanitize_rows( array $rows, array $discovered ): array {
		$clean = array();

		foreach ( $rows as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}

			$key = Field::sanitize_key( (string) ( $row['key'] ?? '' ) );

			if ( '' === $key || ! isset( $discovered[ $key ] ) || isset( $clean[ $key ] ) ) {
				continue;
			}

			$visibility = sanitize_key( (string) ( $row['visibility'] ?? '' ) );
			$format     = sanitize_key( (string) ( $row['format'] ?? '' ) );

			$clean[ $key ] = array(
				'enabled'    => ! empty( $row['enabled'] ) && 'false' !== $row['enabled'] && '0' !== (string) $row['enabled'],
				'label'      => sanitize_text_field( (string) ( $row['label'] ?? '' ) ),
				'visibility' => in_array( $visibility, Field::VISIBILITIES, true ) ? $visibility : Field::VISIBILITY_HIDDEN,
				'format'     => in_array( $format, FieldResolver::FORMATS, true ) ? $format : FieldResolver::FORMAT_INLINE,
				'separator'  => mb_substr( sanitize_text_field( (string) ( $row['separator'] ?? '، ' ) ), 0, 10 ),
				'icon'       => mb_substr( sanitize_text_field( (string) ( $row['icon'] ?? '' ) ), 0, 8 ),
				'prefix'     => mb_substr( sanitize_text_field( (string) ( $row['prefix'] ?? '' ) ), 0, 30 ),
				'suffix'     => mb_substr( sanitize_text_field( (string) ( $row['suffix'] ?? '' ) ), 0, 30 ),
				'platforms'  => $this->sanitize_platform_flags( $row['platforms'] ?? array() ),
			);
		}

		return $clean;
	}

	/**
	 * Returns the display name of each platform, in display order.
	 *
	 * @since 1.6.0
	 *
	 * @return array<string,string> Labels keyed by platform.
	 */
	private function platform_labels(): array {
		return array(
			Field::PLATFORM_TELEGRAM => __( 'تلگرام', 'wp-event-publisher' ),
			Field::PLATFORM_BALE     => __( 'بله', 'wp-event-publisher' ),
			Field::PLATFORM_WHATSAPP => __( 'واتس‌اپ', 'wp-event-publisher' ),
		);
	}

	/**
	 * Returns a mapping entry's per-platform visibility, always complete.
	 *
	 * A mapping saved before 1.6.0 has no `platforms` key. Those fields were
	 * going to Telegram, the only platform there was, so that is what they
	 * resolve to — reading the missing key as "everywhere" would switch an
	 * upgraded site's fields on for Bale and WhatsApp without anyone asking.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed> $settings Mapping entry.
	 *
	 * @return array<string,bool> Visibility keyed by platform.
	 */
	private function platform_flags( array $settings ): array {
		$stored = isset( $settings['platforms'] ) && is_array( $settings['platforms'] ) ? $settings['platforms'] : null;
		$flags  = array();

		foreach ( Field::PLATFORMS as $platform ) {
			if ( null === $stored ) {
				$flags[ $platform ] = Field::PLATFORM_TELEGRAM === $platform
					&& Field::VISIBILITY_TELEGRAM === (string) ( $settings['visibility'] ?? '' );

				continue;
			}

			$flags[ $platform ] = ! empty( $stored[ $platform ] );
		}

		return $flags;
	}

	/**
	 * Sanitizes submitted per-platform visibility.
	 *
	 * Built from the known platform list rather than from the submitted keys,
	 * so a crafted form cannot introduce a platform the plugin does not have.
	 *
	 * @since 1.6.0
	 *
	 * @param mixed $raw Submitted value.
	 *
	 * @return array<string,bool> Visibility keyed by platform.
	 */
	private function sanitize_platform_flags( mixed $raw ): array {
		$input = is_array( $raw ) ? $raw : array();
		$flags = array();

		foreach ( Field::PLATFORMS as $platform ) {
			$value              = $input[ $platform ] ?? false;
			$flags[ $platform ] = ! empty( $value ) && 'false' !== $value && '0' !== (string) $value;
		}

		return $flags;
	}

	/**
	 * Stores the submitted favourites on the profile assigned to this
	 * post type.
	 *
	 * Favourites are a per-profile preference, so a site with no profile
	 * assigned simply has none — the screen still works, the stars just do
	 * not survive a reload.
	 *
	 * @since 1.5.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return void
	 */
	private function store_favorites( string $post_type ): void {
		if ( ! $this->profiles instanceof ProfileRepository ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verify() ran first.
		if ( ! isset( $_POST['favorites'] ) ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- each key is sanitized below.
		$raw = (array) wp_unslash( $_POST['favorites'] );

		$keys       = array_values( array_filter( array_map( array( Field::class, 'sanitize_key' ), array_map( 'strval', $raw ) ) ) );
		$discovered = $this->registry->discover( $post_type );

		$keys = array_values(
			array_filter(
				$keys,
				static fn( string $key ): bool => isset( $discovered[ $key ] )
			)
		);

		$assigned = $this->profiles->assigned_for( $post_type );

		if ( '' === $assigned ) {
			return;
		}

		$profile = $this->profiles->find( $assigned );

		if ( $profile instanceof Profile ) {
			$this->profiles->save( $profile->with( array( 'favorites' => $keys ) ) );
		}
	}

	/**
	 * Sanitizes a message template.
	 *
	 * A template is plain text with placeholders. Tags are stripped, so a
	 * template can never inject markup into an admin preview, and the
	 * length is bounded well under the Telegram message limit.
	 *
	 * @since 1.4.0
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
	 * Returns the post types offered on this screen.
	 *
	 * @since 1.4.0
	 *
	 * @return array<string,string> Slug to label.
	 */
	private function post_types(): array {
		$watched = $this->settings->allowed_post_types();
		$offered = array();

		foreach ( $watched as $slug ) {
			$object = get_post_type_object( $slug );

			$offered[ $slug ] = $object ? (string) ( $object->labels->singular_name ?? $slug ) : $slug;
		}

		if ( empty( $offered ) ) {
			// Nothing is watched yet; still let the administrator explore.
			foreach ( get_post_types( array( 'show_ui' => true ), 'objects' ) as $object ) {
				if ( in_array( $object->name, Settings::EXCLUDED_POST_TYPES, true ) ) {
					continue;
				}

				$offered[ (string) $object->name ] = (string) ( $object->labels->singular_name ?? $object->name );
			}
		}

		return $offered;
	}

	/**
	 * Returns the list format choices.
	 *
	 * @since 1.4.0
	 *
	 * @return array<string,string> Format to label.
	 */
	private function formats(): array {
		return array(
			FieldResolver::FORMAT_INLINE   => __( 'Separated by a separator', 'wp-event-publisher' ),
			FieldResolver::FORMAT_BULLETS  => __( 'Bullet list', 'wp-event-publisher' ),
			FieldResolver::FORMAT_NUMBERED => __( 'Numbered list', 'wp-event-publisher' ),
			FieldResolver::FORMAT_LINES    => __( 'One per line', 'wp-event-publisher' ),
		);
	}

	/**
	 * Reads and validates the requested post type.
	 *
	 * @since 1.4.0
	 *
	 * @return string Post type slug, empty when invalid.
	 */
	private function request_post_type(): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verify() ran first.
		$requested = isset( $_POST['post_type'] ) ? sanitize_key( wp_unslash( $_POST['post_type'] ) ) : '';

		return isset( $this->post_types()[ $requested ] ) ? $requested : '';
	}

	/**
	 * Reads and validates the requested taxonomy.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return string Taxonomy name, empty when invalid.
	 */
	private function request_taxonomy( string $post_type ): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verify() ran first.
		$requested = isset( $_POST['taxonomy'] ) ? sanitize_key( wp_unslash( $_POST['taxonomy'] ) ) : '';

		if ( '' === $requested || '' === $post_type ) {
			return '';
		}

		return in_array( $requested, get_object_taxonomies( $post_type ), true ) ? $requested : '';
	}

	/**
	 * Reads and validates the requested term.
	 *
	 * @since 1.4.0
	 *
	 * @param string $taxonomy Taxonomy name.
	 *
	 * @return int Term ID, 0 when invalid.
	 */
	private function request_term_id( string $taxonomy ): int {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verify() ran first.
		$requested = isset( $_POST['term_id'] ) ? absint( wp_unslash( $_POST['term_id'] ) ) : 0;

		if ( $requested <= 0 || '' === $taxonomy ) {
			return 0;
		}

		$term = get_term( $requested, $taxonomy );

		return $term instanceof WP_Term ? (int) $term->term_id : 0;
	}

	/**
	 * Verifies capability and nonce for every AJAX entry point.
	 *
	 * @since 1.4.0
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
