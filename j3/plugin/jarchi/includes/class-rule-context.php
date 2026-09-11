<?php
/**
 * The facts a rule is evaluated against.
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
 * Everything a condition can ask about one advertisement, gathered once.
 *
 * Conditions ask cheap questions — "what category is this", "how many
 * images", "what is the price" — and a rule set can ask the same question
 * many times. Reading it once and answering from memory keeps a
 * twenty-rule set to the cost of one.
 *
 * The context is read-only and self-contained: the rule tester builds one
 * for a post the administrator picked and gets exactly the answers a real
 * publication would.
 *
 * @since 1.5.0
 */
class RuleContext {

	/**
	 * Post being published.
	 *
	 * @var WP_Post
	 */
	private WP_Post $post;

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
	 * Taxonomy driving categories.
	 *
	 * @var string
	 */
	private string $taxonomy;

	/**
	 * Deepest assigned term.
	 *
	 * @var WP_Term|null
	 */
	private ?WP_Term $term;

	/**
	 * Memoized subject values.
	 *
	 * @var array<string,mixed>
	 */
	private array $memo = array();

	/**
	 * Constructor.
	 *
	 * @since 1.5.0
	 *
	 * @param WP_Post       $post     Post being published.
	 * @param FieldRegistry $registry Field registry.
	 * @param FieldResolver $resolver Field resolver.
	 * @param string        $taxonomy Taxonomy driving categories.
	 * @param WP_Term|null  $term     Deepest assigned term.
	 */
	public function __construct(
		WP_Post $post,
		FieldRegistry $registry,
		FieldResolver $resolver,
		string $taxonomy = '',
		?WP_Term $term = null
	) {
		$this->post     = $post;
		$this->registry = $registry;
		$this->resolver = $resolver;
		$this->taxonomy = $taxonomy;
		$this->term     = $term;
	}

	/**
	 * Returns the post.
	 *
	 * @since 1.5.0
	 *
	 * @return WP_Post Post being published.
	 */
	public function post(): WP_Post {
		return $this->post;
	}

	/**
	 * Returns the taxonomy driving categories.
	 *
	 * @since 1.5.0
	 *
	 * @return string Taxonomy name.
	 */
	public function taxonomy(): string {
		return $this->taxonomy;
	}

	/**
	 * Returns the deepest assigned term.
	 *
	 * @since 1.5.0
	 *
	 * @return WP_Term|null Term, null when the post has none.
	 */
	public function term(): ?WP_Term {
		return $this->term;
	}

	/**
	 * Answers one subject.
	 *
	 * Returns a scalar for a single-valued subject and a list for a
	 * multi-valued one; the evaluator handles both.
	 *
	 * @since 1.5.0
	 *
	 * @param string $subject Subject name.
	 * @param string $key     Field or taxonomy key, for subjects that need one.
	 *
	 * @return mixed Subject value.
	 */
	public function value( string $subject, string $key = '' ): mixed {
		$memo_key = $subject . '|' . $key;

		if ( array_key_exists( $memo_key, $this->memo ) ) {
			return $this->memo[ $memo_key ];
		}

		$value = $this->compute( $subject, $key );

		/**
		 * Filters a value a rule condition is evaluated against.
		 *
		 * Adding a case here is how a site teaches the rule engine a subject
		 * the plugin does not ship.
		 *
		 * @since 1.5.0
		 *
		 * @param mixed       $value   Computed value.
		 * @param string      $subject Subject name.
		 * @param string      $key     Field or taxonomy key.
		 * @param RuleContext $context This context.
		 */
		$value = apply_filters( 'wpep_rule_subject_value', $value, $subject, $key, $this );

		$this->memo[ $memo_key ] = $value;

		return $value;
	}

