<?php
/**
 * Message template rendering.
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
 * Renders the Telegram message from a template an administrator wrote.
 *
 * The language is deliberately tiny — placeholders and one conditional —
 * because a template is content, not code. It is written in the admin, it
 * is stored in an option, and it is rendered in a background request; a
 * template must therefore never be able to run anything.
 *
 *     🚗 {{title}}
 *     {{#if price}}💰 Price: {{price}}{{/if}}
 *     {{#if tax_product_cat_path}}📂 {{tax_product_cat_path}}{{/if}}
 *     📞 {{phone}}
 *     🔗 {{permalink}}
 *
 * Rules:
 *
 * - `{{field}}` prints a field, or nothing when it is empty.
 * - `{{#if field}}…{{/if}}` keeps its block only when the field has a
 *   value. `{{#unless field}}…{{/unless}}` is its inverse.
 * - A line left empty because every placeholder on it was empty is
 *   removed, so an advertisement without a price has no blank line where
 *   the price would have been.
 * - Anything that is not a placeholder is literal text, emoji included.
 *
 * There is no loop construct, no expression evaluation and no function
 * call. A repeater prints through its configured list format instead.
 *
 * @since 1.4.0
 */
class MessageTemplate {

	/**
	 * Matches a conditional block.
	 *
	 * @var string
	 */
	private const CONDITIONAL = '/\{\{#(if|unless)\s+([a-z0-9_]+)\s*\}\}(.*?)\{\{\/\1\}\}/su';

	/**
	 * Matches a placeholder.
	 *
	 * @var string
	 */
	private const PLACEHOLDER = '/\{\{\s*([a-z0-9_]+)\s*\}\}/u';

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
	 * Constructor.
	 *
	 * @since 1.4.0
	 *
	 * @param FieldRegistry $registry Field registry.
	 * @param FieldResolver $resolver Field resolver.
	 * @param FieldMapping  $mapping  Mapping store.
	 */
	public function __construct( FieldRegistry $registry, FieldResolver $resolver, FieldMapping $mapping ) {
		$this->registry = $registry;
		$this->resolver = $resolver;
		$this->mapping  = $mapping;
	}

	/**
	 * Renders the message for a post.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Post $post Post to render.
	 *
	 * @return string Rendered message, empty when nothing is visible.
	 */
	public function render( WP_Post $post ): string {
		$resolution = $this->mapping->for_post( $post );
		$term       = $resolution['term'];

		$template = $this->mapping->template(
			$post->post_type,
			(string) $resolution['taxonomy'],
			$term instanceof \WP_Term ? (int) $term->term_id : 0
		);

		$values = $this->values( $post, $resolution['mapping'] );

		$message = '' === $template
			? $this->automatic( $post, $resolution['mapping'], $values )
			: $this->apply( $template, $values );

		/**
		 * Filters the rendered Telegram message.
		 *
		 * @since 1.4.0
		 *
		 * @param string              $message Rendered message.
		 * @param WP_Post             $post    Source post.
		 * @param array<string,string> $values Field values used to render it.
		 */
		return (string) apply_filters( 'wpep_message', $this->tidy( $message ), $post, $values );
	}

	/**
	 * Renders a template against a supplied value map.
	 *
	 * Used by the admin preview, which renders a template that has not been
	 * saved yet.
	 *
	 * @since 1.4.0
	 *
	 * @param string               $template Template source.
	 * @param array<string,string> $values   Field key to rendered text.
	 *
	 * @return string Rendered message.
	 */
	public function apply( string $template, array $values ): string {
		// Conditionals first, so a placeholder inside a removed block is
		// never evaluated. Nesting is handled by repeating until stable.
		$previous = null;
		$guard    = 0;

		while ( $template !== $previous && $guard < 10 ) {
			$previous = $template;
			++$guard;

			$template = (string) preg_replace_callback(
				self::CONDITIONAL,
				static function ( array $matches ) use ( $values ): string {
					$negate = 'unless' === $matches[1];
					$filled = '' !== trim( (string) ( $values[ $matches[2] ] ?? '' ) );

					return ( $negate xor $filled ) ? $matches[3] : '';
				},
				$template
			);
		}

		return (string) preg_replace_callback(
			self::PLACEHOLDER,
			static fn( array $matches ): string => (string) ( $values[ $matches[1] ] ?? '' ),
			$template
		);
	}

