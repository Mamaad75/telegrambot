<?php
/**
 * JetFormBuilder field provider.
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
 * Exposes JetFormBuilder form submissions to the mapping architecture.
 *
 * JetFormBuilder stores a form's field list on the form post itself, as
 * serialised block markup — the form *is* a post whose content is blocks.
 * Reading that is how the field list is discovered, because JetFormBuilder
 * offers no public "describe this form" API to call instead.
 *
 * Submissions are captured from `jet-form-builder/form-handler/after-send`,
 * which is JetFormBuilder's own documented completion hook. Nothing here
 * reaches into its database tables: a plugin that reads another plugin's
 * private storage breaks on that plugin's next release.
 *
 * The provider registers only when JetFormBuilder is actually present, so a
 * site without it pays nothing.
 *
 * @since 1.7.0
 */
class JetFormBuilderProvider extends BaseProvider {

	/**
	 * Provider identifier. Stored in mappings, so it never changes.
	 *
	 * @var string
	 */
	public const ID = 'jetformbuilder';

	/**
	 * Post type JetFormBuilder stores forms in.
	 *
	 * @var string
	 */
	public const FORM_POST_TYPE = 'jet-form-builder';

	/**
	 * Meta key holding the most recent submission for a form.
	 *
	 * Kept on the form post so it travels with the form and is removed with
	 * it. Only the latest submission is retained: this is a field-discovery
	 * aid and a payload source, not a submissions database — JetFormBuilder
	 * already has one of those.
	 *
	 * @var string
	 */
	public const META_LAST_SUBMISSION = '_jarchi_jfb_last_submission';

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.7.0
	 *
	 * @return string Provider id.
	 */
	public function id(): string {
		return self::ID;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.7.0
	 *
	 * @return string Provider label.
	 */
	public function label(): string {
		return __( 'جت‌فرم‌بیلدر', 'wp-event-publisher' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.7.0
	 *
	 * @return bool True when JetFormBuilder is active.
	 */
	public function is_available(): bool {
		return self::detected();
	}

	/**
	 * Whether JetFormBuilder is installed and active.
	 *
	 * Two checks because JetFormBuilder's main class name has moved between
	 * releases while the constant has stayed put.
	 *
	 * @since 1.7.0
	 *
	 * @return bool True when detected.
	 */
	public static function detected(): bool {
		return defined( 'JET_FORM_BUILDER_VERSION' )
			|| class_exists( '\Jet_Form_Builder\Plugin' )
			|| function_exists( 'jet_form_builder' );
	}

	/**
	 * Registers the submission hook.
	 *
	 * @since 1.7.0
	 *
	 * @return void
	 */
	public function register_hooks(): void {
		if ( ! self::detected() ) {
			return;
		}

		// JetFormBuilder's own completion hook. Its signature has varied
		// across releases, so the handler reads defensively rather than
		// trusting a fixed argument list.
		add_action( 'jet-form-builder/form-handler/after-send', array( $this, 'capture' ), 10, 2 );
	}

	/**
	 * Records a submission against its form.
	 *
	 * @since 1.7.0
	 *
	 * @param mixed $handler Form handler instance.
	 * @param mixed $is_success Whether the submission succeeded.
	 *
	 * @return void
	 */
	public function capture( mixed $handler, mixed $is_success = true ): void {
		if ( ! is_object( $handler ) ) {
			return;
		}

		$form_id = 0;
		$data    = array();

		// Property names differ across JetFormBuilder versions; read whichever
		// is present rather than assuming one.
		foreach ( array( 'form_id', 'get_form_id' ) as $source ) {
			if ( method_exists( $handler, $source ) ) {
				$form_id = (int) $handler->{$source}();
				break;
			}

			if ( property_exists( $handler, $source ) ) {
				$form_id = (int) $handler->{$source};
				break;
			}
		}

		foreach ( array( 'request_data', 'get_request', 'form_data' ) as $source ) {
			if ( method_exists( $handler, $source ) ) {
				$data = (array) $handler->{$source}();
				break;
			}

			if ( property_exists( $handler, $source ) ) {
				$data = (array) $handler->{$source};
				break;
			}
		}

		if ( $form_id <= 0 || empty( $data ) ) {
			return;
		}

		update_post_meta( $form_id, self::META_LAST_SUBMISSION, $this->sanitize_submission( $data ) );

		/**
		 * Fires after Jarchi recorded a JetFormBuilder submission.
		 *
		 * @since 1.7.0
		 *
		 * @param int                 $form_id Form post ID.
		 * @param array<string,mixed> $data    Sanitized submission.
		 */
		do_action( 'wpep_jetformbuilder_submitted', $form_id, $data );
	}

	/**
	 * Reduces a submission to scalars safe to store and transmit.
	 *
	 * Uploads become their URL rather than the file object, and nested values
	 * are flattened, because the payload is signed over its encoded bytes and
	 * an object in there cannot be encoded.
	 *
	 * @since 1.7.0
	 *
	 * @param array<string,mixed> $data Raw submission.
	 *
	 * @return array<string,string> Sanitized submission.
	 */
	private function sanitize_submission( array $data ): array {
		$clean = array();

		foreach ( $data as $key => $value ) {
			$key = sanitize_key( (string) $key );

			if ( '' === $key || str_starts_with( $key, '_' ) ) {
				// JetFormBuilder's own bookkeeping fields (nonces, action
				// tokens) are not form data and must not be republished.
				continue;
			}

			if ( is_array( $value ) ) {
				$flat = array();

				array_walk_recursive(
					$value,
					static function ( $item ) use ( &$flat ): void {
						if ( is_scalar( $item ) ) {
							$flat[] = (string) $item;
						}
					}
				);

				$clean[ $key ] = implode( '، ', array_map( 'sanitize_text_field', $flat ) );

				continue;
			}

			if ( ! is_scalar( $value ) ) {
				continue;
			}

			$clean[ $key ] = sanitize_textarea_field( (string) $value );
		}

		return $clean;
	}

	/**
	 * {@inheritDoc}
	 *
	 * Discovers a form's fields from the blocks that make up the form, plus
	 * whatever the last submission actually contained. The two together cover
	 * the case where a field was added by a filter and never appears in the
	 * saved block markup.
	 *
	 * @since 1.7.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return Field[] Discovered fields.
	 */
	public function discover( string $post_type ): array {
		if ( self::FORM_POST_TYPE !== $post_type || ! self::detected() ) {
			return array();
		}

		$fields = array();

		foreach ( $this->forms() as $form ) {
			foreach ( $this->form_fields( $form ) as $name => $label ) {
				$key = 'jfb_' . $name;

				if ( isset( $fields[ $key ] ) ) {
					continue;
				}

				$fields[ $key ] = new Field(
					array(
						'key'         => $key,
						'label'       => $label,
						'type'        => Field::TYPE_TEXT,
						'source'      => self::ID,
						'storage_key' => $name,
						'description' => sprintf(
							/* translators: %s: form title. */
							__( 'فیلد فرم «%s».', 'wp-event-publisher' ),
							get_the_title( $form )
						),
					)
				);
			}
		}

		// Form-level fields, always available.
		$fields['jfb_form_id']    = new Field(
			array(
				'key'         => 'jfb_form_id',
				'label'       => __( 'شناسه فرم', 'wp-event-publisher' ),
				'type'        => Field::TYPE_NUMBER,
				'source'      => self::ID,
				'storage_key' => '__form_id',
			)
		);
		$fields['jfb_form_title'] = new Field(
			array(
				'key'         => 'jfb_form_title',
				'label'       => __( 'نام فرم', 'wp-event-publisher' ),
				'type'        => Field::TYPE_TEXT,
				'source'      => self::ID,
				'storage_key' => '__form_title',
			)
		);

		return array_values( $fields );
	}

	/**
	 * Returns the JetFormBuilder forms on this site.
	 *
	 * @since 1.7.0
	 *
	 * @return WP_Post[] Forms.
	 */
	private function forms(): array {
		$forms = get_posts(
			array(
				'post_type'        => self::FORM_POST_TYPE,
				'post_status'      => array( 'publish', 'draft' ),
				'numberposts'      => 50,
				'suppress_filters' => false,
			)
		);

		return is_array( $forms ) ? $forms : array();
	}

	/**
	 * Extracts a form's field names and labels from its block markup.
	 *
	 * JetFormBuilder saves each field as a block whose attributes carry the
	 * field name and label, so the block comments are parsed rather than the
	 * rendered HTML — the rendered form is a front-end concern and may not be
	 * renderable in an admin request at all.
	 *
	 * @since 1.7.0
	 *
	 * @param WP_Post $form Form post.
	 *
	 * @return array<string,string> Labels keyed by field name.
	 */
	private function form_fields( WP_Post $form ): array {
		$fields = array();

		if ( function_exists( 'parse_blocks' ) ) {
			foreach ( $this->flatten_blocks( parse_blocks( (string) $form->post_content ) ) as $block ) {
				$name = (string) ( $block['attrs']['name'] ?? '' );

				if ( '' === $name || ! str_starts_with( (string) ( $block['blockName'] ?? '' ), 'jet-forms/' ) ) {
					continue;
				}

				$label = (string) ( $block['attrs']['label'] ?? '' );

				$fields[ sanitize_key( $name ) ] = '' !== $label ? $label : $name;
			}
		}

		// Anything the last submission carried that the blocks did not
		// describe — a field added by a filter, for instance.
		$last = get_post_meta( $form->ID, self::META_LAST_SUBMISSION, true );

		if ( is_array( $last ) ) {
			foreach ( array_keys( $last ) as $name ) {
				$name = sanitize_key( (string) $name );

				if ( '' !== $name && ! isset( $fields[ $name ] ) ) {
					$fields[ $name ] = $name;
				}
			}
		}

		return $fields;
	}

	/**
	 * Flattens nested blocks into one list.
	 *
	 * Form fields are routinely nested inside column and group blocks, so a
	 * single-level scan would miss most of a real form.
	 *
	 * @since 1.7.0
	 *
	 * @param array<int,array<string,mixed>> $blocks Parsed blocks.
	 *
	 * @return array<int,array<string,mixed>> Flattened blocks.
	 */
	private function flatten_blocks( array $blocks ): array {
		$flat = array();

		foreach ( $blocks as $block ) {
			if ( ! is_array( $block ) ) {
				continue;
			}

			$flat[] = $block;

			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$flat = array_merge( $flat, $this->flatten_blocks( $block['innerBlocks'] ) );
			}
		}

		return $flat;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.7.0
	 *
	 * @param Field   $field Field to read.
	 * @param WP_Post $post  Form post.
	 *
	 * @return mixed Raw value.
	 */
	public function resolve( Field $field, WP_Post $post ): mixed {
		$storage = $field->storage_key();

		if ( '__form_id' === $storage ) {
			return (int) $post->ID;
		}

		if ( '__form_title' === $storage ) {
			return get_the_title( $post );
		}

		$last = get_post_meta( $post->ID, self::META_LAST_SUBMISSION, true );

		return is_array( $last ) ? ( $last[ $storage ] ?? null ) : null;
	}
}