	/**
	 * Computes one subject.
	 *
	 * @since 1.5.0
	 *
	 * @param string $subject Subject name.
	 * @param string $key     Field or taxonomy key.
	 *
	 * @return mixed Subject value.
	 */
	private function compute( string $subject, string $key ): mixed {
		switch ( $subject ) {
			case 'post_type':
				return (string) $this->post->post_type;

			case 'post_status':
				return (string) $this->post->post_status;

			case 'post_id':
				return (int) $this->post->ID;

			case 'title':
				return (string) get_the_title( $this->post );

			case 'author':
				$author = get_userdata( (int) $this->post->post_author );

				return $author ? (string) $author->user_login : '';

			case 'author_id':
				return (int) $this->post->post_author;

			case 'user_role':
				$author = get_userdata( (int) $this->post->post_author );

				return $author && isset( $author->roles ) ? array_values( (array) $author->roles ) : array();

			case 'category':
				return $this->term_names( $this->taxonomy, 'top' );

			case 'subcategory':
				return $this->term_names( $this->taxonomy, 'second' );

			case 'parent_category':
				return $this->term_names( $this->taxonomy, 'parent' );

			case 'term':
				return $this->term instanceof WP_Term ? array( (string) $this->term->name, (string) $this->term->slug ) : array();

			case 'taxonomy':
				return $this->term_names( '' !== $key ? $key : $this->taxonomy, 'all' );

			case 'tags':
				$tags = array();

				foreach ( get_object_taxonomies( $this->post->post_type, 'objects' ) as $taxonomy ) {
					if ( $taxonomy instanceof \WP_Taxonomy && ! $taxonomy->hierarchical ) {
						$tags = array_merge( $tags, $this->term_names( (string) $taxonomy->name, 'all' ) );
					}
				}

				return $tags;

			case 'image_count':
				return count( $this->images() );

			case 'gallery_count':
				return max( 0, count( $this->images() ) - ( '' !== $this->featured() ? 1 : 0 ) );

			case 'word_count':
				$text = wp_strip_all_tags( strip_shortcodes( (string) $this->post->post_content ) );

				return count( array_filter( preg_split( '/\s+/u', trim( $text ) ) ?: array() ) );

			case 'price':
				return $this->numeric( $this->field_text( '' !== $key ? $key : 'price' ) );

			case 'date':
				return substr( (string) $this->post->post_date_gmt, 0, 10 );

			case 'time':
				return substr( (string) $this->post->post_date_gmt, 11, 5 );

			case 'weekday':
				$stamp = strtotime( (string) $this->post->post_date_gmt . ' UTC' );

				return false === $stamp ? '' : strtolower( gmdate( 'l', $stamp ) );

			case 'number':
				return $this->numeric( $this->field_text( $key ) );

			case 'boolean':
				$text = strtolower( trim( $this->field_text( $key ) ) );

				return '' !== $text && ! in_array( $text, array( '0', 'false', 'no', 'off' ), true );

			case 'field':
			case 'text':
			case 'select':
			default:
				return $this->field_text( $key );
		}
	}

	/**
	 * Returns a field's value as display text.
	 *
	 * Resolved through the same resolver the payload uses, so a select
	 * compares as "Diesel" — what the administrator sees on the mapping
	 * screen — and its raw `diesel` is accepted too.
	 *
	 * @since 1.5.0
	 *
	 * @param string $key Field key.
	 *
	 * @return string Field text, empty when absent.
	 */
	public function field_text( string $key ): string {
		$key = Field::sanitize_key( $key );

		if ( '' === $key ) {
			return '';
		}

		$field = $this->registry->field( $this->post->post_type, $key );

		if ( ! $field instanceof Field ) {
			// Not a discovered field: fall back to raw meta, so a rule can
			// reference a key discovery capped away.
			$raw = get_post_meta( $this->post->ID, $key, true );

			return is_scalar( $raw ) ? trim( (string) $raw ) : '';
		}

		try {
			return $this->resolver->text( $field, $this->post );
		} catch ( \Throwable $e ) {
			return '';
		}
	}

	/**
	 * Returns a field's raw stored value.
	 *
	 * @since 1.5.0
	 *
	 * @param string $key Field key.
	 *
	 * @return mixed Raw value.
	 */
	public function field_raw( string $key ): mixed {
		$field = $this->registry->field( $this->post->post_type, Field::sanitize_key( $key ) );

		if ( ! $field instanceof Field ) {
			return get_post_meta( $this->post->ID, $key, true );
		}

		try {
			return $this->resolver->raw( $field, $this->post );
		} catch ( \Throwable $e ) {
			return null;
		}
	}