	/**
	 * Builds the value map for a post under a mapping.
	 *
	 * Only fields marked visible in Telegram are readable from a template.
	 * A backend-only field is not a secret, but it is not something an
	 * administrator asked to publish either, so it resolves to empty rather
	 * than leaking into a message by accident.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Post                           $post    Post object.
	 * @param array<string,array<string,mixed>> $mapping Effective mapping.
	 *
	 * @return array<string,string> Field key to rendered text.
	 */
	public function values( WP_Post $post, array $mapping ): array {
		$fields = $this->registry->discover( $post->post_type );
		$values = array();

		foreach ( $mapping as $key => $settings ) {
			if ( empty( $settings['enabled'] ) || Field::VISIBILITY_TELEGRAM !== ( $settings['visibility'] ?? '' ) ) {
				continue;
			}

			$field = $fields[ $key ] ?? null;

			if ( ! $field instanceof Field ) {
				continue;
			}

			$values[ $key ] = $this->resolver->text(
				$field,
				$post,
				array(
					'format'    => (string) ( $settings['format'] ?? FieldResolver::FORMAT_INLINE ),
					'separator' => (string) ( $settings['separator'] ?? '، ' ),
				)
			);
		}

		return $values;
	}

	/**
	 * Builds a message when no template was written.
	 *
	 * Prints every Telegram-visible field as `Label: value`, in mapping
	 * order, skipping the empty ones. The title and the permalink are
	 * treated specially because a message that labels its own title reads
	 * badly.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Post                           $post    Post object.
	 * @param array<string,array<string,mixed>> $mapping Effective mapping.
	 * @param array<string,string>              $values  Rendered values.
	 *
	 * @return string Message.
	 */
	private function automatic( WP_Post $post, array $mapping, array $values ): string {
		$fields = $this->registry->discover( $post->post_type );
		$lines  = array();

		foreach ( $mapping as $key => $settings ) {
			$value = trim( (string) ( $values[ $key ] ?? '' ) );

			if ( '' === $value ) {
				continue;
			}

			if ( in_array( $key, array( 'title', 'permalink', 'description' ), true ) ) {
				$lines[] = $value;

				continue;
			}

			$field = $fields[ $key ] ?? null;
			$label = trim( (string) ( $settings['label'] ?? '' ) );

			if ( '' === $label && $field instanceof Field ) {
				$label = $field->label();
			}

			$lines[] = '' === $label ? $value : sprintf(
				/* translators: 1: field label, 2: field value. */
				__( '%1$s: %2$s', 'wp-event-publisher' ),
				$label,
				$value
			);
		}

		return implode( "\n", $lines );
	}

	/**
	 * Removes the gaps an empty placeholder leaves behind.
	 *
	 * @since 1.4.0
	 *
	 * @param string $message Rendered message.
	 *
	 * @return string Tidied message.
	 */
	private function tidy( string $message ): string {
		$message = str_replace( array( "\r\n", "\r" ), "\n", $message );

		$lines = array();

		foreach ( explode( "\n", $message ) as $line ) {
			$trimmed = rtrim( $line );

			// A line that held only a placeholder and some punctuation is
			// noise once the placeholder resolved to nothing.
			if ( '' === trim( $trimmed ) || '' === trim( $trimmed, " \t:،-—–|•·" ) ) {
				$lines[] = '';

				continue;
			}

			$lines[] = $trimmed;
		}

		$message = implode( "\n", $lines );
		$message = (string) preg_replace( '/\n{3,}/u', "\n\n", $message );

		return trim( $message );
	}

	/**
	 * Lists the placeholders available for a scope, for the builder's
	 * autocomplete.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $taxonomy  Taxonomy name.
	 * @param int    $term_id   Term ID.
	 *
	 * @return array<int,array{key:string,label:string,visible:bool}> Placeholders.
	 */
	public function placeholders( string $post_type, string $taxonomy = '', int $term_id = 0 ): array {
		$mapping = $this->mapping->resolve( $post_type, $taxonomy, $term_id );
		$fields  = $this->registry->discover( $post_type );

		$placeholders = array();

		foreach ( $mapping as $key => $settings ) {
			$field = $fields[ $key ] ?? null;

			if ( ! $field instanceof Field ) {
				continue;
			}

			$label = trim( (string) ( $settings['label'] ?? '' ) );

			$placeholders[] = array(
				'key'     => $key,
				'label'   => '' !== $label ? $label : $field->label(),
				'visible' => ! empty( $settings['enabled'] ) && Field::VISIBILITY_TELEGRAM === ( $settings['visibility'] ?? '' ),
			);
		}

		return $placeholders;
	}
}