	/**
	 * Returns every image URL of the advertisement.
	 *
	 * @since 1.5.0
	 *
	 * @return string[] Absolute URLs.
	 */
	public function images(): array {
		if ( isset( $this->memo['__images'] ) ) {
			return (array) $this->memo['__images'];
		}

		$images = array();
		$field  = $this->registry->field( $this->post->post_type, ImageProvider::IMAGES );

		if ( $field instanceof Field ) {
			try {
				$value = $this->resolver->value( $field, $this->post );

				if ( is_array( $value ) ) {
					$images = array_values( array_filter( array_map( 'strval', $value ) ) );
				} elseif ( is_string( $value ) && '' !== $value ) {
					$images = array( $value );
				}
			} catch ( \Throwable $e ) {
				$images = array();
			}
		}

		$this->memo['__images'] = $images;

		return $images;
	}

	/**
	 * Returns the featured image URL.
	 *
	 * @since 1.5.0
	 *
	 * @return string URL, empty when there is none.
	 */
	public function featured(): string {
		$field = $this->registry->field( $this->post->post_type, ImageProvider::FEATURED );

		if ( ! $field instanceof Field ) {
			return '';
		}

		try {
			$value = $this->resolver->value( $field, $this->post );
		} catch ( \Throwable $e ) {
			return '';
		}

		return is_string( $value ) ? $value : '';
	}

	/**
	 * Collects term names and slugs for a taxonomy.
	 *
	 * @since 1.5.0
	 *
	 * @param string $taxonomy Taxonomy name.
	 * @param string $part     `all`, `top`, `second` or `parent`.
	 *
	 * @return string[] Names and slugs, so a condition may use either.
	 */
	private function term_names( string $taxonomy, string $part ): array {
		if ( '' === $taxonomy ) {
			return array();
		}

		$terms = get_the_terms( $this->post, $taxonomy );

		if ( ! is_array( $terms ) || empty( $terms ) ) {
			return array();
		}

		if ( 'all' === $part ) {
			$out = array();

			foreach ( $terms as $term ) {
				if ( $term instanceof WP_Term ) {
					$out[] = (string) $term->name;
					$out[] = (string) $term->slug;
				}
			}

			return array_values( array_unique( $out ) );
		}

		$provider = $this->registry->provider( TaxonomyProvider::ID );
		$deepest  = $provider instanceof TaxonomyProvider ? $provider->deepest( $terms ) : null;

		if ( ! $deepest instanceof WP_Term ) {
			return array();
		}

		$lineage = array();

		foreach ( array_reverse( (array) get_ancestors( (int) $deepest->term_id, $taxonomy, 'taxonomy' ) ) as $ancestor_id ) {
			$ancestor = get_term( (int) $ancestor_id, $taxonomy );

			if ( $ancestor instanceof WP_Term ) {
				$lineage[] = $ancestor;
			}
		}

		$lineage[] = $deepest;

		$picked = match ( $part ) {
			'top'    => $lineage[0] ?? null,
			'second' => $lineage[1] ?? null,
			'parent' => $lineage[ count( $lineage ) - 2 ] ?? null,
			default  => null,
		};

		return $picked instanceof WP_Term
			? array( (string) $picked->name, (string) $picked->slug )
			: array();
	}

	/**
	 * Extracts a number from text that may carry currency or separators.
	 *
	 * A price is stored as "۲٬۵۰۰٬۰۰۰ تومان" as often as it is stored as
	 * `2500000`, and a rule that says "price greater than one billion" has
	 * to work in both cases.
	 *
	 * @since 1.5.0
	 *
	 * @param string $text Raw text.
	 *
	 * @return float Extracted number, 0.0 when there is none.
	 */
	public function numeric( string $text ): float {
		if ( '' === trim( $text ) ) {
			return 0.0;
		}

		// Persian and Arabic-Indic digits to ASCII.
		$text = strtr(
			$text,
			array(
				'۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
				'۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
				'٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
				'٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
			)
		);

		// Strip every grouping separator in use, keep one decimal point.
		$text = str_replace( array( ',', '٬', '،', ' ', "\u{00a0}", "\u{200c}" ), '', $text );

		if ( ! preg_match( '/-?\d+(?:\.\d+)?/', $text, $matches ) ) {
			return 0.0;
		}

		return (float) $matches[0];
	}
}
